import type { ConversationMessageRecord } from "@tsian/contracts"
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from "vue"
import {
  useAssistantTimeline,
  type AssistantTimelineNode,
  type ChatMessage,
} from "@/composables/useAssistantTimeline"
import { confirm } from "@/composables/useConfirm"
import {
  resolveInteractionRequest,
  subscribeInteractionRequest,
} from "@/interaction-events"
import {
  ACTIVE_CARD_CHANGED_EVENT,
  isActiveCardChangedEvent,
} from "@/lib/platform-events"
import {
  getLocalAssistantProviderPreset,
  getPlatformActiveGameCard,
  runAssistantChat,
  updateLocalAssistantModel,
  updateLocalAssistantProviderPreset,
  waitForPlatformHostReady,
} from "@/platform-host"
import {
  createAssistantSession,
  deleteAssistantSession,
  ensureAssistantSession,
  getActiveAssistantSessionId,
  getAssistantSessionMessages,
  listAssistantSessions,
  loadContextUsed,
  loadScrollTop,
  renameAssistantSession,
  saveAssistantAttachment,
  saveAssistantSessionMessages,
  saveContextUsed,
  setActiveAssistantSessionId,
  type AssistantSessionSummary,
} from "@/storage"
import {
  buildStoredAssistantTurn,
  chatToStoredMessages,
  mapStoredMessagesToChat,
} from "@/views/assistant-message-mappers"
import type {
  ActiveAskState,
  PendingAttachment,
  RecordAskInput,
} from "@/views/assistant/types"

export const ASSISTANT_ACCEPTED_FILE_TYPES = "image/*,.txt,.json,.md,.markdown,.csv,.xml,.yaml,.yml,.jsonl,.js,.ts,.css,.html,.htm,.svg"

interface AssistantTurnState {
  sessionId: string
  controller: AbortController
  userMsg: ChatMessage
  assistantMsg: ChatMessage
  flush: () => void
  recordAsk: (input: RecordAskInput) => void
  finalize: () => void
  timeline: AssistantTimelineNode[]
  discardPersistence: boolean
}

export interface AssistantControllerOptions {
  scrollToBottom(force?: boolean): Promise<void> | void
  restoreScrollTop(target: number): void
  applySessionScrollTop?(target: number): Promise<void> | void
  focusInput(): void
  focusRenameInput(): void
  resetInputHeight(): void
  autoGrowInput(): void
  onTimelineUpdate?(): void
}

