import type {
  AgentRegistryEntry,
  AgentContextEntry,
  AgentContextSnapshot,
  AiChatMessage,
  ConversationMessageRecord,
  AgentPlatformToolName,
  PlatformActionRequest,
  PlatformActionResult,
  RuntimeSnapshotShell,
  WorkspaceFile,
  WorkspaceOperationName,
} from "@tsian/contracts"
import { assembleAgentContext } from "./context"
import {
  AGENT_CONTEXT_AGENT_ID,
  appendTurnToContext,
  ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT,
  compressContext,
  compressTaskContext,
  CONTEXT_COMPRESS_TRIGGER_RATIO,
  ContextBudgetExhaustedError,
  ContextCompressionFailedError,
  createInitialAgentContext,
  DEFAULT_TASK_TIMEOUT_MS,
  estimateAiChatMessagesTokens,
  estimateContextTokens,
  estimateRuntimeMessagesTokens,
  resolveTokenBudget,
  serializeAgentContext,
  TASK_COMPRESSION_STALL_RATIO,
  TaskCompressionStalledError,
  TaskTimeoutError,
  type CompressCallModel,
  type CompressCallOptions,
  type TaskCompressionResult,
} from "./context-lifecycle"
import {
  AGENT_PLATFORM_TOOL_NAMES,
  deriveAgentRuntimePermissionProfile,
  isAgentPlatformToolEnabled,
} from "./permissions"
import { buildAgentRegistry } from "./registry"
import {
  buildEnabledToolSchemas,
  type ToolSchema,
} from "./tool-schemas"
import type { RuntimeTraceDebugLabel, RuntimeTraceEmitter } from "./trace"
import { errorToTraceData } from "./trace"
import {
  createRuntimeWorkspaceToolSessionState,
  executeRuntimeWorkspaceToolCalls,
  formatRuntimeWorkspaceToolObservationMessage,
  parseRuntimeWorkspaceToolCalls,
  RUNTIME_WORKSPACE_TOOL_NAMES,
  stripRuntimeWorkspaceToolCallBlocks,
  type RuntimeActionExecutorPolicy,
  type RuntimeControlledExecutorContext,
  type ParsedRuntimeWorkspaceToolCall,
  type RuntimeAgentCallArguments,
  type RuntimeAgentCallHistoryMode,
  type RuntimeBrowserScriptExecutorRequest,
  type RuntimeWorkspaceToolObservation,
  type RuntimeWorkspaceToolSessionState,
  collectActivatedSkillContents,
  type ActivatedSkillContent,
} from "./workspace-tools"
import type {
  ModelCallResult,
  NativeToolCall,
  RuntimeChatMessage,
} from "../runtime-host/ai"
import type { BrowserAiToolCallMode } from "../config/ai"
import type { WorkspaceOperationMutationAdapter } from "./workspace-operations"

export interface AgentRuntimeTurnInput {
  agentId: string
  userInput: string
  recentHistory: ConversationMessageRecord[]
  snapshot: RuntimeSnapshotShell
  workspaceFiles?: WorkspaceFile[]
  signal?: AbortSignal
  /**
   * Streaming text-delta sink. Invoked for every streamed text chunk across all
   * tool-loop rounds (thought-round text included — the whole turn streams, no
   * reset). `agentId` identifies which agent is emitting (the entry agent, or a
   * delegated `agent_call` target); `round` is that agent's tool-loop round index
   * so the caller can label thought vs final. Delegated agents may stream via
   * the non-SSE fallback depending on their model config.
   */
  onDelta?: (agentId: string, delta: string, round: number) => void
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
    output?: string,
  ) => void
  /**
   * master agent 会话上下文快照(从工作区 `agents/master/context.json` 读取注入).
   * 提供 → buildEntryAgentMessages 用其 summary+recentTurns 拼"最近对话"区
   * (替代 saveHistory slice(-20)).未提供 → 兜底用 recentHistory 旧逻辑.
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

/** 解析 entry 路径压缩模式:未传默认 narrative(master 路径). */
function resolveEntryCompressionMode(input: AgentRuntimeTurnInput): RuntimeCompressionMode {
  return input.compressionMode ?? "narrative"
}

/** turn 结束时需写回 context.json 的本轮正文 + 压缩结果(若有). */
export interface AgentRuntimeTurnContextUpdate {
  turn: number
  user: string
  assistant: string
  /** 本轮开头压缩后的快照(若触发了压缩).无压缩则 undefined. */
  compressedContext?: AgentContextSnapshot
}

export interface AgentRuntimeTurnResult {
  replyText: string
  agentSessionTranscripts: AgentSessionTranscriptRecord[]
  /** 本轮正文 + 压缩结果,供 platform-host turn 收尾写 context.json. */
  contextUpdate?: AgentRuntimeTurnContextUpdate
}

export interface AgentRuntimeModelCallOptions {
  debugLabel: RuntimeTraceDebugLabel
  signal?: AbortSignal
  agentId?: string
  /**
   * Streaming text-delta sink. Invoked with the current tool-loop `round` so
   * the caller can label thought vs final rounds. `undefined` means "do not
   * stream" (delegated agents, or text-protocol callers) — the host then takes
   * the non-SSE fallback path.
   */
  onDelta?: (agentId: string, delta: string, round: number) => void
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
    output?: string,
  ) => void
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
  runBrowserScript?(
    request: RuntimeBrowserScriptExecutorRequest,
    context?: RuntimeControlledExecutorContext,
  ): Promise<PlatformActionResult>
  actionExecutorPolicy?: RuntimeActionExecutorPolicy
  workspaceMutations?: WorkspaceOperationMutationAdapter
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  collaborationPolicy?: AgentRuntimeCollaborationPolicyInput
  emitTrace?: RuntimeTraceEmitter
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

const ENTRY_AGENT_PLATFORM_GUARD = [
  "你是当前回合的入口 Agent。",
  "你会收到自己的 AGENT.md、可选 SOUL.md、最近对话（含早期剧情摘要）、工作区上下文和玩家本轮输入。",
  "根据 AGENT.md 的指引决定如何处理本轮输入。如果需要，可以通过 agent_call 联系你的联系人 Agent 获取专业判断。",
  "你的输出是对话的最终回复，直接面向玩家或用户。",
].join("\n")

const DELEGATED_AGENT_PLATFORM_GUARD = [
  "你是 Tsian AIRP 中被 agent_call 临时调用的专业 Agent。",
  "你会收到自己的 AGENT.md、可选 SOUL.md、工作区上下文、调用方请求、必要的最近对话和玩家本轮输入。",
  "你不直接面对玩家；你的输出会作为 observation 返回给调用方，由调用方决定如何使用。",
  "请专注回答调用方请求，返回建议、判断、草案、连续性检查或需要沉淀的事实提示。",
  "如果工具说明中列出了可联系 Agent，你可以在确有必要时通过 agent_call 咨询自己的联系人；否则请把需要协作的建议写在输出里。",
].join("\n")

const DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY: AgentRuntimeCollaborationPolicy = {
  maxDepth: 2,
  historyWindows: {
    minimal: 0,
    recent: 6,
    scene: 12,
  },
}

interface AgentCallTurnState {
  callCount: number
}

/**
 * 压缩模式(design 06-20-agent-task-compression):
 * - `narrative`: master 叙事型,压剧情正文(summary+recentTurns),一次压缩 + 第二次达预算
 *   抛 ContextBudgetExhaustedError(tool-token-budget R2 逻辑,保持不动).
 * - `task`: 子代理/助手任务型,压工具交互段(assistant toolCalls + tool observation),多次压缩
 *   不限次 + 时长兜底(TaskTimeoutError) + 压缩无效早退(TaskCompressionStalledError).
 */
export type RuntimeCompressionMode = "narrative" | "task"

interface WorkspaceToolLoopOptions {
  agentCallState: AgentCallTurnState
  agentCallDepth: number
  collaborationPolicy: AgentRuntimeCollaborationPolicy
  /** 压缩模式:narrative=master 剧情压缩;task=子代理/助手任务压缩.决定压缩块分流. */
  compressionMode: RuntimeCompressionMode
  /**
   * narrative 模式:master 会话上下文快照(turn 开头压缩后已是更新值).turn 内压剧情就
   * 地更新它(Object.assign),循环结束后透传回 runAgentRuntimeTurn 落盘.
   * task 模式不用(任务型 agent 无跨 turn 快照).
   * 未传(narrative 兜底路径)→ 工具循环不做 turn 内压剧情,但仍做预算兜底.
   */
  agentContextSnapshot?: AgentContextSnapshot
  /** token 预算(turn 开头已 resolve).达 85% 触发压缩/兜底.两模式共用. */
  contextTokenBudget?: number
  /** 压缩用的 model 调用(复用 capabilities.callModel).两模式共用. */
  compressCallModel?: CompressCallModel
  /** task 模式:时长兜底起点 wall-clock(Date.now()).超 taskTimeoutMs 抛 TaskTimeoutError.narrative 不用. */
  taskStartedAt?: number
  /** task 模式:时长配额 ms(默认 DEFAULT_TASK_TIMEOUT_MS).narrative 不用. */
  taskTimeoutMs?: number
}

