import type {
  ArchivePresence,
  ArchiveType,
  JsonValue,
  PromptPreset,
  RuntimeSnapshotShell,
  WorkflowDefinition,
  WorldBook,
} from "@tsian/contracts"
import Dexie, { type Table } from "dexie"

export interface LocalMetaRecord {
  key: string
  value: string
}

export interface LocalSaveRecord {
  id: string
  name: string
  modId: string
  workflowPresetId?: string
  createdAt: number
  updatedAt: number
  /**
   * 玩家身份 archive id 列表。命中检索评分时 rarity 强制为 1.0。
   * 由桥 API `markArchiveAsPlayer / unmarkArchiveAsPlayer` 写入，存档级别。
   */
  playerArchiveIds: string[]
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

export interface LocalCheckpointRecord {
  id: string
  saveId: string
  turn: number
  label: string
  reason: "initial" | "after-turn" | "manual"
  createdAt: number
  snapshot: RuntimeSnapshotShell
  history: LocalSaveHistoryRecord["messages"]
  events: Array<Omit<LocalEventRecord, "saveId" | "updatedAt">>
  archives: Array<Omit<LocalArchiveRecord, "saveId" | "updatedAt">>
  memoryRecords: Array<Omit<LocalMemoryRecord, "saveId" | "updatedAt">>
}

export interface LocalEventRecord {
  id: string
  saveId: string
  time: string
  status: string
  entityTags: string[]
  entityArchiveIds?: string[]
  content: string
  updatedAt: number
}

export interface LocalArchiveRecord {
  id: string
  saveId: string
  type: ArchiveType
  name: string
  aliases: string[]
  background: string
  situation: string
  focus?: string
  linkedNames: string[]
  linkedArchiveIds?: string[]
  presence: ArchivePresence
  updatedAt: number
  [key: string]: unknown
}

export interface LocalEmbeddingRecord {
  id: string
  targetType: "event" | "archive"
  targetId: string
  embeddingModel: string
  contentHash: string
  vector: number[]
  updatedAt: number
}

export interface LocalMemoryRecord {
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

export interface LocalPromptPresetResourceRecord {
  id: string
  name: string
  description?: string
  tags: string[]
  preset: PromptPreset
  content: unknown
  createdAt: number
  updatedAt: number
}

export interface LocalWorldBookResourceRecord {
  id: string
  name: string
  description?: string
  tags: string[]
  worldBook: WorldBook
  content: unknown
  createdAt: number
  updatedAt: number
}

export interface LocalWorkflowPresetResourceRecord {
  id: string
  name: string
  description?: string
  tags: string[]
  workflow: WorkflowDefinition
  definition: WorkflowDefinition
  createdAt: number
  updatedAt: number
}

export class TsianLocalDb extends Dexie {
  meta!: Table<LocalMetaRecord, string>
  saves!: Table<LocalSaveRecord, string>
  saveSnapshots!: Table<LocalSaveSnapshotRecord, string>
  saveHistory!: Table<LocalSaveHistoryRecord, string>
  checkpoints!: Table<LocalCheckpointRecord, string>
  events!: Table<LocalEventRecord, string>
  archives!: Table<LocalArchiveRecord, string>
  embeddings!: Table<LocalEmbeddingRecord, string>
  memoryRecords!: Table<LocalMemoryRecord, string>
  promptPresets!: Table<LocalPromptPresetResourceRecord, string>
  worldBooks!: Table<LocalWorldBookResourceRecord, string>
  workflowPresets!: Table<LocalWorkflowPresetResourceRecord, string>

  constructor() {
    // 原型期直接换新库名，不做旧结构迁移。
    super("tsian-local-v9")

    this.version(1).stores({
      meta: "&key",
      saves: "&id, updatedAt",
      saveSnapshots: "&saveId",
      saveHistory: "&saveId",
      checkpoints: "&id, saveId, createdAt, turn",
      events: "&id, saveId, updatedAt",
      archives: "&id, saveId, updatedAt",
      embeddings: "&id, targetType, targetId, embeddingModel, updatedAt",
      memoryRecords: "&id, saveId, namespace, collection, recordId, updatedAt",
      promptPresets: "&id, name, updatedAt",
      worldBooks: "&id, name, updatedAt",
      workflowPresets: "&id, name, updatedAt",
    })
  }
}

export const localDb = new TsianLocalDb()
