import type {
  DeepQueryRequest,
  JsonValue,
  MessageInteractionRequest,
  PlatformActionRequest,
  PlayFrontendBridge,
  RemotePlayBridgeChannel,
  RemotePlayBridgeError,
  RemotePlayBridgeEventMessage,
  RemotePlayBridgeMethod,
  RemotePlayBridgeReadyMessage,
  RemotePlayBridgeResponseMessage,
} from "@tsian/contracts"

const REMOTE_PLAY_BRIDGE_CHANNEL: RemotePlayBridgeChannel = "tsian.play-bridge.v1"
const REMOTE_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms"
const ALLOWED_REMOTE_FRONTEND_PROTOCOLS = new Set(["http:", "https:"])
const REMOTE_PLAY_BRIDGE_METHODS: RemotePlayBridgeMethod[] = [
  "runtime.getRuntimeSnapshot",
  "interaction.sendMessage",
  "query.query",
  "platform.getPlatformContext",
  "platform.runAction",
]
const REMOTE_PLAY_BRIDGE_METHOD_SET = new Set<RemotePlayBridgeMethod>(
  REMOTE_PLAY_BRIDGE_METHODS,
)

export type RemoteFrontendUrlResolution =
  | {
      ok: true
      url: string
    }
  | {
      ok: false
      error: {
        code: string
        message: string
      }
    }

export interface MountRemoteIframeFrontendOptions {
  url: string
  bridge: PlayFrontendBridge
  sandbox?: string
  title?: string
  onLoad?: () => void
  onError?: (message: string) => void
  onBridgeReady?: () => void
}

class RemoteBridgeRpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, JsonValue>,
  ) {
    super(message)
    this.name = "RemoteBridgeRpcError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRemoteBridgeMethod(value: unknown): value is RemotePlayBridgeMethod {
  return typeof value === "string"
    && REMOTE_PLAY_BRIDGE_METHOD_SET.has(value as RemotePlayBridgeMethod)
}

function createSessionId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function requireRecordParams(
  value: unknown,
  code: string,
  message: string,
): Record<string, unknown> {
  if (isRecord(value)) {
    return value
  }

  throw new RemoteBridgeRpcError(code, message)
}

function optionalRecordParams(
  value: unknown,
  code: string,
  message: string,
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (isRecord(value)) {
    return value
  }

  throw new RemoteBridgeRpcError(code, message)
}

function normalizeMessageInteractionRequest(value: unknown): MessageInteractionRequest {
  const record = requireRecordParams(
    value,
    "INVALID_INTERACTION_REQUEST",
    "interaction.sendMessage requires an object payload.",
  )
  if (typeof record.content !== "string") {
    throw new RemoteBridgeRpcError(
      "INVALID_INTERACTION_CONTENT",
      "interaction.sendMessage requires string content.",
    )
  }

  return { content: record.content }
}

function normalizeDeepQueryRequest(value: unknown): DeepQueryRequest {
  const record = requireRecordParams(
    value,
    "INVALID_QUERY_REQUEST",
    "query.query requires an object payload.",
  )
  const resource = typeof record.resource === "string" ? record.resource.trim() : ""
  if (!resource) {
    throw new RemoteBridgeRpcError(
      "INVALID_QUERY_RESOURCE",
      "query.query requires a non-empty resource.",
    )
  }
  if (resource === "ai-debug") {
    throw new RemoteBridgeRpcError(
      "REMOTE_RESOURCE_FORBIDDEN",
      "Raw AI debug records are not exposed to remote game frontends.",
      { resource },
    )
  }

  return {
    resource,
    params: optionalRecordParams(
      record.params,
      "INVALID_QUERY_PARAMS",
      "query.query params must be an object when provided.",
    ),
  }
}

function normalizePlatformActionRequest(value: unknown): PlatformActionRequest {
  const record = requireRecordParams(
    value,
    "INVALID_PLATFORM_ACTION_REQUEST",
    "platform.runAction requires an object payload.",
  )
  const action = typeof record.action === "string" ? record.action.trim() : ""
  if (!action) {
    throw new RemoteBridgeRpcError(
      "INVALID_PLATFORM_ACTION",
      "platform.runAction requires a non-empty action.",
    )
  }

  return {
    action,
    params: optionalRecordParams(
      record.params,
      "INVALID_PLATFORM_ACTION_PARAMS",
      "platform.runAction params must be an object when provided.",
    ),
  }
}

function toBridgeError(error: unknown): RemotePlayBridgeError {
  if (error instanceof RemoteBridgeRpcError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    }
  }

  return {
    code: "REMOTE_BRIDGE_CALL_FAILED",
    message: error instanceof Error ? error.message : "Remote bridge call failed.",
  }
}

function dispatchRemoteBridgeRequest(
  bridge: PlayFrontendBridge,
  method: RemotePlayBridgeMethod,
  params: unknown,
) {
  if (method === "runtime.getRuntimeSnapshot") {
    return bridge.runtime.getRuntimeSnapshot()
  }

  if (method === "interaction.sendMessage") {
    return bridge.interaction.sendMessage(normalizeMessageInteractionRequest(params))
  }

  if (method === "query.query") {
    return bridge.query.query(normalizeDeepQueryRequest(params))
  }

  if (method === "platform.getPlatformContext") {
    return bridge.platform.getPlatformContext()
  }

  return bridge.platform.runAction(normalizePlatformActionRequest(params))
}

