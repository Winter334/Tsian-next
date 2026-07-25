import type {
  FrontendActionPublicError,
  FrontendActionRuntimeErrorCode,
  JsonValue,
  RuntimeWorkspaceMutationEvent,
} from "@tsian/contracts"
import {
  createFrontendActionRuntimeError,
  publicFrontendActionError,
  isValidFrontendActionId,
  validateStrictJson,
} from "../platform-host/frontend-actions"

export const FRONTEND_ACTION_INVOCATION_ID_MAX_LENGTH = 128
export const FRONTEND_ACTION_INVOCATION_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/

const FRONTEND_ACTION_RUNTIME_ERROR_CODES = new Set<FrontendActionRuntimeErrorCode>([
  "FRONTEND_ACTION_NOT_FOUND",
  "FRONTEND_ACTION_MANIFEST_INVALID",
  "FRONTEND_ACTION_INPUT_INVALID",
  "FRONTEND_ACTION_OUTPUT_INVALID",
  "FRONTEND_ACTION_TIMEOUT",
  "FRONTEND_ACTION_ABORTED",
  "FRONTEND_ACTION_WORKSPACE_CONFLICT",
  "FRONTEND_ACTION_EXECUTION_FAILED",
  "FRONTEND_ACTION_SESSION_REPLACED",
])
const FRONTEND_ACTION_DOMAIN_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/
const FRONTEND_ACTION_PUBLIC_ERROR_MAX_MESSAGE_LENGTH = 500
const FRONTEND_ACTION_RUN_REQUEST_FIELDS = new Set(["invocationId", "actionId", "input"])
const FRONTEND_ACTION_ABORT_REQUEST_FIELDS = new Set(["invocationId"])
const FRONTEND_ACTION_PUBLIC_ERROR_FIELDS = new Set([
  "kind",
  "code",
  "message",
  "details",
  "correlationId",
])

type ActiveFrontendActionInvocationPhase =
  | "accepted"
  | "running"
  | "committing"
  | "committed"

type TerminalFrontendActionInvocationPhase =
  | "completed"
  | "aborted"
  | "timed-out"
  | "conflicted"
  | "failed"
  | "session-replaced"

export type FrontendActionInvocationPhase =
  | ActiveFrontendActionInvocationPhase
  | TerminalFrontendActionInvocationPhase

export interface RemoteFrontendActionServiceResult {
  readonly output: JsonValue
  /** Present only after the service's durable, non-empty workspace commit. */
  readonly mutation?: RuntimeWorkspaceMutationEvent
}

export interface RemoteFrontendActionBeforeCommitContext {
  /** Invocation-start save id that the durable commit remains bound to. */
  readonly saveId: string
}

export interface RemoteFrontendActionServiceRequest {
  readonly expectedGameCardId: string
  readonly invocationId: string
  readonly actionId: string
  readonly input: JsonValue
  readonly signal: AbortSignal
  /** The service must await this immediately before entering durable commit. */
  readonly beforeCommit: (
    context: RemoteFrontendActionBeforeCommitContext,
  ) => void | Promise<void>
  /** Storage must call this synchronously at transaction entry and before writes. */
  readonly assertCommitAllowed: () => void
}

/**
 * Stateless execution seam. Invocation/session ownership deliberately stays in
 * the iframe mount lifecycle rather than in the host service singleton.
 */
export interface RemoteFrontendActionService {
  runAction(
    request: RemoteFrontendActionServiceRequest,
  ): Promise<RemoteFrontendActionServiceResult>
}

export interface RemoteFrontendActionRunRequest {
  readonly invocationId: string
  readonly actionId: string
  readonly input: JsonValue
}

export function isValidFrontendActionInvocationId(value: string): boolean {
  return value.length <= FRONTEND_ACTION_INVOCATION_ID_MAX_LENGTH
    && FRONTEND_ACTION_INVOCATION_ID_PATTERN.test(value)
}

function inputInvalid(correlationId?: string): FrontendActionPublicError {
  return runtimeError("FRONTEND_ACTION_INPUT_INVALID", correlationId)
}

