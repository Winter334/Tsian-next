import type {
  AgentContextSnapshot,
  AgentContextTurnEntry,
  ConversationMessageRecord,
  AiChatMessage,
  ContentPart,
} from "@tsian/contracts"
import type { RuntimeChatMessage } from "../runtime-host/ai"
import type { RuntimeTraceDebugLabel } from "./trace"

/**
 * master agent 会话上下文生命周期与压缩持久化.
 *
 * 与玩家剧情正文存档(`saveHistory`)分离:这里管的是 master agent 视角的
 * "1 摘要 + 最近 K 轮正文"稳态,持久化到工作区 `save/agents/master/context.json`,
 * 跨 turn/跨加载保持上下文不膨胀不失忆.详见任务
 * `06-19-agent-session-context-lifecycle` 的 design.md.
 */

/** context.json 在工作区的路径(save-runtime 根下,必须以 save/ 开头才能通过
 *  assertOrdinarySaveRuntimeMutationPath 校验).历史值曾误为 "agents/master/context.json",
 *  缺 save/ 前缀,导致 turn 收尾 stageAgentContextFile 写入被
 *  WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED 拦截、整个 turn 回滚、正文不落库
 *  (加载存档后对话记录"消失"的根因). */
export const AGENT_CONTEXT_PATH = "save/agents/master/context.json"
/** context.json 的 schema 标记,用于 parse 时校验. */
export const AGENT_CONTEXT_SCHEMA = "tsian.agent.context.v1"
/** master agent 固定 id(context.json 只服务 master). */
export const AGENT_CONTEXT_AGENT_ID = "master" as const

// ─────────────────────────────────────────────────────────────────────────
// 助手 context 快照常量(design 06-20-assistant-context-persistence)
// 与 master 常量并列:助手 context 存虚拟文件 .tsian/local/assistant/sessions/<id>/context.json,
// schema/agentId 与 master 区分(语义分明),复用 AgentContextSnapshot 类型.
// ─────────────────────────────────────────────────────────────────────────

/** 助手 context 快照 schema 标记(与 master 的 tsian.agent.context.v1 区分,语义分明). */
export const ASSISTANT_CONTEXT_SCHEMA = "tsian.assistant.context.v1" as const
/** 助手 agent 固定 id. */
export const ASSISTANT_CONTEXT_AGENT_ID = "assistant" as const

/** 默认 token 预算:model 未配 contextWindow 时兜底. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000
/** 压缩触发阈值比例:85% budget 触发压缩(留 15% 余量吸收估算偏差). */
export const CONTEXT_COMPRESS_TRIGGER_RATIO = 0.85
/** 压缩时保留最近几轮正文(原文不压缩). */
export const CONTEXT_KEEP_RECENT_TURNS = 5
/** 摘要目标体积(token),送 model 时告知压缩到约此体积. */
export const TARGET_COMPRESSION_TOKENS = 2000

// ─────────────────────────────────────────────────────────────────────────
// 任务压缩常量(子代理/助手 task 模式,design 06-20-agent-task-compression)
// 与 master 剧情压缩并列:压缩对象是整个上下文含工具调用+返回,多次压缩 + 时长兜底.
// ─────────────────────────────────────────────────────────────────────────

/** 任务型 agent(子代理/助手)默认时长配额 ms.超时抛 TaskTimeoutError.5 分钟给足多文件探索+总结+多次压缩空间. */
export const DEFAULT_TASK_TIMEOUT_MS = 300_000
/** 任务压缩保留最近 N 轮 tool 交互(assistant+tool 成对,原文不压).N=5 覆盖最近探索链+当前步骤+上下游关联. */
export const TASK_KEEP_RECENT_TOOL_ROUNDS = 5
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
    return sum
  }, 0)
}

/** 估算 context 快照(summary + recentTurns)的 token 总量. */
export function estimateContextTokens(context: AgentContextSnapshot): number {
  const summaryTokens = context.summary ? estimateTokenCount(context.summary) : 0
  const recentTokens = context.recentTurns.reduce(
    (sum, entry) => sum + estimateTokenCount(entry.content),
    0,
  )
  return summaryTokens + recentTokens
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
 * parse 时用 options 值而非硬编码,使助手快照(tsian.assistant.context.v1)能正确保留
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
  return {
    schema: (options?.schema ?? AGENT_CONTEXT_SCHEMA) as AgentContextSnapshot["schema"],
    saveId,
    agentId: options?.agentId ?? AGENT_CONTEXT_AGENT_ID,
    summary: typeof obj.summary === "string" ? obj.summary : null,
    recentTurns,
    lastCompressedTurn:
      typeof obj.lastCompressedTurn === "number" ? obj.lastCompressedTurn : null,
    updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : new Date(0).toISOString(),
  }
}

