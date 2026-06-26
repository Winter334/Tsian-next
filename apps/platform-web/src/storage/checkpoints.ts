import type { CheckpointSummary } from "@tsian/contracts"
import {
  localDb,
  type LocalCheckpointRecord,
} from "./db"
import {
  createLocalWorkspaceFileRecord,
  type CheckpointWorkspaceFile,
  listCheckpointWorkspaceFilesForSave,
} from "./workspace"
import { getMaxTurnFromTurnFiles } from "../platform-host/history-turns"

export interface LocalCheckpointSummary extends CheckpointSummary {
  saveId: string
}

function createCheckpointId(saveId: string, createdAt: number): string {
  return `${saveId}:checkpoint:${createdAt}:${Math.random().toString(36).slice(2, 8)}`
}

/** 数 workspaceFiles 里的 turn 文件数(给 messageCount 显示). */
function countTurnFiles(workspaceFiles: CheckpointWorkspaceFile[]): number {
  return workspaceFiles.filter(
    (f) => f.path.startsWith("save/history/turns/") && f.path.endsWith(".json"),
  ).length
}

export function toCheckpointSummary(record: LocalCheckpointRecord): LocalCheckpointSummary {
  return {
    id: record.id,
    saveId: record.saveId,
    turn: record.turn,
    label: record.label,
    reason: record.reason,
    createdAt: record.createdAt,
    messageCount: countTurnFiles(record.workspaceFiles),
    workspaceFileCount: record.workspaceFiles.length,
  }
}

export function createCheckpointRecordForSave(
  saveId: string,
  input: {
    turn: number
    reason: LocalCheckpointRecord["reason"]
    label?: string
    workspaceFiles: CheckpointWorkspaceFile[]
  },
  createdAt: number = Date.now(),
): LocalCheckpointRecord {
  const turn = input.turn
  return {
    id: createCheckpointId(saveId, createdAt),
    saveId,
    turn,
    label: input.label?.trim() || `回合 ${turn}`,
    reason: input.reason,
    createdAt,
    workspaceFiles: input.workspaceFiles,
  }
}

export async function createCheckpointForSave(
  saveId: string,
  input: {
    turn: number
    reason: LocalCheckpointRecord["reason"]
    label?: string
  },
): Promise<LocalCheckpointSummary> {
  const record = createCheckpointRecordForSave(saveId, {
    ...input,
    workspaceFiles: await listCheckpointWorkspaceFilesForSave(saveId),
  })

  await localDb.checkpoints.put(record)
  return toCheckpointSummary(record)
}

export async function listCheckpointsForSave(
  saveId: string,
): Promise<LocalCheckpointSummary[]> {
  const records = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  return records.sort((left, right) => right.createdAt - left.createdAt).map(toCheckpointSummary)
}

export async function restoreCheckpointForSave(
  saveId: string,
  checkpointId: string,
): Promise<{ turn: number } | null> {
  const checkpoint = await localDb.checkpoints.get(checkpointId)
  if (!checkpoint || checkpoint.saveId !== saveId) {
    return null
  }

  const now = Date.now()
  await localDb.transaction(
    "rw",
    [
      localDb.saves,
      localDb.workspaceFiles,
    ],
    async () => {
      const workspaceFiles = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
      await Promise.all(workspaceFiles.map((item) => localDb.workspaceFiles.delete(item.id)))
      for (const workspaceFile of checkpoint.workspaceFiles) {
        await localDb.workspaceFiles.put(
          createLocalWorkspaceFileRecord(saveId, workspaceFile),
        )
      }

      const save = await localDb.saves.get(saveId)
      if (save) {
        await localDb.saves.put({
          ...save,
          updatedAt: now,
        })
      }
    },
  )

  // turn 号从恢复后的 workspaceFiles 取 max(回溯到第 N 回 = turn 文件 1..N).
  const turn = getMaxTurnFromTurnFiles(
    checkpoint.workspaceFiles.map((f) => ({ path: f.path, content: f.content, updatedAt: f.updatedAt, createdAt: f.createdAt })),
  )
  return { turn }
}

export async function deleteCheckpointsForSave(saveId: string): Promise<void> {
  const rows = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.checkpoints.delete(item.id)))
}
