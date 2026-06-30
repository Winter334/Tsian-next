import { reactive, ref, readonly, onUnmounted } from "vue"
import { createTsian } from "@tsian/play-bridge"
import type {
  TsianApi,
  MessageDelta,
  RoundEnd,
  TurnEndResult,
  ToolEvent,
} from "@tsian/play-bridge"
import type { TurnPhase, TurnState, ProcessNode } from "../types"

/**
 * useTsian — 单例 TsianApi + 5 订阅映射到响应式状态。
 *
 * design §3：所有组件通过此 composable 访问 bridge，不直接 import play-bridge 实例。
 * 封装 createTsian() 单例，5 订阅回调（onMessage/onRoundEnd/onTurnEnd/onTool/onAsk）
 * 映射到响应式状态（ready/sessionId/turnPhase/history/checkpoints/workspace）。
 *
 * 轮次状态机（TurnPhase）：
 * - idle：等待用户输入
 * - streaming：助手回复中（onMessage 流入 streamingText/reasoning）
 * - standby：轮次结束（onTurnEnd），待下一轮
 *
 * 多组件共享同一单例 tsian + 同一响应式状态（模块级单例，非每次调用新建）。
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
const history = ref<import("@tsian/play-bridge").SessionHistoryEntry[]>([])
const checkpoints = ref<import("@tsian/contracts").CheckpointSummary[]>([])

// 当前轮次状态（流式累积）
const currentTurn = reactive<TurnState>({
  timeline: [],
  streamingText: "",
  streamingReasoning: "",
  content: "",
})

// 订阅是否已注册（只注册一次，避免多组件重复订阅）
let subscribed = false
const unsubscribers: Array<() => void> = []

function subscribe(): void {
  if (subscribed) return
  const tsian = getTsian()
  subscribed = true

  unsubscribers.push(
    tsian.onMessage((msg: MessageDelta) => {
      turnPhase.value = "streaming"
      if (msg.kind === "content") {
        currentTurn.streamingText += msg.delta
      } else {
        currentTurn.streamingReasoning += msg.delta
      }
    }),
  )

  unsubscribers.push(
    tsian.onRoundEnd((end: RoundEnd) => {
      // 中间轮（thought）的 content 是 interim，归入时间线
      if (end.kind === "thought") {
        currentTurn.timeline.push({
          type: "interim",
          id: `interim-${end.round}-${Date.now()}`,
          round: end.round,
          collapsed: true,
          agentId: end.agentId,
          text: currentTurn.streamingText,
        })
        currentTurn.streamingText = ""
        currentTurn.streamingReasoning = ""
      }
      // final：保留 streamingText，onTurnEnd 时落定
    }),
  )

  unsubscribers.push(
    tsian.onTool((tool: ToolEvent) => {
      const existing = currentTurn.timeline.find(
        (n) => n.type === "tool" && n.id === tool.callId,
      )
      if (existing) {
        existing.status = tool.status
      } else {
        const node: ProcessNode = {
          type: "tool",
          id: tool.callId,
          round: tool.round,
          name: tool.name,
          status: tool.status,
          collapsed: true,
          agentId: tool.agentId,
        }
        currentTurn.timeline.push(node)
      }
    }),
  )

  unsubscribers.push(
    tsian.onTurnEnd((_result: TurnEndResult) => {
      currentTurn.content = currentTurn.streamingText
      currentTurn.streamingText = ""
      currentTurn.streamingReasoning = ""
      if (_result.stats) {
        currentTurn.stats = {
          elapsedMs: _result.stats.elapsedMs,
          tokens: _result.stats.totalTokens,
        }
      }
      turnPhase.value = "standby"
      turnCount.value += 1
    }),
  )

  // onAsk 本任务不实现 ask_user 面板（R4），仅占位
  unsubscribers.push(getTsian().onAsk(() => {}))
}

/**
 * useTsian — 在组件中调用，返回响应式 bridge 状态 + 操作方法。
 * 自动在挂载时注册订阅（多次调用安全，单例共享）。
 */
export function useTsian() {
  const tsian = getTsian()

  // 组件挂载时确保订阅已注册 + 等 ready
  // （subscribe 是模块级幂等，多组件安全）
  subscribe()

  onUnmounted(() => {
    // 不在组件卸载时取消订阅：状态是模块级共享的，组件卸载不应清空状态。
    // 真正清理在 app 卸载时（一般不需要）。
  })

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

  return {
    // 响应式状态（只读视图）
    ready: readonly(ready),
    sessionId: readonly(sessionId),
    turnPhase: readonly(turnPhase),
    turnCount: readonly(turnCount),
    currentTurn,
    history: readonly(history),
    checkpoints: readonly(checkpoints),

    // 操作方法
    tsian,
    async send(text: string): Promise<void> {
      if (!tsian.ready || turnPhase.value === "streaming") return
      // 新轮次重置
      currentTurn.timeline = []
      currentTurn.streamingText = ""
      currentTurn.streamingReasoning = ""
      currentTurn.content = ""
      currentTurn.stats = undefined
      turnPhase.value = "streaming"
      await tsian.send(text)
    },
    async loadHistory(): Promise<void> {
      const h = await tsian.history.get()
      history.value = h.entries
      turnCount.value = h.turn
    },
    async loadCheckpoints(): Promise<void> {
      checkpoints.value = await tsian.checkpoints.list()
    },
  }
}
