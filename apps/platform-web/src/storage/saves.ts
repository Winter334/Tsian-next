import type {
  ConversationMessageRecord,
  WorkspaceFile,
} from "@tsian/contracts"
import {
  localDb,
  type LocalGameCardRecord,
  type LocalSaveRecord,
  type LocalWorkspaceFileRecord,
} from "./db"
import {
  createCheckpointForSave,
  buildCheckpointRecordForSave,
  deleteCheckpointsForSave,
  pruneCheckpointsForSave,
} from "./checkpoints"
import { deleteBlobsForSave } from "./blobs"
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

export async function commitWorkspaceChangesWithCheckpointForSave(
  saveId: string,
  changes: RuntimeWorkspaceChanges,
  input: {
    turn: number
    checkpointReason: "post-turn-maintenance"
  },
): Promise<void> {
  const normalized = recordsFromWorkspaceChanges(saveId, changes)
  const protectedCheckpointId = await getProtectedFrontendDebugCheckpointId(saveId)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = Date.now()
    const currentWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
    const currentSignature = workspaceRecordSignature(currentWorkspace)
    const mergedWorkspace = applyWorkspaceChangesToRecords(currentWorkspace, normalized)
    const checkpoint = await buildCheckpointRecordForSave(saveId, {
      turn: input.turn,
      reason: input.checkpointReason,
      label: `回合 ${input.turn} · 维护`,
      files: checkpointFilesFromRecords(mergedWorkspace),
    }, now)

    const committed = await localDb.transaction(
      "rw",
      [localDb.saves, localDb.workspaceFiles, localDb.checkpoints],
      async () => {
        const latestWorkspace = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
        if (workspaceRecordSignature(latestWorkspace) !== currentSignature) {
          return false
        }

        await applyWorkspaceChangesInTransaction(saveId, normalized)

        // replace-on-create (design D3): 删同 turn 的 after-turn checkpoint，让维护点
        // 取代 pre-maintenance 状态成为该回合的规范 checkpoint。
        // 不删 manual/initial/其它 turn 的记录。
        const sameTurnAfterTurnCheckpoints = await localDb.checkpoints
          .where("saveId")
          .equals(saveId)
          .and((cp) => (
            cp.turn === input.turn
            && cp.reason === "after-turn"
            && cp.id !== protectedCheckpointId
          ))
          .toArray()
        await Promise.all(
          sameTurnAfterTurnCheckpoints.map((cp) => localDb.checkpoints.delete(cp.id)),
        )

        await localDb.checkpoints.put(checkpoint)

        const save = await localDb.saves.get(saveId)
        if (save) {
          await localDb.saves.put({
            ...save,
            updatedAt: now,
          })
        }
        return true
      },
    )

    if (committed) {
      await pruneCheckpointsForSave(saveId)
      return
    }
  }

  throw new Error("Workspace changed while creating the invokeAgent maintenance checkpoint; retry the invocation.")
}

/**
 * Commit workspace files for a save AND create a `post-turn-maintenance` checkpoint
 * in the same Dexie transaction. Used by `invokeAgent` `workspace-with-checkpoint`
 * commit mode: maintenance-style invocations (e.g. post-turn stage-manager) commit
 * the post-maintenance workspace and create a recoverable checkpoint so restore to
 * that turn reflects the post-maintenance state (not the pre-maintenance one).
 *
 * Full-replace workspace + checkpoint helper for callers that own the entire
 * save workspace snapshot. Side-channel invokeAgent commits must use
 * `commitWorkspaceChangesWithCheckpointForSave`, which merges explicit staged
 * changes into current persisted workspace before checkpointing.
 *
 * Mirrors the Dexie transaction structure of `commitSuccessfulRuntimeTurnForSave`
 * with key differences for a side-channel-style commit:
 * - checkpoint turn = caller-supplied `turn` (the helper does NOT advance turn).
 * - reason = `"post-turn-maintenance"` (debugging/restore distinction).
 * - label = `回合 ${turn} · 维护`.
 * - replace-on-create (design D3): inside the same transaction, delete this save's
 *   `after-turn` checkpoints where `turn === input.turn`, so the maintenance point
 *   supersedes the pre-maintenance after-turn point. Does NOT delete
 *   `manual`/`initial`/other-turn records.
 * - does NOT write history or update runtimeSnapshot (invokeAgent doesn't advance turn).
 *
 * After the transaction, calls `pruneCheckpointsForSave(saveId)` (same as the main
 * turn-commit path).
 */
export async function commitWorkspaceFilesWithCheckpointForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
  input: {
    turn: number
    checkpointReason: "post-turn-maintenance"
  },
): Promise<void> {
  const now = Date.now()
  const protectedCheckpointId = await getProtectedFrontendDebugCheckpointId(saveId)

  const workspaceRecords = new Map<string, ReturnType<typeof createLocalWorkspaceFileRecord>>()
  for (const file of saveRuntimeFilesFromEffectiveWorkspace(workspaceFiles)) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    workspaceRecords.set(record.path, record)
  }

  const checkpointWorkspaceFiles = Array.from(workspaceRecords.values())
    .map(({ id: _id, saveId: _saveId, ...file }) => file)
    // 追加型日志（turn 文件 + traces）不进 checkpoint（存档级共享；回溯到 N = 裁剪到 1..N）。
    .filter((file) => !isAppendOnlyLogPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
  // 事务外：算哈希 + 写 blobs → 产出 thin-manifest checkpoint 记录。
  // crypto.subtle.digest 是异步的，不能在 Dexie 事务内 await。
  const checkpoint = await buildCheckpointRecordForSave(saveId, {
    turn: input.turn,
    reason: input.checkpointReason,
    label: `回合 ${input.turn} · 维护`,
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

      // replace-on-create (design D3): 删同 turn 的 after-turn checkpoint，让维护点
      // 取代 pre-maintenance 状态成为该回合的规范 checkpoint。
      // 不删 manual/initial/其它 turn 的记录。
      const sameTurnAfterTurnCheckpoints = await localDb.checkpoints
        .where("saveId")
        .equals(saveId)
        .and((cp) => (
          cp.turn === input.turn
          && cp.reason === "after-turn"
          && cp.id !== protectedCheckpointId
        ))
        .toArray()
      await Promise.all(
        sameTurnAfterTurnCheckpoints.map((cp) => localDb.checkpoints.delete(cp.id)),
      )

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

  // 维护 checkpoint 提交后裁剪检查点 + GC 孤儿 blob（与主回合提交一致）。
  await pruneCheckpointsForSave(saveId)
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
