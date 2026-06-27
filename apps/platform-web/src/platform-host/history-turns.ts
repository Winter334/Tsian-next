import type {
  AgentContextSnapshot,
  ConversationMessageRecord,
  SessionHistoryEntry,
  TurnProcessNode,
  TurnStats,
  WorkspaceFile,
} from "@tsian/contracts"
import type { RuntimeWorkspaceTransaction } from "../storage"
import {
  agentContextPath,
  appendTurnToContext,
  createEmptyAgentContext,
  parseAgentContext,
  serializeAgentContext,
} from "../agent-runtime/context-lifecycle"

const AIRP_HISTORY_TURN_SCHEMA = "tsian.airp.history.turn.v1"
const AIRP_HISTORY_TURN_PATH_PREFIX = "save/history/turns/"
const AIRP_RUNTIME_TRACE_PATH_PREFIX = ".tsian/save/traces/turns/"

/** 判断 workspace 路径是否为 turn 历史文件（`save/history/turns/turn-*.json`）。
 *  chunker 用此识别 turn 语义（semantic-type: "turn"）；不要用它过滤 traces——
 *  traces 是诊断日志不是对话历史，用 isAppendOnlyLogPath 统一识别追加型日志。 */
export function isTurnFilePath(path: string): boolean {
  return path.startsWith(AIRP_HISTORY_TURN_PATH_PREFIX) && path.endsWith(".json")
}

/** 判断 workspace 路径是否为 runtime trace 文件（`.tsian/save/traces/turns/turn-*.jsonl`）。 */
export function isTraceFilePath(path: string): boolean {
  return path.startsWith(AIRP_RUNTIME_TRACE_PATH_PREFIX) && path.endsWith(".jsonl")
}

/** 判断是否为"追加型日志"文件——每回合新增一个、旧文件不变，存档级共享。
 *  turn 文件（对话历史）+ trace 文件（诊断日志）都属于此类：
 *  checkpoint 不存此类文件（恢复时按 turn 号裁剪到 1..N），避免内容寻址冗余。 */
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
  messages: ConversationMessageRecord[]
  /** turn 内过程节点(thought/tool/interim).native 模式从事件流累积写入;
   *  text 模式不发过程事件,此字段为 undefined(不写入). */
  processNodes?: TurnProcessNode[]
  /** 本轮资源消耗统计（耗时 + token），供前端显示 meta 行。 */
  stats?: TurnStats
}

function formatRawAirpHistoryTurnPath(turn: number): string {
  return `${AIRP_HISTORY_TURN_PATH_PREFIX}turn-${String(turn).padStart(6, "0")}.json`
}

function serializeRawAirpHistoryTurnRecord(
  turn: number,
  createdAt: Date,
  entryAgentId: string,
  userInput: string,
  assistantOutput: string,
  processNodes?: TurnProcessNode[],
  stats?: TurnStats,
): string {
  const record: RawAirpHistoryTurnRecord = {
    schema: AIRP_HISTORY_TURN_SCHEMA,
    turn,
    createdAt: createdAt.toISOString(),
    source: {
      kind: "agent-runtime",
      entryAgentId,
    },
    messages: [
      { role: "user", content: userInput },
      { role: "assistant", content: assistantOutput },
    ],
    ...(processNodes && processNodes.length > 0 ? { processNodes } : {}),
    ...(stats ? { stats } : {}),
  }

  return `${JSON.stringify(record, null, 2)}\n`
}

/**
 * 从工作区文件读 agent 会话上下文快照(save/agents/<agentId>/context.json).
 * 文件不存在/损坏 → 返回 null(由 runtime 层兜底初始化).
 * agentId 参数化(task 06-26):master 路径值不变,支持任意 persistent 入口 agent.
 */
export function readAgentContextFromWorkspace(
  workspaceFiles: WorkspaceFile[],
  saveId: string,
  agentId: string = "master",
): AgentContextSnapshot | null {
  const file = workspaceFiles.find((f) => f.path === agentContextPath(agentId))
  if (!file) return null
  return parseAgentContext(file.content, saveId)
}

/**
 * turn 收尾:把本轮正文追加进 context.json,若本轮开头压缩了则用压缩后快照.
 * 原地更新(workspaceTransaction.write),与其它 stage 函数同事务提交.
 * agentId 参数化(task 06-26):默认 master,支持任意 persistent 入口 agent.
 */
export function stageAgentContextFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    saveId: string
    turn: number
    user: string
    assistant: string
    compressedContext?: AgentContextSnapshot
    agentId?: string
  },
): WorkspaceFile {
  const agentId = input.agentId ?? "master"
  // 基础快照:本轮压缩了→用压缩结果;否则读现有 context.json,无则空快照
  const base =
    input.compressedContext
    ?? readAgentContextFromWorkspace(workspaceTransaction.workspaceFiles, input.saveId, agentId)
    ?? createEmptyAgentContext(input.saveId)
  // 追加本轮正文(保持最近 K 轮),saveId 用真实值修正(runtime 兜底时可能为空)
  const updated = appendTurnToContext(
    { ...base, saveId: input.saveId },
    input.turn,
    input.user,
    input.assistant,
  )
  return workspaceTransaction.write({
    path: agentContextPath(agentId),
    content: serializeAgentContext(updated),
  })
}

export function stageRawAirpHistoryTurnFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    turn: number
    entryAgentId: string
    userInput: string
    assistantOutput: string
    processNodes?: TurnProcessNode[]
    stats?: TurnStats
  },
): WorkspaceFile {
  const path = formatRawAirpHistoryTurnPath(input.turn)
  return workspaceTransaction.write({
    path,
    content: serializeRawAirpHistoryTurnRecord(
      input.turn,
      new Date(),
      input.entryAgentId,
      input.userInput,
      input.assistantOutput,
      input.processNodes,
      input.stats,
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
    || !Array.isArray(obj.messages)
  ) {
    return null
  }
  const messages = obj.messages as ConversationMessageRecord[]
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
    messages,
    ...(Array.isArray(obj.processNodes) ? { processNodes: obj.processNodes as TurnProcessNode[] } : {}),
    ...(obj.stats && typeof obj.stats === "object" ? { stats: obj.stats as TurnStats } : {}),
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
 * 读 `save/history/turns/turn-*.json` → parse → 按 turn 升序展平 messages.
 * 空目录/无 turn 文件 → 返回 [](新建存档/ephemeral save 兜底).
 * 只提取 messages,不提取 processNodes —— agent 注入路径(recentHistory)只给干净正文,
 * processNodes 留给前端渲染 / agent 主动 workspace_read 查.
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
  return records.flatMap((record) => record.messages)
}

/**
 * 从 workspace 文件列表重建完整会话历史(SessionHistoryEntry[]),含 processNodes.
 * 与 `getHistoryFromTurnFiles` 的区别:后者只展平 messages(给 agent 干净正文),
 * 本函数保留每个 turn 的完整结构(正文 + 过程节点),给前端单源重建完整玩家视角.
 * 空目录/无 turn 文件 → 返回 [].
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
      messages: record.messages,
      ...(record.processNodes ? { processNodes: record.processNodes } : {}),
      ...(record.stats ? { stats: record.stats } : {}),
    })
  }
  entries.sort((left, right) => left.turn - right.turn)
  return entries
}
