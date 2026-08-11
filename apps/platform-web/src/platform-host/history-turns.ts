import type {
  AgentContextSnapshot,
  AgentContextToolMemory,
  AgentInvocationTranscript,
  AgentInvocationTranscriptEntry,
  AssistantTurnTimelineItem,
  ConversationMessageRecord,
  SessionHistoryEntry,
  TurnTimelineItem,
  WorkspaceFile,
} from "@tsian/contracts"
import type { RuntimeWorkspaceTransaction } from "../storage"
import {
  agentContextPath,
  agentInvocationTranscriptPath,
  appendTurnToContext,
  createEmptyAgentContext,
  parseAgentContext,
  serializeAgentContext,
} from "../agent-runtime/context-lifecycle"
import {
  applyTaskToolMemoryRetention,
  sortToolMemoriesStable,
} from "../agent-runtime/tool-memory"

const AIRP_HISTORY_TURN_SCHEMA = "tsian.airp.history.turn.v2"
const AIRP_HISTORY_TURN_PATH_PREFIX = "save/history/turns/"
const AIRP_RUNTIME_TRACE_PATH_PREFIX = ".tsian/save/traces/turns/"

/** 判断 workspace 路径是否为 turn 历史文件（`save/history/turns/turn-*.json`）。
 *  chunker 用此识别 turn 语义（semantic-type: "turn"）；不要用它过滤 traces——
 *  traces 是诊断日志不是对话历史，用 isAppendOnlyLogPath 统一识别追加型日志。 */
export function isTurnFilePath(path: string): boolean {
  return path.startsWith(AIRP_HISTORY_TURN_PATH_PREFIX) && path.endsWith(".json")
}

/** 仅供恢复/删除生命周期识别遗留 runtime trace 文件。 */
export function isTraceFilePath(path: string): boolean {
  return path.startsWith(AIRP_RUNTIME_TRACE_PATH_PREFIX) && path.endsWith(".jsonl")
}

/** 判断是否为"追加型日志"文件。
 * 活跃 turn 文件与遗留 trace 文件都不进 checkpoint；后者只为恢复/删除时裁剪。 */
export function isAppendOnlyLogPath(path: string): boolean {
  return isTurnFilePath(path) || isTraceFilePath(path)
}

/** 从追加型日志文件名提取 turn 号（`turn-NNNNNN.json`/`turn-NNNNNN.jsonl`/`turn-NNNNNN-failed-<ts>.jsonl`）。
 *  无法提取返回 null。checkpoint 恢复裁剪时用：turn > targetTurn 的日志文件删除。 */
export function extractTurnFromLogPath(path: string): number | null {
  const m = path.match(/turn-(\d+)\.(?:json|jsonl)/)
  return m ? Number(m[1]) : null
}

interface RawAirpHistoryTurnRecord {
  schema: typeof AIRP_HISTORY_TURN_SCHEMA
  turn: number
  createdAt: string
  source: {
    kind: "agent-runtime"
    entryAgentId: string
  }
  /** turn 内完整 timeline(user + process items + assistant + options),按发生顺序.
   *  替代旧的 messages + processNodes + stats 分裂结构(schema v2). */
  timeline: TurnTimelineItem[]
}

function formatRawAirpHistoryTurnPath(turn: number): string {
  return `${AIRP_HISTORY_TURN_PATH_PREFIX}turn-${String(turn).padStart(6, "0")}.json`
}

function serializeRawAirpHistoryTurnRecord(
  turn: number,
  createdAt: Date,
  entryAgentId: string,
  timeline: TurnTimelineItem[],
): string {
  const record: RawAirpHistoryTurnRecord = {
    schema: AIRP_HISTORY_TURN_SCHEMA,
    turn,
    createdAt: createdAt.toISOString(),
    source: {
      kind: "agent-runtime",
      entryAgentId,
    },
    timeline,
  }

  return `${JSON.stringify(record, null, 2)}\n`
}