function parseTurnEntry(raw: unknown): AgentContextTurnEntry | null {
  if (!raw || typeof raw !== "object") return null
  const obj = raw as Record<string, unknown>
  if (
    typeof obj.turn !== "number" ||
    (obj.role !== "user" && obj.role !== "assistant") ||
    typeof obj.content !== "string"
  ) {
    return null
  }
  return {
    turn: obj.turn,
    role: obj.role,
    content: obj.content,
  }
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
    summary: null,
    recentTurns: [],
    lastCompressedTurn: null,
    updatedAt: new Date(0).toISOString(),
  }
}

/**
 * 从 saveHistory(玩家剧情正文存档)最近 K 轮初始化快照.
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
  const recent = recentHistory.slice(-CONTEXT_KEEP_RECENT_TURNS * 2) // 每轮 user+assistant 两条
  const recentTurns: AgentContextTurnEntry[] = []
  // 历史记录无 turn 索引,用 currentTurn 倒推:最后一条 = currentTurn-1 轮的 assistant
  // (currentTurn 是即将开始的轮,历史最后一条是上一轮结束时的 assistant).
  const baseTurn = currentTurn - Math.ceil(recent.length / 2)
  let turnCursor = baseTurn
  let pendingUser: string | null = null
  for (const record of recent) {
    if (record.role === "user") {
      pendingUser = record.content
    } else if (record.role === "assistant") {
      if (pendingUser !== null) {
        recentTurns.push({ turn: turnCursor, role: "user", content: pendingUser })
        pendingUser = null
      }
      recentTurns.push({ turn: turnCursor, role: "assistant", content: record.content })
      turnCursor += 1
    }
  }
  return {
    schema: (options?.schema ?? AGENT_CONTEXT_SCHEMA) as AgentContextSnapshot["schema"],
    saveId,
    agentId: options?.agentId ?? AGENT_CONTEXT_AGENT_ID,
    summary: null,
    recentTurns,
    lastCompressedTurn: null,
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
  /**
   * 可选:覆盖默认压缩 system prompt(叙事梗概).助手快照压缩传
   * ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT(任务摘要风格);master 不传用默认.
   * design 06-20-assistant-context-persistence §2.2.
   */
  systemPrompt?: string
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
        ? `任务执行超时（${Math.round(timeoutMs / 1000)}s），已中止。`
        : "任务执行超时，已中止。",
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

/** 压缩摘要 system prompt:叙事梗概风格(非要点列表),保留情节推进/人物状态/场景/伏笔.master 快照用. */
const COMPRESSION_SYSTEM_PROMPT = [
  "你正在为一段互动剧情的 AI 叙事者压缩对话历史。",
  "请将以下剧情历史浓缩成一段梗概，供叙事者在后续创作时参考最近的情节走向。",
  "",
  "要求：",
  "- 保留这段时间内的关键情节推进、人物行动与状态变化、场景转换、未解决的线索或伏笔。",
  "- 用叙事梗概风格（非要点列表），连贯可读，让叙事者能快速理解\"最近发生了什么\"。",
  "- 不需要逐字复述；不需要记录具体台词。",
  `- 控制在约 ${TARGET_COMPRESSION_TOKENS} token 以内。`,
].join("\n")

/**
 * 助手快照压缩摘要 system prompt:任务对话摘要风格(已做工作+结论),非叙事梗概.
 * 与 master 的 COMPRESSION_SYSTEM_PROMPT(剧情梗概) + turn 内 TASK_COMPRESSION_SYSTEM_PROMPT
 * (工具交互段压缩) 区分:本 prompt 压跨 turn 快照(summary + recentTurns)的任务对话.
 * design 06-20-assistant-context-persistence §4.5.
 */
const ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT = [
  "你是任务对话摘要器。把助手与用户的早期对话压缩成「已完成工作 + 结论」摘要。",
  "保留:用户的关键请求、助手已做的工作与结论、未解决的问题、重要上下文与决策。",
  "丢弃:寒暄、重复内容、工具调用的技术细节、冗余的中间过程。",
  "用简洁的任务日志风格输出,不要叙事化,不要逐字复述。",
  `- 控制在约 ${TARGET_COMPRESSION_TOKENS} token 以内。`,
].join("\n")

/** 助手快照压缩用 system prompt 的导出访问点(供 host/runtime 按 mode 传入). */
export { ASSISTANT_CONTEXT_COMPRESSION_SYSTEM_PROMPT }

