import type {
  AttachmentRef,
  GameCardManifest,
  WorkspaceScope,
} from "@tsian/contracts"
import Dexie, { type Table } from "dexie"

export interface LocalMetaRecord {
  key: string
  value: string
}

export interface LocalSaveRecord {
  id: string
  name: string
  gameCardId?: string
  gameCardVersion?: string
  createdAt: number
  updatedAt: number
}

export interface LocalGameCardRecord {
  id: string
  manifest: GameCardManifest
  source: "builtin" | "local" | "imported"
  createdAt: number
  updatedAt: number
}

export interface LocalGameCardContentFileRecord {
  /** Internal deterministic table key, same keying as gameCardFrontendFiles. */
  id: string
  gameCardId: string
  /** Package-root path (no leading slash). */
  path: string
  /** Text content for text files. Empty for binary files that use `data`. */
  content: string
  /** Binary payload for media files (covers, etc.). Mutually exclusive with
   *  meaningful `content`. mediaType is derived via `inferMediaTypeFromPath`
   *  or `data.type` at consumption — not stored. */
  data?: Blob
  createdAt: number
  updatedAt: number
}

export interface LocalGameCardFrontendFileRecord {
  /** Internal deterministic table key. */
  id: string
  gameCardId: string
  /** Package-root path, normally under frontend/. */
  path: string
  data: Blob
  size: number
  createdAt: number
  updatedAt: number
}

export interface LocalWorkspaceFileRecord {
  /** Internal deterministic table key. */
  id: string
  saveId: string
  /** Root-relative normalized workspace path without a leading slash. */
  path: string
  /** Text content for text files. Empty for binary files that use `data`. */
  content: string
  /** Binary payload for media files. Mutually exclusive with meaningful
   *  `content`. mediaType is derived via `inferMediaTypeFromPath` or
   *  `data.type` at consumption — not stored. */
  data?: Blob
  createdAt: number
  updatedAt: number
}

export interface LocalCheckpointRecord {
  id: string
  saveId: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  /** Thin manifest：状态文件按内容哈希引用 blob 表（turn 文件不进 manifest，存档级共享）。
   *  内容寻址去重——跨检查点未变更文件共享一份 blob，零重复拷贝。 */
  manifest: Array<{ path: string; hash: string; createdAt: number; updatedAt: number }>
}

/** 内容寻址 blob：按 SHA-256 哈希存一份文件内容，跨检查点去重。
 *  复合主键 (hash, ownerSaveId)——本地 per-save，GC/删存档按 ownerSaveId 精准清理。
 *  云阶段升 per-user 共享时加 ownerUserId 维度。 */
export interface LocalBlobRecord {
  /** 内容哈希（SHA-256 hex） */
  hash: string
  /** 归属存档（GC 按 ownerSaveId 过滤，不跨 save 算引用） */
  ownerSaveId: string
  /** 文本内容（文本文件）；二进制文件为空字符串 */
  content: string
  /** 二进制内容（二进制文件）；文本文件无此字段 */
  data?: Blob
  /** 字节数 */
  size: number
  createdAt: number
}

export interface LocalAssistantAttachmentRecord {
  /** 主键,UUID 或确定性 id. */
  id: string
  /** 所属会话 id. 用于会话删除时批量清理. */
  sessionId: string
  /** VFS 路径,形如 "temp/<sessionId>/<filename>". */
  path: string
  /** 原始文件名. */
  name: string
  /** MIME 类型. */
  mimeType: string
  /** 文件种类: image 走多模态, text 走文本注入. */
  kind: "image" | "text"
  /** Blob 本体. */
  data: Blob
  /** 文件大小(字节). */
  size: number
  createdAt: number
}

/**
 * Player-saved overrides for a skill's `skill.config` items.
 * Keyed by the skill directory path (e.g. "skills/web-search"). The `values`
 * field is a JSON-serialized `Record<string, string>` of player-entered
 * overrides; secrets stored here never enter the workspace and are never
 * exported with a skill package.
 */
export interface LocalSkillConfigRecord {
  /** Skill directory path, e.g. "skills/web-search". */
  skillPath: string
  /** JSON.stringify of the player override values (`Record<string, string>`). */
  values: string
  updatedAt: number
}

/**
 * save-runtime 语义检索的向量索引记录. 按 (scope, ownerId) 分库,随存档生灭
 * (删存档时 drop 对应记录). 主键 id 确定性拼接,向量存 Float32Array
 * (IndexedDB Structured Clone 支持 TypedArray).
 */
export interface LocalEmbeddingIndexRecord {
  /** 主键,确定性 id: `${scope}:${ownerId}:${path}:${chunkIndex}` */
  id: string
  scope: WorkspaceScope
  ownerId: string
  path: string
  chunkIndex: number
  /** 嵌入文本(供 staleness 比对 + 调试). */
  text: string
  /** 向量. Float32Array → IndexedDB 存储(Structured Clone 支持). */
  vector: Float32Array
  /** 路径派生的语料类型. */
  type: "turn" | "agent-notes" | "memory-summary"
  /** raw turn 的 turn 编号(仅 type=turn). */
  turn?: number
  /** 原始文件 createdAt(用于近因加权,可选). */
  fileCreatedAt?: number
  /** 文件 updatedAt 快照(staleness 比对基准). */
  fileUpdatedAt: number
  /** 向量写入时间戳. */
  updatedAt: number
  /** 产出该向量的 embedding 模型标识(版本锁/staleness 判据). */
  model: string
}

export class TsianLocalDb extends Dexie {
  meta!: Table<LocalMetaRecord, string>
  gameCards!: Table<LocalGameCardRecord, string>
  gameCardContentFiles!: Table<LocalGameCardContentFileRecord, string>
  gameCardFrontendFiles!: Table<LocalGameCardFrontendFileRecord, string>
  saves!: Table<LocalSaveRecord, string>
  checkpoints!: Table<LocalCheckpointRecord, string>
  workspaceFiles!: Table<LocalWorkspaceFileRecord, string>
  blobs!: Table<LocalBlobRecord, [string, string]>
  assistantAttachments!: Table<LocalAssistantAttachmentRecord, string>
  skillConfigs!: Table<LocalSkillConfigRecord, string>
  embeddingIndex!: Table<LocalEmbeddingIndexRecord, string>

  constructor() {
    // DB name bumped v12 -> v13: added blobs table for checkpoint content-addressing
    // (task 06-26-checkpoint-storage-dedup). Checkpoint workspaceFiles → thin manifest
    // referencing blobs by SHA-256 hash; cross-checkpoint dedup of unchanged state files.
    // Prototype project — no migration; the old v12 database is abandoned and
    // a fresh v13 store is created (same rename-and-reset convention).
    // The service worker
    // (`tsian-game-card-frontend-sw.js`) mirrors this name.
    super("tsian-agent-runtime-v13")

    this.version(1).stores({
      meta: "&key",
      gameCards: "&id, source, updatedAt",
      gameCardContentFiles: "&id, gameCardId, path, updatedAt",
      gameCardFrontendFiles: "&id, gameCardId, path, updatedAt",
      saves: "&id, updatedAt",
      checkpoints: "&id, saveId, createdAt, turn",
      workspaceFiles: "&id, saveId, path, updatedAt",
      blobs: "&[hash+ownerSaveId], ownerSaveId",
      assistantAttachments: "&id, sessionId, path, createdAt",
      skillConfigs: "&skillPath, updatedAt",
      embeddingIndex: "&id, [scope+ownerId], path, type, updatedAt",
    })
  }
}

export const localDb = new TsianLocalDb()
