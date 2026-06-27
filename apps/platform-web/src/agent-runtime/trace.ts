import type { JsonValue } from "@tsian/contracts"

export type RuntimeTraceEventType =
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "agent_step_started"
  | "agent_step_completed"
  | "agent_step_failed"
  | "model_call_completed"
  | "skill_loaded"
  | "agent_called"
  | "workspace_tool_called"
  | "action_executor_policy_checked"
  | "action_called"
  | "agent_context_staged"
  | "context_compressed"
  | "context_compressed_in_turn"
  | "context_compression_failed"
  | "script_log"
  | "workspace_mutation"

export type RuntimeTraceDebugLabel = "entry-agent" | `agent:${string}`

export interface RuntimeTraceEvent {
  type: RuntimeTraceEventType
  timestamp: number
  turn: number
  agentId?: string
  debugLabel?: RuntimeTraceDebugLabel
  ok?: boolean
  data?: Record<string, JsonValue>
}

export type RuntimeTraceEventInput =
  Omit<RuntimeTraceEvent, "timestamp" | "turn" | "data"> & {
    data?: Record<string, unknown>
  }

export type RuntimeTraceEmitter = (event: RuntimeTraceEventInput) => void

export interface RuntimeTraceCollector {
  readonly events: RuntimeTraceEvent[]
  emit: RuntimeTraceEmitter
}

const TRACE_PREVIEW_LIMIT = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function valueKind(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return null
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return value.map((item) => toJsonValue(item, seen))
  }

  if (isRecord(value)) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry, seen)]),
    )
  }

  return String(value)
}

function stringifyJsonValue(value: JsonValue): string {
  try {
    return JSON.stringify(value)
  } catch {
    return "null"
  }
}

export function summarizeTraceValue(value: unknown): Record<string, JsonValue> {
  const jsonValue = toJsonValue(value)
  const json = stringifyJsonValue(jsonValue)
  const summary: Record<string, JsonValue> = {
    type: valueKind(value),
    jsonLength: json.length,
  }

  if (isRecord(value)) {
    summary.keys = Object.keys(value).sort()
  } else if (Array.isArray(value)) {
    summary.length = value.length
  } else if (typeof value === "string") {
    summary.stringLength = value.length
    summary.preview = value.slice(0, TRACE_PREVIEW_LIMIT)
  }

  return summary
}

export function errorToTraceData(error: unknown): Record<string, JsonValue> {
  if (isRecord(error)) {
    return {
      code: typeof error.code === "string" ? error.code : "ERROR",
      message: typeof error.message === "string" ? error.message : "Unknown error.",
      ...(error.details === undefined ? {} : { details: toJsonValue(error.details) }),
    }
  }

  return {
    code: error instanceof DOMException ? error.name : "ERROR",
    message: error instanceof Error ? error.message : String(error),
  }
}

export function createRuntimeTraceCollector(turn: number): RuntimeTraceCollector {
  const events: RuntimeTraceEvent[] = []
  return {
    events,
    emit(event) {
      const { data, ...eventFields } = event
      events.push({
        ...eventFields,
        turn,
        timestamp: Date.now(),
        ...(data ? { data: toJsonValue(data) as Record<string, JsonValue> } : {}),
      })
    },
  }
}

export function serializeRuntimeTraceEvents(events: RuntimeTraceEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n"
}

export function formatRuntimeTracePath(turn: number, failedAt?: number): string {
  const paddedTurn = String(Math.max(0, Math.floor(turn))).padStart(6, "0")
  const suffix = failedAt === undefined ? "" : `-failed-${failedAt}`
  return `.tsian/save/traces/turns/turn-${paddedTurn}${suffix}.jsonl`
}