/** 构建压缩调用的 user prompt:旧 summary(若有) + 被压缩轮次正文. */
function buildCompressionPrompt(
  oldSummary: string | null,
  compressEntries: AgentContextTurnEntry[],
  userLabel = "玩家",
  assistantLabel = "叙事",
): string {
  return [
    oldSummary ? `此前的梗概：\n${oldSummary}\n` : "",
    "需要压缩的剧情正文：",
    ...compressEntries.map(
      (entry) =>
        `${entry.turn}. ${entry.role === "user" ? userLabel : assistantLabel}: ${entry.content}`,
    ),
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
  // 1. 保留最近 CONTEXT_KEEP_RECENT_TURNS 轮(按 turn 去重取最近 N 个 turn 的全部 entry)
  const turnNumbers = uniqueSortedTurnNumbers(context.recentTurns)
  const keepTurns = new Set(turnNumbers.slice(-CONTEXT_KEEP_RECENT_TURNS))
  const keepEntries = context.recentTurns.filter((entry) => keepTurns.has(entry.turn))
  const compressEntries = context.recentTurns.filter(
    (entry) => !keepTurns.has(entry.turn),
  )

  // 无可压缩内容(消息少于 K 轮)→ 原样返回(由调用方判断是否抛 budget 错)
  if (compressEntries.length === 0) {
    return context
  }

  // 2. 被压缩轮次 + 旧 summary 一起送 model 生成摘要
  const systemPrompt = options.systemPrompt ?? COMPRESSION_SYSTEM_PROMPT
  const prompt = buildCompressionPrompt(
    context.summary,
    compressEntries,
    options.userLabel,
    options.assistantLabel,
  )
  let newSummary: string
  try {
    newSummary = await callModel(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      options,
    )
  } catch (error) {
    throw new ContextCompressionFailedError()
  }
  const trimmedSummary = newSummary.trim()
  if (!trimmedSummary) {
    throw new ContextCompressionFailedError()
  }

  // 3. 计算新的 lastCompressedTurn(被压缩轮次的最大 turn)
  const maxCompressedTurn = compressEntries.reduce(
    (max, entry) => Math.max(max, entry.turn),
    context.lastCompressedTurn ?? 0,
  )

  return {
    ...context,
    summary: trimmedSummary,
    recentTurns: keepEntries,
    lastCompressedTurn: maxCompressedTurn,
    updatedAt: new Date().toISOString(),
  }
}

function uniqueSortedTurnNumbers(entries: AgentContextTurnEntry[]): number[] {
  const set = new Set(entries.map((entry) => entry.turn))
  return Array.from(set).sort((a, b) => a - b)
}

// ─────────────────────────────────────────────────────────────────────────
// 任务压缩(子代理/助手 task 模式,design 06-20-agent-task-compression)
// 与 master 剧情压缩(compressContext)并列:压缩对象是工具交互段(assistant toolCalls +
// tool observation 成对),把早期轮次摘要成"已完成工作"user message,保留最近 N 轮.
// 不依赖 AgentContextSnapshot(任务型 agent 无跨 turn 快照),摘要文本随 messages 在
// turn 内存在,turn 结束即弃(不落盘——助手跨 turn 持久化是后续独立任务).
// ─────────────────────────────────────────────────────────────────────────

/** 任务压缩摘要 system prompt:任务日志风格(已做工作+结论),非叙事梗概. */
const TASK_COMPRESSION_SYSTEM_PROMPT = [
  "你是任务执行摘要器。把子代理/助手的早期工具交互过程压缩成「已完成工作 + 结论」摘要。",
  "保留:已读取/写入的关键信息、已做出的判断、已达成的中间结论、未解决的问题。",
  "丢弃:工具调用的具体命令与参数、工具返回的原始大段内容、重复的探索步骤。",
  "用简洁的任务日志风格输出,不要叙事化,不要复述工具协议。",
  `- 控制在约 ${TARGET_COMPRESSION_TOKENS} token 以内。`,
].join("\n")

/** 任务压缩可处理的 message 形态(native RuntimeChatMessage 与 text AiChatMessage 的公共结构).
 *  content 放宽为 string | ContentPart[] 以兼容多模态消息;压缩场景只处理
 *  工具交互(assistant + tool),其 content 始终是 string,ContentPart[] 不会
 *  出现在被压缩段,但类型层面需要兼容以通过泛型约束. */
interface TaskCompressionMessage {
  role: string
  content: string | ContentPart[]
  toolCalls?: unknown[]
}

/** 任务压缩结果:新 messages + 是否压动 + 摘要文本(供下次压缩作为 oldSummary). */
export interface TaskCompressionResult<T extends TaskCompressionMessage> {
  messages: T[]
  compressed: boolean
  summary: string | null
}

/**
 * 构建任务压缩 user prompt:旧摘要(若有,前次压缩产出) + 被压缩早期工具交互.
 * interactionEntries 已是早期段(保留段之外),按原顺序呈现 assistant 调用 + tool 返回.
 */
function buildTaskCompressionPrompt(
  oldSummary: string | null,
  interactionEntries: TaskCompressionMessage[],
): string {
  return [
    oldSummary ? `此前的工作摘要：\n${oldSummary}\n` : "",
    "需要压缩的早期工具交互（assistant 调用 + tool 返回）：",
    ...interactionEntries.map((entry, index) => {
      const toolName = extractToolNameFromMessage(entry)
      const tag = toolName ? `[${entry.role}:${toolName}]` : `[${entry.role}]`
      return `${index + 1}. ${tag} ${messageContentToText(entry.content)}`
    }),
  ]
    .filter(Boolean)
    .join("\n")
}

/** 从 message 提取工具名(若有):native assistant.toolCalls[0].name 或 text content 的 <tsian-tool-call> 块.无则 undefined. */
function extractToolNameFromMessage(message: TaskCompressionMessage): string | undefined {
  // native: assistant 带 toolCalls,取首个调用名(一轮通常一个工具调用)
  if (message.role === "assistant" && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
    const first = message.toolCalls[0] as { name?: string } | undefined
    if (first && typeof first.name === "string") {
      return first.name
    }
  }
  // text: assistant content 含 <tsian-tool-call>{"name":"..."}</tsian-tool-call>
  if (message.role === "assistant") {
    const text = messageContentToText(message.content)
    const match = text.match(/<tsian-tool-call>\s*(\{[\s\S]*?\})\s*<\/tsian-tool-call>/)
    if (match) {
      try {
        const parsed = JSON.parse(match[1]) as { name?: string }
        if (typeof parsed.name === "string") {
          return parsed.name
        }
      } catch {
        // 解析失败忽略,toolName 非关键
      }
    }
  }
  return undefined
}

/**
 * 任务压缩:把工具交互段的早期轮次摘要成 1 条 user message,保留最近 N 轮原文.
 *
 * 入参 messages 的工具交互段由调用方用 locateTaskInteractionSpan 定位为 [start, end).
 * 本函数:① 切出工具交互段 ② 保留最近 TASK_KEEP_RECENT_TOOL_ROUNDS 轮(成对计算:
 *    N 轮 = 2N 条 message,即 N 个 assistant+tool/user-observation 对) ③ 早期段送
 *    model 生成任务摘要 ④ 拼新 messages = [...框架段, {user:已完成工作摘要}, ...最近N轮].
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

  // 1. 切工具交互段,保留最近 N 轮(2N 条),早期送摘要
  const interaction = messages.slice(start, end)
  const keepCount = TASK_KEEP_RECENT_TOOL_ROUNDS * 2 // N 轮 = 2N 条(assistant + tool/observation)
  // 早期段 = interaction 前部,保留段 = interaction 后部
  const earlyEntries = interaction.slice(0, Math.max(0, interaction.length - keepCount))
  const recentEntries = interaction.slice(Math.max(0, interaction.length - keepCount))

  // 无可压缩早期内容 → 未压动(调用方走兜底)
  if (earlyEntries.length === 0) {
    return { messages, compressed: false, summary: oldSummary }
  }

  // 2. 早期段 + 旧摘要送 model 生成任务摘要
  const prompt = buildTaskCompressionPrompt(oldSummary, earlyEntries)
  let newSummary: string
  try {
    newSummary = await callModel(
      [
        { role: "system", content: TASK_COMPRESSION_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      options,
    )
  } catch {
    throw new ContextCompressionFailedError()
  }
  const trimmedSummary = newSummary.trim()
  if (!trimmedSummary) {
    throw new ContextCompressionFailedError()
  }

  // 3. 拼新 messages:框架段[0,start) + 摘要 user + 最近 N 轮
  // 摘要 message 是 {role:"user",content} 形态——满足 RuntimeChatMessage(user 变体)
  // 与 AiChatMessage 的公共结构.用 as unknown as T 打断泛型推断循环(T 是联合类型时
  // as T 会触发 result 类型隐式 any).
  const summaryMessage = { role: "user", content: `已完成工作摘要：\n${trimmedSummary}` } as unknown as T
  const newMessages: T[] = [
    ...messages.slice(0, start),
    summaryMessage,
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
  turn: number,
  user: string,
  assistant: string,
): AgentContextSnapshot {
  return {
    ...context,
    recentTurns: [
      ...context.recentTurns,
      { turn, role: "user", content: user },
      { turn, role: "assistant", content: assistant },
    ],
    updatedAt: new Date().toISOString(),
  }
}
