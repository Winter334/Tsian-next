/**
 * 流式输出与工具过程事件总线（子2a + 子2b + agent-call-concurrency）。
 *
 * 镜像 `debug-events.ts` 的设计，仅服务三类事件，每个事件首参 `agentId` 标明来源
 * agent（entry agent "master" 或 delegated agent_call 目标 id），让订阅方区分并行
 * 多子代理的事件来源：
 *   - `turn-delta`（子2a）：每收到一段流式 text delta，`emitTurnDelta(agentId, delta, turn, round, kind)`
 *     把它推给订阅方（remote-iframe-bridge 转发为 `turn-delta` 事件给 play 前端）。`kind`
 *     区分链式推理（`reasoning`）与可见回复（`content`），供前端分别渲染到「思考」与正文区。
 *   - `turn-round-end`（子2b R1）：每轮结束，`emitTurnRoundEnd(agentId, turn, round, kind)`
 *     告知前端本轮属思考流还是最终回复，供前端把 `turn-delta` 文本归类到对应区块。
 *   - `turn-tool`（子2b R2）：工具调用执行前后发送状态与可选 presentation。
 *
 * 设计原则：
 *   - **内部模块、勿扩散**：禁止作为通用事件总线复用；其它跨模块通信应走显式 API
 *   - 监听器集合用 `Set<Listener>` 保证去重，`subscribe` 返回 unsubscribe 闭包
 *   - emit 时浅克隆监听器集合再迭代，避免回调内 unsubscribe 影响本次派发
 *   - 回调异常吞掉但 console.error，避免污染主链 fail loud 路径
 */

import type { AgentInvocationEvent, TurnStats, UiToolPresentation } from "@tsian/contracts"

export type TurnDeltaKind = "reasoning" | "content"
export type TurnDeltaListener = (agentId: string, delta: string, turn: number, round: number, kind: TurnDeltaKind) => void
export type TurnRoundEndKind = "thought" | "final"
export type TurnRoundEndListener = (agentId: string, turn: number, round: number, kind: TurnRoundEndKind) => void
export type TurnToolStatus = "loading" | "running" | "success" | "failed"
export type TurnToolListener = (
  agentId: string,
  turn: number,
  round: number,
  callId: string,
  name: string,
  status: TurnToolStatus,
  presentation?: UiToolPresentation,
  displayName?: string,
) => void
export type TurnOptionsListener = (turn: number, options: string[]) => void
export type TurnStatsListener = (turn: number, stats: TurnStats) => void

const turnDeltaListeners = new Set<TurnDeltaListener>()
const turnRoundEndListeners = new Set<TurnRoundEndListener>()
const turnToolListeners = new Set<TurnToolListener>()
const turnOptionsListeners = new Set<TurnOptionsListener>()
const turnStatsListeners = new Set<TurnStatsListener>()

export function subscribeTurnDelta(cb: TurnDeltaListener): () => void {
  turnDeltaListeners.add(cb)
  return () => {
    turnDeltaListeners.delete(cb)
  }
}

export function emitTurnDelta(agentId: string, delta: string, turn: number, round: number, kind: TurnDeltaKind): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnDeltaListeners]
  for (const listener of listeners) {
    try {
      listener(agentId, delta, turn, round, kind)
    } catch (err) {
      // 流式通道异常不冒泡到主链
      console.error("[streaming-events] turn-delta listener threw", err)
    }
  }
}

export function subscribeTurnRoundEnd(cb: TurnRoundEndListener): () => void {
  turnRoundEndListeners.add(cb)
  return () => {
    turnRoundEndListeners.delete(cb)
  }
}

export function emitTurnRoundEnd(agentId: string, turn: number, round: number, kind: TurnRoundEndKind): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnRoundEndListeners]
  for (const listener of listeners) {
    try {
      listener(agentId, turn, round, kind)
    } catch (err) {
      // 流式通道异常不冒泡到主链
      console.error("[streaming-events] turn-round-end listener threw", err)
    }
  }
}

export function subscribeTurnTool(cb: TurnToolListener): () => void {
  turnToolListeners.add(cb)
  return () => {
    turnToolListeners.delete(cb)
  }
}

export function emitTurnTool(
  agentId: string,
  turn: number,
  round: number,
  callId: string,
  name: string,
  status: TurnToolStatus,
  presentation?: UiToolPresentation,
  displayName?: string,
): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnToolListeners]
  for (const listener of listeners) {
    try {
      listener(agentId, turn, round, callId, name, status, presentation, displayName)
    } catch (err) {
      // 流式通道异常不冒泡到主链
      console.error("[streaming-events] turn-tool listener threw", err)
    }
  }
}

export function subscribeTurnOptions(cb: TurnOptionsListener): () => void {
  turnOptionsListeners.add(cb)
  return () => {
    turnOptionsListeners.delete(cb)
  }
}

/**
 * legacy emit turn-options:保留给旧平台/旧前端兼容。新正式 turn 不再由
 * platform-host 解析玩法选项并 emit；默认前端自行解析其支持的游戏卡输出约定。
 */
export function emitTurnOptions(turn: number, options: string[]): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnOptionsListeners]
  for (const listener of listeners) {
    try {
      listener(turn, options)
    } catch (err) {
      // 流式通道异常不冒泡到主链
      console.error("[streaming-events] turn-options listener threw", err)
    }
  }
}

export function subscribeTurnStats(cb: TurnStatsListener): () => void {
  turnStatsListeners.add(cb)
  return () => {
    turnStatsListeners.delete(cb)
  }
}

/** emit turn-stats:turn 收尾时把本轮耗时 + token usage 通知前端,
 *  供正文末尾显示 meta 行。与 turn-delta/turn-tool 同总线,remote-iframe-bridge
 *  转发为 `turn-stats` 事件。 */
export function emitTurnStats(turn: number, stats: TurnStats): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnStatsListeners]
  for (const listener of listeners) {
    try {
      listener(turn, stats)
    } catch (err) {
      // 流式通道异常不冒泡到主链
      console.error("[streaming-events] turn-stats listener threw", err)
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// agent-invocation: invokeAgent 过程事件通道
// ═══════════════════════════════════════════════════════════════
// 专用于前端发起的 invokeAgent 调用。invocationId 区分并发调用；
// agentId 表示实际产出事件的 agent（包含 delegated agent_call 目标）。
export type AgentInvocationListener = (event: AgentInvocationEvent) => void

const agentInvocationListeners = new Set<AgentInvocationListener>()

export function subscribeAgentInvocation(cb: AgentInvocationListener): () => void {
  agentInvocationListeners.add(cb)
  return () => {
    agentInvocationListeners.delete(cb)
  }
}

export function emitAgentInvocation(event: AgentInvocationEvent): void {
  const listeners = [...agentInvocationListeners]
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.error("[streaming-events] agent-invocation listener threw", err)
    }
  }
}
