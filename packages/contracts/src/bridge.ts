import type {
  AgentInvocationEvent,
  AssistantTurnTimelineItem,
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  InvokeAgentRequest,
  InvokeAgentResult,
  JsonValue,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformActionRequest,
  PlatformActionResult,
  PlatformContextShell,
  UiToolPresentation,
  TurnTimelineItem,
  TurnStats,
  WorkspaceEntry,
  WorkspaceReadResult,
  WorkspaceScope,
  WorkspaceSearchResult,
  WorkspaceWriteResult,
} from "./runtime"
import type { GameCardRuntimeEntrypoints } from "./game-card"
import type {
  DiagnosticBundleExportRequest,
  DiagnosticBundleExportResult,
  DiagnosticRecord,
  DiagnosticRecordQuery,
  DiagnosticRecordsChange,
  DiagnosticRecordSummaryPage,
  DiagnosticStoreHealth,
  DiagnosticTraceFacets,
  DiagnosticTraceOverview,
} from "./diagnostics"

export interface InteractionBridge {
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
  invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult>
  /** 中断当前正在进行的 turn（流式输出/工具执行）。无 turn 进行中则空操作。 */
  stop(): Promise<void>
}

export interface QueryBridge {
  query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>
}

export interface PlatformBridge {
  getPlatformContext(): Promise<PlatformContextShell>
  runAction(request: PlatformActionRequest): Promise<PlatformActionResult>
}

/** 前端 workspace 操作的 RPC 请求/响应类型。从 query.query 拆出为独立 method，
 *  各自有明确形状，不再套 DeepQueryResult。 */
export interface WorkspaceReadRequest {
  path: string
  scope?: WorkspaceScope
  offset?: number
  limit?: number
}

export interface WorkspaceListRequest {
  path?: string
  scope?: WorkspaceScope
}

export interface WorkspaceSearchRequest {
  query?: string
  pattern?: string
  scope?: WorkspaceScope
  limit?: number
  contextLines?: number
  ignoreCase?: boolean
}

export interface WorkspaceWriteRequest {
  path: string
  /** Text content for text writes, or a Blob for binary/media writes. */
  content: string | Blob
  scope?: WorkspaceScope
}

export interface WorkspaceBridge {
  read(req: WorkspaceReadRequest): Promise<WorkspaceReadResult | null>
  list(req: WorkspaceListRequest): Promise<WorkspaceEntry[]>
  search(req: WorkspaceSearchRequest): Promise<WorkspaceSearchResult[]>
  write(req: WorkspaceWriteRequest): Promise<WorkspaceWriteResult>
}

/** 卡配置读取的 RPC 请求/响应类型。当前只暴露 runtime entrypoints，
 *  让前端决定调用哪个 agent（如回合后维护入口），不硬编码 agent 名。 */
export interface CardGetEntrypointsRequest {}

/** Stable platform-owned failures exposed by Frontend Action invocations. */
export type FrontendActionRuntimeErrorCode =
  | "FRONTEND_ACTION_NOT_FOUND"
  | "FRONTEND_ACTION_MANIFEST_INVALID"
  | "FRONTEND_ACTION_INPUT_INVALID"
  | "FRONTEND_ACTION_OUTPUT_INVALID"
  | "FRONTEND_ACTION_TIMEOUT"
  | "FRONTEND_ACTION_ABORTED"
  | "FRONTEND_ACTION_WORKSPACE_CONFLICT"
  | "FRONTEND_ACTION_EXECUTION_FAILED"
  | "FRONTEND_ACTION_SESSION_REPLACED"

export interface FrontendActionRuntimePublicError {
  kind: "runtime"
  code: FrontendActionRuntimeErrorCode
  message: string
  details?: JsonValue
  correlationId?: string
}

/**
 * Card-defined business failure. `code` is intentionally open: the platform
 * validates the envelope but does not maintain a game-domain code allowlist.
 */
export interface FrontendActionDomainPublicError {
  kind: "domain"
  code: string
  message: string
  details?: JsonValue
  correlationId?: string
}

export type FrontendActionPublicError =
  | FrontendActionRuntimePublicError
  | FrontendActionDomainPublicError

export interface CardRunActionRequest {
  invocationId: string
  actionId: string
  input: JsonValue
}

export type CardRunActionResult = JsonValue

export interface CardAbortActionRequest {
  invocationId: string
}

