import { afterEach, describe, expect, it, vi } from "vitest"
import { nextTick } from "vue"
import { clonePlatformConfig, DEFAULT_PLATFORM_CONFIG, type PlatformConfig } from "@/config/platform-config"
import { createBrowserAiProviderType, createDefaultBrowserAiModelParameters } from "@/config/ai"
import {
  type SettingsControllerDependencies,
  useSettingsController,
} from "./use-settings-controller"

function createHarness(overrides: Partial<SettingsControllerDependencies> = {}) {
  let config = clonePlatformConfig(DEFAULT_PLATFORM_CONFIG)
  config.provider.providerTypes = [createBrowserAiProviderType("openai-compatible")]
  const savePlatformConfig = vi.fn(async (next: PlatformConfig) => { config = clonePlatformConfig(next) })
  const saveProvider = vi.fn(async (draft: PlatformConfig["provider"]) => { config = { ...config, provider: draft } })
  const controller = useSettingsController({
    autoSaveDelayMs: 800,
    dependencies: {
      getPlatformConfig: () => config,
      getBrowserPlatformConfigDraft: () => config.provider,
      savePlatformConfig,
      saveBrowserPlatformConfigDraftLenient: saveProvider,
      toast: { success: vi.fn(), error: vi.fn() } as never,
      confirm: vi.fn(async () => true) as never,
      openDialogForm: vi.fn() as never,
      ...overrides,
    },
  })
  return { controller, savePlatformConfig, saveProvider, get config() { return config } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe("useSettingsController", () => {
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

  it("deep auto-saves provider drafts after 800ms without replacing unrelated config", async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    const type = harness.controller.platformConfigDraft.value.providerTypes[0]!
    type.presets.push({ id: "preset", name: "Saved", baseUrl: "https://example.test/v1", apiKey: "secret", models: [], fallbackStrategy: "primary-only", fetchedModels: [], modelsFetchedAt: "" })
    await nextTick()
    await vi.advanceTimersByTimeAsync(799)
    expect(harness.saveProvider).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.saveProvider).toHaveBeenCalledTimes(1)
    expect(harness.config.cloudBackup).toEqual(DEFAULT_PLATFORM_CONFIG.cloudBackup)
    harness.controller.dispose()
  })

  it("merges semantic, backup and tunable writes with the current complete config", async () => {
    const harness = createHarness()
    const embedding = { enabled: true, baseUrl: "https://embed.test/v1", apiKey: "embed-secret", model: "embed", dimensions: 1536 }
    await harness.controller.saveEmbeddingConfig(embedding, { defaultLimit: 9, maxLimit: 3 })
    expect(harness.config.provider.embeddingConfig).toEqual(embedding)
    expect(harness.config.rag).toEqual({ defaultLimit: 9, maxLimit: 9 })
    await harness.controller.saveCloudBackupConfig({ autoBackupEnabled: true })
    await harness.controller.saveTunables({ checkpointPrune: { keepRecent: 8, sparseEvery: 2 }, contextCompression: { ...harness.config.contextCompression, keepRecentTurns: 7 }, ai: { chatTimeoutMs: 2000 }, assistant: { maxStoredMessages: 20 } })
    expect(harness.config.provider.embeddingConfig.apiKey).toBe("embed-secret")
    expect(harness.config.cloudBackup.autoBackupEnabled).toBe(true)
    expect(harness.config.checkpointPrune).toEqual({ keepRecent: 8, sparseEvery: 2 })
    harness.controller.dispose()
  })

  it("keeps one model minimum and constructs native-tool probes from the edited parameters", async () => {
    const probe = vi.fn(async () => ({ ok: true, message: "native ok" }))
    const harness = createHarness({ probeAssistantNativeToolCalling: probe })
    const type = harness.controller.platformConfigDraft.value.providerTypes[0]!
    type.presets.push({ id: "preset", name: "P", baseUrl: "https://example.test/v1", apiKey: "secret", models: [{ id: "model", enabled: true, toolCallMode: "text", streaming: true, parameters: createDefaultBrowserAiModelParameters() }], fallbackStrategy: "primary-only", fetchedModels: [], modelsFetchedAt: "" })
    await harness.controller.deleteModel(type.id, "preset", "model")
    expect(type.presets[0]!.models).toHaveLength(1)
    expect(harness.controller.patchModel(type.id, "preset", "model", { id: "renamed", enabled: false })).toBe(true)
    expect(type.presets[0]!.models[0]!.id).toBe("renamed")
    const result = await harness.controller.testModelToolCallingForPreset(type.id, "preset", {
      modelId: "renamed",
      parameters: type.presets[0]!.models[0]!.parameters,
      toolCallMode: "text",
      streaming: true,
    })
    expect(result).toEqual({ ok: true, message: "native ok" })
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      model: "renamed",
      toolCallMode: "native",
      streaming: false,
    }))
    harness.controller.dispose()
  })

  it("treats disposal as terminal for settings work and late dialog results", async () => {
    const dialog = deferred<Record<string, string> | null>()
    const fetchModels = vi.fn(async () => [])
    const generateReply = vi.fn(async () => "OK")
    const probe = vi.fn(async () => ({ ok: true, message: "ok" }))
    const confirm = vi.fn(async () => true)
    const switchMode = vi.fn(async () => {})
    const openDialogForm = vi.fn(() => dialog.promise)
    const harness = createHarness({
      fetchBrowserAiProviderModels: fetchModels,
      generateAssistantReply: generateReply as never,
      probeAssistantNativeToolCalling: probe,
      confirm: confirm as never,
      openDialogForm,
      switchPlatformUiMode: switchMode,
    })
    const type = harness.controller.platformConfigDraft.value.providerTypes[0]!
    const open = harness.controller.openAddPreset(type.id)
    expect(openDialogForm).toHaveBeenCalledOnce()

    harness.controller.dispose()
    dialog.resolve({ name: "Late preset", baseUrl: "https://example.test/v1", apiKey: "secret" })
    await open
    expect(type.presets).toHaveLength(0)

    await harness.controller.saveProviderDraft()
    await harness.controller.fetchModelsForPreset(type.id, "missing")
    await harness.controller.openAddPreset(type.id)
    await harness.controller.deletePreset(type.id, "missing")
    await harness.controller.testModelForPreset(type.id, "missing", {
      modelId: "model",
      parameters: createDefaultBrowserAiModelParameters(),
      toolCallMode: "native",
      streaming: false,
    })
    await harness.controller.testModelToolCallingForPreset(type.id, "missing", {
      modelId: "model",
      parameters: createDefaultBrowserAiModelParameters(),
      toolCallMode: "native",
      streaming: false,
    })
    await harness.controller.saveEmbeddingConfig(harness.config.provider.embeddingConfig, harness.config.rag)
    await harness.controller.saveCloudBackupConfig(harness.config.cloudBackup)
    await harness.controller.saveTunables({
      checkpointPrune: harness.config.checkpointPrune,
      contextCompression: harness.config.contextCompression,
      ai: harness.config.ai,
      assistant: harness.config.assistant,
    })
    await harness.controller.switchAppearance("retro")

    expect(harness.saveProvider).not.toHaveBeenCalled()
    expect(harness.savePlatformConfig).not.toHaveBeenCalled()
    expect(fetchModels).not.toHaveBeenCalled()
    expect(generateReply).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    expect(openDialogForm).toHaveBeenCalledOnce()
    expect(switchMode).not.toHaveBeenCalled()
  })

  it("does not consume a provider save result that resolves after disposal", async () => {
    const saving = deferred<void>()
    const saveProvider = vi.fn(() => saving.promise)
    const getPlatformConfig = vi.fn(() => clonePlatformConfig(DEFAULT_PLATFORM_CONFIG))
    const harness = createHarness({
      saveBrowserPlatformConfigDraftLenient: saveProvider,
      getPlatformConfig,
    })
    getPlatformConfig.mockClear()

    const save = harness.controller.saveProviderDraft()
    expect(saveProvider).toHaveBeenCalledOnce()
    harness.controller.dispose()
    saving.resolve()
    await save

    expect(getPlatformConfig).not.toHaveBeenCalled()
    expect(harness.controller.lastProviderSavedAt.value).toBe("")
  })
})
