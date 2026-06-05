import type {
  ArchiveRecord,
  ConversationMessageRecord,
  EventRecord,
  JsonValue,
  MemoryWriteOperation,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
  RuntimeWriteArchiveInput,
  RuntimeWriteEventInput,
} from "@tsian/contracts"
import {
  defaultAirpMemorySchema,
  DEFAULT_AIRP_MEMORY_NAMESPACE,
} from "@tsian/memory-core"
import type { LocalArchiveRecord, LocalEventRecord, LocalMemoryRecord } from "./db"
import {
  applyMemoryWriteOperationsForSave,
  listLocalMemoryRecordsForSave,
} from "./memory"
import { replaceRuntimeForSave } from "./runtime-write"

export const AIRP_MEMORY_NAMESPACE =
  defaultAirpMemorySchema.defaultNamespace ?? DEFAULT_AIRP_MEMORY_NAMESPACE
export const AIRP_CURRENT_TIME_RECORD_ID = "currentTime"

export interface AirpMemoryProjection {
  currentTime?: string
  globals: RuntimeGlobalsMap
  events: LocalEventRecord[]
  activeEvents: LocalEventRecord[]
  archives: ArchiveRecord[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }

  if (!isPlainObject(value)) {
    return false
  }

  return Object.values(value).every((item) => isJsonValue(item))
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    return undefined
  }
  return value.map((item) => item.trim())
}

function requireText(
  value: unknown,
  record: LocalMemoryRecord,
  field: string,
): string {
  const text = optionalText(value)
  if (!text) {
    throw new Error(
      `AIRP memory projection failed: ${record.collection}/${record.recordId} missing "${field}"`,
    )
  }
  return text
}

function requireJsonValue(
  value: unknown,
  record: LocalMemoryRecord,
  field: string,
): JsonValue {
  if (!isJsonValue(value)) {
    throw new Error(
      `AIRP memory projection failed: ${record.collection}/${record.recordId} field "${field}" is not JSON`,
    )
  }
  return value
}

function requireStringArray(
  value: unknown,
  record: LocalMemoryRecord,
  field: string,
): string[] {
  const items = stringArray(value)
  if (!items) {
    throw new Error(
      `AIRP memory projection failed: ${record.collection}/${record.recordId} field "${field}" must be string[]`,
    )
  }
  return items
}

function requireArchivePresence(
  value: unknown,
  record: LocalMemoryRecord,
): ArchiveRecord["presence"] {
  if (
    value === "foreground" ||
    value === "background" ||
    value === "retired"
  ) {
    return value
  }

  throw new Error(
    `AIRP memory projection failed: ${record.collection}/${record.recordId} field "presence" must be a valid archive presence`,
  )
}

function createEventMemoryData(
  event: Pick<
    EventRecord,
    "time" | "status" | "entityTags" | "entityArchiveIds" | "content"
  >,
): Record<string, JsonValue> {
  const data: Record<string, JsonValue> = {
    time: event.time,
    status: event.status,
    entityTags: event.entityTags,
    content: event.content,
  }

  if (event.entityArchiveIds) {
    data.entityArchiveIds = event.entityArchiveIds
  }

  return data
}

function createArchiveMemoryData(archive: ArchiveRecord): Record<string, JsonValue> {
  const {
    id,
    type,
    name,
    aliases,
    background,
    situation,
    focus,
    linkedNames,
    linkedArchiveIds,
    presence,
    ...extra
  } = archive

  const data: Record<string, JsonValue> = {
    type,
    name,
    aliases,
    background,
    situation,
    linkedNames,
    presence,
  }

  if (focus !== undefined) {
    data.focus = focus
  }

  if (linkedArchiveIds) {
    data.linkedArchiveIds = linkedArchiveIds
  }

  for (const [key, value] of Object.entries(extra)) {
    if (!isJsonValue(value)) {
      throw new Error(
        `AIRP memory sync failed: archive ${id} field "${key}" is not JSON`,
      )
    }
    data[key] = value
  }

  return data
}

function toRuntimeWriteEventInput(event: LocalEventRecord): RuntimeWriteEventInput {
  const next: RuntimeWriteEventInput = {
    id: event.id,
    time: event.time,
    status: event.status === "done" ? "done" : "ongoing",
    entityTags: event.entityTags,
    content: event.content,
  }

  if (event.entityArchiveIds) {
    next.entityArchiveIds = event.entityArchiveIds
  }

  return next
}

