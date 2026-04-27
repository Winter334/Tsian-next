import type {
  ArchiveKind,
  ArchivePresence,
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
  messages: Array<{
    role: string
    content: string
  }>
}

export interface LocalEventRecord {
  id: string
  saveId: string
  time: string
  status: string
  entityTags: string[]
  content: string
  updatedAt: number
}

export interface LocalArchiveRecord {
  id: string
  saveId: string
  kind: ArchiveKind
  name: string
  aliases: string[]
  background: string
  situation: string
  focus: string
  linkedNames: string[]
  presence: ArchivePresence
  updatedAt: number
  [key: string]: unknown
}

export class TsianLocalDb extends Dexie {
  meta!: Table<LocalMetaRecord, string>
  saves!: Table<LocalSaveRecord, string>
  saveSnapshots!: Table<LocalSaveSnapshotRecord, string>
  saveHistory!: Table<LocalSaveHistoryRecord, string>
  events!: Table<LocalEventRecord, string>
  archives!: Table<LocalArchiveRecord, string>

  constructor() {
    // 原型期直接换新库名，不做旧结构迁移。
    super("tsian-local-v2")

    this.version(1).stores({
      meta: "&key",
      saves: "&id, updatedAt",
      saveSnapshots: "&saveId",
      saveHistory: "&saveId",
      events: "&id, saveId, updatedAt",
      archives: "&id, saveId, updatedAt",
    })
  }
}

export const localDb = new TsianLocalDb()
