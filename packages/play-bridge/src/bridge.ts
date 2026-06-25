// packages/play-bridge/src/bridge.ts
// 协议层实现：桥协议握手 / RPC 传输 / 事件订阅 / 状态暴露。
//
// 从 default-frontend-files.ts app.js inline 协议层（L314-369）机械移植为 TS。
// 逻辑逐行等价，仅做：闭包封装 + 类型标注 + 泛型 call<T>。
//
// 红线（docs/active/play-frontend-sdk-direction.md §3.1）：
// 表现层不应出现 addEventListener("message") / postMessage 握手 / RPC id 匹配。
// 这些全在 createBridge() 内部。

import type {
  RemotePlayBridgeChannel,
  RemotePlayBridgeMethod,
  RemotePlayBridgeRequestParams,
  RemotePlayBridgeResponseResult,
  RemotePlayBridgeError,
  RemotePlayBridgeEventName,
  RemotePlayBridgeEventPayload,
  RuntimeSnapshotShell,
} from "@tsian/contracts"

/** 表现层注册的事件处理器集合。 */
export interface BridgeHandlers {
  onReady?: (sessionId: string) => void
  onEvent?: (event: RemotePlayBridgeEventName, payload: RemotePlayBridgeEventPayload) => void
  /** turn-completed.snapshot 的快捷通道，在 onEvent 之前触发。 */
  onSnapshot?: (snapshot: RuntimeSnapshotShell) => void
}

/** createBridge() 返回的桥实例。表现层唯一的能力出口。 */
export interface Bridge {
  /** RPC: call(method, params) → Promise<T>。 */
  call<T = RemotePlayBridgeResponseResult>(
    method: RemotePlayBridgeMethod,
    params?: RemotePlayBridgeRequestParams,
  ): Promise<T>
  /** 注册事件处理器。重复调用以最后一次为准（与原 setEventHandlers 一致）。 */
  on(handlers: BridgeHandlers): void
  /** 桥握手是否完成。 */
  readonly ready: boolean
  /** 当前 sessionId（握手后可用，握手前为 null）。 */
  readonly sessionId: string | null
}

const CHANNEL: RemotePlayBridgeChannel = "tsian.play-bridge.v1"

/**
 * 创建桥实例。内部自动完成 hello 握手 + message 路由。
 * 表现层只用返回的 Bridge 与平台交互。
 */
export function createBridge(): Bridge {
  let sessionId: string | null = null
  let nextReqId = 1
  const pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
  >()
  let bridgeReady = false

  // 协议层对外回调（表现层通过 on() 注册）
  const handlers: BridgeHandlers = { onReady: undefined, onEvent: undefined, onSnapshot: undefined }

  // RPC: call(method, params) → Promise。表现层只用这个调平台能力。
  function call<T = RemotePlayBridgeResponseResult>(
    method: RemotePlayBridgeMethod,
    params?: RemotePlayBridgeRequestParams,
  ): Promise<T> {
    const id = String(nextReqId++)
    return new Promise<T>((resolve, reject) => {
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject: reject as (reason: unknown) => void,
      })
      window.parent.postMessage(
        {
          channel: CHANNEL,
          kind: "request",
          sessionId,
          id,
          method,
          params,
        },
        "*",
      )
    })
  }

  // message 路由：按 kind 分发（协议层独占 addEventListener message）
  window.addEventListener("message", (e: MessageEvent) => {
    const msg = e.data as
      | {
          channel?: string
          kind?: string
          sessionId?: string
          id?: string
          ok?: boolean
          result?: unknown
          error?: RemotePlayBridgeError
          event?: RemotePlayBridgeEventName
          payload?: RemotePlayBridgeEventPayload
        }
      | null
    if (!msg || msg.channel !== CHANNEL) return

    if (msg.kind === "ready") {
      sessionId = msg.sessionId ?? null
      bridgeReady = true
      handlers.onReady?.(sessionId ?? "")
      return
    }
    if (msg.kind === "response") {
      const cb = pending.get(msg.id ?? "")
      if (!cb) return
      pending.delete(msg.id ?? "")
      if (msg.ok) cb.resolve(msg.result)
      else cb.reject(msg.error)
      return
    }
    if (msg.kind === "event") {
      // turn-completed 的 payload.snapshot 触发覆盖渲染（§4 红线）
      if (msg.event === "turn-completed" && msg.payload) {
        const snapshot = (msg.payload as { snapshot?: RuntimeSnapshotShell }).snapshot
        if (snapshot) handlers.onSnapshot?.(snapshot)
      }
      handlers.onEvent?.(msg.event as RemotePlayBridgeEventName, msg.payload as RemotePlayBridgeEventPayload)
      return
    }
  })

  // 启动握手：发 hello 给父窗口
  window.parent.postMessage({ channel: CHANNEL, kind: "hello" }, "*")

  return {
    call,
    on(h: BridgeHandlers) {
      handlers.onReady = h.onReady
      handlers.onEvent = h.onEvent
      handlers.onSnapshot = h.onSnapshot
    },
    get ready() {
      return bridgeReady
    },
    get sessionId() {
      return sessionId
    },
  }
}
