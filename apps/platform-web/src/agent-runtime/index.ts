import type {
  AiChatMessage,
  ConversationMessageRecord,
  RuntimeSnapshotShell,
  StateRecord,
} from "@tsian/contracts"

export interface AgentRuntimeTurnInput {
  userInput: string
  recentHistory: ConversationMessageRecord[]
  snapshot: RuntimeSnapshotShell
  stateRecords: StateRecord[]
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

const MASTER_AGENT_SYSTEM_PROMPT = [
  "你是 Tsian AIRP 的主控 Agent，负责理解玩家本轮输入并给正文 Agent 一个简洁、可执行的写作 brief。",
  "你不直接输出给玩家看的正文。你要判断本轮应如何推进剧情、保持沉浸、尊重已有对话，并指出需要延续的情绪、冲突、信息或节奏。",
  "输出普通文本即可，不要 JSON，不要 Markdown 标题，控制在 300 字以内。",
].join("\n")

const NARRATIVE_AGENT_SYSTEM_PROMPT = [
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

function buildMasterMessages(input: AgentRuntimeTurnInput): AiChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  return [
    {
      role: "system",
      content: MASTER_AGENT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        `当前回合：${input.snapshot.state.turn}`,
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
): AiChatMessage[] {
  const history = normalizeHistory(input.recentHistory)
  return [
    {
      role: "system",
      content: NARRATIVE_AGENT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: [
        "最近对话：",
        formatHistory(history),
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

export async function runAgentRuntimeTurn(
  input: AgentRuntimeTurnInput,
  capabilities: AgentRuntimeCapabilities,
): Promise<AgentRuntimeTurnResult> {
  assertNotAborted(input.signal)

  const masterPlan = (await capabilities.callModel(buildMasterMessages(input), {
    debugLabel: "master-agent",
    signal: input.signal,
  })).trim()

  assertNotAborted(input.signal)

  const replyText = (await capabilities.callModel(
    buildNarrativeMessages(input, masterPlan),
    {
      debugLabel: "narrative-agent",
      signal: input.signal,
    },
  )).trim()

  if (!replyText) {
    throw new Error("narrative-agent returned an empty reply.")
  }

  return {
    replyText,
    masterPlan,
  }
}
