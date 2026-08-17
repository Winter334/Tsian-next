import type {
  AgentContextSnapshot,
  AgentContextTurnEntry,
  AgentContextToolMemory,
  ConversationMessageRecord,
  AiChatMessage,
  ContentPart,
} from "@tsian/contracts"
import type { AiTraceOperationContext, RuntimeChatMessage } from "../runtime-host/ai"
import type { RuntimeTraceDebugLabel } from "./trace"
import { getPlatformConfig } from "../config/platform-config"
import { sortToolMemoriesStable } from "./tool-memory"
import {
  extractTextToolNameFromMessage,
  TEXT_TOOL_EXECUTED_TOOLS_TAG,
  TEXT_TOOL_OBSERVATIONS_TAG,
} from "./text-tool-protocol"

/**
 * master agent 会话上下文生命周期与压缩持久化.
 *
 * 与玩家剧情正文存档(turn 文件 `save/history/turns/`)分离:这里管的是 master agent 视角的
 * "1 摘要 + 最近 K 轮正文"稳态,持久化到工作区 `save/agents/master/context.json`,
 * 跨 turn/跨加载保持上下文不膨胀不失忆.详见任务
 * `06-19-agent-session-context-lifecycle` 的 design.md.
 */

/** context.json 在工作区的路径生成器(save-runtime 根下,必须以 save/ 开头才能通过
 *  assertOrdinarySaveRuntimeMutationPath 校验).历史值曾误为 "agents/master/context.json",
 *  缺 save/ 前缀,导致 turn 收尾 stageAgentContextFile 写入被
 *  WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED 拦截、整个 turn 回滚、正文不落库
 *  (加载存档后对话记录"消失"的根因).
 *
 *  泛化为按 agentId 生成路径(task 06-26):master 路径值不变(向后兼容),
 *  任意 persistent 入口 agent 的 context 存 save/agents/<agentId>/context.json.
 *
 *  contextSlot 参数(task 07-01):不同调用方传不同 slot,读写不同 context-<slot>.json,
 *  实现上下文隔离。slot 省略时路径不变(向后兼容)。slot 经消毒只保留 [a-zA-Z0-9_-],
 *  防路径穿越/特殊字符注入。 */
export function normalizeAgentContextSlot(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9_-]/g, "-")
}

export function agentContextPath(agentId: string, slot?: string): string {
  const base = `save/agents/${agentId}`
  if (!slot) return `${base}/context.json`
  const safeSlot = normalizeAgentContextSlot(slot)
  return `${base}/context-${safeSlot}.json`
}
export function agentInvocationTranscriptPath(agentId: string, slot: string): string {
  const safeSlot = normalizeAgentContextSlot(slot)
  return `save/agents/${agentId}/transcripts/${safeSlot}.json`
}
/** context.json 的 schema 标记,用于 parse 时校验. */
export const AGENT_CONTEXT_SCHEMA = "tsian.agent.context.v2"
/** master agent 固定 id(context.json 只服务 master). */
export const AGENT_CONTEXT_AGENT_ID = "master" as const

// ─────────────────────────────────────────────────────────────────────────
// 助手 context 快照常量(design 06-20-assistant-context-persistence)
// 与 master 常量并列:助手 context 存虚拟文件 .tsian/local/assistant/sessions/<id>/context.json,
// schema/agentId 与 master 区分(语义分明),复用 AgentContextSnapshot 类型.
// ─────────────────────────────────────────────────────────────────────────

/** 助手 context 快照 schema 标记(与 master 的 tsian.agent.context.v2 区分,语义分明). */
export const ASSISTANT_CONTEXT_SCHEMA = "tsian.assistant.context.v2" as const
/** 助手 agent 固定 id. */
export const ASSISTANT_CONTEXT_AGENT_ID = "assistant" as const

/** 默认 token 预算:model 未配 contextWindow 时兜底. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000
/** narrative/master 压缩触发阈值比例:默认 0.85,留 15% 余量吸收估算偏差. */
export function getNarrativeContextCompressTriggerRatio(): number {
  return getPlatformConfig().contextCompression.narrativeTriggerRatio
}
/** task/assistant 压缩触发阈值比例:默认更早触发,避免工具历史拖垮缓存命中. */
export function getTaskContextCompressTriggerRatio(): number {
  return getPlatformConfig().contextCompression.taskTriggerRatio
}
/** 压缩时保留最近几轮正文(原文不压缩).读平台配置 contextCompression.keepRecentTurns(默认 5). */
export function getContextKeepRecentTurns(): number {
  return getPlatformConfig().contextCompression.keepRecentTurns
}
/** task 模式(助手/子代理)压缩时保留最近几轮工具交互(原文不压缩).
 *  读平台配置 contextCompression.taskKeepRecentRounds(默认 5).
 *  与 keepRecentTurns 分离——narrative 保留正文轮次,task 保留工具交互轮次,计数单位不同. */
export function getTaskKeepRecentRounds(): number {
  return getPlatformConfig().contextCompression.taskKeepRecentRounds
}
/** task 模式跨 turn 工具记忆单条模型可见字符预算. */
export function getTaskToolMemoryPerToolCharLimit(): number {
  return getPlatformConfig().contextCompression.toolMemoryPerToolCharLimit
}
/** task 模式跨 turn 最近工具记忆模型可见总字符预算. */
export function getTaskToolMemoryTotalRecentCharLimit(): number {
  return getPlatformConfig().contextCompression.toolMemoryTotalRecentCharLimit
}
/** task 模式跨 turn 工具记忆保持 summary 可见的最近 assistant turn 数. */
export function getTaskToolMemoryKeepRecentTurns(): number {
  return getPlatformConfig().contextCompression.toolMemoryKeepRecentTurns
}
/** 摘要目标体积(token),送 model 时告知压缩到约此体积. */
export const TARGET_COMPRESSION_TOKENS = 2000

