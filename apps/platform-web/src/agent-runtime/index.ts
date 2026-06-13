import type {
  AgentContextEntry,
  AiChatMessage,
  ConversationMessageRecord,
  RuntimeSnapshotShell,
  StateRecord,
  WorkspaceFile,
} from "@tsian/contracts"
import { assembleAgentContext } from "./context"
import {
  createRuntimeWorkspaceToolSessionState,
  executeRuntimeWorkspaceToolCalls,
  formatRuntimeWorkspaceToolObservationMessage,
  parseRuntimeWorkspaceToolCalls,
  RUNTIME_WORKSPACE_TOOL_NAMES,
  stripRuntimeWorkspaceToolCallBlocks,
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
  debugLabel: "master-agent" | "narrative-agent"
  signal?: AbortSignal
}

export interface AgentRuntimeCapabilities {
  callModel(
    messages: AiChatMessage[],
    options: AgentRuntimeModelCallOptions,
  ): Promise<string>
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

const WORKSPACE_TOOL_INSTRUCTIONS = [
  "你可以按需使用 Runtime 工具读取更多上下文。工具是可选的，只在当前上下文不足时使用。",
  `如果需要加载 Skill 详情，使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad}，并传入可见 Skill Index 中的 name。不要用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead} 读取 Skill 入口文件。`,
  `加载后的 SKILL.md 会说明什么时候读取哪些 references、examples、schemas、scripts 或其它工作区文件。只有执行到这些引用步骤时，才使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList}/${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch} 读取具体资源。`,
  `只有成功加载某个 Skill 后，才能使用 ${RUNTIME_WORKSPACE_TOOL_NAMES.actionCall} 调用该 Skill 声明的 action。当前 MVP 只会校验 action 请求，不会执行脚本、远程调用或写入状态。`,
  "可用工具：",
  `- ${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad} arguments={"name":"prose-style"}`,
  `- ${RUNTIME_WORKSPACE_TOOL_NAMES.actionCall} arguments={"skill":"prose-style","action":"example_action","input":{"text":"示例"}}`,
  `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead} arguments={"path":"world/canon.md"}`,
  `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList} arguments={"path":"skills"}，path 可省略表示根目录`,
  `- ${RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch} arguments={"query":"关键词","limit":10}`,
  "工具调用格式必须独占一个块：",
  "<tsian-tool-call>",
  `{"name":"${RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad}","arguments":{"name":"prose-style"}}`,
  "</tsian-tool-call>",
  "收到 observation 后继续完成任务。最终输出不要包含工具调用块、observation、工具细节或实现说明。",
].join("\n")

const LEGACY_MASTER_AGENT_SYSTEM_PROMPT = [
  "你是 Tsian AIRP 的主控 Agent，负责理解玩家本轮输入并给正文 Agent 一个简洁、可执行的写作 brief。",
  "你不直接输出给玩家看的正文。你要判断本轮应如何推进剧情、保持沉浸、尊重已有对话，并指出需要延续的情绪、冲突、信息或节奏。",
  "输出普通文本即可，不要 JSON，不要 Markdown 标题，控制在 300 字以内。",
].join("\n")

const MAX_WORKSPACE_TOOL_ROUNDS_PER_AGENT = 3

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
): string {
  return [
    guard,
    "",
    "下面是当前 Agent 的 AGENT.md 内容，优先遵循它定义的职责、输出习惯和协作边界。",
    "",
    formatWorkspaceFile(context.agentFile),
    "",
    "Runtime Workspace 工具说明：",
    WORKSPACE_TOOL_INSTRUCTIONS,
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
  return [
    {
      role: "system",
      content: context
        ? buildWorkspaceAgentSystemPrompt(MASTER_AGENT_PLATFORM_GUARD, context)
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
  return [
    {
      role: "system",
      content: context
        ? buildWorkspaceAgentSystemPrompt(NARRATIVE_AGENT_PLATFORM_GUARD, context)
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

async function callAgentModelWithWorkspaceTools(
  messages: AiChatMessage[],
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
  options: AgentRuntimeModelCallOptions,
  agentContext: AgentContextEntry | null,
): Promise<string> {
  if (!input.workspaceFiles || !agentContext) {
    return (await capabilities.callModel(messages, options)).trim()
  }

  let nextMessages = messages
  const workspaceToolSession = createRuntimeWorkspaceToolSessionState()
  for (let round = 0; round <= MAX_WORKSPACE_TOOL_ROUNDS_PER_AGENT; round += 1) {
    assertNotAborted(options.signal)

    const response = await capabilities.callModel(nextMessages, options)
    assertNotAborted(options.signal)

    const toolCalls = parseRuntimeWorkspaceToolCalls(response)
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

    const observations = executeRuntimeWorkspaceToolCalls({
      workspaceFiles: input.workspaceFiles,
      agentContext,
      sessionState: workspaceToolSession,
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

  const masterContext = getWorkspaceAgentContext(input, "master")
  const masterPlan = (await callAgentModelWithWorkspaceTools(
    buildMasterMessages(input, masterContext),
    input,
    capabilities,
    {
      debugLabel: "master-agent",
      signal: input.signal,
    },
    masterContext,
  )).trim()

  assertNotAborted(input.signal)

  const narrativeContext = getWorkspaceAgentContext(input, "narrative")
  const replyText = (await callAgentModelWithWorkspaceTools(
    buildNarrativeMessages(input, masterPlan, narrativeContext),
    input,
    capabilities,
    {
      debugLabel: "narrative-agent",
      signal: input.signal,
    },
    narrativeContext,
  )).trim()

  if (!replyText) {
    throw new Error("narrative-agent returned an empty reply.")
  }

  return {
    replyText,
    masterPlan,
  }
}
