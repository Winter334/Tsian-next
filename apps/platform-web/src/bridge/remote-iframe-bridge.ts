import type {
  AskUserResponse,
  DeepQueryRequest,
  InjectionMessage,
  InvokeAgentRequest,
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
  WorkspaceListRequest,
  WorkspaceReadRequest,
  WorkspaceSearchRequest,
  WorkspaceWriteRequest,
} from "@tsian/contracts"

import { subscribeTurnDelta, subscribeTurnRoundEnd, subscribeTurnTool, subscribeTurnOptions, subscribeTurnStats } from "../streaming-events"
import { subscribeInteractionRequest, resolveInteractionRequest } from "../interaction-events"

export const REMOTE_PLAY_BRIDGE_CHANNEL: RemotePlayBridgeChannel = "tsian.play-bridge.v1"
const REMOTE_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms"
const ALLOWED_REMOTE_FRONTEND_PROTOCOLS = new Set(["http:", "https:"])
const REMOTE_PLAY_BRIDGE_METHODS: RemotePlayBridgeMethod[] = [
  "interaction.sendMessage",
  "interaction.invokeAgent",
  "interaction.respond",
  "query.query",
  "platform.getPlatformContext",
  "platform.runAction",
  "workspace.read",
  "workspace.list",
  "workspace.search",
  "workspace.write",
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
  /**
   * 握手完成时透出 mount 为本会话生成的 sessionId.自检等需要自行向 iframe
   * postMessage 事件的调用方用它构造匹配 sessionId 的事件(如 turn-completed).
   * PlayView 不传此回调,行为零影响.
   */
  onSessionId?: (sessionId: string) => void
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

const INJECTION_ROLES = new Set(["system", "user", "assistant"])
const INJECTION_POSITIONS = new Set(["before-input", "after-input"])

/** 校验并透传前端 injection 数组。校验结构（数组 + 每条 role/content/position 合法），
 *  不校验语义/长度。undefined 或空数组返回 undefined（不注入）。 */
function normalizeInjection(value: unknown): InjectionMessage[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new RemoteBridgeRpcError(
      "INVALID_INJECTION",
      "injection must be an array when provided.",
    )
  }
  if (value.length === 0) {
    return undefined
  }
  const result: InjectionMessage[] = []
  for (const [index, item] of value.entries()) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new RemoteBridgeRpcError(
        "INVALID_INJECTION",
        `injection[${index}] must be an object.`,
      )
    }
    const record = item as Record<string, unknown>
    const role = typeof record.role === "string" ? record.role : ""
    if (!INJECTION_ROLES.has(role)) {
      throw new RemoteBridgeRpcError(
        "INVALID_INJECTION",
        `injection[${index}].role must be "system", "user", or "assistant".`,
      )
    }
    if (typeof record.content !== "string") {
      throw new RemoteBridgeRpcError(
        "INVALID_INJECTION",
        `injection[${index}].content must be a string.`,
      )
    }
    const position =
      record.position === undefined ? undefined : typeof record.position === "string" ? record.position : ""
    if (position !== undefined && !INJECTION_POSITIONS.has(position)) {
      throw new RemoteBridgeRpcError(
        "INVALID_INJECTION",
        `injection[${index}].position must be "before-input" or "after-input" when provided.`,
      )
    }
    result.push({
      role: role as InjectionMessage["role"],
      content: record.content,
      ...(position ? { position: position as InjectionMessage["position"] } : {}),
    })
  }
  return result
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

  const injection = normalizeInjection(record.injection)
  return { content: record.content, ...(injection ? { injection } : {}) }
}

function normalizeInvokeAgentRequest(value: unknown): InvokeAgentRequest {
  const record = requireRecordParams(
    value,
    "INVALID_INVOKE_AGENT_REQUEST",
    "interaction.invokeAgent requires an object payload.",
  )
  if (typeof record.agentId !== "string" || !record.agentId.trim()) {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_ID",
      "interaction.invokeAgent requires a non-empty string agentId.",
    )
  }
  if (typeof record.input !== "string") {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_INPUT",
      "interaction.invokeAgent requires string input.",
    )
  }

  const injection = normalizeInjection(record.injection)
  return { agentId: record.agentId, input: record.input, ...(injection ? { injection } : {}) }
}

