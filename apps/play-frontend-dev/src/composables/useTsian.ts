import { reactive, ref, readonly, onUnmounted } from "vue"
import { createTsian } from "@tsian/play-bridge"
import { parseStoryOptions } from "../lib/story-options"
import type {
  TsianApi,
  MessageDelta,
  RoundEnd,
  TurnEndResult,
  ToolEvent,
} from "@tsian/play-bridge"
import type { TurnPhase } from "../types"
import { triggerSyncAfterTurn, useSyncAfterTurn } from "./useSyncAfterTurn"
import { buildContextInjection } from "../lib/context-injection"
import type { BuildInjectionBlockedReason } from "../lib/context-injection"

/**
 * useTsian — 单例 TsianApi + 5 订阅映射到响应式状态。
 *
 * design §3：所有组件通过此 composable 访问 bridge。
 *
 * 状态模型（镜像 legacy main.ts 的 $story DOM 容器，单一有序流不清空）：
 * - stream：扁平有序流，所有元素（user/interim/thought/tool/assistant/options）
 *   按发生顺序 push，send 不清空，reloadHistory 时重建。render 按 kind 分发组件。
 * - currentTurn.streamingText/streamingReasoning：流式累积文本，onRoundEnd/onTurnEnd
 *   时落定为 interim/thought/assistant 推入 stream，然后清空累积器。
 * - 这样过程节点和消息天然有序交织，与真实发生顺序一致（legacy 同理）。
 */

// ── 模块级单例 ──
let tsianInstance: TsianApi | null = null
function getTsian(): TsianApi {
  if (!tsianInstance) tsianInstance = createTsian()
  return tsianInstance
}

// ── 模块级共享响应式状态（所有 useTsian() 调用共用）──
const ready = ref(false)
const sessionId = ref<string | null>(null)
const turnPhase = ref<TurnPhase>("idle")
const turnCount = ref(0)
const checkpoints = ref<import("@tsian/contracts").CheckpointSummary[]>([])

/** 流元素：单一有序流，所有 kind 按发生顺序 push，不清空。 */
export type StreamItem =
  | { kind: "user"; id: string; content: string }
  | { kind: "assistant"; id: string; content: string; tokens?: number }
  | { kind: "interim"; id: string; round: number; text: string; agentId: string | null }
  | { kind: "thought"; id: string; round: number; text: string; agentId: string | null; collapsed: boolean }
  | { kind: "tool"; id: string; round: number; name: string; status: "loading" | "running" | "success" | "failed"; agentId: string }

// 有序流：历史（loadHistory 重建）+ 实时（send/订阅 push），按真实顺序交织
const stream = ref<StreamItem[]>([])

// 流式累积器（onMessage 累加，onRoundEnd/onTurnEnd 落定推入 stream 后清空）
const streamingText = ref("")
const streamingReasoning = ref("")

// 当前轮剧情选项（onTurnEnd 填充，send 时清空）
const turnOptions = ref<string[]>([])

// 最近一次 send 被阻断的原因（design §5 / §9）。
// - blocked 分支：不推 user StreamItem、不切 turnPhase、不发 tsian.send，仅置此 ref。
// - 下次 send 进入前置检查前清空。UI（StoryView）v-if 渲染 banner。
const lastSendError = ref<{ reason: BuildInjectionBlockedReason; detail?: string } | null>(null)

// 订阅是否已注册（只注册一次，避免多组件重复订阅）
let subscribed = false
const unsubscribers: Array<() => void> = []

// 历史是否已加载（避免视图切换重复 loadHistory 覆盖实时 stream）
let historyLoaded = false

function displayAssistantContent(item: { content: string; displayContent?: string }): string {
  return item.displayContent ?? item.content
}

function projectedChoices(item: { projections?: Record<string, unknown> | undefined }): string[] {
  const choices = item.projections?.choices
  return Array.isArray(choices) ? choices.filter((choice): choice is string => typeof choice === "string") : []
}

function createFallbackAssistantFromStream(): { content: string } | null {
  const content = streamingText.value
  return content.trim() ? { content } : null
}

function createAssistantStreamItem(
  item: { content: string; displayContent?: string; projections?: Record<string, unknown>; stats?: { totalTokens?: number } },
  id: string,
): StreamItem | null {
  const visibleContent = displayAssistantContent(item)
  const parsed = parseStoryOptions(visibleContent)
  const content = item.projections ? visibleContent : parsed.cleanText
  if (!content.trim()) return null
  return {
    kind: "assistant",
    id,
    content,
    tokens: item.stats?.totalTokens,
  }
}

