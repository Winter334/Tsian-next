import type {
  JsonValue,
  StateRecord,
  StateWriteOperation,
  StateWriteOutput,
} from "@tsian/contracts"
import { localDb, type LocalStateRecord } from "./db"

export interface StateRecordFilter {
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
    "state",
    encodeURIComponent(namespace),
    encodeURIComponent(collection),
    encodeURIComponent(recordId),
  ].join(":")
}

function toStateRecord(record: LocalStateRecord): StateRecord {
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

function recordMatches(record: LocalStateRecord, filter: StateRecordFilter): boolean {
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

export async function listStateRecordsForSave(
  saveId: string,
  filter: StateRecordFilter = {},
): Promise<StateRecord[]> {
  return (await listLocalStateRecordsForSave(saveId, filter)).map(toStateRecord)
}

export async function listLocalStateRecordsForSave(
  saveId: string,
  filter: StateRecordFilter = {},
): Promise<LocalStateRecord[]> {
  const limit =
    typeof filter.limit === "number" && filter.limit > 0
      ? Math.floor(filter.limit)
      : undefined
  const records = await localDb.stateRecords.where("saveId").equals(saveId).toArray()
  const filtered = records
    .filter((record) => recordMatches(record, filter))
    .sort((left, right) => right.updatedAt - left.updatedAt)
  return limit ? filtered.slice(0, limit) : filtered
}

export async function deleteStateRecordsForSave(saveId: string): Promise<void> {
  const rows = await localDb.stateRecords.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.stateRecords.delete(item.id)))
}

export async function applyStateWriteOperationsForSave(
  saveId: string,
  inputOperations: StateWriteOperation[],
  defaults: { namespace?: string; collection?: string } = {},
): Promise<StateWriteOutput> {
  const output: StateWriteOutput = {
    upsertedIds: [],
    deletedIds: [],
    clearedCollections: [],
  }

  await localDb.transaction("rw", localDb.stateRecords, async () => {
    for (const operation of inputOperations) {
      const namespace = normalizeRequiredText(
        operation.namespace ?? defaults.namespace,
        "state operation namespace",
      )
      const collection = normalizeRequiredText(
        operation.collection ?? defaults.collection,
        "state operation collection",
      )

      if (operation.type === "clear") {
        const rows = await localDb.stateRecords
          .where("saveId")
          .equals(saveId)
          .filter(
            (record) =>
              record.namespace === namespace && record.collection === collection,
          )
          .toArray()
        await Promise.all(rows.map((record) => localDb.stateRecords.delete(record.id)))
        output.clearedCollections.push(`${namespace}/${collection}`)
        continue
      }

      const recordId = normalizeOptionalText(operation.id)
      if (operation.type === "delete") {
        if (!recordId) {
          throw new Error("state delete operation requires id")
        }
        await localDb.stateRecords.delete(
          tableId(saveId, namespace, collection, recordId),
        )
        output.deletedIds.push(recordId)
        continue
      }

      if (operation.type === "patch") {
        if (!recordId) {
          throw new Error("state patch operation requires id")
        }
        if (!isJsonObject(operation.data)) {
          throw new Error("state patch operation requires JSON object data")
        }

        const id = tableId(saveId, namespace, collection, recordId)
        const existing = await localDb.stateRecords.get(id)
        if (!existing) {
          throw new Error(`state patch target "${recordId}" not found`)
        }
        if (!isJsonObject(existing.data)) {
          throw new Error("state patch target data must be a JSON object")
        }

        await localDb.stateRecords.put({
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
        throw new Error(`unknown state operation type "${String(operation.type)}"`)
      }

      if (!isJsonValue(operation.data)) {
        throw new Error("state upsert operation requires JSON-compatible data")
      }

      const nextRecordId = recordId ?? createRandomId()
      const now = Date.now()
      const record: LocalStateRecord = {
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
      await localDb.stateRecords.put(record)
      output.upsertedIds.push(nextRecordId)
    }
  })

  return output
}
