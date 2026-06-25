import type { AiDebugRecord } from "./debug"
import type {
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  JsonValue,
  MessageInteractionRequest,
  MessageInteractionResult,
  PlatformActionRequest,
  PlatformActionResult,
  PlatformContextShell,
  RuntimeSnapshotShell,
} from "./runtime"

export interface RuntimeBridge {
  getRuntimeSnapshot(): Promise<RuntimeSnapshotShell>
}

export interface InteractionBridge {
  sendMessage(input: MessageInteractionRequest): Promise<MessageInteractionResult>
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
  runtime: RuntimeBridge
  interaction: InteractionBridge
  query: QueryBridge
  platform: PlatformBridge
  debug?: DebugBridge
}

export type RemotePlayBridgeChannel = "tsian.play-bridge.v1"

export type RemotePlayBridgeMethod =
  | "runtime.getRuntimeSnapshot"
  | "interaction.sendMessage"
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
  | RuntimeSnapshotShell
  | MessageInteractionResult
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
export type TurnToolOutput =
  | string
  | {
      type: "agent_call"
      targetAgent: {
        id: string
        title: string
        summary?: string
      }
      response: string
      status: "completed" | "failed"
      error?: {
        code: string
        message: string
      }
    }

/**
 * turn 内过程节点(thought/tool/interim),持久化到 workspace turn 文件
 * `save/history/turns/turn-NNNNNN.json` 的 `processNodes` 字段.
 *
 * 与 composable 层的 `AssistantTimelineNode` 同构,多一个可选 `agentId` 字段
 * (单 agent 场景如桌面助手可省,多 agent 场景如 delegated agent_call 必填,
 * 让前端区分过程节点来自哪个 agent).
 *
 * - thought: tool_calls 轮的推理思维链,默认折叠.
 * - tool: 工具调用节点,按 callId 去重,output 带 agent_call 结构化分支.
 * - interim: tool_calls 轮模型在调用工具前输出的过渡文本(如"我先看一下…"),
 *   当正常可见回复处理,始终展开.
 *
 * 从事件流(onDelta/onRoundEnd/onTool)累积而来——interim 语义只能从事件流
 * 重建(靠 turn-round-end 的 kind=thought 区分过渡叙事 vs 最终回复),
 * runtimeMessages 里 assistant.content 无法区分.
 */
export type TurnProcessNode =
  | { type: "thought"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }
  | {
      type: "tool"
      id: string
      round: number
      agentId?: string
      name: string
      status: "loading" | "running" | "success" | "failed"
      output?: TurnToolOutput
      collapsed: boolean
    }
  | { type: "interim"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }

/**
 * 单个 turn 的完整玩家视角数据,由 host 从 workspace turn 文件重建,
 * 经 `query.query({ resource: "session-history" })` 一次返回全部 turn.
 * 前端用此数据单源重建完整对话(正文 + 过程节点),不依赖 snapshot 渲染.
 */
export interface SessionHistoryEntry {
  turn: number
  createdAt: string
  messages: ConversationMessageRecord[]
  /** turn 内过程节点(native 模式有,text 模式可能为空). */
  processNodes?: TurnProcessNode[]
}

export type RemotePlayBridgeEventPayload =
  | {
      snapshot: RuntimeSnapshotShell
    }
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
