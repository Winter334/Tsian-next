// @vitest-environment happy-dom

import { createApp, nextTick, reactive, ref, type App } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AssistantControllerOptions } from "@/controllers/assistant/use-assistant-controller"

const integration = vi.hoisted(() => ({
  options: null as AssistantControllerOptions | null,
  controller: null as Record<string, unknown> | null,
  routerPush: vi.fn(),
  openConfig: vi.fn(),
}))

vi.mock("@/controllers/assistant/use-assistant-controller", () => ({
  ASSISTANT_ACCEPTED_FILE_TYPES: "image/*,.txt",
  useAssistantController(options: AssistantControllerOptions) {
    integration.options = options
    return integration.controller
  },
}))

vi.mock("vue-router", () => ({
  useRoute: () => reactive({ path: "/assistant" }),
  useRouter: () => ({ push: integration.routerPush }),
}))

vi.mock("./spatial-assistant-config-surface", () => ({
  openSpatialAssistantConfig: integration.openConfig,
}))

import SpatialAssistantView from "./SpatialAssistantView.vue"

const mounted: Array<{ app: App; host: HTMLElement }> = []

function mount(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(SpatialAssistantView)
  app.mount(host)
  mounted.push({ app, host })
  return host
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes(text))
}

describe("Spatial Assistant controller integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    integration.options = null
    integration.controller = {
      sessions: ref([{ id: "session-a", title: "会话 A", updatedAt: 1, agentId: "local" }]),
      activeSessionId: ref("session-a"),
      messages: ref([
        { role: "user", content: "请检查", attachments: [{ path: "temp/a.txt", name: "a.txt", size: 12, kind: "text", mediaType: "text/plain" }] },
        {
          role: "assistant",
          content: "已经完成。",
          processCollapsed: true,
          timeline: [
            { type: "interim", id: "i", round: 1, text: "先读取", collapsed: false },
            { type: "tool", id: "t", round: 1, name: "read", displayName: "读取文件", status: "success", collapsed: true },
            { type: "ask", id: "a", round: 1, requestId: "old", question: "确认？", answer: "确认", collapsed: true },
          ],
        },
      ]),
      runningSessionIds: reactive(new Set<string>()),
      activeAsk: ref({ requestId: "ask", question: "请选择，也可以自定义", options: ["甲", "乙"], allowCustom: true }),
      sending: ref(false),
      errorMessage: ref(""),
      cardTitle: ref("测试卡"),
      hasActiveCard: ref(true),
      inputLocked: ref(false),
      inputPlaceholder: ref("输入消息"),
      copiedIndex: ref(null),
      sessionCreating: ref(false),
      sessionRenaming: ref(false),
      sessionDeleting: ref(false),
      renaming: ref(""),
      providerPresets: ref([{ id: "provider", name: "Provider" }]),
      assistantProviderPresetId: ref("provider"),
      assistantModelId: ref("model"),
      assistantModels: ref([{ id: "model", label: "Model", contextWindow: 1000 }]),
      contextUsed: ref(250),
      contextTotal: ref(1000),
      configButtonTitle: ref("助手配置"),
      inputText: ref(""),
      pendingAttachments: ref([]),
      selectSession: vi.fn(),
      createSession: vi.fn(),
      startRename: vi.fn(),
      closeRename: vi.fn(),
      confirmRename: vi.fn(),
      deleteSession: vi.fn(),
      addFilesAsAttachments: vi.fn(),
      removePendingAttachment: vi.fn(),
      send: vi.fn(),
      stopGenerating: vi.fn(),
      answerAsk: vi.fn(),
      submitCustomAsk: vi.fn(),
      cancelAsk: vi.fn(),
      copyMessage: vi.fn(),
      editUserMessage: vi.fn(),
      restoreSessionScrollTop: vi.fn(),
      loadProviderPreset: vi.fn(),
      changeProviderPreset: vi.fn(),
      changeModel: vi.fn(),
    }
  })

  afterEach(() => {
    for (const { app, host } of mounted.splice(0)) {
      app.unmount()
      host.remove()
    }
  })

  it("renders the shared process model and complete ask deformation without Retro controls", async () => {
    const host = mount()
    await nextTick()
    expect(host.querySelector("select")).toBeNull()
    expect(host.querySelector('[class*="retro-"]')).toBeNull()
    expect(host.textContent).toContain("执行过程")
    expect(host.textContent).toContain("读取文件")
    expect(host.textContent).toContain("成功")
    expect(host.textContent).toContain("甲")
    expect(host.querySelector<HTMLInputElement>('input[aria-label="自定义回答"]')).not.toBeNull()

    buttonByText(host, "甲")?.click()
    expect(integration.controller?.answerAsk).toHaveBeenCalledWith("ask", "甲")
    const custom = host.querySelector<HTMLInputElement>('input[aria-label="自定义回答"]')!
    custom.value = "补充回答"
    custom.dispatchEvent(new Event("input", { bubbles: true }))
    custom.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    await nextTick()
    expect(integration.controller?.submitCustomAsk).toHaveBeenCalledWith("ask", "补充回答")
  })

  it("keeps stop, session and timeline callbacks at the Spatial presentation boundary", async () => {
    const host = mount()
    const controller = integration.controller as Record<string, ReturnType<typeof vi.fn>> & {
      activeAsk: { value: unknown }
      sending: { value: boolean }
      runningSessionIds: Set<string>
    }
    controller.activeAsk.value = null
    controller.sending.value = true
    controller.runningSessionIds.add("session-a")
    await nextTick()

    buttonByText(host, "停止")?.click()
    expect(controller.stopGenerating).toHaveBeenCalledOnce()
    buttonByText(host, "会话 A")?.click()
    expect(controller.selectSession).toHaveBeenCalledWith("session-a")
    integration.options?.onTimelineUpdate?.()
    expect(integration.options).not.toBeNull()
  })

  it("opens Assistant config as a separate Spatial surface", async () => {
    const host = mount()
    await nextTick()

    host.querySelector<HTMLButtonElement>('[aria-label="助手配置"]')?.click()

    expect(integration.openConfig).toHaveBeenCalledOnce()
    expect(host.querySelector('[data-spatial-source="global:assistant-config"]')).toBeNull()
    const request = integration.openConfig.mock.calls[0]?.[0] as { onChange(): void }
    request.onChange()
    expect(integration.controller?.loadProviderPreset).toHaveBeenCalledOnce()
  })
})
