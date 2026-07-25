// packages/play-bridge/src/bridge.ts
// 协议层实现：桥协议握手 / RPC 传输 / 事件订阅 / 状态暴露。
//
// 表现层不应出现 addEventListener("message") / postMessage 握手 / RPC id 匹配。
// 这些全在 createBridge() 内部。

import type {
  FrontendActionPublicError,
  RemotePlayBridgeChannel,
  RemotePlayBridgeEventName,
  RemotePlayBridgeEventPayload,
  RemotePlayBridgeMethod,
  RemotePlayBridgeRequestParams,
  RemotePlayBridgeResponseError,
  RemotePlayBridgeResponseResult,
} from "@tsian/contracts"

/** 表现层注册的事件处理器集合。 */
export interface BridgeHandlers {
  onReady?: (sessionId: string) => void
  onEvent?: (event: RemotePlayBridgeEventName, payload: RemotePlayBridgeEventPayload) => void
  /** interaction-request 快捷通道：AI 向玩家提问，玩家选择后调 bridge.respondInteraction。 */
  onInteractionRequest?: (
    requestId: string,
    question: string,
    options?: string[],
    allowCustom?: boolean,
  ) => void
  /** legacy turn-options 快捷通道：旧平台可能在 turn 收尾转发选项；新前端不应依赖它。 */
  onTurnOptions?: (turn: number, options: string[]) => void
}

interface BridgeCallOptions {
  signal?: AbortSignal
  onAbort?: () => void
}

/** createBridge() 返回的桥实例。表现层唯一的能力出口。 */
export interface Bridge {
  /** RPC: call(method, params) → Promise<T>。 */
  call<T = RemotePlayBridgeResponseResult>(
    method: RemotePlayBridgeMethod,
    params?: RemotePlayBridgeRequestParams,
    options?: BridgeCallOptions,
  ): Promise<T>
  /** 注册事件处理器。重复调用以最后一次为准（与原 setEventHandlers 一致）。 */
  on(handlers: BridgeHandlers): void
  /** 回答 ask_user 提问。封装 interaction.respond RPC。 */
  respondInteraction(requestId: string, answer: string, cancelled?: boolean): Promise<void>
  /** 中断当前正在进行的 turn（流式输出/工具执行）。封装 interaction.stop RPC。 */
  stopInteraction(): Promise<void>
  /** 桥握手是否完成。 */
  readonly ready: boolean
  /** 当前 sessionId（握手后可用，握手前为 null）。 */
  readonly sessionId: string | null
}

const CHANNEL: RemotePlayBridgeChannel = "tsian.play-bridge.v1"

interface PendingRequest {
  sessionId: string
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  cleanup: () => void
}

function sessionReplacedError(): FrontendActionPublicError {
  return {
    kind: "runtime",
    code: "FRONTEND_ACTION_SESSION_REPLACED",
    message: "The play bridge session was replaced.",
  }
}

function bridgeNotReadyError(): RemotePlayBridgeResponseError {
  return {
    code: "REMOTE_BRIDGE_NOT_READY",
    message: "The play bridge handshake is not complete.",
  }
}

function defaultAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("The operation was aborted.", "AbortError")
  }
  const error = new Error("The operation was aborted.")
  error.name = "AbortError"
  return error
}

/**
 * 创建桥实例。内部自动完成 hello 握手 + message 路由。
 * 表现层只用返回的 Bridge 与平台交互。
 */
