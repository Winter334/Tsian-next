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
      output?: string
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