/**
 * 从工作区文件读 agent 会话上下文快照(save/agents/<agentId>/context[-slot].json).
 * 文件不存在/损坏 → 返回 null(由 runtime 层兜底初始化).
 * agentId 参数化(task 06-26):master 路径值不变,支持任意 persistent 入口 agent.
 * slot 参数(task 07-01):传 slot 时读 context-<slot>.json,实现上下文隔离.
 */
export function readAgentContextFromWorkspace(
  workspaceFiles: WorkspaceFile[],
  saveId: string,
  agentId: string = "master",
  slot?: string,
): AgentContextSnapshot | null {
  const file = workspaceFiles.find((f) => f.path === agentContextPath(agentId, slot))
  if (!file) return null
  return parseAgentContext(file.content, saveId, { agentId })
}

/**
 * turn 收尾:把本轮正文追加进 context.json,若本轮开头压缩了则用压缩后快照.
 * 原地更新(workspaceTransaction.write),与其它 stage 函数同事务提交.
 * agentId 参数化(task 06-26):默认 master,支持任意 persistent 入口 agent.
 * slot 参数(task 07-01):传 slot 时写 context-<slot>.json,实现上下文隔离.
 */
export function stageAgentContextFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    saveId: string
    sequence: number
    gameTurn?: number
    user: string
    assistant: string
    compressedContext?: AgentContextSnapshot
    toolMemories?: AgentContextToolMemory[]
    agentId?: string
    slot?: string
  },
): WorkspaceFile {
  const agentId = input.agentId ?? "master"
  const slot = input.slot
  // 基础快照:本轮压缩了→用压缩结果;否则读现有 context.json,无则空快照
  const base =
    input.compressedContext
    ?? readAgentContextFromWorkspace(workspaceTransaction.workspaceFiles, input.saveId, agentId, slot)
    ?? createEmptyAgentContext(input.saveId, { agentId })
  // 追加本轮正文(保持最近 K 轮),saveId 用真实值修正(runtime 兜底时可能为空)
  const appended = appendTurnToContext(
    { ...base, saveId: input.saveId },
    input.sequence,
    input.user,
    input.assistant,
    input.gameTurn,
  )
  const mergedToolMemories = applyTaskToolMemoryRetention(sortToolMemoriesStable([
    ...(appended.toolMemories ?? []),
    ...(input.toolMemories ?? []),
  ]), appended.sequence)
  const updated: AgentContextSnapshot = {
    ...appended,
    saveId: input.saveId,
    agentId,
    ...(mergedToolMemories.length > 0 ? { toolMemories: mergedToolMemories } : {}),
  }
  return workspaceTransaction.write({
    path: agentContextPath(agentId, slot),
    content: serializeAgentContext(updated),
  })
}

