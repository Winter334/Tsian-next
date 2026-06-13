import type {
  AgentRegistryEntry,
  AgentContextEntry,
  AiChatMessage,
  ConversationMessageRecord,
  PlatformActionRequest,
  PlatformActionResult,
  RuntimeSnapshotShell,
  StateRecord,
  WorkspaceFile,
} from "@tsian/contracts"
import { assembleAgentContext } from "./context"
import { buildAgentRegistry } from "./registry"
import type { RuntimeTraceDebugLabel, RuntimeTraceEmitter } from "./trace"
import { errorToTraceData } from "./trace"
import {
  createRuntimeWorkspaceToolSessionState,
  executeRuntimeWorkspaceToolCalls,
  formatRuntimeWorkspaceToolObservationMessage,
  parseRuntimeWorkspaceToolCalls,
  RUNTIME_WORKSPACE_TOOL_NAMES,
  stripRuntimeWorkspaceToolCallBlocks,
  type RuntimeAgentCallArguments,
  type RuntimeAgentCallHistoryMode,
} from "./workspace-tools"

export interface AgentRuntimeTurnInput {
  userInput: string
  recentHistory: ConversationMessageRecord[]
  snapshot: RuntimeSnapshotShell
  stateRecords: StateRecord[]
  workspaceFiles?: WorkspaceFile[]
  signal?: AbortSignal
}

export interface AgentRuntimeTurnResult {
  replyText: string
  masterPlan: string
}

export interface AgentRuntimeModelCallOptions {
  debugLabel: RuntimeTraceDebugLabel
  signal?: AbortSignal
}

export interface AgentRuntimeCapabilities {
  callModel(
    messages: AiChatMessage[],
    options: AgentRuntimeModelCallOptions,
  ): Promise<string>
  runPlatformAction?(
    request: PlatformActionRequest,
  ): Promise<PlatformActionResult>
  emitTrace?: RuntimeTraceEmitter
}

const MASTER_AGENT_PLATFORM_GUARD = [
  "你是 Tsian AIRP 的主控 Agent。",
  "你会收到自己的 AGENT.md、工作区上下文、最近对话、状态记录和玩家本轮输入。",
  "你不直接输出给玩家看的正文。你要判断本轮应如何推进剧情、保持沉浸、尊重已有对话，并指出需要延续的情绪、冲突、信息或节奏。",
  "输出普通文本即可，不要 JSON，不要 Markdown 标题，控制在 300 字以内。",
].join("\n")

const NARRATIVE_AGENT_PLATFORM_GUARD = [
  "你是 Tsian AIRP 的正文 Agent。",
  "你会收到自己的 AGENT.md、工作区上下文、最近对话、状态记录、主控 Agent brief 和玩家本轮输入。",
  "根据主控 Agent 的 brief、最近对话和玩家本轮输入继续剧情。不要解释系统行为，不要提到 Agent、brief、工具或提示词。",
  "以第二人称或贴近玩家视角的叙事为主，保持可互动性，在结尾自然留下玩家下一步可以回应的空间。",
].join("\n")

const DELEGATED_AGENT_PLATFORM_GUARD = [
  "你是 Tsian AIRP 中被 agent_call 临时调用的专业 Agent。",
  "你会收到自己的 AGENT.md、工作区上下文、调用方请求、必要的最近对话和玩家本轮输入。",
  "你不直接面对玩家；你的输出会作为 observation 返回给调用方，由调用方决定如何使用。",
  "请专注回答调用方请求，返回建议、判断、草案、连续性检查或需要沉淀的事实提示。",
  "MVP 中不要再次调用 agent_call；如果需要其它 Agent 参与，请把建议写在输出里。",
].join("\n")

const LEGACY_MASTER_AGENT_SYSTEM_PROMPT = [
  "你是 Tsian AIRP 的主控 Agent，负责理解玩家本轮输入并给正文 Agent 一个简洁、可执行的写作 brief。",
  "你不直接输出给玩家看的正文。你要判断本轮应如何推进剧情、保持沉浸、尊重已有对话，并指出需要延续的情绪、冲突、信息或节奏。",
  "输出普通文本即可，不要 JSON，不要 Markdown 标题，控制在 300 字以内。",
].join("\n")