function toRuntimeWriteArchiveInput(
  archive: ArchiveRecord,
): RuntimeWriteArchiveInput {
  const {
    id,
    type,
    name,
    aliases,
    background,
    situation,
    focus,
    linkedNames,
    linkedArchiveIds,
    presence,
    ...extra
  } = archive

  const next: RuntimeWriteArchiveInput = {
    id,
    type,
    name,
    aliases,
    background,
    situation,
    linkedNames,
    presence,
  }

  if (focus !== undefined) {
    next.focus = focus
  }

  if (linkedArchiveIds) {
    next.linkedArchiveIds = linkedArchiveIds
  }

  for (const [key, value] of Object.entries(extra)) {
    if (!isJsonValue(value)) {
      throw new Error(
        `AIRP compatibility sync failed: archive ${id} field "${key}" is not JSON`,
      )
    }
    next[key] = value
  }

  return next
}

function projectEventRecord(record: LocalMemoryRecord): LocalEventRecord {
  if (!isPlainObject(record.data)) {
    throw new Error(
      `AIRP memory projection failed: events/${record.recordId} data must be an object`,
    )
  }

  const id = requireText(record.recordId, record, "id")
  const time = requireText(record.data.time, record, "time")
  const status = requireText(record.data.status, record, "status")
  const entityTags = requireStringArray(record.data.entityTags, record, "entityTags")
  const content = requireText(record.data.content, record, "content")
  const entityArchiveIds = stringArray(record.data.entityArchiveIds)

  return {
    id,
    saveId: record.saveId,
    time,
    status,
    entityTags,
    entityArchiveIds,
    content,
    updatedAt: record.updatedAt,
  }
}

function projectArchiveRecord(record: LocalMemoryRecord): ArchiveRecord {
  if (!isPlainObject(record.data)) {
    throw new Error(
      `AIRP memory projection failed: archives/${record.recordId} data must be an object`,
    )
  }

  const archive: ArchiveRecord = {
    id: requireText(record.recordId, record, "id"),
    type: requireText(record.data.type, record, "type"),
    name: requireText(record.data.name, record, "name"),
    aliases: requireStringArray(record.data.aliases, record, "aliases"),
    background: requireText(record.data.background, record, "background"),
    situation: requireText(record.data.situation, record, "situation"),
    linkedNames: requireStringArray(record.data.linkedNames, record, "linkedNames"),
    presence: requireArchivePresence(record.data.presence, record),
  }

  const focus = optionalText(record.data.focus)
  if (focus) {
    archive.focus = focus
  }

  const linkedArchiveIds = stringArray(record.data.linkedArchiveIds)
  if (linkedArchiveIds) {
    archive.linkedArchiveIds = linkedArchiveIds
  }

  for (const [key, value] of Object.entries(record.data)) {
    if (
      key === "type" ||
      key === "name" ||
      key === "aliases" ||
      key === "background" ||
      key === "situation" ||
      key === "focus" ||
      key === "linkedNames" ||
      key === "linkedArchiveIds" ||
      key === "presence"
    ) {
      continue
    }

    archive[key] = requireJsonValue(value, record, key)
  }

  return archive
}

function applyGlobalRecord(
  globals: RuntimeGlobalsMap,
  record: LocalMemoryRecord,
): string | undefined {
  if (!isPlainObject(record.data)) {
    throw new Error(
      `AIRP memory projection failed: globals/${record.recordId} data must be an object`,
    )
  }

  const key = requireText(record.data.key ?? record.recordId, record, "key")
  if (key !== record.recordId) {
    throw new Error(
      `AIRP memory projection failed: globals/${record.recordId} key does not match record id`,
    )
  }
  const value = requireJsonValue(record.data.value, record, "value")
  if (key === AIRP_CURRENT_TIME_RECORD_ID) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(
        `AIRP memory projection failed: globals/${key} value must be a non-empty string`,
      )
    }
    return value.trim()
  }
  globals[key] = value
  return undefined
}

function snapshotMessages(snapshot: RuntimeSnapshotShell): ConversationMessageRecord[] {
  return Array.isArray(snapshot.state.messages) ? snapshot.state.messages : []
}

function createGlobalsOperations(globals: RuntimeGlobalsMap): MemoryWriteOperation[] {
  return Object.entries(globals).map(([key, value]) => ({
    type: "upsert",
    namespace: AIRP_MEMORY_NAMESPACE,
    collection: "globals",
    id: key,
    data: {
      key,
      value,
    },
  }))
}

function createEventOperations(
  events: ReadonlyArray<Pick<EventRecord, "id" | "time" | "status" | "entityTags" | "entityArchiveIds" | "content">>,
): MemoryWriteOperation[] {
  return events.flatMap((event) => {
    const id = optionalText(event.id)
    if (!id) {
      return []
    }
    return [
      {
        type: "upsert",
        namespace: AIRP_MEMORY_NAMESPACE,
        collection: "events",
        id,
        data: createEventMemoryData(event),
      },
    ]
  })
}