function hasOnlyEnumerableFields(
  record: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): boolean {
  return Reflect.ownKeys(record).every((key) => (
    typeof key === "string"
    && allowedFields.has(key)
    && Object.prototype.propertyIsEnumerable.call(record, key)
    && "value" in (Object.getOwnPropertyDescriptor(record, key) ?? {})
  ))
}

/** Strictly normalizes the untrusted card.runAction postMessage payload. */
export function normalizeRemoteFrontendActionRunRequest(
  value: unknown,
): RemoteFrontendActionRunRequest {
  if (!isPlainRecord(value)
    || !hasOnlyEnumerableFields(value, FRONTEND_ACTION_RUN_REQUEST_FIELDS)
    || typeof value.invocationId !== "string"
    || !isValidFrontendActionInvocationId(value.invocationId)
    || typeof value.actionId !== "string"
    || !isValidFrontendActionId(value.actionId)) {
    throw inputInvalid()
  }
  const validation = validateStrictJson(value.input)
  if (!validation.ok) throw inputInvalid(value.invocationId)
  return {
    invocationId: value.invocationId,
    actionId: value.actionId,
    input: validation.value,
  }
}

/** Strictly normalizes the untrusted card.abortAction postMessage payload. */
export function normalizeRemoteFrontendActionAbortRequest(value: unknown): string {
  if (!isPlainRecord(value)
    || Reflect.ownKeys(value).length !== 1
    || !hasOnlyEnumerableFields(value, FRONTEND_ACTION_ABORT_REQUEST_FIELDS)
    || typeof value.invocationId !== "string"
    || !isValidFrontendActionInvocationId(value.invocationId)) {
    throw inputInvalid()
  }
  return value.invocationId
}

export interface RemoteFrontendActionLifecycleOptions {
  readonly expectedGameCardId: string
  readonly service: RemoteFrontendActionService
  readonly isCurrent: () => boolean
  /** Fresh authoritative check performed after durable commit and before delivery. */
  readonly isCurrentBinding: (
    saveId: string,
    gameCardId: string,
  ) => boolean | Promise<boolean>
  readonly onWorkspaceMutation: (event: RuntimeWorkspaceMutationEvent) => void
}

export interface RemoteFrontendActionLifecycle {
  readonly activeInvocationCount: number
  runAction(request: RemoteFrontendActionRunRequest): Promise<JsonValue>
  abortAction(invocationId: string): void
  phase(invocationId: string): FrontendActionInvocationPhase | undefined
  dispose(): void
}

interface FrontendActionInvocation {
  readonly controller: AbortController
  phase: FrontendActionInvocationPhase
  commitPrepared: boolean
  committedSaveId: string | null
  commitAssertionCount: 0 | 1 | 2
}

