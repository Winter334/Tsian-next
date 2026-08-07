import { computed, getCurrentInstance, onBeforeUnmount, ref, watch } from "vue"
import type { DialogFormOptions } from "@/composables/useDialogForm"
import { openDialogForm } from "@/composables/useDialogForm"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import {
  type BrowserAiModelConfig,
  type BrowserAiModelEntry,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiProviderPreset,
  type BrowserAiToolCallMode,
  type BrowserEmbeddingConfig,
  type BrowserPlatformConfigDraft,
  cloneBrowserAiModelParameters,
  createBrowserAiModelConfig,
  createBrowserAiProviderPreset,
  createDefaultBrowserAiModelParameters,
  fetchBrowserAiProviderModels,
  getBrowserPlatformConfigDraft,
  normalizeBrowserAiProviderBaseUrl,
  resolveBrowserAiConfigFromProviderPreset,
  saveBrowserPlatformConfigDraftLenient,
} from "@/config/ai"
import {
  type PlatformConfig,
  type PlatformConfigAi,
  type PlatformConfigAssistant,
  type PlatformConfigCheckpointPrune,
  type PlatformConfigCloudBackup,
  type PlatformConfigContextCompression,
  type PlatformConfigRag,
  type PlatformUiMode,
  getPlatformConfig,
  savePlatformConfig,
} from "@/config/platform-config"
import { canSelectSpatialMode, switchPlatformUiMode } from "@/config/platform-ui-mode"
import { generateAssistantReply, probeAssistantNativeToolCalling } from "@/runtime-host/ai"

export interface SettingsModelContext {
  readonly typeId: string
  readonly presetId: string
}

export interface SettingsModelTestPayload {
  readonly modelId: string
  readonly parameters: BrowserAiModelParameters
  readonly toolCallMode: BrowserAiToolCallMode
  readonly streaming: boolean
}

export interface SettingsTunablesInput {
  readonly checkpointPrune: PlatformConfigCheckpointPrune
  readonly contextCompression: PlatformConfigContextCompression
  readonly ai: PlatformConfigAi
  readonly assistant: PlatformConfigAssistant
}

export interface SettingsControllerDependencies {
  readonly getBrowserPlatformConfigDraft: () => BrowserPlatformConfigDraft
  readonly saveBrowserPlatformConfigDraftLenient: (draft: BrowserPlatformConfigDraft) => Promise<void>
  readonly getPlatformConfig: () => PlatformConfig
  readonly savePlatformConfig: (config: PlatformConfig) => Promise<void>
  readonly fetchBrowserAiProviderModels: (input: {
    readonly baseUrl: string
    readonly apiKey: string
    readonly kind: BrowserAiProviderKind
  }) => Promise<BrowserAiModelEntry[]>
  readonly generateAssistantReply: typeof generateAssistantReply
  readonly probeAssistantNativeToolCalling: typeof probeAssistantNativeToolCalling
  readonly confirm: typeof confirm
  readonly openDialogForm: (options: DialogFormOptions) => Promise<Record<string, string> | null>
  readonly toast: typeof toast
  readonly canSelectSpatialMode: typeof canSelectSpatialMode
  readonly switchPlatformUiMode: typeof switchPlatformUiMode
}

export interface UseSettingsControllerOptions {
  readonly getActiveModelContext?: () => SettingsModelContext | null
  readonly autoSave?: boolean
  readonly autoSaveDelayMs?: number
  readonly dependencies?: Partial<SettingsControllerDependencies>
}

const DEFAULT_DEPENDENCIES: SettingsControllerDependencies = {
  getBrowserPlatformConfigDraft,
  saveBrowserPlatformConfigDraftLenient,
  getPlatformConfig,
  savePlatformConfig,
  fetchBrowserAiProviderModels,
  generateAssistantReply,
  probeAssistantNativeToolCalling,
  confirm,
  openDialogForm,
  toast,
  canSelectSpatialMode,
  switchPlatformUiMode,
}