function normalizeAskUserResponse(value: unknown): AskUserResponse {
  const record = requireRecordParams(
    value,
    "INVALID_INTERACTION_RESPONSE",
    "interaction.respond requires an object payload.",
  )
  if (typeof record.requestId !== "string") {
    throw new RemoteBridgeRpcError(
      "INVALID_INTERACTION_REQUEST_ID",
      "interaction.respond requires string requestId.",
    )
  }
  if (typeof record.answer !== "string") {
    throw new RemoteBridgeRpcError(
      "INVALID_INTERACTION_ANSWER",
      "interaction.respond requires string answer.",
    )
  }
  return {
    requestId: record.requestId,
    answer: record.answer,
    ...(typeof record.cancelled === "boolean" ? { cancelled: record.cancelled } : {}),
  }
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

function normalizeWorkspaceReadRequest(value: unknown): WorkspaceReadRequest {
  const record = requireRecordParams(
    value,
    "INVALID_WORKSPACE_READ_REQUEST",
    "workspace.read requires an object payload.",
  )
  if (typeof record.path !== "string" || !record.path.trim()) {
    throw new RemoteBridgeRpcError(
      "INVALID_WORKSPACE_PATH",
      "workspace.read requires a non-empty string path.",
    )
  }
  return {
    path: record.path,
    ...(typeof record.scope === "string" ? { scope: record.scope as WorkspaceReadRequest["scope"] } : {}),
    ...(typeof record.offset === "number" ? { offset: record.offset } : {}),
    ...(typeof record.limit === "number" ? { limit: record.limit } : {}),
  }
}

function normalizeWorkspaceListRequest(value: unknown): WorkspaceListRequest {
  const record = requireRecordParams(
    value,
    "INVALID_WORKSPACE_LIST_REQUEST",
    "workspace.list requires an object payload.",
  )
  return {
    ...(typeof record.path === "string" ? { path: record.path } : {}),
    ...(typeof record.scope === "string" ? { scope: record.scope as WorkspaceListRequest["scope"] } : {}),
  }
}

function normalizeWorkspaceSearchRequest(value: unknown): WorkspaceSearchRequest {
  const record = requireRecordParams(
    value,
    "INVALID_WORKSPACE_SEARCH_REQUEST",
    "workspace.search requires an object payload.",
  )
  return {
    ...(typeof record.query === "string" ? { query: record.query } : {}),
    ...(typeof record.pattern === "string" ? { pattern: record.pattern } : {}),
    ...(typeof record.scope === "string" ? { scope: record.scope as WorkspaceSearchRequest["scope"] } : {}),
    ...(typeof record.limit === "number" ? { limit: record.limit } : {}),
    ...(typeof record.contextLines === "number" ? { contextLines: record.contextLines } : {}),
    ...(typeof record.ignoreCase === "boolean" ? { ignoreCase: record.ignoreCase } : {}),
  }
}

function normalizeWorkspaceWriteRequest(value: unknown): WorkspaceWriteRequest {
  const record = requireRecordParams(
    value,
    "INVALID_WORKSPACE_WRITE_REQUEST",
    "workspace.write requires an object payload.",
  )
  if (typeof record.path !== "string" || !record.path.trim()) {
    throw new RemoteBridgeRpcError(
      "INVALID_WORKSPACE_PATH",
      "workspace.write requires a non-empty string path.",
    )
  }
  if (typeof record.content !== "string") {
    throw new RemoteBridgeRpcError(
      "INVALID_WORKSPACE_CONTENT",
      "workspace.write requires string content.",
    )
  }
  return {
    path: record.path,
    content: record.content,
    ...(typeof record.scope === "string" ? { scope: record.scope as WorkspaceWriteRequest["scope"] } : {}),
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
  if (method === "interaction.sendMessage") {
    return bridge.interaction.sendMessage(normalizeMessageInteractionRequest(params))
  }

  if (method === "interaction.invokeAgent") {
    return bridge.interaction.invokeAgent(normalizeInvokeAgentRequest(params))
  }

  if (method === "interaction.respond") {
    const response = normalizeAskUserResponse(params)
    const found = resolveInteractionRequest(response.requestId, response.answer, response.cancelled)
    if (!found) {
      throw {
        code: "INTERACTION_REQUEST_NOT_FOUND",
        message: `No pending interaction request for id: ${response.requestId}`,
      } satisfies RemotePlayBridgeError
    }
    return undefined
  }

  if (method === "query.query") {
    return bridge.query.query(normalizeDeepQueryRequest(params))
  }

  if (method === "platform.getPlatformContext") {
    return bridge.platform.getPlatformContext()
  }

  if (method === "workspace.read") {
    return bridge.workspace.read(normalizeWorkspaceReadRequest(params))
  }
  if (method === "workspace.list") {
    return bridge.workspace.list(normalizeWorkspaceListRequest(params))
  }
  if (method === "workspace.search") {
    return bridge.workspace.search(normalizeWorkspaceSearchRequest(params))
  }
  if (method === "workspace.write") {
    return bridge.workspace.write(normalizeWorkspaceWriteRequest(params))
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
  // 用容器相对单位(h-full)而非视口单位(h-dvh):游戏 iframe 必须填满桌面
  // 窗口内容区(= 窗口高 − 标题栏 − padding),否则会撑成整个浏览器视口高,
  // 被 .desktop-window 的 overflow:hidden 裁掉底部,且窗口越浮动裁得越多。
  iframe.className = "block h-full min-h-0 w-full border-0 bg-void"
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
        postEvent("turn-completed", {})
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
      options.onSessionId?.(sessionId)
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

  // Forward streaming text deltas to the remote frontend as `turn-delta`.
  // `agentId` identifies the emitting agent (entry "master" or delegated target)
  // so the frontend can distinguish parallel delegated agents' streams. `kind`
  // separates chain-of-thought (`reasoning`) from the visible reply (`content`)
  // so the frontend can route reasoning to a collapsed "思考" region.
  const unsubscribeTurnDelta = subscribeTurnDelta((agentId, delta, turn, round, kind) => {
    postEvent("turn-delta", { agentId, delta, turn, round, kind })
  })

  // Forward per-round end markers to the remote frontend as `turn-round-end`,
  // so it can classify streamed `turn-delta` text into thought vs final regions.
  const unsubscribeTurnRoundEnd = subscribeTurnRoundEnd((agentId, turn, round, kind) => {
    postEvent("turn-round-end", { agentId, turn, round, kind })
  })

  // Forward tool-call status/output to the remote frontend as `turn-tool`,
  // so it can render tool cards (loading -> success/failed).
  const unsubscribeTurnTool = subscribeTurnTool((agentId, turn, round, callId, name, status, output) => {
    postEvent("turn-tool", {
      agentId,
      turn,
      round,
      callId,
      name,
      status,
      ...(output !== undefined ? { output } : {}),
    })
  })

  // Forward extracted story options to the remote frontend as `turn-options`,
  // so it can render choice buttons after the turn's narrative. The host strips
  // the option block before storing to snapshot/turn files, so the frontend uses
  // this event to get the options list (player clicks = new turn input).
  const unsubscribeTurnOptions = subscribeTurnOptions((turn, options) => {
    postEvent("turn-options", { turn, options })
  })

  // Forward turn stats (duration + token usage) to the remote frontend as
  // `turn-stats`, so it can render a meta line below the assistant reply.
  const unsubscribeTurnStats = subscribeTurnStats((turn, stats) => {
    postEvent("turn-stats", { turn, stats })
  })

  // Forward ask_user interaction requests to the remote frontend as
  // `interaction-request`, so it can render the question + options UI.
  // The player's answer comes back via the `interaction.respond` RPC.
  const unsubscribeInteractionRequest = subscribeInteractionRequest((requestId, question, options, allowCustom) => {
    postEvent("interaction-request", {
      requestId,
      question,
      ...(options && options.length > 0 ? { options } : {}),
      ...(allowCustom !== undefined ? { allowCustom } : {}),
    })
  })

  window.addEventListener("message", onMessage)
  container.replaceChildren(iframe)

  return () => {
    disposed = true
    window.removeEventListener("message", onMessage)
    unsubscribeTurnDebugReady?.()
    unsubscribeTurnDelta?.()
    unsubscribeTurnRoundEnd?.()
    unsubscribeTurnTool?.()
    unsubscribeTurnOptions?.()
    unsubscribeTurnStats?.()
    unsubscribeInteractionRequest?.()
    unsubscribeTurnDelta?.()
    if (iframe.parentElement === container) {
      iframe.remove()
    }
  }
}