export function useAssistantController(options: AssistantControllerOptions) {
  const assistantTurns = new Map<string, AssistantTurnState>()
  const askRequestSession = new Map<string, string>()
  const runningSessionIds = reactive(new Set<string>())
  const activeAskBySession = reactive(new Map<string, ActiveAskState>())

  const sessions = ref<AssistantSessionSummary[]>([])
  const activeSessionId = ref<string | null>(null)
  const messages = ref<ChatMessage[]>([])
  const errorMessage = ref("")
  const cardName = ref("")
  const copiedIndex = ref<number | null>(null)
  const editingIndex = ref<number | null>(null)
  const sessionCreating = ref(false)
  const sessionRenaming = ref(false)
  const sessionDeleting = ref(false)
  const renaming = ref("")
  const renamingSessionId = ref<string | null>(null)
  const providerPresets = ref<Array<{ id: string; name: string }>>([])
  const assistantProviderPresetId = ref("")
  const assistantModelId = ref("")
  const assistantModels = ref<Array<{ id: string; label: string; contextWindow: number | null }>>([])
  const contextUsed = ref(0)
  const contextTotal = ref(0)
  const inputText = ref("")
  const pendingAttachmentsBySession = reactive(new Map<string, PendingAttachment[]>())

  let unsubscribeInteractionRequest: (() => void) | null = null
  let started = false
  let disposed = false

  const sending = computed(() =>
    activeSessionId.value ? runningSessionIds.has(activeSessionId.value) : false,
  )
  const activeAsk = computed<ActiveAskState | null>(() =>
    activeSessionId.value
      ? activeAskBySession.get(activeSessionId.value) ?? null
      : null,
  )
  const pendingAttachments = computed(() => {
    const sessionId = activeSessionId.value
    return sessionId ? pendingAttachmentsBySession.get(sessionId) ?? [] : []
  })
  const cardTitle = computed(() => cardName.value || "未加载游戏卡")
  const hasActiveCard = computed(() => Boolean(cardName.value))
  const inputLocked = computed(() => !hasActiveCard.value)
  const inputPlaceholder = computed(() =>
    inputLocked.value
      ? "请先加载游戏卡后再使用助手"
      : "输入消息，Enter 发送，Shift+Enter 换行",
  )
  const configButtonTitle = computed(() => {
    if (!assistantProviderPresetId.value) return "助手配置（使用平台默认服务商）"
    const name = providerPresets.value.find(
      (preset) => preset.id === assistantProviderPresetId.value,
    )?.name ?? "所选预设已失效"
    return `助手配置（服务商：${name}）`
  })

  function setErrorMessage(message: string): void {
    errorMessage.value = message
  }

  async function addFileAsAttachment(file: File): Promise<void> {
    const sessionId = activeSessionId.value
    if (!sessionId || inputLocked.value) return
    try {
      const attachment = await saveAssistantAttachment(sessionId, file)
      if (disposed) return
      const previewUrl = attachment.kind === "image" ? URL.createObjectURL(file) : undefined
      const pending = pendingAttachmentsBySession.get(sessionId) ?? []
      pending.push({ ref: attachment, previewUrl })
      pendingAttachmentsBySession.set(sessionId, pending)
    } catch (error) {
      setErrorMessage(`附件添加失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function addFilesAsAttachments(files: Iterable<File>): void {
    if (inputLocked.value) return
    for (const file of files) void addFileAsAttachment(file)
  }

  function clearPendingAttachmentPreviews(sessionId = activeSessionId.value): void {
    if (!sessionId) return
    for (const pending of pendingAttachmentsBySession.get(sessionId) ?? []) {
      if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl)
    }
    pendingAttachmentsBySession.delete(sessionId)
  }

  function clearAllPendingAttachmentPreviews(): void {
    for (const sessionId of pendingAttachmentsBySession.keys()) {
      clearPendingAttachmentPreviews(sessionId)
    }
  }

  function removePendingAttachment(index: number): void {
    const sessionId = activeSessionId.value
    if (!sessionId) return
    const pending = pendingAttachmentsBySession.get(sessionId)
    if (!pending) return
    const [removed] = pending.splice(index, 1)
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
    if (pending.length === 0) pendingAttachmentsBySession.delete(sessionId)
  }

  async function refresh(): Promise<void> {
    errorMessage.value = ""
    await waitForPlatformHostReady()
    const card = await getPlatformActiveGameCard()
    cardName.value = card?.manifest.name ?? ""
    await loadProviderPreset()
  }

  async function refreshSessions(): Promise<void> {
    sessions.value = await listAssistantSessions("local")
  }

  async function persistCurrentSession(): Promise<void> {
    if (!activeSessionId.value) return
    await saveAssistantSessionMessages(
      "local",
      activeSessionId.value,
      chatToStoredMessages(messages.value),
    )
    await refreshSessions()
  }

  async function loadActiveSession(): Promise<void> {
    const session = await ensureAssistantSession("local")
    activeSessionId.value = session.id
    messages.value = mapStoredMessagesToChat(await getAssistantSessionMessages(session.id))
    await refreshSessions()
    contextUsed.value = await loadContextUsed(session.id)
    const recovery = readRecoveryPoint(session.id)
    if (recovery) {
      clearRecoveryPoint(session.id)
      const keep = await confirm({
        title: "发现未完成的回复",
        message: `上次会话有未完成的回复（${new Date(recovery.ts).toLocaleString()}），是否保留到历史？`,
        confirmText: "保留",
        cancelText: "丢弃",
      })
      if (keep) {
        messages.value.push({
          role: "assistant",
          content: `${recovery.text}\n\n_（回复中断，已自动保留）_`,
        })
        await persistCurrentSession()
      }
    }
    const storedScrollTop = await loadScrollTop(session.id)
    if (options.applySessionScrollTop) await options.applySessionScrollTop(storedScrollTop)
    else await options.scrollToBottom()
  }

  async function selectSession(id: string): Promise<void> {
    if (id === activeSessionId.value) return
    const previousId = activeSessionId.value
    const previousMessages = chatToStoredMessages(messages.value)
    activeSessionId.value = id
    let targetMessages = mapStoredMessagesToChat(await getAssistantSessionMessages(id))
    const targetTurn = assistantTurns.get(id)
    if (targetTurn) {
      targetMessages = [...targetMessages, targetTurn.userMsg, targetTurn.assistantMsg]
    }
    messages.value = targetMessages
    contextUsed.value = await loadContextUsed(id)
    const storedScrollTop = await loadScrollTop(id)
    if (options.applySessionScrollTop) await options.applySessionScrollTop(storedScrollTop)
    else await options.scrollToBottom()
    void setActiveAssistantSessionId("local", id)
    if (previousId && previousId !== id && !assistantTurns.has(previousId)) {
      void saveAssistantSessionMessages("local", previousId, previousMessages, { touch: false })
    }
  }

  async function createSession(): Promise<void> {
    sessionCreating.value = true
    try {
      const previousId = activeSessionId.value
      const previousMessages = chatToStoredMessages(messages.value)
      if (previousId && !assistantTurns.has(previousId)) {
        void saveAssistantSessionMessages("local", previousId, previousMessages, { touch: false })
      }
      const session = await createAssistantSession("local")
      activeSessionId.value = session.id
      messages.value = []
      contextUsed.value = 0
      await refreshSessions()
      nextTick(options.focusInput)
    } finally {
      sessionCreating.value = false
    }
  }

  function startRename(id: string): void {
    renamingSessionId.value = id
    renaming.value = sessions.value.find((entry) => entry.id === id)?.title ?? ""
    nextTick(options.focusRenameInput)
  }

  function closeRename(): void {
    renaming.value = ""
    renamingSessionId.value = null
  }

  async function confirmRename(): Promise<void> {
    const id = renamingSessionId.value
    if (!id || !renaming.value.trim()) {
      closeRename()
      return
    }
    sessionRenaming.value = true
    try {
      await renameAssistantSession("local", id, renaming.value.trim())
      await refreshSessions()
    } finally {
      sessionRenaming.value = false
      closeRename()
    }
  }

  async function deleteSession(id: string): Promise<void> {
    if (!id) return
    const wasActive = id === activeSessionId.value
    sessionDeleting.value = true
    try {
      const turn = assistantTurns.get(id)
      if (turn) {
        turn.discardPersistence = true
        const pendingAsk = activeAskBySession.get(id)
        if (pendingAsk) {
          askRequestSession.delete(pendingAsk.requestId)
          activeAskBySession.delete(id)
        }
        turn.controller.abort()
        assistantTurns.delete(id)
        runningSessionIds.delete(id)
      }
      clearPendingAttachmentPreviews(id)
      await deleteAssistantSession("local", id)
      await refreshSessions()
      if (!wasActive) return
      const nextId = await getActiveAssistantSessionId("local")
      if (nextId) {
        activeSessionId.value = nextId
        let nextMessages = mapStoredMessagesToChat(await getAssistantSessionMessages(nextId))
        const nextTurn = assistantTurns.get(nextId)
        if (nextTurn) nextMessages = [...nextMessages, nextTurn.userMsg, nextTurn.assistantMsg]
        messages.value = nextMessages
        contextUsed.value = await loadContextUsed(nextId)
      } else {
        const session = await createAssistantSession("local")
        activeSessionId.value = session.id
        messages.value = []
        contextUsed.value = 0
        await refreshSessions()
      }
      const storedScrollTop = activeSessionId.value
        ? await loadScrollTop(activeSessionId.value)
        : 0
      if (options.applySessionScrollTop) await options.applySessionScrollTop(storedScrollTop)
      else await options.scrollToBottom()
    } finally {
      sessionDeleting.value = false
    }
  }

  async function send(): Promise<void> {
    const content = inputText.value.trim()
    const attachments = pendingAttachments.value.map((pending) => pending.ref)
    if ((!content && attachments.length === 0) || sending.value) return
    if (inputLocked.value) {
      errorMessage.value = "当前没有加载游戏卡。请先在我的应用中创建、导入或加载一张游戏卡。"
      return
    }
    errorMessage.value = ""
    clearPendingAttachmentPreviews()
    const sessionId = activeSessionId.value
    if (!sessionId) return

    const userMsg = reactive<ChatMessage>({
      role: "user",
      content,
      ...(attachments.length > 0 ? { attachments } : {}),
    })
    messages.value.push(userMsg)
    inputText.value = ""
    options.resetInputHeight()
    const assistantMsg = reactive<ChatMessage>({
      role: "assistant",
      content: "",
      timeline: [],
      processCollapsed: true,
      streamingText: "",
      streamingReasoning: "",
    })
    messages.value.push(assistantMsg)
    await options.scrollToBottom()
    const history: ConversationMessageRecord[] = chatToStoredMessages(messages.value.slice(0, -2))
    const { timeline, onDelta, onRoundEnd, onTool, recordAskNode, flushStreaming, finalize } =
      useAssistantTimeline(assistantMsg, () => {
        if (sessionId === activeSessionId.value) options.onTimelineUpdate?.()
      })
    const controller = new AbortController()
    const state: AssistantTurnState = {
      sessionId,
      controller,
      userMsg,
      assistantMsg,
      flush: flushStreaming,
      recordAsk: recordAskNode,
      finalize,
      timeline,
      discardPersistence: false,
    }
    assistantTurns.set(sessionId, state)
    runningSessionIds.add(sessionId)
    let shouldPersistAfterFinalize = false

    try {
      const result = await runAssistantChat({
        message: content,
        ...(attachments.length > 0 ? { attachments } : {}),
        history,
        sessionId,
        onDelta,
        onRoundEnd,
        onTool,
        signal: controller.signal,
        onAskUserRequest(requestId) {
          askRequestSession.set(requestId, sessionId)
        },
      })
      assistantMsg.content = result.replyText
      assistantMsg.streamingText = ""
      assistantMsg.streamingReasoning = ""
      if (result.usage?.input !== undefined) {
        void saveContextUsed(sessionId, result.usage.input)
        if (sessionId === activeSessionId.value) contextUsed.value = result.usage.input
      }
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError"
      const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
      const taskTimeout = error instanceof Error && error.name === "TaskTimeoutError"
      const taskStalled = error instanceof Error && error.name === "TaskCompressionStalledError"
      const isFront = sessionId === activeSessionId.value
      if (aborted) {
        flushStreaming()
        if (assistantMsg.content) assistantMsg.content = `${assistantMsg.content}\n\n_（已停止）_`
        else if (timeline.length === 0 && isFront) messages.value.pop()
        shouldPersistAfterFinalize = true
      } else if (budgetExhausted || taskTimeout || taskStalled) {
        const hint = taskTimeout
          ? "任务超时，已中止"
          : taskStalled
            ? "上下文持续膨胀且压缩无效，已中止"
            : "上下文已满，请开始新会话或精简对话"
        flushStreaming()
        assistantMsg.content = assistantMsg.content
          ? `${assistantMsg.content}\n\n_（${hint}）_`
          : `${hint}。`
        shouldPersistAfterFinalize = true
      } else {
        const message = error instanceof Error ? error.message : String(error)
        if (isFront) errorMessage.value = message
        else console.error("[assistant] 后台 turn 失败", message)
        flushStreaming()
        if (!assistantMsg.content && timeline.length === 0 && isFront) messages.value.pop()
        shouldPersistAfterFinalize = true
      }
    } finally {
      finalize()
      const pendingAsk = activeAskBySession.get(sessionId)
      if (pendingAsk) {
        askRequestSession.delete(pendingAsk.requestId)
        activeAskBySession.delete(sessionId)
      }
      assistantTurns.delete(sessionId)
      runningSessionIds.delete(sessionId)
      if (!state.discardPersistence
        && (shouldPersistAfterFinalize || timeline.some((node) => node.type === "ask"))) {
        await persistTurnSnapshot(state, history, shouldPersistAfterFinalize)
      }
      if (sessionId === activeSessionId.value) {
        await options.scrollToBottom()
        nextTick(options.focusInput)
      }
    }
  }

  async function persistTurnSnapshot(
    state: AssistantTurnState,
    history: ConversationMessageRecord[],
    touch: boolean,
  ): Promise<void> {
    const fullMessages = buildStoredAssistantTurn(history, state.userMsg, state.assistantMsg)
    await saveAssistantSessionMessages("local", state.sessionId, fullMessages, { touch })
    if (touch) await refreshSessions()
  }

  function stopGenerating(): void {
    if (activeSessionId.value) assistantTurns.get(activeSessionId.value)?.controller.abort()
  }

  function resolveAskTurn(requestId: string): AssistantTurnState | null {
    const sessionId = askRequestSession.get(requestId)
    return sessionId ? assistantTurns.get(sessionId) ?? null : null
  }

  function completeAsk(requestId: string, answer: string, cancelled = false): void {
    resolveInteractionRequest(requestId, answer, cancelled || undefined)
    const ask = activeAsk.value
    const state = resolveAskTurn(requestId)
    if (!ask || ask.requestId !== requestId || !state) return
    state.recordAsk({ ...ask, ...(cancelled ? { cancelled: true } : { answer }) })
    activeAskBySession.delete(state.sessionId)
    askRequestSession.delete(requestId)
  }

  function answerAsk(requestId: string, answer: string): void {
    completeAsk(requestId, answer)
  }

  function submitCustomAsk(requestId: string, value: string): void {
    const answer = value.trim()
    if (answer) completeAsk(requestId, answer)
  }

  function cancelAsk(requestId: string): void {
    completeAsk(requestId, "", true)
  }

  async function copyMessage(index: number): Promise<void> {
    const message = messages.value[index]
    if (!message?.content) return
    try {
      await navigator.clipboard.writeText(message.content)
      copiedIndex.value = index
      setTimeout(() => {
        if (copiedIndex.value === index) copiedIndex.value = null
      }, 1500)
    } catch {
      // Clipboard permission failures do not interrupt the conversation.
    }
  }

  function editUserMessage(index: number): void {
    if (sending.value) return
    const message = messages.value[index]
    if (!message || message.role !== "user") return
    editingIndex.value = index
    inputText.value = message.content
    messages.value = messages.value.slice(0, index)
    options.resetInputHeight()
    nextTick(() => {
      options.focusInput()
      options.autoGrowInput()
      editingIndex.value = null
    })
    if (activeSessionId.value) {
      void saveAssistantSessionMessages(
        "local",
        activeSessionId.value,
        chatToStoredMessages(messages.value),
        { touch: false },
      )
    }
  }

  async function restoreSessionScrollTop(): Promise<void> {
    if (!activeSessionId.value) return
    options.restoreScrollTop(await loadScrollTop(activeSessionId.value))
  }

  async function loadProviderPreset(): Promise<void> {
    try {
      const result = await getLocalAssistantProviderPreset()
      providerPresets.value = result.presets
      assistantProviderPresetId.value = result.providerPresetId
      assistantModelId.value = result.modelId
      assistantModels.value = result.models
      const activeModel = result.modelId
        ? result.models.find((model) => model.id === result.modelId)
        : result.models[0]
      contextTotal.value = activeModel?.contextWindow ?? 0
    } catch {
      // Provider selection is optional UI metadata.
    }
  }

  async function changeProviderPreset(presetId: string): Promise<void> {
    if (runningSessionIds.size > 0) return
    const id = presetId === "__platform_default__" ? "" : presetId
    assistantProviderPresetId.value = id
    assistantModelId.value = ""
    assistantModels.value = []
    await updateLocalAssistantProviderPreset(id || null)
    if (id) await updateLocalAssistantModel(null)
    await loadProviderPreset()
  }

  async function changeModel(modelId: string): Promise<void> {
    if (runningSessionIds.size > 0) return
    const id = modelId === "__preset_default__" ? "" : modelId
    assistantModelId.value = id
    await updateLocalAssistantModel(id || null)
    const activeModel = id
      ? assistantModels.value.find((model) => model.id === id)
      : assistantModels.value[0]
    contextTotal.value = activeModel?.contextWindow ?? 0
  }

  const RECOVER_KEY_PREFIX = "assistant:recover:"
  const recoverKey = (sessionId: string) => `${RECOVER_KEY_PREFIX}${sessionId}`

  function writeRecoveryPoint(sessionId: string): void {
    const state = assistantTurns.get(sessionId)
    const text = state?.assistantMsg.streamingText ?? state?.assistantMsg.content
    if (!text) return
    try {
      localStorage.setItem(recoverKey(sessionId), JSON.stringify({ text, ts: Date.now() }))
    } catch {
      // Storage failure during unload is non-fatal.
    }
  }

  function readRecoveryPoint(sessionId: string): { text: string; ts: number } | null {
    try {
      const raw = localStorage.getItem(recoverKey(sessionId))
      if (!raw) return null
      const value = JSON.parse(raw) as { text?: string; ts?: number }
      if (typeof value.text === "string" && typeof value.ts === "number") return value as { text: string; ts: number }
    } catch {
      // Ignore corrupt recovery data.
    }
    return null
  }

  function clearRecoveryPoint(sessionId: string): void {
    try {
      localStorage.removeItem(recoverKey(sessionId))
    } catch {
      // Ignore storage cleanup failures.
    }
  }

  function onBeforeUnloadRecovery(): void {
    if (activeSessionId.value) writeRecoveryPoint(activeSessionId.value)
  }

  function onVisibilityChangeRecovery(): void {
    if (document.visibilityState === "hidden" && activeSessionId.value) {
      writeRecoveryPoint(activeSessionId.value)
    }
  }

  function onActiveCardChanged(event: Event): void {
    if (isActiveCardChangedEvent(event)) void refresh()
  }

  async function initialize(): Promise<void> {
    await refresh()
    if (disposed) return
    await loadActiveSession()
    if (disposed) return
    await loadProviderPreset()
    if (!disposed) nextTick(options.focusInput)
  }

  function start(): void {
    if (started || disposed) return
    started = true
    window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
    window.addEventListener("beforeunload", onBeforeUnloadRecovery)
    document.addEventListener("visibilitychange", onVisibilityChangeRecovery)
    unsubscribeInteractionRequest = subscribeInteractionRequest(
      (requestId, question, choices, allowCustom) => {
        const state = resolveAskTurn(requestId)
        if (!state) return
        activeAskBySession.set(state.sessionId, {
          requestId,
          question,
          allowCustom: allowCustom !== false,
          ...(choices ? { options: choices } : {}),
        })
      },
    )
    void initialize()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearAllPendingAttachmentPreviews()
    if (started) {
      window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
      window.removeEventListener("beforeunload", onBeforeUnloadRecovery)
      document.removeEventListener("visibilitychange", onVisibilityChangeRecovery)
    }
    unsubscribeInteractionRequest?.()
    unsubscribeInteractionRequest = null
    for (const state of assistantTurns.values()) state.controller.abort()
    assistantTurns.clear()
    askRequestSession.clear()
    runningSessionIds.clear()
    activeAskBySession.clear()
    pendingAttachmentsBySession.clear()
  }

  onMounted(start)
  onBeforeUnmount(dispose)

  return {
    sessions,
    activeSessionId,
    messages,
    runningSessionIds,
    activeAsk,
    sending,
    errorMessage,
    cardName,
    cardTitle,
    hasActiveCard,
    inputLocked,
    inputPlaceholder,
    copiedIndex,
    editingIndex,
    sessionCreating,
    sessionRenaming,
    sessionDeleting,
    renaming,
    providerPresets,
    assistantProviderPresetId,
    assistantModelId,
    assistantModels,
    contextUsed,
    contextTotal,
    configButtonTitle,
    inputText,
    pendingAttachments,
    setErrorMessage,
    refresh,
    refreshSessions,
    loadActiveSession,
    selectSession,
    createSession,
    startRename,
    closeRename,
    confirmRename,
    deleteSession,
    persistCurrentSession,
    addFilesAsAttachments,
    removePendingAttachment,
    clearPendingAttachmentPreviews,
    send,
    stopGenerating,
    answerAsk,
    submitCustomAsk,
    cancelAsk,
    copyMessage,
    editUserMessage,
    restoreSessionScrollTop,
    loadProviderPreset,
    changeProviderPreset,
    changeModel,
    start,
    dispose,
  }
}
