import type {
  WorkspaceFile,
  WorkspaceScope,
  WorkspaceSearchResult,
  WorkspaceSemanticType,
} from "@tsian/contracts"

import { embed } from "./embedding-client"
import { getEmbeddingsByOwner } from "./index-store"
import { enqueueStaleEmbeddings } from "./staleness"
import { getPlatformConfig } from "../../config/platform-config"

/**
 * semantic-index search — save-runtime 语义检索主流程.
 *
 * 检索流程(成本地板):
 *   查询 → embed 查询(1 次 embedding)
 *        → staleness 兜底(异步补,本次用现有索引)
 *        → type pre-filter(免费)
 *        → cosine top-K(免费算术)
 *        → 返回 [{path, turn, type, preview}, ...]
 *        → agent 读候选 → 自选 → workspace.read 取原文
 *
 * 全程不抛错:索引空 / API 失败 → 返回空数组. agent 收到空自然回退字面 search.
 * 无 reranker / 无查询改写 LLM pass:消费端是每回合本就在跑的 agent,返回带元数据
 * 的小 K 候选让它自己判断 + workspace.read 取原文,已付费的 agent 推理顺手做了
 * reranker 的活.
 */

/** 读平台配置 rag 段(默认 5/8).同步读 cache. */
function getRagDefaultLimit(): number {
  return getPlatformConfig().rag.defaultLimit
}
function getRagMaxLimit(): number {
  return getPlatformConfig().rag.maxLimit
}
const PREVIEW_LENGTH = 96

export interface SemanticSearchInput {
  /** 自然语言查询. */
  query: string
  /** 语料类型过滤(turn/agent-notes/memory-summary),可选. */
  typeFilter?: WorkspaceSemanticType
  /** 返回条数上限,默认 5,上限 8. */
  limit?: number
  /** owner(save-runtime 下为 saveId). */
  ownerId: string
  /** 该 owner 的 save-runtime 文件(供 staleness 兜底枚举). */
  files: WorkspaceFile[]
}

/**
 * 执行语义检索. 全程不抛错:索引空/API 失败 → 返回空数组.
 *
 * @param scope 固定 "save-runtime"(MVP 唯一 scope).
 */
export async function semanticSearch(
  input: SemanticSearchInput,
  scope: WorkspaceScope = "save-runtime",
): Promise<WorkspaceSearchResult[]> {
  const query = input.query?.trim()
  if (!query) {
    return []
  }

  // 1. embed 查询. 失败 → 返回空(不抛错).
  let queryVector: Float32Array
  try {
    const vectors = await embed([query])
    if (vectors.length === 0 || !vectors[0]) {
      return []
    }
    queryVector = vectors[0]
  } catch {
    // embedding API 失败(未配置/网络/维度错)→ 返回空,agent 回退字面 search.
    return []
  }

  // 2. staleness 兜底:枚举 owner 文件,比 file.updatedAt vs 索引 fileUpdatedAt,
  //    stale/missing 的文件异步补嵌(本次查询用现有索引,不等补完).
  //    用 void:不阻塞本次查询,补嵌在后台异步进行.
  void enqueueStaleEmbeddings(input.ownerId, input.files, scope)

  // 3. 取候选向量(该 owner 全部).
  const records = await getEmbeddingsByOwner(scope, input.ownerId)
  if (records.length === 0) {
    // 索引完全空:返回空,不抛错.
    return []
  }

  // 4. type pre-filter(免费).
  const filtered = input.typeFilter
    ? records.filter((r) => r.type === input.typeFilter)
    : records

  if (filtered.length === 0) {
    return []
  }

  // 5. cosine 排序 + top-K.
  const limit = normalizeLimit(input.limit)
  const scored = filtered
    .map((record) => ({
      record,
      score: cosineSimilarity(queryVector, record.vector),
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  // 6. 结果构造:复用 WorkspaceSearchResult 外壳 + 元数据回显.
  //    cosine 相似度直接填 score(不另设 semanticScore).matches 省略(语义无行级命中).
  //    preview = chunk.text 前 96 字符.
  return scored.map((entry) => ({
    path: entry.record.path,
    name: basename(entry.record.path),
    updatedAt: entry.record.updatedAt,
    score: entry.score,
    matches: [],
    matchesTruncated: false,
    preview: entry.record.text.slice(0, PREVIEW_LENGTH),
    semanticType: entry.record.type,
    ...(entry.record.turn !== undefined ? { turn: entry.record.turn } : {}),
  }))
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return getRagDefaultLimit()
  }
  return Math.min(Math.floor(limit), getRagMaxLimit())
}

/** cosine 相似度. 向量维度不一致或零向量 → 返回 -Infinity(被 filter 掉). */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) {
    return Number.NEGATIVE_INFINITY
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i]
    const bv = b[i]
    if (av === undefined || bv === undefined) {
      return Number.NEGATIVE_INFINITY
    }
    dot += av * bv
    normA += av * av
    normB += bv * bv
  }
  if (normA === 0 || normB === 0) {
    return Number.NEGATIVE_INFINITY
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/")
  return idx >= 0 ? path.slice(idx + 1) : path
}
