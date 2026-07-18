import type {
  CheckpointRetention,
  CheckpointSource,
  CheckpointSummary,
  CreateCheckpointOptions,
  ListCheckpointOptions,
  OverwriteCheckpointOptions,
  UpdateCheckpointOptions,
  JsonValue,
} from "@tsian/contracts"
import {
  localDb,
  type LocalCheckpointRecord,
} from "./db"
import {
  createLocalWorkspaceFileRecord,
  type CheckpointWorkspaceFile,
  listCheckpointWorkspaceFilesForSave,
} from "./workspace"
import { isAppendOnlyLogPath, extractTurnFromLogPath, getMaxTurnFromTurnFiles } from "../platform-host/history-turns"
import { hashFile, putBlobIfAbsent, getBlob, deleteOrphanBlobs } from "./blobs"
import { getPlatformConfig } from "../config/platform-config"
import { getProtectedFrontendDebugCheckpointId } from "./frontend-debug-session"

export interface LocalCheckpointSummary extends CheckpointSummary {
  saveId: string
}

export type DeleteCheckpointResult = "deleted" | "not-found" | "protected"
export type OverwriteCheckpointResult = LocalCheckpointSummary | "protected" | null

function createCheckpointId(saveId: string, createdAt: number): string {
  return `${saveId}:checkpoint:${createdAt}:${Math.random().toString(36).slice(2, 8)}`
}

function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
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

const LEGACY_REASON_RETENTION: Record<string, CheckpointRetention> = {
  initial: "pinned",
  manual: "pinned",
  "after-turn": "auto",
  "post-turn-maintenance": "auto",
}

const LEGACY_REASON_SOURCE: Record<string, CheckpointSource> = {
  initial: "platform",
  manual: "user",
  "after-turn": "platform",
  "post-turn-maintenance": "agent",
}

function defaultRetentionForReason(reason: string | undefined): CheckpointRetention {
  return reason ? LEGACY_REASON_RETENTION[reason] ?? "auto" : "auto"
}

export function checkpointRetention(record: LocalCheckpointRecord): CheckpointRetention {
  return record.retention ?? defaultRetentionForReason(record.reason)
}

function checkpointVisible(record: LocalCheckpointRecord): boolean {
  return record.visible !== false
}

function checkpointSource(record: LocalCheckpointRecord): CheckpointSource | undefined {
  if (record.source) return record.source
  return record.reason ? LEGACY_REASON_SOURCE[record.reason] : undefined
}

function checkpointTags(record: LocalCheckpointRecord): string[] | undefined {
  return normalizeTags(record.tags)
}

