/**
 * 流式输出与工具过程事件总线（子2a + 子2b）。
 *
 * 镜像 `debug-events.ts` 的设计，仅服务三类事件：
 *   - `turn-delta`（子2a）：每收到一段流式 text delta，`emitTurnDelta(delta, turn, round)`
 *     把它推给订阅方（remote-iframe-bridge 转发为 `turn-delta` 事件给 play 前端）。
 *   - `turn-round-end`（子2b R1）：每轮结束，`emitTurnRoundEnd(turn, round, kind)`
 *     告知前端本轮属思考流还是最终回复，供前端把 `turn-delta` 文本归类到对应区块。
 *   - `turn-tool`（子2b R2）：工具调用执行前后，`emitTurnTool(turn, round, callId, name, status, output?)`
 *     告知前端工具状态与输出，供前端渲染工具卡片。
 *
 * 设计原则：
 *   - **内部模块、勿扩散**：禁止作为通用事件总线复用；其它跨模块通信应走显式 API
 *   - 监听器集合用 `Set<Listener>` 保证去重，`subscribe` 返回 unsubscribe 闭包
 *   - emit 时浅克隆监听器集合再迭代，避免回调内 unsubscribe 影响本次派发
 *   - 回调异常吞掉但 console.error，避免污染主链 fail loud 路径
 */

export type TurnDeltaListener = (delta: string, turn: number, round: number) => void
export type TurnRoundEndKind = "thought" | "final"
export type TurnRoundEndListener = (turn: number, round: number, kind: TurnRoundEndKind) => void
export type TurnToolStatus = "loading" | "running" | "success" | "failed"
export type TurnToolListener = (
  turn: number,
  round: number,
  callId: string,
  name: string,
  status: TurnToolStatus,
  output?: string,
) => void

const turnDeltaListeners = new Set<TurnDeltaListener>()
const turnRoundEndListeners = new Set<TurnRoundEndListener>()
const turnToolListeners = new Set<TurnToolListener>()

export function subscribeTurnDelta(cb: TurnDeltaListener): () => void {
  turnDeltaListeners.add(cb)
  return () => {
    turnDeltaListeners.delete(cb)
  }
}

export function emitTurnDelta(delta: string, turn: number, round: number): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnDeltaListeners]
  for (const listener of listeners) {
    try {
      listener(delta, turn, round)
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

export function emitTurnRoundEnd(turn: number, round: number, kind: TurnRoundEndKind): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnRoundEndListeners]
  for (const listener of listeners) {
    try {
      listener(turn, round, kind)
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
  turn: number,
  round: number,
  callId: string,
  name: string,
  status: TurnToolStatus,
  output?: string,
): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnToolListeners]
  for (const listener of listeners) {
    try {
      listener(turn, round, callId, name, status, output)
    } catch (err) {
      // 流式通道异常不冒泡到主链
      console.error("[streaming-events] turn-tool listener threw", err)
    }
  }
}
