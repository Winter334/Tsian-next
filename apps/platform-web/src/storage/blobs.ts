// 内容寻址 blob 表读写：checkpoint 状态文件按 SHA-256 哈希去重存储。
//
// checkpoint 不再内嵌全量文件内容，改存 thin manifest（path→hash 引用）。
// 跨检查点未变更文件共享同一 (hash, ownerSaveId) blob 行，零重复拷贝。
//
// 哈希计算是异步的（crypto.subtle.digest），不能在 Dexie 事务内 await——
// 调用方须在事务外算好哈希、拿到 manifest，再进小事务写 blobs/checkpoints（见 checkpoints.ts）。

import { localDb, type LocalBlobRecord } from "./db"
import type { CheckpointWorkspaceFile } from "./workspace"

/** SHA-256 hex。文本文件哈 content，二进制文件哈 data Blob。 */
async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** 算单个文件的内容哈希。文本文件用 content，二进制文件用 data Blob。 */
export async function hashFile(file: CheckpointWorkspaceFile): Promise<string> {
  if (file.data) {
    return sha256Hex(await file.data.arrayBuffer())
  }
  return sha256Hex(new TextEncoder().encode(file.content).buffer)
}

/** 幂等写入 blob：同 (hash, ownerSaveId) 已存在则跳过，不存在才 put。
 *  返回传入的 hash，供调用方组装 manifest。 */
export async function putBlobIfAbsent(
  ownerSaveId: string,
  file: CheckpointWorkspaceFile,
  hash: string,
): Promise<void> {
  const existing = await localDb.blobs.get([hash, ownerSaveId])
  if (existing) return
  const record: LocalBlobRecord = {
    hash,
    ownerSaveId,
    content: typeof file.content === "string" ? file.content : "",
    ...(file.data ? { data: file.data } : {}),
    size: file.data ? file.data.size : (typeof file.content === "string" ? file.content.length : 0),
    createdAt: Date.now(),
  }
  await localDb.blobs.put(record)
}

/** 按 (hash, ownerSaveId) 取 blob，重建 CheckpointWorkspaceFile（内容或二进制）。 */
export async function getBlob(
  hash: string,
  ownerSaveId: string,
): Promise<LocalBlobRecord | undefined> {
  return localDb.blobs.get([hash, ownerSaveId])
}

/** 删存档时清该 save 全部 blob（按 ownerSaveId 索引精准清）。 */
export async function deleteBlobsForSave(ownerSaveId: string): Promise<void> {
  await localDb.blobs.where("ownerSaveId").equals(ownerSaveId).delete()
}

/** GC：删该 save 内未被任何 manifest 引用的孤儿 blob。
 *  全表扫算引用集（不做增量引用计数）——单 save blob 行数几十到低百量级，
 *  裁剪每回合一次被 LLM 耗时淹没，开销可忽略。 */
export async function deleteOrphanBlobs(
  ownerSaveId: string,
  referencedHashes: Set<string>,
): Promise<void> {
  const saveBlobs = await localDb.blobs.where("ownerSaveId").equals(ownerSaveId).toArray()
  await Promise.all(
    saveBlobs
      .filter((blob) => !referencedHashes.has(blob.hash))
      .map((blob) => localDb.blobs.delete([blob.hash, blob.ownerSaveId])),
  )
}
