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
import { isAppendOnlyLogPath, extractTurnFromLogPath } from "../platform-host/history-turns"
import { hashFile, putBlobIfAbsent, getBlob, deleteOrphanBlobs } from "./blobs"
import { getPlatformConfig } from "../config/platform-config"

export interface LocalCheckpointSummary extends CheckpointSummary {
  saveId: string
}

function createCheckpointId(saveId: string, createdAt: number): string {
  return `${saveId}:checkpoint:${createdAt}:${Math.random().toString(36).slice(2, 8)}`
}

export function toCheckpointSummary(record: LocalCheckpointRecord): LocalCheckpointSummary {
  return {
    id: record.id,
    saveId: record.saveId,
    turn: record.turn,
    label: record.label,
    reason: record.reason,
    createdAt: record.createdAt,
    // turn 文件不进 checkpoint（去冗余），messageCount 直接取 record.turn（= turn 文件数）。
    messageCount: record.turn,
    workspaceFileCount: record.manifest.length,
  }
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
    turn: number
    reason: LocalCheckpointRecord["reason"]
    label?: string
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
  return {
    id: createCheckpointId(saveId, createdAt),
    saveId,
    turn,
    label: input.label?.trim() || `回合 ${turn}`,
    reason: input.reason,
    createdAt,
    manifest,
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
  // 追加型日志（turn 文件 + traces）不进 checkpoint，存档级共享，恢复时裁剪到 1..N。
  const files = (await listCheckpointWorkspaceFilesForSave(saveId))
    .filter((f) => !isAppendOnlyLogPath(f.path))
  const record = await buildCheckpointRecordForSave(saveId, { ...input, files })

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
        .and((cp) => cp.turn > targetTurn)
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

  return { turn: targetTurn }
}

export async function deleteCheckpointsForSave(saveId: string): Promise<void> {
  const rows = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.checkpoints.delete(item.id)))
}

// ── 裁剪 + GC（Block D）──

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
 * 裁剪某存档的检查点：保留最近 keepRecent + 每 sparseEvery 回一稀疏点 + 所有 initial/manual + 当前回合点，
 * 删其余 after-turn 点。删除后全表扫该 save 剩余 manifest 算引用集，清孤儿 blob（简单全表扫 GC）。
 *
 * 挂 `commitSuccessfulRuntimeTurnForSave` 末尾，每回合一次——回合含 LLM 调用（秒级），
 * GC 开销（几十×几十）被淹没。不做增量引用计数，避免建/删/恢复三处维护 refCount 的一致性风险。
 */
export async function pruneCheckpointsForSave(saveId: string): Promise<void> {
  const { keepRecent, sparseEvery } = getCheckpointPruneConfig()
  const records = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  if (records.length === 0) return

  // 按 createdAt 降序（新→旧），便于"保留最近 N 条"。
  const sorted = records.sort((left, right) => right.createdAt - left.createdAt)
  const currentTurn = sorted.length > 0 ? Math.max(...records.map((r) => r.turn)) : 0

  const keepIds = new Set<string>()
  for (const cp of sorted) {
    // 保留：initial / manual（用户或系统显式建的，不自动回收）。
    if (cp.reason === "initial" || cp.reason === "manual") {
      keepIds.add(cp.id)
      continue
    }
    // 保留：最近 keepRecent 条 after-turn。
    const recentRank = sorted
      .filter((r) => r.reason === "after-turn")
      .findIndex((r) => r.id === cp.id)
    if (recentRank >= 0 && recentRank < keepRecent) {
      keepIds.add(cp.id)
      continue
    }
    // 保留：每 sparseEvery 回一稀疏点（turn % sparseEvery === 0）。
    if (cp.turn > 0 && cp.turn % sparseEvery === 0) {
      keepIds.add(cp.id)
      continue
    }
    // 保留：当前回合点（刚建的，绝不能立即删）。
    if (cp.turn === currentTurn) {
      keepIds.add(cp.id)
      continue
    }
  }

  const toDelete = records.filter((cp) => !keepIds.has(cp.id))
  if (toDelete.length === 0) return

  await Promise.all(toDelete.map((cp) => localDb.checkpoints.delete(cp.id)))

  // GC：全表扫该 save 剩余 checkpoint 的 manifest → 引用集 → 删孤儿 blob。
  const remaining = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
  const referencedHashes = new Set<string>()
  for (const cp of remaining) {
    for (const entry of cp.manifest) {
      referencedHashes.add(entry.hash)
    }
  }
  await deleteOrphanBlobs(saveId, referencedHashes)
}
