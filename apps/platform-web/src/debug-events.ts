/**
 * 调试事件总线（B3 / D5）。
 *
 * 仅服务 `bridge.debug` 的 `onTurnDebugReady` 钩子：每轮 patch 应用成功后
 * `emitTurnDebugReady(turn)`，订阅方收到 turn 编号即可去重读最新 debug 数据。
 *
 * 设计原则：
 *   - **内部模块、勿扩散**：禁止作为通用事件总线复用；其它跨模块通信应走显式 API
 *   - 监听器集合用 `Set<Listener>` 保证去重，`subscribe` 返回 unsubscribe 闭包
 *   - emit 时浅克隆监听器集合再迭代，避免回调内 unsubscribe 影响本次派发
 *   - 回调异常吞掉但 console.error，避免污染主链 fail loud 路径
 */

export type TurnDebugReadyListener = (turn: number) => void

const turnDebugReadyListeners = new Set<TurnDebugReadyListener>()

export function subscribeTurnDebugReady(cb: TurnDebugReadyListener): () => void {
  turnDebugReadyListeners.add(cb)
  return () => {
    turnDebugReadyListeners.delete(cb)
  }
}

export function emitTurnDebugReady(turn: number): void {
  // 浅克隆：回调内 unsubscribe 不影响本轮派发
  const listeners = [...turnDebugReadyListeners]
  for (const listener of listeners) {
    try {
      listener(turn)
    } catch (err) {
      // 调试通道异常不冒泡到主链
      console.error("[debug-events] onTurnDebugReady listener threw", err)
    }
  }
}