// ─────────────────────────────────────────────────────────────────────────
// 任务压缩常量(子代理/助手 task 模式,design 06-20-agent-task-compression)
// 与 master 剧情压缩并列:压缩对象是整个上下文含工具调用+返回,多次压缩 + 时长兜底.
// ─────────────────────────────────────────────────────────────────────────

/** 任务型 agent(子代理/助手)默认无响应超时 ms.距离上一次活动(delta/tool/round-end)
 *  超过此阈值才超时,不是总时长.10 分钟给足多文件探索+总结+多次压缩空间. */
export const DEFAULT_TASK_INACTIVITY_TIMEOUT_MS = 600_000
/** 压缩无效早退阈值:压缩后 token 下降幅度 < 此比例 → 抛 TaskCompressionStalledError(不傻等超时烧钱). */
export const TASK_COMPRESSION_STALL_RATIO = 0.1

// ─────────────────────────────────────────────────────────────────────────
// Token 估算(复用 tool-token-budget 讨论结论:字符数*0.4 + UTF-8 字节数*0.25,
// 中文准确、英文保守高估,误差倒向早压缩安全侧.零依赖,模块级 hoisted encoder)
// ─────────────────────────────────────────────────────────────────────────

const utf8Encoder = new TextEncoder()

/** 将 content 安全转为文本(ContentPart[] 时提取 text part). token 估算/压缩 prompt 拼接用. */
function messageContentToText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

/** 粗略 token 估算(中英混合优化).不引入 tokenizer 依赖. */
export function estimateTokenCount(text: string): number {
  const charCount = text.length
  const byteCount = utf8Encoder.encode(text).length
  return Math.ceil(charCount * 0.4 + byteCount * 0.25)
}

/** 估算一组 AiChatMessage(text 循环)的 token 总量.tool observation 已被序列化进 user content,累加 content 即覆盖. */
export function estimateAiChatMessagesTokens(messages: AiChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(messageContentToText(msg.content)), 0)
}

/**
 * 估算一组 RuntimeChatMessage(native 工具循环)的 token 总量,含 toolCalls
 * 的 name + arguments(JSON 序列化计入)与 tool observation content.toolCallId
 * 短且重复,忽略保持简单.复用 estimateTokenCount,不引入 tokenizer 依赖.
 */
export function estimateRuntimeMessagesTokens(messages: RuntimeChatMessage[]): number {
  return messages.reduce((sum, msg) => {
    let tokens = estimateTokenCount(messageContentToText(msg.content))
    if (msg.role === "assistant" && msg.toolCalls) {
      for (const call of msg.toolCalls) {
        tokens += estimateTokenCount(call.name)
        tokens += estimateTokenCount(JSON.stringify(call.arguments))
      }
    }
    return sum + tokens
  }, 0)
}

/** 估算 context 快照(summary + recentTurns + top-level toolMemories)的 token 总量. */
export function estimateContextTokens(context: AgentContextSnapshot): number {
  const summaryTokens = context.summary ? estimateTokenCount(context.summary) : 0
  const recentTokens = context.recentTurns.reduce(
    (sum, entry) => sum + estimateTokenCount(entry.content),
    0,
  )
  const toolMemoryTokens = (context.toolMemories ?? []).reduce((sum, memory) => {
    const parts = [
      memory.title,
      memory.summary,
      ...(memory.anchors ?? []),
      memory.exact ? JSON.stringify(memory.exact) : "",
    ]
    return sum + estimateTokenCount(parts.join("\n"))
  }, 0)
  return summaryTokens + recentTokens + toolMemoryTokens
}

/**
 * 解析 token 预算:直接用 model 配置的 contextWindow(尊重用户花钱买的窗口能力),
 * 没配或非法时兜底 256k.不做 256k 封顶——85% 压缩阈值保证不会真顶到 provider 真实上限.
 */
export function resolveTokenBudget(
  modelContextWindow: number | null | undefined,
): number {
  if (typeof modelContextWindow === "number" && modelContextWindow > 0) {
    return modelContextWindow
  }
  return DEFAULT_CONTEXT_TOKEN_BUDGET
}

// ─────────────────────────────────────────────────────────────────────────
// 序列化 / 反序列化 / 初始化
// ─────────────────────────────────────────────────────────────────────────

/** 序列化快照为 context.json 内容. */
export function serializeAgentContext(snapshot: AgentContextSnapshot): string {
  return JSON.stringify(snapshot, null, 2)
}

/**
 * 解析 context.json 内容为快照.运行时边界 normalize:校验 schema/字段,
 * 缺字段时兜底(不抛错,保证旧/损坏文件不崩).
 *
 * `options.schema`/`options.agentId` 标记本次解析的快照类型(默认 master);
 * parse 时用 options 值而非硬编码,使助手快照(tsian.assistant.context.v2)能正确保留
 * schema/agentId.原文的 schema 字段不参与校验(向前兼容旧 schema 演进),由 options 决定.
 */
