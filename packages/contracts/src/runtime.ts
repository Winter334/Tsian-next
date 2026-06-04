export interface ConversationMessageRecord {
  role: string
  content: string
}

export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue
    }

export interface RuntimeGlobalsMap {
  [key: string]: JsonValue
}

export interface MemoryRecord {
  /** Logical id inside a save-scoped namespace + collection. */
  id: string
  namespace: string
  collection: string
  data: JsonValue
  schemaVersion?: string
  tags?: string[]
  updatedAt?: number
}

export type MemoryWriteOperationType = "upsert" | "delete" | "clear"

export interface MemoryWriteOperation {
  type: MemoryWriteOperationType
  namespace?: string
  collection?: string
  id?: string
  data?: JsonValue
  schemaVersion?: string
  tags?: string[]
}

export interface MemoryWriteOutput {
  upsertedIds: string[]
  deletedIds: string[]
  clearedCollections: string[]
}

export interface RuntimeStateShell {
  turn: number
  messages: ConversationMessageRecord[]
  currentTime?: string
  globals?: RuntimeGlobalsMap
}

export interface RuntimeSnapshotShell {
  version: string
  state: RuntimeStateShell
}

export interface EventRecord {
  id?: string
  time: string
  status: string
  entityTags: string[]
  entityArchiveIds?: string[]
  content: string
}

export type ArchiveBaseType =
  | "character"
  | "location"
  | "item"
  | "organization"
  | "other"

export type ArchiveType = string

export type ArchivePresence = "foreground" | "background" | "retired"

export interface ArchiveRecord {
  id: string
  type: ArchiveType
  name: string
  aliases: string[]
  background: string
  situation: string
  focus?: string
  linkedNames: string[]
  linkedArchiveIds?: string[]
  presence: ArchivePresence
  [key: string]: unknown
}

export interface EventPatchItem {
  target?: string
  set?: {
    status?: "ongoing" | "done"
    time?: string
    entityTags?: string[]
    entityArchiveIds?: string[]
    content?: string
  }
  create?: {
    status: "ongoing" | "done"
    time?: string
    entityTags?: string[]
    entityArchiveIds?: string[]
    content?: string
  }
}

export interface ArchivePatchItem {
  target?: string
  set?: Partial<Omit<ArchiveRecord, "id">>
  create?: Omit<ArchiveRecord, "id">
}

export interface MaintenancePatchDocument {
  currentTime?: string
  globals?: {
    set: RuntimeGlobalsMap
  }
  events?: EventPatchItem[]
  archives?: ArchivePatchItem[]
}

/**
 * 维护 patch 应用结果（design.md §13.1 / §13.3）。
 * 供 apply-patch 工作流节点与桥 API `applyPatch` 共用。
 */
export interface ApplyPatchOutput {
  /** apply 过程中变更或新建的 archive id 列表。 */
  appliedArchives: string[]
  /** apply 过程中变更或新建的 event id 列表（暂未实现精确捕获，详见 §13.3）。 */
  appliedEventIds: string[]
  globalsChanged: boolean
  currentTimeChanged: boolean
}

export interface MessageInteractionRequest {
  content: string
  narrativeTimeText?: string
}

export interface MessageInteractionResult {
  snapshot: RuntimeSnapshotShell
}

export interface DeepQueryRequest {
  resource: string
  params?: Record<string, unknown>
}

export interface DeepQueryResult<T = unknown> {
  items: T[]
}

export interface PlatformContextShell {
  version: string
  activeFrontendId?: string
  activeModId?: string
}

export interface PlatformActionRequest {
  action: string
  params?: Record<string, unknown>
}

export interface PlatformActionError {
  code: string
  message: string
  details?: Record<string, JsonValue>
}

export interface RuntimeWriteEventInput {
  id?: string
  time: string
  status: "ongoing" | "done"
  entityTags: string[]
  entityArchiveIds?: string[]
  content: string
}

export interface RuntimeWriteArchiveInput {
  id?: string
  type: ArchiveType
  name: string
  aliases: string[]
  background: string
  situation: string
  focus?: string
  linkedNames: string[]
  linkedArchiveIds?: string[]
  presence: ArchivePresence
  [key: string]: unknown
}

export interface RuntimeWriteRequest {
  turn?: number
  currentTime?: string
  globals?: RuntimeGlobalsMap
  history?: ConversationMessageRecord[]
  events?: RuntimeWriteEventInput[]
  archives?: RuntimeWriteArchiveInput[]
  checkpointLabel?: string
}

export interface RuntimeWriteResult {
  snapshot: RuntimeSnapshotShell
  historyCount: number
  eventCount: number
  archiveCount: number
}

export interface PlatformActionResult<T = unknown> {
  ok: boolean
  item?: T
  error?: PlatformActionError
}
