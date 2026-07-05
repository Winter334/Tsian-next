/**
 * composables/useRuntimeStaleBus.ts — 轻量 runtimeStale 事件总线。
 *
 * 设计决策 D4/D5：刷新走轻量事件总线。本任务只提供总线 API，不挂任何 emit 点
 * （D5：未来 UI 子任务在主动操作完成后按需 emitRuntimeStale()）。
 *
 * 实现：模块级 Set 订阅者集合 + emitRuntimeStale/onRuntimeStale。
 * 不引入通用 EventBus 类（沿用 state-management 规范：模块级 emit/guard 函数）。
 * callback 异常 try-catch + console.error，不传播（避免一个订阅者抛错阻断其他订阅者）。
 */

const subscribers = new Set<() => void>()

/**
 * 触发 runtimeStale 事件，通知所有订阅者刷新 runtime。
 * 任何主动操作完成后调此即可触发刷新（未来 UI 子任务按需调用）。
 */
export function emitRuntimeStale(): void {
  for (const cb of subscribers) {
    try {
      cb()
    } catch (err) {
      console.error("[runtimeStaleBus] subscriber threw", err)
    }
  }
}

/**
 * 订阅 runtimeStale 事件。返回取消订阅函数。
 * useRuntime 内部调此注册 refresh，外部一般不需要直接订阅。
 */
export function onRuntimeStale(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}
