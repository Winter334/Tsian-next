import type {
  DiagnosticAiRequestRecord,
  DiagnosticRecord,
  DiagnosticRecordPage,
  DiagnosticRecordQuery,
  DiagnosticRecordSummary,
  DiagnosticRecordSummaryPage,
} from "@tsian/contracts"
import { DIAGNOSTIC_RECORD_SCHEMA_VERSION } from "@tsian/contracts"
import { localDb } from "./db"

export const DIAGNOSTIC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const DIAGNOSTIC_MAX_BYTES = 100 * 1024 * 1024
export const DIAGNOSTIC_QUERY_DEFAULT_LIMIT = 50
export const DIAGNOSTIC_QUERY_MAX_LIMIT = 200

export interface DiagnosticRecordsChange {
  type: "upsert" | "delete"
  ids: string[]
}

const diagnosticRecordListeners = new Set<(change: DiagnosticRecordsChange) => void>()

export function subscribeDiagnosticRecords(
  listener: (change: DiagnosticRecordsChange) => void,
): () => void {
  diagnosticRecordListeners.add(listener)
  return () => diagnosticRecordListeners.delete(listener)
}

function emitDiagnosticRecordsChange(change: DiagnosticRecordsChange): void {
  for (const listener of diagnosticRecordListeners) {
    try {
      listener(change)
    } catch {
      // Diagnostics observers cannot affect authoritative storage writes.
    }
  }
}

const SECRET_KEYS = new Set([
  "apikey",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "xapikey",
  "xauthtoken",
  "token",
  "bearertoken",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "credential",
  "secret",
  "password",
])
const SECRET_QUERY_KEYS = new Set([
  "key",
  "apikey",
  "api_key",
  "access_token",
  "token",
  "client_secret",
  "password",
])

function normalizedSecretKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function sanitizeUrl(value: string): string {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    if (url.username) url.username = "[redacted]"
    if (url.password) url.password = "[redacted]"
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase()) || SECRET_KEYS.has(normalizedSecretKey(key))) {
        url.searchParams.set(key, "[redacted]")
      }
    }
    return url.toString()
  } catch {
    return value
  }
}

function binaryMetadata(value: Blob | ArrayBuffer | ArrayBufferView): Record<string, unknown> {
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return { type: "binary", mimeType: value.type || "application/octet-stream", size: value.size }
  }
  if (ArrayBuffer.isView(value)) {
    return { type: "binary", byteLength: value.byteLength }
  }
  if (value instanceof ArrayBuffer) {
    return { type: "binary", byteLength: value.byteLength }
  }
  return { type: "binary" }
}

/** Convert arbitrary provider data into credential-free JSON-compatible data. */
export function sanitizeDiagnosticValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (/^data:[^;,]*;base64,/i.test(value)) {
      const comma = value.indexOf(",")
      const header = value.slice(5, comma)
      const mimeType = header.split(";")[0] || "application/octet-stream"
      const base64Length = Math.max(0, value.length - comma - 1)
      return { type: "binary", mimeType, encodedBytes: Math.floor(base64Length * 0.75) }
    }
    return sanitizeUrl(value)
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined
  if (value instanceof Error) {
    return sanitizeDiagnosticValue({ name: value.name, message: value.message, stack: value.stack }, seen)
  }
  if (
    (typeof Blob !== "undefined" && value instanceof Blob)
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
  ) {
    return binaryMetadata(value as Blob | ArrayBuffer | ArrayBufferView)
  }
  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[circular]"
  seen.add(value)
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (
        Array.isArray(item)
        && typeof item[0] === "string"
        && SECRET_KEYS.has(normalizedSecretKey(item[0]))
      ) {
        return []
      }
      return [sanitizeDiagnosticValue(item, seen) ?? null]
    })
  }
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEYS.has(normalizedSecretKey(key))) continue

    // Provider-native inline binary forms use a plain `data` field. Preserve
    // metadata while dropping bytes; ordinary textual data remains untouched.
    if (
      key.toLowerCase() === "data"
      && typeof item === "string"
      && ("mimeType" in value || "media_type" in value || "source" in value)
    ) {
      result[key] = { type: "binary", encodedBytes: Math.floor(item.length * 0.75) }
      continue
    }
    const sanitized = sanitizeDiagnosticValue(item, seen)
    if (sanitized !== undefined) result[key] = sanitized
  }
  return result
}

