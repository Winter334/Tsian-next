import type {
  AgentRegistryEntry,
  AgentContextEntry,
  AgentContextSnapshot,
  AgentContextToolCall,
  AgentContextToolMemory,
  ContextInjection,
  ContextPathPosition,
  TurnTimelineItem,
  AiChatMessage,
  AskUserRequest,
  AskUserResult,
  ContentPart,
  ConversationMessageRecord,
  InjectionMessage,
  AgentPlatformToolName,
  PlatformActionRequest,
  PlatformActionResult,
  TurnToolOutput,
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
  getNarrativeContextCompressTriggerRatio,
  getTaskContextCompressTriggerRatio,
  ContextBudgetExhaustedError,
  ContextCompressionFailedError,
  createInitialAgentContext,
  DEFAULT_TASK_INACTIVITY_TIMEOUT_MS,
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
import { errorToTraceData, errorToTraceDataWithStack } from "./trace"
import {
  createRuntimeWorkspaceToolSessionState,
  executeRuntimeWorkspaceToolCalls,
  formatNativeToolObservationContent,
  formatRuntimeWorkspaceToolObservationMessage,
  parseRuntimeWorkspaceToolCalls,
  RUNTIME_WORKSPACE_TOOL_NAMES,
  stripRuntimeWorkspaceToolCallBlocks,
  stripThinkBlocks,
  extractThinkBlocks,
  type RuntimeActionExecutorPolicy,
  type RuntimeControlledExecutorContext,
  type ParsedRuntimeWorkspaceToolCall,
  type RuntimeAgentCallArguments,
  type RuntimeAgentCallHistoryMode,
  type InspectFrontendInput,
  type InspectFrontendResult,
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
import {
  collectToolMemoriesForContext,
  renderToolMemoriesForModel,
} from "./tool-memory"
import type { WorkspaceOperationMutationAdapter } from "./workspace-operations"

// barrel re-export (public API — 8 types)
export type {
  AgentRuntimeTurnInput,
  AgentRuntimeTurnContextUpdate,
  AgentRuntimeTurnResult,
  AgentRuntimeModelCallOptions,
  AgentRuntimeCapabilities,
  AgentRuntimeCollaborationPolicy,
  AgentRuntimeCollaborationPolicyInput,
  RuntimeCompressionMode,
} from "./turn-types"
// import for internal use (local binding)
import type {
  AgentRuntimeTurnInput,
  AgentRuntimeTurnContextUpdate,
  AgentRuntimeTurnResult,
  AgentRuntimeModelCallOptions,
  AgentRuntimeCapabilities,
  AgentRuntimeCollaborationPolicy,
  AgentRuntimeCollaborationPolicyInput,
  RuntimeCompressionMode,
} from "./turn-types"
/** 解析 entry 路径压缩模式:未传默认 narrative(master 路径). */
function resolveEntryCompressionMode(input: AgentRuntimeTurnInput): RuntimeCompressionMode {
  return input.compressionMode ?? "narrative"
}

/** turn 结束时需写回 context.json 的本轮正文 + 压缩结果(若有). */
const ENTRY_AGENT_PLATFORM_GUARD = [
  "你是当前回合的入口 Agent。",
  "你会收到自己的 AGENT.md、可选 SOUL.md、最近对话（含早期剧情摘要）、工作区上下文和玩家本轮输入。",
  "根据 AGENT.md 的指引决定如何处理本轮输入。如果需要，可以通过 agent_call 联系你的联系人 Agent 获取专业判断。",
  "你的输出是对话的最终回复，直接面向玩家或用户。具体输出格式由当前游戏卡与前端约定决定。",
].join("\n")

const ASSISTANT_AGENT_PLATFORM_GUARD = [
  "你是用户的桌面助手 Agent。",
  "你会收到自己的 AGENT.md、可选 SOUL.md、最近对话（含早期任务摘要）、工作区上下文和用户本轮提问。",
  "根据 AGENT.md 的指引回答用户关于当前游戏卡、工作区约定、框架行为或维护决策的问题。",
  "你的输出是对话的最终回复，直接面向用户。",
].join("\n")

const DELEGATED_AGENT_PLATFORM_GUARD = [
  "你是 Tsian AIRP 中被 agent_call 临时调用的专业 Agent。",
  "你会收到自己的 AGENT.md、可选 SOUL.md、工作区上下文、调用方请求、必要的最近对话和玩家本轮输入。",
  "你不直接面对玩家；你的输出会作为 observation 返回给调用方，由调用方决定如何使用。",
  "请专注回答调用方请求，返回建议、判断、草案、连续性检查或需要沉淀的事实提示。",
  "如果工具说明中列出了可联系 Agent，你可以在确有必要时通过 agent_call 咨询自己的联系人；否则请把需要协作的建议写在输出里。",
].join("\n")

// ─── 固定层标记前缀 ────────────────────────────────────────────────────
// locateHistorySpan 按这些前缀识别消息边界（不依赖 role）。
// stripInternalMarkers 在发送给模型前剥离这些前缀（模型不可见）。
const LAYER_PREFIX = "<!-- tsian-layer:"
const WORKSPACE_CONTEXT_META_TAG = "<!-- tsian-layer: workspace-context-meta -->"
const TOOL_MEMORY_TAG = "<!-- tsian-layer: tool-memory -->"
const TURN_RUNTIME_TAG = "<!-- tsian-layer: turn-runtime -->"
const PLAYER_INPUT_TAG = "<!-- tsian-layer: player-input -->"

/**
 * 判断 entry agent 是否为桌面助手(local agent,非 AIRP 剧情入口).
 * 助手 path 形如 `.tsian/local/assistant/AGENT.md`,AIRP card agent 形如 `agents/<id>/AGENT.md`.
 * 提示词文案按此分支:助手用问答/用户措辞,AIRP agent 用回合/玩家措辞.
 */
function isAssistantEntryAgent(agentPath: string): boolean {
  return agentPath.startsWith(".tsian/local/")
}

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
  /** task 模式:无响应超时起点 wall-clock(Date.now()).每次有活动(tool/round-end)更新.超 inactivityTimeoutMs 抛 TaskTimeoutError.narrative 不用. */
  lastActivityAt?: number
  /** task 模式:无响应超时配额 ms(默认 DEFAULT_TASK_INACTIVITY_TIMEOUT_MS).narrative 不用. */
  inactivityTimeoutMs?: number
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
 * 把 agent 会话上下文快照展开为对话正文 message 序列。
 *
 * summary(若有)作一条 user message 前言(早期任务/剧情摘要);recentTurns 每条
 * 展开为独立 user/assistant message。新结构中 recentTurns 只承载文本对话，
 * 历史工具行动痕迹由 top-level toolMemories 另行渲染为普通工作日志，不再
 * 还原为 provider tool protocol 历史消息。
 */
function buildAgentContextMessages(
  context: AgentContextSnapshot,
  isAssistant: boolean,
  historySummaryRole: "system" | "user" | "assistant" = "user",
): RuntimeChatMessage[] {
  const messages: RuntimeChatMessage[] = []
  if (context.summary) {
    const summaryLabel = isAssistant ? "早期任务摘要" : "早期剧情摘要"
    messages.push({ role: historySummaryRole, content: `${summaryLabel}：\n${context.summary}` })
  }
  if (context.recentTurns.length === 0) {
    if (!context.summary) {
      messages.push({ role: historySummaryRole, content: "（暂无历史对话）" })
    }
  } else {
    for (const entry of context.recentTurns) {
      messages.push({ role: entry.role, content: entry.content })
    }
  }
  return messages
}

/**
 * 定位工具循环 messages 里的剧情正文段边界,供 turn 内压剧情后 slice+替换用
 * (design §2.4).剧情段 = system(index 0)之后、框架信息 user 之前的独立 message
 * 序列(summary + recentTurns).顺序(Phase 0 修正后):system → history → workspace.context
 * → turn.runtime → turn.input ...,故 history 段恒从 index 1 开始.
 * 框架信息锚点:当前回合:/当前问答轮次:(workspace.context 现在在 history 之后,
 * 属动态段,不再是 history 的一部分).
 *
 * 返回 { start, end }(半开区间),start<0 表示无独立剧情段可压,调用方跳过压缩:
 * - entry 稳态路径(注入了 agentContext):start=1, end=框架信息前.
 * - entry 兜底路径(未注入,剧情段首条是"最近对话："拍扁文本):{-1,-1}.
 * - delegated agent 路径(index 1 是调用方 Agent,非剧情段,无独立剧情段可压):{-1,-1}.
 * - 无框架信息锚点(结构不符):{-1,-1}.
 */
/** 消息形状(content 放宽以兼容多模态). 历史段/工具交互段的 content 在实践中始终是 string
 *  (多模态 ContentPart 只出现在当前轮 user 输入),但类型层面需要兼容. */
type MessageLike = { role: string; content: string | ContentPart[]; toolCalls?: unknown[] }

function messageContentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function locateHistorySpan(
  messages: ReadonlyArray<MessageLike>,
): { start: number; end: number } {
  if (messages.length <= 1) {
    return { start: -1, end: -1 }
  }
  // before-history 注入(contextPaths position: "before-history")插在 systemPrompt 和
  // history 之间，每条注入消息以 `<!-- source: xxx -->` 注释前缀开头
  // （contextInjectionsToMessages 产出格式）。扫描跳过这些注入消息，找到 history 段起点。
  // 无 before-history 注入时：messages[1] 不以 `<!-- source:` 开头 → start 停在 1，行为不变。
  let start = 1
  while (start < messages.length) {
    const text = messageContentToText(messages[start].content)
    if (text.startsWith("<!-- source:")) {
      start += 1
      continue
    }
    break
  }
  // 扫描后 start 指向第一条非 before-history 注入消息。若已越界，结构异常。
  if (start >= messages.length) {
    return { start: -1, end: -1 }
  }
  const firstHistoryText = messageContentToText(messages[start].content)
  // 兜底路径(未注入 agentContext):剧情段首条是"最近对话："拍扁文本,无独立 message 序列.
  if (firstHistoryText.startsWith("最近对话：")) {
    return { start: -1, end: -1 }
  }
  // delegated agent:history 段首条是"最近对话窗口："（buildDelegatedAgentMessages 产出），
  // 无独立剧情 message 序列可压（delegated 无 agentContext 快照注入）。
  // 注意：delegated 路径的"调用方 Agent："在 before-history 注入之前（如果有），已被
  // 上面的 `<!-- source:` 扫描跳过；无 before-history 时 start=1 仍指向"调用方 Agent："。
  if (firstHistoryText.startsWith("调用方 Agent：")) {
    return { start: -1, end: -1 }
  }
  // end: 扫描第一条带 <!-- tsian-layer: 前缀的消息（固定层标记），即为 history 段终点。
  // 不依赖 role——固定层的 role 可由 messageLayers 配置改变。
  let end = -1
  for (let i = start + 1; i < messages.length; i += 1) {
    const text = messageContentToText(messages[i].content)
    if (text.startsWith(LAYER_PREFIX)) {
      end = i
      break
    }
  }
  if (end === -1) {
    return { start: -1, end: -1 }
  }
  return { start, end }
}

/**
 * 用压缩后的快照重建剧情段并 splice 替换原段(design §2.4).两种循环都直接用
 * buildAgentContextMessages 的结果(native 产 RuntimeChatMessage[],text 产同结构).
 * buildAgentContextMessages 产出的 AiChatMessage[].system / 框架信息 /
 * 本轮输入 / 后续 tool 交互保留不动.
 */
function replaceHistorySpan<T extends MessageLike>(
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
  message: MessageLike,
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
  const text = messageContentToText(message.content)
  if (message.role === "user" && text.includes("<tsian-tool-observation>")) return true
  if (message.role === "assistant" && text.includes("<tsian-tool-call>")) return true
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
  messages: ReadonlyArray<MessageLike>,
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
  return input.turn + 1
}

function formatWorkspaceFile(file: WorkspaceFile): string {
  const content = file.content.trim() || "（空文件）"
  return [
    `--- ${file.path} ---`,
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
      const triggers = skill.triggers.length
        ? ` triggers=${skill.triggers.join(", ")}`
        : ""
      return `- ${skill.name}: ${skill.description || skill.summary || "（无描述）"}${triggers}`
    })
    .join("\n")
}

/**
 * Build the context message body for a skill whose full SKILL.md was activated
 * via use_skill. The framework injects this as a user message after the round's
 * tool observations so the model sees the skill text in the next round without
 * spending a tool-result round on it. Both tool loops (native and text) call
 * this via collectActivatedSkillContents + this body builder.
 *
 * Skill 是卡模板精心设计的可控内容，全文注入。截断会让 tsian-actions JSON
 * 块的 inputSchema 可能丢失——agent 不知道脚本参数，是难以察觉的问题。
 */
function formatActivatedSkillMessageBody(skill: ActivatedSkillContent): string {
  const header = `已激活 Skill「${skill.name}」。以下是该 Skill 的说明；遵循其指导，并用 run_script 执行其声明的 browser_script action。`
  return [header, "", skill.content].join("\n")
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
  const canInspectFrontend = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.inspectFrontend,
  )
  const canTestSkillScript = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.testSkillScript,
  )
  const canSemanticSearch = platformToolEnabled(
    options.enabledPlatformTools,
    AGENT_PLATFORM_TOOL_NAMES.workspaceSemanticSearch,
  )
  const isNative = options.toolCallMode === "native"
  const toolNames = [
    RUNTIME_WORKSPACE_TOOL_NAMES.useSkill,
    RUNTIME_WORKSPACE_TOOL_NAMES.runScript,
    ...(canCallAgents ? [RUNTIME_WORKSPACE_TOOL_NAMES.agentCall] : []),
    ...(canReadWorkspace
      ? [
          RUNTIME_WORKSPACE_TOOL_NAMES.read,
          RUNTIME_WORKSPACE_TOOL_NAMES.list,
          RUNTIME_WORKSPACE_TOOL_NAMES.search,
          RUNTIME_WORKSPACE_TOOL_NAMES.glob,
        ]
      : []),
    ...(canWriteWorkspace
      ? [
          RUNTIME_WORKSPACE_TOOL_NAMES.diff,
          RUNTIME_WORKSPACE_TOOL_NAMES.write,
          RUNTIME_WORKSPACE_TOOL_NAMES.edit,
          RUNTIME_WORKSPACE_TOOL_NAMES.copy,
          RUNTIME_WORKSPACE_TOOL_NAMES.move,
          RUNTIME_WORKSPACE_TOOL_NAMES.delete,
        ]
      : []),
    ...(canSemanticSearch ? [RUNTIME_WORKSPACE_TOOL_NAMES.semanticSearch] : []),
    ...(canInspectFrontend ? [RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend] : []),
    ...(canTestSkillScript ? [RUNTIME_WORKSPACE_TOOL_NAMES.testSkillScript] : []),
  ]

  const sharedRules = [
    "Runtime 工具是可选能力；只在当前上下文不足、需要读取/修改 workspace、需要联系 Agent 或需要检查前端时使用。",
    `调用 ${RUNTIME_WORKSPACE_TOOL_NAMES.useSkill} 选择可见 Skill Index 中的 name；observation 会返回该 Skill 的完整 SKILL.md 与声明的 action，按其中说明执行脚本。`,
    ...(canReadWorkspace
      ? [
          `不要用 ${RUNTIME_WORKSPACE_TOOL_NAMES.read} 读取 Skill 入口文件；Skill 入口由 ${RUNTIME_WORKSPACE_TOOL_NAMES.useSkill} 激活后自动注入。`,
          `长文件用 ${RUNTIME_WORKSPACE_TOOL_NAMES.read} 的 offset/limit 分段读取；看到 truncated/totalLines/returnedLines 时按需续读。`,
        ]
      : []),
    `只有 browser_script action 才用 ${RUNTIME_WORKSPACE_TOOL_NAMES.runScript}；单次 workspace 读写优先使用顶层工具。`,
  ]

  if (isNative) {
    return [
      ...sharedRules,
      `当前可用工具名称：${toolNames.join(", ")}。具体参数以 API tools schema 为准，不要在正文中手写工具调用块。`,
      ...(canCallAgents ? [`${RUNTIME_WORKSPACE_TOOL_NAMES.agentCall} 的 agentId 从可见 Agent 联系人中选择。`] : []),
      "多个相互独立的只读工具可以在同一轮并行调用。",
      "收到 observation 后继续完成任务；最终输出只包含给玩家/调用方的正文，不包含工具细节。",
    ].join("\n")
  }

  const textExamples = [
    `<tsian-tool-call>`,
    `{"name":"${RUNTIME_WORKSPACE_TOOL_NAMES.useSkill}","arguments":{"name":"prose-style"}}`,
    `</tsian-tool-call>`,
    ...(canReadWorkspace
      ? [
          `<tsian-tool-call>`,
          `{"name":"${RUNTIME_WORKSPACE_TOOL_NAMES.read}","arguments":{"path":"world/canon.md","offset":1,"limit":200}}`,
          `</tsian-tool-call>`,
        ]
      : []),
  ]

  return [
    ...sharedRules,
    `当前可用工具名称：${toolNames.join(", ")}。`,
    "工具调用格式必须独占一个 XML 块；块内只能放一段纯 JSON，不要加 Markdown fence、注释或解释。",
    ...textExamples,
    "收到 observation 后继续完成任务；最终输出不要包含工具调用块、observation、工具细节或实现说明。",
  ].join("\n")
}