interface AgentCallRuntimeMetadata {
  callerAgentId: string
  targetAgentId: string
  callerDepth: number
  targetDepth: number
  maxDepth: number
  callCount: number
  historyMode: RuntimeAgentCallHistoryMode
}

export const AGENT_SESSION_TRANSCRIPT_SCHEMA = "tsian.agent.session.transcript.v1"

export type AgentSessionTranscriptRole = "entry" | "delegated"
export type AgentSessionTranscriptStatus = "completed" | "tool-continued"

export interface AgentSessionTranscriptRecord {
  schema: typeof AGENT_SESSION_TRANSCRIPT_SCHEMA
  turn: number
  createdAt: string
  agentId: string
  agentTitle: string
  agentPath: string
  role: AgentSessionTranscriptRole
  debugLabel: RuntimeTraceDebugLabel
  modelCallIndex: number
  round: number
  status: AgentSessionTranscriptStatus
  messages: AiChatMessage[]
  modelOutput: string
  toolCalls: ParsedRuntimeWorkspaceToolCall[]
  toolObservations: RuntimeWorkspaceToolObservation[]
}

interface AgentSessionTranscriptCollector {
  records: AgentSessionTranscriptRecord[]
  nextModelCallIndex: number
}

function normalizePolicyInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback
  }

  return Math.floor(value)
}

function normalizeAgentRuntimeCollaborationPolicy(
  input: AgentRuntimeCollaborationPolicyInput | undefined,
): AgentRuntimeCollaborationPolicy {
  const defaults = DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY
  return {
    maxDepth: normalizePolicyInteger(input?.maxDepth, defaults.maxDepth),
    historyWindows: {
      minimal: normalizePolicyInteger(input?.historyWindows?.minimal, defaults.historyWindows.minimal),
      recent: normalizePolicyInteger(input?.historyWindows?.recent, defaults.historyWindows.recent),
      scene: normalizePolicyInteger(input?.historyWindows?.scene, defaults.historyWindows.scene),
    },
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Agent Runtime turn was aborted.", "AbortError")
  }
}

function normalizeHistory(
  history: ConversationMessageRecord[],
): ConversationMessageRecord[] {
  return history
    .filter((message) => typeof message.content === "string" && message.content.trim())
    .map((message) => ({
      role: message.role || "unknown",
      content: message.content,
    }))
    .slice(-20)
}

function formatHistory(history: ConversationMessageRecord[]): string {
  if (history.length === 0) {
    return "（暂无历史对话）"
  }

  return history
    .map((message, index) => {
      const role = message.role === "assistant"
        ? "叙事"
        : message.role === "user"
          ? "玩家"
          : message.role
      return `${index + 1}. ${role}: ${message.content}`
    })
    .join("\n")
}

/**
 * 把 master agent 会话上下文快照展开为独立 message 序列(剧情正文层).
 *
 * summary(若有)作一条 user message 前言(早期剧情梗概);recentTurns 每条
 * 展开为独立 user/assistant message(原文,不加"12. 玩家:"前缀——role 已表达
 * 角色,turn 索引不进 content 以免污染正文).空 recentTurns 时给一条占位 user
 * message("（暂无历史对话）")保持对话结构完整.
 *
 * 独立 message 序列(而非塞进一条 user message content)的原因:剧情压缩的
 * 核心操作是"保留最近 K 轮、压早期轮次",一轮 = 一对 user/assistant message,
 * 按 message 边界操作比在格式化文本里做字符串切片健壮;且与 context.json 的
 * recentTurns 结构化数据形态直接映射,无"结构化→文本→结构化"往返.
 * 详见任务 06-19-agent-session-context-lifecycle 收尾结构修正.
 */
function buildAgentContextMessages(context: AgentContextSnapshot): AiChatMessage[] {
  const messages: AiChatMessage[] = []
  if (context.summary) {
    messages.push({ role: "user", content: `早期剧情摘要：\n${context.summary}` })
  }
  if (context.recentTurns.length === 0) {
    if (!context.summary) {
      // 无 summary 也无 recentTurns:给一条占位,保持"有历史对话区"的结构
      messages.push({ role: "user", content: "（暂无历史对话）" })
    }
    // 有 summary 但无 recentTurns:summary 已是历史区,不再加占位
  } else {
    for (const entry of context.recentTurns) {
      messages.push({ role: entry.role, content: entry.content })
    }
  }
  return messages
}

/**
 * 定位工具循环 messages 里的剧情正文段边界,供 turn 内压剧情后 slice+替换用
 * (design §2.4).剧情段 = system(index 0)之后、"当前回合："框架信息 user 之前的
 * 独立 message 序列(summary + recentTurns).
 *
 * 返回 { start, end }(半开区间),start<0 表示无独立剧情段可压,调用方跳过压缩:
 * - entry 稳态路径(注入了 agentContext):start=1, end="当前回合："前.
 * - entry 兜底路径(未注入,剧情段首条是"最近对话："拍扁文本):{-1,-1}.
 * - delegated agent 路径(index 1 直接是"当前回合：",无独立剧情段):{-1,-1}.
 * - 无"当前回合："锚点(结构不符):{-1,-1}.
 */
function locateHistorySpan(
  messages: ReadonlyArray<{ role: string; content: string }>,
): { start: number; end: number } {
  if (messages.length <= 1 || messages[0].role !== "system") {
    return { start: -1, end: -1 }
  }
  const first = messages[1]
  // delegated:index 1 直接是"当前回合："框架信息,无独立剧情段;
  // entry 兜底:剧情段首条是"最近对话："拍扁文本,无独立 message 序列可压.
  if (
    first.role === "user"
    && (first.content.startsWith("当前回合：") || first.content.startsWith("最近对话："))
  ) {
    return { start: -1, end: -1 }
  }
  let end = -1
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i].role === "user" && messages[i].content.startsWith("当前回合：")) {
      end = i
      break
    }
  }
  if (end === -1) {
    return { start: -1, end: -1 }
  }
  return { start: 1, end }
}

/**
 * 用压缩后的快照重建剧情段并 splice 替换原段(design §2.4).native 循环的
 * newMessages 需先经 aiChatMessagesToRuntime 转换,text 循环直接用
 * buildAgentContextMessages 产出的 AiChatMessage[].system / 框架信息 /
 * 本轮输入 / 后续 tool 交互保留不动.
 */
function replaceHistorySpan<T extends { role: string; content: string }>(
  messages: T[],
  span: { start: number; end: number },
  newMessages: T[],
): void {
  messages.splice(span.start, span.end - span.start, ...newMessages)
}

/**
 * 列举一个 message 是否属于"工具交互"(供 locateTaskInteractionSpan 从末尾向前扫描).
 * - native 形态:`role === "tool"` 或 `role === "assistant" && toolCalls?.length > 0`.
 * - text 形态:`role === "user" && content 含 <tsian-tool-observation>` 或
 *   `role === "assistant" && content 含 <tsian-tool-call>`.
 *
 * 框架段 user(含历史窗口/目标上下文/请求等 section)不含这些标签,不会被误判为工具交互.
 */
function isTaskInteractionMessage(
  message: { role: string; content: string; toolCalls?: unknown[] },
  mode: "native" | "text",
): boolean {
  if (mode === "native") {
    if (message.role === "tool") return true
    if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
      return true
    }
    return false
  }
  // text
  if (message.role === "user" && message.content.includes("<tsian-tool-observation>")) return true
  if (message.role === "assistant" && message.content.includes("<tsian-tool-call>")) return true
  return false
}

/**
 * 定位任务型 messages 的工具交互段边界,供任务压缩 slice+替换用(design §2.8).
 * 工具交互段 = 框架段之后到 messages 末尾(assistant toolCalls + tool observation 交替).
 * 从末尾向前扫描,跳过所有"工具交互 message",定位到第一条"非工具交互"message 的下一索引.
 *
 * 两种 messages 结构都适用(delegated 单条框架 user / assistant entry 多条框架),扫描逻辑
 * 不依赖框架段锚点,只依赖工具交互的 message 形态.兜底(无工具交互)→ {-1,-1},跳过压缩.
 */
function locateTaskInteractionSpan(
  messages: ReadonlyArray<{ role: string; content: string; toolCalls?: unknown[] }>,
  mode: "native" | "text",
): { start: number; end: number } {
  if (messages.length === 0) return { start: -1, end: -1 }
  let idx = messages.length - 1
  while (idx >= 0 && isTaskInteractionMessage(messages[idx], mode)) {
    idx -= 1
  }
  // idx 指向最后一条"非工具交互"message(或 -1 表示全是工具交互,异常结构).
  // 工具交互段起点 = idx + 1.若 idx+1 >= messages.length → 无工具交互段.
  const start = idx + 1
  if (start >= messages.length) return { start: -1, end: -1 }
  return { start, end: messages.length }
}

function currentRuntimeTurnNumber(input: AgentRuntimeTurnInput): number {
  return input.snapshot.state.turn + 1
}

function formatWorkspaceFile(file: WorkspaceFile): string {
  const content = file.content.trim() || "（空文件）"
  return [
    `--- ${file.path} (${file.mediaType}) ---`,
    content,
  ].join("\n")
}

function formatOptionalWorkspaceFile(
  label: string,
  file: WorkspaceFile | undefined,
): string {
  if (!file) {
    return `${label}：\n（未提供）`
  }

  return `${label}：\n${formatWorkspaceFile(file)}`
}