function assistantChoices(
  item: { content: string; displayContent?: string; projections?: Record<string, unknown> | undefined },
): string[] {
  const projected = projectedChoices(item)
  if (projected.length > 0) return projected
  return parseStoryOptions(displayAssistantContent(item)).options
}

function subscribe(): void {
  if (subscribed) return
  const tsian = getTsian()
  subscribed = true

  unsubscribers.push(
    tsian.onMessage((msg: MessageDelta) => {
      turnPhase.value = "streaming"
      if (msg.kind === "content") {
        streamingText.value += msg.delta
      } else {
        streamingReasoning.value += msg.delta
      }
    }),
  )

  unsubscribers.push(
    tsian.onRoundEnd((end: RoundEnd) => {
      const round = end.round
      // 思维链/过渡文本在时间线上先于工具调用产生，但 onRoundEnd 在工具执行完
      // 才触发——工具节点已 push 到 stream 末尾。这里把 interim/thought 插到
      // 同 round 第一个 tool 节点之前，保持与持久化顺序一致（镜像 legacy finalizeRound）。
      const nodesToInsert: StreamItem[] = []
      if (end.kind === "thought") {
        const interimText = streamingText.value
        const reasoning = streamingReasoning.value
        if (interimText.trim()) {
          nodesToInsert.push({ kind: "interim", id: `interim-r${round}-${Date.now()}`, round, text: interimText, agentId: end.agentId || null })
        }
        if (reasoning.trim()) {
          nodesToInsert.push({ kind: "thought", id: `thought-r${round}-${Date.now()}`, round, text: reasoning, agentId: end.agentId || null, collapsed: true })
        }
      } else {
        // final 轮：思维链→thought，streamingText 保留给 onTurnEnd 落定
        const reasoning = streamingReasoning.value
        if (reasoning.trim()) {
          nodesToInsert.push({ kind: "thought", id: `thought-r${round}-${Date.now()}`, round, text: reasoning, agentId: end.agentId || null, collapsed: true })
        }
      }
      if (nodesToInsert.length > 0) {
        const firstToolIdx = stream.value.findIndex(
          (n) => n.kind === "tool" && n.round === round,
        )
        if (firstToolIdx >= 0) {
          stream.value.splice(firstToolIdx, 0, ...nodesToInsert)
        } else {
          stream.value.push(...nodesToInsert)
        }
      }
      // thought 轮清空累积器；final 轮只清 reasoning（streamingText 留给 onTurnEnd）
      if (end.kind === "thought") {
        streamingText.value = ""
      }
      streamingReasoning.value = ""
    }),
  )

  unsubscribers.push(
    tsian.onTool((tool: ToolEvent) => {
      // 同 callId 的 tool 更新状态，否则 push 新节点到 stream
      const existing = stream.value.find(
        (n): n is Extract<StreamItem, { kind: "tool" }> => n.kind === "tool" && n.id === tool.callId,
      )
      if (existing) {
        existing.status = tool.status
      } else {
        stream.value.push({
          kind: "tool",
          id: tool.callId,
          round: tool.round,
          name: tool.name,
          status: tool.status,
          agentId: tool.agentId,
        })
      }
    }),
  )

  unsubscribers.push(
    tsian.onTurnEnd((result: TurnEndResult) => {
      // 落定：host turn-completed 携带已投影并持久化的 assistant item。
      const assistant = result.assistant ?? createFallbackAssistantFromStream()
      const streamItem = assistant ? createAssistantStreamItem(assistant, `assistant-${Date.now()}`) : null
      if (streamItem) stream.value.push(streamItem)
      streamingText.value = ""
      streamingReasoning.value = ""
      turnOptions.value = assistant ? assistantChoices(assistant) : []
      turnPhase.value = "standby"
      const completedTurn = result.turn ?? turnCount.value
      turnCount.value = completedTurn + 1
      // 回合后同步：正文落定后发起回合后维护 Agent 调用（若卡配置了 postTurnMaintenance）。
      // triggerSyncAfterTurn 内部读 entrypoints 决定是否启动；不阻塞主回合流程。
      void triggerSyncAfterTurn(completedTurn)
    }),
  )

  // onAsk 本任务不实现 ask_user 面板（R4），仅占位
  unsubscribers.push(getTsian().onAsk(() => {}))
}

