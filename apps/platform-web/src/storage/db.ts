import type {
  ConversationMessageRecord,
  GameCardManifest,
  GameCardWorkspaceTemplateFile,
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
  workspaceTemplateFiles: GameCardWorkspaceTemplateFile[]
  source: "builtin" | "local" | "imported"
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
  mediaType: string
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
  content: string
  mediaType: string
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

export class TsianLocalDb extends Dexie {
  meta!: Table<LocalMetaRecord, string>
  gameCards!: Table<LocalGameCardRecord, string>
  gameCardFrontendFiles!: Table<LocalGameCardFrontendFileRecord, string>
  saves!: Table<LocalSaveRecord, string>
  saveSnapshots!: Table<LocalSaveSnapshotRecord, string>
  saveHistory!: Table<LocalSaveHistoryRecord, string>
  checkpoints!: Table<LocalCheckpointRecord, string>
  workspaceFiles!: Table<LocalWorkspaceFileRecord, string>

  constructor() {
    // Prototype reset: no migration from retired local IndexedDB schemas.
    super("tsian-agent-runtime-v5")

    this.version(1).stores({
      meta: "&key",
      gameCards: "&id, source, updatedAt",
      gameCardFrontendFiles: "&id, gameCardId, path, updatedAt",
      saves: "&id, updatedAt",
      saveSnapshots: "&saveId",
      saveHistory: "&saveId",
      checkpoints: "&id, saveId, createdAt, turn",
      workspaceFiles: "&id, saveId, path, updatedAt",
    })
  }
}

export const localDb = new TsianLocalDb()