function formatContextFiles(context: AgentContextEntry): string {
  if (context.contextFiles.length === 0) {
    return "（暂无已加载 contextPaths 文件）"
  }

  return context.contextFiles.map(formatWorkspaceFile).join("\n\n")
}

function formatMissingContextPaths(context: AgentContextEntry): string {
  if (context.missingContextPaths.length === 0) {
    return "（无缺失 contextPaths）"
  }

  return context.missingContextPaths.map((path) => `- ${path}`).join("\n")
}

function formatSkillIndex(context: AgentContextEntry): string {
  if (context.skillIndex.length === 0) {
    return "（暂无可见 Skill）"
  }

  return context.skillIndex
    .map((skill) => {
      const scope = skill.scope === "agent-local"
        ? "local"
        : "shared"
      const triggers = skill.triggers.length
        ? ` triggers=${skill.triggers.join(", ")}`
        : ""
      const appliesTo = skill.appliesTo.length
        ? ` appliesTo=${skill.appliesTo.join(", ")}`
        : ""
      const headline = `- ${skill.name} [${scope}]: ${skill.description || skill.summary || "（无描述）"}${triggers}${appliesTo}`
      const actionLines = skill.actions?.length
        ? skill.actions.map((action) =>
            `    - ${action.name} (${action.executorType}, 用 run_script 执行)`,
          )
        : []
      const errorLines = skill.actionDeclarationErrors?.length
        ? skill.actionDeclarationErrors.map((error) => `    ⚠ ${error}`)
        : []
      return [headline, ...(actionLines.length ? ["    actions:", ...actionLines] : []), ...errorLines]
        .join("\n")
    })
    .join("\n")
}

/**
 * Build the context message body for a skill whose full SKILL.md was activated
 * via use_skill. The framework injects this as a user message after the round's
 * tool observations so the model sees the full skill text in the next round
 * without spending a tool-result round on it. Both tool loops (native and text)
 * call this via collectActivatedSkillContents + this body builder.
 */
function formatActivatedSkillMessageBody(skill: ActivatedSkillContent): string {
  return [
    `已激活 Skill「${skill.name}」。以下是该 Skill 的完整说明；遵循其指导，并用 run_script 执行其声明的 browser_script action。`,
    "",
    skill.content,
  ].join("\n")
}

/**
 * Inject full SKILL.md content for skills newly activated via use_skill into
 * the native tool-loop message array. Called after the round's tool
 * observations are threaded back, before the next model call. Mutates
 * `messages` in place (native loop uses a mutable array).
 */
function injectActivatedSkillMessagesNative(
  messages: RuntimeChatMessage[],
  sessionState: RuntimeWorkspaceToolSessionState | undefined,
  workspaceFiles: WorkspaceFile[],
): void {
  const contents = collectActivatedSkillContents(sessionState, workspaceFiles)
  for (const skill of contents) {
    messages.push({
      role: "user",
      content: formatActivatedSkillMessageBody(skill),
    })
  }
}

/**
 * Inject full SKILL.md content for skills newly activated via use_skill into
 * the text tool-loop message array. Returns a new array (text loop keeps an
 * immutable nextMessages style).
 */
function injectActivatedSkillMessagesText(
  messages: AiChatMessage[],
  sessionState: RuntimeWorkspaceToolSessionState | undefined,
  workspaceFiles: WorkspaceFile[],
): AiChatMessage[] {
  const contents = collectActivatedSkillContents(sessionState, workspaceFiles)
  if (contents.length === 0) {
    return messages
  }
  const injected: AiChatMessage[] = contents.map((skill) => ({
    role: "user",
    content: formatActivatedSkillMessageBody(skill),
  }))
  return [...messages, ...injected]
}

function getVisibleAgentContacts(
  workspaceFiles: WorkspaceFile[],
  context: AgentContextEntry,
): AgentRegistryEntry[] {
  const agentsById = new Map(
    buildAgentRegistry(workspaceFiles).map((agent) => [agent.id, agent]),
  )
  const seen = new Set<string>()
  const contacts: AgentRegistryEntry[] = []

  for (const rawContactId of context.agent.contacts) {
    const contactId = rawContactId.trim()
    if (!contactId || seen.has(contactId)) {
      continue
    }
    seen.add(contactId)
    const contact = agentsById.get(contactId)
    if (contact) {
      contacts.push(contact)
    }
  }

  return contacts
}

function canExposeAgentCallInPrompt(
  policy: AgentRuntimeCollaborationPolicy,
  state: AgentCallTurnState,
  depth: number,
  visibleContacts: AgentRegistryEntry[],
): boolean {
  return visibleContacts.length > 0
    && depth < policy.maxDepth
}

function formatVisibleAgentContacts(contacts: AgentRegistryEntry[]): string {
  if (contacts.length === 0) {
    return "（暂无可联系 Agent）"
  }

  return contacts
    .map((contact) =>
      `- ${contact.id} — ${contact.title}: ${contact.summary || "（无摘要）"}`
    )
    .join("\n")
}

function platformToolEnabled(
  tools: AgentPlatformToolName[],
  tool: AgentPlatformToolName,
): boolean {
  return tools.includes(tool)
}

function buildWorkspaceToolInstructions(
  options: {
    allowAgentCall: boolean
    visibleContacts: AgentRegistryEntry[]
    enabledPlatformTools: AgentPlatformToolName[]
    toolCallMode?: BrowserAiToolCallMode
  },
): string {
  const canCallAgents = options.allowAgentCall && options.visibleContacts.length > 0
  const canReadWorkspace = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.workspaceRead,
  )
  const canWriteWorkspace = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.workspaceWrite,
  )
  const isNative = options.toolCallMode === "native"
  const availableTools = [
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.useSkill} arguments={"name":"prose-style"}`,
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.runScript} arguments={"skill":"prose-style","script":"example_action","input":{"text":"示例"}}`,
    ...(canCallAgents
      ? [
          `- ${RUNTIME_WORKSPACE_TOOL_NAMES.agentCall} arguments={"agentId":"${options.visibleContacts[0].id}","request":"请检查当前场景的连续性。","historyMode":"recent"}`,
        ]
      : []),
    ...(canReadWorkspace
      ? [
          `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead} arguments={"scope":"effective","path":"world/canon.md"}`,
          `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList} arguments={"scope":"effective","path":"skills"}，path 可省略表示根目录`,
          `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch} arguments={"scope":"effective","query":"关键词","limit":10}`,
        ]
      : []),
    ...(canWriteWorkspace
      ? [
          `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspacePatch} arguments={"scope":"save-runtime","path":"save/world/notes.md","content":"..."}`,
        ]
      : []),
  ]
  return [
    "你可以按需使用 Runtime 工具读取更多上下文。工具是可选的，只在当前上下文不足时使用。",
    `如果需要使用某个 Skill，调用 ${RUNTIME_WORKSPACE_TOOL_NAMES.useSkill} 并传入可见 Skill Index 中的 name。这是两步流程的第一步：use_skill 只声明意图并注册该 Skill 的 action，框架会在下一轮自动把完整 SKILL.md 注入上下文（你不需要手动读取它）。`,
    ...(canReadWorkspace
      ? [
          `不要用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead} 读取 Skill 入口文件；用 ${RUNTIME_WORKSPACE_TOOL_NAMES.useSkill} 激活后框架自动注入全文。`,
          `注入的 SKILL.md 会说明什么时候读取哪些 references、examples、schemas、scripts 或其它工作区文件。只有执行到这些引用步骤时，才使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch} 读取具体资源。读操作需要显式传入 scope，通常使用 "effective"。`,
        ]
      : []),
    `use_skill 激活 Skill 后，用 ${RUNTIME_WORKSPACE_TOOL_NAMES.runScript} 执行它声明的 browser_script action（传入 use_skill 返回的 action name 作为 script）。run_script 只执行 browser_script 类 action；单次 workspace 读写直接用顶层 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceWrite} 等工具，多步编排写进 browser_script 脚本。`,
    "browser_script 会运行 Skill 目录下的脚本，并通过 Tsian SDK 访问 workspace、fetch、log/trace；只在你信任该 Skill 并且确实需要脚本能力时使用。脚本中的 workspace 读写仍受当前 Agent 权限限制。",
    ...(canCallAgents
      ? [
          `如果当前任务需要联系人 Agent 的专业判断，可以使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.agentCall} 发起一次性会诊。被调用 Agent 的输出只会作为 observation 返回给你，不会直接成为玩家回复。`,
          "可联系 Agent：",
          formatVisibleAgentContacts(options.visibleContacts),
        ]
      : []),
    ...(isNative
      ? [
          "可用工具通过 API 原生 function calling 调用：直接使用提供的工具函数，不要在回复正文中嵌入任何工具调用文本块。",
          "工具用途参考（实际参数 schema 由 API 提供）：",
          ...availableTools,
          "如果需要同时调用多个独立的只读工具（如查询多个文件、列出多个目录），可以在一轮中同时发起多个工具调用，它们会并行执行以减少等待。",
          "收到 observation 后继续完成任务。最终输出只包含给玩家的正文，不要包含工具调用、observation、工具细节或实现说明。",
        ]
      : [
          "可用工具：",
          ...availableTools,
          "工具调用格式必须独占一个块：",
          "<tsian-tool-call>",
          `{"name":"${RUNTIME_WORKSPACE_TOOL_NAMES.useSkill}","arguments":{"name":"prose-style"}}`,
          "</tsian-tool-call>",
          "收到 observation 后继续完成任务。最终输出不要包含工具调用块、observation、工具细节或实现说明。",
        ]),
  ].join("\n")
}