/**
 * getTsianClient — 非 setup 上下文（事件回调 / async 函数 / 模块级函数）使用的 plain accessor。
 *
 * 返回单例 TsianApi，并确保订阅已注册（幂等）。不调用任何 Vue lifecycle hook，
 * 因此可以在 `onUnmounted` 之外安全调用，不会触发 "onUnmounted is called when
 * there is no active component instance" 警告。
 *
 * 组件 setup 上下文应继续使用 `useTsian()`（它内部调本函数 + 注册 lifecycle hook）。
 */
export function getTsianClient(): TsianApi {
  const tsian = getTsian()
  subscribe()
  return tsian
}

/**
 * useTsian — 在组件 setup 中调用，返回响应式 bridge 状态 + 操作方法。
 * 自动在挂载时注册订阅（多次调用安全，单例共享），并在卸载时清理 ready 轮询。
 *
 * 必须在组件 setup 同步阶段调用（内部注册 onUnmounted）。
 * 事件回调 / async 函数 / 模块级函数请用 `getTsianClient()`。
 */
export function useTsian() {
  const tsian = getTsianClient()

  // ready 状态轮询（bridge.ready 是 getter，非响应式；轮询同步到 ref）
  let readyPoll = 0
  if (!ready.value) {
    readyPoll = window.setInterval(() => {
      if (tsian.ready) {
        ready.value = true
        sessionId.value = tsian.sessionId
        clearInterval(readyPoll)
      }
    }, 50)
  }

  onUnmounted(() => {
    if (readyPoll) clearInterval(readyPoll)
  })

  const { syncPhase, retrySyncAfterTurn, resetSyncPhase } = useSyncAfterTurn()

  return {
    // 响应式状态（只读视图）
    ready: readonly(ready),
    sessionId: readonly(sessionId),
    turnPhase: readonly(turnPhase),
    turnCount: readonly(turnCount),
    stream: readonly(stream),
    streamingText: readonly(streamingText),
    turnOptions: readonly(turnOptions),
    checkpoints: readonly(checkpoints),
    syncPhase,
    lastSendError: readonly(lastSendError),

    // 操作方法
    tsian,
    retrySyncAfterTurn,
    resetSyncPhase,
    async send(text: string): Promise<void> {
      if (!tsian.ready || turnPhase.value === "streaming") return
      // 同步进行中或失败时不允许发送（避免在旧状态上继续）
      if (syncPhase.value === "syncing" || syncPhase.value === "sync-failed") return
      // 前置状态检查通过：先清空上一次阻断态，进入 injection 构建。
      lastSendError.value = null
      // 用动态 import 避免与 useRuntime 的顶层 import useTsian 形成模块初始化循环
      // （useRuntime 顶层 static import useTsian；若这里 static import useRuntime，
      // 会在 useTsian 模块尚未完成初始化时被求值）。
      const { useRuntime } = await import("./useRuntime")
      const { runtimeData } = useRuntime()
      const result = await buildContextInjection({
        workspace: tsian.workspace,
        runtimeData: runtimeData.value,
      })
      if (result.status === "blocked") {
        // 阻断分支（design §9）：不推 StreamItem、不切 turnPhase、不 tsian.send。
        lastSendError.value = { reason: result.reason, detail: result.detail }
        return
      }
      // 不清空 stream（镜像 legacy：所有内容按顺序累积，跨轮保留）
      // 只重置流式累积器 + 选项
      streamingText.value = ""
      streamingReasoning.value = ""
      turnOptions.value = []
      // 立即把用户消息推入 stream（按发生顺序，在过程节点/assistant 之前）
      stream.value.push({
        kind: "user",
        id: `user-${Date.now()}`,
        content: text,
      })
      turnPhase.value = "streaming"
      try {
        await tsian.send(
          text,
          result.messages.length > 0 ? { injection: result.messages } : undefined,
        )
      } catch (err) {
        const msg = err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "发送失败"
        console.error("[useTsian] send failed:", msg)
        streamingText.value = ""
        streamingReasoning.value = ""
        turnPhase.value = "standby"
      }
    },
    async stop(): Promise<void> {
      // 只在 streaming 时有意义（幂等：非 streaming 空操作）
      if (turnPhase.value !== "streaming") return
      // 前端先收尾：把已收到的流式文本落定为 assistant 消息，
      // 因为 host abort 后 onTurnEnd 不会再触发，前端必须自己收束状态。
      const partial = streamingText.value
      if (partial.trim()) {
        stream.value.push({
          kind: "assistant",
          id: `assistant-stopped-${Date.now()}`,
          content: partial,
        })
      }
      streamingText.value = ""
      streamingReasoning.value = ""
      turnPhase.value = "standby"
      turnCount.value += 1
      // 通知 host 中断（abort currentController，停止后续 token/工具执行）
      try {
        await tsian.stop()
      } catch (err) {
        const msg = err && typeof err === "object" && "message" in err
          ? (err as { message: string }).message
          : "停止失败"
        console.error("[useTsian] stop failed:", msg)
      }
    },
    async loadHistory(): Promise<void> {
      // 只首次加载，避免视图切换重复调用覆盖实时 stream（镜像 legacy：reloadHistory 仅重载/回溯后用）
      if (historyLoaded) return
      historyLoaded = true
      await reloadHistory()
    },
    async loadCheckpoints(): Promise<void> {
      checkpoints.value = await tsian.checkpoints.list()
    },
    /** 恢复到指定检查点。host 执行 restore（裁剪 turn 文件 + 删除未来 checkpoint）后，
     *  前端重建 stream + checkpoints + 兜底恢复最后一轮选项。 */
    async restore(checkpointId: string): Promise<void> {
      await tsian.checkpoints.restore(checkpointId)
      await reloadHistory()
      await tsian.checkpoints.list().then((cps) => { checkpoints.value = cps })
    },
  }

  /** 从 workspace turn 文件单源重建对话（首次加载 + restore 回溯后复用）。
   *  绕过 historyLoaded 保护——由调用方决定是否允许重载。 */
  async function reloadHistory(): Promise<void> {
    const h = await tsian.history.get()
    // 从 SessionHistoryEntry.timeline 重建 stream——按原始顺序遍历所有 kind，
    // 一个都不丢（镜像 legacy renderSessionHistory）。
    // 顺序由 timeline 数组保证：user → interim/thought/tool → assistant → options 交织。
    const items: StreamItem[] = []
    for (const entry of h.entries) {
      for (const item of entry.timeline) {
        if (item.kind === "user") {
          items.push({ kind: "user", id: `h-user-${entry.turn}-${items.length}`, content: item.content })
        } else if (item.kind === "assistant") {
          const assistant = createAssistantStreamItem({
            content: item.content,
            ...(item.displayContent !== undefined ? { displayContent: item.displayContent } : {}),
            ...(item.projections ? { projections: item.projections } : {}),
            ...(item.stats ? { stats: item.stats } : {}),
          }, `h-assistant-${entry.turn}-${items.length}`)
          if (assistant) items.push(assistant)
        } else if (item.kind === "interim") {
          items.push({ kind: "interim", id: `h-interim-${entry.turn}-${items.length}`, round: entry.turn, text: item.text, agentId: item.agentId ?? null })
        } else if (item.kind === "thought") {
          items.push({ kind: "thought", id: `h-thought-${entry.turn}-${items.length}`, round: entry.turn, text: item.text, agentId: item.agentId ?? null, collapsed: true })
        } else if (item.kind === "tool") {
          items.push({ kind: "tool", id: `h-tool-${entry.turn}-${items.length}`, round: item.round, name: item.name, status: item.status, agentId: item.agentId ?? "" })
        }
        // options 不进 stream（实时和历史选项统一由 turnOptions 单轮语义管，
        // 见下方兜底恢复最后一轮未选选项）
      }
    }
    stream.value = items
    turnCount.value = h.turn
    // 先清空 turnOptions——restore 回溯后旧轮的未选选项可能残留在 turnOptions 里，
    // 属于被抹除的 turn，必须丢弃。只有当重建后的最后一轮 timeline 里确实持久化
    // 了 options 时，才恢复它们（会话重开场景）。
    turnOptions.value = []
    // 兜底恢复最后一轮未选的选项：会话中途关闭再重开时，玩家尚未选择
    // 的剧情选项应继续显示。新正式 turn 读取 projected assistant；legacy turn
    // 的结构化 options 项仍作为兜底。
    if (h.entries.length > 0) {
      const lastEntry = h.entries[h.entries.length - 1]!
      for (let itemIndex = lastEntry.timeline.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = lastEntry.timeline[itemIndex]!
        if (item.kind === "assistant") {
          const choices = assistantChoices(item)
          if (choices.length > 0) {
            turnOptions.value = choices
          }
          return
        }
        if (item.kind === "options" && item.items.length > 0) {
          turnOptions.value = item.items
          return
        }
      }
    }
  }
}
