import type {
  AgentRegistryEntry,
  AgentContextEntry,
  AgentContextSnapshot,
  AgentContextToolMemory,
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
  UiToolPresentation,
  WorkspaceFile,
  WorkspaceOperationName,
} from "@tsian/contracts"
import { assembleAgentContext } from "./context"
import {
  workspaceFileFilterForAgentBoundary,
  workspaceFilesForAgentBoundary,
  type AgentWorkspaceTrustBoundary,
} from "./frontend-action-isolation"
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
  estimateTokenCount,
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
} from "./workspace-tools"
import {
  assignTextToolCallIds,
  formatTextToolExecutionReport,
  formatTextToolManifest,
  formatTextToolProtocolError,
  parseTextToolProtocolResponse,
  stripTextProtocolArtifacts,
  TEXT_TOOL_CALL_TEMPLATE,
  TEXT_TOOL_CALLS_CLOSE_TAG,
  TEXT_TOOL_CALLS_OPEN_TAG,
  TEXT_TOOL_EXECUTED_TOOLS_TAG,
  TEXT_TOOL_OBSERVATIONS_TAG,
  TEXT_TOOL_PROTOCOL_MAX_RETRIES,
} from "./text-tool-protocol"
import type {
  ModelCallResult,
  NativeToolCall,
  RuntimeChatMessage,
} from "../runtime-host/ai"
import { forkAiTraceOperationContext } from "../runtime-host/ai/trace-context"
import type { BrowserAiToolCallMode } from "../config/ai"
import {
  collectToolMemoriesForContext,
  renderToolMemoriesForModel,
} from "./tool-memory"
import type { WorkspaceOperationMutationAdapter } from "./workspace-operations"
import {
  buildAgentContextMessages,
  locateHistorySpan,
  locateTaskInteractionSpan,
  replaceHistorySpan,
} from "./orchestration/history"
import {
  mergeConsecutiveRoleMessages,
  stripInternalMarkers,
} from "./orchestration/message-formatting"
import {
  PLAYER_INPUT_TAG,
  TOOL_MEMORY_TAG,
  TURN_RUNTIME_TAG,
  buildPreludeMessages,
  buildRuntimeMessages,
  contextInjectionsToMessages,
} from "./orchestration/context-injections"
import { deriveDelegatedWorkspaceMutations } from "./environment"

// barrel re-export (public API — 8 types)
export type {
  AgentRuntimeTurnInput,
  AgentRuntimeTurnContextUpdate,
  AgentRuntimeTurnResult,
  AgentRuntimeModelCallOptions,
  AgentRuntimeCapabilities,
  AgentRuntimeEnvironment,
  AgentRuntimeEventSink,
  AgentRuntimeCollaborationPolicy,
  AgentRuntimeCollaborationPolicyInput,
  RuntimeCompressionMode,
} from "./turn-types"
export type { AgentWorkspaceTrustBoundary } from "./frontend-action-isolation"
// import for internal use (local binding)
import type {
  AgentRuntimeTurnInput,
  AgentRuntimeTurnContextUpdate,
  AgentRuntimeTurnResult,
  AgentRuntimeModelCallOptions,
  AgentRuntimeCapabilities,
  AgentRuntimeEnvironment,
  AgentRuntimeCollaborationPolicy,
  AgentRuntimeCollaborationPolicyInput,
  RuntimeCompressionMode,
} from "./turn-types"
export {
  createDesktopAssistantEnvironment,
  createGameRuntimeEnvironment,
  deriveDelegatedEnvironment,
} from "./environment"
/** 解析 entry 路径压缩模式:未传默认 narrative(master 路径). */
function resolveEntryCompressionMode(input: AgentRuntimeTurnInput): RuntimeCompressionMode {
  return input.compressionMode ?? "narrative"
}

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
 * - `task`: 子代理/助手任务型,按协议边界压完整工具交互轮,多次压缩
 *   不限次 + 时长兜底(TaskTimeoutError) + 压缩无效早退(TaskCompressionStalledError).
 */

