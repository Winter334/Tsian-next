import type { RuntimeSnapshotShell } from "@tsian/contracts"
import {
  localDb,
  type LocalArchiveRecord,
  type LocalCheckpointRecord,
  type LocalEventRecord,
  type LocalMemoryRecord,
  type LocalSaveHistoryRecord,
} from "./db"

export interface CheckpointSummary {
  id: string
  saveId: string
  turn: number
  label: string
  reason: LocalCheckpointRecord["reason"]
  createdAt: number
  messageCount: number
  eventCount: number
  archiveCount: number
  memoryRecordCount: number
}

type CheckpointArchiveRecord = LocalCheckpointRecord["archives"][number]
type CheckpointMemoryRecord = LocalCheckpointRecord["memoryRecords"][number]

function createCheckpointId(saveId: string, createdAt: number): string {
  return `${saveId}:checkpoint:${createdAt}:${Math.random().toString(36).slice(2, 8)}`
}

function snapshotTurn(snapshot: RuntimeSnapshotShell): number {
  return typeof snapshot.state.turn === "number" ? snapshot.state.turn : 0
}

function toCheckpointSummary(record: LocalCheckpointRecord): CheckpointSummary {
  return {
    id: record.id,
    saveId: record.saveId,
    turn: record.turn,
    label: record.label,
    reason: record.reason,
    createdAt: record.createdAt,
    messageCount: record.history.length,
    eventCount: record.events.length,
    archiveCount: record.archives.length,
    memoryRecordCount: record.memoryRecords.length,
  }
}

export async function createCheckpointForSave(
  saveId: string,
  input: {
    snapshot: RuntimeSnapshotShell
    history: LocalSaveHistoryRecord["messages"]
    events: LocalEventRecord[]
    archives: LocalArchiveRecord[]
    memoryRecords: LocalMemoryRecord[]
    reason: LocalCheckpointRecord["reason"]
    label?: string
  },
): Promise<CheckpointSummary> {
  const createdAt = Date.now()
  const turn = snapshotTurn(input.snapshot)
  const record: LocalCheckpointRecord = {
    id: createCheckpointId(saveId, createdAt),
    saveId,
    turn,
    label: input.label?.trim() || `回合 ${turn}`,
    reason: input.reason,
    createdAt,
    snapshot: input.snapshot,
    history: input.history,
    events: input.events.map(({ saveId: _saveId, updatedAt: _updatedAt, ...event }) => event),
    archives: input.archives.map(({ saveId: _saveId, updatedAt: _updatedAt, ...archive }) => archive),
    memoryRecords: input.memoryRecords.map(
      ({ saveId: _saveId, updatedAt: _updatedAt, ...memory }) => memory,
    ),
  }

  await localDb.checkpoints.put(record)
  return toCheckpointSummary(record)
}

export async function listCheckpointsForSave(saveId: string): Promise<CheckpointSummary[]> {
  const records = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  return records.sort((left, right) => right.createdAt - left.createdAt).map(toCheckpointSummary)
}

function toLocalArchiveRecord(
  archive: CheckpointArchiveRecord,
  saveId: string,
  updatedAt: number,
): LocalArchiveRecord {
  return {
    ...archive,
    saveId,
    updatedAt,
  } as LocalArchiveRecord
}

function toLocalMemoryRecord(
  memory: CheckpointMemoryRecord,
  saveId: string,
  updatedAt: number,
): LocalMemoryRecord {
  return {
    ...memory,
    saveId,
    updatedAt,
  }
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
    localDb.tables,
    async () => {
      await localDb.saveSnapshots.put({
        saveId,
        snapshot: checkpoint.snapshot,
      })
      await localDb.saveHistory.put({
        saveId,
        messages: checkpoint.history,
      })

      const events = await localDb.events.where("saveId").equals(saveId).toArray()
      await Promise.all(events.map((item) => localDb.events.delete(item.id)))
      for (const [index, event] of checkpoint.events.entries()) {
        await localDb.events.put({
          ...event,
          saveId,
          updatedAt: now + index,
        })
      }

      const archives = await localDb.archives.where("saveId").equals(saveId).toArray()
      await Promise.all(archives.map((item) => localDb.archives.delete(item.id)))
      for (const [index, archive] of checkpoint.archives.entries()) {
        await localDb.archives.put(toLocalArchiveRecord(archive, saveId, now + index))
      }

      const memoryRecords = await localDb.memoryRecords.where("saveId").equals(saveId).toArray()
      await Promise.all(memoryRecords.map((item) => localDb.memoryRecords.delete(item.id)))
      for (const [index, memory] of checkpoint.memoryRecords.entries()) {
        await localDb.memoryRecords.put(toLocalMemoryRecord(memory, saveId, now + index))
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
