import type {
  AgentContextSnapshot,
  AgentContextTurnEntry,
  ConversationMessageRecord,
  AiChatMessage,
} from "@tsian/contracts"
import type { RuntimeTraceDebugLabel } from "./trace"

/**
 * master agent 会话上下文生命周期与压缩持久化.
 *
 * 与玩家剧情正文存档(`saveHistory`)分离:这里管的是 master agent 视角的
 * "1 摘要 + 最近 K 轮正文"稳态,持久化到工作区 `save/agents/master/context.json`,
 * 跨 turn/跨加载保持上下文不膨胀不失忆.详见任务
 * `06-19-agent-session-context-lifecycle` 的 design.md.
 */

/** context.json 在工作区的路径(相对 save runtime 根). */
export const AGENT_CONTEXT_PATH = "agents/master/context.json"
/** context.json 的 schema 标记,用于 parse 时校验. */
export const AGENT_CONTEXT_SCHEMA = "tsian.agent.context.v1"
/** master agent 固定 id(context.json 只服务 master). */
export const AGENT_CONTEXT_AGENT_ID = "master" as const

/** 默认 token 预算:model 未配 contextWindow 时兜底. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 256_000
/** 压缩触发阈值比例:85% budget 触发压缩(留 15% 余量吸收估算偏差). */
export const CONTEXT_COMPRESS_TRIGGER_RATIO = 0.85
/** 压缩时保留最近几轮正文(原文不压缩). */
export const CONTEXT_KEEP_RECENT_TURNS = 5
/** 摘要目标体积(token),送 model 时告知压缩到约此体积. */
export const TARGET_COMPRESSION_TOKENS = 2000

// ─────────────────────────────────────────────────────────────────────────
// Token 估算(复用 tool-token-budget 讨论结论:字符数*0.4 + UTF-8 字节数*0.25,
// 中文准确、英文保守高估,误差倒向早压缩安全侧.零依赖,模块级 hoisted encoder)
// ─────────────────────────────────────────────────────────────────────────

const utf8Encoder = new TextEncoder()

/** 粗略 token 估算(中英混合优化).不引入 tokenizer 依赖. */
export function estimateTokenCount(text: string): number {
  const charCount = text.length
  const byteCount = utf8Encoder.encode(text).length
  return Math.ceil(charCount * 0.4 + byteCount * 0.25)
}

/** 估算一组 RuntimeChatMessage(native 循环)的 token 总量. */
export function estimateAiChatMessagesTokens(messages: AiChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokenCount(msg.content), 0)
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
 */
export function parseAgentContext(
  content: string,
  saveId: string,
): AgentContextSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return createEmptyAgentContext(saveId)
  }
  if (!parsed || typeof parsed !== "object") {
    return createEmptyAgentContext(saveId)
  }
  const obj = parsed as Record<string, unknown>
  // schema 不匹配也兜底(向前兼容旧 schema 演进)
  const recentTurns = Array.isArray(obj.recentTurns)
    ? (obj.recentTurns as unknown[])
        .map(parseTurnEntry)
        .filter((e): e is AgentContextTurnEntry => e !== null)
    : []
  return {
    schema: AGENT_CONTEXT_SCHEMA,
    saveId,
    agentId: AGENT_CONTEXT_AGENT_ID,
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
export function createEmptyAgentContext(saveId: string): AgentContextSnapshot {
  return {
    schema: AGENT_CONTEXT_SCHEMA,
    saveId,
    agentId: AGENT_CONTEXT_AGENT_ID,
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
 */
export function createInitialAgentContext(
  saveId: string,
  recentHistory: ConversationMessageRecord[],
  currentTurn: number,
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
    schema: AGENT_CONTEXT_SCHEMA,
    saveId,
    agentId: AGENT_CONTEXT_AGENT_ID,
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

/** 压缩摘要 system prompt:叙事梗概风格(非要点列表),保留情节推进/人物状态/场景/伏笔. */
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

/** 构建压缩调用的 user prompt:旧 summary(若有) + 被压缩轮次正文. */
function buildCompressionPrompt(
  oldSummary: string | null,
  compressEntries: AgentContextTurnEntry[],
): string {
  return [
    oldSummary ? `此前的梗概：\n${oldSummary}\n` : "",
    "需要压缩的剧情正文：",
    ...compressEntries.map(
      (entry) =>
        `${entry.turn}. ${entry.role === "user" ? "玩家" : "叙事"}: ${entry.content}`,
    ),
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * 压缩上下文:保留最近 K 轮原文,被压缩轮次 + 旧 summary 调 model 生成叙事梗概.
 * 稳态循环:下次压缩时旧 summary 被二次浓缩,越早的剧情细节自然淡出.
 * callModel 失败 → throw ContextCompressionFailedError(温和兜底,不强行用爆满上下文).
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

  // 2. 被压缩轮次 + 旧 summary 一起送 model 生成叙事梗概
  const prompt = buildCompressionPrompt(context.summary, compressEntries)
  let newSummary: string
  try {
    newSummary = await callModel(
      [
        { role: "system", content: COMPRESSION_SYSTEM_PROMPT },
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
// turn 追加(R4 用:turn 收尾把本轮正文追加进 recentTurns)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 把本轮 user+assistant 正文追加进快照 recentTurns,保持最近 K 轮
 * (超 K 从头部丢).不在此压缩(压缩在 turn 开头).返回新快照(不可变).
 */
export function appendTurnToContext(
  context: AgentContextSnapshot,
  turn: number,
  user: string,
  assistant: string,
): AgentContextSnapshot {
  const appended: AgentContextTurnEntry[] = [
    ...context.recentTurns,
    { turn, role: "user", content: user },
    { turn, role: "assistant", content: assistant },
  ]
  // 保持最近 CONTEXT_KEEP_RECENT_TURNS 轮:按 turn 去重取最近 N 个 turn
  const turnNumbers = uniqueSortedTurnNumbers(appended)
  const keepTurns = new Set(turnNumbers.slice(-CONTEXT_KEEP_RECENT_TURNS))
  const recentTurns = appended.filter((entry) => keepTurns.has(entry.turn))
  return {
    ...context,
    recentTurns,
    updatedAt: new Date().toISOString(),
  }
}
