import type {
  AgentContextSnapshot,
  AgentContextToolCall,
  AiChatMessage,
  AskUserRequest,
  AskUserResult,
  ContentPart,
  ConversationMessageRecord,
  PlatformActionRequest,
  PlatformActionResult,
  RuntimeSnapshotShell,
  TurnProcessNode,
  TurnToolOutput,
  WorkspaceFile,
  WorkspaceOperationName,
} from "@tsian/contracts"
import type { CompressCallModel, TaskCompressionResult } from "./context-lifecycle"
import type { RuntimeTraceDebugLabel, RuntimeTraceEmitter } from "./trace"
import type { ToolSchema } from "./tool-schemas"
import type { RuntimeActionExecutorPolicy, RuntimeAgentCallHistoryMode, RuntimeControlledExecutorContext, RuntimeBrowserScriptExecutorRequest, InspectFrontendInput, InspectFrontendResult } from "./workspace-tools"
import type { ModelCallResult, NativeToolCall, RuntimeChatMessage } from "../runtime-host/ai"
import type { BrowserAiToolCallMode } from "../config/ai"
import type { WorkspaceOperationMutationAdapter } from "./workspace-operations"

// RuntimeCompressionMode first (referenced by AgentRuntimeTurnInput)
export type RuntimeCompressionMode = "narrative" | "task"

export interface AgentRuntimeTurnInput {
  agentId: string
  userInput: string
  /** 本轮附件图片的 ContentPart 列表(助手聊天附件用). 有值时本轮输入 user
   *  消息的 content 变为 ContentPart[](text + image parts),无值时保持 string. */
  userInputAttachments?: ContentPart[]
  recentHistory: ConversationMessageRecord[]
  snapshot: RuntimeSnapshotShell
  workspaceFiles?: WorkspaceFile[]
  signal?: AbortSignal
  /**
   * Streaming text-delta sink. Invoked for every streamed text chunk across all
   * tool-loop rounds (thought-round text included — the whole turn streams, no
   * reset). `agentId` identifies which agent is emitting (the entry agent, or a
   * delegated `agent_call` target); `round` is that agent's tool-loop round index
   * so the caller can label thought vs final. `kind` separates chain-of-thought
   * (`"reasoning"`) from the visible reply (`"content"`) so callers can route
   * reasoning to a distinct, typically collapsed UI region. Delegated agents may
   * stream via the non-SSE fallback depending on their model config.
   */
  onDelta?: (agentId: string, delta: string, round: number, kind: "reasoning" | "content") => void
  /**
   * Per-round end notification (子2b R1). Invoked after each `callModelNative`
   * returns, with the round index and finish reason so the caller can classify
   * the round as thought (`tool_calls`) or final (`stop`) and label the streamed
   * text accordingly. `agentId` identifies the emitting agent. `undefined`
   * disables round-end events.
   */
  onRoundEnd?: (agentId: string, round: number, finishReason: "stop" | "tool_calls") => void
  /**
   * Tool-call status/output notification (子2b R2). Invoked before/after each
   * workspace tool executes, with the round index and tool identity so the
   * caller can render the tool process. `agentId` identifies which agent's tool
   * loop the call belongs to (distinguishes parallel delegated agents).
   * `undefined` disables tool events.
   */
  onTool?: (
    agentId: string,
    round: number,
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: TurnToolOutput,
  ) => void
  /**
   * ask_user 工具回调（ask_user R3）。工具执行时 await 此回调，阻塞 turn 等待
   * 玩家回答。host 侧绑定为 emitInteractionRequest，返回 Promise 在玩家回答后 resolve。
   * `undefined` 时 ask_user 返回 ASK_USER_UNAVAILABLE 错误。
   */
  onAskUser?: (requestId: string, request: AskUserRequest) => Promise<AskUserResult>
  /**
   * master agent 会话上下文快照(从工作区 `agents/master/context.json` 读取注入).
   * 提供 → buildEntryAgentMessages 用其 summary+recentTurns 拼"最近对话"区
   * (替代 turn 文件重建历史 slice(-20)).未提供 → 兜底用 recentHistory 旧逻辑.
   * 详见任务 06-19-agent-session-context-lifecycle.
   */
  agentContext?: AgentContextSnapshot
  /**
   * master agent 上下文 token 预算(已 resolve,model.contextWindow 或 256k 默认).
   * 用于 R3 压缩阈值(85% budget).未提供 → runtime 用 256k 默认.
   */
  contextTokenBudget?: number
  /**
   * 压缩模式(design 06-20-agent-task-compression):narrative=master 剧情压缩(默认);
   * task=子代理/助手任务压缩(多次+时长兜底+早退).未提供 → narrative.
   * host 给 master 传 narrative(或不传),给 assistant 传 task.
   */
  compressionMode?: RuntimeCompressionMode
  /**
   * task 模式(assistant)时长配额 ms.超时抛 TaskTimeoutError,温和中止.
   * 仅 compressionMode==="task" 生效;narrative(master)忽略.未提供 → DEFAULT_TASK_TIMEOUT_MS.
   */
  timeoutMs?: number
}

