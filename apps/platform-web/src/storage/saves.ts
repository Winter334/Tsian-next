import type {
  ConversationMessageRecord,
  CreateCheckpointOptions,
  JsonValue,
  OverwriteCheckpointOptions,
  WorkspaceFile,
} from "@tsian/contracts"
import {
  localDb,
  type LocalCheckpointRecord,
  type LocalGameCardRecord,
  type LocalSaveRecord,
  type LocalWorkspaceFileRecord,
} from "./db"
import {
  buildCheckpointRecordForSave,
  checkpointRetention,
  deleteCheckpointsForSave,
  pruneCheckpointsForSave,
} from "./checkpoints"
import { deleteBlobsForSave, deleteOrphanBlobs } from "./blobs"
import { getProtectedFrontendDebugCheckpointId } from "./frontend-debug-session"
import { getBuiltinBlankGameCard } from "./game-cards"
import {
  createDefaultSaveRuntimeFiles,
  createLocalWorkspaceFileRecord,
  deleteWorkspaceForSave,
  listWorkspaceFilesForSave,
  saveRuntimeFilesFromEffectiveWorkspace,
} from "./workspace"
import type {
  RuntimeWorkspaceChanges,
  CheckpointWorkspaceFile,
} from "./workspace-types"
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
    retention: "pinned",
    source: "platform",
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
    reason?: string
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
    reason: input.reason,
    retention: "auto",
    source: "platform",
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
 * Full-replace workspace commit helper for callers that own the entire save
 * workspace snapshot. Do not use for side-channel invokeAgent commits: those
 * use `commitWorkspaceChangesForSave` so concurrent frontend bridge writes are
 * preserved.
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

function recordsFromWorkspaceChanges(
  saveId: string,
  changes: RuntimeWorkspaceChanges,
): {
  writtenRecords: Map<string, LocalWorkspaceFileRecord>
  deletedPaths: string[]
} {
  const writtenRecords = new Map<string, LocalWorkspaceFileRecord>()
  for (const file of saveRuntimeFilesFromEffectiveWorkspace(changes.writtenFiles)) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    writtenRecords.set(record.path, record)
  }

  return {
    writtenRecords,
    deletedPaths: Array.from(new Set(changes.deletedPaths)).sort(),
  }
}

function pathMatchesDeletedPath(path: string, deletedPath: string): boolean {
  return path === deletedPath || path.startsWith(`${deletedPath}/`)
}

function applyWorkspaceChangesToRecords(
  records: LocalWorkspaceFileRecord[],
  changes: {
    writtenRecords: Map<string, LocalWorkspaceFileRecord>
    deletedPaths: string[]
  },
): LocalWorkspaceFileRecord[] {
  const recordsByPath = new Map<string, LocalWorkspaceFileRecord>()
  for (const record of records) {
    if (changes.deletedPaths.some((path) => pathMatchesDeletedPath(record.path, path))) {
      continue
    }
    recordsByPath.set(record.path, record)
  }
  for (const record of changes.writtenRecords.values()) {
    recordsByPath.set(record.path, record)
  }
  return Array.from(recordsByPath.values())
    .sort((left, right) => left.path.localeCompare(right.path))
}