export function diagnosticRecordSizeBytes(record: DiagnosticRecord): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength
}

export function prepareDiagnosticRecord(record: DiagnosticRecord): DiagnosticRecord {
  const sanitized = sanitizeDiagnosticValue(record) as DiagnosticRecord
  sanitized.schemaVersion = DIAGNOSTIC_RECORD_SCHEMA_VERSION
  let measured = 0
  for (let iteration = 0; iteration < 4; iteration += 1) {
    sanitized.sizeBytes = measured
    const next = diagnosticRecordSizeBytes(sanitized)
    if (next === measured) break
    measured = next
  }
  sanitized.sizeBytes = measured
  return sanitized
}

let diagnosticWriteQueue: Promise<void> = Promise.resolve()

function enqueueDiagnosticWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = diagnosticWriteQueue.then(operation, operation)
  diagnosticWriteQueue = result.then(() => undefined, () => undefined)
  return result
}

async function pruneDiagnosticRecordsInternal(input: {
  now?: number
  maxAgeMs?: number
  maxBytes?: number
} = {}): Promise<{ deleted: number; remainingBytes: number }> {
  const now = input.now ?? Date.now()
  const maxAgeMs = input.maxAgeMs ?? DIAGNOSTIC_RETENTION_MS
  const maxBytes = input.maxBytes ?? DIAGNOSTIC_MAX_BYTES
  const deletable: Array<{ id: string; timestamp: number; sizeBytes: number }> = []
  let remainingBytes = 0
  await localDb.diagnosticRecords.orderBy("timestamp").each((record) => {
    const sizeBytes = Math.max(0, record.sizeBytes || 0)
    remainingBytes += sizeBytes
    if (record.recordType !== "ai-request" || record.status !== "running") {
      deletable.push({ id: record.id, timestamp: record.timestamp, sizeBytes })
    }
  })
  const deleteIds = new Set<string>()

  for (const record of deletable) {
    if (record.timestamp < now - maxAgeMs) {
      deleteIds.add(record.id)
      remainingBytes -= record.sizeBytes
    }
  }
  for (const record of deletable) {
    if (remainingBytes <= maxBytes) break
    if (deleteIds.has(record.id)) continue
    deleteIds.add(record.id)
    remainingBytes -= record.sizeBytes
  }
  if (deleteIds.size > 0) {
    await localDb.diagnosticRecords.bulkDelete([...deleteIds])
    emitDiagnosticRecordsChange({ type: "delete", ids: [...deleteIds] })
  }
  return { deleted: deleteIds.size, remainingBytes: Math.max(0, remainingBytes) }
}

export function putDiagnosticRecord(record: DiagnosticRecord): Promise<DiagnosticRecord> {
  return enqueueDiagnosticWrite(async () => {
    const prepared = prepareDiagnosticRecord(record)
    await localDb.diagnosticRecords.put(prepared)
    emitDiagnosticRecordsChange({ type: "upsert", ids: [prepared.id] })
    await pruneDiagnosticRecordsInternal()
    return prepared
  })
}

export function updateDiagnosticRecord(
  id: string,
  patch: Partial<DiagnosticRecord>,
): Promise<DiagnosticRecord | undefined> {
  return enqueueDiagnosticWrite(async () => {
    const existing = await localDb.diagnosticRecords.get(id)
    if (!existing) return undefined
    const prepared = prepareDiagnosticRecord({ ...existing, ...patch, id } as DiagnosticRecord)
    await localDb.diagnosticRecords.put(prepared)
    emitDiagnosticRecordsChange({ type: "upsert", ids: [prepared.id] })
    await pruneDiagnosticRecordsInternal()
    return prepared
  })
}

export function getDiagnosticRecord(id: string): Promise<DiagnosticRecord | undefined> {
  return localDb.diagnosticRecords.get(id)
}

function recordMatchesQuery(record: DiagnosticRecord, query: DiagnosticRecordQuery): boolean {
  if (query.recordType && record.recordType !== query.recordType) return false
  if (query.fromTimestamp !== undefined && record.timestamp < query.fromTimestamp) return false
  if (query.toTimestamp !== undefined && record.timestamp > query.toTimestamp) return false
  if (record.recordType === "ai-request") {
    if (query.status && record.status !== query.status) return false
    if (query.provider && record.provider !== query.provider) return false
    if (query.model && record.model !== query.model) return false
    if (query.operationId && record.operationId !== query.operationId) return false
  } else if (query.status || query.provider || query.model || query.operationId) {
    return false
  }
  if (query.text) {
    const needle = query.text.toLocaleLowerCase()
    if (!JSON.stringify(record).toLocaleLowerCase().includes(needle)) return false
  }
  return true
}

