import type { AiDebugRecord } from "./debug"
import type {
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
  TurnToolOutput,
  TurnTimelineItem,
  TurnStats,
} from "./runtime"

export interface InteractionBridge {
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
  invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult>
}

export interface QueryBridge {
  query<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>>
}

export interface PlatformBridge {
  getPlatformContext(): Promise<PlatformContextShell>
  runAction(request: PlatformActionRequest): Promise<PlatformActionResult>
}

export interface DebugBridge {
  getAiDebugRecords(): Promise<AiDebugRecord[]>
  onTurnDebugReady(cb: (turn: number) => void): () => void
}

export interface PlayFrontendBridge {
  interaction: InteractionBridge
  query: QueryBridge
  platform: PlatformBridge
  debug?: DebugBridge
}

export type RemotePlayBridgeChannel = "tsian.play-bridge.v1"

export type RemotePlayBridgeMethod =
  | "interaction.sendMessage"
  | "interaction.invokeAgent"
  | "interaction.respond"
  | "query.query"
  | "platform.getPlatformContext"
  | "platform.runAction"

/** 玩家回答 ask_user 的 RPC payload。 */
export interface AskUserResponse {
  requestId: string
  answer: string
  cancelled?: boolean
}

export type RemotePlayBridgeRequestParams =
  | MessageInteractionRequest
  | AskUserResponse
  | DeepQueryRequest
  | PlatformActionRequest
  | undefined

export type RemotePlayBridgeResponseResult =
  | MessageInteractionResult
  | InvokeAgentResult
  | DeepQueryResult<unknown>
  | PlatformContextShell
  | PlatformActionResult
  | undefined

export interface RemotePlayBridgeError {
  code: string
  message: string
  details?: Record<string, JsonValue>
}

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
      error: RemotePlayBridgeError
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

/**
 * `turn-tool` 事件 output 字段形态。
 *
 - 普通工具：output 是原始结果字符串（平台侧不再截断，完整透传，UI 侧决定显示/截断）。
 * - agent_call：output 是结构化对象，提取被调用 agent 的 title + response，
 *   让前端不用解析整坨 JSON 即可渲染玩家可读的"调了谁 + 答了什么"。
 *   截断交给 UI 侧；response 完整透传。
 *
 * discriminated union：前端按 `typeof output === "string"`（普通工具）vs
 * `typeof output === "object" && output.type === "agent_call"`（agent_call）分流渲染。
 * 旧前端收到 object output 时最坏情况是不显示（不匹配 string 渲染路径），不 break 功能。
 */
export type { TurnToolOutput } from "./runtime"
/**
 * turn 内 timeline 项(thought/tool/interim/user/assistant/options),持久化到
 * workspace turn 文件 `save/history/turns/turn-NNNNNN.json` 的 `timeline` 字段
 * (schema v2),以及助手会话消息存储的 `ConversationMessageRecord.timeline` 字段.
 *
 * 单一有序数组替代旧的 messages + processNodes 分裂结构——数组顺序即真实发生顺序,
 * 渲染器逐项渲染即可,不需要理解 round 语义或拼装 user→processNodes→assistant.
 *
 * ask 节点(ask_user 交互)不入 TurnTimelineItem——仅存在于内存
 * AssistantTimelineNode,持久化边界拍平成 interim 文本.
 */
export type { TurnTimelineItem } from "./runtime"

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
 * timeline 是单一有序数组,含 user/assistant/interim/thought/tool/options 项,
 * 按真实发生顺序排列.stats 归入 assistant item(不再在 entry 层).
 */
export interface SessionHistoryEntry {
  turn: number
  createdAt: string
  /** turn 内完整 timeline(user + process items + assistant + options),按发生顺序.
   *  替代旧的 messages + processNodes + stats 分裂结构. */
  timeline: TurnTimelineItem[]
}

export type RemotePlayBridgeEventPayload =
  | Record<string, never>
  | {
      turn: number
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
      status: "loading" | "running" | "success" | "failed"
      output?: TurnToolOutput
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