const MAX_WORKSPACE_TOOL_ROUNDS_PER_AGENT = 3
const MAX_AGENT_CALLS_PER_TURN = 4
const MAX_AGENT_CALL_DEPTH = 1
const AGENT_CALL_HISTORY_WINDOW_BY_MODE: Record<RuntimeAgentCallHistoryMode, number> = {
  minimal: 0,
  recent: 6,
  scene: 12,
}

interface AgentCallTurnState {
  callCount: number
}

interface WorkspaceToolLoopOptions {
  allowAgentCall: boolean
  agentCallState: AgentCallTurnState
  agentCallDepth: number
}

const LEGACY_NARRATIVE_AGENT_SYSTEM_PROMPT = [
  "你是 Tsian AIRP 的正文 Agent，负责写出玩家可直接阅读的沉浸式剧情回复。",
  "根据主控 Agent 的 brief、最近对话和玩家本轮输入继续剧情。不要解释系统行为，不要提到 Agent、brief、工具或提示词。",
  "以第二人称或贴近玩家视角的叙事为主，保持可互动性，在结尾自然留下玩家下一步可以回应的空间。",
].join("\n")

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

function formatStateRecords(records: StateRecord[]): string {
  if (records.length === 0) {
    return "（暂无状态记录）"
  }

  return records
    .slice(0, 20)
    .map((record) => {
      const tags = record.tags?.length ? ` tags=${record.tags.join(",")}` : ""
      return `- ${record.namespace}/${record.collection}/${record.id}${tags}: ${JSON.stringify(record.data)}`
    })
    .join("\n")
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
      return `- ${skill.name} [${scope}]: ${skill.description || skill.summary || "（无描述）"}${triggers}${appliesTo}`
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

function buildWorkspaceToolInstructions(
  options: {
    allowAgentCall: boolean
    visibleContacts: AgentRegistryEntry[]
  },
): string {
  const canCallAgents = options.allowAgentCall && options.visibleContacts.length > 0
  return [
    "你可以按需使用 Runtime 工具读取更多上下文。工具是可选的，只在当前上下文不足时使用。",
    `如果需要加载 Skill 详情，使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad}，并传入可见 Skill Index 中的 name。不要用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead} 读取 Skill 入口文件。`,
    `加载后的 SKILL.md 会说明什么时候读取哪些 references、examples、schemas、scripts 或其它工作区文件。只有执行到这些引用步骤时，才使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch} 读取具体资源。`,
    `只有成功加载某个 Skill 后，才能使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.actionCall} 调用该 Skill 声明的 action。当前支持内置 executor 和平台允许的 platform_action executor；不会执行浏览器脚本或远程调用。`,
    "platform_action 可能写入 Runtime Workspace，只在已加载 Skill 明确要求维护状态、地图、记忆、线索或前端约定数据时使用。",
    ...(canCallAgents
      ? [
          `如果当前任务需要联系人 Agent 的专业判断，可以使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.agentCall} 发起一次性会诊。被调用 Agent 的输出只会作为 observation 返回给你，不会直接成为玩家回复。`,
          "可联系 Agent：",
          formatVisibleAgentContacts(options.visibleContacts),
        ]
      : []),
    "可用工具：",
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad} arguments={"name":"prose-style"}`,
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.actionCall} arguments={"skill":"prose-style","action":"example_action","input":{"text":"示例"}}`,
    ...(canCallAgents
      ? [
          `- ${RUNTIME_WORKSPACE_TOOL_NAMES.agentCall} arguments={"agentId":"${options.visibleContacts[0].id}","request":"请检查当前场景的连续性。","historyMode":"recent"}`,
        ]
      : []),
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead} arguments={"path":"world/canon.md"}`,
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList} arguments={"path":"skills"}，path 可省略表示根目录`,
    `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch} arguments={"query":"关键词","limit":10}`,
    "工具调用格式必须独占一个块：",
    "<tsian-tool-call>",
    `{"name":"${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad}","arguments":{"name":"prose-style"}}`,
    "</tsian-tool-call>",
    "收到 observation 后继续完成任务。最终输出不要包含工具调用块、observation、工具细节或实现说明。",
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
  },
): string {
  return [
    guard,
    "",
    "下面是当前 Agent 的 AGENT.md 内容，优先遵循它定义的职责、输出习惯和协作边界。",
    "",
    formatWorkspaceFile(context.agentFile),
    "",
    "Runtime Workspace 工具说明：",
    buildWorkspaceToolInstructions(options),
  ].join("\n")
}

