// @vitest-environment happy-dom

import { createApp, computed, h, nextTick, ref, type App } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createBrowserAiProviderPreset,
  createBrowserAiProviderType,
  type BrowserPlatformConfigDraft,
} from "@/config/ai"
import { SPATIAL_ENVIRONMENT_GUIDANCE } from "@/config/platform-ui-mode"
import type { useSettingsController } from "@/controllers/settings/use-settings-controller"
import modelParametersSource from "./SpatialModelParameters.vue?raw"
import providerSettingsSource from "./SpatialProviderSettings.vue?raw"
import SpatialProviderSettings from "./SpatialProviderSettings.vue"
import SpatialSettingsView from "./SpatialSettingsView.vue"
import settingsSource from "./SpatialSettingsView.vue?raw"

type SettingsController = ReturnType<typeof useSettingsController>
const mounted: Array<{ app: App; host: HTMLElement }> = []

function createSettingsHarness(): SettingsController {
  const providerType = createBrowserAiProviderType("openai-compatible")
  const preset = createBrowserAiProviderPreset({
    id: "preset-1",
    name: "Primary provider",
    baseUrl: "https://example.test/v1",
    apiKey: "secret",
    defaultModel: "model-1",
    fallbackStrategy: "ordered",
  })
  providerType.presets = [preset]
  const platformConfigDraft = ref<BrowserPlatformConfigDraft>({
    activeProviderId: preset.id,
    providerTypes: [providerType],
    embeddingConfig: {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      model: "",
      dimensions: 0,
    },
  })
  const activeTypeId = ref(providerType.id)
  const findPreset = (typeId: string, presetId: string) => platformConfigDraft.value.providerTypes
    .find((type) => type.id === typeId)?.presets.find((item) => item.id === presetId)

  return {
    platformConfigDraft,
    activeTypeId,
    activeType: computed(() => platformConfigDraft.value.providerTypes.find((type) => type.id === activeTypeId.value) ?? null),
    providerSaveError: ref(""),
    selectType: (typeId: string) => { activeTypeId.value = typeId },
    findPreset,
    findTypeKind: () => "openai-compatible",
    openAddPreset: vi.fn(),
    openEditPreset: vi.fn(),
    deletePreset: vi.fn(),
    setActivePreset: vi.fn(),
    setStrategy: vi.fn((typeId, presetId, strategy) => { const current = findPreset(typeId, presetId); if (current) current.fallbackStrategy = strategy }),
    patchModel: vi.fn((typeId, presetId, modelId, patch) => { const model = findPreset(typeId, presetId)?.models.find((item) => item.id === modelId); if (!model) return false; Object.assign(model, patch); return true }),
    moveModel: vi.fn(),
    deleteModel: vi.fn(),
    setModelParameters: vi.fn(() => true),
    addModelToPreset: vi.fn(async () => true),
    testModelForPreset: vi.fn(async () => ({ ok: true, message: "ok" })),
    testModelToolCallingForPreset: vi.fn(async () => ({ ok: true, message: "ok" })),
  } as unknown as SettingsController
}

function mountProvider(settings: SettingsController): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ setup: () => () => h(SpatialProviderSettings, { settings }) })
  app.mount(host)
  mounted.push({ app, host })
  return host
}

function mountSettings(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(SpatialSettingsView)
  app.mount(host)
  mounted.push({ app, host })
  return host
}

async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
}

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe("Spatial settings presentation", () => {
  it("presents the concise Spatial environment guidance without obsolete gate copy", async () => {
    const host = mountSettings()
    const appearanceButton = Array.from(host.querySelectorAll<HTMLButtonElement>(".spatial-settings__rail button"))
      .find((button) => button.textContent?.includes("桌面外观"))

    appearanceButton!.click()
    await settle()

    expect(host.textContent).toContain(SPATIAL_ENVIRONMENT_GUIDANCE)
    expect(host.textContent).not.toMatch(/本地实验|正式发布门禁保持关闭/)
  })

  it("uses Spatial selects instead of native select elements", () => {
    const sources = [settingsSource, providerSettingsSource, modelParametersSource]
    expect(sources.join("\n")).not.toMatch(/<select\b/i)
    expect(sources.join("\n")).toContain("SpatialSelect")
    expect(settingsSource).toContain("v-show=\"section === 'providers'\"")
  })

  it("progressively reveals preset, model, and parameter levels", async () => {
    const host = mountProvider(createSettingsHarness())
    const surface = () => host.querySelector<HTMLElement>("[data-provider-level]")!

    expect(surface().dataset.providerLevel).toBe("presets")
    expect(host.textContent).toContain("AI 服务商")
    expect(host.textContent).toContain("服务商预设")
    expect(host.textContent).toContain("Primary provider")
    expect(host.querySelector(".spatial-provider-settings__model-list")).toBeNull()
    expect(host.querySelector(".spatial-model-parameters")).toBeNull()

    host.querySelector<HTMLButtonElement>("[data-open-models]")!.click()
    await settle()
    expect(surface().dataset.providerLevel).toBe("models")
    expect(host.textContent).toContain("model-1")
    expect(host.textContent).toContain("原生工具调用")
    expect(host.textContent).toContain("流式响应")
    expect(host.textContent).not.toContain("native")
    expect(host.textContent).not.toContain("non-stream")
    expect(host.querySelector(".spatial-model-parameters")).toBeNull()

    host.querySelector<HTMLButtonElement>("[data-edit-parameters]")!.click()
    await settle()
    expect(surface().dataset.providerLevel).toBe("parameters")
    expect(host.textContent).toContain("model-1 · 参数")
    expect(host.querySelector(".spatial-model-parameters")).not.toBeNull()
    expect(host.querySelector("select")).toBeNull()
    expect(Array.from(host.querySelectorAll("[class]")).some((element) => (
      Array.from(element.classList).some((className) => className.startsWith("retro-"))
    ))).toBe(false)

    const temperatureTip = host.querySelector<HTMLButtonElement>('button[aria-label="温度说明"]')!
    temperatureTip.click()
    await settle()
    expect(host.querySelector('[role="tooltip"]')?.textContent).toContain("采样温度")

    host.querySelector<HTMLButtonElement>("[data-back-models]")!.click()
    await settle()
    expect(surface().dataset.providerLevel).toBe("models")
    expect(host.textContent).toContain("Primary provider · 模型配置")

    host.querySelector<HTMLButtonElement>("[data-back-presets]")!.click()
    await settle()
    expect(surface().dataset.providerLevel).toBe("presets")
  })
})