export function parseAgentInvocationTranscript(
  content: string,
  agentId: string,
  slot: string,
): AgentInvocationTranscript | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const record = parsed as Record<string, unknown>
  if (
    !hasOnlyTranscriptKeys(record, ["schema", "agentId", "slot", "lastSequence", "entries"])
    || record.schema !== "tsian.agent.invocation-transcript.v1"
    || record.agentId !== agentId
    || record.slot !== slot
    || typeof record.lastSequence !== "number"
    || !Number.isSafeInteger(record.lastSequence)
    || record.lastSequence < 0
    || !Array.isArray(record.entries)
  ) return null
  const entries: AgentInvocationTranscriptEntry[] = []
  let previousSequence = 0
  for (const raw of record.entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const entry = raw as Record<string, unknown>
    const assistant = parseTranscriptAssistant(entry.assistant)
    const timeline = Array.isArray(entry.timeline)
      ? entry.timeline.map(parseTranscriptTimelineItem)
      : entry.timeline === undefined
        ? undefined
        : null
    if (
      !hasOnlyTranscriptKeys(entry, ["sequence", "invocationId", "purpose", "createdAt", "request", "assistant", "timeline"])
      || typeof entry.sequence !== "number"
      || !Number.isSafeInteger(entry.sequence)
      || entry.sequence <= previousSequence
      || typeof entry.invocationId !== "string"
      || !entry.invocationId.trim()
      || entry.invocationId.length > 200
      || (entry.purpose !== undefined && (typeof entry.purpose !== "string" || !entry.purpose.trim()))
      || typeof entry.createdAt !== "string"
      || !entry.createdAt.trim()
      || typeof entry.request !== "string"
      || !assistant
      || timeline === null
      || timeline?.some((item) => item === null)
    ) return null
    previousSequence = entry.sequence
    entries.push({
      sequence: entry.sequence,
      invocationId: entry.invocationId,
      ...(typeof entry.purpose === "string" && entry.purpose.trim() ? { purpose: entry.purpose } : {}),
      createdAt: entry.createdAt,
      request: entry.request,
      assistant,
      ...(timeline ? { timeline: timeline as TurnTimelineItem[] } : {}),
    })
  }
  if ((entries.length > 0 ? entries[entries.length - 1]!.sequence : 0) !== record.lastSequence) return null
  return {
    schema: "tsian.agent.invocation-transcript.v1",
    agentId,
    slot,
    lastSequence: record.lastSequence,
    entries,
  }
}

function isTranscriptJsonValue(value: unknown): value is import("@tsian/contracts").JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isTranscriptJsonValue)
  return typeof value === "object" && value !== null
    && Object.values(value as Record<string, unknown>).every(isTranscriptJsonValue)
}

function hasOnlyTranscriptKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys)
  return Object.keys(record).every((key) => allowed.has(key))
}

function parseTranscriptAssistant(value: unknown): AssistantTurnTimelineItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!hasOnlyTranscriptKeys(record, ["kind", "content", "displayContent", "projections"])
    || record.kind !== "assistant" || typeof record.content !== "string") return null
  if (record.displayContent !== undefined && typeof record.displayContent !== "string") return null
  if (record.projections !== undefined
    && (typeof record.projections !== "object" || record.projections === null || Array.isArray(record.projections)
      || !isTranscriptJsonValue(record.projections))) return null
  return {
    kind: "assistant",
    content: record.content,
    ...(typeof record.displayContent === "string" ? { displayContent: record.displayContent } : {}),
    ...(record.projections && typeof record.projections === "object"
      ? { projections: record.projections as Record<string, import("@tsian/contracts").JsonValue> }
      : {}),
  }
}

function parseTranscriptTimelineItem(value: unknown): TurnTimelineItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (item.kind === "interim" || item.kind === "thought") {
    if (!hasOnlyTranscriptKeys(item, ["kind", "id", "round", "agentId", "text", "collapsed"])
      || typeof item.id !== "string" || typeof item.round !== "number" || !Number.isSafeInteger(item.round)
      || item.round < 0 || typeof item.text !== "string" || typeof item.collapsed !== "boolean"
      || (item.agentId !== undefined && typeof item.agentId !== "string")) return null
    return {
      kind: item.kind,
      id: item.id,
      round: item.round,
      ...(typeof item.agentId === "string" ? { agentId: item.agentId } : {}),
      text: item.text,
      collapsed: item.collapsed,
    }
  }
  if (!hasOnlyTranscriptKeys(item, ["kind", "id", "round", "agentId", "name", "displayName", "status", "presentation", "collapsed"])
    || item.kind !== "tool"
    || typeof item.id !== "string"
    || typeof item.round !== "number"
    || !Number.isSafeInteger(item.round)
    || item.round < 0
    || typeof item.name !== "string"
    || !["loading", "running", "success", "failed"].includes(String(item.status))
    || typeof item.collapsed !== "boolean"
    || (item.agentId !== undefined && typeof item.agentId !== "string")
    || (item.displayName !== undefined && typeof item.displayName !== "string")
    || (item.presentation !== undefined && !isTranscriptJsonValue(item.presentation))) return null
  return {
    kind: "tool",
    id: item.id,
    round: item.round,
    ...(typeof item.agentId === "string" ? { agentId: item.agentId } : {}),
    name: item.name,
    ...(typeof item.displayName === "string" ? { displayName: item.displayName } : {}),
    status: item.status as "loading" | "running" | "success" | "failed",
    ...(item.presentation !== undefined ? { presentation: item.presentation as import("@tsian/contracts").UiToolPresentation } : {}),
    collapsed: item.collapsed,
  }
}

