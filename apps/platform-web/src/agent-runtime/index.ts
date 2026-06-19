import type {
  AgentRegistryEntry,
  AgentContextEntry,
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
   * Streaming text-delta sink for the entry agent. Invoked for every streamed
   * text chunk across all tool-loop rounds (thought-round text included — the
   * whole turn streams, no reset). `round` is the tool-loop round index so the
   * caller can label thought vs final. Delegated `agent_call` targets do not
   * receive `onDelta` (they stream silently via the non-SSE fallback).
   */
  onDelta?: (delta: string, round: number) => void
  /**
   * Per-round end notification (子2b R1). Invoked after each `callModelNative`
   * returns, with the round index and finish reason so the caller can classify
   * the round as thought (`tool_calls`) or final (`stop`) and label the streamed
   * text accordingly. Delegated agents do not receive this (silent). `undefined`
   * disables round-end events.
   */
  onRoundEnd?: (round: number, finishReason: "stop" | "tool_calls") => void
  /**
   * Tool-call status/output notification (子2b R2). Invoked before/after each
   * workspace tool executes, with the round index and tool identity so the
   * caller can render the tool process. `undefined` disables tool events.
   */
  onTool?: (
    round: number,
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: string,
  ) => void
}

export interface AgentRuntimeTurnResult {
  replyText: string
  agentSessionTranscripts: AgentSessionTranscriptRecord[]
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
  onDelta?: (delta: string, round: number) => void
  /** Current tool-loop round index (set by the native loop before each call). */
  round?: number
  /** Per-round end notification (子2b R1); threaded from `AgentRuntimeTurnInput.onRoundEnd`. */
  onRoundEnd?: (round: number, finishReason: "stop" | "tool_calls") => void
  /** Tool-call status/output notification (子2b R2); threaded from `AgentRuntimeTurnInput.onTool`. */
  onTool?: (
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
  maxCallsPerTurn: number
  maxDepth: number
  historyWindows: Record<RuntimeAgentCallHistoryMode, number>
  maxToolRoundsPerAgent: number
}

export type AgentRuntimeCollaborationPolicyInput =
  Partial<Omit<AgentRuntimeCollaborationPolicy, "historyWindows">>
  & {
    historyWindows?: Partial<Record<RuntimeAgentCallHistoryMode, number>>
  }

const ENTRY_AGENT_PLATFORM_GUARD = [
  "你是当前回合的入口 Agent。",
  "你会收到自己的 AGENT.md、可选 SOUL.md、工作区上下文、最近对话和玩家本轮输入。",
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
  maxCallsPerTurn: 4,
  maxDepth: 2,
  historyWindows: {
    minimal: 0,
    recent: 6,
    scene: 12,
  },
  maxToolRoundsPerAgent: 3,
}

interface AgentCallTurnState {
  callCount: number
}

interface WorkspaceToolLoopOptions {
  agentCallState: AgentCallTurnState
  agentCallDepth: number
  collaborationPolicy: AgentRuntimeCollaborationPolicy
}

interface AgentCallRuntimeMetadata {
  callerAgentId: string
  targetAgentId: string
  callerDepth: number
  targetDepth: number
  maxDepth: number
  callCount: number
  maxCallsPerTurn: number
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
    maxCallsPerTurn: normalizePolicyInteger(input?.maxCallsPerTurn, defaults.maxCallsPerTurn),
    maxDepth: normalizePolicyInteger(input?.maxDepth, defaults.maxDepth),
    historyWindows: {
      minimal: normalizePolicyInteger(input?.historyWindows?.minimal, defaults.historyWindows.minimal),
      recent: normalizePolicyInteger(input?.historyWindows?.recent, defaults.historyWindows.recent),
      scene: normalizePolicyInteger(input?.historyWindows?.scene, defaults.historyWindows.scene),
    },
    maxToolRoundsPerAgent: normalizePolicyInteger(
      input?.maxToolRoundsPerAgent,
      defaults.maxToolRoundsPerAgent,
    ),
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
    && state.callCount < policy.maxCallsPerTurn
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
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad} arguments={"name":"prose-style"}`,
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.actionCall} arguments={"skill":"prose-style","action":"example_action","input":{"text":"示例"}}`,
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
    `如果需要加载 Skill 详情，使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad}，并传入可见 Skill Index 中的 name。`,
    ...(canReadWorkspace
      ? [
          `不要用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead} 读取 Skill 入口文件；使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad}。`,
          `加载后的 SKILL.md 会说明什么时候读取哪些 references、examples、schemas、scripts 或其它工作区文件。只有执行到这些引用步骤时，才使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch} 读取具体资源。读操作需要显式传入 scope，通常使用 "effective"。`,
        ]
      : []),
    `只有成功加载某个 Skill 后，才能使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.actionCall} 调用该 Skill 声明的 action。当前支持内置 executor、平台允许的 platform_action executor、workspace_operation executor，以及受信任第三方 Skill 可声明的 browser_script executor。`,
    ...(canWriteWorkspace
      ? [
          "workspace_operation 和 browser_script 可能写入 Runtime Workspace，只在已加载 Skill 明确要求维护状态、地图、记忆、线索或前端约定数据时使用。",
        ]
      : []),
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
          `{"name":"${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad}","arguments":{"name":"prose-style"}}`,
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
): AiChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  const visibleContacts = input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, context)
    : []
  const permissions = deriveAgentRuntimePermissionProfile(context.agent)
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
    {
      role: "user",
      content: [
        `当前回合：${currentRuntimeTurnNumber(input)}`,
        "Workspace Agent 上下文：",
        formatAgentRuntimeContext(context),
        "",
        "最近对话：",
        formatHistory(history),
        "",
        "玩家本轮输入：",
        input.userInput,
      ].join("\n"),
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
    maxCallsPerTurn: collaborationPolicy.maxCallsPerTurn,
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
    maxCallsPerTurn: metadata.maxCallsPerTurn,
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
        "目标 Agent 上下文：",
        formatAgentRuntimeContext(targetContext),
        "",
        "调用方 Agent：",
        `${callerContext.agent.id} — ${callerContext.agent.title}`,
        callerContext.agent.summary || "（无摘要）",
        "",
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
        ...(agentCall.contextSummary
          ? [
              "调用方提供的上下文摘要：",
              agentCall.contextSummary,
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
        "最近对话窗口：",
        formatHistory(history),
        "",
        "玩家本轮输入：",
        input.userInput,
        "",
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

    if (state.callCount >= collaborationPolicy.maxCallsPerTurn) {
      throw agentCallError(
        "AGENT_CALL_LIMIT_EXCEEDED",
        "agent_call limit exceeded for this turn.",
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
          signal: input.signal,
          agentId: targetContext.agent.id,
        },
        targetContext,
        {
          agentCallState: state,
          agentCallDepth: metadata.targetDepth,
          collaborationPolicy,
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
      capabilities.emitTrace?.({
        type: "agent_step_failed",
        ...traceAgentBase(targetContext, debugLabel),
        ok: false,
        data: {
          ...errorToTraceData(error),
          ...agentCallTraceFacts(failedMetadata),
          delegated: true,
        },
      })
      throw agentCallError(
        "AGENT_CALL_FAILED",
        `agent_call failed for Agent "${targetContext.agent.id}".`,
        {
          ...failedMetadata,
          cause: errorToTraceData(error),
        },
      )
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
  const runtimeMessages = aiChatMessagesToRuntime(messages)
  const workspaceToolSession = createRuntimeWorkspaceToolSessionState()
  const permissions = deriveAgentRuntimePermissionProfile(agentContext.agent)
  const maxToolRounds = toolOptions.collaborationPolicy.maxToolRoundsPerAgent
    ?? DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY.maxToolRoundsPerAgent
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

  for (let round = 0; round <= maxToolRounds; round += 1) {
    assertNotAborted(options.signal)

    const callOptions: AgentRuntimeModelCallOptions = {
      ...options,
      round,
    }
    const result = await capabilities.callModelNative!(runtimeMessages, callOptions, tools)
    assertNotAborted(options.signal)

    // Notify the caller that this round ended, with the finish reason so it can
    // classify the streamed text as thought (tool_calls) or final (stop). Emitted
    // for every round including the final stop round.
    options.onRoundEnd?.(round, result.finishReason)

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

    if (round >= maxToolRounds) {
      const finalText = result.text.trim()
      if (finalText) {
        recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
          messages,
          modelOutput: result.raw,
          toolCalls,
          toolObservations: [],
          round,
          status: "completed",
        })
        return finalText
      }
      throw new Error(
        `${options.debugLabel} reached the workspace tool round limit without a final response.`,
      )
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
      // Tool process events (子2b R2): bind the current round here so the
      // executor's onTool stays callId/name/status only; the caller binds turn.
      onTool: options.onTool
        ? (callId, name, status, output) => options.onTool!(round, callId, name, status, output)
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
  const maxToolRounds = toolOptions?.collaborationPolicy.maxToolRoundsPerAgent
    ?? DEFAULT_AGENT_RUNTIME_COLLABORATION_POLICY.maxToolRoundsPerAgent
  for (let round = 0; round <= maxToolRounds; round += 1) {
    assertNotAborted(options.signal)

    const response = await capabilities.callModel(nextMessages, options)
    assertNotAborted(options.signal)

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

    if (round >= maxToolRounds) {
      const finalText = stripRuntimeWorkspaceToolCallBlocks(response).trim()
      if (finalText) {
        recordAgentSessionTranscript(transcriptCollector, input, agentContext, options, {
          messages: nextMessages,
          modelOutput: response,
          toolCalls,
          toolObservations: [],
          round,
          status: "completed",
        })
        return finalText
      }

      throw new Error(
        `${options.debugLabel} reached the workspace tool round limit without a final response.`,
      )
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

  let replyText: string
  try {
    replyText = (await callAgentModelWithWorkspaceTools(
      buildEntryAgentMessages(
        input,
        entryContext,
        collaborationPolicy,
        agentCallState,
        capabilities.toolCallMode,
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
      },
      transcriptCollector,
    )).trim()
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
  }
}

