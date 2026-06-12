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

export interface StateRecord {
  id: string
  namespace: string
  collection: string
  data: JsonValue
  schemaVersion?: string
  tags?: string[]
  updatedAt?: number
}

export type StateWriteOperationType = "upsert" | "patch" | "delete" | "clear"

export interface StateWriteOperation {
  type: StateWriteOperationType
  namespace?: string
  collection?: string
  id?: string
  data?: JsonValue
  schemaVersion?: string
  tags?: string[]
}

export interface StateWriteOutput {
  upsertedIds: string[]
  deletedIds: string[]
  clearedCollections: string[]
}

export interface RuntimeStateShell {
  turn: number
  messages: ConversationMessageRecord[]
  globals?: RuntimeGlobalsMap
}

export interface RuntimeSnapshotShell {
  version: string
  state: RuntimeStateShell
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
  activeSaveId?: string
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

export interface PlatformActionResult<T = unknown> {
  ok: boolean
  item?: T
  error?: PlatformActionError
}
