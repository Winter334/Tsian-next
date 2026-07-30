import type {
  DiagnosticAiAttempt,
  DiagnosticAiRequestRecord,
  DiagnosticAiUsage,
  DiagnosticError,
  DiagnosticStoreHealth,
  JsonValue,
} from "@tsian/contracts"
import { DIAGNOSTIC_RECORD_SCHEMA_VERSION } from "@tsian/contracts"
import { putDiagnosticRecord } from "../../storage/diagnostic-records"
import type { AiRequestAttemptEvent } from "./fetch"
import { reserveAiTraceRequest, type AiTraceOperationContext } from "./trace-context"

const diagnosticStoreHealth: DiagnosticStoreHealth = { lostRecordCount: 0 }
const healthListeners = new Set<(health: DiagnosticStoreHealth) => void>()

export function getDiagnosticStoreHealth(): DiagnosticStoreHealth {
  return { ...diagnosticStoreHealth }
}

export function subscribeDiagnosticStoreHealth(
  listener: (health: DiagnosticStoreHealth) => void,
): () => void {
  healthListeners.add(listener)
  return () => healthListeners.delete(listener)
}

export function reportDiagnosticStoreFailure(error: unknown, now = Date.now()): void {
  diagnosticStoreHealth.lostRecordCount += 1
  diagnosticStoreHealth.lastFailureAt = now
  diagnosticStoreHealth.lastError = error instanceof Error ? error.message : String(error)
  const snapshot = getDiagnosticStoreHealth()
  for (const listener of healthListeners) {
    try {
      listener(snapshot)
    } catch {
      // Health observers are diagnostic UI only and cannot affect AI calls.
    }
  }
}

export function resetDiagnosticStoreHealthForTest(): void {
  diagnosticStoreHealth.lostRecordCount = 0
  delete diagnosticStoreHealth.lastFailureAt
  delete diagnosticStoreHealth.lastError
}

function asJsonValue(value: unknown): JsonValue {
  return value as JsonValue
}