export function readAgentInvocationTranscriptFromWorkspace(
  workspaceFiles: WorkspaceFile[],
  agentId: string,
  slot: string,
): AgentInvocationTranscript | null {
  const file = workspaceFiles.find((candidate) => candidate.path === agentInvocationTranscriptPath(agentId, slot))
  return file ? parseAgentInvocationTranscript(file.content, agentId, slot) : null
}

function boundedTranscriptTimeline(timeline: TurnTimelineItem[] | undefined): TurnTimelineItem[] | undefined {
  if (!timeline?.length) return undefined
  return timeline.slice(-100).map((item) => {
    if (item.kind === "thought" || item.kind === "interim") {
      return { ...item, text: item.text.slice(0, 4_000) }
    }
    return item
  })
}

export function stageAgentInvocationTranscriptFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    agentId: string
    slot: string
    sequence: number
    invocationId: string
    purpose?: string
    request: string
    assistant: AssistantTurnTimelineItem
    timeline?: TurnTimelineItem[]
  },
): WorkspaceFile {
  const path = agentInvocationTranscriptPath(input.agentId, input.slot)
  const existingFile = workspaceTransaction.workspaceFiles.find((file) => file.path === path)
  const existing = existingFile
    ? parseAgentInvocationTranscript(existingFile.content, input.agentId, input.slot)
    : null
  if (existingFile && !existing) {
    throw new Error(`Agent invocation transcript is invalid: ${path}`)
  }
  if ((existing?.lastSequence ?? 0) >= input.sequence) {
    throw new Error(`Agent invocation transcript sequence must append monotonically: ${path}`)
  }
  const entry: AgentInvocationTranscriptEntry = {
    sequence: input.sequence,
    invocationId: input.invocationId,
    ...(input.purpose ? { purpose: input.purpose } : {}),
    createdAt: new Date().toISOString(),
    request: input.request,
    assistant: input.assistant,
    ...(boundedTranscriptTimeline(input.timeline) ? { timeline: boundedTranscriptTimeline(input.timeline) } : {}),
  }
  const transcript: AgentInvocationTranscript = {
    schema: "tsian.agent.invocation-transcript.v1",
    agentId: input.agentId,
    slot: input.slot,
    lastSequence: input.sequence,
    entries: [...(existing?.entries ?? []), entry],
  }
  return workspaceTransaction.write({ path, content: `${JSON.stringify(transcript, null, 2)}\n` })
}

export function stageRawAirpHistoryTurnFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    turn: number
    entryAgentId: string
    timeline: TurnTimelineItem[]
  },
): WorkspaceFile {
  const path = formatRawAirpHistoryTurnPath(input.turn)
  return workspaceTransaction.write({
    path,
    content: serializeRawAirpHistoryTurnRecord(
      input.turn,
      new Date(),
      input.entryAgentId,
      input.timeline,
    ),
  })
}

/**
 * 解析单个 turn 文件内容为 record.损坏/格式不符 → 返回 null.
 * processNodes 缺失时兜底为 undefined(text 模式 turn 不含过程节点).
 */
