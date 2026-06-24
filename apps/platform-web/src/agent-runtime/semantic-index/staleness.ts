import type { WorkspaceFile, WorkspaceScope } from "@tsian/contracts"

import { getEmbeddingsByOwner } from "./index-store"
import { enqueueEmbed, enqueueDelete } from "./embed-queue"

/**
 * semantic-index staleness — 廉价 staleness 校验,正确性源头.
 *
 * 正确性不依赖"完美捕获所有写路径"(executeWorkspaceMutation 注释明确 staged
 * turn 的 transaction 攒变更不进 dispatch). staleness 兜底让所有写路径(staged
 * commit、直接调 volume、卡导入、studio 编辑)都不丢正确性,只丢一点性能.
 *
 * 两处触发:
 * - **搜索时**(search.ts):枚举 owner 文件,比 file.updatedAt vs 索引
 *   fileUpdatedAt,只重嵌 stale/missing 的 chunk(异步补,本次查询用现有索引).
 * - **turn commit 后**(platform-host proactive enqueue):对当轮文件跑同样的
 *   staleness 检查 + 入队,让索引在每轮后自动追新,不等下次搜索才补.
 */

/**
 * 找出 stale/missing 的文件:文件 updatedAt 晚于索引记录的 fileUpdatedAt,
 * 或文件存在但索引里完全没记录. 返回需重嵌的文件列表.
 */
export async function findStaleFiles(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  ownerId: string,
): Promise<{ stale: WorkspaceFile[]; deletedPaths: string[] }> {
  if (files.length === 0) {
    // 文件全没了 → 索引里该 owner 的记录都该删.
    const existing = await getEmbeddingsByOwner(scope, ownerId)
    return {
      stale: [],
      deletedPaths: existing.map((r) => r.path),
    }
  }

  const existing = await getEmbeddingsByOwner(scope, ownerId)
  // path → 该 path 索引记录里最新的 fileUpdatedAt.
  const indexedByPath = new Map<string, number>()
  for (const record of existing) {
    const prev = indexedByPath.get(record.path)
    if (prev === undefined || record.fileUpdatedAt > prev) {
      indexedByPath.set(record.path, record.fileUpdatedAt)
    }
  }

  const filePaths = new Set(files.map((f) => f.path))
  const stale: WorkspaceFile[] = []
  for (const file of files) {
    const indexedAt = indexedByPath.get(file.path)
    // missing(索引里没该 path)或 stale(文件比索引新)→ 需重嵌.
    if (indexedAt === undefined || file.updatedAt > indexedAt) {
      stale.push(file)
    }
  }

  // 索引里有但文件没了 → 该删(文件被删除).
  const deletedPaths: string[] = []
  for (const path of indexedByPath.keys()) {
    if (!filePaths.has(path)) {
      deletedPaths.push(path)
    }
  }

  return { stale, deletedPaths }
}

/**
 * proactive enqueue 入口:对一批 save-runtime 文件做 staleness 检查 + 入队
 * embed/delete. 供 turn commit 后(platform-host)调用,让索引每轮后自动追新.
 * 同步入队(异步消费),不阻塞 turn.
 */
export async function enqueueStaleEmbeddings(
  ownerId: string,
  files: WorkspaceFile[],
  scope: WorkspaceScope = "save-runtime",
): Promise<void> {
  const { stale, deletedPaths } = await findStaleFiles(files, scope, ownerId)
  for (const file of stale) {
    enqueueEmbed(scope, ownerId, file)
  }
  for (const path of deletedPaths) {
    enqueueDelete(scope, ownerId, path)
  }
}