export function cloneProviderPreset(input: BrowserAiProviderPreset): BrowserAiProviderPreset {
  return {
    ...input,
    models: input.models.map((model) => ({
      ...model,
      parameters: cloneBrowserAiModelParameters(model.parameters),
    })),
    fetchedModels: input.fetchedModels.map((model) => ({ ...model })),
  }
}

export function clonePlatformConfigDraft(input: BrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  return {
    activeProviderId: input.activeProviderId,
    providerTypes: input.providerTypes.map((type) => ({
      ...type,
      presets: type.presets.map(cloneProviderPreset),
    })),
    embeddingConfig: { ...input.embeddingConfig },
  }
}

export function cloneSettingsPlatformConfig(input: PlatformConfig): PlatformConfig {
  return {
    ...input,
    appearance: { ...input.appearance },
    provider: clonePlatformConfigDraft(input.provider),
    checkpointPrune: { ...input.checkpointPrune },
    contextCompression: { ...input.contextCompression },
    rag: { ...input.rag },
    ai: { ...input.ai },
    assistant: { ...input.assistant },
    cloudBackup: { ...input.cloudBackup },
  }
}

export function baseUrlPlaceholderForKind(kind: BrowserAiProviderKind): string {
  if (kind === "gemini") return "https://generativelanguage.googleapis.com/v1beta"
  if (kind === "claude") return "https://api.anthropic.com/v1"
  if (kind === "deepseek") return "https://api.deepseek.com/v1"
  return "https://api.openai.com/v1"
}

function normalizeRagLimits(input: PlatformConfigRag): PlatformConfigRag {
  const defaultLimit = Number.isInteger(input.defaultLimit) && input.defaultLimit >= 1
    ? input.defaultLimit
    : 1
  const maxLimit = Number.isInteger(input.maxLimit) && input.maxLimit >= defaultLimit
    ? input.maxLimit
    : defaultLimit
  return { defaultLimit, maxLimit }
}