export interface AgentRuntimeTurnContextUpdate {
  turn: number
  user: string
  assistant: string
  /** 本轮开头压缩后的快照(若触发了压缩).无压缩则 undefined. */
  compressedContext?: AgentContextSnapshot
  /** 本轮工具调用记录(仅助手有,master 无).供 host 双层写入:
   *  agent context.json(recentTurns assistant entry,跟正文同寿命压缩)+
   *  UI 会话消息存储(ConversationMessageRecord.toolCalls,不压缩完整保留). */
  toolCalls?: AgentContextToolCall[]
  /** 本轮过程节点(thought/tool/interim,按发生顺序).供 host 写入会话消息存储
   *  processNodes 字段,UI 刷新后重建 timeline.仅助手有(runtime 采集,消除双写). */
  processNodes?: TurnProcessNode[]
}

export interface AgentRuntimeTurnResult {
  replyText: string
  /** 本轮正文 + 压缩结果,供 platform-host turn 收尾写 context.json. */
  contextUpdate?: AgentRuntimeTurnContextUpdate
  /**
   * 最后一轮 provider 返回的 token usage(input = 当前上下文大小).
   * 供桌面助手做上下文窗口可视化.多轮工具循环取最后一轮(它代表
   * 完整上下文发送时的 input tokens).text-protocol 路径不带 usage.
   */
  usage?: { input?: number; output?: number; total?: number }
}

export interface AgentRuntimeModelCallOptions {
  debugLabel: RuntimeTraceDebugLabel
  signal?: AbortSignal
  agentId?: string
  /**
   * Streaming text-delta sink. Invoked with the current tool-loop `round` so
   * the caller can label thought vs final rounds, and a `kind` separating
   * chain-of-thought (`"reasoning"`) from the visible reply (`"content"`).
   * `undefined` means "do not stream" (delegated agents without streaming,
   * or callers that don't want deltas) — the host then takes the non-SSE
   * fallback path. Both native and text tool-call modes support streaming
   * when the model config has `streaming: true`.
   */
  onDelta?: (agentId: string, delta: string, round: number, kind: "reasoning" | "content") => void
  /** Current tool-loop round index (set by the native loop before each call). */
  round?: number
  /** Per-round end notification (子2b R1); threaded from `AgentRuntimeTurnInput.onRoundEnd`. */
  onRoundEnd?: (agentId: string, round: number, finishReason: "stop" | "tool_calls") => void
  /** Tool-call status/output notification (子2b R2); threaded from `AgentRuntimeTurnInput.onTool`. */
  onTool?: (
    agentId: string,
    round: number,
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: TurnToolOutput,
  ) => void
  /** ask_user 工具回调；threaded from `AgentRuntimeTurnInput.onAskUser`. */
  onAskUser?: (requestId: string, request: AskUserRequest) => Promise<AskUserResult>
}

export interface AgentRuntimeCapabilities {
  callModel(
    messages: AiChatMessage[],
    options: AgentRuntimeModelCallOptions,
  ): Promise<string>
  /**
   * Native function-calling model call. Returns a structured `ModelCallResult`
   * (text / toolCalls / finishReason) instead of a flat string. The runtime
   * dispatches this when the active model's `toolCallMode === "native"`; the
   * text-protocol `callModel` path is unchanged otherwise. `messages` use the
   * structured `RuntimeChatMessage[]` shape so tool calls and tool observations
   * can be threaded back with their provider ids.
   */
  callModelNative?(
    messages: RuntimeChatMessage[],
    options: AgentRuntimeModelCallOptions,
    tools: ToolSchema[],
  ): Promise<ModelCallResult>
  /**
   * Active model's tool-call mode. Defaults to `"text"` when omitted so the
   * runtime falls back to the legacy text-protocol tool loop.
   */
  toolCallMode?: BrowserAiToolCallMode
  /**
   * inspect_frontend capability. Loads the active card's packaged frontend
   * in a hidden iframe (reusing the real /play load path), collects structural
   * + diagnostic snapshots, and can drive an ephemeral master agent turn /
   * DOM interactions. Implemented in platform-host/frontend-inspector.ts.
   */
  runInspectFrontend?(
    input: InspectFrontendInput,
  ): Promise<InspectFrontendResult>
  runBrowserScript?(
    request: RuntimeBrowserScriptExecutorRequest,
    context?: RuntimeControlledExecutorContext,
  ): Promise<PlatformActionResult>
  actionExecutorPolicy?: RuntimeActionExecutorPolicy
  workspaceMutations?: WorkspaceOperationMutationAdapter
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  collaborationPolicy?: AgentRuntimeCollaborationPolicyInput
  emitTrace?: RuntimeTraceEmitter
  /** semantic_search 专用:owner id(save-runtime 下为 saveId). host 注入,
   *  runtime 层不持有真实 saveId(见 createInitialAgentContext 注释),通过此
   *  capability 把 owner 上下文传给 workspace 工具执行. 其它 op 不用. */
  semanticSearchOwnerId?: string
}

export interface AgentRuntimeCollaborationPolicy {
  maxDepth: number
  historyWindows: Record<RuntimeAgentCallHistoryMode, number>
}

export type AgentRuntimeCollaborationPolicyInput =
  Partial<Omit<AgentRuntimeCollaborationPolicy, "historyWindows">>
  & {
    historyWindows?: Partial<Record<RuntimeAgentCallHistoryMode, number>>
  }
