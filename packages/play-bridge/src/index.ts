// @tsian/play-bridge — 游戏前端领域 API
//
// 对外导出 createTsian() + 领域类型。表现层通过 createTsian() 拿到 TsianApi
// 实例，只用 tsian.send / tsian.onMessage / ... 与平台交互。
//
// 协议层（createBridge / Bridge）是包内部实现，不公开导出——前端开发者不需要
// 接触 RPC method 字符串或 params 结构。
//
// 详见 docs/sdk/play-frontend-api.md（API 文档）。

export { createTsian } from "./tsian-api"
export type {
  TsianApi,
  SendOptions,
  InvokeAgentOptions,
  MessageDelta,
  RoundEnd,
  TurnEndResult,
  ToolEvent,
  AskRequest,
  SessionHistory,
} from "./tsian-api"

// parseStoryOptions 是纯解析工具（前端流式渲染时用，不涉及 RPC），保留独立导出。
export { parseStoryOptions } from "./story-options"
export type { ParsedStoryOptions } from "./story-options"

// 领域类型从 @tsian/contracts re-export，消费方无需额外 import contracts。
export type {
  InjectionMessage,
  InvokeAgentResult,
  TurnStats,
  TurnToolOutput,
  SessionHistoryEntry,
  CheckpointSummary,
  ConversationMessageRecord,
  TurnTimelineItem,
  WorkspaceReadResult,
  WorkspaceEntry,
  WorkspaceSearchResult,
  WorkspaceWriteResult,
  WorkspaceScope,
} from "@tsian/contracts"