function formatAgentRuntimeContext(context: AgentContextEntry): string {
  return [
    `Agent：${context.agent.id} — ${context.agent.title}`,
    `Agent 摘要：${context.agent.summary || "（无摘要）"}`,
    `Agent 定义路径：${context.agent.path}`,
    "",
    formatOptionalWorkspaceFile("Agent notes", context.notesFile),
    "",
    formatOptionalWorkspaceFile("Agent session", context.sessionFile),
    "",
    "声明的 contextPaths 文件：",
    formatContextFiles(context),
    "",
    "缺失的 contextPaths：",
    formatMissingContextPaths(context),
    "",
    "可见 Skill Index（仅摘要，未加载 Skill 详情）：",
    formatSkillIndex(context),
  ].join("\n")
}

function buildWorkspaceAgentSystemPrompt(
  guard: string,
  context: AgentContextEntry,
  options: {
    allowAgentCall: boolean
    visibleContacts: AgentRegistryEntry[]
    enabledPlatformTools: AgentPlatformToolName[]
    toolCallMode?: BrowserAiToolCallMode
  },
): string {
  return [
    guard,
    "",
    "下面是当前 Agent 的 AGENT.md 内容，优先遵循它定义的注册信息、职责、输出习惯和协作边界。",
    "",
    formatWorkspaceFile(context.agentFile),
    ...(context.soulFile
      ? [
          "",
          "下面是当前 Agent 的 SOUL.md 内容，它描述更持久的身份、工作方式和表达偏好。",
          "",
          formatWorkspaceFile(context.soulFile),
        ]
      : []),
    "",
    "Runtime Workspace 工具说明：",
    buildWorkspaceToolInstructions(options),
  ].join("\n")
}

function getEntryAgentContext(
  input: AgentRuntimeTurnInput,
): AgentContextEntry {
  if (!input.workspaceFiles) {
    throw new Error(
      `Entry Agent "${input.agentId}" requires workspace files.`,
    )
  }

  const context = assembleAgentContext(input.workspaceFiles, { agentId: input.agentId })
  if (!context) {
    throw new Error(
      `Entry Agent "${input.agentId}" was not found. Restore agents/${input.agentId}/AGENT.md or recreate the default workspace.`,
    )
  }

  return context
}

function buildEntryAgentMessages(
  input: AgentRuntimeTurnInput,
  context: AgentContextEntry,
  collaborationPolicy: AgentRuntimeCollaborationPolicy,
  agentCallState: AgentCallTurnState,
  toolCallMode?: BrowserAiToolCallMode,
  agentContext?: AgentContextSnapshot | null,
): AiChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  const visibleContacts = input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, context)
    : []
  const permissions = deriveAgentRuntimePermissionProfile(context.agent)
  // 剧情正文层:优先用注入的 context 快照(独立 message 序列);未注入则从
  // recentHistory(saveHistory)兜底——旧逻辑 formatHistory 也是拍扁文本,这里
  // 保持兜底用文本形式(首 turn/旧存档迁移场景,非稳态路径).
  const historyMessages: AiChatMessage[] = agentContext
    ? buildAgentContextMessages(agentContext)
    : [{ role: "user", content: `最近对话：\n${formatHistory(history)}` }]
  return [
    {
      role: "system",
      content: buildWorkspaceAgentSystemPrompt(ENTRY_AGENT_PLATFORM_GUARD, context, {
        allowAgentCall:
          isAgentPlatformToolEnabled(context.agent, AGENT_PLATFORM_TOOL_NAMES.agentCall)
          && canExposeAgentCallInPrompt(
            collaborationPolicy,
            agentCallState,
            0,
            visibleContacts,
          ),
        visibleContacts,
        enabledPlatformTools: permissions.enabledTools,
        toolCallMode,
      }),
    },
    // 剧情正文层:summary(若有) + recentTurns 独立 message 序列(或兜底文本).
    // 放在 system 之后、框架信息之前——剧情正文在两次压缩之间只增不减、前缀
    // 稳定(appendTurnToContext 只追加不丢,压缩才一次性摘要早期),放前面能让
    // provider 前缀缓存命中剧情正文大头(回合号每轮变,若放前面会立刻断缓存).
    // 压剧情时只动这段(historyMessages),system 和后面的框架信息/本轮输入不动.
    ...historyMessages,
    // 框架信息(非剧情,每 turn 现构建):回合号 + Workspace 上下文.放剧情之后——
    // 回合号每轮递增是缓存断点,放后面让缓存断点尽量后移(剧情正文大头被缓存).
    {
      role: "user",
      content: [
        `当前回合：${currentRuntimeTurnNumber(input)}`,
        "Workspace Agent 上下文：",
        formatAgentRuntimeContext(context),
      ].join("\n"),
    },
    // 玩家本轮输入:单独一条 user message,框架信息之后、工具循环之前.
    {
      role: "user",
      content: `玩家本轮输入：\n${input.userInput}`,
    },
  ]
}

function traceAgentBase(
  context: AgentContextEntry | null,
  debugLabel: RuntimeTraceDebugLabel,
) {
  return {
    ...(context ? { agentId: context.agent.id } : {}),
    debugLabel,
  }
}

function agentCallError(
  code: string,
  message: string,
  details?: unknown,
): { code: string; message: string; details?: unknown } {
  return details === undefined ? { code, message } : { code, message, details }
}

function createAgentCallTurnState(): AgentCallTurnState {
  return {
    callCount: 0,
  }
}

function createAgentSessionTranscriptCollector(): AgentSessionTranscriptCollector {
  return {
    records: [],
    nextModelCallIndex: 0,
  }
}

function agentSessionTranscriptRole(
  debugLabel: RuntimeTraceDebugLabel,
): AgentSessionTranscriptRole {
  if (debugLabel === "entry-agent") return "entry"
  return "delegated"
}

function cloneAiChatMessages(messages: AiChatMessage[]): AiChatMessage[] {
  return messages.map((message) => ({ ...message }))
}

function recordAgentSessionTranscript(
  collector: AgentSessionTranscriptCollector | undefined,
  input: AgentRuntimeTurnInput,
  context: AgentContextEntry | null,
  options: AgentRuntimeModelCallOptions,
  record: {
    messages: AiChatMessage[]
    modelOutput: string
    toolCalls: ParsedRuntimeWorkspaceToolCall[]
    toolObservations: RuntimeWorkspaceToolObservation[]
    round: number
    status: AgentSessionTranscriptStatus
  },
): void {
  if (!collector || !context) {
    return
  }

  collector.records.push({
    schema: AGENT_SESSION_TRANSCRIPT_SCHEMA,
    turn: currentRuntimeTurnNumber(input),
    createdAt: new Date().toISOString(),
    agentId: context.agent.id,
    agentTitle: context.agent.title,
    agentPath: context.agent.path,
    role: agentSessionTranscriptRole(options.debugLabel),
    debugLabel: options.debugLabel,
    modelCallIndex: collector.nextModelCallIndex,
    round: record.round,
    status: record.status,
    messages: cloneAiChatMessages(record.messages),
    modelOutput: record.modelOutput,
    toolCalls: record.toolCalls,
    toolObservations: record.toolObservations,
  })
  collector.nextModelCallIndex += 1
}

function delegatedAgentDebugLabel(agentId: string): RuntimeTraceDebugLabel {
  return `agent:${agentId}`
}

function selectHistoryForAgentCall(
  history: ConversationMessageRecord[],
  historyMode: RuntimeAgentCallHistoryMode,
  collaborationPolicy: AgentRuntimeCollaborationPolicy,
): ConversationMessageRecord[] {
  const windowSize = collaborationPolicy.historyWindows[historyMode]
  if (windowSize <= 0) {
    return []
  }

  return normalizeHistory(history).slice(-windowSize)
}

function createAgentCallRuntimeMetadata(
  callerContext: AgentContextEntry,
  agentCall: RuntimeAgentCallArguments,
  state: AgentCallTurnState,
  collaborationPolicy: AgentRuntimeCollaborationPolicy,
  callerDepth: number,
  targetAgentId: string = agentCall.agentId,
): AgentCallRuntimeMetadata {
  return {
    callerAgentId: callerContext.agent.id,
    targetAgentId,
    callerDepth,
    targetDepth: callerDepth + 1,
    maxDepth: collaborationPolicy.maxDepth,
    callCount: state.callCount,
    historyMode: agentCall.historyMode,
  }
}

function agentCallTraceFacts(metadata: AgentCallRuntimeMetadata): Record<string, unknown> {
  return {
    callerAgentId: metadata.callerAgentId,
    callerDepth: metadata.callerDepth,
    depth: metadata.targetDepth,
    maxDepth: metadata.maxDepth,
    callCount: metadata.callCount,
  }
}

function contactIdSet(context: AgentContextEntry): Set<string> {
  return new Set(
    context.agent.contacts
      .map((contactId) => contactId.trim())
      .filter(Boolean),
  )
}