export function parseRawAirpHistoryTurnRecord(
  content: string,
): RawAirpHistoryTurnRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const obj = parsed as Record<string, unknown>
  if (
    obj.schema !== AIRP_HISTORY_TURN_SCHEMA
    || typeof obj.turn !== "number"
    || !Array.isArray(obj.timeline)
  ) {
    return null
  }
  const timeline = obj.timeline as TurnTimelineItem[]
  return {
    schema: AIRP_HISTORY_TURN_SCHEMA,
    turn: obj.turn,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date(0).toISOString(),
    source: {
      kind: "agent-runtime",
      entryAgentId:
        typeof obj.source === "object" && obj.source !== null
          ? String((obj.source as Record<string, unknown>).entryAgentId ?? "")
          : "",
    },
    timeline,
  }
}

/**
 * 从 workspace 文件列表取当前 turn 号(= 最大 turn 文件的 record.turn).
 * 新档无 turn 文件 → 0.坏文件 parse 失败跳过,不影响 max.
 * turn 号天然跟着 turn 文件走,不需要额外元数据文件.
 */
export function getMaxTurnFromTurnFiles(workspaceFiles: WorkspaceFile[]): number {
  const turnFiles = workspaceFiles.filter(
    (file) => isTurnFilePath(file.path),
  )
  let maxTurn = 0
  for (const file of turnFiles) {
    const record = parseRawAirpHistoryTurnRecord(file.content)
    if (record && record.turn > maxTurn) {
      maxTurn = record.turn
    }
  }
  return maxTurn
}

/**
 * 从 workspace 文件列表重建完整对话历史(ConversationMessageRecord[]).
 * 读 `save/history/turns/turn-*.json` → parse → 按 turn 升序,从 timeline 过滤
 * user/assistant 项映射为 ConversationMessageRecord(干净正文).
 * 空目录/无 turn 文件 → 返回 [](新建存档兜底).
 * 只提取 user/assistant 项 —— agent 注入路径(recentHistory)只给干净正文,
 * process items 留给前端渲染 / agent 主动 workspace_read 查.
 */
export function getHistoryFromTurnFiles(
  workspaceFiles: WorkspaceFile[],
): ConversationMessageRecord[] {
  const turnFiles = workspaceFiles.filter(
    (file) =>
      file.path.startsWith(AIRP_HISTORY_TURN_PATH_PREFIX)
      && file.path.endsWith(".json"),
  )
  const records: RawAirpHistoryTurnRecord[] = []
  for (const file of turnFiles) {
    const record = parseRawAirpHistoryTurnRecord(file.content)
    if (record) records.push(record)
  }
  records.sort((left, right) => left.turn - right.turn)
  return records.flatMap((record) =>
    record.timeline
      .filter((item) => item.kind === "user" || item.kind === "assistant")
      .map((item) => ({
        role: item.kind,
        content: item.content,
        ...(item.kind === "user" && item.attachments && item.attachments.length > 0
          ? { attachments: item.attachments }
          : {}),
      })),
  )
}

/**
 * 从 workspace 文件列表重建完整会话历史(SessionHistoryEntry[]),含完整 timeline.
 * 与 `getHistoryFromTurnFiles` 的区别:后者只提取 user/assistant 项(给 agent 干净正文),
 * 本函数保留每个 turn 的完整 timeline(user + process items + assistant + options),
 * 给前端单源重建完整玩家视角.空目录/无 turn 文件 → 返回 [].
 */
export function getSessionHistoryFromTurnFiles(
  workspaceFiles: WorkspaceFile[],
): SessionHistoryEntry[] {
  const turnFiles = workspaceFiles.filter(
    (file) =>
      file.path.startsWith(AIRP_HISTORY_TURN_PATH_PREFIX)
      && file.path.endsWith(".json"),
  )
  const entries: SessionHistoryEntry[] = []
  for (const file of turnFiles) {
    const record = parseRawAirpHistoryTurnRecord(file.content)
    if (!record) continue
    entries.push({
      turn: record.turn,
      createdAt: record.createdAt,
      timeline: record.timeline,
    })
  }
  entries.sort((left, right) => left.turn - right.turn)
  return entries
}
