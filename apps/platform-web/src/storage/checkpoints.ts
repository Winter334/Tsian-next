import type { CheckpointSummary, RuntimeSnapshotShell } from "@tsian/contracts"
import {
  localDb,
  type LocalCheckpointRecord,
  type LocalSaveHistoryRecord,
} from "./db"
import {
  createLocalWorkspaceFileRecord,
  type CheckpointWorkspaceFile,
  listCheckpointWorkspaceFilesForSave,
} from "./workspace"

export interface LocalCheckpointSummary extends CheckpointSummary {
  saveId: string
}

function createCheckpointId(saveId: string, createdAt: number): string {
  return `${saveId}:checkpoint:${createdAt}:${Math.random().toString(36).slice(2, 8)}`
}

function snapshotTurn(snapshot: RuntimeSnapshotShell): number {
  return typeof snapshot.state.turn === "number" ? snapshot.state.turn : 0
}

export function toCheckpointSummary(record: LocalCheckpointRecord): LocalCheckpointSummary {
  return {
    id: record.id,
    saveId: record.saveId,
    turn: record.turn,
    label: record.label,
    reason: record.reason,
    createdAt: record.createdAt,
    messageCount: record.history.length,
    workspaceFileCount: record.workspaceFiles.length,
  }
}

export function createCheckpointRecordForSave(
  saveId: string,
  input: {
    snapshot: RuntimeSnapshotShell
    history: LocalSaveHistoryRecord["messages"]
    reason: LocalCheckpointRecord["reason"]
    label?: string
    workspaceFiles: CheckpointWorkspaceFile[]
  },
  createdAt: number = Date.now(),
): LocalCheckpointRecord {
  const turn = snapshotTurn(input.snapshot)
  return {
    id: createCheckpointId(saveId, createdAt),
    saveId,
    turn,
    label: input.label?.trim() || `回合 ${turn}`,
    reason: input.reason,
    createdAt,
    snapshot: input.snapshot,
    history: input.history,
    workspaceFiles: input.workspaceFiles,
  }
}

export async function createCheckpointForSave(
  saveId: string,
  input: {
    snapshot: RuntimeSnapshotShell
    history: LocalSaveHistoryRecord["messages"]
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
): Promise<RuntimeSnapshotShell | null> {
  const checkpoint = await localDb.checkpoints.get(checkpointId)
  if (!checkpoint || checkpoint.saveId !== saveId) {
    return null
  }

  const now = Date.now()
  await localDb.transaction(
    "rw",
    [
      localDb.saves,
      localDb.saveSnapshots,
      localDb.saveHistory,
      localDb.workspaceFiles,
    ],
    async () => {
      await localDb.saveSnapshots.put({
        saveId,
        snapshot: checkpoint.snapshot,
      })
      await localDb.saveHistory.put({
        saveId,
        messages: checkpoint.history,
      })

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

  return checkpoint.snapshot
}

export async function deleteCheckpointsForSave(saveId: string): Promise<void> {
  const rows = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.checkpoints.delete(item.id)))
}
