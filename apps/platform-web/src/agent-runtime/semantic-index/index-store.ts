import type { WorkspaceScope } from "@tsian/contracts"

import { localDb, type LocalEmbeddingIndexRecord } from "@/storage/db"

/**
 * semantic-index index-store — Dexie `embeddingIndex` 表 CRUD.
 *
 * 按 `[scope+ownerId]` 复合索引整片取/整片删(MVP 主键 `(save-runtime, saveId)`).
 * 向量存 Float32Array(Structured Clone 支持 TypedArray,Phase 2 已验证 Dexie
 * 版本兼容). 查询时取回类型应是 Float32Array,非 ArrayBuffer——search.ts 取回后
 * 直接做 cosine,若类型异常则该记录视为损坏跳过.
 *
 * 确定性主键 id:`${scope}:${ownerId}:${path}:${chunkIndex}`,使 upsert 幂等.
 */

/** 确定性主键拼接. */
export function buildEmbeddingRecordId(
  scope: WorkspaceScope,
  ownerId: string,
  path: string,
  chunkIndex: number,
): string {
  return `${scope}:${ownerId}:${path}:${chunkIndex}`
}

/** 取某 owner 的全部向量记录(cosine 候选集). */
export async function getEmbeddingsByOwner(
  scope: WorkspaceScope,
  ownerId: string,
): Promise<LocalEmbeddingIndexRecord[]> {
  return localDb.embeddingIndex
    .where("[scope+ownerId]")
    .equals([scope, ownerId])
    .toArray()
}

/**
 * 按 path 先删后插(upsert). 同一文件切块后产生多个 chunkIndex,先删该 path
 * 全部旧 chunk 再插新的,保证 chunkIndex 连续且无 stale 残留.
 */
export async function upsertEmbeddings(
  scope: WorkspaceScope,
  ownerId: string,
  records: LocalEmbeddingIndexRecord[],
): Promise<void> {
  if (records.length === 0) {
    return
  }
  const paths = Array.from(new Set(records.map((r) => r.path)))
  await localDb.transaction("rw", localDb.embeddingIndex, async () => {
    // 先删该 owner 下这些 path 的全部旧记录.
    for (const path of paths) {
      await deleteEmbeddingsByPath(scope, ownerId, path)
    }
    await localDb.embeddingIndex.bulkPut(records)
  })
}

/** 删某 path 的全部 chunk 记录(文件删除/重写时). */
export async function deleteEmbeddingsByPath(
  scope: WorkspaceScope,
  ownerId: string,
  path: string,
): Promise<void> {
  await localDb.embeddingIndex
    .where({ scope, ownerId, path })
    .delete()
}

/** 删某 owner 全部记录(GC:删存档时 drop 这片向量). */
export async function deleteEmbeddingsByOwner(
  scope: WorkspaceScope,
  ownerId: string,
): Promise<void> {
  await localDb.embeddingIndex
    .where("[scope+ownerId]")
    .equals([scope, ownerId])
    .delete()
}
