import { localDb } from "./db"

const FRONTEND_DEBUG_SESSION_KEY = "frontend-debug-session"
const FRONTEND_DEBUG_SESSION_SCHEMA = "tsian.frontend-debug-session.v1"

export interface FrontendDebugSessionRecord {
  schema: typeof FRONTEND_DEBUG_SESSION_SCHEMA
  saveId: string
  gameCardId: string
  checkpointId: string
  baselineTurn: number
  startedAt: number
}

export type FrontendDebugSessionState =
  | { status: "absent" }
  | { status: "valid"; record: FrontendDebugSessionRecord }
  | { status: "invalid" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeFrontendDebugSession(value: unknown): FrontendDebugSessionRecord | null {
  if (!isRecord(value) || value.schema !== FRONTEND_DEBUG_SESSION_SCHEMA) {
    return null
  }
  if (
    typeof value.saveId !== "string" || !value.saveId
    || typeof value.gameCardId !== "string" || !value.gameCardId
    || typeof value.checkpointId !== "string" || !value.checkpointId
    || typeof value.baselineTurn !== "number" || !Number.isInteger(value.baselineTurn) || value.baselineTurn < 0
    || typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt) || value.startedAt <= 0
  ) {
    return null
  }
  return {
    schema: FRONTEND_DEBUG_SESSION_SCHEMA,
    saveId: value.saveId,
    gameCardId: value.gameCardId,
    checkpointId: value.checkpointId,
    baselineTurn: value.baselineTurn,
    startedAt: value.startedAt,
  }
}

export async function getFrontendDebugSession(): Promise<FrontendDebugSessionState> {
  const stored = await localDb.meta.get(FRONTEND_DEBUG_SESSION_KEY)
  if (!stored) {
    return { status: "absent" }
  }
  try {
    const record = normalizeFrontendDebugSession(JSON.parse(stored.value))
    return record ? { status: "valid", record } : { status: "invalid" }
  } catch {
    return { status: "invalid" }
  }
}

export async function setFrontendDebugSession(
  input: Omit<FrontendDebugSessionRecord, "schema">,
): Promise<FrontendDebugSessionRecord> {
  const record: FrontendDebugSessionRecord = {
    schema: FRONTEND_DEBUG_SESSION_SCHEMA,
    ...input,
  }
  await localDb.meta.put({
    key: FRONTEND_DEBUG_SESSION_KEY,
    value: JSON.stringify(record),
  })
  return record
}

export async function clearFrontendDebugSession(): Promise<void> {
  await localDb.meta.delete(FRONTEND_DEBUG_SESSION_KEY)
}

export async function getProtectedFrontendDebugCheckpointId(
  saveId: string,
): Promise<string | null> {
  const state = await getFrontendDebugSession()
  return state.status === "valid" && state.record.saveId === saveId
    ? state.record.checkpointId
    : null
}
