import type {
  ConversationMessageRecord,
  RuntimeSnapshotShell,
  WorkspaceFile,
} from "@tsian/contracts"
import {
  localDb,
  type LocalGameCardRecord,
  type LocalSaveHistoryRecord,
  type LocalSaveRecord,
  type LocalSaveSnapshotRecord,
} from "./db"
import {
  createCheckpointForSave,
  createCheckpointRecordForSave,
  deleteCheckpointsForSave,
} from "./checkpoints"
import { getBuiltinBlankGameCard } from "./game-cards"
import {
  createDefaultSaveRuntimeFiles,
  createLocalWorkspaceFileRecord,
  deleteWorkspaceForSave,
  saveRuntimeFilesFromEffectiveWorkspace,
} from "./workspace"

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
      // 保留 attachments 字段(附件引用元数据);非数组或缺失时省略.
      const attachments = Array.isArray(item.attachments) ? { attachments: item.attachments } : {}
      return { role: item.role, content: item.content, ...attachments }
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
  const card = await getBuiltinBlankGameCard()
  return createLocalSaveFromGameCard(card, { name, snapshot })
}

export async function createLocalSaveFromGameCard(
  card: LocalGameCardRecord,
  input: {
    name?: string
    snapshot?: RuntimeSnapshotShell
  } = {},
): Promise<LocalSaveRecord> {
  const existing = await localDb.saves.count()
  const now = Date.now()
  const snapshot = input.snapshot ?? createEmptyRuntimeSnapshot()
  const history = normalizeMessages(snapshot.state.messages)

  const save: LocalSaveRecord = {
    id: createSaveId(),
    name: input.name?.trim() || `Session ${existing + 1}`,
    gameCardId: card.manifest.id,
    gameCardVersion: card.manifest.version,
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

  const workspaceRecords = createDefaultSaveRuntimeFiles().map((file) =>
    createLocalWorkspaceFileRecord(save.id, file)
  )
  const checkpointWorkspaceFiles = workspaceRecords
    .map(({ id: _id, saveId: _saveId, ...file }) => file)
    .sort((left, right) => left.path.localeCompare(right.path))
  const checkpoint = createCheckpointRecordForSave(save.id, {
    snapshot: snapshotRecord.snapshot,
    history,
    reason: "initial",
    label: "初始状态",
    workspaceFiles: checkpointWorkspaceFiles,
  }, now)

  await localDb.transaction(
    "rw",
    [
      localDb.saves,
      localDb.saveSnapshots,
      localDb.saveHistory,
      localDb.workspaceFiles,
      localDb.checkpoints,
    ],
    async () => {
      await localDb.saves.put(save)
      await localDb.saveSnapshots.put(snapshotRecord)
      await localDb.saveHistory.put(historyRecord)

      for (const record of workspaceRecords) {
        await localDb.workspaceFiles.put(record)
      }
      await localDb.checkpoints.put(checkpoint)
    },
  )

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

export async function commitSuccessfulRuntimeTurnForSave(
  saveId: string,
  input: {
    snapshot: RuntimeSnapshotShell
    history: ConversationMessageRecord[]
    workspaceFiles: WorkspaceFile[]
    checkpointReason: "after-turn"
  },
): Promise<void> {
  const now = Date.now()
  const normalizedMessages = normalizeMessages(input.history)
  const nextSnapshot: RuntimeSnapshotShell = {
    ...input.snapshot,
    state: {
      ...input.snapshot.state,
      messages: normalizedMessages,
      globals: input.snapshot.state.globals ?? {},
    },
  }

  const workspaceRecords = new Map<string, ReturnType<typeof createLocalWorkspaceFileRecord>>()
  for (const file of saveRuntimeFilesFromEffectiveWorkspace(input.workspaceFiles)) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    workspaceRecords.set(record.path, record)
  }

  const checkpointWorkspaceFiles = Array.from(workspaceRecords.values())
    .map(({ id: _id, saveId: _saveId, ...file }) => file)
    .sort((left, right) => left.path.localeCompare(right.path))
  const checkpoint = createCheckpointRecordForSave(saveId, {
    snapshot: nextSnapshot,
    history: normalizedMessages,
    reason: input.checkpointReason,
    workspaceFiles: checkpointWorkspaceFiles,
  }, now)

  await localDb.transaction(
    "rw",
    [
      localDb.saves,
      localDb.saveSnapshots,
      localDb.saveHistory,
      localDb.workspaceFiles,
      localDb.checkpoints,
    ],
    async () => {
      await localDb.saveSnapshots.put({
        saveId,
        snapshot: nextSnapshot,
      })
      await localDb.saveHistory.put({
        saveId,
        messages: normalizedMessages,
      })

      const existingWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
      await Promise.all(existingWorkspace.map((record) => localDb.workspaceFiles.delete(record.id)))
      for (const record of workspaceRecords.values()) {
        await localDb.workspaceFiles.put(record)
      }

      await localDb.checkpoints.put(checkpoint)

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

export async function renameLocalSave(saveId: string, name: string): Promise<LocalSaveRecord> {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new Error("存档名不能为空。")
  }

  const existing = await localDb.saves.get(saveId)
  if (!existing) {
    throw new Error(`存档 "${saveId}" 不存在。`)
  }

  const updated: LocalSaveRecord = { ...existing, name: trimmed, updatedAt: Date.now() }
  await localDb.saves.put(updated)
  return updated
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

  await deleteWorkspaceForSave(saveId)
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
    reason,
    label,
  })
}