export function parseAgentContext(
  content: string,
  saveId: string,
  options?: { schema?: string; agentId?: string },
): AgentContextSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return createEmptyAgentContext(saveId, options)
  }
  if (!parsed || typeof parsed !== "object") {
    return createEmptyAgentContext(saveId, options)
  }
  const obj = parsed as Record<string, unknown>
  // schema 不匹配也兜底(向前兼容旧 schema 演进)
  const recentTurns = Array.isArray(obj.recentTurns)
    ? (obj.recentTurns as unknown[])
        .map(parseTurnEntry)
        .filter((e): e is AgentContextTurnEntry => e !== null)
    : []
  const toolMemories = Array.isArray(obj.toolMemories)
    ? (obj.toolMemories as unknown[])
        .map(parseToolMemoryEntry)
        .filter((memory): memory is AgentContextToolMemory => memory !== null)
    : []
  const storedSequence = typeof obj.sequence === "number" && Number.isSafeInteger(obj.sequence) && obj.sequence >= 0
    ? obj.sequence
    : typeof obj.turn === "number" && Number.isSafeInteger(obj.turn) && obj.turn >= 0
      ? obj.turn
      : 0
  const lastCompressedSequence = typeof obj.lastCompressedSequence === "number" && Number.isSafeInteger(obj.lastCompressedSequence) && obj.lastCompressedSequence >= 0
    ? obj.lastCompressedSequence
    : typeof obj.lastCompressedTurn === "number" && Number.isSafeInteger(obj.lastCompressedTurn) && obj.lastCompressedTurn >= 0
      ? obj.lastCompressedTurn
      : null
  return {
    schema: (options?.schema ?? AGENT_CONTEXT_SCHEMA) as AgentContextSnapshot["schema"],
    saveId,
    agentId: options?.agentId ?? AGENT_CONTEXT_AGENT_ID,
    sequence: Math.max(
      storedSequence,
      lastCompressedSequence ?? 0,
      recentTurns.reduce((max, entry) => Math.max(max, entry.sequence), 0),
      toolMemories.reduce((max, memory) => Math.max(max, memory.sequence), 0),
    ),
    summary: typeof obj.summary === "string" ? obj.summary : null,
    recentTurns,
    ...(toolMemories.length > 0 ? { toolMemories: sortToolMemoriesStable(toolMemories) } : {}),
    lastCompressedSequence,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date(0).toISOString(),
  }
}

function parseTurnEntry(raw: unknown): AgentContextTurnEntry | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const sequence = typeof obj.sequence === "number" ? obj.sequence : obj.turn
  if (
    typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0 ||
    (obj.role !== "user" && obj.role !== "assistant") ||
    typeof obj.content !== "string"
  ) {
    return null
  }
  // 旧 context.json 可能有 turn-level toolCalls；项目未上线,无需迁移,新结构直接忽略。
  return {
    sequence,
    ...(typeof obj.gameTurn === "number" && Number.isSafeInteger(obj.gameTurn) && obj.gameTurn >= 0
      ? { gameTurn: obj.gameTurn }
      : typeof obj.turn === "number" && Number.isSafeInteger(obj.turn) && obj.turn >= 0
        ? { gameTurn: obj.turn }
        : {}),
    role: obj.role,
    content: obj.content,
  }
}

/** 解析单个 model-facing AgentContextToolMemory(top-level). */
function parseToolMemoryEntry(raw: unknown): AgentContextToolMemory | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  const sequence = typeof obj.sequence === "number" ? obj.sequence : obj.turn
  if (
    typeof obj.id !== "string" ||
    typeof obj.sourceToolCallId !== "string" ||
    typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 0 ||
    typeof obj.toolName !== "string" ||
    (obj.status !== "success" && obj.status !== "failed") ||
    typeof obj.title !== "string" ||
    (typeof obj.summary !== "string" && typeof obj.summaryText !== "string")
  ) {
    return null
  }
  const anchors = Array.isArray(obj.anchors)
    ? obj.anchors.filter((anchor): anchor is string => typeof anchor === "string")
    : undefined
  return {
    id: obj.id,
    sourceToolCallId: obj.sourceToolCallId,
    key: typeof obj.key === "string" && obj.key.trim() ? obj.key : obj.id,
    sequence,
    ...(typeof obj.gameTurn === "number" && Number.isSafeInteger(obj.gameTurn) && obj.gameTurn >= 0
      ? { gameTurn: obj.gameTurn }
      : typeof obj.turn === "number" && Number.isSafeInteger(obj.turn) && obj.turn >= 0
        ? { gameTurn: obj.turn }
        : {}),
    ...(typeof obj.round === "number" ? { round: obj.round } : {}),
    toolName: obj.toolName,
    status: obj.status,
    title: obj.title,
    summary: typeof obj.summary === "string" ? obj.summary : obj.summaryText as string,
    ...(anchors && anchors.length > 0 ? { anchors } : {}),
    ...(isJsonRecord(obj.exact) ? { exact: obj.exact } : {}),
    ...(Array.isArray(obj.resolves)
      ? { resolves: obj.resolves.filter((value): value is string => typeof value === "string") }
      : {}),
    ...(typeof obj.tokenEstimate === "number" ? { tokenEstimate: obj.tokenEstimate } : {}),
  }
}

function isJsonValue(value: unknown): value is import("@tsian/contracts").JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return typeof value === "object" && value !== null
    && Object.values(value as Record<string, unknown>).every(isJsonValue)
}

function isJsonRecord(value: unknown): value is Record<string, import("@tsian/contracts").JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every(isJsonValue)
}

/** 创建空快照(无历史,首次或损坏时). */
export function createEmptyAgentContext(
  saveId: string,
  options?: { schema?: string; agentId?: string },
): AgentContextSnapshot {
  return {
    schema: (options?.schema ?? AGENT_CONTEXT_SCHEMA) as AgentContextSnapshot["schema"],
    saveId,
    agentId: options?.agentId ?? AGENT_CONTEXT_AGENT_ID,
    sequence: 0,
    summary: null,
    recentTurns: [],
    lastCompressedSequence: null,
    updatedAt: new Date(0).toISOString(),
  }
}

/**
 * 从 turn 文件(玩家剧情正文存档)最近 K 轮初始化快照.
 * 用于旧存档首次跑新代码时 context.json 不存在的兜底(design §3.1).
 * ConversationMessageRecord.role 是 string,这里只接受 "user"/"assistant" 的剧情正文.
 *
 * `options.schema`/`options.agentId` 标记快照类型(默认 master);助手用
 * ASSISTANT_CONTEXT_SCHEMA/ASSISTANT_CONTEXT_AGENT_ID 初始化.
 */
