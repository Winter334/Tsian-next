import type {
  AskUserResponse,
  DeepQueryRequest,
  FrontendActionPublicError,
  InjectionMessage,
  InvokeAgentCheckpointOption,
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
  RemotePlayBridgeResponseError,
  RemotePlayBridgeResponseMessage,
  RemotePlayBridgeResponseResult,
  WorkspaceListRequest,
  WorkspaceReadRequest,
  WorkspaceSearchRequest,
  WorkspaceWriteRequest,
} from "@tsian/contracts"

import { subscribeTurnDelta, subscribeTurnRoundEnd, subscribeTurnTool, subscribeTurnOptions, subscribeTurnStats, subscribeAgentInvocation } from "../streaming-events"
import { subscribeInteractionRequest, resolveInteractionRequest } from "../interaction-events"
import {
  frontendActionExecutionService,
} from "../platform-host/frontend-actions"
import { isFrontendActionMountBindingCurrent } from "../storage/frontend-action-workspace"
import { executePlatformActionForPlayFrontend } from "../platform-host/platform-actions"
import {
  createRemoteFrontendActionLifecycle,
  normalizeFrontendActionPublicError,
  normalizeRemoteFrontendActionAbortRequest,
  normalizeRemoteFrontendActionRunRequest,
  type RemoteFrontendActionService,
} from "./remote-frontend-action-lifecycle"

export const REMOTE_PLAY_BRIDGE_CHANNEL: RemotePlayBridgeChannel = "tsian.play-bridge.v1"
const REMOTE_IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms"
const ALLOWED_REMOTE_FRONTEND_PROTOCOLS = new Set(["http:", "https:"])
const REMOTE_PLAY_BRIDGE_METHODS: RemotePlayBridgeMethod[] = [
  "interaction.sendMessage",
  "interaction.invokeAgent",
  "interaction.respond",
  "interaction.stop",
  "query.query",
  "platform.getPlatformContext",
  "platform.runAction",
  "workspace.read",
  "workspace.list",
  "workspace.search",
  "workspace.write",
  "card.getEntrypoints",
  "card.runAction",
  "card.abortAction",
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
  /** Exact game card expected by this mount; never accepted from iframe params. */
  gameCardId: string
  /** Test/service override; invocation ownership remains local to this mount. */
  frontendActionService?: RemoteFrontendActionService
  /** Test/query override for the authoritative post-commit save/card check. */
  isFrontendActionBindingCurrent?: (
    saveId: string,
    gameCardId: string,
  ) => boolean | Promise<boolean>
  sandbox?: string
  title?: string
  onLoad?: () => void
  onError?: (message: string) => void
  onBridgeReady?: () => void
}

export type RemoteIframeMountStatus = "loading" | "ready" | "error" | "disposed"

export interface RemoteBridgeActivityEntry {
  sequence: number
  requestId: string
  method: RemotePlayBridgeMethod
  phase: "started" | "completed" | "failed"
  at: number
  error?: {
    code: string
    message: string
  }
}

export interface MountedRemoteIframeFrontend {
  readonly iframe: HTMLIFrameElement
  readonly sessionId: string
  readonly status: RemoteIframeMountStatus
  readonly activitySequence: number
  readonly inFlightRequestCount: number
  readonly lastActivityAt: number | null
  subscribeStatus(listener: (status: RemoteIframeMountStatus) => void): () => void
  subscribeActivity(listener: (entry: RemoteBridgeActivityEntry) => void): () => void
  waitForReady(timeoutMs: number): Promise<boolean>
  dispose(): void
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
const AGENT_INVOCATION_COMMIT_MODES = new Set(["workspace", "workspace-with-checkpoint"])

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

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (isRecord(value)) return Object.values(value).every(isJsonValue)
  return false
}

function normalizeJsonMetadata(
  value: unknown,
  code: string,
): Record<string, JsonValue> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    throw new RemoteBridgeRpcError(code, "checkpoint.metadata must be a JSON object when provided.")
  }
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!isJsonValue(item)) {
      throw new RemoteBridgeRpcError(code, `checkpoint.metadata.${key} must be JSON-compatible.`)
    }
    result[key] = item
  }
  return result
}

function normalizeStringArray(
  value: unknown,
  code: string,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new RemoteBridgeRpcError(code, `${field} must be an array of strings when provided.`)
  }
  const result = value.map((item) => {
    if (typeof item !== "string") {
      throw new RemoteBridgeRpcError(code, `${field} must be an array of strings when provided.`)
    }
    return item.trim()
  }).filter(Boolean)
  return result.length > 0 ? Array.from(new Set(result)) : undefined
}

