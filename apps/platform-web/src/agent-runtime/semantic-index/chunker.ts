import type { WorkspaceFile, WorkspaceSemanticType } from "@tsian/contracts"

/**
 * semantic-index chunker — save-runtime 三分语料切块.
 *
 * 预处理责任归 agent/Skill(叙事 turn 直拼、memory-maintenance 已浓缩),索引
 * 责任归本模块. 两件事不叠在同一处做——把预处理塞进索引管道会让 save-runtime
 * 每轮写都触发模型 pass,是热路径灾难.
 *
 * 三分:
 * - raw turn(save/history/turns/ 下 turn-XXXXXX.json):一个文件一个 chunk,
 *   不按 token 切. 嵌入文本 = `玩家：{user}\n叙事：{assistant}` 直拼.
 * - agent 浓缩产物(save/agents/ 下 notes.md、save/memory/summaries/ 下任意):
 *   markdown 按标题/段落切(天然语义边界),每段一个 chunk.
 * - JSON 状态(save/world/、save/state/、save/frontend/):跳过,字面 search 够用.
 */

export interface Chunk {
  path: string
  chunkIndex: number
  text: string
  type: WorkspaceSemanticType
  /** raw turn 的 turn 编号(仅 type=turn). */
  turn?: number
  /** 原始文件 createdAt(用于近因加权,可选). */
  fileCreatedAt?: number
}

/** raw turn 记录的最小解析形状(schema `tsian.airp.history.turn.v1`). */
interface RawTurnRecord {
  turn: number
  createdAt: string
  messages: Array<{ role: string; content: string }>
}

/** 把一个 save-runtime 文件切成 chunk 数组. JSON 状态/损坏文件返回空数组. */
export function chunkWorkspaceFile(file: WorkspaceFile): Chunk[] {
  const type = deriveSemanticType(file.path)
  if (type === null) {
    // JSON 状态等不索引的路径.
    return []
  }

  if (type === "turn") {
    return chunkRawTurn(file)
  }
  // agent-notes / memory-summary:markdown 按标题/段落切.
  return chunkMarkdown(file, type)
}

/**
 * 路径 → 语料类型派生. 返回 null 表示跳过(JSON 状态等).
 *
 * save/history/turns/ 下 .json   → turn
 * save/agents/ 下 notes.md       → agent-notes
 * save/memory/summaries/ 下任意  → memory-summary
 * 其它 save/ 下 .md              → agent-notes(兜底,保守归入可检索)
 * 其它 save/ 下 .json            → 跳过(null)
 */
export function deriveSemanticType(path: string): WorkspaceSemanticType | null {
  // save/history/turns/ 下的 .json 是 raw turn.
  if (path.startsWith("save/history/turns/") && path.endsWith(".json")) {
    return "turn"
  }
  // 非 .json 文件按位置派生可检索类型.
  if (!path.endsWith(".md")) {
    // 其它 .json(世界/状态/前端)跳过.
    if (path.endsWith(".json")) {
      return null
    }
    // 非文本文件(媒体等)不索引.
    return null
  }
  // .md 文件.
  if (path.startsWith("save/agents/")) {
    return "agent-notes"
  }
  if (path.startsWith("save/memory/summaries/")) {
    return "memory-summary"
  }
  // 兜底:save/ 下其它 .md 保守归入可检索(agent-notes 语义最近).
  if (path.startsWith("save/")) {
    return "agent-notes"
  }
  return null
}

/** raw turn:一个文件一个 chunk. 解析失败(JSON 损坏)→ 空数组,不阻塞索引. */
function chunkRawTurn(file: WorkspaceFile): Chunk[] {
  let record: RawTurnRecord
  try {
    record = JSON.parse(file.content) as RawTurnRecord
  } catch {
    // 损坏 JSON 跳过,不阻塞索引. 调用方可加日志/trace 可观测.
    return []
  }
  if (
    typeof record?.turn !== "number" ||
    !Array.isArray(record?.messages) ||
    record.messages.length === 0
  ) {
    return []
  }

  const user = record.messages.find((m) => m.role === "user")?.content ?? ""
  const assistant = record.messages.find((m) => m.role === "assistant")?.content ?? ""
  // user/assistant 直拼(无前情提要前缀,MVP 不做). 拼不出正文则跳过.
  const text = `玩家：${user}\n叙事：${assistant}`
  if (!user && !assistant) {
    return []
  }

  const fileCreatedAt = parseTimestamp(record.createdAt)
  return [
    {
      path: file.path,
      chunkIndex: 0,
      text,
      type: "turn",
      turn: record.turn,
      ...(fileCreatedAt !== undefined ? { fileCreatedAt } : {}),
    },
  ]
}

/**
 * markdown 按 `## `/`### ` 标题切段;无标题的按段落(空行分隔)切.
 * 每段一个 chunk,chunkIndex 递增. 嵌入文本 = 段落原文(带标题).
 */
function chunkMarkdown(file: WorkspaceFile, type: WorkspaceSemanticType): Chunk[] {
  const content = file.content
  if (!content.trim()) {
    return []
  }

  const segments = splitMarkdownBySections(content)
  if (segments.length === 0) {
    return []
  }

  const fileCreatedAt = file.createdAt > 0 ? file.createdAt : undefined
  return segments.map((text, index) => ({
    path: file.path,
    chunkIndex: index,
    text,
    type,
    ...(fileCreatedAt !== undefined ? { fileCreatedAt } : {}),
  }))
}

/** 按标题(## /### )或空行分段,返回非空段落数组(含标题行). */
function splitMarkdownBySections(content: string): string[] {
  const lines = content.split("\n")
  const sections: string[] = []
  let current: string[] = []
  let hasHeading = false

  const flush = () => {
    const block = current.join("\n").trim()
    if (block) {
      sections.push(block)
    }
    current = []
    hasHeading = false
  }

  for (const line of lines) {
    // ## 或 ### 标题开启新段(已在累积中的先 flush).
    if (/^#{2,3}\s/.test(line)) {
      flush()
      current.push(line)
      hasHeading = true
      continue
    }
    // 无标题模式下,空行分段.
    if (!hasHeading && line.trim() === "" && current.length > 0) {
      flush()
      continue
    }
    current.push(line)
  }
  flush()

  // 退化:整篇无标题也无空行 → 单段.
  if (sections.length === 0 && content.trim()) {
    return [content.trim()]
  }
  return sections
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