/** Path-only notification emitted after a durable, non-empty Action commit. */
export interface RuntimeWorkspaceMutationEvent {
  invocationId: string
  saveId: string
  source: "frontend-action"
  actionId: string
  writtenPaths: string[]
  deletedPaths: string[]
}

export interface CardBridge {
  /** 返回当前卡 runtime.entrypoints；卡未配置时返回空对象 {}。 */
  getEntrypoints(req: CardGetEntrypointsRequest): Promise<GameCardRuntimeEntrypoints>
  /** Execute a fixed-directory Frontend Action owned by the mounted card. */
  runAction(req: CardRunActionRequest): Promise<CardRunActionResult>
  /** Idempotently request cancellation of one invocation in this bridge session. */
  abortAction(req: CardAbortActionRequest): Promise<void>
}

export interface DebugBridge {
  onTurnDebugReady(cb: (turn: number) => void): () => void
  queryDiagnosticSummaries(query?: DiagnosticRecordQuery): Promise<DiagnosticRecordSummaryPage>
  getDiagnosticRecord(id: string): Promise<DiagnosticRecord | null>
  getDiagnosticFacets(): Promise<DiagnosticTraceFacets>
  getDiagnosticOverview(): Promise<DiagnosticTraceOverview>
  getDiagnosticStoreHealth(): Promise<DiagnosticStoreHealth>
  exportDiagnosticBundle(request: DiagnosticBundleExportRequest): Promise<DiagnosticBundleExportResult>
  onDiagnosticRecordsChanged(cb: (change: DiagnosticRecordsChange) => void): () => void
}

export interface PlayFrontendBridge {
  interaction: InteractionBridge
  query: QueryBridge
  platform: PlatformBridge
  workspace: WorkspaceBridge
  card: CardBridge
  debug?: DebugBridge
}

export type RemotePlayBridgeChannel = "tsian.play-bridge.v1"

export type RemotePlayBridgeMethod =
  | "interaction.sendMessage"
  | "interaction.invokeAgent"
  | "interaction.respond"
  | "interaction.stop"
  | "query.query"
  | "platform.getPlatformContext"
  | "platform.runAction"
  | "workspace.read"
  | "workspace.list"
  | "workspace.search"
  | "workspace.write"
  | "card.getEntrypoints"
  | "card.runAction"
  | "card.abortAction"

/** 玩家回答 ask_user 的 RPC payload。 */
export interface AskUserResponse {
  requestId: string
  answer: string
  cancelled?: boolean
}

export type RemotePlayBridgeRequestParams =
  | MessageInteractionRequest
  | InvokeAgentRequest
  | AskUserResponse
  | DeepQueryRequest
  | PlatformActionRequest
  | WorkspaceReadRequest
  | WorkspaceListRequest
  | WorkspaceSearchRequest
  | WorkspaceWriteRequest
  | CardGetEntrypointsRequest
  | CardRunActionRequest
  | CardAbortActionRequest
  | undefined

export type RemotePlayBridgeResponseResult =
  | MessageInteractionResult
  | InvokeAgentResult
  | DeepQueryResult<unknown>
  | PlatformContextShell
  | PlatformActionResult
  | WorkspaceReadResult
  | WorkspaceEntry[]
  | WorkspaceSearchResult[]
  | WorkspaceWriteResult
  | GameCardRuntimeEntrypoints
  | CardRunActionResult
  | null
  | undefined

export interface RemotePlayBridgeError {
  code: string
  message: string
  details?: Record<string, JsonValue>
}

export type RemotePlayBridgeResponseError =
  | RemotePlayBridgeError
  | FrontendActionPublicError

export interface RemotePlayBridgeHelloMessage {
  channel: RemotePlayBridgeChannel
  kind: "hello"
}

export interface RemotePlayBridgeReadyMessage {
  channel: RemotePlayBridgeChannel
  kind: "ready"
  sessionId: string
  methods: RemotePlayBridgeMethod[]
}

export interface RemotePlayBridgeRequestMessage {
  channel: RemotePlayBridgeChannel
  kind: "request"
  sessionId: string
  id: string
  method: RemotePlayBridgeMethod
  params?: RemotePlayBridgeRequestParams
}