function checkpointFilesFromRecords(
  records: LocalWorkspaceFileRecord[],
): CheckpointWorkspaceFile[] {
  return records
    .map(({ id: _id, saveId: _saveId, ...file }) => file)
    // 追加型日志（turn 文件 + traces）不进 checkpoint（存档级共享；回溯到 N = 裁剪到 1..N）。
    .filter((file) => !isAppendOnlyLogPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function workspaceRecordSignature(records: LocalWorkspaceFileRecord[]): string {
  return records
    .map((record) => [
      record.path,
      record.createdAt,
      record.updatedAt,
      record.content,
      record.data?.size ?? 0,
      record.data?.type ?? "",
    ].join("\u0000"))
    .sort()
    .join("\u0001")
}

async function applyWorkspaceChangesInTransaction(
  saveId: string,
  changes: {
    writtenRecords: Map<string, LocalWorkspaceFileRecord>
    deletedPaths: string[]
  },
): Promise<boolean> {
  const existingWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  const changedPaths = new Set<string>()
  for (const record of existingWorkspace) {
    if (changes.deletedPaths.some((path) => pathMatchesDeletedPath(record.path, path))) {
      await localDb.workspaceFiles.delete(record.id)
      changedPaths.add(record.path)
    }
  }
  for (const record of changes.writtenRecords.values()) {
    await localDb.workspaceFiles.put(record)
    changedPaths.add(record.path)
  }
  return changedPaths.size > 0
}

export async function commitWorkspaceChangesForSave(
  saveId: string,
  changes: RuntimeWorkspaceChanges,
): Promise<void> {
  const normalized = recordsFromWorkspaceChanges(saveId, changes)
  if (normalized.writtenRecords.size === 0 && normalized.deletedPaths.length === 0) {
    return
  }

  const now = Date.now()
  await localDb.transaction(
    "rw",
    [localDb.saves, localDb.workspaceFiles],
    async () => {
      const changed = await applyWorkspaceChangesInTransaction(saveId, normalized)
      if (!changed) return
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

function normalizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return undefined
  const normalized = Array.from(
    new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
  )
  return normalized.length > 0 ? normalized : undefined
}

function cloneMetadata(
  metadata: Record<string, JsonValue> | undefined,
): Record<string, JsonValue> | undefined {
  return metadata ? { ...metadata } : undefined
}

function patchCheckpointMetadata(
  record: LocalCheckpointRecord,
  patch: OverwriteCheckpointOptions,
  now: number,
): LocalCheckpointRecord {
  const next: LocalCheckpointRecord = {
    ...record,
    label: patch.label?.trim() || record.label,
    updatedAt: now,
  }
  if (patch.reason !== undefined) {
    const reason = patch.reason.trim()
    if (reason) next.reason = reason
    else delete next.reason
  }
  if (patch.retention !== undefined) next.retention = patch.retention
  if (patch.source !== undefined) next.source = patch.source
  if (patch.tags !== undefined) {
    const tags = normalizeTags(patch.tags)
    if (tags) next.tags = tags
    else delete next.tags
  }
  if (patch.visible !== undefined) next.visible = patch.visible
  if (patch.metadata !== undefined) {
    const metadata = cloneMetadata(patch.metadata)
    if (metadata && Object.keys(metadata).length > 0) next.metadata = metadata
    else delete next.metadata
  }
  return next
}

function findCurrentTurnAutoCheckpoint(
  records: LocalCheckpointRecord[],
  turn: number,
  protectedCheckpointId: string | null,
): LocalCheckpointRecord | undefined {
  return records
    .filter((record) => (
      record.id !== protectedCheckpointId
      && record.turn === turn
      && checkpointRetention(record) === "auto"
    ))
    .sort((left, right) => right.createdAt - left.createdAt)[0]
}

async function garbageCollectCheckpointBlobsForSave(saveId: string): Promise<void> {
  const remaining = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  const referencedHashes = new Set<string>()
  for (const cp of remaining) {
    for (const entry of cp.manifest) {
      referencedHashes.add(entry.hash)
    }
  }
  await deleteOrphanBlobs(saveId, referencedHashes)
}

export type WorkspaceCommitCheckpointOption =
  | false
  | ({ mode: "create" } & CreateCheckpointOptions)
  | ({ mode: "overwrite"; checkpointId: string } & OverwriteCheckpointOptions)
  | {
      mode: "current-turn-auto"
      label?: string
      tags?: string[]
      metadata?: Record<string, JsonValue>
    }

export async function commitWorkspaceChangesWithOptionalCheckpointForSave(
  saveId: string,
  changes: RuntimeWorkspaceChanges,
  input: {
    turn: number
    checkpoint: WorkspaceCommitCheckpointOption
  },
): Promise<void> {
  const normalized = recordsFromWorkspaceChanges(saveId, changes)
  const protectedCheckpointId = await getProtectedFrontendDebugCheckpointId(saveId)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = Date.now()
    const currentWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
    const currentSignature = workspaceRecordSignature(currentWorkspace)
    const mergedWorkspace = applyWorkspaceChangesToRecords(currentWorkspace, normalized)
    const checkpointFiles = checkpointFilesFromRecords(mergedWorkspace)
    const existingCheckpoints = await localDb.checkpoints.where("saveId").equals(saveId).toArray()

    let checkpointToPut: LocalCheckpointRecord | null = null
    let obsoleteCheckpointIds: string[] = []
    if (input.checkpoint && input.checkpoint.mode === "create") {
      checkpointToPut = await buildCheckpointRecordForSave(saveId, {
        turn: input.turn,
        reason: input.checkpoint.reason,
        label: input.checkpoint.label,
        retention: input.checkpoint.retention ?? "pinned",
        source: input.checkpoint.source ?? "agent",
        tags: input.checkpoint.tags,
        visible: input.checkpoint.visible,
        metadata: input.checkpoint.metadata,
        files: checkpointFiles,
      }, now)
    } else if (input.checkpoint && input.checkpoint.mode === "overwrite") {
      const checkpointOption = input.checkpoint
      const existing = existingCheckpoints.find((record) => record.id === checkpointOption.checkpointId)
      if (!existing) {
        throw new Error(`Checkpoint "${checkpointOption.checkpointId}" was not found.`)
      }
      if (existing.saveId !== saveId) {
        throw new Error(`Checkpoint "${checkpointOption.checkpointId}" does not belong to the active save.`)
      }
      const patched = patchCheckpointMetadata(existing, checkpointOption, now)
      checkpointToPut = await buildCheckpointRecordForSave(saveId, {
        id: existing.id,
        turn: input.turn,
        reason: patched.reason,
        label: patched.label,
        retention: checkpointRetention(patched),
        source: patched.source,
        tags: patched.tags,
        visible: patched.visible,
        metadata: patched.metadata,
        updatedAt: now,
        files: checkpointFiles,
      }, existing.createdAt)
    } else if (input.checkpoint && input.checkpoint.mode === "current-turn-auto") {
      const existing = findCurrentTurnAutoCheckpoint(existingCheckpoints, input.turn, protectedCheckpointId)
      if (existing) {
        const patched = patchCheckpointMetadata(existing, {
          label: input.checkpoint.label,
          retention: "auto",
          source: "platform",
          tags: input.checkpoint.tags,
          metadata: input.checkpoint.metadata,
          reason: existing.reason ?? "post-turn-maintenance",
        }, now)
        checkpointToPut = await buildCheckpointRecordForSave(saveId, {
          id: existing.id,
          turn: input.turn,
          reason: patched.reason,
          label: patched.label,
          retention: "auto",
          source: patched.source ?? "platform",
          tags: patched.tags,
          visible: patched.visible,
          metadata: patched.metadata,
          updatedAt: now,
          files: checkpointFiles,
        }, existing.createdAt)
      } else {
        checkpointToPut = await buildCheckpointRecordForSave(saveId, {
          turn: input.turn,
          reason: "post-turn-maintenance",
          label: input.checkpoint.label ?? `回合 ${input.turn} · 维护`,
          retention: "auto",
          source: "platform",
          tags: input.checkpoint.tags,
          metadata: input.checkpoint.metadata,
          files: checkpointFiles,
        }, now)
      }
      obsoleteCheckpointIds = existingCheckpoints
        .filter((record) => (
          record.id !== checkpointToPut!.id
          && record.id !== protectedCheckpointId
          && record.turn === input.turn
          && checkpointRetention(record) === "auto"
        ))
        .map((record) => record.id)
    }

    const committed = await localDb.transaction(
      "rw",
      [localDb.saves, localDb.workspaceFiles, localDb.checkpoints],
      async () => {
        const latestWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
        if (workspaceRecordSignature(latestWorkspace) !== currentSignature) {
          return false
        }

        const changed = await applyWorkspaceChangesInTransaction(saveId, normalized)
        if (checkpointToPut) {
          for (const checkpointId of obsoleteCheckpointIds) {
            await localDb.checkpoints.delete(checkpointId)
          }
          await localDb.checkpoints.put(checkpointToPut)
        }

        if (changed || checkpointToPut) {
          const save = await localDb.saves.get(saveId)
          if (save) {
            await localDb.saves.put({
              ...save,
              updatedAt: now,
            })
          }
        }
        return true
      },
    )

    if (committed) {
      if (checkpointToPut) {
        await pruneCheckpointsForSave(saveId)
        await garbageCollectCheckpointBlobsForSave(saveId)
      }
      return
    }
  }

  throw new Error("Workspace changed while committing invokeAgent workspace changes; retry the invocation.")
}

export async function commitWorkspaceChangesWithCheckpointForSave(
  saveId: string,
  changes: RuntimeWorkspaceChanges,
  input: {
    turn: number
    reason?: string
  },
): Promise<void> {
  await commitWorkspaceChangesWithOptionalCheckpointForSave(saveId, changes, {
    turn: input.turn,
    checkpoint: {
      mode: "current-turn-auto",
      label: `回合 ${input.turn} · 维护`,
      metadata: input.reason ? { legacyReason: input.reason } : undefined,
    },
  })
}

/**
 * @deprecated Use `commitWorkspaceChangesWithOptionalCheckpointForSave` for new callers.
 */
export async function commitWorkspaceFilesWithCheckpointForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
  input: {
    turn: number
    reason?: string
  },
): Promise<void> {
  const workspaceRecords = new Map<string, ReturnType<typeof createLocalWorkspaceFileRecord>>()
  for (const file of saveRuntimeFilesFromEffectiveWorkspace(workspaceFiles)) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    workspaceRecords.set(record.path, record)
  }

  const currentWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  const currentByPath = new Map(currentWorkspace.map((record) => [record.path, record]))
  const writtenFiles: WorkspaceFile[] = []
  const deletedPaths: string[] = []
  for (const record of workspaceRecords.values()) {
    writtenFiles.push({
      path: record.path,
      content: record.content,
      ...(record.data ? { binary: record.data } : {}),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    })
    currentByPath.delete(record.path)
  }
  for (const stale of currentByPath.values()) {
    deletedPaths.push(stale.path)
  }

  await commitWorkspaceChangesWithOptionalCheckpointForSave(saveId, { writtenFiles, deletedPaths }, {
    turn: input.turn,
    checkpoint: {
      mode: "current-turn-auto",
      label: `回合 ${input.turn} · 维护`,
      metadata: input.reason ? { legacyReason: input.reason } : undefined,
    },
  })
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

export async function updateLocalSaveGameCardVersion(saveId: string, gameCardVersion: string): Promise<LocalSaveRecord> {
  const trimmed = gameCardVersion.trim()
  if (!trimmed) {
    throw new Error("游戏卡版本不能为空。")
  }

  const existing = await localDb.saves.get(saveId)
  if (!existing) {
    throw new Error(`存档 "${saveId}" 不存在。`)
  }

  const updated: LocalSaveRecord = { ...existing, gameCardVersion: trimmed }
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
