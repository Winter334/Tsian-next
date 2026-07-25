import type {
  FrontendActionPublicError,
  FrontendActionRuntimeErrorCode,
  JsonValue,
} from "@tsian/contracts"
import {
  validateStrictJson,
  type StrictJsonIssue,
} from "./json"

export type {
  FrontendActionPublicError,
  FrontendActionRuntimeErrorCode,
}

export interface FrontendActionDomainErrorEnvelope {
  code: string
  message: string
  details?: JsonValue
}

export const FRONTEND_ACTION_DOMAIN_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/
export const FRONTEND_ACTION_DOMAIN_ERROR_MAX_MESSAGE_LENGTH = 500
export const FRONTEND_ACTION_DOMAIN_ERROR_MAX_DETAILS_BYTES = 64 * 1024
export const FRONTEND_ACTION_DOMAIN_ERROR_MAX_DETAILS_DEPTH = 16

const RUNTIME_MESSAGES: Record<FrontendActionRuntimeErrorCode, string> = {
  FRONTEND_ACTION_NOT_FOUND: "Frontend Action was not found.",
  FRONTEND_ACTION_MANIFEST_INVALID: "Frontend Action manifest is invalid.",
  FRONTEND_ACTION_INPUT_INVALID: "Frontend Action input is invalid.",
  FRONTEND_ACTION_OUTPUT_INVALID: "Frontend Action output is invalid.",
  FRONTEND_ACTION_TIMEOUT: "Frontend Action timed out.",
  FRONTEND_ACTION_ABORTED: "Frontend Action was aborted.",
  FRONTEND_ACTION_WORKSPACE_CONFLICT: "Frontend Action workspace changed concurrently.",
  FRONTEND_ACTION_EXECUTION_FAILED: "Frontend Action execution failed.",
  FRONTEND_ACTION_SESSION_REPLACED: "Frontend Action session was replaced.",
}

export interface FrontendActionRuntimeErrorOptions {
  correlationId?: string
  diagnostics?: unknown
}

export function createFrontendActionRuntimeError(
  code: FrontendActionRuntimeErrorCode,
  options: {
    correlationId?: string
  } = {},
): FrontendActionPublicError {
  const error: FrontendActionPublicError = {
    kind: "runtime",
    code,
    message: RUNTIME_MESSAGES[code],
  }
  if (options.correlationId !== undefined) error.correlationId = options.correlationId
  return error
}

export class FrontendActionRuntimeError extends Error {
  readonly publicError: FrontendActionPublicError
  readonly diagnostics?: unknown

  constructor(
    readonly code: FrontendActionRuntimeErrorCode,
    options: FrontendActionRuntimeErrorOptions = {},
  ) {
    const publicError = createFrontendActionRuntimeError(code, options)
    super(publicError.message)
    this.name = "FrontendActionRuntimeError"
    this.publicError = publicError
    this.diagnostics = options.diagnostics
  }
}

export class FrontendActionDomainError extends Error {
  constructor(readonly publicError: FrontendActionPublicError) {
    super(publicError.message)
    this.name = "FrontendActionDomainError"
  }
}

export function publicFrontendActionError(error: unknown): FrontendActionPublicError {
  if (error instanceof FrontendActionRuntimeError) return error.publicError
  if (error instanceof FrontendActionDomainError) return error.publicError
  return createFrontendActionRuntimeError("FRONTEND_ACTION_EXECUTION_FAILED")
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as object | null
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Reflect.ownKeys(value).every((key) => typeof key === "string" && expected.has(key))
}

export type FrontendActionDomainEnvelopeResult =
  | { ok: true; error: FrontendActionPublicError }
  | { ok: false; issue: StrictJsonIssue | { code: "invalid_envelope"; message: string } }

/**
 * Parses only the dedicated card domain-error envelope. Ordinary thrown values
 * must not be passed through because their messages may contain source or data.
 */
export function parseFrontendActionDomainError(
  value: unknown,
  correlationId?: string,
): FrontendActionDomainEnvelopeResult {
  const envelopeValidation = validateStrictJson(value, {
    maxBytes: FRONTEND_ACTION_DOMAIN_ERROR_MAX_DETAILS_BYTES
      + FRONTEND_ACTION_DOMAIN_ERROR_MAX_MESSAGE_LENGTH
      + 256,
    maxDepth: FRONTEND_ACTION_DOMAIN_ERROR_MAX_DETAILS_DEPTH + 1,
    maxNodes: 100_000,
  })
  if (!envelopeValidation.ok) {
    return { ok: false, issue: envelopeValidation.issue }
  }
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ["code", "message", "details"])) {
    return {
      ok: false,
      issue: { code: "invalid_envelope", message: "Domain error envelope has invalid fields." },
    }
  }

  const { code, message, details } = value
  if (typeof code !== "string" || !FRONTEND_ACTION_DOMAIN_ERROR_CODE_PATTERN.test(code)) {
    return {
      ok: false,
      issue: { code: "invalid_envelope", message: "Domain error code is invalid." },
    }
  }
  if (
    typeof message !== "string"
    || message.length === 0
    || message.length > FRONTEND_ACTION_DOMAIN_ERROR_MAX_MESSAGE_LENGTH
  ) {
    return {
      ok: false,
      issue: { code: "invalid_envelope", message: "Domain error message is invalid." },
    }
  }

  let strictDetails: JsonValue | undefined
  if (details !== undefined) {
    const validation = validateStrictJson(details, {
      maxBytes: FRONTEND_ACTION_DOMAIN_ERROR_MAX_DETAILS_BYTES,
      maxDepth: FRONTEND_ACTION_DOMAIN_ERROR_MAX_DETAILS_DEPTH,
      maxNodes: 100_000,
    })
    if (!validation.ok) return { ok: false, issue: validation.issue }
    strictDetails = validation.value
  }

  const error: FrontendActionPublicError = {
    kind: "domain",
    code,
    message,
  }
  if (strictDetails !== undefined) error.details = strictDetails
  if (correlationId !== undefined) error.correlationId = correlationId
  return { ok: true, error }
}