/**
 * 把一组 ContextInjection 编译成逐条 RuntimeChatMessage。每条注入消息用 HTML 注释
 * 前缀标注来源（`<!-- source: xxx -->`），供 locateHistorySpan 扫描识别 before-history
 * 注入消息，以及 debug 时辨别来源。注释在合并时被保留（整合器只做 role 合并 + 换行
 * 拼接，不删注释），模型将 HTML 注释视为元信息，不影响理解。
 *
 * 每个 injection 产出一条独立消息（不合并），合并由 mergeConsecutiveRoleMessages
 * 整合器在发送给模型前统一处理。保持逐条产出是为了 locateHistorySpan/replaceHistorySpan
 * 等基于未整合数组的边界扫描逻辑不受整合器影响。
 */
function contextInjectionsToMessages(
  injections: ContextInjection[],
): RuntimeChatMessage[] {
  return injections.map((inj) => ({
    role: inj.role,
    content: `<!-- source: ${inj.source} -->\n${inj.content}`,
  }))
}

/**
 * 消息序列整合器：合并连续相同 role 的消息，纯换行拼接内容，不加自动 XML 标签。
 *
 * 设计理由（design §消息整合器）：
 * - Claude/Gemini API 不接受连续相同 role 消息，OpenAI 接受但内部加隐式分割。合并后
 *   用换行拼接，比多条消息的前缀标注更紧凑、更省 token。
 * - 不加自动标签：酒馆预设大量使用跨条目标签（开标签在条目A、闭标签在条目B）和嵌套
 *   标签。自动加标签会破坏这些结构——给只含开标签的条目再包一层，导致双重嵌套或
 *   结构错乱。标签完全由作者在 contextPath 条目内容里显式写。
 * - 不连续的相同 role 不合并（如 [system, user, system] 保持三条）。
 *
 * 调用时机：仅在 native/text 两个工具循环每轮调用 model API 前对当前 messages 数组
 * 过一遍整合器，产出新数组传给 API。工具循环内的 splice-replace / span 定位操作的是
 * 未整合的原始数组，整合器不 mutate 原数组。
 *
 * tool 角色（native 模式）不与 assistant 合并：tool 消息有独立语义（工具 observation），
 * 且 provider native API 要求 tool 消息跟在 assistant toolCalls 之后，合并会破坏结构。
 * 整合器按 role 严格相等判断，role="tool" 只与 role="tool" 合并（实践中不会连续出现
 * 两条 tool），天然跳过与 assistant 的合并。
 */