function withMetadataPatch(
  record: LocalCheckpointRecord,
  patch: UpdateCheckpointOptions | OverwriteCheckpointOptions,
  now: number,
): LocalCheckpointRecord {
  const next: LocalCheckpointRecord = {
    ...record,
    label: nonEmptyString(patch.label) ?? record.label,
    updatedAt: now,
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
  if (patch.reason !== undefined) {
    const reason = nonEmptyString(patch.reason)
    if (reason) next.reason = reason
    else delete next.reason
  }

  return next
}

export function toCheckpointSummary(record: LocalCheckpointRecord): LocalCheckpointSummary {
  const source = checkpointSource(record)
  const tags = checkpointTags(record)
  const metadata = cloneMetadata(record.metadata)
  return {
    id: record.id,
    saveId: record.saveId,
    turn: record.turn,
    label: record.label,
    createdAt: record.createdAt,
    ...(record.updatedAt !== undefined ? { updatedAt: record.updatedAt } : {}),
    retention: checkpointRetention(record),
    ...(source ? { source } : {}),
    ...(tags ? { tags } : {}),
    visible: checkpointVisible(record),
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
    // turn 文件不进 checkpoint（去冗余），messageCount 直接取 record.turn（= turn 文件数）。
    messageCount: record.turn,
    workspaceFileCount: record.manifest.length,
  }
}

function stateFilesFromCheckpointFiles(files: CheckpointWorkspaceFile[]): CheckpointWorkspaceFile[] {
  return files
    .filter((file) => !isAppendOnlyLogPath(file.path))
    .sort((left, right) => left.path.localeCompare(right.path))
}

async function collectReferencedBlobHashes(saveId: string): Promise<Set<string>> {
  const remaining = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  const referencedHashes = new Set<string>()
  for (const cp of remaining) {
    for (const entry of cp.manifest) {
      referencedHashes.add(entry.hash)
    }
  }
  return referencedHashes
}

async function garbageCollectBlobsForSave(saveId: string): Promise<void> {
  await deleteOrphanBlobs(saveId, await collectReferencedBlobHashes(saveId))
}

async function touchSave(saveId: string, updatedAt: number): Promise<void> {
  const save = await localDb.saves.get(saveId)
  if (!save) return
  await localDb.saves.put({ ...save, updatedAt })
}

/**
 * 建 thin-manifest checkpoint：状态文件算 SHA-256 → blobs.putIfAbsent → manifest 引用。
 *
 * 哈希计算是异步的（crypto.subtle），不能在 Dexie 事务内 await——
 * 故先在事务外算全部哈希 + 写 blobs，再由调用方进小事务写 checkpoint 记录。
 * 本函数只负责产出 record（含 manifest），不写 checkpoints 表（调用方控制事务边界）。
 */
export async function buildCheckpointRecordForSave(
  saveId: string,
  input: {
    id?: string
    turn: number
    reason?: string
    label?: string
    retention?: CheckpointRetention
    source?: CheckpointSource
    tags?: string[]
    visible?: boolean
    metadata?: Record<string, JsonValue>
    updatedAt?: number
    /** 状态文件（已剔除 turn 文件，由调用方过滤） */
    files: CheckpointWorkspaceFile[]
  },
  createdAt: number = Date.now(),
): Promise<LocalCheckpointRecord> {
  const turn = input.turn
  // 事务外：逐文件算哈希 + 幂等写 blob。
  const manifest: LocalCheckpointRecord["manifest"] = []
  for (const file of input.files) {
    const hash = await hashFile(file)
    await putBlobIfAbsent(saveId, file, hash)
    manifest.push({ path: file.path, hash, createdAt: file.createdAt, updatedAt: file.updatedAt })
  }

  const reason = nonEmptyString(input.reason)
  const tags = normalizeTags(input.tags)
  const metadata = cloneMetadata(input.metadata)
  return {
    id: input.id ?? createCheckpointId(saveId, createdAt),
    saveId,
    turn,
    label: nonEmptyString(input.label) ?? `回合 ${turn}`,
    ...(reason ? { reason } : {}),
    createdAt,
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
    retention: input.retention ?? defaultRetentionForReason(reason),
    ...(input.source ? { source: input.source } : {}),
    ...(tags ? { tags } : {}),
    visible: input.visible ?? true,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    manifest,
  }
}

export async function createCheckpointForSave(
  saveId: string,
  input: CreateCheckpointOptions & { turn?: number } = {},
): Promise<LocalCheckpointSummary> {
  const allFiles = await listCheckpointWorkspaceFilesForSave(saveId)
  const turn = input.turn ?? getMaxTurnFromTurnFiles(allFiles)
  const record = await buildCheckpointRecordForSave(saveId, {
    turn,
    reason: input.reason,
    label: input.label,
    retention: input.retention ?? "pinned",
    source: input.source ?? "card",
    tags: input.tags,
    visible: input.visible,
    metadata: input.metadata,
    files: stateFilesFromCheckpointFiles(allFiles),
  })

  await localDb.transaction("rw", [localDb.saves, localDb.checkpoints], async () => {
    await localDb.checkpoints.put(record)
    await touchSave(saveId, Date.now())
  })

  if (checkpointRetention(record) === "auto") {
    await pruneCheckpointsForSave(saveId)
  }
  return toCheckpointSummary(record)
}

export async function updateCheckpointForSave(
  saveId: string,
  checkpointId: string,
  patch: UpdateCheckpointOptions,
): Promise<LocalCheckpointSummary | null> {
  const existing = await localDb.checkpoints.get(checkpointId)
  if (!existing || existing.saveId !== saveId) {
    return null
  }

  const now = Date.now()
  const updated = withMetadataPatch(existing, patch, now)
  await localDb.transaction("rw", [localDb.saves, localDb.checkpoints], async () => {
    await localDb.checkpoints.put(updated)
    await touchSave(saveId, now)
  })
  return toCheckpointSummary(updated)
}

export async function overwriteCheckpointForSave(
  saveId: string,
  checkpointId: string,
  options: OverwriteCheckpointOptions = {},
): Promise<OverwriteCheckpointResult> {
  const protectedCheckpointId = await getProtectedFrontendDebugCheckpointId(saveId)
  if (checkpointId === protectedCheckpointId) {
    return "protected"
  }

  const existing = await localDb.checkpoints.get(checkpointId)
  if (!existing || existing.saveId !== saveId) {
    return null
  }

  const now = Date.now()
  const allFiles = await listCheckpointWorkspaceFilesForSave(saveId)
  const patched = withMetadataPatch(existing, options, now)
  const overwritten = await buildCheckpointRecordForSave(saveId, {
    id: existing.id,
    turn: getMaxTurnFromTurnFiles(allFiles),
    reason: patched.reason,
    label: patched.label,
    retention: checkpointRetention(patched),
    source: patched.source,
    tags: patched.tags,
    visible: patched.visible,
    metadata: patched.metadata,
    updatedAt: now,
    files: stateFilesFromCheckpointFiles(allFiles),
  }, existing.createdAt)

  await localDb.transaction("rw", [localDb.saves, localDb.checkpoints], async () => {
    await localDb.checkpoints.put(overwritten)
    await touchSave(saveId, now)
  })
  await garbageCollectBlobsForSave(saveId)
  return toCheckpointSummary(overwritten)
}

export async function deleteCheckpointForSave(
  saveId: string,
  checkpointId: string,
): Promise<DeleteCheckpointResult> {
  const protectedCheckpointId = await getProtectedFrontendDebugCheckpointId(saveId)
  if (checkpointId === protectedCheckpointId) {
    return "protected"
  }

  const existing = await localDb.checkpoints.get(checkpointId)
  if (!existing || existing.saveId !== saveId) {
    return "not-found"
  }

  const now = Date.now()
  await localDb.transaction("rw", [localDb.saves, localDb.checkpoints], async () => {
    await localDb.checkpoints.delete(checkpointId)
    await touchSave(saveId, now)
  })
  await garbageCollectBlobsForSave(saveId)
  return "deleted"
}

export async function listCheckpointsForSave(
  saveId: string,
  options: ListCheckpointOptions = {},
): Promise<LocalCheckpointSummary[]> {
  const requestedTags = normalizeTags(options.tags) ?? []
  const records = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  return records
    .filter((record) => options.includeHidden === true || checkpointVisible(record))
    .filter((record) => !options.retention || checkpointRetention(record) === options.retention)
    .filter((record) => !options.source || checkpointSource(record) === options.source)
    .filter((record) => requestedTags.every((tag) => (checkpointTags(record) ?? []).includes(tag)))
    .sort((left, right) => right.createdAt - left.createdAt)
    .map(toCheckpointSummary)
}

export async function restoreCheckpointForSave(
  saveId: string,
  checkpointId: string,
  options: { deleteSameTurnAfterCreatedAt?: number } = {},
): Promise<{ turn: number } | null> {
  const checkpoint = await localDb.checkpoints.get(checkpointId)
  if (!checkpoint || checkpoint.saveId !== saveId) {
    return null
  }
  const targetTurn = checkpoint.turn

  // 事务外：按 manifest 预取所有 blob，重建 CheckpointWorkspaceFile[]。
  // getBlob 是异步的，不能在 Dexie 事务内 await。
  const restoredFiles: CheckpointWorkspaceFile[] = []
  for (const entry of checkpoint.manifest) {
    const blob = await getBlob(entry.hash, saveId)
    if (!blob) {
      // blob 丢失（GC 误删 / 数据损坏）——跳过该文件，恢复其余。
      // TODO: 此处可加告警，但不阻断整体恢复。
      continue
    }
    restoredFiles.push({
      path: entry.path,
      content: blob.content,
      ...(blob.data ? { data: blob.data } : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    })
  }

  const now = Date.now()
  await localDb.transaction(
    "rw",
    [
      localDb.saves,
      localDb.workspaceFiles,
      localDb.checkpoints,
    ],
    async () => {
      // ① 覆写状态文件：删光当前非追加日志文件 → 写入从 blob 重建的状态文件。
      //    checkpoint 不含追加日志（turn 文件 + traces，去冗余），存档日志保留不动，下一步裁剪。
      const currentFiles = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
      await Promise.all(
        currentFiles
          .filter((item) => !isAppendOnlyLogPath(item.path))
          .map((item) => localDb.workspaceFiles.delete(item.id)),
      )
      for (const file of restoredFiles) {
        await localDb.workspaceFiles.put(
          createLocalWorkspaceFileRecord(saveId, file),
        )
      }

      // ② 裁剪追加日志到 1..targetTurn：删 turn > targetTurn 的 turn 文件 + trace 文件。
      //    日志 1..targetTurn 本就在存档（追加型），无需从 checkpoint 拷贝。
      await Promise.all(
        currentFiles
          .filter((item) => {
            if (!isAppendOnlyLogPath(item.path)) return false
            const turn = extractTurnFromLogPath(item.path)
            return turn !== null && turn > targetTurn
          })
          .map((item) => localDb.workspaceFiles.delete(item.id)),
      )

      // ③ 删除未来 checkpoint（turn > targetTurn）：被回溯掉的"未来分支"作废。
      //    方案 R：回溯即删，与 turn 文件裁剪语义一致，避免幽灵 checkpoint 污染列表。
      const futureCheckpoints = await localDb.checkpoints
        .where("saveId").equals(saveId)
        .and((cp) => cp.turn > targetTurn || (
          options.deleteSameTurnAfterCreatedAt !== undefined
          && cp.turn === targetTurn
          && cp.createdAt > options.deleteSameTurnAfterCreatedAt
        ))
        .toArray()
      await Promise.all(futureCheckpoints.map((cp) => localDb.checkpoints.delete(cp.id)))

      const save = await localDb.saves.get(saveId)
      if (save) {
        await localDb.saves.put({
          ...save,
          updatedAt: now,
        })
      }
    },
  )

  await garbageCollectBlobsForSave(saveId)
  return { turn: targetTurn }
}

export async function deleteCheckpointsForSave(saveId: string): Promise<void> {
  const rows = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.checkpoints.delete(item.id)))
}