function normalizeInvokeAgentCheckpoint(value: unknown): InvokeAgentCheckpointOption | undefined {
  if (value === undefined) return undefined
  if (typeof value === "boolean") return value
  if (!isRecord(value)) {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_CHECKPOINT",
      "interaction.invokeAgent checkpoint must be a boolean or object when provided.",
    )
  }

  const mode = value.mode === undefined ? undefined : typeof value.mode === "string" ? value.mode.trim() : ""
  if (mode !== undefined && mode !== "create" && mode !== "overwrite" && mode !== "current-turn-auto") {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_CHECKPOINT",
      'interaction.invokeAgent checkpoint.mode must be "create", "overwrite", or "current-turn-auto".',
    )
  }

  const label = typeof value.label === "string" && value.label.trim() ? value.label.trim() : undefined
  const tags = normalizeStringArray(value.tags, "INVALID_INVOKE_AGENT_CHECKPOINT", "checkpoint.tags")
  const metadata = normalizeJsonMetadata(value.metadata, "INVALID_INVOKE_AGENT_CHECKPOINT")

  if (mode === "current-turn-auto") {
    return {
      mode,
      ...(label ? { label } : {}),
      ...(tags ? { tags } : {}),
      ...(metadata ? { metadata } : {}),
    }
  }

  const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : undefined
  const retention = value.retention === "auto" || value.retention === "pinned" ? value.retention : undefined
  if (value.retention !== undefined && !retention) {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_CHECKPOINT",
      'checkpoint.retention must be "auto" or "pinned" when provided.',
    )
  }
  const source = value.source === "platform" || value.source === "user" || value.source === "card" || value.source === "agent"
    ? value.source
    : undefined
  if (value.source !== undefined && !source) {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_CHECKPOINT",
      'checkpoint.source must be "platform", "user", "card", or "agent" when provided.',
    )
  }
  if (value.visible !== undefined && typeof value.visible !== "boolean") {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_CHECKPOINT",
      "checkpoint.visible must be a boolean when provided.",
    )
  }

  if (mode === "overwrite") {
    if (typeof value.checkpointId !== "string" || !value.checkpointId.trim()) {
      throw new RemoteBridgeRpcError(
        "INVALID_INVOKE_AGENT_CHECKPOINT",
        "interaction.invokeAgent checkpoint overwrite requires checkpointId.",
      )
    }
    return {
      mode,
      checkpointId: value.checkpointId.trim(),
      ...(label ? { label } : {}),
      ...(retention ? { retention } : {}),
      ...(source ? { source } : {}),
      ...(tags ? { tags } : {}),
      ...(typeof value.visible === "boolean" ? { visible: value.visible } : {}),
      ...(metadata ? { metadata } : {}),
      ...(reason ? { reason } : {}),
    }
  }

  return {
    ...(mode ? { mode: "create" as const } : {}),
    ...(label ? { label } : {}),
    ...(retention ? { retention } : {}),
    ...(source ? { source } : {}),
    ...(tags ? { tags } : {}),
    ...(typeof value.visible === "boolean" ? { visible: value.visible } : {}),
    ...(metadata ? { metadata } : {}),
    ...(reason ? { reason } : {}),
  }
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
  const invocationId =
    typeof record.invocationId === "string" && record.invocationId.trim()
      ? record.invocationId.trim()
      : undefined
  const purpose =
    typeof record.purpose === "string" && record.purpose.trim()
      ? record.purpose.trim()
      : undefined
  const commitMode = record.commitMode === undefined ? undefined : typeof record.commitMode === "string" ? record.commitMode.trim() : ""
  if (commitMode !== undefined && !AGENT_INVOCATION_COMMIT_MODES.has(commitMode)) {
    throw new RemoteBridgeRpcError(
      "INVALID_INVOKE_AGENT_COMMIT_MODE",
      'interaction.invokeAgent commitMode must be "workspace" or "workspace-with-checkpoint" when provided.',
    )
  }
  const checkpointReason =
    typeof record.checkpointReason === "string" && record.checkpointReason.trim()
      ? record.checkpointReason.trim()
      : undefined
  const checkpoint = normalizeInvokeAgentCheckpoint(record.checkpoint)
  const contextSlot =
    typeof record.contextSlot === "string" && record.contextSlot.trim()
      ? record.contextSlot.trim()
      : undefined
  const persist = typeof record.persist === "boolean" ? record.persist : undefined
  return {
    agentId: record.agentId,
    input: record.input,
    ...(invocationId ? { invocationId } : {}),
    ...(purpose ? { purpose } : {}),
    ...(commitMode ? { commitMode: commitMode as InvokeAgentRequest["commitMode"] } : {}),
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    ...(checkpointReason ? { checkpointReason } : {}),
    ...(injection ? { injection } : {}),
    ...(contextSlot ? { contextSlot } : {}),
    ...(persist !== undefined ? { persist } : {}),
  }
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
  if (typeof record.content !== "string" && !(record.content instanceof Blob)) {
    throw new RemoteBridgeRpcError(
      "INVALID_WORKSPACE_CONTENT",
      "workspace.write requires string or Blob content.",
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

function toActionResponseError(error: unknown): FrontendActionPublicError {
  return normalizeFrontendActionPublicError(error)
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

  if (method === "interaction.stop") {
    return bridge.interaction.stop().then(() => undefined)
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

  if (method === "card.getEntrypoints") {
    return bridge.card.getEntrypoints({})
  }

  if (method === "platform.runAction") {
    return executePlatformActionForPlayFrontend(
      normalizePlatformActionRequest(params),
    )
  }

  throw new RemoteBridgeRpcError(
    "REMOTE_METHOD_UNSUPPORTED",
    "Remote bridge method is not supported.",
  )
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
): MountedRemoteIframeFrontend {
  const resolved = resolveRemoteFrontendUrl(options.url)
  if (!resolved.ok) {
    throw new Error(resolved.error.message)
  }

  const sessionId = createSessionId()
  const iframe = document.createElement("iframe")
  let disposed = false
  let acceptedOrigin: string | null = null
  let status: RemoteIframeMountStatus = "loading"
  let activitySequence = 0
  let inFlightRequestCount = 0
  let lastActivityAt: number | null = null
  const statusListeners = new Set<(status: RemoteIframeMountStatus) => void>()
  const activityListeners = new Set<(entry: RemoteBridgeActivityEntry) => void>()

  function setStatus(nextStatus: RemoteIframeMountStatus): void {
    if (status === nextStatus) {
      return
    }
    status = nextStatus
    for (const listener of statusListeners) {
      listener(status)
    }
  }

  function emitActivity(
    requestId: string,
    method: RemotePlayBridgeMethod,
    phase: RemoteBridgeActivityEntry["phase"],
    error?: RemotePlayBridgeError,
  ): void {
    const entry: RemoteBridgeActivityEntry = {
      sequence: ++activitySequence,
      requestId,
      method,
      phase,
      at: Date.now(),
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
    }
    lastActivityAt = entry.at
    for (const listener of activityListeners) {
      listener(entry)
    }
  }

  iframe.title = options.title ?? "Tsian remote game frontend"
  iframe.src = resolved.url
  iframe.sandbox.value = options.sandbox ?? REMOTE_IFRAME_SANDBOX
  iframe.allowFullscreen = true
  iframe.setAttribute("allow", "fullscreen")
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
      setStatus("error")
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
    if (disposed) return
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

  const actionService: RemoteFrontendActionService = options.frontendActionService ?? {
    async runAction(request) {
      const result = await frontendActionExecutionService.runAction({
        mountedGameCardId: request.expectedGameCardId,
        invocationId: request.invocationId,
        actionId: request.actionId,
        input: request.input,
        signal: request.signal,
        beforeCommit: request.beforeCommit,
        assertCommitAllowed: request.assertCommitAllowed,
      })
      return {
        output: result.output,
        ...(result.mutationEvent ? { mutation: result.mutationEvent } : {}),
      }
    },
  }
  const frontendActionLifecycle = createRemoteFrontendActionLifecycle({
    expectedGameCardId: options.gameCardId,
    service: actionService,
    isCurrent: () => !disposed,
    isCurrentBinding: options.isFrontendActionBindingCurrent
      ?? isFrontendActionMountBindingCurrent,
    onWorkspaceMutation(event) {
      postEvent("workspace-mutation", event)
    },
  })

  function postSuccessResponse(
    requestId: string,
    result: RemotePlayBridgeResponseResult,
    targetOrigin: string,
  ): void {
    const response: RemotePlayBridgeResponseMessage = {
      channel: REMOTE_PLAY_BRIDGE_CHANNEL,
      kind: "response",
      sessionId,
      id: requestId,
      ok: true,
      result,
    }
    postToRemote(response, targetOrigin)
  }

  function postFailureResponse(
    requestId: string,
    error: RemotePlayBridgeResponseError,
    targetOrigin: string,
  ): void {
    const response: RemotePlayBridgeResponseMessage = {
      channel: REMOTE_PLAY_BRIDGE_CHANNEL,
      kind: "response",
      sessionId,
      id: requestId,
      ok: false,
      error,
    }
    postToRemote(response, targetOrigin)
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

    const requestId = message.id
    const method = message.method
    inFlightRequestCount += 1
    emitActivity(requestId, method, "started")

    try {
      if (method === "card.runAction") {
        const result = await frontendActionLifecycle.runAction(
          normalizeRemoteFrontendActionRunRequest(message.params),
        )
        // The lifecycle posts any durable mutation event synchronously before
        // resolving, so this success response is observably ordered afterward.
        postSuccessResponse(requestId, result, targetOrigin)
        emitActivity(requestId, method, "completed")
        return
      }

      if (method === "card.abortAction") {
        const invocationId = normalizeRemoteFrontendActionAbortRequest(message.params)
        frontendActionLifecycle.abortAction(invocationId)
        postSuccessResponse(requestId, undefined, targetOrigin)
        emitActivity(requestId, method, "completed")
        return
      }

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
        postEvent("turn-completed", { turn: result.turn, assistant: result.assistant })
        emitActivity(requestId, method, "completed")
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
      emitActivity(requestId, method, "completed")
    } catch (error) {
      const responseError = method === "card.runAction" || method === "card.abortAction"
        ? toActionResponseError(error)
        : toBridgeError(error)
      postFailureResponse(requestId, responseError, targetOrigin)
      emitActivity(requestId, method, "failed", {
        code: responseError.code,
        message: responseError.message,
      })
    } finally {
      inFlightRequestCount = Math.max(0, inFlightRequestCount - 1)
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
      setStatus("ready")
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
  const unsubscribeTurnTool = subscribeTurnTool((agentId, turn, round, callId, name, status, output, displayName) => {
    postEvent("turn-tool", {
      agentId,
      turn,
      round,
      callId,
      name,
      status,
      ...(output !== undefined ? { output } : {}),
      ...(displayName !== undefined ? { displayName } : {}),
    })
  })

  // Legacy turn-options forwarding. New formal turns are not parsed by the host;
  // default/custom frontends should parse any game-card-specific option markers
  // from narrative text themselves. Keep this event for older paths/saves.
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

  // Forward full invokeAgent invocation events to the remote frontend.
  const unsubscribeAgentInvocation = subscribeAgentInvocation((event) => {
    postEvent("agent-invocation", event)
  })

  window.addEventListener("message", onMessage)
  container.replaceChildren(iframe)

  const handle: MountedRemoteIframeFrontend = {
    iframe,
    sessionId,
    get status() {
      return status
    },
    get activitySequence() {
      return activitySequence
    },
    get inFlightRequestCount() {
      return inFlightRequestCount
    },
    get lastActivityAt() {
      return lastActivityAt
    },
    subscribeStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    subscribeActivity(listener) {
      activityListeners.add(listener)
      return () => activityListeners.delete(listener)
    },
    waitForReady(timeoutMs) {
      if (status === "ready") {
        return Promise.resolve(true)
      }
      if (status === "error" || status === "disposed") {
        return Promise.resolve(false)
      }
      return new Promise((resolve) => {
        let settled = false
        let timer = 0
        const finish = (ready: boolean) => {
          if (settled) {
            return
          }
          settled = true
          window.clearTimeout(timer)
          unsubscribe()
          resolve(ready)
        }
        const unsubscribe = handle.subscribeStatus((nextStatus) => {
          if (nextStatus === "ready") {
            finish(true)
          } else if (nextStatus === "error" || nextStatus === "disposed") {
            finish(false)
          }
        })
        timer = window.setTimeout(() => finish(false), Math.max(0, timeoutMs))
      })
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      frontendActionLifecycle.dispose()
      setStatus("disposed")
      window.removeEventListener("message", onMessage)
      unsubscribeTurnDebugReady?.()
      unsubscribeTurnDelta?.()
      unsubscribeTurnRoundEnd?.()
      unsubscribeTurnTool?.()
      unsubscribeTurnOptions?.()
      unsubscribeTurnStats?.()
      unsubscribeInteractionRequest?.()
      unsubscribeAgentInvocation?.()
      statusListeners.clear()
      activityListeners.clear()
      if (iframe.parentElement === container) {
        iframe.remove()
      }
    },
  }
  return handle
}
