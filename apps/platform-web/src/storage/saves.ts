import type {
  ConversationMessageRecord,
  WorkspaceFile,
} from "@tsian/contracts"
import {
  localDb,
  type LocalGameCardRecord,
  type LocalSaveRecord,
} from "./db"
import {
  createCheckpointForSave,
  buildCheckpointRecordForSave,
  deleteCheckpointsForSave,
  pruneCheckpointsForSave,
} from "./checkpoints"
import { deleteBlobsForSave } from "./blobs"
import { getBuiltinBlankGameCard } from "./game-cards"
import {
  createDefaultSaveRuntimeFiles,
  createLocalWorkspaceFileRecord,
  deleteWorkspaceForSave,
  listWorkspaceFilesForSave,
  saveRuntimeFilesFromEffectiveWorkspace,
} from "./workspace"
import { getMaxTurnFromTurnFiles, getHistoryFromTurnFiles, isAppendOnlyLogPath } from "../platform-host/history-turns"

const ACTIVE_SAVE_KEY = "active-save-id"

function createSaveId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `save-${Date.now()}`
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
): Promise<LocalSaveRecord> {
  const card = await getBuiltinBlankGameCard()
  return createLocalSaveFromGameCard(card, { name })
}

export async function createLocalSaveFromGameCard(
  card: LocalGameCardRecord,
  input: {
    name?: string
  } = {},
): Promise<LocalSaveRecord> {
  const existing = await localDb.saves.count()
  const now = Date.now()

  const save: LocalSaveRecord = {
    id: createSaveId(),
    name: input.name?.trim() || `Session ${existing + 1}`,
    gameCardId: card.manifest.id,
    gameCardVersion: card.manifest.version,
    createdAt: now,
    updatedAt: now,
  }

  const workspaceRecords = createDefaultSaveRuntimeFiles().map((file) =>
    createLocalWorkspaceFileRecord(save.id, file)
  )
  const checkpointWorkspaceFiles = workspaceRecords
    .map(({ id: _id, saveId: _saveId, ...file }) => file)
    // 追加型日志（turn 文件 + traces）不进 checkpoint（与 commitSuccessfulRuntimeTurnForSave 一致）。
    .filter((file) => !isAppendOnlyLogPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
  // 事务外：算哈希 + 写 blobs → 产出 thin-manifest checkpoint 记录。
  const checkpoint = await buildCheckpointRecordForSave(save.id, {
    turn: 0,
    reason: "initial",
    label: "初始状态",
    files: checkpointWorkspaceFiles,
  }, now)

  await localDb.transaction(
    "rw",
    [
      localDb.saves,
      localDb.workspaceFiles,
      localDb.checkpoints,
    ],
    async () => {
      await localDb.saves.put(save)

      for (const record of workspaceRecords) {
        await localDb.workspaceFiles.put(record)
      }
      await localDb.checkpoints.put(checkpoint)
    },
  )

  return save
}

export async function commitSuccessfulRuntimeTurnForSave(
  saveId: string,
  input: {
    history: ConversationMessageRecord[]
    workspaceFiles: WorkspaceFile[]
    checkpointReason: "after-turn"
  },
): Promise<void> {
  const now = Date.now()

  const workspaceRecords = new Map<string, ReturnType<typeof createLocalWorkspaceFileRecord>>()
  for (const file of saveRuntimeFilesFromEffectiveWorkspace(input.workspaceFiles)) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    workspaceRecords.set(record.path, record)
  }

  const checkpointWorkspaceFiles = Array.from(workspaceRecords.values())
    .map(({ id: _id, saveId: _saveId, ...file }) => file)
    // 追加型日志（turn 文件 + traces）不进 checkpoint（存档级共享；回溯到 N = 裁剪到 1..N）。
    .filter((file) => !isAppendOnlyLogPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
  // turn 号从存档 workspaceFiles 里的 turn 文件取 max(新档 0,第 N 回后 N).
  // 注意：从 workspaceRecords（含 turn 文件）取，不是从 checkpointWorkspaceFiles（已剔除 turn）取。
  const checkpointTurn = getMaxTurnFromTurnFiles(
    Array.from(workspaceRecords.values()).map((f) => ({ path: f.path, content: f.content, updatedAt: f.updatedAt, createdAt: f.createdAt })),
  )
  // 事务外：算哈希 + 写 blobs → 产出 thin-manifest checkpoint 记录。
  // crypto.subtle.digest 是异步的，不能在 Dexie 事务内 await。
  const checkpoint = await buildCheckpointRecordForSave(saveId, {
    turn: checkpointTurn,
    reason: input.checkpointReason,
    files: checkpointWorkspaceFiles,
  }, now)

  await localDb.transaction(
    "rw",
    [
      localDb.saves,
      localDb.workspaceFiles,
      localDb.checkpoints,
    ],
    async () => {
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

  // 回合提交后裁剪检查点 + GC 孤儿 blob（每回合一次，开销被 LLM 调用淹没）。
  await pruneCheckpointsForSave(saveId)
}

/**
 * Commit only workspace files for a save (no snapshot/history/checkpoint update).
 * Used by `invokeAgent` persistent path to write context.json without advancing
 * turn or polluting the narrative snapshot. Mirrors the workspace-file portion of
 * `commitSuccessfulRuntimeTurnForSave` but skips snapshot, history, and checkpoint.
 */
export async function commitWorkspaceFilesForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
): Promise<void> {
  const workspaceRecords = new Map<string, ReturnType<typeof createLocalWorkspaceFileRecord>>()
  for (const file of saveRuntimeFilesFromEffectiveWorkspace(workspaceFiles)) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    workspaceRecords.set(record.path, record)
  }

  await localDb.transaction(
    "rw",
    [localDb.saves, localDb.workspaceFiles],
    async () => {
      const existingWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
      await Promise.all(existingWorkspace.map((record) => localDb.workspaceFiles.delete(record.id)))
      for (const record of workspaceRecords.values()) {
        await localDb.workspaceFiles.put(record)
      }

      const save = await localDb.saves.get(saveId)
      if (save) {
        await localDb.saves.put({
          ...save,
          updatedAt: Date.now(),
        })
      }
    },
  )
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
  await localDb.saves.delete(saveId)

  await deleteWorkspaceForSave(saveId)
  await deleteCheckpointsForSave(saveId)
  // 清该 save 的内容寻址 blob（按 ownerSaveId 精准清，checkpoint 已删 blob 全成孤儿）。
  await deleteBlobsForSave(saveId)
  // GC:删存档时 drop 该 save 的语义检索向量索引(save-runtime scope,随存档生灭).
  await localDb.embeddingIndex
    .where("[scope+ownerId]")
    .equals(["save-runtime", saveId])
    .delete()
}

export async function getHistoryForSave(
  saveId: string,
): Promise<ConversationMessageRecord[]> {
  const files = await listWorkspaceFilesForSave(saveId)
  return getHistoryFromTurnFiles(files)
}