function buildDelegatedAgentMessages(
  input: AgentRuntimeTurnInput,
  callerContext: AgentContextEntry,
  targetContext: AgentContextEntry,
  agentCall: RuntimeAgentCallArguments,
  collaborationPolicy: AgentRuntimeCollaborationPolicy,
  agentCallState: AgentCallTurnState,
  agentCallDepth: number,
  toolCallMode?: BrowserAiToolCallMode,
): AiChatMessage[] {
  const history = selectHistoryForAgentCall(
    input.recentHistory,
    agentCall.historyMode,
    collaborationPolicy,
  )
  const visibleContacts = input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, targetContext)
    : []
  const permissions = deriveAgentRuntimePermissionProfile(targetContext.agent)
  return [
    {
      role: "system",
      content: buildWorkspaceAgentSystemPrompt(DELEGATED_AGENT_PLATFORM_GUARD, targetContext, {
        allowAgentCall:
          isAgentPlatformToolEnabled(targetContext.agent, AGENT_PLATFORM_TOOL_NAMES.agentCall)
          && canExposeAgentCallInPrompt(
            collaborationPolicy,
            agentCallState,
            agentCallDepth,
            visibleContacts,
          ),
        visibleContacts,
        enabledPlatformTools: permissions.enabledTools,
        toolCallMode,
      }),
    },
    {
      role: "user",
      content: [
        `当前回合：${currentRuntimeTurnNumber(input)}`,
        `historyMode：${agentCall.historyMode}`,
        "",
        // 稳定内容前置(design §2.3):历史窗口 + 目标上下文 + 调用方,利于 prefix 缓存重叠.
        "最近对话窗口：",
        formatHistory(history),
        "",
        "目标 Agent 上下文：",
        formatAgentRuntimeContext(targetContext),
        "",
        "调用方 Agent：",
        `${callerContext.agent.id} — ${callerContext.agent.title}`,
        callerContext.agent.summary || "（无摘要）",
        "",
        ...(agentCall.contextSummary
          ? [
              "调用方提供的上下文摘要：",
              agentCall.contextSummary,
              "",
            ]
          : []),
        "玩家本轮输入：",
        input.userInput,
        "",
        // request + 指令末尾(design §2.3):让模型聚焦当前任务.
        "调用请求：",
        agentCall.request,
        "",
        ...(agentCall.reason
          ? [
              "调用原因：",
              agentCall.reason,
              "",
            ]
          : []),
        ...(agentCall.expectedOutput
          ? [
              "期望输出：",
              agentCall.expectedOutput,
              "",
            ]
          : []),
        "请只回答调用方请求，不要输出给玩家的最终正文，也不要提到工具协议。",
      ].join("\n"),
    },
  ]
}

function createAgentCallRunner(
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  callerContext: AgentContextEntry,
  state: AgentCallTurnState,
  depth: number,
  collaborationPolicy: AgentRuntimeCollaborationPolicy,
  transcriptCollector: AgentSessionTranscriptCollector | undefined,
): (agentCall: RuntimeAgentCallArguments) => Promise<unknown> {
  return async (agentCall) => {
    assertNotAborted(input.signal)
    const initialMetadata = createAgentCallRuntimeMetadata(
      callerContext,
      agentCall,
      state,
      collaborationPolicy,
      depth,
    )
    if (!input.workspaceFiles) {
      throw agentCallError(
        "AGENT_CALL_UNAVAILABLE",
        "agent_call requires Runtime Workspace files.",
        initialMetadata,
      )
    }

    if (depth >= collaborationPolicy.maxDepth) {
      throw agentCallError(
        "AGENT_CALL_UNAVAILABLE",
        "agent_call is not available because the collaboration depth limit has been reached.",
        initialMetadata,
      )
    }

    const registry = buildAgentRegistry(input.workspaceFiles)
    const targetAgent = registry.find((agent) => agent.id === agentCall.agentId)
    if (!targetAgent) {
      throw agentCallError(
        "AGENT_CALL_TARGET_NOT_FOUND",
        `Agent was not found: ${agentCall.agentId}`,
        initialMetadata,
      )
    }

    if (!contactIdSet(callerContext).has(agentCall.agentId)) {
      throw agentCallError(
        "AGENT_CALL_TARGET_NOT_CONTACT",
        `Agent "${agentCall.agentId}" is not listed in ${callerContext.agent.id}'s contacts.`,
        initialMetadata,
      )
    }

    const targetContext = assembleAgentContext(input.workspaceFiles, {
      agentId: targetAgent.id,
    })
    if (!targetContext) {
      throw agentCallError(
        "AGENT_CALL_TARGET_NOT_FOUND",
        `Agent context was not found: ${targetAgent.id}`,
        initialMetadata,
      )
    }

    state.callCount += 1
    const metadata = createAgentCallRuntimeMetadata(
      callerContext,
      agentCall,
      state,
      collaborationPolicy,
      depth,
      targetContext.agent.id,
    )
    const debugLabel = delegatedAgentDebugLabel(targetContext.agent.id)
    capabilities.emitTrace?.({
      type: "agent_step_started",
      ...traceAgentBase(targetContext, debugLabel),
      data: {
        agentTitle: targetContext.agent.title,
        ...agentCallTraceFacts(metadata),
        delegated: true,
      },
    })

    // 任务型 agent 时长兜底(design §2.6):独立 timeoutController + setTimeout,
    // 与用户 abort(input.signal)合并成 compositeSignal 传给工具循环.超时瞬间能
    // abort 正在 await 的 model 调用,不只靠循环内 Date.now() 检查.主 agent 可经
    // agent_call 的 timeoutMs 参数显式给子代理更长时间,不传用默认 300s.
    const taskTimeoutMs = agentCall.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS
    const timeoutController = new AbortController()
    const timeoutTimer = setTimeout(
      () => timeoutController.abort("task-timeout"),
      taskTimeoutMs,
    )
    const compositeSignal = AbortSignal.any(
      [input.signal, timeoutController.signal].filter(Boolean) as AbortSignal[],
    )
    const taskStartedAt = Date.now()

    try {
      const response = (await callAgentModelWithWorkspaceTools(
        buildDelegatedAgentMessages(
          input,
          callerContext,
          targetContext,
          agentCall,
          collaborationPolicy,
          state,
          metadata.targetDepth,
          capabilities.toolCallMode,
        ),
        input,
        capabilities,
        {
          debugLabel,
          signal: compositeSignal,
          agentId: targetContext.agent.id,
          // Thread the caller's streaming/tool-event sinks so the delegated
          // agent's process is visible upstream (agentId bound by the native
          // tool loop to targetContext.agent.id). Only the native loop emits
          // these; text-protocol delegated agents stay silent as before.
          onDelta: input.onDelta,
          onRoundEnd: input.onRoundEnd,
          onTool: input.onTool,
        },
        targetContext,
        {
          agentCallState: state,
          agentCallDepth: metadata.targetDepth,
          collaborationPolicy,
          compressionMode: "task",
          // delegated 预算:runtime 层不知目标 agent 的 contextWindow,用 256k 默认
          // (host 层 callModelNative 闭包按 options.agentId resolve 真实 config,
          //  但预算是 runtime 估算用,256k 的 85% 足够大,不影响压缩触发判断).
          contextTokenBudget: resolveTokenBudget(undefined),
          compressCallModel: capabilities.callModel,
          taskStartedAt,
          taskTimeoutMs,
        },
        transcriptCollector,
      )).trim()
      const completedMetadata = createAgentCallRuntimeMetadata(
        callerContext,
        agentCall,
        state,
        collaborationPolicy,
        depth,
        targetContext.agent.id,
      )
      capabilities.emitTrace?.({
        type: "agent_step_completed",
        ...traceAgentBase(targetContext, debugLabel),
        ok: true,
        data: {
          outputLength: response.length,
          ...agentCallTraceFacts(completedMetadata),
          delegated: true,
        },
      })

      return {
        status: "completed",
        targetAgent: {
          id: targetContext.agent.id,
          title: targetContext.agent.title,
          summary: targetContext.agent.summary,
        },
        historyMode: agentCall.historyMode,
        metadata: completedMetadata,
        response,
      }
    } catch (error) {
      const failedMetadata = createAgentCallRuntimeMetadata(
        callerContext,
        agentCall,
        state,
        collaborationPolicy,
        depth,
        targetContext.agent.id,
      )
      // 区分超时 abort vs 用户 abort/其他错误:超时走 TaskTimeoutError 标记,
      // 让 master 收到 AGENT_CALL_FAILED observation 后能区分(details.timeout).
      const isTimeout = timeoutController.signal.aborted
      const isTaskStall = error instanceof Error && error.name === "TaskCompressionStalledError"
      capabilities.emitTrace?.({
        type: "agent_step_failed",
        ...traceAgentBase(targetContext, debugLabel),
        ok: false,
        data: {
          ...errorToTraceData(error),
          ...agentCallTraceFacts(failedMetadata),
          delegated: true,
          ...(isTimeout ? { timeout: true, taskTimeoutMs } : {}),
          ...(isTaskStall ? { stalled: true } : {}),
        },
      })
      throw agentCallError(
        "AGENT_CALL_FAILED",
        isTimeout
          ? `agent_call 超时（${Math.round(taskTimeoutMs / 1000)}s）中止 for Agent "${targetContext.agent.id}".`
          : isTaskStall
            ? `agent_call 上下文压缩无效中止 for Agent "${targetContext.agent.id}".`
            : `agent_call failed for Agent "${targetContext.agent.id}".`,
        {
          ...failedMetadata,
          cause: errorToTraceData(error),
          ...(isTimeout ? { timeout: true, taskTimeoutMs } : {}),
          ...(isTaskStall ? { stalled: true } : {}),
        },
      )
    } finally {
      clearTimeout(timeoutTimer)
    }
  }
}