function mergeConsecutiveRoleMessages(
  messages: RuntimeChatMessage[],
): RuntimeChatMessage[] {
  const result: RuntimeChatMessage[] = []
  for (const msg of messages) {
    const last = result[result.length - 1]
    if (last && last.role === msg.role) {
      // 合并：纯换行拼接，不加自动标签（标签由作者在内容里显式写）。
      // content 可能是 string 或 ContentPart[]；合并只处理 string content
      // （连续同 role 的注入消息都是 string；多模态 ContentPart[] 只出现在
      // 当前轮 user 输入，不会与同 role 注入消息连续）。
      if (typeof last.content === "string" && typeof msg.content === "string") {
        last.content += `\n\n${msg.content}`
      } else {
        // 多模态 content 不合并（罕见边界：同 role 连续但其中一条是 ContentPart[]）。
        result.push({ ...msg })
      }
    } else {
      result.push({ ...msg })
    }
  }
  return result
}

/**
 * 剥离消息内容开头的内部标记前缀（`<!-- tsian-layer: -->` 和 `<!-- source: -->`）。
 * 在 mergeConsecutiveRoleMessages 之后、API 调用之前执行——模型看到的是干净内容。
 * 只剥离消息**开头**的标记（`^` 锚定），不剥离消息内部合法的 HTML 注释。
 * 只处理 string content；ContentPart[]（多模态）不处理。
 */
function stripInternalMarkers(messages: RuntimeChatMessage[]): RuntimeChatMessage[] {
  const layerRe = /^<!-- tsian-layer: [^>]* -->\n?/
  const sourceRe = /^<!-- source: [^>]* -->\n?/
  return messages.map(msg => {
    if (typeof msg.content !== "string") return msg
    let content = msg.content
    // 可能同时有 layer 和 source 前缀（理论上不会，但防御性循环 2 次）
    for (let i = 0; i < 2; i++) {
      if (layerRe.test(content)) {
        content = content.replace(layerRe, "")
      } else if (sourceRe.test(content)) {
        content = content.replace(sourceRe, "")
      } else {
        break
      }
    }
    return { ...msg, content }
  })
}

/**
 * 构建 workspace.context 的 message 序列（元信息段 + 逐文件段）。
 *
 * 拆分目标：让稳定 contextFile（文档/README 等会话中不变的大文件）各自独立进入
 * 前缀缓存命中区，动态 contextFile（runtime.json/brief 等每轮或偶变文件）单独
 * miss、互不拖累。详见任务 06-30-workspace-context-cache-split 的 design.md。
 *
 * 顺序保持 contextPaths 声明顺序——稳定的自然落在前缀区、动态的在尾部。不重排，
 * 避免破坏 agent 作者的语境组织意图，且 provider 前缀缓存按 token 匹配不按 message
 * 边界，重排无额外收益。`label` 区分 entry（"Workspace Agent 上下文"）与 delegated
 * （"目标 Agent 上下文"）路径。
 *
 * 注入消息从 contextInjectionsByPosition["workspace-context"] 取（= 旧 contextInjections
 * 字段，向后兼容）。每条注入用 `<!-- source: xxx -->` 注释前缀标注来源（contextInjectionsToMessages）。
 *
 * 边界安全性：所有边界锚定（locateHistorySpan 扫"当前回合："、locateTaskInteractionSpan
 * 从末尾按工具形态扫描）都不依赖固定 message index，拆成 N 条不影响压缩/边界判定。
 */
function buildAgentContextMessages_split(
  context: AgentContextEntry,
  label: "Workspace Agent 上下文" | "目标 Agent 上下文",
  metaRole: "system" | "user" | "assistant" = "user",
): RuntimeChatMessage[] {
  const messages: RuntimeChatMessage[] = [
    { role: metaRole, content: `${WORKSPACE_CONTEXT_META_TAG}\n${label}（元信息）：\n${formatAgentRuntimeContextMeta(context)}` },
  ]
  // 注入消息从 workspace-context 组取（= 旧 contextInjections 字段，向后兼容）。
  // 每条注入用 `<!-- source: xxx -->` 注释前缀标注来源。
  messages.push(...contextInjectionsToMessages(context.contextInjectionsByPosition["workspace-context"]))
  return messages
}

/** 列出所有 position 组的注入条目来源，按 position 分组显示。 */
function formatAllContextInjections(context: AgentContextEntry): string {
  const positions: ContextPathPosition[] = ["before-history", "workspace-context", "after-input", "tail"]
  const lines: string[] = []
  let total = 0
  for (const pos of positions) {
    const group = context.contextInjectionsByPosition[pos]
    if (group.length === 0) continue
    lines.push(`  [${pos}]`)
    for (const inj of group) {
      lines.push(`    - ${inj.source}`)
    }
    total += group.length
  }
  if (total === 0) {
    return "（暂无已加载 contextPaths 注入条目）"
  }
  return lines.join("\n")
}

/**
 * workspace.context 的元信息部分（不含 contextInjections 全文）。
 *
 * 含 header（Agent id/title/summary/path）+ notesFile + contextInjections 来源提示 +
 * missingContextPaths + skillIndex。这些字段字节量小、变化频率低，归同条 message；
 * 偶发 miss（agent 编辑定义/写 notes/装 skill 时）可接受，不值得为这点字节再拆。
 */
