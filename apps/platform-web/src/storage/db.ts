import type {
  AttachmentRef,
  ConversationMessageRecord,
  GameCardManifest,
  RuntimeSnapshotShell,
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

export interface LocalSaveSnapshotRecord {
  saveId: string
  snapshot: RuntimeSnapshotShell
}

export interface LocalSaveHistoryRecord {
  saveId: string
  messages: ConversationMessageRecord[]
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
  snapshot: RuntimeSnapshotShell
  history: ConversationMessageRecord[]
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

export class TsianLocalDb extends Dexie {
  meta!: Table<LocalMetaRecord, string>
  gameCards!: Table<LocalGameCardRecord, string>
  gameCardContentFiles!: Table<LocalGameCardContentFileRecord, string>
  gameCardFrontendFiles!: Table<LocalGameCardFrontendFileRecord, string>
  saves!: Table<LocalSaveRecord, string>
  saveSnapshots!: Table<LocalSaveSnapshotRecord, string>
  saveHistory!: Table<LocalSaveHistoryRecord, string>
  checkpoints!: Table<LocalCheckpointRecord, string>
  workspaceFiles!: Table<LocalWorkspaceFileRecord, string>
  assistantAttachments!: Table<LocalAssistantAttachmentRecord, string>
  skillConfigs!: Table<LocalSkillConfigRecord, string>

  constructor() {
    // DB name bumped v9 -> v10: added skillConfigs table for player-saved
    // skill config overrides (task 06-24-assistant-web-search). Prototype
    // project — no migration; the old v9 database is abandoned and a fresh
    // v10 store is created. The service worker
    // (`tsian-game-card-frontend-sw.js`) mirrors this name.
    super("tsian-agent-runtime-v10")

    this.version(1).stores({
      meta: "&key",
      gameCards: "&id, source, updatedAt",
      gameCardContentFiles: "&id, gameCardId, path, updatedAt",
      gameCardFrontendFiles: "&id, gameCardId, path, updatedAt",
      saves: "&id, updatedAt",
      saveSnapshots: "&saveId",
      saveHistory: "&saveId",
      checkpoints: "&id, saveId, createdAt, turn",
      workspaceFiles: "&id, saveId, path, updatedAt",
      assistantAttachments: "&id, sessionId, path, createdAt",
      skillConfigs: "&skillPath, updatedAt",
    })
  }
}

export const localDb = new TsianLocalDb()