export function createInitialAgentContext(
  saveId: string,
  recentHistory: ConversationMessageRecord[],
  currentTurn: number,
  options?: { schema?: string; agentId?: string },
): AgentContextSnapshot {
  const recent = recentHistory.slice(-getContextKeepRecentTurns() * 2) // 每轮 user+assistant 两条
  const recentTurns: AgentContextTurnEntry[] = []
  // 历史记录无 turn 索引,用 currentTurn 倒推:最后一条 = currentTurn-1 轮的 assistant
  // (currentTurn 是即将开始的轮,历史最后一条是上一轮结束时的 assistant).
  const baseTurn = currentTurn - Math.ceil(recent.length / 2)
  let turnCursor = baseTurn
  let sequence = 0
  let pendingUser: string | null = null
  for (const record of recent) {
    if (record.role === "user") {
      pendingUser = record.content
    } else if (record.role === "assistant") {
      sequence += 1
      if (pendingUser !== null) {
        recentTurns.push({ sequence, gameTurn: turnCursor, role: "user", content: pendingUser })
        pendingUser = null
      }
      recentTurns.push({ sequence, gameTurn: turnCursor, role: "assistant", content: record.content })
      turnCursor += 1
    }
  }
  return {
    schema: (options?.schema ?? AGENT_CONTEXT_SCHEMA) as AgentContextSnapshot["schema"],
    saveId,
    agentId: options?.agentId ?? AGENT_CONTEXT_AGENT_ID,
    sequence,
    summary: null,
    recentTurns,
    lastCompressedSequence: null,
    updatedAt: new Date().toISOString(),
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 压缩
// ─────────────────────────────────────────────────────────────────────────

/** 压缩调用需要的精简 model 接口(避免循环依赖 index.ts 的完整 capabilities). */
export type CompressCallModel = (
  messages: AiChatMessage[],
  options: CompressCallOptions,
) => Promise<string>

/** 压缩调用的精简 options(从 index.ts 的 callOptions 取需要的字段). */
export interface CompressCallOptions {
  debugLabel: RuntimeTraceDebugLabel
  signal?: AbortSignal
  agentId?: string
  traceContext?: AiTraceOperationContext
  /**
   * 可选:覆盖默认压缩 system prompt(叙事梗概).助手快照压缩传
   * ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT(任务摘要风格);master 不传用默认.
   * design 06-20-assistant-context-persistence §2.2.
   */
  systemPrompt?: string
  /** Fixed continuation contract selected by the owning call chain. */
  compressionKind?: CompressionKind
  /** 可选:user 轮次的角色标签(默认"玩家",助手传"用户"). */
  userLabel?: string
  /** 可选:assistant 轮次的角色标签(默认"叙事",助手传"助手"). */
  assistantLabel?: string
}

/** 压缩失败错误:温和文案,经 AssistantView catch else 分支显示. */
export class ContextCompressionFailedError extends Error {
  constructor() {
    super(
      "上下文压缩失败，无法继续本轮。请重试；若持续失败，请检查 Agent 模型配置或开始新会话。",
    )
    this.name = "ContextCompressionFailedError"
  }
}

/** turn 内第二次达预算(压缩已用过一次)兜底:上下文已满.经 AssistantView catch 与 abort 对称处理(非失败的中止). */
export class ContextBudgetExhaustedError extends Error {
  constructor() {
    super("上下文已满，无法继续本轮探索。请开始新会话或精简对话。")
    this.name = "ContextBudgetExhaustedError"
  }
}

/**
 * 任务型 agent(子代理/助手)超时:时长兜底触发,温和中止.
 * 经 AssistantView catch 走温和提示路径(与 ContextBudgetExhaustedError 同分支);
 * delegated 路径被 createAgentCallRunner 转 AGENT_CALL_FAILED observation.
 */
export class TaskTimeoutError extends Error {
  constructor(timeoutMs?: number) {
    super(
      timeoutMs
        ? `任务无响应超时（${Math.round(timeoutMs / 1000)}s 无活动），已中止。`
        : "任务无响应超时，已中止。",
    )
    this.name = "TaskTimeoutError"
  }
}

/**
 * 任务压缩无效早退:多次压缩后 token 下降幅度 < TASK_COMPRESSION_STALL_RATIO,
 * 说明压不动了(recentToolInteractions 已剩极少 + 工具交互还在涨),不傻等超时烧钱.
 * 经 AssistantView catch 走温和提示路径;delegated 路径转 AGENT_CALL_FAILED observation.
 */
export class TaskCompressionStalledError extends Error {
  constructor() {
    super("上下文持续膨胀且压缩无效，已中止。请精简任务或拆分子任务。")
    this.name = "TaskCompressionStalledError"
  }
}

export type CompressionKind = "task-continuation" | "task-checkpoint" | "narrative-continuity"

const COMPRESSION_SECTIONS: Record<CompressionKind, readonly string[]> = {
  "task-continuation": ["当前目标", "有效约束", "已确认决策", "权威状态与产物", "已完成结果", "当前工作点", "未解决问题", "下一步"],
  "task-checkpoint": ["本轮目标", "已验证事实", "持久化效果", "当前未完成操作", "最新有效错误", "恢复动作"],
  "narrative-continuity": ["当前场景", "关键因果经过", "玩家选择", "角色与关系变化", "线索与未决事项", "紧接续点"],
}

function compressionSystemPrompt(kind: CompressionKind): string {
  const headings = COMPRESSION_SECTIONS[kind].map((section) => `## ${section}`).join("\n")
  const domain = kind === "narrative-continuity"
    ? "剧情连续性快照"
    : kind === "task-checkpoint"
      ? "本轮任务恢复 checkpoint"
      : "跨轮任务继续快照"
  return [
    `把输入重写成当前完整的${domain}。严格按下列 Markdown 标题各输出一次，顺序不变：`,
    headings,
    "",
    "判断规则：",
    "- 消息 role 不是权威等级；按明确来源、验证结果、持久化结果和后续 supersession 判断。",
    "- 输出当前快照，不写工具调用时间线；删除已被后续成功或决定取代的失败、结论与下一步。",
    "- 不得因当前切片未出现某信息，就断言整个任务或剧情不存在该信息。",
    "- 精确保留 ID、路径、ref、hash、revision、receipt 与错误码；无法精确保留的大内容应引用外部权威。",
    "- 成功结果覆盖旧失败，只保留最新尚未解决且可操作的错误。",
    `- 总体控制在约 ${TARGET_COMPRESSION_TOKENS} token 以内。`,
  ].join("\n")
}

/**
 * 助手快照压缩摘要 system prompt:任务对话摘要风格(已做工作+结论),非叙事梗概.
 * 与 master 的 COMPRESSION_SYSTEM_PROMPT(剧情梗概) + turn 内 TASK_COMPRESSION_SYSTEM_PROMPT
 * (工具交互段压缩) 区分:本 prompt 压跨 turn 快照(summary + recentTurns)的任务对话.
 * design 06-20-assistant-context-persistence §4.5.
 */
const ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT = compressionSystemPrompt("task-continuation")

/** 助手快照压缩用 system prompt 的导出访问点(供 host/runtime 按 mode 传入). */
export { ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT }

export function validateCompressionSummary(kind: CompressionKind, summary: string): string[] {
  const trimmed = summary.trim()
  if (!trimmed) return ["summary is empty"]
  const headingMatches = Array.from(trimmed.matchAll(/^##\s+(.+?)\s*$/gm))
  const headings = headingMatches.map((match) => match[1]?.trim() ?? "")
  const expected = [...COMPRESSION_SECTIONS[kind]]
  const errors: string[] = []
  if (headingMatches[0]?.index !== 0) errors.push(`summary must start with ## ${expected[0]}`)
  if (headings.length !== expected.length) {
    errors.push(`expected ${expected.length} sections, received ${headings.length}`)
  }
  expected.forEach((section, index) => {
    if (headings[index] !== section) errors.push(`section ${index + 1} must be ## ${section}`)
    const heading = headingMatches[index]
    if (!heading || headings[index] !== section) return
    const bodyStart = (heading.index ?? 0) + heading[0].length
    const bodyEnd = headingMatches[index + 1]?.index ?? trimmed.length
    if (!trimmed.slice(bodyStart, bodyEnd).trim()) errors.push(`section ## ${section} must not be empty`)
  })
  if (estimateTokenCount(trimmed) > TARGET_COMPRESSION_TOKENS * 2) {
    errors.push("summary exceeds the bounded continuation contract")
  }
  return errors
}

async function callCompressionWithRepair(
  kind: CompressionKind,
  prompt: string,
  callModel: CompressCallModel,
  options: CompressCallOptions,
): Promise<string> {
  const systemPrompt = options.systemPrompt ?? compressionSystemPrompt(kind)
  let output: string
  try {
    output = await callModel([
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ], options)
  } catch {
    throw new ContextCompressionFailedError()
  }
  let errors = validateCompressionSummary(kind, output)
  if (errors.length === 0) return output.trim()
  try {
    output = await callModel([
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
      { role: "assistant", content: output },
      {
        role: "user",
        content: `上面的快照不符合固定结构：\n- ${errors.join("\n- ")}\n请只输出修复后的完整快照。`,
      },
    ], options)
  } catch {
    throw new ContextCompressionFailedError()
  }
  errors = validateCompressionSummary(kind, output)
  if (errors.length > 0) throw new ContextCompressionFailedError()
  return output.trim()
}

const COMPRESSION_TOOL_MEMORY_PREVIEW_LIMIT = 1_200

function previewCompressionToolText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`
}

function formatCompressionToolMemory(memory: AgentContextToolMemory): string {
  const summary = previewCompressionToolText(memory.summary, COMPRESSION_TOOL_MEMORY_PREVIEW_LIMIT)
  const anchors = memory.anchors && memory.anchors.length > 0
    ? ` anchors=${memory.anchors.join(", ")}`
    : ""
  const exact = memory.exact ? ` exact=${JSON.stringify(memory.exact)}` : ""
  return `  工具记忆 ${memory.title} [${memory.toolName}/${memory.status}]${anchors}${exact} → ${summary}`
}

/** 构建压缩调用的 user prompt:旧 summary(若有) + 被压缩轮次正文 + 相关工具记忆.
 *  工具记忆来自 top-level toolMemories,只给受预算投影/占位符,不再给 raw observation. */
function buildCompressionPrompt(
  oldSummary: string | null,
  compressEntries: AgentContextTurnEntry[],
  toolMemories: AgentContextToolMemory[] = [],
  userLabel = "玩家",
  assistantLabel = "叙事",
): string {
  const memoriesBySequence = new Map<number, AgentContextToolMemory[]>()
  for (const memory of sortToolMemoriesStable(toolMemories)) {
    const list = memoriesBySequence.get(memory.sequence) ?? []
    list.push(memory)
    memoriesBySequence.set(memory.sequence, list)
  }
  return [
    oldSummary ? `此前的梗概：\n${oldSummary}\n` : "",
    "需要压缩的剧情正文：",
    ...compressEntries.map((entry) => {
      const label = entry.role === "user" ? userLabel : assistantLabel
      const base = `${entry.sequence}${entry.gameTurn !== undefined ? ` (gameTurn=${entry.gameTurn})` : ""}. ${label}: ${entry.content}`
      if (entry.role === "assistant") {
        const toolLines = memoriesBySequence.get(entry.sequence)?.map(formatCompressionToolMemory).join("\n")
        if (toolLines) return `${base}\n${toolLines}`
      }
      return base
    }),
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * 压缩上下文:保留最近 K 轮原文,被压缩轮次 + 旧 summary 调 model 生成摘要.
 * 稳态循环:下次压缩时旧 summary 被二次浓缩,越早的细节自然淡出.
 * callModel 失败 → throw ContextCompressionFailedError(温和兜底,不强行用爆满上下文).
 *
 * `options.systemPrompt` 覆盖默认叙事梗概 prompt(助手传任务摘要 prompt);
 * `options.userLabel`/`options.assistantLabel` 覆盖默认"玩家"/"叙事"标签(助手传"用户"/"助手").
 * master 不传这些字段 → 用默认值,行为不变(design 06-20-assistant-context-persistence §2.2).
 */
export async function compressContext(
  context: AgentContextSnapshot,
  threshold: number,
  callModel: CompressCallModel,
  options: CompressCallOptions,
): Promise<AgentContextSnapshot> {
  // 1. 保留最近 keepRecentTurns 个 context sequence 的全部 entry.
  const keepRecentTurns = getContextKeepRecentTurns()
  const sequenceNumbers = uniqueSortedSequences(context.recentTurns)
  const keepSequences = new Set(sequenceNumbers.slice(-keepRecentTurns))
  const keepEntries = context.recentTurns.filter((entry) => keepSequences.has(entry.sequence))
  const compressEntries = context.recentTurns.filter(
    (entry) => !keepSequences.has(entry.sequence),
  )

  // 无可压缩内容(消息少于 K 轮)→ 原样返回(由调用方判断是否抛 budget 错)
  if (compressEntries.length === 0) {
    return context
  }

  // 2. 被压缩轮次 + 旧 summary 一起送 model 生成摘要
  const kind = options.compressionKind
    ?? (options.systemPrompt === ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT ? "task-continuation" : "narrative-continuity")
  const compressedSequences = new Set(compressEntries.map((entry) => entry.sequence))
  const compressionToolMemories = (context.toolMemories ?? []).filter((memory) => compressedSequences.has(memory.sequence))
  const prompt = buildCompressionPrompt(
    context.summary,
    compressEntries,
    compressionToolMemories,
    options.userLabel,
    options.assistantLabel,
  )
  const trimmedSummary = await callCompressionWithRepair(kind, prompt, callModel, options)

  const maxCompressedSequence = compressEntries.reduce(
    (max, entry) => Math.max(max, entry.sequence),
    context.lastCompressedSequence ?? 0,
  )

  const remainingToolMemories = (context.toolMemories ?? []).filter(
    (memory) => memory.sequence > maxCompressedSequence,
  )
  const contextWithoutToolMemories = Object.fromEntries(
    Object.entries(context).filter(([key]) => key !== "toolMemories"),
  ) as Omit<AgentContextSnapshot, "toolMemories">

  return {
    ...contextWithoutToolMemories,
    summary: trimmedSummary,
    recentTurns: keepEntries,
    ...(remainingToolMemories.length > 0 ? { toolMemories: remainingToolMemories } : {}),
    lastCompressedSequence: maxCompressedSequence,
    updatedAt: new Date().toISOString(),
  }
}

function uniqueSortedSequences(entries: AgentContextTurnEntry[]): number[] {
  const set = new Set(entries.map((entry) => entry.sequence))
  return Array.from(set).sort((a, b) => a - b)
}

// ─────────────────────────────────────────────────────────────────────────
// 任务压缩(子代理/助手 task 模式,design 06-20-agent-task-compression)
// 与 master 剧情压缩(compressContext)并列:压缩对象是按协议边界识别的完整工具轮,
// 把早期轮次摘要成"已完成工作"user message,保留最近 N 轮.
// 不依赖 AgentContextSnapshot(任务型 agent 无跨 turn 快照),摘要文本随 messages 在
// turn 内存在,turn 结束即弃(不落盘——助手跨 turn 持久化是后续独立任务).
// ─────────────────────────────────────────────────────────────────────────

/** 任务压缩摘要 system prompt:任务日志风格(已做工作+结论),非叙事梗概. */
const TASK_COMPRESSION_SYSTEM_PROMPT = compressionSystemPrompt("task-checkpoint")

/** 任务压缩可处理的 message 形态(native RuntimeChatMessage 与 text AiChatMessage 的公共结构).
 *  content 放宽为 string | ContentPart[] 以兼容 text execution report 携带的图片. */
interface TaskCompressionMessage {
  role: string
  content: string | ContentPart[]
  toolCalls?: unknown[]
}

interface TaskCompressionCall {
  name: string
  arguments: Record<string, unknown>
  status: "success" | "failed" | "unknown"
}

interface TaskInteractionGroup<T extends TaskCompressionMessage> {
  messages: T[]
  calls: TaskCompressionCall[]
}

/** 任务压缩结果:新 messages + 是否压动 + 摘要文本(供下次压缩作为 oldSummary). */
export interface TaskCompressionResult<T extends TaskCompressionMessage> {
  messages: T[]
  compressed: boolean
  summary: string | null
}

/**
 * 构建任务压缩 user prompt:旧摘要(若有,前次压缩产出) + 被压缩早期工具交互.
 * interactionEntries 已是早期段(保留段之外),按原顺序呈现完整 runtime 工具轮.
 */
function buildTaskCompressionPrompt(
  oldSummary: string | null,
  interactionEntries: TaskCompressionMessage[],
): string {
  return [
    oldSummary ? `此前的工作摘要：\n${oldSummary}\n` : "",
    "需要压缩的早期 runtime 工具交互：",
    ...interactionEntries.map((entry, index) => {
      const toolName = extractToolNameFromMessage(entry)
      const tag = toolName ? `[${entry.role}:${toolName}]` : `[${entry.role}]`
      const structuredCalls = entry.role === "assistant" && Array.isArray(entry.toolCalls) && entry.toolCalls.length > 0
        ? `\nstructuredToolCalls=${JSON.stringify(entry.toolCalls)}`
        : ""
      return `${index + 1}. ${tag} ${messageContentToText(entry.content)}${structuredCalls}`
    }),
  ]
    .filter(Boolean)
    .join("\n")
}

/** 从 message 提取工具名(若有):native assistant.toolCalls[0].name 或 Text Tool Protocol v2 执行报告.无则 undefined. */
function extractToolNameFromMessage(message: TaskCompressionMessage): string | undefined {
  // native: assistant 带 toolCalls,取首个调用名(一轮通常一个工具调用)
  if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    const first = message.toolCalls[0] as { name?: string } | undefined
    if (first && typeof first.name === "string") {
      return first.name
    }
  }
  // text: Text Tool Protocol v2 executed-tools/observations report.
  const textToolName = extractTextToolNameFromMessage(message)
  if (textToolName) return textToolName
  return undefined
}

function taskRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseTaggedArray(text: string, tag: string): unknown[] | undefined {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`<${escapedTag}>\\s*([\\s\\S]*?)\\s*</${escapedTag}>`).exec(text)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(match[1] ?? "")
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function nativeObservationFailed(content: string | ContentPart[]): boolean {
  const text = messageContentToText(content)
  try {
    const parsed = JSON.parse(text)
    return taskRecord(parsed)
      && typeof parsed.code === "string"
      && typeof parsed.message === "string"
      && !("status" in parsed)
  } catch {
    return false
  }
}

function taskCallKey(call: Pick<TaskCompressionCall, "name" | "arguments">): string {
  const args = call.arguments
  if (["write", "edit", "delete"].includes(call.name)) {
    return `workspace:${typeof args.path === "string" ? args.path : call.name}`
  }
  if (call.name === "copy" || call.name === "move") {
    const target = typeof args.targetPath === "string"
      ? args.targetPath
      : typeof args.path === "string"
        ? args.path
        : call.name
    return `workspace:${target}`
  }
  if (call.name === "run_script") {
    return `action:${typeof args.skill === "string" ? args.skill : "skill"}/${typeof args.script === "string" ? args.script : "script"}`
  }
  if (call.name === "agent_call") {
    return `agent_call:${typeof args.agentId === "string" ? args.agentId : "agent"}`
  }
  const anchor = [args.path, args.id, args.ref]
    .find((value): value is string => typeof value === "string" && Boolean(value.trim()))
  return `${call.name}:${anchor ?? call.name}`
}

function nativeTaskGroup<T extends TaskCompressionMessage>(
  messages: T[],
  start: number,
): { group: TaskInteractionGroup<T>; next: number } | null {
  const assistant = messages[start]
  if (assistant?.role !== "assistant" || !Array.isArray(assistant.toolCalls) || assistant.toolCalls.length === 0) return null
  const rawCalls = assistant.toolCalls.filter(taskRecord)
  const toolMessages: T[] = []
  let next = start + 1
  while (next < messages.length && messages[next]?.role === "tool") {
    toolMessages.push(messages[next]!)
    next += 1
  }
  const observationsById = new Map<string, T>()
  for (const message of toolMessages) {
    const id = taskRecord(message) && typeof message.toolCallId === "string" ? message.toolCallId : undefined
    if (id) observationsById.set(id, message)
  }
  const calls = rawCalls.map((raw, index): TaskCompressionCall => {
    const id = typeof raw.id === "string" ? raw.id : undefined
    const observation = id ? observationsById.get(id) : toolMessages[index]
    return {
      name: typeof raw.name === "string" ? raw.name : "unknown",
      arguments: taskRecord(raw.arguments) ? raw.arguments : {},
      status: observation ? (nativeObservationFailed(observation.content) ? "failed" : "success") : "unknown",
    }
  })
  return { group: { messages: [assistant, ...toolMessages], calls }, next }
}

function textTaskGroup<T extends TaskCompressionMessage>(
  messages: T[],
  start: number,
): { group: TaskInteractionGroup<T>; next: number } | null {
  const report = messages[start]
  if (!report) return null
  const reportText = messageContentToText(report.content)
  const records = parseTaggedArray(reportText, TEXT_TOOL_EXECUTED_TOOLS_TAG)
  const observations = parseTaggedArray(reportText, TEXT_TOOL_OBSERVATIONS_TAG)
  if (!records?.length || !observations) return null
  const observationsById = new Map<string, Record<string, unknown>>()
  for (const raw of observations) {
    if (taskRecord(raw) && typeof raw.id === "string") observationsById.set(raw.id, raw)
  }
  const calls = records.filter(taskRecord).map((raw): TaskCompressionCall => {
    const observation = typeof raw.id === "string" ? observationsById.get(raw.id) : undefined
    return {
      name: typeof raw.name === "string" ? raw.name : "unknown",
      arguments: taskRecord(raw.arguments) ? raw.arguments : {},
      status: observation ? (observation.ok === true ? "success" : "failed") : "unknown",
    }
  })
  return {
    group: {
      messages: [report],
      calls,
    },
    next: start + 1,
  }
}

function groupTaskInteractions<T extends TaskCompressionMessage>(messages: T[]): TaskInteractionGroup<T>[] {
  const groups: TaskInteractionGroup<T>[] = []
  let index = 0
  while (index < messages.length) {
    const parsed = nativeTaskGroup(messages, index) ?? textTaskGroup(messages, index)
    if (parsed) {
      groups.push(parsed.group)
      index = parsed.next
      continue
    }
    groups.push({ messages: [messages[index]!], calls: [] })
    index += 1
  }
  return groups
}

function pinnedTaskGroupIndexes(groups: readonly TaskInteractionGroup<TaskCompressionMessage>[]): Set<number> {
  const unresolved = new Map<string, number>()
  groups.forEach((group, groupIndex) => {
    for (const call of group.calls) {
      const key = taskCallKey(call)
      if (call.status === "success") unresolved.delete(key)
      else unresolved.set(key, groupIndex)
    }
  })
  return new Set(unresolved.values())
}

/**
 * 任务压缩:把工具交互段的早期轮次摘要成 1 条 user message,保留最近 N 轮原文.
 *
 * 入参 messages 的工具交互段由调用方用 locateTaskInteractionSpan 定位为 [start, end).
 * 本函数:① 切出工具交互段 ② 按协议分组并保留最近 taskKeepRecentRounds 轮
 *    (native 并行轮和 text 单条执行报告都保持原子性) ③ 早期段送
 *    model 生成任务摘要 ④ 拼新 messages = [...框架段, {user:已完成工作摘要},
 *    ...未解决原始轮, ...最近N轮].
 *
 * 无可压缩早期内容(早期段为空,即工具交互 ≤ N 轮)→ 返回 { compressed: false },
 *   调用方据此走兜底(有 lastRoundText 返回 / 无抛 ContextBudgetExhaustedError).
 * callModel 失败或空摘要 → throw ContextCompressionFailedError(复用,与剧情压缩同语义).
 *
 * 泛型 T 兼容 RuntimeChatMessage[] 与 AiChatMessage[](两者都满足 TaskCompressionMessage 结构),
 * 返回类型与入参一致.压缩产出的摘要 user message 用 { role: "user", content } 形态——
 * native 循环调用方需保证入参是 RuntimeChatMessage[](摘要 message 也满足该联合类型).
 */
export async function compressTaskContext<T extends TaskCompressionMessage>(
  messages: T[],
  interactionSpan: { start: number; end: number },
  oldSummary: string | null,
  callModel: CompressCallModel,
  options: CompressCallOptions,
): Promise<TaskCompressionResult<T>> {
  const { start, end } = interactionSpan
  if (start < 0 || end <= start) {
    return { messages, compressed: false, summary: oldSummary }
  }

  // 1. Group complete tool rounds atomically. A native round may contain
  // multiple parallel calls and therefore more than two messages.
  const interaction = messages.slice(start, end)
  const groups = groupTaskInteractions(interaction)
  const recentStart = Math.max(0, groups.length - getTaskKeepRecentRounds())
  const pinnedIndexes = pinnedTaskGroupIndexes(groups)
  const earlyEntries = groups
    .slice(0, recentStart)
    .filter((_group, index) => !pinnedIndexes.has(index))
    .flatMap((group) => group.messages)
  const pinnedEntries = groups
    .slice(0, recentStart)
    .filter((_group, index) => pinnedIndexes.has(index))
    .flatMap((group) => group.messages)
  const recentEntries = groups.slice(recentStart).flatMap((group) => group.messages)

  // 无可压缩早期内容 → 未压动(调用方走兜底)
  if (earlyEntries.length === 0) {
    return { messages, compressed: false, summary: oldSummary }
  }

  // 2. 早期段 + 旧摘要送 model 生成任务摘要
  const prompt = buildTaskCompressionPrompt(oldSummary, earlyEntries)
  const trimmedSummary = await callCompressionWithRepair(
    "task-checkpoint",
    prompt,
    callModel,
    { ...options, systemPrompt: TASK_COMPRESSION_SYSTEM_PROMPT },
  )

  // 3. 拼新 messages:框架段[0,start) + 摘要 user + 未解决原始轮 + 最近 N 轮.
  // 摘要可能保留陈旧错误；后置的原始失败轮必须在消息顺序上覆盖它.
  // 摘要 message 是 {role:"user",content} 形态——满足 RuntimeChatMessage(user 变体)
  // 与 AiChatMessage 的公共结构.用 as unknown as T 打断泛型推断循环(T 是联合类型时
  // as T 会触发 result 类型隐式 any).
  const summaryMessage = { role: "user", content: `任务恢复 checkpoint：\n${trimmedSummary}` } as unknown as T
  const newMessages: T[] = [
    ...messages.slice(0, start),
    summaryMessage,
    ...pinnedEntries,
    ...recentEntries,
  ]

  return { messages: newMessages, compressed: true, summary: trimmedSummary }
}

// ─────────────────────────────────────────────────────────────────────────
// turn 追加(R4 用:turn 收尾把本轮正文追加进 recentTurns)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 把本轮 user+assistant 正文追加进快照 recentTurns.**只追加,不丢早期轮次**
 * ——早期轮次的丢弃交给 compressContext(压缩时摘要进 summary,保留最近 K 轮).
 *
 * 不在此做滑动窗口截断:滑动窗口会在压缩触发前就丢弃早期正文,导致
 * ① 早期剧情在未压缩前永久丢失(不进 summary) ② compressContext 时
 * recentTurns 只剩最近 K 轮、无可压缩的早期轮次,压缩机制空转失效.
 * 正确的稳态是"累积到阈值 → 压缩一次性摘要早期 + 保留最近K轮",appendTurn
 * 只负责累积,compressContext 只负责压缩丢弃,职责分明.
 *
 * 前缀缓存收益(顺带):recentTurns 在两次压缩之间只增不减、前缀稳定,
 * 消息序列里 recentTurns 段的前缀能命中 provider 前缀缓存.
 */
export function appendTurnToContext(
  context: AgentContextSnapshot,
  sequence: number,
  user: string,
  assistant: string,
  gameTurn?: number,
): AgentContextSnapshot {
  return {
    ...context,
    sequence: Math.max(context.sequence, sequence),
    recentTurns: [
      ...context.recentTurns,
      { sequence, ...(gameTurn !== undefined ? { gameTurn } : {}), role: "user", content: user },
      { sequence, ...(gameTurn !== undefined ? { gameTurn } : {}), role: "assistant", content: assistant },
    ],
    updatedAt: new Date().toISOString(),
  }
}