function createArchiveOperations(
  archives: ReadonlyArray<ArchiveRecord>,
): MemoryWriteOperation[] {
  return archives.map((archive) => {
    return {
      type: "upsert",
      namespace: AIRP_MEMORY_NAMESPACE,
      collection: "archives",
      id: archive.id,
      data: createArchiveMemoryData(archive),
    }
  })
}

function createCurrentTimeOperation(
  snapshot: RuntimeSnapshotShell,
): MemoryWriteOperation[] {
  const currentTime = optionalText(snapshot.state.currentTime)
  if (!currentTime) {
    return []
  }

  return [
    {
      type: "upsert",
      namespace: AIRP_MEMORY_NAMESPACE,
      collection: "globals",
      id: AIRP_CURRENT_TIME_RECORD_ID,
      data: {
        key: AIRP_CURRENT_TIME_RECORD_ID,
        value: currentTime,
      },
    },
  ]
}

export async function replaceAirpMemoryForSave(
  saveId: string,
  input: {
    snapshot: RuntimeSnapshotShell
    events: ReadonlyArray<
      Pick<EventRecord, "id" | "time" | "status" | "entityTags" | "entityArchiveIds" | "content">
    >
    archives: ReadonlyArray<ArchiveRecord>
  },
): Promise<void> {
  const globals =
    typeof input.snapshot.state.globals === "object" &&
    input.snapshot.state.globals !== null &&
    !Array.isArray(input.snapshot.state.globals)
      ? (input.snapshot.state.globals as RuntimeGlobalsMap)
      : {}

  const operations: MemoryWriteOperation[] = [
    {
      type: "clear",
      namespace: AIRP_MEMORY_NAMESPACE,
      collection: "events",
    },
    {
      type: "clear",
      namespace: AIRP_MEMORY_NAMESPACE,
      collection: "archives",
    },
    {
      type: "clear",
      namespace: AIRP_MEMORY_NAMESPACE,
      collection: "globals",
    },
    ...createCurrentTimeOperation(input.snapshot),
    ...createGlobalsOperations(globals),
    ...createEventOperations(input.events),
    ...createArchiveOperations(input.archives),
  ]

  await applyMemoryWriteOperationsForSave(saveId, operations, {
    namespace: AIRP_MEMORY_NAMESPACE,
  })
}

export async function loadAirpMemoryProjectionForSave(
  saveId: string,
): Promise<AirpMemoryProjection> {
  const records = await listLocalMemoryRecordsForSave(saveId, {
    namespace: AIRP_MEMORY_NAMESPACE,
  })

  const globals: RuntimeGlobalsMap = {}
  let currentTime: string | undefined
  const events: LocalEventRecord[] = []
  const archives: Array<{ updatedAt: number; archive: ArchiveRecord }> = []

  for (const record of records) {
    if (record.namespace !== AIRP_MEMORY_NAMESPACE) {
      continue
    }

    if (record.collection === "events") {
      events.push(projectEventRecord(record))
      continue
    }

    if (record.collection === "archives") {
      archives.push({
        updatedAt: record.updatedAt,
        archive: projectArchiveRecord(record),
      })
      continue
    }

    if (record.collection === "globals") {
      currentTime = applyGlobalRecord(globals, record) ?? currentTime
    }
  }

  events.sort((left, right) => right.updatedAt - left.updatedAt)
  const activeEvents = events.filter((event) => event.status === "ongoing")
  const orderedArchives = archives
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((item) => item.archive)

  return {
    currentTime,
    globals,
    events,
    activeEvents,
    archives: orderedArchives,
  }
}

export function projectSnapshotFromAirpMemory(
  snapshot: RuntimeSnapshotShell,
  projection: AirpMemoryProjection,
): RuntimeSnapshotShell {
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      currentTime: projection.currentTime ?? snapshot.state.currentTime,
      globals: projection.globals,
    },
  }
}

export async function syncAirpCompatibilityStateForSave(
  saveId: string,
  snapshot: RuntimeSnapshotShell,
): Promise<{
  snapshot: RuntimeSnapshotShell
  history: ConversationMessageRecord[]
  events: LocalEventRecord[]
  archives: LocalArchiveRecord[]
}> {
  const projection = await loadAirpMemoryProjectionForSave(saveId)
  const nextSnapshot = projectSnapshotFromAirpMemory(snapshot, projection)
  return replaceRuntimeForSave(saveId, {
    snapshot: nextSnapshot,
    history: snapshotMessages(nextSnapshot),
    events: projection.events.map(toRuntimeWriteEventInput),
    archives: projection.archives.map(toRuntimeWriteArchiveInput),
  })
}