export function createBridge(): Bridge {
  let sessionId: string | null = null
  let acceptedParentOrigin: string | null = null
  let nextReqId = 1
  const pending = new Map<string, PendingRequest>()
  let bridgeReady = false

  // 协议层对外回调（表现层通过 on() 注册）
  const handlers: BridgeHandlers = {
    onReady: undefined,
    onEvent: undefined,
    onInteractionRequest: undefined,
    onTurnOptions: undefined,
  }

  function targetParentOrigin(): string {
    return acceptedParentOrigin && acceptedParentOrigin !== "null"
      ? acceptedParentOrigin
      : "*"
  }

  function settlePending(
    id: string,
    settle: (request: PendingRequest) => void,
  ): void {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    request.cleanup()
    settle(request)
  }

  function rejectSessionRequests(replacedSessionId: string): void {
    for (const [id, request] of pending) {
      if (request.sessionId !== replacedSessionId) continue
      settlePending(id, (entry) => entry.reject(sessionReplacedError()))
    }
  }

  // RPC: call(method, params) → Promise。每个请求绑定发送时已接受的 session。
  function call<T = RemotePlayBridgeResponseResult>(
    method: RemotePlayBridgeMethod,
    params?: RemotePlayBridgeRequestParams,
    options?: BridgeCallOptions,
  ): Promise<T> {
    const requestSessionId = sessionId
    if (!bridgeReady || !requestSessionId) {
      return Promise.reject(bridgeNotReadyError())
    }
    if (options?.signal?.aborted) {
      return Promise.reject(defaultAbortError())
    }

    const id = String(nextReqId++)
    return new Promise<T>((resolve, reject) => {
      const signal = options?.signal
      const onAbort = () => {
        try {
          options?.onAbort?.()
        } catch {
          // The host response remains authoritative for the abort/commit race.
        }
      }
      const cleanup = () => signal?.removeEventListener("abort", onAbort)

      pending.set(id, {
        sessionId: requestSessionId,
        resolve: resolve as (value: unknown) => void,
        reject,
        cleanup,
      })
      signal?.addEventListener("abort", onAbort, { once: true })

      try {
        window.parent.postMessage(
          {
            channel: CHANNEL,
            kind: "request",
            sessionId: requestSessionId,
            id,
            method,
            params,
          },
          targetParentOrigin(),
        )
      } catch (error) {
        settlePending(id, (request) => request.reject(error))
      }
    })
  }

  // message 路由：按 kind 分发（协议层独占 addEventListener message）
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window.parent) return

    const msg = event.data as
      | {
          channel?: string
          kind?: string
          sessionId?: string
          id?: string
          ok?: boolean
          result?: unknown
          error?: RemotePlayBridgeResponseError
          event?: RemotePlayBridgeEventName
          payload?: RemotePlayBridgeEventPayload
        }
      | null
    if (!msg || msg.channel !== CHANNEL) return
    if (acceptedParentOrigin !== null && event.origin !== acceptedParentOrigin) return

    if (msg.kind === "ready") {
      if (typeof msg.sessionId !== "string" || !msg.sessionId) return

      if (acceptedParentOrigin === null) {
        acceptedParentOrigin = event.origin
      }
      const previousSessionId = sessionId
      if (previousSessionId && previousSessionId !== msg.sessionId) {
        sessionId = null
        bridgeReady = false
        rejectSessionRequests(previousSessionId)
      }
      sessionId = msg.sessionId
      bridgeReady = true
      handlers.onReady?.(msg.sessionId)
      return
    }

    if (!bridgeReady || !sessionId || msg.sessionId !== sessionId) return

    if (msg.kind === "response") {
      const id = msg.id ?? ""
      const request = pending.get(id)
      if (!request || request.sessionId !== msg.sessionId) return
      settlePending(id, (entry) => {
        if (msg.ok) entry.resolve(msg.result)
        else entry.reject(msg.error)
      })
      return
    }

    if (msg.kind === "event") {
      // interaction-request 快捷通道：AI 向玩家提问
      if (msg.event === "interaction-request" && msg.payload) {
        const payload = msg.payload as {
          requestId?: string
          question?: string
          options?: string[]
          allowCustom?: boolean
        }
        if (payload.requestId && payload.question) {
          handlers.onInteractionRequest?.(
            payload.requestId,
            payload.question,
            payload.options,
            payload.allowCustom,
          )
        }
      }
      // legacy turn-options 快捷通道（新正式 turn 不保证发出）
      if (msg.event === "turn-options" && msg.payload) {
        const payload = msg.payload as { turn?: number; options?: string[] }
        if (typeof payload.turn === "number" && Array.isArray(payload.options)) {
          handlers.onTurnOptions?.(payload.turn, payload.options)
        }
      }
      if (msg.event) {
        handlers.onEvent?.(
          msg.event,
          msg.payload as RemotePlayBridgeEventPayload,
        )
      }
    }
  })

  // 启动握手：首次 ready 前无法安全知道 parent origin，只能使用通配 target。
  window.parent.postMessage({ channel: CHANNEL, kind: "hello" }, "*")

  /** 回答 ask_user 提问。封装 interaction.respond RPC。 */
  function respondInteraction(
    requestId: string,
    answer: string,
    cancelled?: boolean,
  ): Promise<void> {
    return call("interaction.respond", {
      requestId,
      answer,
      ...(cancelled !== undefined ? { cancelled } : {}),
    }).then(() => undefined)
  }

  /** 中断当前正在进行的 turn（流式输出/工具执行）。封装 interaction.stop RPC。 */
  function stopInteraction(): Promise<void> {
    return call("interaction.stop").then(() => undefined)
  }

  return {
    call,
    respondInteraction,
    stopInteraction,
    on(nextHandlers: BridgeHandlers) {
      handlers.onReady = nextHandlers.onReady
      handlers.onEvent = nextHandlers.onEvent
      handlers.onInteractionRequest = nextHandlers.onInteractionRequest
      handlers.onTurnOptions = nextHandlers.onTurnOptions
    },
    get ready() {
      return bridgeReady
    },
    get sessionId() {
      return sessionId
    },
  }
}
