import type {
  ConversationMessageRecord,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import {
  localDb,
  type LocalSaveHistoryRecord,
  type LocalSaveRecord,
  type LocalSaveSnapshotRecord,
} from "./db"
import { createCheckpointForSave, deleteCheckpointsForSave } from "./checkpoints"
import { deleteStateRecordsForSave, listLocalStateRecordsForSave } from "./state-records"

const ACTIVE_SAVE_KEY = "active-save-id"

function createSaveId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `save-${Date.now()}`
}

function normalizeMessages(
  messages: ConversationMessageRecord[] | undefined,
): ConversationMessageRecord[] {
  if (!Array.isArray(messages)) {
    return []
  }

  return messages.flatMap((item) => {
    if (typeof item?.role === "string" && typeof item.content === "string") {
      return [{ role: item.role, content: item.content }]
    }
    return []
  })
}

export function createEmptyRuntimeSnapshot(): RuntimeSnapshotShell {
  return {
    version: "0.0.0",
    state: {
      turn: 0,
      messages: [],
      globals: {},
    },
  }
}

export async function listLocalSaves(): Promise<LocalSaveRecord[]> {
  return localDb.saves.orderBy("updatedAt").reverse().toArray()
}

export async function getActiveSaveId(): Promise<string | null> {
  const record = await localDb.meta.get(ACTIVE_SAVE_KEY)
  return record?.value ?? null
}

export async function setActiveSaveId(saveId: string | null): Promise<void> {
  if (!saveId) {
    await localDb.meta.delete(ACTIVE_SAVE_KEY)
    return
  }

  await localDb.meta.put({
    key: ACTIVE_SAVE_KEY,
    value: saveId,
  })
}

export async function createLocalSave(
  name?: string,
  snapshot: RuntimeSnapshotShell = createEmptyRuntimeSnapshot(),
): Promise<LocalSaveRecord> {
  const existing = await localDb.saves.count()
  const now = Date.now()
  const history = normalizeMessages(snapshot.state.messages)

  const save: LocalSaveRecord = {
    id: createSaveId(),
    name: name?.trim() || `Session ${existing + 1}`,
    createdAt: now,
    updatedAt: now,
  }

  const snapshotRecord: LocalSaveSnapshotRecord = {
    saveId: save.id,
    snapshot: {
      ...snapshot,
      state: {
        ...snapshot.state,
        messages: history,
        globals: snapshot.state.globals ?? {},
      },
    },
  }

  const historyRecord: LocalSaveHistoryRecord = {
    saveId: save.id,
    messages: history,
  }

  await localDb.transaction(
    "rw",
    localDb.saves,
    localDb.saveSnapshots,
    localDb.saveHistory,
    async () => {
      await localDb.saves.put(save)
      await localDb.saveSnapshots.put(snapshotRecord)
      await localDb.saveHistory.put(historyRecord)
    },
  )

  await createCheckpointForSave(save.id, {
    snapshot: snapshotRecord.snapshot,
    history,
    stateRecords: [],
    reason: "initial",
    label: "初始状态",
  })

  return save
}

export async function getSnapshotForSave(
  saveId: string,
): Promise<RuntimeSnapshotShell> {
  const record = await localDb.saveSnapshots.get(saveId)
  return record?.snapshot ?? createEmptyRuntimeSnapshot()
}

export async function saveRuntimeForSave(
  saveId: string,
  snapshot: RuntimeSnapshotShell,
  messages: ConversationMessageRecord[],
): Promise<void> {
  const now = Date.now()
  const normalizedMessages = normalizeMessages(messages)
  const nextSnapshot: RuntimeSnapshotShell = {
    ...snapshot,
    state: {
      ...snapshot.state,
      messages: normalizedMessages,
      globals: snapshot.state.globals ?? {},
    },
  }

  await localDb.transaction(
    "rw",
    localDb.saves,
    localDb.saveSnapshots,
    localDb.saveHistory,
    async () => {
      await localDb.saveSnapshots.put({
        saveId,
        snapshot: nextSnapshot,
      })
      await localDb.saveHistory.put({
        saveId,
        messages: normalizedMessages,
      })

      const save = await localDb.saves.get(saveId)
      if (save) {
        await localDb.saves.put({
          ...save,
          updatedAt: now,
        })
      }
    },
  )
}

export async function saveSnapshotForSave(
  saveId: string,
  snapshot: RuntimeSnapshotShell,
): Promise<void> {
  await saveRuntimeForSave(saveId, snapshot, normalizeMessages(snapshot.state.messages))
}

export async function deleteLocalSave(saveId: string): Promise<void> {
  await localDb.transaction(
    "rw",
    localDb.saves,
    localDb.saveSnapshots,
    localDb.saveHistory,
    async () => {
      await localDb.saves.delete(saveId)
      await localDb.saveSnapshots.delete(saveId)
      await localDb.saveHistory.delete(saveId)
    },
  )

  await deleteStateRecordsForSave(saveId)
  await deleteCheckpointsForSave(saveId)
}

export async function getHistoryForSave(
  saveId: string,
): Promise<ConversationMessageRecord[]> {
  const record = await localDb.saveHistory.get(saveId)
  return normalizeMessages(record?.messages)
}

export async function saveHistoryForSave(
  saveId: string,
  messages: ConversationMessageRecord[],
): Promise<void> {
  const snapshot = await getSnapshotForSave(saveId)
  await saveRuntimeForSave(saveId, {
    ...snapshot,
    state: {
      ...snapshot.state,
      messages,
    },
  }, messages)
}

export async function createCheckpointFromCurrentSave(
  saveId: string,
  reason: "initial" | "after-turn" | "manual",
  label?: string,
) {
  return createCheckpointForSave(saveId, {
    snapshot: await getSnapshotForSave(saveId),
    history: await getHistoryForSave(saveId),
    stateRecords: await listLocalStateRecordsForSave(saveId),
    reason,
    label,
  })
}
