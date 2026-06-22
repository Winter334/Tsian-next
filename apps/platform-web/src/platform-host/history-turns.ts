import type {
  AgentContextSnapshot,
  ConversationMessageRecord,
  RuntimeSnapshotShell,
  WorkspaceFile,
} from "@tsian/contracts"
import type { RuntimeWorkspaceTransaction } from "../storage"
import {
  AGENT_CONTEXT_PATH,
  appendTurnToContext,
  createEmptyAgentContext,
  parseAgentContext,
  serializeAgentContext,
} from "../agent-runtime/context-lifecycle"

const AIRP_HISTORY_TURN_SCHEMA = "tsian.airp.history.turn.v1"
const AIRP_HISTORY_TURN_PATH_PREFIX = "save/history/turns/"

interface RawAirpHistoryTurnRecord {
  schema: typeof AIRP_HISTORY_TURN_SCHEMA
  turn: number
  createdAt: string
  source: {
    kind: "agent-runtime"
    entryAgentId: string
  }
  messages: ConversationMessageRecord[]
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
  }

  return `${JSON.stringify(record, null, 2)}\n`
}

/**
 * 从工作区文件读 master agent 会话上下文快照(agents/master/context.json).
 * 文件不存在/损坏 → 返回 null(由 runtime 层兜底初始化).
 */
export function readAgentContextFromWorkspace(
  workspaceFiles: WorkspaceFile[],
  saveId: string,
): AgentContextSnapshot | null {
  const file = workspaceFiles.find((f) => f.path === AGENT_CONTEXT_PATH)
  if (!file) return null
  return parseAgentContext(file.content, saveId)
}

/**
 * turn 收尾:把本轮正文追加进 context.json,若本轮开头压缩了则用压缩后快照.
 * 原地更新(workspaceTransaction.write),与其它 stage 函数同事务提交.
 */
export function stageAgentContextFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    saveId: string
    turn: number
    user: string
    assistant: string
    compressedContext?: AgentContextSnapshot
  },
): WorkspaceFile {
  // 基础快照:本轮压缩了→用压缩结果;否则读现有 context.json,无则空快照
  const base =
    input.compressedContext
    ?? readAgentContextFromWorkspace(workspaceTransaction.workspaceFiles, input.saveId)
    ?? createEmptyAgentContext(input.saveId)
  // 追加本轮正文(保持最近 K 轮),saveId 用真实值修正(runtime 兜底时可能为空)
  const updated = appendTurnToContext(
    { ...base, saveId: input.saveId },
    input.turn,
    input.user,
    input.assistant,
  )
  return workspaceTransaction.write({
    path: AGENT_CONTEXT_PATH,
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
    ),
  })
}
