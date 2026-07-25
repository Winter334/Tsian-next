import type {
  FrontendActionPublicError,
  FrontendActionRuntimeErrorCode,
  JsonValue,
} from "@tsian/contracts"
import {
  FRONTEND_ACTION_JSON_MAX_NODES,
  validateStrictJson,
} from "./strict-json"

const RUNTIME_ERROR_CODES = new Set<FrontendActionRuntimeErrorCode>([
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

const PUBLIC_ERROR_FIELDS = new Set([
  "kind",
  "code",
  "message",
  "details",
  "correlationId",
])
const PUBLIC_ERROR_MAX_MESSAGE_LENGTH = 500
const DOMAIN_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/
const DOMAIN_ERROR_MAX_DETAILS_BYTES = 64 * 1024
const DOMAIN_ERROR_MAX_DETAILS_DEPTH = 16
const CORRELATION_ID_MAX_LENGTH = 128
const CORRELATION_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,126}[A-Za-z0-9])?$/

export class FrontendActionError extends Error {
  readonly kind: FrontendActionPublicError["kind"]
  readonly code: string
  readonly details?: JsonValue
  readonly correlationId?: string

  constructor(error: FrontendActionPublicError) {
    super(error.message)
    this.name = "FrontendActionError"
    this.kind = error.kind
    this.code = error.code
    this.details = error.details
    this.correlationId = error.correlationId
  }
}

function executionFailedError(): FrontendActionError {
  return new FrontendActionError({
    kind: "runtime",
    code: "FRONTEND_ACTION_EXECUTION_FAILED",
    message: "The Frontend Action could not be completed.",
  })
}

export function inputInvalidError(): FrontendActionError {
  return new FrontendActionError({
    kind: "runtime",
    code: "FRONTEND_ACTION_INPUT_INVALID",
    message: "Frontend Action input must satisfy the strict JSON transport limits.",
  })
}

export function abortedError(): FrontendActionError {
  return new FrontendActionError({
    kind: "runtime",
    code: "FRONTEND_ACTION_ABORTED",
    message: "The Frontend Action was aborted.",
  })
}

function isValidCorrelationId(value: unknown): value is string {
  return typeof value === "string"
    && value.length <= CORRELATION_ID_MAX_LENGTH
    && CORRELATION_ID_PATTERN.test(value)
}

function toPublicError(value: unknown): FrontendActionPublicError | null {
  try {
    // Validate the complete envelope first. This rejects exotic prototypes,
    // accessors, symbols, unknown lossy values, and oversized transport data.
    const envelopeValidation = validateStrictJson(value)
    if (!envelopeValidation.ok
      || value === null
      || typeof value !== "object"
      || Array.isArray(value)) {
      return null
    }

    const keys = Reflect.ownKeys(value)
    if (!keys.every((key) => typeof key === "string" && PUBLIC_ERROR_FIELDS.has(key))) {
      return null
    }

    const fields = new Map<string, unknown>()
    for (const key of keys) {
      if (typeof key !== "string") return null
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null
      fields.set(key, descriptor.value)
    }

    const kind = fields.get("kind")
    const code = fields.get("code")
    const message = fields.get("message")
    if (!fields.has("kind")
      || !fields.has("code")
      || !fields.has("message")
      || typeof code !== "string"
      || typeof message !== "string"
      || message.length === 0
      || message.length > PUBLIC_ERROR_MAX_MESSAGE_LENGTH) {
      return null
    }

    const hasCorrelationId = fields.has("correlationId")
    const correlationId = fields.get("correlationId")
    if (hasCorrelationId && !isValidCorrelationId(correlationId)) return null

    const hasDetails = fields.has("details")
    const details = fields.get("details")
    if (hasDetails && kind === "domain") {
      const detailsValidation = validateStrictJson(details, {
        maxBytes: DOMAIN_ERROR_MAX_DETAILS_BYTES,
        maxDepth: DOMAIN_ERROR_MAX_DETAILS_DEPTH,
        maxNodes: FRONTEND_ACTION_JSON_MAX_NODES,
      })
      if (!detailsValidation.ok) return null
    }

    const shared = {
      code,
      message,
      ...(hasDetails ? { details: details as JsonValue } : {}),
      ...(hasCorrelationId ? { correlationId: correlationId as string } : {}),
    }

    if (kind === "runtime"
      && RUNTIME_ERROR_CODES.has(code as FrontendActionRuntimeErrorCode)) {
      return {
        kind: "runtime",
        ...shared,
        code: code as FrontendActionRuntimeErrorCode,
      }
    }

    if (kind === "domain" && DOMAIN_ERROR_CODE_PATTERN.test(code)) {
      return { kind: "domain", ...shared }
    }

    return null
  } catch {
    // Hostile proxies and unstable descriptors are invalid transport data.
    return null
  }
}

/** Convert only a valid public Action envelope; never expose raw transport errors. */
export function toFrontendActionError(value: unknown): FrontendActionError {
  if (value instanceof FrontendActionError) return value
  const publicError = toPublicError(value)
  return publicError ? new FrontendActionError(publicError) : executionFailedError()
}