function runtimeError(
  code: FrontendActionRuntimeErrorCode,
  correlationId?: string,
): FrontendActionPublicError {
  return createFrontendActionRuntimeError(code, {
    ...(correlationId ? { correlationId } : {}),
  }) as FrontendActionPublicError
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function hasOnlyPublicErrorFields(record: Record<string, unknown>): boolean {
  return hasOnlyEnumerableFields(record, FRONTEND_ACTION_PUBLIC_ERROR_FIELDS)
}

function isStrictInvocationIdOrUndefined(value: unknown): boolean {
  return value === undefined
    || (typeof value === "string" && isValidFrontendActionInvocationId(value))
}

/** Revalidate public envelopes before they cross into an untrusted iframe. */
export function normalizeFrontendActionPublicError(
  error: unknown,
): FrontendActionPublicError {
  const candidate = isPlainRecord(error)
    ? error
    : isPlainRecord((error as { publicError?: unknown } | null)?.publicError)
      ? (error as { publicError: Record<string, unknown> }).publicError
      : null
  if (candidate && hasOnlyPublicErrorFields(candidate)) {
    const validation = validateStrictJson(candidate)
    const message = candidate.message
    const correlationId = candidate.correlationId
    const sharedValid = validation.ok
      && typeof candidate.code === "string"
      && typeof message === "string"
      && message.length > 0
      && message.length <= FRONTEND_ACTION_PUBLIC_ERROR_MAX_MESSAGE_LENGTH
      && isStrictInvocationIdOrUndefined(correlationId)

    if (sharedValid
      && candidate.kind === "runtime"
      && FRONTEND_ACTION_RUNTIME_ERROR_CODES.has(candidate.code as FrontendActionRuntimeErrorCode)) {
      return candidate as unknown as FrontendActionPublicError
    }
    if (sharedValid
      && candidate.kind === "domain"
      && FRONTEND_ACTION_DOMAIN_ERROR_CODE_PATTERN.test(candidate.code as string)) {
      return candidate as unknown as FrontendActionPublicError
    }
  }

  return publicFrontendActionError(error) as FrontendActionPublicError
}

function terminalPhaseFor(error: FrontendActionPublicError): TerminalFrontendActionInvocationPhase {
  if (error.kind !== "runtime") return "failed"
  if (error.code === "FRONTEND_ACTION_ABORTED") return "aborted"
  if (error.code === "FRONTEND_ACTION_TIMEOUT") return "timed-out"
  if (error.code === "FRONTEND_ACTION_WORKSPACE_CONFLICT") return "conflicted"
  if (error.code === "FRONTEND_ACTION_SESSION_REPLACED") return "session-replaced"
  return "failed"
}

function normalizedPaths(paths: readonly string[]): string[] {
  if (!Array.isArray(paths)) {
    throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED")
  }
  const normalized = paths.map((path) => {
    if (typeof path !== "string" || path.length === 0 || path.trim() !== path) {
      throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED")
    }
    return path
  })
  return Array.from(new Set(normalized)).sort()
}

function workspaceMutationEvent(
  request: RemoteFrontendActionRunRequest,
  mutation: RuntimeWorkspaceMutationEvent | undefined,
  committedSaveId: string,
): RuntimeWorkspaceMutationEvent | null {
  if (mutation === undefined) return null
  if (mutation.source !== "frontend-action"
    || mutation.invocationId !== request.invocationId
    || mutation.actionId !== request.actionId
    || mutation.saveId !== committedSaveId
    || typeof mutation.saveId !== "string"
    || mutation.saveId.length === 0
    || mutation.saveId.trim() !== mutation.saveId) {
    throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED")
  }

  const writtenPaths = normalizedPaths(mutation.writtenPaths)
  const deletedPaths = normalizedPaths(mutation.deletedPaths)
  if (writtenPaths.length === 0 && deletedPaths.length === 0) {
    throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED")
  }

  return {
    invocationId: request.invocationId,
    saveId: mutation.saveId,
    source: "frontend-action",
    actionId: request.actionId,
    writtenPaths,
    deletedPaths,
  }
}

export function createRemoteFrontendActionLifecycle(
  options: RemoteFrontendActionLifecycleOptions,
): RemoteFrontendActionLifecycle {
  const invocations = new Map<string, FrontendActionInvocation>()
  const terminalPhases = new Map<string, TerminalFrontendActionInvocationPhase>()
  let disposed = false

  function current(): boolean {
    return !disposed && options.isCurrent()
  }

  function sessionReplaced(invocationId: string): FrontendActionPublicError {
    return runtimeError("FRONTEND_ACTION_SESSION_REPLACED", invocationId)
  }

  function abortError(invocationId: string): FrontendActionPublicError {
    return runtimeError("FRONTEND_ACTION_ABORTED", invocationId)
  }

  return {
    get activeInvocationCount() {
      return invocations.size
    },

    async runAction(request) {
      if (!current()) throw sessionReplaced(request.invocationId)
      if (invocations.has(request.invocationId)) {
        throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
      }

      terminalPhases.delete(request.invocationId)
      const invocation: FrontendActionInvocation = {
        controller: new AbortController(),
        phase: "accepted",
        commitPrepared: false,
        committedSaveId: null,
        commitAssertionCount: 0,
      }
      invocations.set(request.invocationId, invocation)

      try {
        invocation.phase = "running"
        const serviceResult = await options.service.runAction({
          expectedGameCardId: options.expectedGameCardId,
          invocationId: request.invocationId,
          actionId: request.actionId,
          input: request.input,
          signal: invocation.controller.signal,
          beforeCommit(context) {
            if (!current()) {
              invocation.controller.abort()
              throw sessionReplaced(request.invocationId)
            }
            if (invocation.controller.signal.aborted) {
              throw abortError(request.invocationId)
            }
            if (invocation.phase !== "running" || invocation.commitPrepared) {
              throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
            }
            if (typeof context?.saveId !== "string"
              || context.saveId.length === 0
              || context.saveId.trim() !== context.saveId) {
              throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
            }
            invocation.committedSaveId = context.saveId
            invocation.commitPrepared = true
          },
          assertCommitAllowed() {
            if (!current()) {
              if (invocation.commitAssertionCount < 2) invocation.controller.abort()
              throw sessionReplaced(request.invocationId)
            }
            if (invocation.controller.signal.aborted) {
              throw abortError(request.invocationId)
            }
            if (!invocation.commitPrepared) {
              throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
            }
            if (invocation.commitAssertionCount === 0) {
              if (invocation.phase !== "running") {
                throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
              }
              invocation.phase = "committing"
              invocation.commitAssertionCount = 1
              return
            }
            if (invocation.commitAssertionCount === 1) {
              if (invocation.phase !== "committing") {
                throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
              }
              invocation.commitAssertionCount = 2
              return
            }
            if (invocation.phase !== "committing" && invocation.phase !== "committed") {
              throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
            }
          },
        })

        // Two successful in-transaction assertions establish the durable commit
        // boundary. A service result may only represent success after that point.
        if (invocation.commitAssertionCount < 2 || invocation.committedSaveId === null) {
          throw runtimeError("FRONTEND_ACTION_EXECUTION_FAILED", request.invocationId)
        }
        invocation.phase = "committed"
        if (!current()) throw sessionReplaced(request.invocationId)

        let bindingCurrent: boolean
        try {
          bindingCurrent = await options.isCurrentBinding(
            invocation.committedSaveId,
            options.expectedGameCardId,
          )
        } catch {
          bindingCurrent = false
        }
        if (!current() || !bindingCurrent) {
          throw sessionReplaced(request.invocationId)
        }

        const outputValidation = validateStrictJson(serviceResult.output)
        if (!outputValidation.ok) {
          throw runtimeError("FRONTEND_ACTION_OUTPUT_INVALID", request.invocationId)
        }
        const mutation = workspaceMutationEvent(
          request,
          serviceResult.mutation,
          invocation.committedSaveId,
        )
        if (mutation && current()) {
          try {
            options.onWorkspaceMutation(mutation)
          } catch {
            // A remote/local subscriber cannot roll back an already durable commit.
          }
        }
        if (!current()) throw sessionReplaced(request.invocationId)

        invocation.phase = "completed"
        terminalPhases.set(request.invocationId, "completed")
        return outputValidation.value
      } catch (error) {
        const publicError = !current()
          ? sessionReplaced(request.invocationId)
          : invocation.controller.signal.aborted && invocation.phase !== "committed"
            ? abortError(request.invocationId)
            : normalizeFrontendActionPublicError(error)
        invocation.phase = terminalPhaseFor(publicError)
        terminalPhases.set(request.invocationId, invocation.phase)
        throw publicError
      } finally {
        invocations.delete(request.invocationId)
      }
    },

    abortAction(invocationId) {
      const invocation = invocations.get(invocationId)
      if (!invocation) return
      if (invocation.commitAssertionCount >= 2
        || invocation.phase === "committed"
        || invocation.phase === "completed") return
      invocation.controller.abort()
    },

    phase(invocationId) {
      return invocations.get(invocationId)?.phase ?? terminalPhases.get(invocationId)
    },

    dispose() {
      if (disposed) return
      disposed = true
      for (const [invocationId, invocation] of invocations) {
        if (invocation.commitAssertionCount < 2) {
          invocation.phase = "session-replaced"
          terminalPhases.set(invocationId, "session-replaced")
          invocation.controller.abort()
        }
      }
      invocations.clear()
    },
  }
}