/** Wrap a parsed native tool call into the text-loop's `ParsedRuntimeWorkspaceToolCall` shape so `executeRuntimeWorkspaceToolCalls` is reused unchanged. */
function nativeToolCallsToParsed(
  calls: NativeToolCall[],
): ParsedRuntimeWorkspaceToolCall[] {
  return calls.map((call) => ({
    raw: JSON.stringify({ name: call.name, arguments: call.arguments }),
    call: { name: call.name, arguments: call.arguments },
  }))
}

/** Convert the flat entry-agent `AiChatMessage[]` to structured `RuntimeChatMessage[]` for the first native round. */
function aiChatMessagesToRuntime(
  messages: AiChatMessage[],
): RuntimeChatMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return { role: "assistant", content: message.content }
    }
    return { role: message.role, content: message.content }
  })
}

async function callAgentModelWithWorkspaceToolsNative(
  messages: AiChatMessage[],
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  options: AgentRuntimeModelCallOptions,
  agentContext: AgentContextEntry,
  toolOptions: WorkspaceToolLoopOptions,
  transcriptCollector: AgentSessionTranscriptCollector | undefined,
): Promise<string> {
  let runtimeMessages = aiChatMessagesToRuntime(messages)
  const workspaceToolSession = createRuntimeWorkspaceToolSessionState()
  const permissions = deriveAgentRuntimePermissionProfile(agentContext.agent)
  const visibleContacts = input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, agentContext)
    : []
  const allowAgentCall =
    toolOptions.agentCallState !== undefined
    && isAgentPlatformToolEnabled(agentContext.agent, AGENT_PLATFORM_TOOL_NAMES.agentCall)
    && canExposeAgentCallInPrompt(
      toolOptions.collaborationPolicy,
      toolOptions.agentCallState,
      toolOptions.agentCallDepth,
      visibleContacts,
    )
  const tools = buildEnabledToolSchemas({
    enabledPlatformTools: permissions.enabledTools,
    allowAgentCall,
    visibleContacts,
  })

  // turn 内 token 预算 + 压缩(tool-token-budget R2 + 06-20-agent-task-compression).
  // 循环不再有轮次上限,靠 stop / abort / 预算兜底(narrative)或时长兜底(task)终止.
  // 按 compressionMode 分流:
  // - narrative(master):压剧情(summary+recentTurns),一次压缩 + 第二次达预算抛
  //   ContextBudgetExhaustedError.仅 entry 稳态路径(注入了 context 快照)做压剧情;
  //   兜底路径无快照,只走预算兜底.
  // - task(子代理/助手):压工具交互段(assistant toolCalls + tool observation),多次压缩
  //   不限次 + 时长兜底(TaskTimeoutError) + 压缩无效早退(TaskCompressionStalledError).
  const historySpan = locateHistorySpan(runtimeMessages)
  const canCompressNarrative =
    toolOptions.compressionMode === "narrative"
    && historySpan.start >= 0
    && toolOptions.agentContextSnapshot !== undefined
    && toolOptions.contextTokenBudget !== undefined
    && toolOptions.compressCallModel !== undefined
  const isTaskMode = toolOptions.compressionMode === "task"
  const triggerThreshold =
    toolOptions.contextTokenBudget !== undefined
      ? toolOptions.contextTokenBudget * CONTEXT_COMPRESS_TRIGGER_RATIO
      : 0
  let compressedThisTurn = false // narrative:一次压缩标记.task 不用(可多次).
  let taskSummary: string | null = null // task:前次压缩摘要,供下次压缩作 oldSummary.
  let lastRoundText = ""

  for (let round = 0; ; round += 1) {
    assertNotAborted(options.signal)

    // 每轮调 model 前做 token 预算检查(含 round 0).达 85% budget 按模式分流:
    // - narrative:第一次 → 压剧情腾空间,tool 交互全保留,继续;第二次 → 兜底C.
    // - task:时长检查 → 压工具交互段(多次) → 压缩无效早退 → 无段可压/压不动走兜底C.
    if (triggerThreshold > 0) {
      const totalTokens = estimateRuntimeMessagesTokens(runtimeMessages)
      if (totalTokens > triggerThreshold) {
        if (isTaskMode) {
          // task 模式:时长兜底检查(每轮查,不等 model 调用)
          if (
            toolOptions.taskStartedAt !== undefined
            && toolOptions.taskTimeoutMs !== undefined
            && Date.now() - toolOptions.taskStartedAt > toolOptions.taskTimeoutMs
          ) {
            throw new TaskTimeoutError(toolOptions.taskTimeoutMs)
          }
          const interactionSpan = locateTaskInteractionSpan(runtimeMessages, "native")
          if (interactionSpan.start < 0) {
            // 无工具交互段可压(异常,通常 round 0 不该触发)→ 走兜底
            const finalText = lastRoundText.trim()
            if (finalText) {
              recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
                messages,
                modelOutput: lastRoundText,
                toolCalls: [],
                toolObservations: [],
                round,
                status: "completed",
              })
              return finalText
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
          }
          const beforeTokens = totalTokens
          const result: TaskCompressionResult<RuntimeChatMessage> = await compressTaskContext<RuntimeChatMessage>(
            runtimeMessages,
            interactionSpan,
            taskSummary,
            toolOptions.compressCallModel!,
            compressOptions,
          )
          if (!result.compressed) {
            // 压不动(早期无可压内容,工具交互 ≤ N 轮)→ 走兜底
            const finalText = lastRoundText.trim()
            if (finalText) {
              recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
                messages,
                modelOutput: lastRoundText,
                toolCalls: [],
                toolObservations: [],
                round,
                status: "completed",
              })
              return finalText
            }
            throw new ContextBudgetExhaustedError()
          }
          runtimeMessages = result.messages
          taskSummary = result.summary
          const afterTokens = estimateRuntimeMessagesTokens(runtimeMessages)
          if ((beforeTokens - afterTokens) / beforeTokens < TASK_COMPRESSION_STALL_RATIO) {
            // 压缩无效早退:下降 <10% → 压不动了,不傻等超时烧钱
            throw new TaskCompressionStalledError()
          }
          capabilities.emitTrace?.({
            type: "context_compressed_in_turn",
            agentId: agentContext.agent.id,
            debugLabel: options.debugLabel,
            ok: true,
            data: {
              round,
              beforeTokens,
              afterTokens,
              budget: toolOptions.contextTokenBudget!,
              triggerThreshold,
              mode: "task",
            },
          })
        } else {
          // narrative 模式(tool-token-budget R2,保持原样)
          if (compressedThisTurn || !canCompressNarrative) {
            const finalText = lastRoundText.trim()
            if (finalText) {
              recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
                messages,
                modelOutput: lastRoundText,
                toolCalls: [],
                toolObservations: [],
                round,
                status: "completed",
              })
              return finalText
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
          }
          const compressed = await compressContext(
            toolOptions.agentContextSnapshot!,
            triggerThreshold,
            toolOptions.compressCallModel!,
            compressOptions,
          )
          Object.assign(toolOptions.agentContextSnapshot!, compressed)
          compressedThisTurn = true
          const newHistory = aiChatMessagesToRuntime(
            buildAgentContextMessages(toolOptions.agentContextSnapshot!),
          )
          replaceHistorySpan(runtimeMessages, historySpan, newHistory)
          historySpan.end = historySpan.start + newHistory.length
          capabilities.emitTrace?.({
            type: "context_compressed_in_turn",
            agentId: agentContext.agent.id,
            debugLabel: options.debugLabel,
            ok: true,
            data: {
              round,
              beforeTokens: totalTokens,
              budget: toolOptions.contextTokenBudget!,
              triggerThreshold,
              mode: "narrative",
            },
          })
        }
      }
    }

    const callOptions: AgentRuntimeModelCallOptions = {
      ...options,
      round,
    }
    const result = await capabilities.callModelNative!(runtimeMessages, callOptions, tools)
    assertNotAborted(options.signal)
    lastRoundText = result.text

    // Notify the caller that this round ended, with the finish reason so it can
    // classify the streamed text as thought (tool_calls) or final (stop). Emitted
    // for every round including the final stop round. agentId identifies which
    // agent's tool loop this round belongs to (entry or delegated agent_call target).
    options.onRoundEnd?.(agentContext.agent.id, round, result.finishReason)

    const toolCalls = nativeToolCallsToParsed(result.toolCalls)
    // Thread provider-assigned tool call ids into the parsed calls so the
    // workspace tool executor can emit turn-tool events with a stable callId
    // (text-protocol falls back to `tool-${index}` inside the executor).
    for (let i = 0; i < toolCalls.length && i < result.toolCalls.length; i += 1) {
      const tc = result.toolCalls[i]
      const parsed = toolCalls[i]
      if (parsed.call && tc.id) {
        parsed.call.id = tc.id
      }
    }
    capabilities.emitTrace?.({
      type: "model_call_completed",
      agentId: agentContext.agent.id,
      debugLabel: options.debugLabel,
      ok: true,
      data: {
        messageCount: runtimeMessages.length,
        outputLength: result.text.length,
        hasToolCalls: result.toolCalls.length > 0,
        toolCallCount: result.toolCalls.length,
        round,
      },
    })

    if (result.finishReason === "stop" || result.toolCalls.length === 0) {
      recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
        messages,
        modelOutput: result.raw,
        toolCalls,
        toolObservations: [],
        round,
        status: "completed",
      })
      return result.text.trim()
    }

    const observations = await executeRuntimeWorkspaceToolCalls({
      workspaceFiles: input.workspaceFiles!,
      agentContext,
      sessionState: workspaceToolSession,
      runAgentCall: allowAgentCall
        ? createAgentCallRunner(
          input,
          capabilities,
          agentContext,
          toolOptions.agentCallState,
          toolOptions.agentCallDepth,
          toolOptions.collaborationPolicy,
          transcriptCollector,
        )
        : undefined,
      runBrowserScript: capabilities.runBrowserScript,
      actionExecutorPolicy: capabilities.actionExecutorPolicy,
      workspaceMutations: capabilities.workspaceMutations,
      exposedWorkspaceOperations: permissions.exposedWorkspaceOperations,
      signal: options.signal,
      debugLabel: options.debugLabel,
      emitTrace: capabilities.emitTrace,
      // Tool process events (子2b R2): bind the current round and agentId here
      // so the executor's onTool stays callId/name/status only; the caller binds
      // turn. agentId is this loop's agent (entry or delegated target).
      onTool: options.onTool
        ? (callId, name, status, output) => options.onTool!(agentContext.agent.id, round, callId, name, status, output)
        : undefined,
    }, toolCalls)

    recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
      messages,
      modelOutput: result.raw,
      toolCalls,
      toolObservations: observations,
      round,
      status: "tool-continued",
    })

    // Thread the assistant tool calls + tool observations back in native shape.
    runtimeMessages.push({
      role: "assistant",
      content: result.text,
      ...(result.toolCalls.length > 0 ? { toolCalls: result.toolCalls } : {}),
    })
    for (const [index, observation] of observations.entries()) {
      const callId = result.toolCalls[index]?.id ?? `tool-${index}`
      runtimeMessages.push({
        role: "tool",
        toolCallId: callId,
        content: formatRuntimeWorkspaceToolObservationMessage([observation]),
      })
    }

    // Inject full SKILL.md for skills newly activated via use_skill this round,
    // so the model sees them in the next round's context (B-scheme: declare
    // intent -> framework injects content next round).
    injectActivatedSkillMessagesNative(runtimeMessages, workspaceToolSession, input.workspaceFiles!)
  }

  throw new Error(`${options.debugLabel} failed to complete workspace tool handling.`)
}