export type RemotePlayBridgeResponseMessage =
  | {
      channel: RemotePlayBridgeChannel
      kind: "response"
      sessionId: string
      id: string
      ok: true
      result?: RemotePlayBridgeResponseResult
    }
  | {
      channel: RemotePlayBridgeChannel
      kind: "response"
      sessionId: string
      id: string
      ok: false
      error: RemotePlayBridgeResponseError
    }

export type RemotePlayBridgeEventName =
  | "turn-completed"
  | "turn-debug-ready"
  | "turn-delta"
  | "turn-round-end"
  | "turn-stats"
  | "turn-tool"
  | "turn-options"
  | "interaction-request"
  | "agent-invocation"
  | "workspace-mutation"

/**
 * `turn-tool` presentation 是封闭的 UI 展示投影。普通工具只有调用身份、
 * 名称和状态；当前只有 `agent_call` 声明结构化展示内容。
 */
export type { UiToolPresentation } from "./runtime"
/**
 * turn 内 timeline 项(thought/tool/interim/user/assistant/legacy options),持久化到
 * workspace turn 文件 `save/history/turns/turn-NNNNNN.json` 的 `timeline` 字段
 * (schema v2),以及助手会话消息存储的 `ConversationMessageRecord.timeline` 字段.
 *
 * 单一有序数组替代旧的 messages + processNodes 分裂结构——数组顺序即真实发生顺序,
 * 渲染器逐项渲染即可,不需要理解 round 语义或拼装 user→processNodes→assistant.
 *
 * ask 节点(ask_user 交互)不入 TurnTimelineItem——仅存在于内存
 * AssistantTimelineNode,持久化边界拍平成 interim 文本.
 */
export type { TurnTimelineItem, AssistantTurnTimelineItem } from "./runtime"

/** 单个 turn 的 token 消耗统计，供前端在正文末尾显示 meta 行。
 *  耗时由前端自己计时（setInterval），不在此结构中——本结构只承载
 *  前端无法自行获取的 provider token usage。所有字段可选。
 *  定义在 runtime.ts(避免循环依赖),此处 re-export 保持现有 import 路径。 */
export type { TurnStats } from "./runtime"

/**
 * 单个 turn 的完整玩家视角数据,由 host 从 workspace turn 文件重建,
 * 经 `query.query({ resource: "session-history" })` 一次返回全部 turn.
 * 前端用此数据单源重建完整对话(timeline 逐项渲染),不依赖 snapshot 渲染.
 *
 * timeline 是单一有序数组,含 user/assistant/interim/thought/tool 以及 legacy options 项,
 * 按真实发生顺序排列.stats 归入 assistant item(不再在 entry 层).
 */
export interface SessionHistoryEntry {
  turn: number
  createdAt: string
  /** turn 内完整 timeline(user + process items + assistant + legacy options),按发生顺序.
   *  替代旧的 messages + processNodes + stats 分裂结构. */
  timeline: TurnTimelineItem[]
}

export type RemotePlayBridgeEventPayload =
  | Record<string, never>
  | {
      turn: number
      assistant?: AssistantTurnTimelineItem
    }
  | {
      agentId: string
      delta: string
      turn: number
      round: number
      kind: "reasoning" | "content"
    }
  | {
      agentId: string
      turn: number
      round: number
      kind: "thought" | "final"
    }
  | {
      agentId: string
      turn: number
      round: number
      callId: string
      name: string
      /** Optional player-facing Tool title. Falls back to `name` when absent. */
      displayName?: string
      status: "loading" | "running" | "success" | "failed"
      presentation?: UiToolPresentation
    }
  | {
      turn: number
      stats: TurnStats
    }
  | {
      turn: number
      options: string[]
    }
  | {
      requestId: string
      question: string
      options?: string[]
      allowCustom?: boolean
    }
  | AgentInvocationEvent
  | RuntimeWorkspaceMutationEvent
  | {
      agentId: string
      kind: "delta" | "tool" | "round-end"
    }

export interface RemotePlayBridgeEventMessage {
  channel: RemotePlayBridgeChannel
  kind: "event"
  sessionId: string
  event: RemotePlayBridgeEventName
  payload?: RemotePlayBridgeEventPayload
}

export type RemotePlayBridgeMessage =
  | RemotePlayBridgeHelloMessage
  | RemotePlayBridgeReadyMessage
  | RemotePlayBridgeRequestMessage
  | RemotePlayBridgeResponseMessage
  | RemotePlayBridgeEventMessage
