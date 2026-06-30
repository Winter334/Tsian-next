import type { AiDebugRecord } from "@tsian/contracts"
import { localDb } from "./db"

/**
 * Persistent AI debug records storage (task 06-30-debugview-cache-hit-display).
 *
 * Replaces the in-memory 20-record ring in `runtime-host/ai.ts` with a Dexie
 * meta-key store. Global (not per-save/session), cleared on card switch, and
 * auto-expires records older than 7 days on read/write. See design.md §3.
 */

export const AI_DEBUG_RECORDS_KEY = "ai-debug-records"
const AI_DEBUG_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/** Records older than this are dropped on read/write (auto-expire). */
function isExpired(record: AiDebugRecord, now: number): boolean {
  const ts = Date.parse(record.createdAt)
  if (!Number.isFinite(ts)) return true // unparseable createdAt → treat as expired
  return now - ts > AI_DEBUG_TTL_MS
}

/** Read persisted records, dropping expired ones and writing back the pruned set. */
export async function readAiDebugRecords(): Promise<AiDebugRecord[]> {
  const record = await localDb.meta.get(AI_DEBUG_RECORDS_KEY)
  if (!record?.value) return []

  let parsed: AiDebugRecord[]
  try {
    parsed = JSON.parse(record.value) as AiDebugRecord[]
    if (!Array.isArray(parsed)) return []
  } catch {
    // Corrupt JSON — treat as empty, clear the key.
    await localDb.meta.delete(AI_DEBUG_RECORDS_KEY)
    return []
  }

  const now = Date.now()
  const fresh = parsed.filter((r) => r && typeof r === "object" && !isExpired(r, now))

  // Write back only if we pruned something (avoid needless Dexie writes).
  if (fresh.length !== parsed.length) {
    await localDb.meta.put({ key: AI_DEBUG_RECORDS_KEY, value: JSON.stringify(fresh) })
  }
  return fresh
}

/** Append a new record at the head, pruning expired entries. Fire-and-forget safe. */
export async function appendAiDebugRecord(record: AiDebugRecord): Promise<void> {
  const existing = await readAiDebugRecords()
  const updated = [record, ...existing]
  await localDb.meta.put({ key: AI_DEBUG_RECORDS_KEY, value: JSON.stringify(updated) })
}

/** Clear all records. Called on card switch (`setActiveGameCardId`). */
export async function clearAiDebugRecords(): Promise<void> {
  await localDb.meta.delete(AI_DEBUG_RECORDS_KEY)
}