function getWorkspaceAgentContext(
  input: AgentRuntimeTurnInput,
  agentId: "master" | "narrative",
): AgentContextEntry | null {
  if (!input.workspaceFiles) {
    return null
  }

  const context = assembleAgentContext(input.workspaceFiles, { agentId })
  if (!context) {
    throw new Error(
      `Workspace Agent "${agentId}" is required but was not found. Restore agents/${agentId}/AGENT.md or recreate the default workspace.`,
    )
  }

  return context
}

function buildMasterMessages(
  input: AgentRuntimeTurnInput,
  context: AgentContextEntry | null = getWorkspaceAgentContext(input, "master"),
): AiChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  const visibleContacts = context && input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, context)
    : []
  return [
    {
      role: "system",
      content: context
        ? buildWorkspaceAgentSystemPrompt(MASTER_AGENT_PLATFORM_GUARD, context, {
            allowAgentCall: true,
            visibleContacts,
          })
        : LEGACY_MASTER_AGENT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        `当前回合：${input.snapshot.state.turn}`,
        ...(context
          ? [
              "Workspace Agent 上下文：",
              formatAgentRuntimeContext(context),
              "",
            ]
          : []),
        "最近对话：",
        formatHistory(history),
        "",
        "可用状态记录：",
        formatStateRecords(input.stateRecords),
        "",
        "玩家本轮输入：",
        input.userInput,
        "",
        "请给正文 Agent 一个本轮写作 brief。",
      ].join("\n"),
    },
  ]
}