function formatAgentRuntimeContextMeta(context: AgentContextEntry): string {
  return [
    `Agent：${context.agent.id} — ${context.agent.title}`,
    `Agent 摘要：${context.agent.summary || "（无摘要）"}`,
    `Agent 定义路径：${context.agent.path}`,
    "",
    formatOptionalWorkspaceFile("Agent notes", context.notesFile),
    "",
    "声明的 contextPaths 注入条目：",
    formatAllContextInjections(context),
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
  const soulContent = context.soulFile?.content.trim()
  return [
    guard,
    "",
    context.agentFile.content.trim(),
    ...(soulContent ? ["", soulContent] : []),
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

  const context = assembleAgentContext(input.workspaceFiles, {
    agentId: input.agentId,
    toolFilter: input.toolFilter,
  })
  if (!context) {
    throw new Error(
      `Entry Agent "${input.agentId}" was not found. Restore agents/${input.agentId}/AGENT.md or recreate the default workspace.`,
    )
  }

  return context
}

/** 把前端注入的 InjectionMessage[] 按 position 过滤成 RuntimeChatMessage[]。
 *  before-input 插在玩家输入前，after-input 插在玩家输入后。保持数组顺序。 */
function injectionMessagesForPosition(
  injection: InjectionMessage[] | undefined,
  position: "before-input" | "after-input",
): RuntimeChatMessage[] {
  if (!injection || injection.length === 0) {
    return []
  }
  const messages: RuntimeChatMessage[] = []
  for (const item of injection) {
    const itemPosition = item.position ?? "before-input"
    if (itemPosition !== position) {
      continue
    }
    if (item.role === "assistant") {
      messages.push({ role: "assistant", content: item.content })
    } else {
      messages.push({ role: item.role, content: item.content })
    }
  }
  return messages
}

function buildEntryAgentMessages(
  input: AgentRuntimeTurnInput,
  context: AgentContextEntry,
  collaborationPolicy: AgentRuntimeCollaborationPolicy,
  agentCallState: AgentCallTurnState,
  toolCallMode?: BrowserAiToolCallMode,
  agentContext?: AgentContextSnapshot | null,
): RuntimeChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  const visibleContacts = input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, context)
    : []
  const permissions = deriveAgentRuntimePermissionProfile(context.agent)
  const isAssistant = isAssistantEntryAgent(context.agent.path)
  const entryGuard = isAssistant ? ASSISTANT_AGENT_PLATFORM_GUARD : ENTRY_AGENT_PLATFORM_GUARD
  const turnLabel = isAssistant ? "当前问答轮次" : "当前回合"
  const inputLabel = isAssistant ? "用户本轮提问" : "玩家本轮输入"
  // 固定层 role 配置（messageLayers）。未配置的层保持默认 role。
  const ml = context.agent.messageLayers
  const historySummaryRole = ml.historySummary?.role ?? "user"
  const metaRole = ml.workspaceContextMeta?.role ?? "user"
  const toolMemoryRole = ml.toolMemory?.role ?? "user"
  const turnRuntimeRole = ml.turnRuntime?.role ?? "user"
  // 剧情正文层:优先用注入的 context 快照(独立 message 序列);未注入则从
  // recentHistory(turn 文件重建)兜底——旧逻辑 formatHistory 也是拍扁文本,这里
  // 保持兜底用文本形式(首 turn/旧存档迁移场景,非稳态路径).
  const historyMessages: RuntimeChatMessage[] = agentContext
    ? buildAgentContextMessages(agentContext, isAssistant, historySummaryRole)
    : [{ role: "user", content: `最近对话：\n${formatHistory(history)}` }]
  const toolMemoryLog = isAssistant
    ? renderToolMemoriesForModel(agentContext?.toolMemories)
    : null
  const toolMemoryMessages: RuntimeChatMessage[] = toolMemoryLog
    ? [{ role: toolMemoryRole, content: `${TOOL_MEMORY_TAG}\n${toolMemoryLog}` }]
    : []
  // 前端 injection：按 position 分两组，before-input 在框架信息后/玩家输入前，
  // after-input 在玩家输入后。不落盘、不进 context.json，平台不解释语义。
  const beforeInputInjection = injectionMessagesForPosition(input.injection, "before-input")
  const afterInputInjection = injectionMessagesForPosition(input.injection, "after-input")
  return [
    {
      role: "system",
      content: buildWorkspaceAgentSystemPrompt(entryGuard, context, {
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
    // before-history 注入（contextPaths position: "before-history"）：system prompt 之后、
    // history 之前。稳定前缀层，只放稳定内容（越狱确认等）。无声明时为空数组，消息序列
    // 与旧逻辑一致（history 紧随 system）。每条注入用 `<!-- source: xxx -->` 注释前缀。
    ...contextInjectionsToMessages(context.contextInjectionsByPosition["before-history"]),
    // history(已发生剧情,跨 turn 字节级不变)紧随 system,作为最长稳定前缀.
    // workspace.context 含 contextInjections 注入正文/skillIndex 等 Agent 写入后即变
    // 的动态内容,后置于 history 之前会提前缓存断点使其后 history 全部 miss
    // (见 design 设计修正记录 修正 1).
    ...historyMessages,
    // workspace.context 拆成元信息段 + 逐文件段（任务 06-30-workspace-context-cache-split）：
    // 稳定文件各自独立命中前缀缓存，动态文件单独 miss 互不拖累。仍在 history 之后，
    // 不破坏 design 修正记录 1 的缓存边界。注入消息从 contextInjectionsByPosition
    // ["workspace-context"] 取（= 旧 contextInjections，向后兼容）。
    ...buildAgentContextMessages_split(context, "Workspace Agent 上下文", metaRole),
    // task-mode 助手的跨 turn 工具记忆作为普通工作日志放在 workspace context 后，
    // 避免高频变化块提前破坏大段稳定前缀缓存；不使用 provider tool protocol。
    ...toolMemoryMessages,
    {
      role: turnRuntimeRole,
      content: `${TURN_RUNTIME_TAG}\n${turnLabel}：${currentRuntimeTurnNumber(input)}`,
    },
    // 前端注入（before-input）：框架信息之后、玩家输入之前。
    ...beforeInputInjection,
    // 本轮输入:单独一条 user message,框架信息之后、工具循环之前.
    // 有附件图片时 content 变为 ContentPart[](text + image parts),走多模态.
    {
      role: "user",
      ...(input.userInputAttachments && input.userInputAttachments.length > 0
        ? { content: [{ type: "text" as const, text: `${PLAYER_INPUT_TAG}\n${inputLabel}：\n${input.userInput}` }, ...input.userInputAttachments] as ContentPart[] }
        : { content: `${PLAYER_INPUT_TAG}\n${inputLabel}：\n${input.userInput}` }),
    },
    // 前端注入（after-input）：玩家输入之后、工具循环之前。
    ...afterInputInjection,
    // after-input 注入（contextPaths position: "after-input"）：玩家输入 + 前端注入之后、
    // tail 之前。紧贴续写点的框架模板层（COT 问题框架、输出格式模板）。无声明时为空。
    ...contextInjectionsToMessages(context.contextInjectionsByPosition["after-input"]),
    // tail 注入（contextPaths position: "tail"）：消息序列绝对末尾，续写引导。
    // 替代旧 PREFILL.md 独立机制——PREFILL.md 兼容迁移在 context.ts 完成（无 tail
    // contextPath 时自动将 PREFILL.md 内容转为 tail 注入）。有 tail contextPath 时
    // PREFILL.md 被忽略。不落盘、不进 context.json，不破坏稳定前缀缓存。
    ...contextInjectionsToMessages(context.contextInjectionsByPosition["tail"]),
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

// ─── trace 采集增强 helpers（开发者诊断用）─────────────────────────────────
// trace 只记元数据：工具调用记 name + 参数键名（不记参数值），错误记 message + 截断 stack。

/** 把工具调用列表拍成 trace toolCalls 摘要：{name, argsKeys}。只记键名不记值。 */
function traceToolCallsSummary(
  calls: { name?: string; arguments?: Record<string, unknown> }[],
): { name: string; argsKeys: string[] }[] {
  return calls
    .map((call) => ({
      name: typeof call.name === "string" ? call.name : "?",
      argsKeys: call.arguments && typeof call.arguments === "object"
        ? Object.keys(call.arguments)
        : [],
    }))
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
  // 固定层 role 配置（从目标 agent 的 messageLayers 读取）。
  const ml = targetContext.agent.messageLayers
  const metaRole = ml.workspaceContextMeta?.role ?? "user"
  const turnRuntimeRole = ml.turnRuntime?.role ?? "user"
  // contextInjectionsToMessages 产 RuntimeChatMessage[]，但注入消息只有
  // system/user/assistant + string content（无 tool role），安全降维为 AiChatMessage[]。
  const beforeHistoryMessages = contextInjectionsToMessages(
    targetContext.contextInjectionsByPosition["before-history"],
  ) as AiChatMessage[]
  const afterInputMessages = contextInjectionsToMessages(
    targetContext.contextInjectionsByPosition["after-input"],
  ) as AiChatMessage[]
  const tailMessages = contextInjectionsToMessages(
    targetContext.contextInjectionsByPosition["tail"],
  ) as AiChatMessage[]
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
    // before-history 注入（contextPaths position: "before-history"）：system prompt 之后、
    // 调用方信息之前。delegated 路径同样支持（续写引导可能有用）。无声明时为空。
    ...beforeHistoryMessages,
    {
      role: "user",
      content: [
        "调用方 Agent：",
        `${callerContext.agent.id} — ${callerContext.agent.title}`,
        callerContext.agent.summary || "（无摘要）",
      ].join("\n"),
    },
    { role: "user", content: `最近对话窗口：\n${formatHistory(history)}` },
    // 目标 Agent 上下文同样拆成元信息段 + 逐条注入段（与 entry 路径一致）。
    // workspace-context 组注入由 buildAgentContextMessages_split 从
    // contextInjectionsByPosition["workspace-context"] 取。安全降维为 AiChatMessage[]。
    ...(buildAgentContextMessages_split(targetContext, "目标 Agent 上下文", metaRole) as AiChatMessage[]),
    { role: turnRuntimeRole, content: `${TURN_RUNTIME_TAG}\n${[`当前回合：${currentRuntimeTurnNumber(input)}`, `historyMode：${agentCall.historyMode}`].join("\n")}` },
    { role: "user", content: `${PLAYER_INPUT_TAG}\n玩家本轮输入：\n${input.userInput}` },
    {
      role: "user",
      content: [
        ...(agentCall.contextSummary ? ["调用方提供的上下文摘要：", agentCall.contextSummary, ""] : []),
        "调用请求：",
        agentCall.request,
        "",
        ...(agentCall.reason ? ["调用原因：", agentCall.reason, ""] : []),
        ...(agentCall.expectedOutput ? ["期望输出：", agentCall.expectedOutput, ""] : []),
        "请只回答调用方请求，不要输出给玩家的最终正文，也不要提到工具协议。",
      ].join("\n"),
    },
    // after-input 注入（contextPaths position: "after-input"）：调用请求之后、tail 之前。
    ...afterInputMessages,
    // tail 注入（contextPaths position: "tail"）：消息序列绝对末尾，续写引导。
    // delegated agent 如果声明了 tail 注入也尊重（PREFILL.md 兼容迁移兜底）。
    ...tailMessages,
  ]
}

function createAgentCallRunner(
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  callerContext: AgentContextEntry,
  state: AgentCallTurnState,
  depth: number,
  collaborationPolicy: AgentRuntimeCollaborationPolicy,
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
      toolFilter: input.toolFilter,
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
    const stepStartedAt = Date.now()
    capabilities.emitTrace?.({
      type: "agent_step_started",
      ...traceAgentBase(targetContext, debugLabel),
      data: {
        agentTitle: targetContext.agent.title,
        ...agentCallTraceFacts(metadata),
        delegated: true,
        startedAt: stepStartedAt,
      },
    })

    // 任务型 agent 时长兜底(design §2.6):独立 timeoutController + setTimeout,
    // 与用户 abort(input.signal)合并成 compositeSignal 传给工具循环.超时瞬间能
    // abort 正在 await 的 model 调用,不只靠循环内 Date.now() 检查.主 agent 可经
    // agent_call 的 timeoutMs 参数显式给子代理更长时间,不传用默认 600s.
    const inactivityTimeoutMs = agentCall.timeoutMs ?? DEFAULT_TASK_INACTIVITY_TIMEOUT_MS
    const timeoutController = new AbortController()
    const timeoutTimer = setTimeout(
      () => timeoutController.abort("task-timeout"),
      inactivityTimeoutMs,
    )
    const compositeSignal = AbortSignal.any(
      [input.signal, timeoutController.signal].filter(Boolean) as AbortSignal[],
    )
    const lastActivityAt = Date.now()

    try {
      const response = (await callAgentModelWithWorkspaceTools(
        // delegated agent 无跨 turn 工具调用历史(无 AgentContextSnapshot),
        // buildDelegatedAgentMessages 产 AiChatMessage[](无 role:tool),安全升维为 RuntimeChatMessage[].
        buildDelegatedAgentMessages(
          input,
          callerContext,          targetContext,
          agentCall,
          collaborationPolicy,
          state,
          metadata.targetDepth,
          capabilities.toolCallMode,
        ) as RuntimeChatMessage[],
        input,
        capabilities,
        {
          debugLabel,
          signal: compositeSignal,
          agentId: targetContext.agent.id,
          // Thread the caller's streaming/tool-event sinks so the delegated
          // agent's process is visible upstream (agentId bound by the tool
          // loop to targetContext.agent.id). Both native and text loops now
          // emit onRoundEnd/onTool; text loop also streams onDelta when the
          // model has streaming enabled (C1/C2/B2-runtime).
          onDelta: input.onDelta,
          onRoundEnd: input.onRoundEnd,
          onTool: input.onTool,
          onAskUser: input.onAskUser,
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
          lastActivityAt,
          inactivityTimeoutMs,
        },
      )).text.trim()
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
          durationMs: Date.now() - stepStartedAt,
        },
      })

      return {
        status: "completed",
        targetAgent: {
          id: targetContext.agent.id,
          title: targetContext.agent.title,
        },
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
          ...errorToTraceDataWithStack(error),
          ...agentCallTraceFacts(failedMetadata),
          delegated: true,
          durationMs: Date.now() - stepStartedAt,
          ...(isTimeout ? { timeout: true, inactivityTimeoutMs } : {}),
          ...(isTaskStall ? { stalled: true } : {}),
        },
      })
      throw agentCallError(
        "AGENT_CALL_FAILED",
        isTimeout
          ? `agent_call 无响应超时（${Math.round(inactivityTimeoutMs / 1000)}s）中止 for Agent "${targetContext.agent.id}".`
          : isTaskStall
            ? `agent_call 上下文压缩无效中止 for Agent "${targetContext.agent.id}".`
            : `agent_call failed for Agent "${targetContext.agent.id}".`,
        {
          cause: errorToTraceData(error),
          ...(isTimeout ? { timeout: true, inactivityTimeoutMs } : {}),
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

function formatRawToolObservationForContext(observation: RuntimeWorkspaceToolObservation): string {
  if (!observation.ok) {
    return JSON.stringify(
      observation.error ?? { code: "UNKNOWN", message: "Unknown error" },
    )
  }
  if (typeof observation.result === "string") {
    return observation.result
  }
  try {
    return JSON.stringify(observation.result)
  } catch {
    return String(observation.result)
  }
}

/**
 * 把本轮工具调用的 observations + toolCalls 转成 AgentContextToolCall[](raw/UI/debug 形态).
 * observation 直接取工具返回层完整结果,不走 model-facing compact；模型上下文使用
 * AgentContextToolMemory 投影与 format*ToolObservationMessage 的 compact 路径。
 */
function collectToolCallsForContext(
  toolCalls: { id?: string; name: string; arguments: Record<string, unknown> }[],
  observations: RuntimeWorkspaceToolObservation[],
  observationTextFn: (obs: RuntimeWorkspaceToolObservation) => string,
): AgentContextToolCall[] {
  const collected: AgentContextToolCall[] = []
  for (let i = 0; i < toolCalls.length; i++) {
    const call = toolCalls[i]
    const obs = observations[i]
    if (!obs) continue
    const observationText = observationTextFn(obs)
    // workspace_read 的 truncated 在 result 里(nested),这里尽力提取;无则 undefined.
    const truncated = typeof obs.result === "object" && obs.result !== null
      ? ((obs.result as { truncated?: boolean }).truncated)
      : undefined
    collected.push({
      id: call.id ?? `tool-${i}`,
      name: call.name,
      arguments: JSON.stringify(call.arguments),
      observation: observationText,
      ...(truncated ? { truncated } : {}),
      ...(obs.ok ? {} : { failed: true }),
    })
  }
  return collected
}

async function callAgentModelWithWorkspaceToolsNative(
  messages: RuntimeChatMessage[],
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  options: AgentRuntimeModelCallOptions,
  agentContext: AgentContextEntry,
  toolOptions: WorkspaceToolLoopOptions,
): Promise<{ text: string; usage?: { input?: number; output?: number; total?: number }; collectedToolCalls?: AgentContextToolCall[]; collectedToolMemories?: AgentContextToolMemory[]; collectedTimelineItems?: TurnTimelineItem[] }> {
  // messages 已是 RuntimeChatMessage[](buildEntryAgentMessages 产结构化,native 无需转换).
  let runtimeMessages = messages
  const collectedToolCalls: AgentContextToolCall[] = []
  const collectedToolMemories: AgentContextToolMemory[] = []
  const collectedTimelineItems: TurnTimelineItem[] = []
  // 每轮 reasoning/content 文本累积器(供采集 thought/interim processNode).
  let roundReasoning = ""
  let roundContent = ""
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
    // User Tools already filtered for this Agent by `filterToolsForAgent`
    // during context assembly (context.ts). Exposed alongside platform tools
    // in the native function-calling schema — see PRD R3.
    userTools: agentContext.toolIndex,
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
      ? toolOptions.contextTokenBudget * (isTaskMode ? getTaskContextCompressTriggerRatio() : getNarrativeContextCompressTriggerRatio())
      : 0
  let compressedThisTurn = false // narrative:一次压缩标记.task 不用(可多次).
  let taskSummary: string | null = null // task:前次压缩摘要,供下次压缩作 oldSummary.
  let lastRoundText = ""
  let lastRoundUsage: { input?: number; output?: number; total?: number } | undefined

  for (let round = 0; ; round += 1) {
    assertNotAborted(options.signal)

    // 每轮调 model 前做 token 预算检查(含 round 0).达 85% budget 按模式分流:
    // - narrative:第一次 → 压剧情腾空间,tool 交互全保留,继续;第二次 → 兜底C.
    // - task:时长检查 → 压工具交互段(多次) → 压缩无效早退 → 无段可压/压不动走兜底C.
    if (triggerThreshold > 0) {
      const totalTokens = estimateRuntimeMessagesTokens(runtimeMessages)
      if (totalTokens > triggerThreshold) {
        if (isTaskMode) {
          // task 模式:无响应超时检查(每轮查,不等 model 调用)
          if (
            toolOptions.lastActivityAt !== undefined
            && toolOptions.inactivityTimeoutMs !== undefined
            && Date.now() - toolOptions.lastActivityAt > toolOptions.inactivityTimeoutMs
          ) {
            throw new TaskTimeoutError(toolOptions.inactivityTimeoutMs)
          }
          const interactionSpan = locateTaskInteractionSpan(runtimeMessages, "native")
          if (interactionSpan.start < 0) {
            // 无工具交互段可压(异常,通常 round 0 不该触发)→ 走兜底
            const finalText = lastRoundText.trim()
            if (finalText) {
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
          // native 路径:buildAgentContextMessages 已产 RuntimeChatMessage[],无需 aiChatMessagesToRuntime.
          const newHistory = buildAgentContextMessages(
            toolOptions.agentContextSnapshot!,
            isAssistantEntryAgent(agentContext.agent.path),
            agentContext.agent.messageLayers.historySummary?.role ?? "user",
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
      // 包装 onDelta:除了透传给 UI,还累积本轮 reasoning/content 文本供采集 processNode.
      onDelta: options.onDelta
        ? (agentId, delta, r, kind) => {
            if (r === round) {
              if (kind === "reasoning") roundReasoning += delta
              else roundContent += delta
            }
            options.onDelta!(agentId, delta, r, kind)
          }
        : ((agentId: string, delta: string, r: number, kind: "reasoning" | "content") => {
            if (r === round) {
              if (kind === "reasoning") roundReasoning += delta
              else roundContent += delta
            }
          }) as AgentRuntimeModelCallOptions["onDelta"],
    }
    // 整合器：合并连续相同 role 消息（Claude/Gemini API 硬要求）。
    // 产出新数组传给 API，不 mutate runtimeMessages（工具循环的 splice-replace/
    // span 定位继续操作未整合的原始数组）。
    const mergedMessages = stripInternalMarkers(mergeConsecutiveRoleMessages(runtimeMessages))
    const result = await capabilities.callModelNative!(mergedMessages, callOptions, tools)
    assertNotAborted(options.signal)
    lastRoundText = result.text
    // Track the latest round's usage; the final stop round's input tokens
    // represent the full context size sent to the model (for the ring widget).
    lastRoundUsage = result.usage

    // 活动信号:每轮结束更新 lastActivityAt(无响应超时重置)
    if (toolOptions.lastActivityAt !== undefined) {
      toolOptions.lastActivityAt = Date.now()
    }

    // Notify the caller that this round ended, with the finish reason so it can
    // classify the streamed text as thought (tool_calls) or final (stop). Emitted
    // for every round including the final stop round. agentId identifies which
    // agent's tool loop this round belongs to (entry or delegated agent_call target).
    options.onRoundEnd?.(agentContext.agent.id, round, result.finishReason)

    // 采集 processNode:tool_calls 轮 → interim(过渡文本)+ thought(思维链);
    // stop 轮 → thought(若有思维链).与 UI composable 的 timeline 构建同构.
    if (result.finishReason === "tool_calls") {
      if (roundContent.trim()) {
        collectedTimelineItems.push({ kind: "interim", id: `interim-r${round}`, round, text: roundContent, collapsed: false })
      }
      if (roundReasoning.trim()) {
        collectedTimelineItems.push({ kind: "thought", id: `thought-r${round}`, round, text: roundReasoning, collapsed: true })
      }
    } else {
      // stop 轮:思维链(若有)折叠为 thought;content 是最终回复不入 processNode(它是 content).
      if (roundReasoning.trim()) {
        collectedTimelineItems.push({ kind: "thought", id: `thought-r${round}`, round, text: roundReasoning, collapsed: true })
      }
    }
    roundReasoning = ""
    roundContent = ""

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
        messageCount: mergedMessages.length,
        outputLength: result.text.length,
        hasToolCalls: result.toolCalls.length > 0,
        toolCallCount: result.toolCalls.length,
        round,
        finishReason: result.finishReason,
        ...(lastRoundUsage ? { usage: lastRoundUsage } : {}),
        ...(result.toolCalls.length > 0
          ? { toolCalls: traceToolCallsSummary(result.toolCalls as { name?: string; arguments?: Record<string, unknown> }[]) }
          : {}),
      },
    })

    if (result.finishReason === "stop" || result.toolCalls.length === 0) {
      return { text: result.text.trim(), usage: lastRoundUsage, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
        )
        : undefined,
      runBrowserScript: capabilities.runBrowserScript,
      runTestSkillScript: capabilities.runTestSkillScript,
      runInspectFrontend: capabilities.runInspectFrontend,
      actionExecutorPolicy: capabilities.actionExecutorPolicy,
      workspaceMutations: capabilities.workspaceMutations,
      exposedWorkspaceOperations: permissions.exposedWorkspaceOperations,
      semanticSearchOwnerId: capabilities.semanticSearchOwnerId,
      signal: options.signal,
      debugLabel: options.debugLabel,
      emitTrace: capabilities.emitTrace,
      // Tool process events (子2b R2): bind the current round and agentId here
      // so the executor's onTool stays callId/name/status only; the caller binds
      // turn. agentId is this loop's agent (entry or delegated target).
      onTool: options.onTool
        ? (callId, name, status, output) => {
            options.onTool!(agentContext.agent.id, round, callId, name, status, output)
            // 采集 tool processNode(按 callId 去重,与 UI onTool 回调同源,供持久化).
            const existing = collectedTimelineItems.find(
              (n): n is TurnTimelineItem & { kind: "tool" } => n.kind === "tool" && n.id === callId,
            )
            if (existing) {
              existing.status = status
              if (output !== undefined) existing.output = output
            } else {
              collectedTimelineItems.push({
                kind: "tool",
                id: callId,
                round,
                name,
                status,
                collapsed: true,
                ...(output !== undefined ? { output } : {}),
              })
            }
          }
        : (callId: string, name: string, status: "loading" | "running" | "success" | "failed", output?: TurnToolOutput) => {
            // 无 UI onTool 时仍采集 processNode(按 callId 去重,供持久化).
            const existing = collectedTimelineItems.find(
              (n): n is TurnTimelineItem & { kind: "tool" } => n.kind === "tool" && n.id === callId,
            )
            if (existing) {
              existing.status = status
              if (output !== undefined) existing.output = output
            } else {
              collectedTimelineItems.push({
                kind: "tool",
                id: callId,
                round,
                name,
                status,
                collapsed: true,
                ...(output !== undefined ? { output } : {}),
              })
            }
          },
      onAskUser: options.onAskUser,
    }, toolCalls)

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
        content: formatNativeToolObservationContent(observation),
      })
    }

    // 采集本轮原始工具调用(供 UI/debug 会话消息完整保留)与 model-facing 工具记忆投影(供 task context).
    collectedToolCalls.push(...collectToolCallsForContext(
      result.toolCalls,
      observations,
      formatRawToolObservationForContext,
    ))
    collectedToolMemories.push(...collectToolMemoriesForContext(
      result.toolCalls,
      observations,
      currentRuntimeTurnNumber(input),
      round,
    ))

    // Inject image ContentParts from workspace_read image results as a user
    // message(tool role content 是 string,不能放 image;image 走 user ContentPart[]).
    const imageParts = observations
      .flatMap((obs) => obs.imageParts ?? [])
    if (imageParts.length > 0) {
      runtimeMessages.push({
        role: "user",
        content: imageParts,
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
  messages: RuntimeChatMessage[],
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  options: AgentRuntimeModelCallOptions,
  agentContext: AgentContextEntry | null,
  toolOptions?: WorkspaceToolLoopOptions,
): Promise<{ text: string; usage?: { input?: number; output?: number; total?: number }; collectedToolCalls?: AgentContextToolCall[]; collectedToolMemories?: AgentContextToolMemory[]; collectedTimelineItems?: TurnTimelineItem[] }> {
  const collectedToolCalls: AgentContextToolCall[] = []
  const collectedToolMemories: AgentContextToolMemory[] = []
  const collectedTimelineItems: TurnTimelineItem[] = []
  if (!input.workspaceFiles || !agentContext) {
    // text 路径:messages 是 RuntimeChatMessage[](超集),text 模式无 role:tool,安全降级为 AiChatMessage[].
    // 整合器：合并连续相同 role 消息（Claude/Gemini API 硬要求），产出新数组传给 API。
    const mergedMessages = stripInternalMarkers(mergeConsecutiveRoleMessages(messages))
    const response = await capabilities.callModel(mergedMessages as AiChatMessage[], options)
    capabilities.emitTrace?.({
      type: "model_call_completed",
      debugLabel: options.debugLabel,
      ok: true,
      data: {
        messageCount: mergedMessages.length,
        outputLength: response.length,
        hasToolCalls: false,
        toolCallCount: 0,
        round: 0,
        finishReason: "stop",
      },
    })
    return { text: response.trim() }
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
    )
  }

  // text 路径用 AiChatMessage[](text 循环的 compress/inject/skill 全是 AiChatMessage 签名).
  // messages 是 RuntimeChatMessage[](buildEntryAgentMessages 产),text 模式无 role:tool,安全降级.
  let nextMessages: AiChatMessage[] = messages as AiChatMessage[]
  const workspaceToolSession = createRuntimeWorkspaceToolSessionState()
  const permissions = deriveAgentRuntimePermissionProfile(agentContext.agent)
  // 每轮 content 文本累积器(供采集 interim/thought processNode,对称 native 循环).
  // text 模式无独立 reasoning stream(kind 恒 "content");思考内容在正文里被 stripThinkBlocks 剥离.
  let roundContent = ""
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
      ? toolOptions.contextTokenBudget * (isTaskMode ? getTaskContextCompressTriggerRatio() : getNarrativeContextCompressTriggerRatio())
      : 0
  let compressedThisTurn = false // narrative:一次压缩标记.task 不用(可多次).
  let taskSummary: string | null = null // task:前次压缩摘要,供下次压缩作 oldSummary.
  let lastRoundText = ""
  // text-protocol 路径 callModel 返回 string 不带 usage,此变量恒 undefined.
  // 声明它只为与 native loop 的 return 结构对称(避免类型分叉).
  let lastRoundUsage: { input?: number; output?: number; total?: number } | undefined

  for (let round = 0; ; round += 1) {
    assertNotAborted(options.signal)

    // 每轮调 model 前 token 预算检查(含 round 0).达 85% budget 按模式分流:
    // - narrative:第一次 → 压剧情腾空间;第二次 → 兜底C.
    // - task:时长检查 → 压工具交互段(多次) → 压缩无效早退 → 无段可压/压不动走兜底C.
    if (triggerThreshold > 0) {
      const totalTokens = estimateAiChatMessagesTokens(nextMessages)
      if (totalTokens > triggerThreshold) {
        if (isTaskMode) {
          // task 模式:无响应超时检查
          if (
            toolOptions?.lastActivityAt !== undefined
            && toolOptions?.inactivityTimeoutMs !== undefined
            && Date.now() - toolOptions.lastActivityAt > toolOptions.inactivityTimeoutMs
          ) {
            throw new TaskTimeoutError(toolOptions.inactivityTimeoutMs)
          }
          const interactionSpan = locateTaskInteractionSpan(nextMessages, "text")
          if (interactionSpan.start < 0) {
            const finalText = stripRuntimeWorkspaceToolCallBlocks(lastRoundText).trim()
            if (finalText) {
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
          const newHistory = buildAgentContextMessages(
            toolOptions!.agentContextSnapshot!,
            agentContext ? isAssistantEntryAgent(agentContext.agent.path) : false,
            agentContext?.agent.messageLayers.historySummary?.role ?? "user",
          )
          // text 模式 buildAgentContextMessages 无 role:tool,安全降级为 AiChatMessage[].
          replaceHistorySpan(nextMessages, historySpan, newHistory as AiChatMessage[])
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

    // 构建 callOptions:绑定 round + 包装 onDelta 累积 roundContent(供 processNode 采集).
    // 对称 native 循环的 callOptions 构建(index.ts:1636-1654).
    const callOptions: AgentRuntimeModelCallOptions = {
      ...options,
      round,
      // Text 模式 onDelta:累积本轮 content 文本供采集 interim/thought processNode.
      // text 协议无独立 reasoning stream(kind 恒 "content");思考内容在正文里被
      // stripThinkBlocks 剥离喂模型,但 UI 流式期仍可见(由 render 层 stripForDisplay).
      onDelta: options.onDelta
        ? (agentId, delta, r, kind) => {
            if (r === round && kind === "content") {
              roundContent += delta
            }
            options.onDelta!(agentId, delta, r, kind)
          }
        : undefined,
    }

    // 整合器：合并连续相同 role 消息（Claude/Gemini API 硬要求）。
    // 产出新数组传给 API，不 mutate nextMessages（工具循环的 splice-replace/
    // span 定位继续操作未整合的原始数组）。
    const mergedMessages = stripInternalMarkers(mergeConsecutiveRoleMessages(nextMessages as RuntimeChatMessage[]))
    const response = await capabilities.callModel(mergedMessages as AiChatMessage[], callOptions)
    assertNotAborted(options.signal)
    lastRoundText = response
    // 清空本轮 content 累积器:下一轮 onDelta 重新累积(或回合已结束).
    roundContent = ""

    const toolCalls = parseRuntimeWorkspaceToolCalls(response)
    const finishReason: "stop" | "tool_calls" = toolCalls.length > 0 ? "tool_calls" : "stop"
    const traceToolCalls = toolCalls
      .map((tc) => tc.call)
      .filter((c): c is { name: string; arguments: Record<string, unknown> } => Boolean(c))
    capabilities.emitTrace?.({
      type: "model_call_completed",
      agentId: agentContext.agent.id,
      debugLabel: options.debugLabel,
      ok: true,
      data: {
        messageCount: mergedMessages.length,
        outputLength: response.length,
        hasToolCalls: toolCalls.length > 0,
        toolCallCount: toolCalls.length,
        round,
        finishReason,
        ...(traceToolCalls.length > 0
          ? { toolCalls: traceToolCallsSummary(traceToolCalls) }
          : {}),
      },
    })

    // 活动信号:每轮结束更新 lastActivityAt(无响应超时重置)
    if (toolOptions?.lastActivityAt !== undefined) {
      toolOptions.lastActivityAt = Date.now()
    }

    // C1: text 模式补发 onRoundEnd(对称 native 循环 index.ts:1666).
    // round 结束通知 UI 这一轮的 finishReason,让它构建 timeline round 边界.
    options.onRoundEnd?.(agentContext.agent.id, round, finishReason)

    if (toolCalls.length === 0) {
      // stop 轮:剥离 tool-call blocks + think blocks 得到干净正文.
      // B3: stripThinkBlocks 剥离  三种常见原生思考标签,
      // 防止思考内容喂回模型污染上下文(与渲染层无关,这是平台硬需求).
      const cleanContent = stripThinkBlocks(stripRuntimeWorkspaceToolCallBlocks(response)).trim()
      // B3: 从 response 提取 think 块内容 → thought processNode(与 native 同构).
      // native 模式 thought 来自 reasoning stream;text 模式从正文标签提取.
      const thinkBlocks = extractThinkBlocks(response)
      if (thinkBlocks.length > 0) {
        const combinedThink = thinkBlocks.join("\n\n")
        collectedTimelineItems.push({ kind: "thought", id: `thought-r${round}`, round, text: combinedThink, collapsed: true })
      }
      return { text: cleanContent, ...(collectedToolCalls.length > 0 ? { collectedToolCalls } : {}), ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
    }

    // 采集 interim processNode:tool_calls 轮的过渡文本(剥离 tool-call + think blocks 后的正文).
    const interimText = stripThinkBlocks(stripRuntimeWorkspaceToolCallBlocks(response)).trim()
    if (interimText) {
      collectedTimelineItems.push({ kind: "interim", id: `interim-r${round}`, round, text: interimText, collapsed: false })
    }
    // B3: tool_calls 轮也提取 think 块 → thought processNode.
    const thinkBlocksToolRound = extractThinkBlocks(response)
    if (thinkBlocksToolRound.length > 0) {
      const combinedThink = thinkBlocksToolRound.join("\n\n")
      collectedTimelineItems.push({ kind: "thought", id: `thought-r${round}`, round, text: combinedThink, collapsed: true })
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
          )
        : undefined,
      runBrowserScript: capabilities.runBrowserScript,
      runTestSkillScript: capabilities.runTestSkillScript,
      runInspectFrontend: capabilities.runInspectFrontend,
      actionExecutorPolicy: capabilities.actionExecutorPolicy,
      workspaceMutations: capabilities.workspaceMutations,
      exposedWorkspaceOperations: permissions.exposedWorkspaceOperations,
      semanticSearchOwnerId: capabilities.semanticSearchOwnerId,
      signal: options.signal,
      debugLabel: options.debugLabel,
      emitTrace: capabilities.emitTrace,
      // 采集 tool processNode + 透传 UI onTool(text 模式工具过程显示 + processNode 持久化).
      // entry 和 delegated 路径共用此绑定(C2 验证:无条件绑定,不区分 entry/delegated).
      onTool: (callId, name, status, output) => {
        if (options.onTool) {
          options.onTool(agentContext.agent.id, round, callId, name, status, output)
        }
        // 采集 tool processNode(按 callId 去重) + 透传 UI onTool(text 模式工具过程显示 + 持久化).
        // entry 和 delegated 路径共用此绑定(C2 验证:无条件绑定,不区分 entry/delegated).
        const existing = collectedTimelineItems.find(
          (n): n is TurnTimelineItem & { kind: "tool" } => n.kind === "tool" && n.id === callId,
        )
        if (existing) {
          existing.status = status
          if (output !== undefined) existing.output = output
        } else {
          collectedTimelineItems.push({
            kind: "tool",
            id: callId,
            round,
            name,
            status,
            collapsed: true,
            ...(output !== undefined ? { output } : {}),
          })
        }
      },
      onAskUser: options.onAskUser,
    }, toolCalls)
    nextMessages = [
      ...nextMessages,
      {
        role: "assistant",
        // B3: 喂回模型的是剥离后的干净正文(去掉 think blocks + tool-call blocks).
        // 原始 response 含思考标签和工具调用块,会污染上下文窗口.工具调用块已
        // 被 parseRuntimeWorkspaceToolCalls 解析执行,思考内容已采集为 thought
        // processNode,正文是模型真正需要记住的部分.
        content: stripThinkBlocks(stripRuntimeWorkspaceToolCallBlocks(response)).trim(),
      },
      // workspace_read 图片结果:image ContentPart 追加到 user 消息(text observation + image parts).
      // 无 image 时保持纯 string content(text-protocol 兼容).
      (() => {
        const imageParts = observations.flatMap((obs) => obs.imageParts ?? [])
        const textContent = formatRuntimeWorkspaceToolObservationMessage(observations)
        if (imageParts.length === 0) {
          return { role: "user" as const, content: textContent }
        }
        return {
          role: "user" as const,
          content: [{ type: "text" as const, text: textContent }, ...imageParts] as ContentPart[],
        }
      })(),
    ]
    // 采集本轮工具调用(供 contextUpdate 跨 turn 保留).observation 取 text 文本化结果.
    // toolCalls 是 ParsedRuntimeToolCall[],observations 按 index 与完整 calls 数组对齐
    // (executeRuntimeWorkspaceToolCalls 保证每条 call 都有对应 observation,含解析失败的).
    // 取 .call 非空的(解析失败的 p.call 为 undefined,跳过但保持 index 对齐).
    const callsWithIndex = toolCalls
      .map((p, i) => ({ call: p.call, i }))
      .filter((c): c is { call: NonNullable<typeof c.call>; i: number } => c.call !== undefined)
    if (callsWithIndex.length > 0) {
      // 用原始 index 从 observations 取对应 observation(防过滤后 index 偏移错位).
      const alignedToolCalls: { id?: string; name: string; arguments: Record<string, unknown> }[] = []
      const alignedObservations: RuntimeWorkspaceToolObservation[] = []
      for (const { call, i } of callsWithIndex) {
        const obs = observations[i]
        if (obs) {
          alignedToolCalls.push(call)
          alignedObservations.push(obs)
        }
      }
      collectedToolCalls.push(...collectToolCallsForContext(
        alignedToolCalls,
        alignedObservations,
        formatRawToolObservationForContext,
      ))
      collectedToolMemories.push(...collectToolMemoriesForContext(
        alignedToolCalls,
        alignedObservations,
        currentRuntimeTurnNumber(input),
        round,
      ))
    }
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

  const entryContext = getEntryAgentContext(input)
  const entryStepStartedAt = Date.now()
  capabilities.emitTrace?.({
    type: "agent_step_started",
    ...traceAgentBase(entryContext, "entry-agent"),
    data: { agentTitle: entryContext.agent.title, startedAt: entryStepStartedAt },
  })

  // master agent 会话上下文:优先用注入的 context.json 快照;未注入则从
  // recentHistory(turn 文件重建)兜底初始化(design §3.1 首 turn/旧存档迁移).
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
  const triggerThreshold = budget * (entryCompressionMode === "task" ? getTaskContextCompressTriggerRatio() : getNarrativeContextCompressTriggerRatio())
  const contextBeforeTokens = estimateContextTokens(agentContext)
  if (contextBeforeTokens > triggerThreshold) {
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
      const afterTokens = estimateContextTokens(agentContext)
      capabilities.emitTrace?.({
        type: "context_compressed",
        ...traceAgentBase(entryContext, "entry-agent"),
        ok: true,
        data: {
          budget,
          triggerThreshold,
          mode: entryCompressionMode,
          beforeTokens: contextBeforeTokens,
          afterTokens,
          ratio: contextBeforeTokens > 0 ? afterTokens / contextBeforeTokens : 0,
        },
      })
    } catch (error) {
      capabilities.emitTrace?.({
        type: "context_compression_failed",
        ...traceAgentBase(entryContext, "entry-agent"),
        ok: false,
        data: {
          ...errorToTraceDataWithStack(error),
          beforeTokens: contextBeforeTokens,
        },
      })
      throw error
    }
  }

  let replyText: string
  let turnUsage: { input?: number; output?: number; total?: number } | undefined
  // 跨 turn 保留:原始工具调用(UI/debug)、model 工具记忆投影 + 过程节点从 loopResult 带回.
  let collectedToolCalls: AgentContextToolCall[] | undefined
  let collectedToolMemories: AgentContextToolMemory[] | undefined
  let collectedTimelineItems: TurnTimelineItem[] | undefined
  // turn 内压剧情就地把压缩结果写进 agentContext(对象引用),循环结束后
  // 用它覆盖 compressedContext 透传给 host 落盘(design §3.5).标记位区分
  // "turn 开头压过" 与 "turn 内又压过",取最后一次压缩快照.
  let compressedInTurn = false
  const agentContextSnapshotForLoop = agentContext
  try {
    const loopResult = await callAgentModelWithWorkspaceTools(
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
        onAskUser: input.onAskUser,
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
              lastActivityAt: Date.now(),
              inactivityTimeoutMs: input.timeoutMs ?? DEFAULT_TASK_INACTIVITY_TIMEOUT_MS,
            }
          : {}),
      },
    )
    replyText = loopResult.text.trim()
    turnUsage = loopResult.usage
    // 跨 turn 保留:原始工具调用(UI/debug)、model 工具记忆投影 + 过程节点从 loopResult 带回.
    collectedToolCalls = loopResult.collectedToolCalls
    collectedToolMemories = loopResult.collectedToolMemories
    collectedTimelineItems = loopResult.collectedTimelineItems
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
      data: { outputLength: replyText.length, durationMs: Date.now() - entryStepStartedAt },
    })
  } catch (error) {
    capabilities.emitTrace?.({
      type: "agent_step_failed",
      ...traceAgentBase(entryContext, "entry-agent"),
      ok: false,
      data: errorToTraceDataWithStack(error),
    })
    throw error
  }

  return {
    replyText,
    contextUpdate: {
      turn: currentRuntimeTurnNumber(input),
      user: input.userInput,
      assistant: replyText,
      compressedContext: compressedInTurn ? agentContextSnapshotForLoop! : compressedContext,
      // 原始工具调用只供 UI/debug 会话消息完整保留；model context 使用 toolMemories 投影.
      ...(collectedToolCalls && collectedToolCalls.length > 0 ? { toolCalls: collectedToolCalls } : {}),
      ...(collectedToolMemories && collectedToolMemories.length > 0 ? { toolMemories: collectedToolMemories } : {}),
      // 过程节点 timeline items(thought/tool/interim)供 host 写入会话消息存储 timeline,UI 重建 timeline.
      ...(collectedTimelineItems && collectedTimelineItems.length > 0 ? { timelineItems: collectedTimelineItems } : {}),
    },
    ...(turnUsage ? { usage: turnUsage } : {}),
  }
}