async function callAgentModelWithWorkspaceTools(
  messages: AiChatMessage[],
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  options: AgentRuntimeModelCallOptions,
  agentContext: AgentContextEntry | null,
  toolOptions?: WorkspaceToolLoopOptions,
  transcriptCollector?: AgentSessionTranscriptCollector,
): Promise<string> {
  if (!input.workspaceFiles || !agentContext) {
    const response = await capabilities.callModel(messages, options)
    recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
      messages,
      modelOutput: response,
      toolCalls: [],
      toolObservations: [],
      round: 0,
      status: "completed",
    })
    capabilities.emitTrace?.({
      type: "model_call_completed",
      debugLabel: options.debugLabel,
      ok: true,
      data: {
        messageCount: messages.length,
        outputLength: response.length,
        hasToolCalls: false,
        toolCallCount: 0,
        round: 0,
      },
    })
    return response.trim()
  }

  // Native function-calling dispatch: when the active model opts into native
  // tools and the host provides `callModelNative`, run the structured tool
  // loop. Otherwise fall through to the text-protocol loop (unchanged).
  const useNativeToolCalling =
    capabilities.toolCallMode === "native"
    && typeof capabilities.callModelNative === "function"
  if (useNativeToolCalling && toolOptions) {
    return callAgentModelWithWorkspaceToolsNative(
      messages,
      input,
      capabilities,
      options,
      agentContext,
      toolOptions,
      transcriptCollector,
    )
  }

  let nextMessages = messages
  const workspaceToolSession = createRuntimeWorkspaceToolSessionState()
  const permissions = deriveAgentRuntimePermissionProfile(agentContext.agent)
  // turn 内 token 预算 + 压缩(text 循环对称版).按 compressionMode 分流(narrative/task),
  // 与 native 循环一致.仅 entry 稳态路径(注入了 context 快照)做 narrative 压剧情;
  // task 模式压工具交互段 + 多次 + 时长兜底 + 早退.
  const historySpan = locateHistorySpan(nextMessages)
  const compressionMode: RuntimeCompressionMode = toolOptions?.compressionMode ?? "narrative"
  const canCompressNarrative =
    compressionMode === "narrative"
    && historySpan.start >= 0
    && toolOptions?.agentContextSnapshot !== undefined
    && toolOptions?.contextTokenBudget !== undefined
    && toolOptions?.compressCallModel !== undefined
  const isTaskMode = compressionMode === "task"
  const triggerThreshold =
    toolOptions?.contextTokenBudget !== undefined
      ? toolOptions.contextTokenBudget * CONTEXT_COMPRESS_TRIGGER_RATIO
      : 0
  let compressedThisTurn = false // narrative:一次压缩标记.task 不用(可多次).
  let taskSummary: string | null = null // task:前次压缩摘要,供下次压缩作 oldSummary.
  let lastRoundText = ""

  for (let round = 0; ; round += 1) {
    assertNotAborted(options.signal)

    // 每轮调 model 前 token 预算检查(含 round 0).达 85% budget 按模式分流:
    // - narrative:第一次 → 压剧情腾空间;第二次 → 兜底C.
    // - task:时长检查 → 压工具交互段(多次) → 压缩无效早退 → 无段可压/压不动走兜底C.
    if (triggerThreshold > 0) {
      const totalTokens = estimateAiChatMessagesTokens(nextMessages)
      if (totalTokens > triggerThreshold) {
        if (isTaskMode) {
          // task 模式:时长兜底检查
          if (
            toolOptions?.taskStartedAt !== undefined
            && toolOptions?.taskTimeoutMs !== undefined
            && Date.now() - toolOptions.taskStartedAt > toolOptions.taskTimeoutMs
          ) {
            throw new TaskTimeoutError(toolOptions.taskTimeoutMs)
          }
          const interactionSpan = locateTaskInteractionSpan(nextMessages, "text")
          if (interactionSpan.start < 0) {
            const finalText = stripRuntimeWorkspaceToolCallBlocks(lastRoundText).trim()
            if (finalText) {
              recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
                messages: nextMessages,
                modelOutput: lastRoundText,
                toolCalls: [],
                toolObservations: [],
                round,
                status: "completed",
              })
              return finalText
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
          }
          const beforeTokens = totalTokens
          const result: TaskCompressionResult<AiChatMessage> = await compressTaskContext<AiChatMessage>(
            nextMessages,
            interactionSpan,
            taskSummary,
            toolOptions!.compressCallModel!,
            compressOptions,
          )
          if (!result.compressed) {
            const finalText = stripRuntimeWorkspaceToolCallBlocks(lastRoundText).trim()
            if (finalText) {
              recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
                messages: nextMessages,
                modelOutput: lastRoundText,
                toolCalls: [],
                toolObservations: [],
                round,
                status: "completed",
              })
              return finalText
            }
            throw new ContextBudgetExhaustedError()
          }
          nextMessages = result.messages
          taskSummary = result.summary
          const afterTokens = estimateAiChatMessagesTokens(nextMessages)
          if ((beforeTokens - afterTokens) / beforeTokens < TASK_COMPRESSION_STALL_RATIO) {
            throw new TaskCompressionStalledError()
          }
          capabilities.emitTrace?.({
            type: "context_compressed_in_turn",
            agentId: agentContext.agent.id,
            debugLabel: options.debugLabel,
            ok: true,
            data: {
              round,
              beforeTokens,
              afterTokens,
              budget: toolOptions!.contextTokenBudget!,
              triggerThreshold,
              mode: "task",
            },
          })
        } else {
          // narrative 模式(tool-token-budget R2,保持原样)
          if (compressedThisTurn || !canCompressNarrative) {
            const finalText = stripRuntimeWorkspaceToolCallBlocks(lastRoundText).trim()
            if (finalText) {
              recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
                messages: nextMessages,
                modelOutput: lastRoundText,
                toolCalls: [],
                toolObservations: [],
                round,
                status: "completed",
              })
              return finalText
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
          }
          const compressed = await compressContext(
            toolOptions!.agentContextSnapshot!,
            triggerThreshold,
            toolOptions!.compressCallModel!,
            compressOptions,
          )
          Object.assign(toolOptions!.agentContextSnapshot!, compressed)
          compressedThisTurn = true
          const newHistory = buildAgentContextMessages(toolOptions!.agentContextSnapshot!)
          replaceHistorySpan(nextMessages, historySpan, newHistory)
          historySpan.end = historySpan.start + newHistory.length
          capabilities.emitTrace?.({
            type: "context_compressed_in_turn",
            agentId: agentContext.agent.id,
            debugLabel: options.debugLabel,
            ok: true,
            data: {
              round,
              beforeTokens: totalTokens,
              budget: toolOptions!.contextTokenBudget!,
              triggerThreshold,
              mode: "narrative",
            },
          })
        }
      }
    }

    const response = await capabilities.callModel(nextMessages, options)
    assertNotAborted(options.signal)
    lastRoundText = response

    const toolCalls = parseRuntimeWorkspaceToolCalls(response)
    capabilities.emitTrace?.({
      type: "model_call_completed",
      agentId: agentContext.agent.id,
      debugLabel: options.debugLabel,
      ok: true,
      data: {
        messageCount: nextMessages.length,
        outputLength: response.length,
        hasToolCalls: toolCalls.length > 0,
        toolCallCount: toolCalls.length,
        round,
      },
    })
    if (toolCalls.length === 0) {
      recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
        messages: nextMessages,
        modelOutput: response,
        toolCalls,
        toolObservations: [],
        round,
        status: "completed",
      })
      return stripRuntimeWorkspaceToolCallBlocks(response).trim()
    }

    const observations = await executeRuntimeWorkspaceToolCalls({
      workspaceFiles: input.workspaceFiles,
      agentContext,
      sessionState: workspaceToolSession,
      runAgentCall: toolOptions && isAgentPlatformToolEnabled(
        agentContext.agent,
        AGENT_PLATFORM_TOOL_NAMES.agentCall,
      )
        ? createAgentCallRunner(
            input,
            capabilities,
            agentContext,
            toolOptions.agentCallState,
            toolOptions.agentCallDepth,
            toolOptions.collaborationPolicy,
            transcriptCollector,
          )
        : undefined,
      runBrowserScript: capabilities.runBrowserScript,
      actionExecutorPolicy: capabilities.actionExecutorPolicy,
      workspaceMutations: capabilities.workspaceMutations,
      exposedWorkspaceOperations: permissions.exposedWorkspaceOperations,
      signal: options.signal,
      debugLabel: options.debugLabel,
      emitTrace: capabilities.emitTrace,
    }, toolCalls)
    recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
      messages: nextMessages,
      modelOutput: response,
      toolCalls,
      toolObservations: observations,
      round,
      status: "tool-continued",
    })
    nextMessages = [
      ...nextMessages,
      {
        role: "assistant",
        content: response,
      },
      {
        role: "user",
        content: formatRuntimeWorkspaceToolObservationMessage(observations),
      },
    ]
    // Inject full SKILL.md for skills newly activated via use_skill this round
    // (B-scheme: declare intent -> framework injects content next round).
    nextMessages = injectActivatedSkillMessagesText(
      nextMessages,
      workspaceToolSession,
      input.workspaceFiles,
    )
  }

  throw new Error(`${options.debugLabel} failed to complete workspace tool handling.`)
}

