// @tsian/play-bridge — 桥协议层（postMessage 握手 / RPC / 事件路由）
// 协议层唯一真相源。表现层通过 createBridge() 拿到 Bridge 实例，
// 只用 bridge.call() / bridge.on() 与平台交互，不碰 postMessage / RPC id。
//
// 详见 docs/active/play-frontend-sdk-direction.md。

export { createBridge } from "./bridge"
export type { Bridge, BridgeHandlers } from "./bridge"
export { createSessionHistory } from "./session-history"
export type { SessionHistory } from "./session-history"

// 桥相关类型从 @tsian/contracts re-export，消费方无需额外 import contracts。
export type {
  RemotePlayBridgeChannel,
  RemotePlayBridgeMethod,
  RemotePlayBridgeRequestParams,
  RemotePlayBridgeResponseResult,
  RemotePlayBridgeError,
  RemotePlayBridgeHelloMessage,
  RemotePlayBridgeReadyMessage,
  RemotePlayBridgeRequestMessage,
  RemotePlayBridgeResponseMessage,
  RemotePlayBridgeEventName,
  TurnToolOutput,
  RemotePlayBridgeEventPayload,
  RemotePlayBridgeEventMessage,
  RemotePlayBridgeMessage,
  AskUserResponse,
} from "@tsian/contracts"

// 事件 payload 内嵌的快照与消息记录类型，表现层渲染要用。
export type {
  RuntimeSnapshotShell,
  ConversationMessageRecord,
  MessageInteractionRequest,
  MessageInteractionResult,
  AskUserRequest,
  AskUserResult,
  TurnProcessNode,
  SessionHistoryEntry,
} from "@tsian/contracts"