export function useSettingsController(options: UseSettingsControllerOptions = {}) {
  const deps: SettingsControllerDependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies }
  const autoSave = options.autoSave ?? true
  const autoSaveDelayMs = options.autoSaveDelayMs ?? 800

  const platformConfigDraft = ref<BrowserPlatformConfigDraft>(
    clonePlatformConfigDraft(deps.getBrowserPlatformConfigDraft()),
  )
  const platformConfig = ref<PlatformConfig>(cloneSettingsPlatformConfig(deps.getPlatformConfig()))
  const activeTypeId = ref(platformConfigDraft.value.providerTypes[0]?.id ?? "")
  const savingProviderDraft = ref(false)
  const providerSaveError = ref("")
  const lastProviderSavedAt = ref("")
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let suppressAutoSave = false
  let disposed = false

  const activeType = computed(
    () => platformConfigDraft.value.providerTypes.find((type) => type.id === activeTypeId.value) ?? null,
  )

  const activeModelContext = computed(() => options.getActiveModelContext?.() ?? null)

  const activePreset = computed<BrowserAiProviderPreset | null>(() => {
    const context = activeModelContext.value
    if (!context) return null
    return findPreset(context.typeId, context.presetId) ?? null
  })

  const activeTypeName = computed(() => {
    const context = activeModelContext.value
    if (!context) return ""
    return platformConfigDraft.value.providerTypes.find((item) => item.id === context.typeId)?.name ?? ""
  })

  const activeTypeKind = computed<BrowserAiProviderKind>(() => {
    const context = activeModelContext.value
    if (!context) return "openai-compatible"
    return platformConfigDraft.value.providerTypes.find((item) => item.id === context.typeId)?.kind ?? "openai-compatible"
  })

  const appearanceSelectable = computed(() => deps.canSelectSpatialMode())

  function refreshDraft(): void {
    if (disposed) return
    suppressAutoSave = true
    platformConfigDraft.value = clonePlatformConfigDraft(deps.getBrowserPlatformConfigDraft())
    platformConfig.value = cloneSettingsPlatformConfig(deps.getPlatformConfig())
    if (!platformConfigDraft.value.providerTypes.some((type) => type.id === activeTypeId.value)) {
      activeTypeId.value = platformConfigDraft.value.providerTypes[0]?.id ?? ""
    }
    queueMicrotask(() => { if (!disposed) suppressAutoSave = false })
  }

  function selectType(typeId: string): void {
    if (disposed) return
    activeTypeId.value = typeId
  }

  function findPreset(typeId: string, presetId: string): BrowserAiProviderPreset | undefined {
    const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
    return type?.presets.find((preset) => preset.id === presetId)
  }

  function findPresetById(presetId: string): BrowserAiProviderPreset | undefined {
    for (const type of platformConfigDraft.value.providerTypes) {
      const preset = type.presets.find((item) => item.id === presetId)
      if (preset) return preset
    }
    return undefined
  }

  function findTypeKind(typeId: string): BrowserAiProviderKind {
    return platformConfigDraft.value.providerTypes.find((type) => type.id === typeId)?.kind ?? "openai-compatible"
  }

  async function saveProviderDraft(): Promise<void> {
    if (disposed) return
    savingProviderDraft.value = true
    providerSaveError.value = ""
    try {
      await deps.saveBrowserPlatformConfigDraftLenient(clonePlatformConfigDraft(platformConfigDraft.value))
      if (disposed) return
      platformConfig.value = cloneSettingsPlatformConfig(deps.getPlatformConfig())
      lastProviderSavedAt.value = new Date().toLocaleTimeString()
    } catch (error) {
      if (disposed) return
      providerSaveError.value = error instanceof Error ? error.message : "自动保存失败。"
      throw error
    } finally {
      if (!disposed) savingProviderDraft.value = false
    }
  }

  function scheduleProviderDraftSave(): void {
    if (disposed || !autoSave || suppressAutoSave) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (disposed) return
      void saveProviderDraft().catch((error) => {
        if (disposed) return
        deps.toast.error(error instanceof Error ? error.message : "自动保存失败。")
      })
    }, autoSaveDelayMs)
  }

  async function testPresetFields(kind: BrowserAiProviderKind, values: Record<string, string>) {
    if (disposed) return { ok: false, message: "设置面板已关闭。" }
    const baseUrl = normalizeBrowserAiProviderBaseUrl(values.baseUrl ?? "")
    const apiKey = (values.apiKey ?? "").trim()
    if (!baseUrl) return { ok: false, message: "请先填写接口地址。" }
    if (!apiKey) return { ok: false, message: "请先填写 API 密钥。" }
    try {
      const models = await deps.fetchBrowserAiProviderModels({ baseUrl, apiKey, kind })
      if (disposed) return { ok: false, message: "设置面板已关闭。" }
      return { ok: true, message: `已连通，发现 ${models.length} 个模型。` }
    } catch (error) {
      if (disposed) return { ok: false, message: "设置面板已关闭。" }
      return { ok: false, message: error instanceof Error ? error.message : "连通性测试失败。" }
    }
  }

  async function openAddPreset(typeId: string): Promise<void> {
    if (disposed) return
    const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
    if (!type) return
    const values = await deps.openDialogForm({
      title: "添加提供商预设",
      widthClass: "max-w-md",
      confirmText: "添加",
      testLabel: "测试连通性",
      test: (formValues) => testPresetFields(type.kind, formValues),
      fields: [
        { name: "name", label: "预设名称", type: "text", placeholder: "例如 我的 OpenAI", defaultValue: "" },
        { name: "baseUrl", label: "接口地址", type: "text", placeholder: baseUrlPlaceholderForKind(type.kind), mono: true, defaultValue: "" },
        { name: "apiKey", label: "API 密钥", type: "password", placeholder: "sk-...", mono: true, defaultValue: "" },
      ],
      validate: (formValues) => formValues.name.trim() ? null : "请填写预设名称。",
    })
    if (disposed || !values) return
    const preset = createBrowserAiProviderPreset({
      name: values.name.trim(),
      baseUrl: normalizeBrowserAiProviderBaseUrl(values.baseUrl),
      apiKey: values.apiKey.trim(),
    })
    type.presets.push(preset)
    if (!platformConfigDraft.value.activeProviderId) {
      platformConfigDraft.value.activeProviderId = preset.id
    }
    deps.toast.success(`已添加预设：${preset.name}`)
  }

  async function openEditPreset(typeId: string, presetId: string): Promise<void> {
    if (disposed) return
    const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
    const preset = type?.presets.find((item) => item.id === presetId)
    if (!type || !preset) return
    const values = await deps.openDialogForm({
      title: `编辑预设：${preset.name || "未命名"}`,
      widthClass: "max-w-md",
      confirmText: "保存",
      testLabel: "测试连通性",
      test: (formValues) => testPresetFields(type.kind, formValues),
      fields: [
        { name: "name", label: "预设名称", type: "text", placeholder: "例如 我的 OpenAI", defaultValue: preset.name },
        { name: "baseUrl", label: "接口地址", type: "text", placeholder: baseUrlPlaceholderForKind(type.kind), mono: true, defaultValue: preset.baseUrl },
        { name: "apiKey", label: "API 密钥", type: "password", placeholder: "sk-...", mono: true, defaultValue: preset.apiKey },
      ],
      validate: (formValues) => formValues.name.trim() ? null : "请填写预设名称。",
    })
    if (disposed || !values) return
    patchPreset({
      typeId,
      presetId,
      patch: {
        name: values.name.trim(),
        baseUrl: normalizeBrowserAiProviderBaseUrl(values.baseUrl),
        apiKey: values.apiKey.trim(),
      },
    })
    deps.toast.success(`已更新预设：${values.name.trim()}`)
  }

  async function deletePreset(typeId: string, presetId: string): Promise<void> {
    if (disposed) return
    const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
    const preset = type?.presets.find((item) => item.id === presetId)
    if (!type || !preset) return
    const confirmed = await deps.confirm({
      message: `删除预设「${preset.name || "未命名"}」？\n\n这会移除其全部模型配置，无法撤销。`,
      severity: "danger",
      confirmText: "删除",
    })
    if (disposed || !confirmed) return
    type.presets = type.presets.filter((item) => item.id !== presetId)
    if (platformConfigDraft.value.activeProviderId === presetId) {
      platformConfigDraft.value.activeProviderId = ""
    }
    deps.toast.success(`已移除预设：${preset.name || "未命名"}`)
  }

  function patchPreset(payload: { typeId: string; presetId: string; patch: Partial<BrowserAiProviderPreset> }): void {
    if (disposed) return
    const preset = findPreset(payload.typeId, payload.presetId)
    if (!preset) return
    Object.assign(preset, payload.patch)
  }

  function setActivePreset(presetId: string): void {
    if (disposed) return
    if (platformConfigDraft.value.activeProviderId === presetId) return
    platformConfigDraft.value.activeProviderId = presetId
    const preset = findPresetById(presetId)
    deps.toast.success(`已设为默认服务商：${preset?.name || "未命名"}`)
  }

  async function fetchModelsForPreset(typeId: string, presetId: string): Promise<BrowserAiModelEntry[]> {
    if (disposed) return []
    const preset = findPreset(typeId, presetId)
    if (!preset) return []
    const kind = findTypeKind(typeId)
    const models = await deps.fetchBrowserAiProviderModels({
      kind,
      baseUrl: normalizeBrowserAiProviderBaseUrl(preset.baseUrl),
      apiKey: preset.apiKey.trim(),
    })
    if (disposed) return []
    preset.fetchedModels = models.map((model) => ({ ...model }))
    preset.modelsFetchedAt = new Date().toISOString()
    return models
  }

  async function addModelToPreset(
    typeId: string,
    presetId: string,
    payload: SettingsModelTestPayload,
  ): Promise<boolean> {
    if (disposed) return false
    const preset = findPreset(typeId, presetId)
    if (!preset) return false
    const id = payload.modelId.trim()
    if (!id) return false
    if (preset.models.some((model) => model.id === id)) {
      deps.toast.error("该模型已存在。")
      return false
    }
    preset.models.push(createBrowserAiModelConfig({
      id,
      parameters: cloneBrowserAiModelParameters(payload.parameters),
      toolCallMode: payload.toolCallMode,
      streaming: payload.streaming,
    }))
    return true
  }

  async function addModelToActivePreset(payload: SettingsModelTestPayload): Promise<boolean> {
    if (disposed) return false
    const context = activeModelContext.value
    if (!context) return false
    return addModelToPreset(context.typeId, context.presetId, payload)
  }

  async function deleteModel(typeId: string, presetId: string, modelId: string): Promise<void> {
    if (disposed) return
    const preset = findPreset(typeId, presetId)
    if (!preset) return
    if (preset.models.length <= 1) {
      deps.toast.error("每个预设至少保留一个模型。")
      return
    }
    const confirmed = await deps.confirm({
      message: `删除模型「${modelId}」？`,
      severity: "danger",
      confirmText: "删除",
    })
    if (disposed || !confirmed) return
    preset.models = preset.models.filter((model) => model.id !== modelId)
  }

  async function deleteActiveModel(modelId: string): Promise<void> {
    if (disposed) return
    const context = activeModelContext.value
    if (!context) return
    await deleteModel(context.typeId, context.presetId, modelId)
  }

  function moveModel(typeId: string, presetId: string, modelId: string, direction: "up" | "down"): void {
    if (disposed) return
    const preset = findPreset(typeId, presetId)
    if (!preset) return
    const index = preset.models.findIndex((model) => model.id === modelId)
    if (index < 0) return
    const target = direction === "up" ? index - 1 : index + 1
    if (target < 0 || target >= preset.models.length) return
    const [moved] = preset.models.splice(index, 1)
    if (moved) preset.models.splice(target, 0, moved)
  }

  function moveActiveModel(payload: { id: string; direction: "up" | "down" }): void {
    if (disposed) return
    const context = activeModelContext.value
    if (!context) return
    moveModel(context.typeId, context.presetId, payload.id, payload.direction)
  }

  function patchModel(
    typeId: string,
    presetId: string,
    modelId: string,
    patch: Partial<Pick<BrowserAiModelConfig, "id" | "enabled" | "toolCallMode" | "streaming">>,
  ): boolean {
    if (disposed) return false
    const preset = findPreset(typeId, presetId)
    const model = preset?.models.find((item) => item.id === modelId)
    if (!preset || !model) return false
    if (patch.id !== undefined) {
      const nextId = patch.id.trim()
      if (!nextId) return false
      if (nextId !== modelId && preset.models.some((item) => item.id === nextId)) {
        deps.toast.error("该模型已存在。")
        return false
      }
      model.id = nextId
    }
    if (patch.enabled !== undefined) model.enabled = patch.enabled
    if (patch.toolCallMode !== undefined) model.toolCallMode = patch.toolCallMode
    if (patch.streaming !== undefined) model.streaming = patch.streaming
    return true
  }

  function patchActiveModel(payload: { id: string; patch: Partial<Pick<BrowserAiModelConfig, "enabled">> }): void {
    if (disposed) return
    const context = activeModelContext.value
    if (!context) return
    patchModel(context.typeId, context.presetId, payload.id, payload.patch)
  }

  function setModelParameters(
    typeId: string,
    presetId: string,
    modelId: string,
    parameters: BrowserAiModelParameters,
    toolCallMode?: BrowserAiToolCallMode,
    streaming?: boolean,
  ): boolean {
    if (disposed) return false
    const model = findPreset(typeId, presetId)?.models.find((item) => item.id === modelId)
    if (!model) return false
    model.parameters = cloneBrowserAiModelParameters(parameters)
    if (toolCallMode !== undefined) model.toolCallMode = toolCallMode
    if (streaming !== undefined) model.streaming = streaming
    return true
  }

  function setActiveModelParameters(payload: {
    readonly modelId: string
    readonly parameters: BrowserAiModelParameters
    readonly toolCallMode: BrowserAiToolCallMode
    readonly streaming: boolean
  }): boolean {
    if (disposed) return false
    const context = activeModelContext.value
    if (!context) return false
    return setModelParameters(
      context.typeId,
      context.presetId,
      payload.modelId,
      payload.parameters,
      payload.toolCallMode,
      payload.streaming,
    )
  }

  function setStrategy(typeId: string, presetId: string, strategy: "primary-only" | "ordered"): void {
    if (disposed) return
    const preset = findPreset(typeId, presetId)
    if (preset) preset.fallbackStrategy = strategy
  }

  function setActiveStrategy(strategy: "primary-only" | "ordered"): void {
    if (disposed) return
    const context = activeModelContext.value
    if (!context) return
    setStrategy(context.typeId, context.presetId, strategy)
  }

  async function testModelForPreset(
    typeId: string,
    presetId: string,
    payload: SettingsModelTestPayload,
    debugLabel = "settings-model-ping",
  ): Promise<{ ok: boolean; message: string }> {
    if (disposed) return { ok: false, message: "设置面板已关闭。" }
    const preset = findPreset(typeId, presetId)
    if (!preset) return { ok: false, message: "未选择服务商预设。" }
    const modelId = payload.modelId.trim()
    if (!modelId) return { ok: false, message: "请先填写模型 id。" }
    const testPreset: BrowserAiProviderPreset = {
      ...preset,
      models: [
        createBrowserAiModelConfig({
          id: modelId,
          parameters: cloneBrowserAiModelParameters(payload.parameters),
          toolCallMode: payload.toolCallMode,
          streaming: payload.streaming,
          enabled: true,
        }),
      ],
      fallbackStrategy: "primary-only",
    }
    const config = resolveBrowserAiConfigFromProviderPreset(testPreset, findTypeKind(typeId), modelId)
    if (!config) return { ok: false, message: "预设缺少接口地址、API 密钥或模型配置。" }
    try {
      const response = await deps.generateAssistantReply(
        [{ role: "user", content: "Reply with exactly OK." }],
        { config: { ...config, streaming: false }, debugLabel },
      )
      if (disposed) return { ok: false, message: "设置面板已关闭。" }
      const preview = response.trim().replace(/\s+/g, " ").slice(0, 80) || "(空响应)"
      return { ok: true, message: `Chat ping 成功：${preview}` }
    } catch (error) {
      if (disposed) return { ok: false, message: "设置面板已关闭。" }
      return { ok: false, message: error instanceof Error ? error.message : "Chat ping 失败。" }
    }
  }

  async function testActiveModel(payload: SettingsModelTestPayload): Promise<{ ok: boolean; message: string }> {
    if (disposed) return { ok: false, message: "设置面板已关闭。" }
    const context = activeModelContext.value
    if (!context) return { ok: false, message: "未选择服务商预设。" }
    return testModelForPreset(context.typeId, context.presetId, payload)
  }

  async function testModelToolCallingForPreset(
    typeId: string,
    presetId: string,
    payload: SettingsModelTestPayload,
  ): Promise<{ ok: boolean; message: string }> {
    if (disposed) return { ok: false, message: "设置面板已关闭。" }
    const preset = findPreset(typeId, presetId)
    if (!preset) return { ok: false, message: "未选择服务商预设。" }
    const modelId = payload.modelId.trim()
    if (!modelId) return { ok: false, message: "请先填写模型 id。" }
    const testPreset: BrowserAiProviderPreset = {
      ...preset,
      models: [
        createBrowserAiModelConfig({
          id: modelId,
          parameters: cloneBrowserAiModelParameters(payload.parameters),
          toolCallMode: "native",
          streaming: false,
          enabled: true,
        }),
      ],
      fallbackStrategy: "primary-only",
    }
    const config = resolveBrowserAiConfigFromProviderPreset(testPreset, findTypeKind(typeId), modelId)
    if (!config) return { ok: false, message: "预设缺少接口地址、API 密钥或模型配置。" }
    const result = await deps.probeAssistantNativeToolCalling(config)
    return disposed ? { ok: false, message: "设置面板已关闭。" } : result
  }

  async function testActiveModelToolCalling(payload: SettingsModelTestPayload): Promise<{ ok: boolean; message: string }> {
    if (disposed) return { ok: false, message: "设置面板已关闭。" }
    const context = activeModelContext.value
    if (!context) return { ok: false, message: "未选择服务商预设。" }
    return testModelToolCallingForPreset(context.typeId, context.presetId, payload)
  }

  async function saveEmbeddingConfig(config: BrowserEmbeddingConfig, rag: PlatformConfigRag): Promise<void> {
    if (disposed) return
    const current = deps.getPlatformConfig()
    await deps.savePlatformConfig({
      ...current,
      provider: {
        ...current.provider,
        embeddingConfig: { ...config },
      },
      rag: normalizeRagLimits(rag),
    })
    if (disposed) return
    refreshDraft()
    deps.toast.success("语义检索设置已保存。")
  }

  async function saveCloudBackupConfig(config: PlatformConfigCloudBackup): Promise<void> {
    if (disposed) return
    const current = deps.getPlatformConfig()
    await deps.savePlatformConfig({
      ...current,
      cloudBackup: { ...config },
    })
    if (disposed) return
    platformConfig.value = cloneSettingsPlatformConfig(deps.getPlatformConfig())
    deps.toast.success("云备份设置已保存。")
  }

  async function saveTunables(input: SettingsTunablesInput): Promise<void> {
    if (disposed) return
    const current = deps.getPlatformConfig()
    await deps.savePlatformConfig({
      ...current,
      checkpointPrune: { ...input.checkpointPrune },
      contextCompression: { ...input.contextCompression },
      ai: { ...input.ai },
      assistant: { ...input.assistant },
    })
    if (disposed) return
    platformConfig.value = cloneSettingsPlatformConfig(deps.getPlatformConfig())
    deps.toast.success("运行参数已保存。")
  }

  async function switchAppearance(mode: PlatformUiMode): Promise<void> {
    if (disposed) return
    try {
      await deps.switchPlatformUiMode(mode)
    } catch (error) {
      if (!disposed) deps.toast.error(error instanceof Error ? error.message : "桌面模式保存失败。")
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopProviderDraftWatch()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
  }

  const stopProviderDraftWatch = watch(platformConfigDraft, scheduleProviderDraftSave, { deep: true })
  if (getCurrentInstance()) onBeforeUnmount(dispose)

  return {
    platformConfigDraft,
    platformConfig,
    activeTypeId,
    activeType,
    activePreset,
    activeTypeName,
    activeTypeKind,
    appearanceSelectable,
    savingProviderDraft,
    providerSaveError,
    lastProviderSavedAt,
    refreshDraft,
    selectType,
    findPreset,
    findPresetById,
    findTypeKind,
    saveProviderDraft,
    openAddPreset,
    openEditPreset,
    deletePreset,
    patchPreset,
    setActivePreset,
    fetchModelsForPreset,
    addModelToPreset,
    addModelToActivePreset,
    deleteModel,
    deleteActiveModel,
    moveModel,
    moveActiveModel,
    patchModel,
    patchActiveModel,
    setModelParameters,
    setActiveModelParameters,
    setStrategy,
    setActiveStrategy,
    testModelForPreset,
    testActiveModel,
    testModelToolCallingForPreset,
    testActiveModelToolCalling,
    saveEmbeddingConfig,
    saveCloudBackupConfig,
    saveTunables,
    switchAppearance,
    dispose,
  }
}
