import type { AiDebugRecord } from "./debug"
import type {
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
  | "query.query"
  | "platform.getPlatformContext"
  | "platform.runAction"

export type RemotePlayBridgeRequestParams =
  | MessageInteractionRequest
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