export async function runAgentRuntimeTurn(
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
): Promise<AgentRuntimeTurnResult> {
  assertNotAborted(input.signal)
  const collaborationPolicy = normalizeAgentRuntimeCollaborationPolicy(
    capabilities.collaborationPolicy,
  )
  const agentCallState = createAgentCallTurnState()
  const transcriptCollector = createAgentSessionTranscriptCollector()

  const entryContext = getEntryAgentContext(input)
  capabilities.emitTrace?.({
    type: "agent_step_started",
    ...traceAgentBase(entryContext, "entry-agent"),
    data: { agentTitle: entryContext.agent.title },
  })

  // master agent 会话上下文:优先用注入的 context.json 快照;未注入则从
  // recentHistory(saveHistory)兜底初始化(design §3.1 首 turn/旧存档迁移).
  // saveId 占位空串:runtime 层不知真实 saveId,host 落盘(R4)时用真实 saveId 重建.
  // R3 在此之后插入"超阈值压缩".
  let agentContext: AgentContextSnapshot | null = input.agentContext ?? null
  if (!agentContext) {
    agentContext = createInitialAgentContext(
      "",
      input.recentHistory,
      currentRuntimeTurnNumber(input),
    )
  }

  // R3:turn 开头压缩(快照层).估算 context token,超 85% 阈值则调 model
  // 摘要化早期正文,保持"1 摘要 + K 轮正文"稳态.两模式都执行:
  // - narrative(master):压剧情正文(叙事梗概),用默认 COMPRESSION_SYSTEM_PROMPT.
  // - task(助手):压任务对话(任务摘要),用 ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT.
  // 这与 turn 内 compressTaskContext(压工具交互段,运行时层)独立互补——
  // 此处压跨 turn 累积的 AgentContextSnapshot(summary + recentTurns),
  // turn 内压本轮 messages 的工具调用段.压缩失败 → throw
  // ContextCompressionFailedError(温和兜底,经 AssistantView 显示).
  const entryCompressionMode = resolveEntryCompressionMode(input)
  let compressedContext: AgentContextSnapshot | undefined
  const budget = resolveTokenBudget(input.contextTokenBudget)
  const triggerThreshold = budget * CONTEXT_COMPRESS_TRIGGER_RATIO
  if (estimateContextTokens(agentContext) > triggerThreshold) {
    const compressOptions: CompressCallOptions = {
      debugLabel: "entry-agent",
      signal: input.signal,
      agentId: entryContext.agent.id,
      // task 模式(助手)用任务摘要 prompt + "用户/助手"标签;
      // narrative 模式(master)不传 → compressContext 用默认剧情梗概 prompt + "玩家/叙事"标签.
      ...(entryCompressionMode === "task"
        ? {
            systemPrompt: ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT,
            userLabel: "用户",
            assistantLabel: "助手",
          }
        : {}),
    }
    try {
      agentContext = await compressContext(
        agentContext,
        triggerThreshold,
        capabilities.callModel,
        compressOptions,
      )
      compressedContext = agentContext
      capabilities.emitTrace?.({
        type: "context_compressed",
        ...traceAgentBase(entryContext, "entry-agent"),
        ok: true,
        data: { budget, triggerThreshold, mode: entryCompressionMode },
      })
    } catch (error) {
      capabilities.emitTrace?.({
        type: "context_compression_failed",
        ...traceAgentBase(entryContext, "entry-agent"),
        ok: false,
        data: errorToTraceData(error),
      })
      throw error
    }
  }

  let replyText: string
  // turn 内压剧情就地把压缩结果写进 agentContext(对象引用),循环结束后
  // 用它覆盖 compressedContext 透传给 host 落盘(design §3.5).标记位区分
  // "turn 开头压过" 与 "turn 内又压过",取最后一次压缩快照.
  let compressedInTurn = false
  const agentContextSnapshotForLoop = agentContext
  try {
    replyText = (await callAgentModelWithWorkspaceTools(
      buildEntryAgentMessages(
        input,
        entryContext,
        collaborationPolicy,
        agentCallState,
        capabilities.toolCallMode,
        agentContext,
      ),
      input,
      capabilities,
      {
        debugLabel: "entry-agent",
        signal: input.signal,
        agentId: entryContext.agent.id,
        onDelta: input.onDelta,
        onRoundEnd: input.onRoundEnd,
        onTool: input.onTool,
      },
      entryContext,
      {
        agentCallState,
        agentCallDepth: 0,
        collaborationPolicy,
        compressionMode: entryCompressionMode,
        agentContextSnapshot: agentContextSnapshotForLoop ?? undefined,
        contextTokenBudget: budget,
        compressCallModel: capabilities.callModel,
        ...(entryCompressionMode === "task"
          ? {
              taskStartedAt: Date.now(),
              taskTimeoutMs: input.timeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
            }
          : {}),
      },
      transcriptCollector,
    )).trim()
    // 工具循环内若压过剧情,agentContextSnapshotForLoop 已被 Object.assign 就地更新;
    // 通过对比 updatedAt 判断是否发生 turn 内压缩(底层压缩必更新 updatedAt).
    if (
      agentContextSnapshotForLoop
      && compressedContext
      && agentContextSnapshotForLoop.updatedAt !== compressedContext.updatedAt
    ) {
      compressedInTurn = true
    }
    if (!replyText) {
      throw new Error(`Entry agent "${input.agentId}" returned an empty reply.`)
    }
    capabilities.emitTrace?.({
      type: "agent_step_completed",
      ...traceAgentBase(entryContext, "entry-agent"),
      ok: true,
      data: { outputLength: replyText.length },
    })
  } catch (error) {
    capabilities.emitTrace?.({
      type: "agent_step_failed",
      ...traceAgentBase(entryContext, "entry-agent"),
      ok: false,
      data: errorToTraceData(error),
    })
    throw error
  }

  return {
    replyText,
    agentSessionTranscripts: transcriptCollector.records,
    contextUpdate: {
      turn: currentRuntimeTurnNumber(input),
      user: input.userInput,
      assistant: replyText,
      compressedContext: compressedInTurn ? agentContextSnapshotForLoop! : compressedContext,
    },
  }
}

