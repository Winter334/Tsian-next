function createCorrelationId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID()
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

interface AiTraceSequenceState {
  value: number
}

/** Mutable, in-memory-only correlation passed between generic model calls. */
export interface AiTraceOperationContext {
  operationId: string
  parentRequestId?: string
  previousRequestId?: string
  sequenceState: AiTraceSequenceState
}

export function createAiTraceOperationContext(operationId = createCorrelationId("operation")): AiTraceOperationContext {
  return { operationId, sequenceState: { value: 0 } }
}

/** Fork a delegated branch from the caller's most recent provider request. */
export function forkAiTraceOperationContext(
  context: AiTraceOperationContext | undefined,
): AiTraceOperationContext {
  if (!context) return createAiTraceOperationContext()
  return {
    operationId: context.operationId,
    ...(context.previousRequestId ? { parentRequestId: context.previousRequestId } : {}),
    sequenceState: context.sequenceState,
  }
}

export function reserveAiTraceRequest(
  context: AiTraceOperationContext | undefined,
  requestId = createCorrelationId("request"),
): {
  context: AiTraceOperationContext
  requestId: string
  operationId: string
  parentRequestId?: string
  previousRequestId?: string
  sequence: number
} {
  const active = context ?? createAiTraceOperationContext()
  const previousRequestId = active.previousRequestId
  const sequence = ++active.sequenceState.value
  active.previousRequestId = requestId
  return {
    context: active,
    requestId,
    operationId: active.operationId,
    ...(active.parentRequestId ? { parentRequestId: active.parentRequestId } : {}),
    ...(previousRequestId ? { previousRequestId } : {}),
    sequence,
  }
}