interface WorkspaceToolLoopOptions {
  agentCallState: AgentCallTurnState
  agentCallDepth: number
  collaborationPolicy: AgentRuntimeCollaborationPolicy
  /**
   * Workspace visibility for this Agent step. The trusted desktop entry may
   * author all card content; delegated steps always use runtime-game-agent.
   */
  workspaceTrustBoundary: AgentWorkspaceTrustBoundary
  /** 压缩模式:narrative=master 剧情压缩;task=子代理/助手任务压缩.决定压缩块分流. */
  compressionMode: RuntimeCompressionMode
  /**
   * narrative 模式:master 会话上下文快照(turn 开头压缩后已是更新值).turn 内压剧情就
   * 地更新它(Object.assign),循环结束后透传回 runAgentRuntimeTurn 落盘.
   * task 模式不用(任务型 agent 无跨 turn 快照).
   * 未传(narrative 兜底路径)→ 工具循环不做 turn 内压剧情,但仍做预算兜底.
   */
  agentContextSnapshot?: AgentContextSnapshot
  contextSequence: number
  /** token 预算(turn 开头已 resolve).达 85% 触发压缩/兜底.两模式共用. */
  contextTokenBudget?: number
  requestInputBudgetTokens?: number
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

function currentRuntimeTurnNumber(input: AgentRuntimeTurnInput): number {
  return input.turn + 1
}

function getVisibleAgentContacts(
  workspaceFiles: WorkspaceFile[],
  context: AgentContextEntry,
  workspaceTrustBoundary: AgentWorkspaceTrustBoundary = "runtime-game-agent",
): AgentRegistryEntry[] {
  const agentsById = new Map(
    buildAgentRegistry(workspaceFilesForAgentBoundary(
      workspaceFiles,
      workspaceTrustBoundary,
    )).map((agent) => [agent.id, agent]),
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

function intersectExposedWorkspaceOperations(
  agentOperations: WorkspaceOperationName[],
  environmentOperations: Iterable<WorkspaceOperationName> | undefined,
): WorkspaceOperationName[] {
  if (!environmentOperations) return agentOperations
  const allowed = new Set(environmentOperations)
  return agentOperations.filter((operation) => allowed.has(operation))
}

function buildEnabledRuntimeToolSchemas(options: {
  agentContext: AgentContextEntry
  enabledPlatformTools: AgentPlatformToolName[]
  allowAgentCall: boolean
  visibleContacts: AgentRegistryEntry[]
  inspectFrontendAvailable?: boolean
  testSkillScriptAvailable?: boolean
  queryDiagnosticsAvailable?: boolean
}): ToolSchema[] {
  return buildEnabledToolSchemas({
    enabledPlatformTools: options.enabledPlatformTools,
    allowAgentCall: options.allowAgentCall,
    visibleContacts: options.visibleContacts,
    inspectFrontendAvailable: options.inspectFrontendAvailable,
    testSkillScriptAvailable: options.testSkillScriptAvailable,
    queryDiagnosticsAvailable: options.queryDiagnosticsAvailable,
    // User Tools already filtered for this Agent by `filterToolsForAgent`
    // during context assembly (context.ts). Expose the same filtered list in
    // both native schema mode and Text Tool Protocol manifest mode.
    userTools: options.agentContext.toolIndex,
  })
}

function buildWorkspaceToolInstructions(
  options: {
    allowAgentCall: boolean
    visibleContacts: AgentRegistryEntry[]
    enabledPlatformTools: AgentPlatformToolName[]
    toolCallMode?: BrowserAiToolCallMode
    inspectFrontendAvailable?: boolean
    testSkillScriptAvailable?: boolean
    queryDiagnosticsAvailable?: boolean
    tools: ToolSchema[]
  },
): string {
  const isNative = options.toolCallMode === "native"
  const toolNames = options.tools.map((tool) => tool.name)

  const sharedRules = [
    "只在需要更多信息、需要执行操作、需要确认事实，或任务明确要求时调用工具。",
    "只能调用当前可用工具清单中的工具。",
  ]

  if (isNative) {
    return [
      ...sharedRules,
      `当前可用工具名称：${toolNames.join(", ")}。具体参数以 API tools schema 为准，不要在正文中手写工具调用块。`,
      "多个相互独立、无写冲突的工具可以在同一轮并行调用。并行返回混合结果时，只重发失败的那一个，不要全量重发。",
      "收到 observation 后继续完成任务；最终输出只包含给玩家/调用方的正文，不包含工具细节。",
    ].join("\n")
  }

  return [
    ...sharedRules,
    "当前工具调用方式：在回复中写工具调用块。",
    `需要调用工具时，本轮只输出一个以 ${TEXT_TOOL_CALLS_OPEN_TAG} 开始、以 ${TEXT_TOOL_CALLS_CLOSE_TAG} 结束的完整 JSON 数组块。`,
    "规则：",
    "- JSON 必须是数组；单个工具也写成一元素数组；数组不能为空。",
    `- 开始和结束标签必须成对出现；必须显式输出 ${TEXT_TOOL_CALLS_CLOSE_TAG}，消息结束不能代替闭合标签。`,
    "- 一轮最多一个工具调用块；不要使用 Markdown 代码块；不要在 JSON 中写注释。",
    "- 工具名必须来自当前可用工具清单，arguments 必须符合对应说明。",
    `runtime user 消息中的 <${TEXT_TOOL_EXECUTED_TOOLS_TAG}> 和 <${TEXT_TOOL_OBSERVATIONS_TAG}> 是已经完成的调用及结果。需要新调用时只使用 ${TEXT_TOOL_CALLS_OPEN_TAG}...${TEXT_TOOL_CALLS_CLOSE_TAG} 完整块。`,
    "当前可用工具清单：",
    formatTextToolManifest(options.tools),
    "收到工具结果后：",
    `- 阅读 runtime user 执行报告中的 <${TEXT_TOOL_OBSERVATIONS_TAG}> 结果。`,
    `- 还需要工具时，再输出 ${TEXT_TOOL_CALLS_OPEN_TAG}...${TEXT_TOOL_CALLS_CLOSE_TAG} 完整块。`,
    "- 信息足够时，直接输出最终结果。",
    `- 最终结果不要包含 ${TEXT_TOOL_CALLS_OPEN_TAG}...${TEXT_TOOL_CALLS_CLOSE_TAG}、任何其他协议标签、工具 JSON、工具结果原文或实现说明。`,
    "正确示例（把工具名和参数替换为当前可用工具清单中的实际值）：",
    TEXT_TOOL_CALL_TEMPLATE,
  ].join("\n")
}

function buildWorkspaceAgentSystemPrompt(
  context: AgentContextEntry,
  options: {
    allowAgentCall: boolean
    visibleContacts: AgentRegistryEntry[]
    enabledPlatformTools: AgentPlatformToolName[]
    toolCallMode?: BrowserAiToolCallMode
    inspectFrontendAvailable?: boolean
    testSkillScriptAvailable?: boolean
    queryDiagnosticsAvailable?: boolean
  },
): string {
  const soulContent = context.soulFile?.content.trim()
  const tools = buildEnabledRuntimeToolSchemas({
    agentContext: context,
    enabledPlatformTools: options.enabledPlatformTools,
    allowAgentCall: options.allowAgentCall,
    visibleContacts: options.visibleContacts,
    inspectFrontendAvailable: options.inspectFrontendAvailable,
    testSkillScriptAvailable: options.testSkillScriptAvailable,
    queryDiagnosticsAvailable: options.queryDiagnosticsAvailable,
  })
  return [
    context.agentFile.content.trim(),
    ...(soulContent ? ["", soulContent] : []),
    "",
    "Runtime Workspace 工具说明：",
    buildWorkspaceToolInstructions({ ...options, tools }),
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
    workspaceTrustBoundary: input.workspaceTrustBoundary,
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
  compressionMode: RuntimeCompressionMode = "narrative",
  agentContext?: AgentContextSnapshot | null,
): RuntimeChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  const visibleContacts = input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, context, input.workspaceTrustBoundary)
    : []
  const permissions = deriveAgentRuntimePermissionProfile(context.agent)
  const isAssistant = isAssistantEntryAgent(context.agent.path)
  const turnLabel = isAssistant ? "当前问答轮次" : "当前回合"
  const inputLabel = isAssistant ? "用户本轮提问" : "玩家本轮输入"
  // 固定层 role 配置（messageLayers）。未配置的层保持默认 role。
  const ml = context.agent.messageLayers
  const historySummaryRole = ml.historySummary?.role ?? "user"
  const metaRole = ml.contextMeta?.role ?? "user"
  const toolMemoryRole = ml.toolMemory?.role ?? "user"
  const turnRuntimeRole = ml.turnRuntime?.role ?? "user"
  // 剧情正文层:优先用注入的 context 快照(独立 message 序列);未注入则从
  // recentHistory(turn 文件重建)兜底——旧逻辑 formatHistory 也是拍扁文本,这里
  // 保持兜底用文本形式(首 turn/旧存档迁移场景,非稳态路径).
  const historyMessages: RuntimeChatMessage[] = agentContext
    ? buildAgentContextMessages(agentContext, isAssistant, historySummaryRole)
    : [{ role: "user", content: `最近对话：\n${formatHistory(history)}` }]
  const toolMemoryLog = compressionMode === "task"
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
      content: buildWorkspaceAgentSystemPrompt(context, {
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
        inspectFrontendAvailable: input.controlledToolAvailability?.includes(
          AGENT_PLATFORM_TOOL_NAMES.inspectFrontend,
        ),
        testSkillScriptAvailable: input.controlledToolAvailability?.includes(
          AGENT_PLATFORM_TOOL_NAMES.testSkillScript,
        ),
        queryDiagnosticsAvailable: input.controlledToolAvailability?.includes(
          AGENT_PLATFORM_TOOL_NAMES.queryDiagnostics,
        ),
      }),
    },
    // prelude 段（背景层）：上下文元信息（Skill Index）+ prelude position 注入。
    // 放在 system 之后、history 之前——跨轮稳定内容命中前缀缓存。
    ...buildPreludeMessages(context, "Workspace Agent 上下文", metaRole),
    // history(已发生剧情,跨 turn 字节级不变)。prelude 在其之前命中缓存,
    // history 尾部每轮增长只 miss 最后一对。
    ...historyMessages,
    // runtime 段（状态层）：runtime position 注入（runtime.json、frontier.json 等）。
    // 放在 history 之后——每轮可能变化的状态文件，不指望前缀缓存命中。
    ...buildRuntimeMessages(context),
    // task-mode entry agent 的跨 turn 工具记忆作为普通工作日志放在 runtime 段后，
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
    // framing 段（框架层）：framing position 注入（思考模板、输出格式、续写引导）。
    // 放在玩家输入之后、消息序列末尾。PREFILL.md 兼容迁移在 context.ts 完成
    //（无 framing contextPath 时自动将 PREFILL.md 内容转为 framing 注入）。
    ...contextInjectionsToMessages(context.contextInjectionsByPosition.framing),
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
    ? getVisibleAgentContacts(input.workspaceFiles, targetContext, input.workspaceTrustBoundary)
    : []
  const permissions = deriveAgentRuntimePermissionProfile(targetContext.agent)
  // 固定层 role 配置（从目标 agent 的 messageLayers 读取）。
  const ml = targetContext.agent.messageLayers
  const metaRole = ml.contextMeta?.role ?? "user"
  const turnRuntimeRole = ml.turnRuntime?.role ?? "user"
  // contextInjectionsToMessages 产 RuntimeChatMessage[]，但注入消息只有
  // system/user/assistant + string content（无 tool role），安全降维为 AiChatMessage[]。
  const framingMessages = contextInjectionsToMessages(
    targetContext.contextInjectionsByPosition.framing,
  ) as AiChatMessage[]
  return [
    {
      role: "system",
      content: buildWorkspaceAgentSystemPrompt(targetContext, {
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
        inspectFrontendAvailable: false,
        testSkillScriptAvailable: false,
        queryDiagnosticsAvailable: false,
      }),
    },
    // prelude 段（背景层）：元信息 + prelude 注入。system 之后、调用方信息之前。
    ...(buildPreludeMessages(targetContext, "目标 Agent 上下文", metaRole) as AiChatMessage[]),
    {
      role: "user",
      content: [
        "调用方 Agent：",
        `${callerContext.agent.id} — ${callerContext.agent.title}`,
        callerContext.agent.summary || "（无摘要）",
      ].join("\n"),
    },
    { role: "user", content: `最近对话窗口：\n${formatHistory(history)}` },
    // runtime 段（状态层）：runtime 注入。history 之后、turn-runtime 之前。
    ...(buildRuntimeMessages(targetContext) as AiChatMessage[]),
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
    // framing 段（框架层）：framing 注入（思考模板、续写引导）。消息序列末尾。
    ...framingMessages,
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

    const delegatedVisibleFiles = workspaceFilesForAgentBoundary(
      input.workspaceFiles,
      "runtime-game-agent",
    )
    const delegatedInput: AgentRuntimeTurnInput = {
      ...input,
      traceContext: forkAiTraceOperationContext(input.traceContext),
      // The Tool loop must retain the root turn's live staged array. Registry
      // and context discovery use delegatedVisibleFiles / trust-boundary
      // assembly below; workspace operations apply the boundary fileFilter.
      workspaceFiles: input.workspaceFiles,
      workspaceTrustBoundary: "runtime-game-agent",
    }
    const registry = buildAgentRegistry(delegatedVisibleFiles)
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

    const targetContext = assembleAgentContext(delegatedInput.workspaceFiles!, {
      agentId: targetAgent.id,
      workspaceTrustBoundary: "runtime-game-agent",
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
    const delegatedCapabilities: AgentRuntimeCapabilities = {
      ...capabilities,
      runInspectFrontend: undefined,
      runQueryDiagnostics: undefined,
      runTestSkillScript: undefined,
      workspaceMutations: deriveDelegatedWorkspaceMutations(capabilities.workspaceMutations),
    }

    try {
      const response = (await callAgentModelWithWorkspaceTools(
        // delegated agent 无跨 turn 工具调用历史(无 AgentContextSnapshot),
        // buildDelegatedAgentMessages 产 AiChatMessage[](无 role:tool),安全升维为 RuntimeChatMessage[].
        buildDelegatedAgentMessages(
          delegatedInput,
          callerContext,          targetContext,
          agentCall,
          collaborationPolicy,
          state,
          metadata.targetDepth,
          capabilities.toolCallMode,
        ) as RuntimeChatMessage[],
        delegatedInput,
        delegatedCapabilities,
        {
          debugLabel,
          signal: compositeSignal,
          agentId: targetContext.agent.id,
          traceContext: delegatedInput.traceContext,
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
          workspaceTrustBoundary: "runtime-game-agent",
          compressionMode: "task",
          // delegated 预算:runtime 层不知目标 agent 的 contextWindow,用 256k 默认
          // (host 层 callModelNative 闭包按 options.agentId resolve 真实 config,
          //  但预算是 runtime 估算用,256k 的 85% 足够大,不影响压缩触发判断).
          contextTokenBudget: resolveTokenBudget(undefined),
          requestInputBudgetTokens: input.requestInputBudgetTokens,
          compressCallModel: capabilities.callModel,
          contextSequence: 1,
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

async function callAgentModelWithWorkspaceToolsNative(
  messages: RuntimeChatMessage[],
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  options: AgentRuntimeModelCallOptions,
  agentContext: AgentContextEntry,
  toolOptions: WorkspaceToolLoopOptions,
): Promise<{ text: string; usage?: { input?: number; output?: number; total?: number }; collectedToolMemories?: AgentContextToolMemory[]; collectedTimelineItems?: TurnTimelineItem[] }> {
  // messages 已是 RuntimeChatMessage[](buildEntryAgentMessages 产结构化,native 无需转换).
  let runtimeMessages = messages
  const collectedToolMemories: AgentContextToolMemory[] = []
  const collectedTimelineItems: TurnTimelineItem[] = []
  // 每轮 reasoning/content 文本累积器(供采集 thought/interim processNode).
  let roundReasoning = ""
  let roundContent = ""
  const workspaceToolSession = createRuntimeWorkspaceToolSessionState()
  const permissions = deriveAgentRuntimePermissionProfile(agentContext.agent)
  const visibleContacts = input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, agentContext, input.workspaceTrustBoundary)
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
  const tools = buildEnabledRuntimeToolSchemas({
    agentContext,
    enabledPlatformTools: permissions.enabledTools,
    allowAgentCall,
    visibleContacts,
    inspectFrontendAvailable: capabilities.runInspectFrontend !== undefined,
    testSkillScriptAvailable: capabilities.runTestSkillScript !== undefined,
    queryDiagnosticsAvailable: capabilities.runQueryDiagnostics !== undefined,
  })

  // turn 内 token 预算 + 压缩(tool-token-budget R2 + 06-20-agent-task-compression).
  // 循环不再有轮次上限,靠 stop / abort / 预算兜底(narrative)或时长兜底(task)终止.
  // 按 compressionMode 分流:
  // - narrative(master):压剧情(summary+recentTurns),一次压缩 + 第二次达预算抛
  //   ContextBudgetExhaustedError.仅 entry 稳态路径(注入了 context 快照)做压剧情;
  //   兜底路径无快照,只走预算兜底.
  // - task(子代理/助手):按协议边界压完整工具交互轮,多次压缩
  //   不限次 + 时长兜底(TaskTimeoutError) + 压缩无效早退(TaskCompressionStalledError).
  const historySpan = locateHistorySpan(runtimeMessages)
  const canCompressNarrative =
    toolOptions.compressionMode === "narrative"
    && historySpan.start >= 0
    && toolOptions.agentContextSnapshot !== undefined
    && toolOptions.contextTokenBudget !== undefined
    && toolOptions.compressCallModel !== undefined
  const isTaskMode = toolOptions.compressionMode === "task"
  const schemaTokens = estimateTokenCount(JSON.stringify(tools))
  const capacityThreshold = toolOptions.contextTokenBudget !== undefined
    ? toolOptions.contextTokenBudget * (isTaskMode ? getTaskContextCompressTriggerRatio() : getNarrativeContextCompressTriggerRatio())
    : Number.POSITIVE_INFINITY
  const consumptionThreshold = toolOptions.requestInputBudgetTokens !== undefined
    ? Math.max(1, toolOptions.requestInputBudgetTokens - schemaTokens)
    : Number.POSITIVE_INFINITY
  const triggerThreshold = Math.min(capacityThreshold, consumptionThreshold)
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
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
            traceContext: options.traceContext,
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
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
            traceContext: options.traceContext,
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
    const finalInputTokens = estimateRuntimeMessagesTokens(mergedMessages) + schemaTokens
    capabilities.emitTrace?.({
      type: "request_preflight",
      agentId: agentContext.agent.id,
      debugLabel: options.debugLabel,
      ok: toolOptions.requestInputBudgetTokens === undefined
        || finalInputTokens <= toolOptions.requestInputBudgetTokens,
      data: {
        round,
        estimatedInputTokens: finalInputTokens,
        requestInputBudgetTokens: toolOptions.requestInputBudgetTokens,
        schemaTokens,
      },
    })
    if (
      toolOptions.requestInputBudgetTokens !== undefined
      && finalInputTokens > toolOptions.requestInputBudgetTokens
    ) {
      throw new ContextBudgetExhaustedError()
    }
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
        estimatedInputTokens: finalInputTokens,
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

    if (result.toolCalls.length === 0) {
      return { text: result.text.trim(), usage: lastRoundUsage, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
      runQueryDiagnostics: capabilities.runQueryDiagnostics,
      actionExecutorPolicy: capabilities.actionExecutorPolicy,
      workspaceMutations: capabilities.workspaceMutations,
      exposedWorkspaceOperations: intersectExposedWorkspaceOperations(
        permissions.exposedWorkspaceOperations,
        capabilities.exposedWorkspaceOperations,
      ),
      workspaceFileFilter: workspaceFileFilterForAgentBoundary(
        toolOptions?.workspaceTrustBoundary,
      ),
      semanticSearchOwnerId: capabilities.semanticSearchOwnerId,
      signal: options.signal,
      debugLabel: options.debugLabel,
      emitTrace: capabilities.emitTrace,
      // Tool process events (子2b R2): bind the current round and agentId here
      // so the executor's onTool stays callId/name/status only; the caller binds
      // turn. agentId is this loop's agent (entry or delegated target).
      onTool: options.onTool
        ? (callId, name, status, presentation, displayName) => {
            options.onTool!(agentContext.agent.id, round, callId, name, status, presentation, displayName)
            // 采集 tool processNode(按 callId 去重,与 UI onTool 回调同源,供持久化).
            const existing = collectedTimelineItems.find(
              (n): n is TurnTimelineItem & { kind: "tool" } => n.kind === "tool" && n.id === callId,
            )
            if (existing) {
              existing.status = status
              if (presentation !== undefined) existing.presentation = presentation
              if (displayName !== undefined) existing.displayName = displayName
            } else {
              collectedTimelineItems.push({
                kind: "tool",
                id: callId,
                round,
                name,
                status,
                collapsed: true,
                ...(presentation !== undefined ? { presentation } : {}),
                ...(displayName !== undefined ? { displayName } : {}),
              })
            }
          }
        : (
            callId: string,
            name: string,
            status: "loading" | "running" | "success" | "failed",
            presentation?: UiToolPresentation,
            displayName?: string,
          ) => {
            // 无 UI onTool 时仍采集 processNode(按 callId 去重,供持久化).
            const existing = collectedTimelineItems.find(
              (n): n is TurnTimelineItem & { kind: "tool" } => n.kind === "tool" && n.id === callId,
            )
            if (existing) {
              existing.status = status
              if (presentation !== undefined) existing.presentation = presentation
              if (displayName !== undefined) existing.displayName = displayName
            } else {
              collectedTimelineItems.push({
                kind: "tool",
                id: callId,
                round,
                name,
                status,
                collapsed: true,
                ...(presentation !== undefined ? { presentation } : {}),
                ...(displayName !== undefined ? { displayName } : {}),
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

    // Task memory is generated only from the accepted Agent observation.
    collectedToolMemories.push(...collectToolMemoriesForContext(
      result.toolCalls,
      observations,
      toolOptions.contextSequence,
      round,
      currentRuntimeTurnNumber(input),
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
): Promise<{ text: string; usage?: { input?: number; output?: number; total?: number }; collectedToolMemories?: AgentContextToolMemory[]; collectedTimelineItems?: TurnTimelineItem[] }> {
  const collectedToolMemories: AgentContextToolMemory[] = []
  const collectedTimelineItems: TurnTimelineItem[] = []
  if (!input.workspaceFiles || !agentContext) {
    // text 路径:messages 是 RuntimeChatMessage[](超集),text 模式无 role:tool,安全降级为 AiChatMessage[].
    // 整合器：合并连续相同 role 消息（Claude/Gemini API 硬要求），产出新数组传给 API。
    const mergedMessages = stripInternalMarkers(mergeConsecutiveRoleMessages(messages))
    const finalInputTokens = estimateAiChatMessagesTokens(mergedMessages as AiChatMessage[])
    capabilities.emitTrace?.({
      type: "request_preflight",
      debugLabel: options.debugLabel,
      ok: input.requestInputBudgetTokens === undefined
        || finalInputTokens <= input.requestInputBudgetTokens,
      data: {
        round: 0,
        estimatedInputTokens: finalInputTokens,
        requestInputBudgetTokens: input.requestInputBudgetTokens,
      },
    })
    if (
      input.requestInputBudgetTokens !== undefined
      && finalInputTokens > input.requestInputBudgetTokens
    ) {
      throw new ContextBudgetExhaustedError()
    }
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
  // tools, require the host's structured native caller. Do not switch modes
  // automatically; model configuration is the single source of truth.
  if (capabilities.toolCallMode === "native") {
    if (typeof capabilities.callModelNative !== "function") {
      throw new Error("Native tool calling is selected, but the host does not provide a native tool-calling model adapter.")
    }
    if (!toolOptions) {
      throw new Error("Native tool calling requires workspace tool-loop options.")
    }
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
  const capacityThreshold = toolOptions?.contextTokenBudget !== undefined
    ? toolOptions.contextTokenBudget * (isTaskMode ? getTaskContextCompressTriggerRatio() : getNarrativeContextCompressTriggerRatio())
    : Number.POSITIVE_INFINITY
  const consumptionThreshold = toolOptions?.requestInputBudgetTokens
    ?? Number.POSITIVE_INFINITY
  const triggerThreshold = Math.min(capacityThreshold, consumptionThreshold)
  let compressedThisTurn = false // narrative:一次压缩标记.task 不用(可多次).
  let taskSummary: string | null = null // task:前次压缩摘要,供下次压缩作 oldSummary.
  let lastRoundText = ""
  // text-protocol 路径 callModel 返回 string 不带 usage,此变量恒 undefined.
  // 声明它只为与 native loop 的 return 结构对称(避免类型分叉).
  let lastRoundUsage: { input?: number; output?: number; total?: number } | undefined
  const protocolErrorCountsByCode = new Map<string, number>()
  let protocolCorrectionMessage: AiChatMessage | undefined

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
            const finalText = stripThinkBlocks(stripTextProtocolArtifacts(lastRoundText)).trim()
            if (finalText) {
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
            traceContext: options.traceContext,
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
            const finalText = stripThinkBlocks(stripTextProtocolArtifacts(lastRoundText)).trim()
            if (finalText) {
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
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
            const finalText = stripThinkBlocks(stripTextProtocolArtifacts(lastRoundText)).trim()
            if (finalText) {
              return { text: finalText, usage: lastRoundUsage, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
            }
            throw new ContextBudgetExhaustedError()
          }
          const compressOptions: CompressCallOptions = {
            debugLabel: options.debugLabel,
            signal: options.signal,
            agentId: agentContext.agent.id,
            traceContext: options.traceContext,
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

    // 构建 callOptions:绑定 round,对称 native 循环的 callOptions 构建(index.ts:1636-1654).
    const callOptions: AgentRuntimeModelCallOptions = {
      ...options,
      round,
    }

    // 整合器：合并连续相同 role 消息（Claude/Gemini API 硬要求）。
    // 产出新数组传给 API，不 mutate nextMessages（工具循环的 splice-replace/
    // span 定位继续操作未整合的原始数组）。
    const mergedMessages = stripInternalMarkers(mergeConsecutiveRoleMessages(nextMessages as RuntimeChatMessage[]))
    const finalInputTokens = estimateAiChatMessagesTokens(mergedMessages as AiChatMessage[])
    capabilities.emitTrace?.({
      type: "request_preflight",
      agentId: agentContext.agent.id,
      debugLabel: options.debugLabel,
      ok: toolOptions?.requestInputBudgetTokens === undefined
        || finalInputTokens <= toolOptions.requestInputBudgetTokens,
      data: {
        round,
        estimatedInputTokens: finalInputTokens,
        requestInputBudgetTokens: toolOptions?.requestInputBudgetTokens,
      },
    })
    if (
      toolOptions?.requestInputBudgetTokens !== undefined
      && finalInputTokens > toolOptions.requestInputBudgetTokens
    ) {
      throw new ContextBudgetExhaustedError()
    }
    const response = await capabilities.callModel(mergedMessages as AiChatMessage[], callOptions)
    assertNotAborted(options.signal)

    const parseResult = parseTextToolProtocolResponse(response)
    // Budget fallbacks may run before the next correction model call. Retain
    // only parser-approved interim prose from a rejected response so malformed
    // runtime-history tags cannot shed their tag and leak the raw payload as a
    // final answer.
    lastRoundText = parseResult.kind === "protocol_error"
      ? parseResult.interimText
      : response
    const isProtocolError = parseResult.kind === "protocol_error"
    const toolCalls = parseResult.kind === "tool_calls"
      ? assignTextToolCallIds(parseResult.calls, round)
      : []
    const finishReason: "stop" | "tool_calls" = parseResult.kind === "stop" ? "stop" : "tool_calls"
    const traceToolCalls = toolCalls
      .map((tc) => tc.call)
      .filter((c): c is { name: string; arguments: Record<string, unknown> } => Boolean(c))
    capabilities.emitTrace?.({
      type: "model_call_completed",
      agentId: agentContext.agent.id,
      debugLabel: options.debugLabel,
      ok: !isProtocolError,
      data: {
        messageCount: mergedMessages.length,
        estimatedInputTokens: finalInputTokens,
        outputLength: response.length,
        hasToolCalls: toolCalls.length > 0,
        toolCallCount: toolCalls.length,
        round,
        finishReason,
        ...(traceToolCalls.length > 0
          ? { toolCalls: traceToolCallsSummary(traceToolCalls) }
          : {}),
        ...(isProtocolError ? { protocolError: parseResult.error } : {}),
      },
    })

    // 活动信号:每轮结束更新 lastActivityAt(无响应超时重置)
    if (toolOptions?.lastActivityAt !== undefined) {
      toolOptions.lastActivityAt = Date.now()
    }

    // C1: text 模式补发 onRoundEnd(对称 native 循环 index.ts:1666).
    // round 结束通知 UI 这一轮的 finishReason,让它构建 timeline round 边界.
    options.onRoundEnd?.(agentContext.agent.id, round, finishReason)

    if (parseResult.kind === "stop") {
      // stop 轮:剥离 text protocol artifacts + think blocks 得到干净正文.
      // B3: stripThinkBlocks 剥离三种常见原生思考标签,
      // 防止思考内容喂回模型污染上下文(与渲染层无关,这是平台硬需求).
      const cleanContent = stripThinkBlocks(stripTextProtocolArtifacts(response)).trim()
      // B3: 从 response 提取 think 块内容 → thought processNode(与 native 同构).
      // native 模式 thought 来自 reasoning stream;text 模式从正文标签提取.
      const thinkBlocks = extractThinkBlocks(response)
      if (thinkBlocks.length > 0) {
        const combinedThink = thinkBlocks.join("\n\n")
        collectedTimelineItems.push({ kind: "thought", id: `thought-r${round}`, round, text: combinedThink, collapsed: true })
      }
      return { text: cleanContent, ...(collectedToolMemories.length > 0 ? { collectedToolMemories } : {}), ...(collectedTimelineItems.length > 0 ? { collectedTimelineItems } : {}) }
    }

    if (parseResult.kind === "protocol_error") {
      const interimText = stripThinkBlocks(stripTextProtocolArtifacts(parseResult.interimText)).trim()
      if (interimText) {
        collectedTimelineItems.push({ kind: "interim", id: `interim-r${round}`, round, text: interimText, collapsed: false })
      }
      const thinkBlocksProtocolRound = extractThinkBlocks(response)
      if (thinkBlocksProtocolRound.length > 0) {
        const combinedThink = thinkBlocksProtocolRound.join("\n\n")
        collectedTimelineItems.push({ kind: "thought", id: `thought-r${round}`, round, text: combinedThink, collapsed: true })
      }
      const previousErrorCount = protocolErrorCountsByCode.get(parseResult.error.code) ?? 0
      if (previousErrorCount >= TEXT_TOOL_PROTOCOL_MAX_RETRIES) {
        throw new Error(`Text Tool Protocol error after retry exhaustion: ${parseResult.error.code}: ${parseResult.error.message}`)
      }
      protocolErrorCountsByCode.set(parseResult.error.code, previousErrorCount + 1)
      const retryRemaining = TEXT_TOOL_PROTOCOL_MAX_RETRIES - previousErrorCount
      const correctionMessage: AiChatMessage = {
        role: "user",
        content: formatTextToolProtocolError(parseResult.error, retryRemaining),
      }
      const previousCorrectionIndex = protocolCorrectionMessage
        ? nextMessages.lastIndexOf(protocolCorrectionMessage)
        : -1
      nextMessages = previousCorrectionIndex >= 0
        ? [
            ...nextMessages.slice(0, previousCorrectionIndex),
            correctionMessage,
            ...nextMessages.slice(previousCorrectionIndex + 1),
          ]
        : [...nextMessages, correctionMessage]
      protocolCorrectionMessage = correctionMessage
      continue
    }

    protocolErrorCountsByCode.clear()
    if (protocolCorrectionMessage) {
      const correctionIndex = nextMessages.lastIndexOf(protocolCorrectionMessage)
      if (correctionIndex >= 0) {
        nextMessages = [
          ...nextMessages.slice(0, correctionIndex),
          ...nextMessages.slice(correctionIndex + 1),
        ]
      }
      protocolCorrectionMessage = undefined
    }

    // 采集 interim processNode:tool_calls 轮的过渡文本(剥离 executable block + think blocks 后的正文).
    const interimText = stripThinkBlocks(stripTextProtocolArtifacts(parseResult.interimText)).trim()
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
      runQueryDiagnostics: capabilities.runQueryDiagnostics,
      actionExecutorPolicy: capabilities.actionExecutorPolicy,
      workspaceMutations: capabilities.workspaceMutations,
      exposedWorkspaceOperations: intersectExposedWorkspaceOperations(
        permissions.exposedWorkspaceOperations,
        capabilities.exposedWorkspaceOperations,
      ),
      workspaceFileFilter: workspaceFileFilterForAgentBoundary(
        toolOptions?.workspaceTrustBoundary,
      ),
      semanticSearchOwnerId: capabilities.semanticSearchOwnerId,
      signal: options.signal,
      debugLabel: options.debugLabel,
      emitTrace: capabilities.emitTrace,
      // 采集 tool processNode + 透传 UI onTool(text 模式工具过程显示 + processNode 持久化).
      // entry 和 delegated 路径共用此绑定(C2 验证:无条件绑定,不区分 entry/delegated).
      onTool: (callId, name, status, presentation, displayName) => {
        if (options.onTool) {
          options.onTool(agentContext.agent.id, round, callId, name, status, presentation, displayName)
        }
        // 采集 tool processNode(按 callId 去重) + 透传 UI onTool(text 模式工具过程显示 + 持久化).
        // entry 和 delegated 路径共用此绑定(C2 验证:无条件绑定,不区分 entry/delegated).
        const existing = collectedTimelineItems.find(
          (n): n is TurnTimelineItem & { kind: "tool" } => n.kind === "tool" && n.id === callId,
        )
        if (existing) {
          existing.status = status
          if (presentation !== undefined) existing.presentation = presentation
          if (displayName !== undefined) existing.displayName = displayName
        } else {
          collectedTimelineItems.push({
            kind: "tool",
            id: callId,
            round,
            name,
            status,
            collapsed: true,
            ...(presentation !== undefined ? { presentation } : {}),
            ...(displayName !== undefined ? { displayName } : {}),
          })
        }
      },
      onAskUser: options.onAskUser,
    }, toolCalls)
    const executedCalls = toolCalls
      .map((p) => p.call)
      .filter((call): call is NonNullable<typeof call> => call !== undefined)
    nextMessages = [
      ...nextMessages,
      // The runtime injects one non-executable user report containing both the
      // executed calls and their id-aligned accepted observations. Image parts
      // stay in this same message so multimodal providers cannot split the round.
      {
        role: "user",
        content: formatTextToolExecutionReport(executedCalls, observations),
      },
    ]
    // 采集本轮工具调用(供 contextUpdate 跨 turn 保留).observation 已通过统一 acceptance gate.
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
      collectedToolMemories.push(...collectToolMemoriesForContext(
        alignedToolCalls,
        alignedObservations,
        toolOptions?.contextSequence ?? 1,
        round,
        currentRuntimeTurnNumber(input),
      ))
    }
  }

  throw new Error(`${options.debugLabel} failed to complete workspace tool handling.`)
}

export async function runAgentRuntimeTurn(
  rawInput: AgentRuntimeTurnInput,
  environment: AgentRuntimeEnvironment,
): Promise<AgentRuntimeTurnResult> {
  const environmentInput: AgentRuntimeTurnInput = {
    ...rawInput,
    workspaceFiles: environment.workspace.files,
    workspaceTrustBoundary: environment.workspace.trustBoundary,
    toolFilter: environment.workspace.toolFilter,
    agentContext: environment.context.snapshot,
    contextTokenBudget: environment.context.contextCapacityTokens,
    requestInputBudgetTokens: environment.context.requestInputBudgetTokens,
    controlledToolAvailability: [
      ...(environment.controlledTools.inspectFrontend ? [AGENT_PLATFORM_TOOL_NAMES.inspectFrontend] : []),
      ...(environment.controlledTools.queryDiagnostics ? [AGENT_PLATFORM_TOOL_NAMES.queryDiagnostics] : []),
      ...(environment.controlledTools.testSkillScript ? [AGENT_PLATFORM_TOOL_NAMES.testSkillScript] : []),
    ],
    compressionMode: environment.context.compressionMode,
    timeoutMs: environment.context.inactivityTimeoutMs,
    onDelta: environment.events?.onDelta ?? rawInput.onDelta,
    onRoundEnd: environment.events?.onRoundEnd ?? rawInput.onRoundEnd,
    onTool: environment.events?.onTool ?? rawInput.onTool,
    onAskUser: environment.events?.onAskUser ?? rawInput.onAskUser,
  }
  const capabilities: AgentRuntimeCapabilities = {
    callModel: environment.model.callText,
    callModelNative: environment.model.callNative,
    toolCallMode: environment.model.toolCallMode,
    runInspectFrontend: environment.controlledTools.inspectFrontend,
    runQueryDiagnostics: environment.controlledTools.queryDiagnostics,
    runBrowserScript: environment.controlledTools.browserScript,
    runTestSkillScript: environment.controlledTools.testSkillScript,
    actionExecutorPolicy: environment.controlledTools.actionExecutorPolicy,
    workspaceMutations: environment.workspace.mutations,
    exposedWorkspaceOperations: environment.workspace.exposedOperations,
    collaborationPolicy: environment.collaborationPolicy,
    emitTrace: environment.audit,
    semanticSearchOwnerId: environment.workspace.semanticSearchOwnerId,
  }
  // Keep the Environment's live staged workspace array. Agent context
  // assembly and every Tool operation apply the trust-boundary view without
  // detaching the Tool loop from later transaction writes/deletes.
  const input: AgentRuntimeTurnInput = environmentInput
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
      { agentId: entryContext.agent.id },
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
  const contextSequence = agentContext.sequence + 1
  let compressedContext: AgentContextSnapshot | undefined
  const budget = resolveTokenBudget(input.contextTokenBudget)
  const triggerThreshold = budget * (entryCompressionMode === "task" ? getTaskContextCompressTriggerRatio() : getNarrativeContextCompressTriggerRatio())
  const contextBeforeTokens = estimateContextTokens(agentContext)
  if (contextBeforeTokens > triggerThreshold) {
    const compressOptions: CompressCallOptions = {
      debugLabel: "entry-agent",
      signal: input.signal,
      agentId: entryContext.agent.id,
      traceContext: input.traceContext,
      // task 模式(助手)用任务摘要 prompt + "用户/助手"标签;
      // narrative 模式(master)不传 → compressContext 用默认剧情梗概 prompt + "玩家/叙事"标签.
      ...(entryCompressionMode === "task"
        ? {
            systemPrompt: ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT,
            compressionKind: "task-continuation" as const,
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
  // 跨 turn 只保留 model 工具记忆投影 + UI presentation timeline.
  let collectedToolMemories: AgentContextToolMemory[] | undefined
  let collectedTimelineItems: TurnTimelineItem[] | undefined
  // turn 内 narrative 压缩会 Object.assign 回这个快照。保存压缩边界的值，
  // 不比较对象/时间戳：turn-start compressedContext 与它可能是同一引用。
  const agentContextSnapshotForLoop = agentContext
  const lastCompressedSequenceBeforeLoop = agentContextSnapshotForLoop.lastCompressedSequence
  try {
    const loopResult = await callAgentModelWithWorkspaceTools(
      buildEntryAgentMessages(
        input,
        entryContext,
        collaborationPolicy,
        agentCallState,
        capabilities.toolCallMode,
        entryCompressionMode,
        agentContext,
      ),
      input,
      capabilities,
      {
        debugLabel: "entry-agent",
        signal: input.signal,
        agentId: entryContext.agent.id,
        traceContext: input.traceContext,
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
        workspaceTrustBoundary: input.workspaceTrustBoundary ?? "runtime-game-agent",
        compressionMode: entryCompressionMode,
        agentContextSnapshot: agentContextSnapshotForLoop ?? undefined,
        contextSequence,
        contextTokenBudget: budget,
        requestInputBudgetTokens: input.requestInputBudgetTokens,
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
    collectedToolMemories = loopResult.collectedToolMemories
    collectedTimelineItems = loopResult.collectedTimelineItems
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
      sequence: contextSequence,
      gameTurn: currentRuntimeTurnNumber(input),
      user: input.userInput,
      assistant: replyText,
      compressedContext: agentContextSnapshotForLoop.lastCompressedSequence !== lastCompressedSequenceBeforeLoop
        ? agentContextSnapshotForLoop
        : compressedContext,
      ...(collectedToolMemories && collectedToolMemories.length > 0 ? { toolMemories: collectedToolMemories } : {}),
      // 过程节点 timeline items(thought/tool/interim)供 host 写入会话消息存储 timeline,UI 重建 timeline.
      ...(collectedTimelineItems && collectedTimelineItems.length > 0 ? { timelineItems: collectedTimelineItems } : {}),
    },
    ...(turnUsage ? { usage: turnUsage } : {}),
  }
}
