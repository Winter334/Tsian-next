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
  time: string
  status: string
  entityTags: string[]
  content: string
}

export type ArchiveBaseKind =
  | "character"
  | "location"
  | "item"
  | "organization"
  | "other"

export type ArchiveKind = `${ArchiveBaseKind}:${string}` | ArchiveBaseKind

export type ArchivePresence = "foreground" | "background" | "retired"

export interface ArchiveRecord {
  id: string
  kind: ArchiveKind
  name: string
  aliases: string[]
  background: string
  situation: string
  focus: string
  linkedNames: string[]
  presence: ArchivePresence
  [key: string]: unknown
}

export interface EventPatchItem {
  target: "active"
  set?: {
    status?: "ongoing" | "done"
    time?: string
    entityTags?: string[]
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

export interface MessageInteractionRequest {
  content: string
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
