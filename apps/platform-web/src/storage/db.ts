import type {
  ConversationMessageRecord,
  JsonValue,
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

export interface LocalStateRecord {
  /** Internal deterministic table key. */
  id: string
  saveId: string
  namespace: string
  collection: string
  /** Logical record id inside namespace + collection. */
  recordId: string
  data: JsonValue
  schemaVersion?: string
  tags: string[]
  updatedAt: number
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
  stateRecords: Array<Omit<LocalStateRecord, "saveId" | "updatedAt">>
  workspaceFiles: Array<Omit<LocalWorkspaceFileRecord, "id" | "saveId">>
}

export class TsianLocalDb extends Dexie {
  meta!: Table<LocalMetaRecord, string>
  saves!: Table<LocalSaveRecord, string>
  saveSnapshots!: Table<LocalSaveSnapshotRecord, string>
  saveHistory!: Table<LocalSaveHistoryRecord, string>
  checkpoints!: Table<LocalCheckpointRecord, string>
  stateRecords!: Table<LocalStateRecord, string>
  workspaceFiles!: Table<LocalWorkspaceFileRecord, string>

  constructor() {
    // Prototype reset: no migration from workflow/prompt AIRP-memory schemas.
    super("tsian-agent-runtime-v2")

    this.version(1).stores({
      meta: "&key",
      saves: "&id, updatedAt",
      saveSnapshots: "&saveId",
      saveHistory: "&saveId",
      checkpoints: "&id, saveId, createdAt, turn",
      stateRecords: "&id, saveId, namespace, collection, recordId, updatedAt",
      workspaceFiles: "&id, saveId, path, updatedAt",
    })
  }
}

export const localDb = new TsianLocalDb()