export function resolveRemoteFrontendUrl(
  rawUrl: string,
  baseHref: string = window.location.href,
): RemoteFrontendUrlResolution {
  const trimmedUrl = rawUrl.trim()
  if (!trimmedUrl) {
    return {
      ok: false,
      error: {
        code: "REMOTE_FRONTEND_URL_REQUIRED",
        message: "远程前端 URL 不能为空。",
      },
    }
  }

  try {
    const url = new URL(trimmedUrl, baseHref)
    if (!ALLOWED_REMOTE_FRONTEND_PROTOCOLS.has(url.protocol.toLowerCase())) {
      return {
        ok: false,
        error: {
          code: "REMOTE_FRONTEND_URL_SCHEME_UNSUPPORTED",
          message: `不支持的远程前端 URL 协议：${url.protocol}`,
        },
      }
    }

    return {
      ok: true,
      url: url.href,
    }
  } catch {
    return {
      ok: false,
      error: {
        code: "REMOTE_FRONTEND_URL_INVALID",
        message: "远程前端 URL 无法被浏览器解析。",
      },
    }
  }
}

export function mountRemoteIframeFrontend(
  container: HTMLElement,
  options: MountRemoteIframeFrontendOptions,
): () => void {
  const resolved = resolveRemoteFrontendUrl(options.url)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  const sessionId = createSessionId()
  const iframe = document.createElement("iframe")
  let disposed = false
  let acceptedOrigin: string | null = null

  iframe.title = options.title ?? "Tsian remote game frontend"
  iframe.src = resolved.url
  iframe.sandbox.value = options.sandbox ?? REMOTE_IFRAME_SANDBOX
  iframe.className = "h-dvh min-h-dvh w-full border-0 bg-void"
  iframe.addEventListener("load", () => {
    if (!disposed) {
      options.onLoad?.()
    }
  })
  iframe.addEventListener("error", () => {
    if (!disposed) {
      options.onError?.("远程前端 iframe 加载失败。")
    }
  })

  function postToRemote(
    message:
      | RemotePlayBridgeReadyMessage
      | RemotePlayBridgeResponseMessage
      | RemotePlayBridgeEventMessage,
    targetOrigin: string,
  ): void {
    iframe.contentWindow?.postMessage(
      message,
      targetOrigin === "null" ? "*" : targetOrigin,
    )
  }

  function postEvent(
    event: RemotePlayBridgeEventMessage["event"],
    payload: RemotePlayBridgeEventMessage["payload"],
  ): void {
    if (!acceptedOrigin) {
      return
    }

    postToRemote(
      {
        channel: REMOTE_PLAY_BRIDGE_CHANNEL,
        kind: "event",
        sessionId,
        event,
        payload,
      },
      acceptedOrigin,
    )
  }

  async function handleRemoteRequest(
    message: Record<string, unknown>,
    targetOrigin: string,
  ): Promise<void> {
    if (message.sessionId !== sessionId) {
      return
    }
    if (typeof message.id !== "string" || !message.id) {
      return
    }
    if (!isRemoteBridgeMethod(message.method)) {
      const response: RemotePlayBridgeResponseMessage = {
        channel: REMOTE_PLAY_BRIDGE_CHANNEL,
        kind: "response",
        sessionId,
        id: message.id,
        ok: false,
        error: {
          code: "REMOTE_METHOD_UNSUPPORTED",
          message: "Remote bridge method is not supported.",
        },
      }
      postToRemote(response, targetOrigin)
      return
    }

    try {
      if (message.method === "interaction.sendMessage") {
        const result = await options.bridge.interaction.sendMessage(
          normalizeMessageInteractionRequest(message.params),
        )
        const response: RemotePlayBridgeResponseMessage = {
          channel: REMOTE_PLAY_BRIDGE_CHANNEL,
          kind: "response",
          sessionId,
          id: message.id,
          ok: true,
          result,
        }
        postToRemote(response, targetOrigin)
        postEvent("turn-completed", { snapshot: result.snapshot })
        return
      }

      const result = await dispatchRemoteBridgeRequest(
        options.bridge,
        message.method,
        message.params,
      )
      const response: RemotePlayBridgeResponseMessage = {
        channel: REMOTE_PLAY_BRIDGE_CHANNEL,
        kind: "response",
        sessionId,
        id: message.id,
        ok: true,
        result,
      }
      postToRemote(response, targetOrigin)
    } catch (error) {
      const response: RemotePlayBridgeResponseMessage = {
        channel: REMOTE_PLAY_BRIDGE_CHANNEL,
        kind: "response",
        sessionId,
        id: message.id,
        ok: false,
        error: toBridgeError(error),
      }
      postToRemote(response, targetOrigin)
    }
  }

  function onMessage(event: MessageEvent): void {
    if (disposed || event.source !== iframe.contentWindow || !isRecord(event.data)) {
      return
    }
    if (event.data.channel !== REMOTE_PLAY_BRIDGE_CHANNEL) {
      return
    }
    if (acceptedOrigin && event.origin !== acceptedOrigin) {
      return
    }

    if (event.data.kind === "hello") {
      acceptedOrigin = event.origin
      const ready: RemotePlayBridgeReadyMessage = {
        channel: REMOTE_PLAY_BRIDGE_CHANNEL,
        kind: "ready",
        sessionId,
        methods: REMOTE_PLAY_BRIDGE_METHODS,
      }
      postToRemote(ready, event.origin)
      options.onBridgeReady?.()
      return
    }

    if (event.data.kind === "request") {
      void handleRemoteRequest(event.data, event.origin)
    }
  }

  const unsubscribeTurnDebugReady = options.bridge.debug?.onTurnDebugReady((turn) => {
    postEvent("turn-debug-ready", { turn })
  })

  window.addEventListener("message", onMessage)
  container.replaceChildren(iframe)

  return () => {
    disposed = true
    window.removeEventListener("message", onMessage)
    unsubscribeTurnDebugReady?.()
    if (iframe.parentElement === container) {
      iframe.remove()
    }
  }
}