export async function queryDiagnosticRecords(query: DiagnosticRecordQuery = {}): Promise<DiagnosticRecordPage> {
  const offset = Math.max(0, Math.floor(query.offset ?? 0))
  const limit = Math.min(
    DIAGNOSTIC_QUERY_MAX_LIMIT,
    Math.max(1, Math.floor(query.limit ?? DIAGNOSTIC_QUERY_DEFAULT_LIMIT)),
  )
  const matches = await localDb.diagnosticRecords
    .orderBy("timestamp")
    .reverse()
    .filter((record) => recordMatchesQuery(record, query))
    .offset(offset)
    .limit(limit + 1)
    .toArray()
  return {
    items: matches.slice(0, limit),
    offset,
    limit,
    hasMore: matches.length > limit,
  }
}

function summarizeDiagnosticRecord(record: DiagnosticRecord): DiagnosticRecordSummary {
  if (record.recordType === "frontend-error") {
    return {
      id: record.id,
      recordType: record.recordType,
      timestamp: record.timestamp,
      updatedAt: record.updatedAt,
      sizeBytes: record.sizeBytes,
      message: record.message,
    }
  }
  return {
    id: record.id,
    recordType: record.recordType,
    timestamp: record.timestamp,
    updatedAt: record.updatedAt,
    sizeBytes: record.sizeBytes,
    status: record.status,
    provider: record.provider,
    model: record.model,
    operationId: record.operationId,
    durationMs: record.durationMs,
    retryCount: record.attempts.filter((attempt) => attempt.willRetry).length,
    ...(record.error?.message ? { message: record.error.message } : {}),
  }
}

export async function queryDiagnosticRecordSummaries(
  query: DiagnosticRecordQuery = {},
): Promise<DiagnosticRecordSummaryPage> {
  const page = await queryDiagnosticRecords(query)
  return { ...page, items: page.items.map(summarizeDiagnosticRecord) }
}

export async function getDiagnosticRelationClosure(anchorId: string): Promise<DiagnosticRecord[]> {
  const anchor = await localDb.diagnosticRecords.get(anchorId)
  if (!anchor) return []
  if (anchor.recordType !== "ai-request") return [anchor]
  const operation = await localDb.diagnosticRecords
    .where("operationId")
    .equals(anchor.operationId)
    .toArray() as DiagnosticAiRequestRecord[]
  const byId = new Map(operation.map((record) => [record.id, record]))
  const included = new Set<string>()
  const queue = [anchor.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    if (included.has(id)) continue
    const record = byId.get(id)
    if (!record) continue
    included.add(id)
    if (record.parentRequestId) queue.push(record.parentRequestId)
    if (record.previousRequestId) queue.push(record.previousRequestId)
    for (const candidate of operation) {
      if (candidate.parentRequestId === id || candidate.previousRequestId === id) queue.push(candidate.id)
    }
  }
  return operation
    .filter((record) => included.has(record.id))
    .sort((left, right) => left.timestamp - right.timestamp || left.sequence - right.sequence)
}

export function pruneDiagnosticRecords(input: {
  now?: number
  maxAgeMs?: number
  maxBytes?: number
} = {}): Promise<{ deleted: number; remainingBytes: number }> {
  return enqueueDiagnosticWrite(() => pruneDiagnosticRecordsInternal(input))
}

export function initializeDiagnosticRecords(now = Date.now()): Promise<void> {
  return enqueueDiagnosticWrite(async () => {
    const running = await localDb.diagnosticRecords.where("status").equals("running").toArray()
    for (const record of running) {
      if (record.recordType !== "ai-request") continue
      const interrupted = prepareDiagnosticRecord({
        ...record,
        status: "interrupted",
        updatedAt: now,
        durationMs: Math.max(0, now - record.timestamp),
        error: { type: "interrupted", message: "The page ended before this request completed." },
      })
      await localDb.diagnosticRecords.put(interrupted)
      emitDiagnosticRecordsChange({ type: "upsert", ids: [interrupted.id] })
    }
    await pruneDiagnosticRecordsInternal({ now })
  })
}
