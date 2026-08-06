// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const testState = vi.hoisted(() => ({
  interactionListener: null as null | ((requestId: string, question: string, choices?: string[], allowCustom?: boolean) => void),
  resolveInteractionRequest: vi.fn(),
  runAssistantChat: vi.fn(),
  activeSessionId: "session-a",
  sessions: [
    { id: "session-a", title: "会话 A", updatedAt: 1, agentId: "local" },
  ],
  nextSession: 1,
}))

vi.mock("@/interaction-events", () => ({
  resolveInteractionRequest: testState.resolveInteractionRequest,
  subscribeInteractionRequest(listener: typeof testState.interactionListener) {
    testState.interactionListener = listener
    return () => { testState.interactionListener = null }
  },
}))

vi.mock("@/platform-host", () => ({
  waitForPlatformHostReady: vi.fn(),
  getPlatformActiveGameCard: vi.fn(async () => ({ manifest: { name: "测试卡" } })),
  getLocalAssistantProviderPreset: vi.fn(async () => ({
    presets: [], providerPresetId: "", modelId: "", models: [],
  })),
  updateLocalAssistantProviderPreset: vi.fn(),
  updateLocalAssistantModel: vi.fn(),
  runAssistantChat: testState.runAssistantChat,
}))

vi.mock("@/storage", () => ({
  ensureAssistantSession: vi.fn(async () => testState.sessions[0]),
  getActiveAssistantSessionId: vi.fn(async () => testState.activeSessionId),
  setActiveAssistantSessionId: vi.fn(async (_agentId: string, id: string) => { testState.activeSessionId = id }),
  listAssistantSessions: vi.fn(async () => [...testState.sessions]),
  getAssistantSessionMessages: vi.fn(async () => []),
  saveAssistantSessionMessages: vi.fn(),
  loadContextUsed: vi.fn(async () => 0),
  saveContextUsed: vi.fn(),
  loadScrollTop: vi.fn(async (id: string) => id === "session-a" ? 42 : 7),
  createAssistantSession: vi.fn(async () => {
    const session = { id: `session-${++testState.nextSession}`, title: "新会话", updatedAt: Date.now(), agentId: "local" }
    testState.sessions.push(session)
    testState.activeSessionId = session.id
    return session
  }),
  renameAssistantSession: vi.fn(),
  deleteAssistantSession: vi.fn(),
  saveAssistantAttachment: vi.fn(),
}))

vi.mock("@/composables/useConfirm", () => ({ confirm: vi.fn(async () => false) }))

import { useAssistantController } from "./use-assistant-controller"

const mounted: Array<{ app: App; host: HTMLElement }> = []

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

async function mountController() {
  let controller!: ReturnType<typeof useAssistantController>
  const applySessionScrollTop = vi.fn()
  const app = createApp({
    setup() {
      controller = useAssistantController({
        scrollToBottom: vi.fn(),
        restoreScrollTop: vi.fn(),
        applySessionScrollTop,
        focusInput: vi.fn(),
        focusRenameInput: vi.fn(),
        resetInputHeight: vi.fn(),
        autoGrowInput: vi.fn(),
      })
      return () => null
    },
  })
  const host = document.createElement("div")
  document.body.append(host)
  app.mount(host)
  mounted.push({ app, host })
  await vi.waitFor(() => {
    if (!controller.activeSessionId.value) throw new Error("controller not initialized")
  })
  await nextTick()
  return { controller, applySessionScrollTop, app }
}

describe("assistant controller", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.activeSessionId = "session-a"
    testState.sessions.splice(0, testState.sessions.length, {
      id: "session-a", title: "会话 A", updatedAt: 1, agentId: "local",
    })
    testState.nextSession = 1
    testState.interactionListener = null
    localStorage.clear()
  })

  afterEach(() => {
    for (const { app, host } of mounted.splice(0)) {
      app.unmount()
      host.remove()
    }
  })

  it("routes a background ask back to its owning session and restores per-session scroll", async () => {
    const turn = deferred<{ replyText: string; usage?: { input?: number } }>()
    let runInput: { onAskUserRequest(requestId: string): void } | undefined
    testState.runAssistantChat.mockImplementation((input) => {
      runInput = input
      return turn.promise
    })
    const { controller, applySessionScrollTop } = await mountController()
    expect(controller.activeSessionId.value).toBe("session-a")
    expect(applySessionScrollTop).toHaveBeenCalledWith(42)

    controller.inputText.value = "开始任务"
    const sending = controller.send()
    await nextTick()
    runInput?.onAskUserRequest("ask-a")
    testState.interactionListener?.("ask-a", "需要哪一种？", ["甲", "乙"])
    expect(controller.activeAsk.value).toMatchObject({ requestId: "ask-a", allowCustom: true })

    await controller.createSession()
    expect(controller.activeAsk.value).toBeNull()
    await controller.selectSession("session-a")
    expect(controller.activeAsk.value?.requestId).toBe("ask-a")
    expect(applySessionScrollTop).toHaveBeenLastCalledWith(42)

    controller.submitCustomAsk("ask-a", "  自定义答案  ")
    expect(testState.resolveInteractionRequest).toHaveBeenCalledWith("ask-a", "自定义答案", undefined)
    turn.resolve({ replyText: "完成" })
    await sending
    expect(controller.runningSessionIds.has("session-a")).toBe(false)
  })

  it("aborts active turns only when the presentation unmounts", async () => {
    let signal: AbortSignal | undefined
    testState.runAssistantChat.mockImplementation(({ signal: inputSignal }) => {
      signal = inputSignal
      return new Promise((_resolve, reject) => {
        inputSignal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
      })
    })
    const { controller, app } = await mountController()
    controller.inputText.value = "长任务"
    const sending = controller.send()
    await nextTick()
    expect(signal?.aborted).toBe(false)

    app.unmount()
    expect(signal?.aborted).toBe(true)
    await sending
  })
})