// ── 裁剪 + GC ──

/**
 * 检查点裁剪参数。从平台配置读 `.tsian/local/platform-config.json` 的
 * `checkpointPrune` 段（keepRecent/sparseEvery，默认 50/20）。同步读内存 cache，
 * 不引入 async——platform-config 在 app 启动时预热。
 */
export function getCheckpointPruneConfig(): { keepRecent: number; sparseEvery: number } {
  const { checkpointPrune } = getPlatformConfig()
  return checkpointPrune
}

/**
 * 裁剪某存档的自动检查点：保留 pinned、最近 keepRecent 个 auto、每 sparseEvery 回
 * 一个稀疏 auto、当前回合 auto、以及 frontend-debug 受保护 checkpoint。
 * 删除后全表扫该 save 剩余 manifest 算引用集，清孤儿 blob（简单全表扫 GC）。
 */
export async function pruneCheckpointsForSave(saveId: string): Promise<void> {
  const { keepRecent, sparseEvery } = getCheckpointPruneConfig()
  const [records, protectedCheckpointId] = await Promise.all([
    localDb.checkpoints.where("saveId").equals(saveId).toArray(),
    getProtectedFrontendDebugCheckpointId(saveId),
  ])
  if (records.length === 0) return

  // 按 createdAt 降序（新→旧），便于"保留最近 N 条"。
  const sorted = records.sort((left, right) => right.createdAt - left.createdAt)
  const currentTurn = sorted.length > 0 ? Math.max(...records.map((record) => record.turn)) : 0
  const autoRankById = new Map<string, number>()
  sorted
    .filter((record) => checkpointRetention(record) === "auto")
    .forEach((record, index) => autoRankById.set(record.id, index))

  const keepIds = new Set<string>()
  if (protectedCheckpointId) {
    keepIds.add(protectedCheckpointId)
  }
  for (const cp of sorted) {
    if (checkpointRetention(cp) === "pinned") {
      keepIds.add(cp.id)
      continue
    }

    const recentRank = autoRankById.get(cp.id)
    if (recentRank !== undefined && recentRank < keepRecent) {
      keepIds.add(cp.id)
      continue
    }

    if (cp.turn > 0 && cp.turn % sparseEvery === 0) {
      keepIds.add(cp.id)
      continue
    }

    if (cp.turn === currentTurn) {
      keepIds.add(cp.id)
      continue
    }
  }

  const toDelete = records.filter((cp) => !keepIds.has(cp.id))
  if (toDelete.length === 0) return

  await Promise.all(toDelete.map((cp) => localDb.checkpoints.delete(cp.id)))
  await garbageCollectBlobsForSave(saveId)
}
