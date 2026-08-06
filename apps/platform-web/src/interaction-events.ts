/**
 * 玩家交互请求事件总线（ask_user）。
 *
 * 服务 ask_user 工具的"AI 提问 → 玩家回答"双向交互：
 *   - `emitInteractionRequest(requestId, question, options, allowCustom)` 推送给订阅方
 *     （remote-iframe-bridge 转发为 `interaction-request` 事件给 play 前端），返回 Promise
 *     在玩家回答后 resolve。
 *   - `resolveInteractionRequest(requestId, answer)` 由前端 RPC `interaction.respond` 触发，
 *     resolve 对应等待中的 Promise。
 *   - `rejectInteractionRequest(requestId, reason)` abort/断开时调用，reject 等待表。
 *
 * 设计原则（镜像 debug-events / streaming-events）：
 *   - **内部模块、勿扩散**：禁止作为通用事件总线复用
 *   - 监听器集合用 `Set<Listener>` 保证去重，`subscribe` 返回 unsubscribe 闭包
 *   - emit 时浅克隆监听器集合再迭代，避免回调内 unsubscribe 影响本次派发
 *   - 回调异常吞掉但 console.error，避免污染主链 fail loud 路径
 *   - 等待表 `Map<requestId, {resolve, reject}>` 关联 emit 与 resolve/reject
 */

import type { AskUserResult } from "@tsian/contracts"

export type InteractionRequestListener = (
  requestId: string,
  question: string,
  options: string[] | undefined,
  allowCustom: boolean | undefined,
) => void

const interactionRequestListeners = new Set<InteractionRequestListener>()

/** 等待表：requestId → pending Promise 的 resolve/reject。 */
const pendingRequests = new Map<
  string,
  {
    resolve: (result: AskUserResult) => void
    reject: (reason: unknown) => void
    cleanup: () => void
  }
>()

export function subscribeInteractionRequest(cb: InteractionRequestListener): () => void {
  interactionRequestListeners.add(cb)
  return () => {
    interactionRequestListeners.delete(cb)
  }
}

/**
 * 推送交互请求给订阅方，返回 Promise 在玩家回答后 resolve。
 * 订阅方（remote-iframe-bridge）负责把请求转发给前端 iframe。
 */
export function emitInteractionRequest(
  requestId: string,
  question: string,
  options: string[] | undefined,
  allowCustom: boolean | undefined,
  signal?: AbortSignal,
): Promise<AskUserResult> {
  return new Promise<AskUserResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Interaction request aborted.", "AbortError"))
      return
    }
    const onAbort = () => {
      rejectInteractionRequest(
        requestId,
        signal?.reason ?? new DOMException("Interaction request aborted.", "AbortError"),
      )
    }
    const cleanup = () => signal?.removeEventListener("abort", onAbort)
    signal?.addEventListener("abort", onAbort, { once: true })
    pendingRequests.set(requestId, { resolve, reject, cleanup })
    const listeners = [...interactionRequestListeners]
    for (const listener of listeners) {
      try {
        listener(requestId, question, options, allowCustom)
      } catch (err) {
        console.error("[interaction-events] listener threw", err)
      }
    }
  })
}

/** 前端 RPC interaction.respond 回填答案。 */
export function resolveInteractionRequest(
  requestId: string,
  answer: string,
  cancelled?: boolean,
): boolean {
  const pending = pendingRequests.get(requestId)
  if (!pending) return false
  pendingRequests.delete(requestId)
  pending.cleanup()
  pending.resolve({
    answer,
    ...(cancelled !== undefined ? { cancelled } : {}),
  })
  return true
}

/** abort/断开时 reject 等待表。 */
export function rejectInteractionRequest(requestId: string, reason: unknown): boolean {
  const pending = pendingRequests.get(requestId)
  if (!pending) return false
  pendingRequests.delete(requestId)
  pending.cleanup()
  pending.reject(reason)
  return true
}

/** reject 所有等待中的请求（turn abort 时批量清理）。 */
export function rejectAllInteractionRequests(reason: unknown): void {
  for (const [, pending] of pendingRequests) {
    pending.cleanup()
    pending.reject(reason)
  }
  pendingRequests.clear()
}

/** Owns only the interaction requests created by one concurrent runtime turn. */
export function createInteractionRequestScope(signal?: AbortSignal): {
  emit(
    requestId: string,
    question: string,
    options: string[] | undefined,
    allowCustom: boolean | undefined,
  ): Promise<AskUserResult>
  rejectAll(reason: unknown): void
} {
  const requestIds = new Set<string>()
  return {
    emit(requestId, question, options, allowCustom) {
      requestIds.add(requestId)
      return emitInteractionRequest(
        requestId,
        question,
        options,
        allowCustom,
        signal,
      ).finally(() => requestIds.delete(requestId))
    },
    rejectAll(reason) {
      for (const requestId of requestIds) {
        rejectInteractionRequest(requestId, reason)
      }
      requestIds.clear()
    },
  }
}