export function diagnosticErrorFromUnknown(
  error: unknown,
  options: { aborted?: boolean } = {},
): DiagnosticError {
  const record = typeof error === "object" && error !== null
    ? error as { name?: unknown; message?: unknown; stack?: unknown; status?: unknown; payload?: unknown; code?: unknown }
    : null
  const name = typeof record?.name === "string" ? record.name : undefined
  const message = typeof record?.message === "string" ? record.message : String(error)
  const status = typeof record?.status === "number" ? record.status : undefined
  const lowerName = name?.toLowerCase() ?? ""
  const lowerMessage = message.toLowerCase()
  let type: DiagnosticError["type"]
  if (status !== undefined) type = "http"
  else if (lowerName.includes("timeout") || lowerMessage.includes("timed out") || lowerMessage.includes("timeout")) {
    type = "timeout"
  } else if (lowerName === "aborterror" || options.aborted) type = "abort"
  else if (lowerName.includes("streamresponse")) type = "stream"
  else if (
    lowerName === "syntaxerror"
    || lowerName.includes("responseparse")
    || lowerMessage.includes("parse")
    || lowerMessage.includes("json")
  ) {
    type = "parse"
  } else if (lowerName === "typeerror" && (lowerMessage.includes("fetch") || lowerMessage.includes("network"))) {
    type = "network"
  } else type = record ? "error" : "unknown"
  return {
    type,
    message,
    ...(name ? { name } : {}),
    ...(typeof record?.code === "string" ? { code: record.code } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(typeof record?.stack === "string" ? { stack: record.stack } : {}),
    ...(record?.payload !== undefined ? { details: asJsonValue(record.payload) } : {}),
  }
}

export interface BeginAiRequestTraceInput {
  context?: AiTraceOperationContext
  provider: string
  model: string
  endpoint: string
  streaming: boolean
  parameters?: unknown
  messages: unknown
  tools?: unknown
  headers?: unknown
  body?: unknown
}

export interface CompleteAiRequestTraceInput {
  text: string
  toolCalls?: unknown
  finishReason?: string
  usage?: DiagnosticAiUsage
  providerPayload?: unknown
}

export interface AiRequestTraceHandle {
  readonly requestId: string
  readonly context: AiTraceOperationContext
  onAttempt(event: AiRequestAttemptEvent): void
  succeed(input: CompleteAiRequestTraceInput): Promise<void>
  fail(error: unknown, input?: {
    signal?: AbortSignal
    response?: CompleteAiRequestTraceInput
  }): Promise<void>
}

interface TraceRecorderDependencies {
  now?: () => number
  write?: (record: DiagnosticAiRequestRecord) => Promise<unknown>
  requestId?: string
}

export async function beginAiRequestTrace(
  input: BeginAiRequestTraceInput,
  dependencies: TraceRecorderDependencies = {},
): Promise<AiRequestTraceHandle> {
  const now = dependencies.now ?? Date.now
  const write = dependencies.write ?? putDiagnosticRecord
  const correlation = reserveAiTraceRequest(input.context, dependencies.requestId)
  const startedAt = now()
  let record: DiagnosticAiRequestRecord = {
    id: correlation.requestId,
    recordType: "ai-request",
    requestId: correlation.requestId,
    operationId: correlation.operationId,
    ...(correlation.parentRequestId ? { parentRequestId: correlation.parentRequestId } : {}),
    ...(correlation.previousRequestId ? { previousRequestId: correlation.previousRequestId } : {}),
    sequence: correlation.sequence,
    timestamp: startedAt,
    updatedAt: startedAt,
    schemaVersion: DIAGNOSTIC_RECORD_SCHEMA_VERSION,
    sizeBytes: 0,
    status: "running",
    provider: input.provider,
    model: input.model,
    endpoint: input.endpoint,
    streaming: input.streaming,
    ...(input.parameters !== undefined ? { parameters: asJsonValue(input.parameters) } : {}),
    request: {
      messages: asJsonValue(input.messages),
      ...(input.tools !== undefined ? { tools: asJsonValue(input.tools) } : {}),
      ...(input.headers !== undefined ? { headers: asJsonValue(input.headers) } : {}),
      ...(input.body !== undefined ? { body: asJsonValue(input.body) } : {}),
    },
    attempts: [],
  }
  let writes: Promise<void> = Promise.resolve()

  const persist = (): Promise<void> => {
    let snapshot: DiagnosticAiRequestRecord
    try {
      snapshot = structuredClone(record)
    } catch (error) {
      reportDiagnosticStoreFailure(error, now())
      return Promise.resolve()
    }
    writes = writes.then(async () => {
      try {
        await write(snapshot)
      } catch (error) {
        reportDiagnosticStoreFailure(error, now())
      }
    })
    return writes
  }
  await persist()

  const updateAttempt = (event: AiRequestAttemptEvent): void => {
    const existing = record.attempts.find((attempt) => attempt.attempt === event.attempt)
    if (event.phase === "started") {
      const next: DiagnosticAiAttempt = {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        startedAt: event.timestamp,
        status: "running",
      }
      if (existing) Object.assign(existing, next)
      else record.attempts.push(next)
    } else if (existing) {
      existing.endedAt = event.timestamp
      if (event.phase === "succeeded") {
        existing.status = "succeeded"
      } else {
        existing.status = event.aborted ? "aborted" : "failed"
        existing.retryable = event.retryable
        existing.willRetry = event.willRetry
        if (event.retryDelayMs !== undefined) existing.retryDelayMs = event.retryDelayMs
        existing.error = diagnosticErrorFromUnknown(event.error, { aborted: event.aborted })
      }
    }
    record.updatedAt = event.timestamp
    void persist()
  }

  return {
    requestId: correlation.requestId,
    context: correlation.context,
    onAttempt: updateAttempt,
    async succeed(result) {
      const endedAt = now()
      record = {
        ...record,
        status: "succeeded",
        updatedAt: endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        response: {
          text: result.text,
          ...(result.toolCalls !== undefined ? { toolCalls: asJsonValue(result.toolCalls) } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.providerPayload !== undefined ? { providerPayload: asJsonValue(result.providerPayload) } : {}),
        },
      }
      await persist()
    },
    async fail(error, input = {}) {
      const endedAt = now()
      const diagnosticError = diagnosticErrorFromUnknown(error, { aborted: input.signal?.aborted })
      record = {
        ...record,
        status: diagnosticError.type === "abort" ? "aborted" : "failed",
        updatedAt: endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        error: diagnosticError,
        ...(input.response
          ? {
              response: {
                text: input.response.text,
                ...(input.response.toolCalls !== undefined ? { toolCalls: asJsonValue(input.response.toolCalls) } : {}),
                ...(input.response.finishReason ? { finishReason: input.response.finishReason } : {}),
                ...(input.response.usage ? { usage: input.response.usage } : {}),
                ...(input.response.providerPayload !== undefined
                  ? { providerPayload: asJsonValue(input.response.providerPayload) }
                  : {}),
              },
            }
          : {}),
      }
      await persist()
    },
  }
}
