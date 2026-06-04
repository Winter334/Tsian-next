import type {
  JsonValue,
  MemoryRecord,
  MemoryWriteOperation,
  MemoryWriteOutput,
} from "@tsian/contracts"
import { localDb, type LocalMemoryRecord } from "./db"

export interface MemoryRecordFilter {
  namespace?: string
  collection?: string
  query?: string
  limit?: number
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }

  if (typeof value !== "object") {
    return false
  }

  return Object.values(value).every((item) => isJsonValue(item))
}

function isJsonObject(value: unknown): value is { [key: string]: JsonValue } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every((item) => isJsonValue(item))
  )
}

function createRandomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeRequiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (!normalized) {
    throw new Error(`${label} is required`)
  }
  return normalized
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function normalizeTags(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return []
  const tags = value
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return [...new Set(tags)]
}

function tableId(
  saveId: string,
  namespace: string,
  collection: string,
  recordId: string,
): string {
  return [
    saveId,
    "memory",
    encodeURIComponent(namespace),
    encodeURIComponent(collection),
    encodeURIComponent(recordId),
  ].join(":")
}

function toMemoryRecord(record: LocalMemoryRecord): MemoryRecord {
  return {
    id: record.recordId,
    namespace: record.namespace,
    collection: record.collection,
    data: record.data,
    schemaVersion: record.schemaVersion,
    tags: record.tags,
    updatedAt: record.updatedAt,
  }
}

function recordMatches(record: LocalMemoryRecord, filter: MemoryRecordFilter): boolean {
  const namespace = normalizeOptionalText(filter.namespace)
  const collection = normalizeOptionalText(filter.collection)
  if (namespace && record.namespace !== namespace) return false
  if (collection && record.collection !== collection) return false

  const query = normalizeOptionalText(filter.query)?.toLowerCase()
  if (!query) return true

  const haystack = [
    record.recordId,
    record.namespace,
    record.collection,
    ...record.tags,
    JSON.stringify(record.data),
  ].join("\n").toLowerCase()
  return haystack.includes(query)
}

export async function listMemoryRecordsForSave(
  saveId: string,
  filter: MemoryRecordFilter = {},
): Promise<MemoryRecord[]> {
  return (await listLocalMemoryRecordsForSave(saveId, filter)).map(toMemoryRecord)
}

export async function listLocalMemoryRecordsForSave(
  saveId: string,
  filter: MemoryRecordFilter = {},
): Promise<LocalMemoryRecord[]> {
  const limit =
    typeof filter.limit === "number" && filter.limit > 0
      ? Math.floor(filter.limit)
      : undefined
  const records = await localDb.memoryRecords.where("saveId").equals(saveId).toArray()
  const filtered = records
    .filter((record) => recordMatches(record, filter))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  return limit ? filtered.slice(0, limit) : filtered
}

export async function deleteMemoryRecordsForSave(saveId: string): Promise<void> {
  const rows = await localDb.memoryRecords.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.memoryRecords.delete(item.id)))
}

export async function applyMemoryWriteOperationsForSave(
  saveId: string,
  inputOperations: MemoryWriteOperation[],
  defaults: { namespace?: string; collection?: string } = {},
): Promise<MemoryWriteOutput> {
  const output: MemoryWriteOutput = {
    upsertedIds: [],
    deletedIds: [],
    clearedCollections: [],
  }

  await localDb.transaction("rw", localDb.memoryRecords, async () => {
    for (const operation of inputOperations) {
      const namespace = normalizeRequiredText(
        operation.namespace ?? defaults.namespace,
        "memory operation namespace",
      )
      const collection = normalizeRequiredText(
        operation.collection ?? defaults.collection,
        "memory operation collection",
      )

      if (operation.type === "clear") {
        const rows = await localDb.memoryRecords
          .where("saveId")
          .equals(saveId)
          .filter(
            (record) =>
              record.namespace === namespace && record.collection === collection,
          )
          .toArray()
        await Promise.all(rows.map((record) => localDb.memoryRecords.delete(record.id)))
        output.clearedCollections.push(`${namespace}/${collection}`)
        continue
      }

      const recordId = normalizeOptionalText(operation.id)
      if (operation.type === "delete") {
        if (!recordId) {
          throw new Error("memory delete operation requires id")
        }
        await localDb.memoryRecords.delete(
          tableId(saveId, namespace, collection, recordId),
        )
        output.deletedIds.push(recordId)
        continue
      }

      if (operation.type === "patch") {
        if (!recordId) {
          throw new Error("memory patch operation requires id")
        }
        if (!isJsonObject(operation.data)) {
          throw new Error("memory patch operation requires JSON object data")
        }

        const id = tableId(saveId, namespace, collection, recordId)
        const existing = await localDb.memoryRecords.get(id)
        if (!existing) {
          throw new Error(`memory patch target "${recordId}" not found`)
        }
        if (!isJsonObject(existing.data)) {
          throw new Error("memory patch target data must be a JSON object")
        }

        await localDb.memoryRecords.put({
          ...existing,
          data: {
            ...existing.data,
            ...operation.data,
          },
          schemaVersion:
            normalizeOptionalText(operation.schemaVersion) ?? existing.schemaVersion,
          tags: operation.tags !== undefined ? normalizeTags(operation.tags) : existing.tags,
          updatedAt: Date.now(),
        })
        output.upsertedIds.push(recordId)
        continue
      }

      if (operation.type !== "upsert") {
        throw new Error(`unknown memory operation type "${String(operation.type)}"`)
      }

      if (!isJsonValue(operation.data)) {
        throw new Error("memory upsert operation requires JSON-compatible data")
      }

      const nextRecordId = recordId ?? createRandomId()
      const now = Date.now()
      const record: LocalMemoryRecord = {
        id: tableId(saveId, namespace, collection, nextRecordId),
        saveId,
        namespace,
        collection,
        recordId: nextRecordId,
        data: operation.data,
        schemaVersion: normalizeOptionalText(operation.schemaVersion),
        tags: normalizeTags(operation.tags),
        updatedAt: now,
      }
      await localDb.memoryRecords.put(record)
      output.upsertedIds.push(nextRecordId)
    }
  })

  return output
}
