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
  workspaceFiles: Array<Omit<LocalWorkspaceFileRecord, "id" | "saveId">>
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
  assistantAttachments!: Table<LocalAssistantAttachmentRecord, string>
  skillConfigs!: Table<LocalSkillConfigRecord, string>
  embeddingIndex!: Table<LocalEmbeddingIndexRecord, string>

  constructor() {
    // DB name bumped v10 -> v11: added embeddingIndex table for save-runtime
    // semantic search vector index (task 06-24-save-runtime-semantic-search).
    // Prototype project — no migration; the old v11 database is abandoned and
    // a fresh v12 store is created (same rename-and-reset convention).
    // The service worker
    // (`tsian-game-card-frontend-sw.js`) mirrors this name.
    super("tsian-agent-runtime-v12")

    this.version(1).stores({
      meta: "&key",
      gameCards: "&id, source, updatedAt",
      gameCardContentFiles: "&id, gameCardId, path, updatedAt",
      gameCardFrontendFiles: "&id, gameCardId, path, updatedAt",
      saves: "&id, updatedAt",
      checkpoints: "&id, saveId, createdAt, turn",
      workspaceFiles: "&id, saveId, path, updatedAt",
      assistantAttachments: "&id, sessionId, path, createdAt",
      skillConfigs: "&skillPath, updatedAt",
      embeddingIndex: "&id, [scope+ownerId], path, type, updatedAt",
    })
  }
}

export const localDb = new TsianLocalDb()
