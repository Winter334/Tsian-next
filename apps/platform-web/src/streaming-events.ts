/**
 * 流式输出事件总线（子2a）。
 *
 * 镜像 `debug-events.ts` 的设计：仅服务 `turn-delta` 事件——每收到一段流式
 * text delta，`emitTurnDelta(delta, turn, round)` 把它推给订阅方（remote-iframe-bridge
 * 转发为 `turn-delta` 事件给 play 前端）。
 *
 * 设计原则：
 *   - **内部模块、勿扩散**：禁止作为通用事件总线复用；其它跨模块通信应走显式 API
 *   - 监听器集合用 `Set<Listener>` 保证去重，`subscribe` 返回 unsubscribe 闭包
 *   - emit 时浅克隆监听器集合再迭代，避免回调内 unsubscribe 影响本次派发
 *   - 回调异常吞掉但 console.error，避免污染主链 fail loud 路径
 */

export type TurnDeltaListener = (delta: string, turn: number, round: number) => void

const turnDeltaListeners = new Set<TurnDeltaListener>()

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