function buildNarrativeMessages(
  input: AgentRuntimeTurnInput,
  masterPlan: string,
  context: AgentContextEntry | null = getWorkspaceAgentContext(input, "narrative"),
): AiChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  const visibleContacts = context && input.workspaceFiles
    ? getVisibleAgentContacts(input.workspaceFiles, context)
    : []
  return [
    {
      role: "system",
      content: context
        ? buildWorkspaceAgentSystemPrompt(NARRATIVE_AGENT_PLATFORM_GUARD, context, {
            allowAgentCall: true,
            visibleContacts,
          })
        : LEGACY_NARRATIVE_AGENT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        `当前回合：${input.snapshot.state.turn}`,
        ...(context
          ? [
              "Workspace Agent 上下文：",
              formatAgentRuntimeContext(context),
              "",
            ]
          : []),
        "最近对话：",
        formatHistory(history),
        "",
        "可用状态记录：",
        formatStateRecords(input.stateRecords),
        "",
        "主控 Agent brief：",
        masterPlan.trim(),
        "",
        "玩家本轮输入：",
        input.userInput,
        "",
        "请输出给玩家看的剧情正文。",
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

function delegatedAgentDebugLabel(agentId: string): RuntimeTraceDebugLabel {
  return `agent:${agentId}`
}

function selectHistoryForAgentCall(
  history: ConversationMessageRecord[],
  historyMode: RuntimeAgentCallHistoryMode,
): ConversationMessageRecord[] {
  const windowSize = AGENT_CALL_HISTORY_WINDOW_BY_MODE[historyMode]
  if (windowSize <= 0) {
    return []
  }

  return normalizeHistory(history).slice(-windowSize)
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
): AiChatMessage[] {
  const history = selectHistoryForAgentCall(input.recentHistory, agentCall.historyMode)
  return [
    {
      role: "system",
      content: buildWorkspaceAgentSystemPrompt(DELEGATED_AGENT_PLATFORM_GUARD, targetContext, {
        allowAgentCall: false,
        visibleContacts: [],
      }),
    },
    {
      role: "user",
      content: [
        `当前回合：${input.snapshot.state.turn}`,
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
        "可用状态记录：",
        formatStateRecords(input.stateRecords),
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
): (agentCall: RuntimeAgentCallArguments) => Promise<unknown> {
  return async (agentCall) => {
    assertNotAborted(input.signal)
    if (!input.workspaceFiles) {
      throw agentCallError(
        "AGENT_CALL_UNAVAILABLE",
        "agent_call requires Runtime Workspace files.",
      )
    }

    if (depth >= MAX_AGENT_CALL_DEPTH) {
      throw agentCallError(
        "AGENT_CALL_UNAVAILABLE",
        "Nested agent_call is not available in the MVP.",
      )
    }

    const registry = buildAgentRegistry(input.workspaceFiles)
    const targetAgent = registry.find((agent) => agent.id === agentCall.agentId)
    if (!targetAgent) {
      throw agentCallError(
        "AGENT_CALL_TARGET_NOT_FOUND",
        `Agent was not found: ${agentCall.agentId}`,
        { agentId: agentCall.agentId },
      )
    }

    if (!contactIdSet(callerContext).has(agentCall.agentId)) {
      throw agentCallError(
        "AGENT_CALL_TARGET_NOT_CONTACT",
        `Agent "${agentCall.agentId}" is not listed in ${callerContext.agent.id}'s contacts.`,
        {
          callerAgentId: callerContext.agent.id,
          targetAgentId: agentCall.agentId,
        },
      )
    }

    if (state.callCount >= MAX_AGENT_CALLS_PER_TURN) {
      throw agentCallError(
        "AGENT_CALL_LIMIT_EXCEEDED",
        "agent_call limit exceeded for this turn.",
        {
          maxCallsPerTurn: MAX_AGENT_CALLS_PER_TURN,
          callCount: state.callCount,
        },
      )
    }

    const targetContext = assembleAgentContext(input.workspaceFiles, {
      agentId: targetAgent.id,
    })
    if (!targetContext) {
      throw agentCallError(
        "AGENT_CALL_TARGET_NOT_FOUND",
        `Agent context was not found: ${targetAgent.id}`,
        { agentId: targetAgent.id },
      )
    }

    state.callCount += 1
    const debugLabel = delegatedAgentDebugLabel(targetContext.agent.id)
    capabilities.emitTrace?.({
      type: "agent_step_started",
      ...traceAgentBase(targetContext, debugLabel),
      data: {
        agentTitle: targetContext.agent.title,
        callerAgentId: callerContext.agent.id,
        delegated: true,
      },
    })

    try {
      const response = (await callAgentModelWithWorkspaceTools(
        buildDelegatedAgentMessages(input, callerContext, targetContext, agentCall),
        input,
        capabilities,
        {
          debugLabel,
          signal: input.signal,
        },
        targetContext,
        {
          allowAgentCall: false,
          agentCallState: state,
          agentCallDepth: depth + 1,
        },
      )).trim()
      capabilities.emitTrace?.({
        type: "agent_step_completed",
        ...traceAgentBase(targetContext, debugLabel),
        ok: true,
        data: {
          outputLength: response.length,
          callerAgentId: callerContext.agent.id,
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
        response,
      }
    } catch (error) {
      capabilities.emitTrace?.({
        type: "agent_step_failed",
        ...traceAgentBase(targetContext, debugLabel),
        ok: false,
        data: {
          ...errorToTraceData(error),
          callerAgentId: callerContext.agent.id,
          delegated: true,
        },
      })
      throw agentCallError(
        "AGENT_CALL_FAILED",
        `agent_call failed for Agent "${targetContext.agent.id}".`,
        errorToTraceData(error),
      )
    }
  }
}

async function callAgentModelWithWorkspaceTools(
  messages: AiChatMessage[],
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  options: AgentRuntimeModelCallOptions,
  agentContext: AgentContextEntry | null,
  toolOptions?: WorkspaceToolLoopOptions,
): Promise<string> {
  if (!input.workspaceFiles || !agentContext) {
    const response = await capabilities.callModel(messages, options)
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

  let nextMessages = messages
  const workspaceToolSession = createRuntimeWorkspaceToolSessionState()
  for (let round = 0; round <= MAX_WORKSPACE_TOOL_ROUNDS_PER_AGENT; round += 1) {
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
      return stripRuntimeWorkspaceToolCallBlocks(response).trim()
    }

    if (round >= MAX_WORKSPACE_TOOL_ROUNDS_PER_AGENT) {
      const finalText = stripRuntimeWorkspaceToolCallBlocks(response).trim()
      if (finalText) {
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
      runAgentCall: toolOptions?.allowAgentCall
        ? createAgentCallRunner(
            input,
            capabilities,
            agentContext,
            toolOptions.agentCallState,
            toolOptions.agentCallDepth,
          )
        : undefined,
      runPlatformAction: capabilities.runPlatformAction,
      debugLabel: options.debugLabel,
      emitTrace: capabilities.emitTrace,
    }, toolCalls)
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
  const agentCallState = createAgentCallTurnState()

  const masterContext = getWorkspaceAgentContext(input, "master")
  capabilities.emitTrace?.({
    type: "agent_step_started",
    ...traceAgentBase(masterContext, "master-agent"),
    data: {
      ...(masterContext ? { agentTitle: masterContext.agent.title } : {}),
    },
  })

  let masterPlan: string
  try {
    masterPlan = (await callAgentModelWithWorkspaceTools(
      buildMasterMessages(input, masterContext),
      input,
      capabilities,
      {
        debugLabel: "master-agent",
        signal: input.signal,
      },
      masterContext,
      {
        allowAgentCall: true,
        agentCallState,
        agentCallDepth: 0,
      },
    )).trim()
    capabilities.emitTrace?.({
      type: "agent_step_completed",
      ...traceAgentBase(masterContext, "master-agent"),
      ok: true,
      data: {
        outputLength: masterPlan.length,
      },
    })
  } catch (error) {
    capabilities.emitTrace?.({
      type: "agent_step_failed",
      ...traceAgentBase(masterContext, "master-agent"),
      ok: false,
      data: errorToTraceData(error),
    })
    throw error
  }

  assertNotAborted(input.signal)

  const narrativeContext = getWorkspaceAgentContext(input, "narrative")
  capabilities.emitTrace?.({
    type: "agent_step_started",
    ...traceAgentBase(narrativeContext, "narrative-agent"),
    data: {
      ...(narrativeContext ? { agentTitle: narrativeContext.agent.title } : {}),
    },
  })

  let replyText: string
  try {
    replyText = (await callAgentModelWithWorkspaceTools(
      buildNarrativeMessages(input, masterPlan, narrativeContext),
      input,
      capabilities,
      {
        debugLabel: "narrative-agent",
        signal: input.signal,
      },
      narrativeContext,
      {
        allowAgentCall: true,
        agentCallState,
        agentCallDepth: 0,
      },
    )).trim()
    if (!replyText) {
      throw new Error("narrative-agent returned an empty reply.")
    }

    capabilities.emitTrace?.({
      type: "agent_step_completed",
      ...traceAgentBase(narrativeContext, "narrative-agent"),
      ok: true,
      data: {
        outputLength: replyText.length,
      },
    })
  } catch (error) {
    capabilities.emitTrace?.({
      type: "agent_step_failed",
      ...traceAgentBase(narrativeContext, "narrative-agent"),
      ok: false,
      data: errorToTraceData(error),
    })
    throw error
  }

  return {
    replyText,
    masterPlan,
  }
}
