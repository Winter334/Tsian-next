export const AI_REQUEST_MAX_RETRIES = 3
export const AI_REQUEST_MAX_ATTEMPTS = AI_REQUEST_MAX_RETRIES + 1
export const AI_REQUEST_BASE_RETRY_DELAY_MS = 800

export type AiRequestAttemptEvent =
  | {
      phase: "started"
      attempt: number
      maxAttempts: number
      timestamp: number
    }
  | {
      phase: "succeeded"
      attempt: number
      maxAttempts: number
      timestamp: number
    }
  | {
      phase: "failed"
      attempt: number
      maxAttempts: number
      timestamp: number
      error: unknown
      retryable: boolean
      willRetry: boolean
      retryDelayMs?: number
      aborted: boolean
    }

const AI_REQUEST_RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export class AiRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AiRequestTimeoutError"
  }
}

export class AiHttpStatusError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, payload: unknown, message: string) {
    super(message)
    this.name = "AiHttpStatusError"
    this.status = status
    this.payload = payload
  }
}

export class AiResponseParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AiResponseParseError"
  }
}

export class AiStreamResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AiStreamResponseError"
  }
}

function assignCause<T extends Error>(error: T, cause: unknown): T {
  if (cause !== undefined) {
    ;(error as T & { cause?: unknown }).cause = cause
  }
  return error
}

export function createAiRequestTimeoutError(message: string, cause?: unknown): AiRequestTimeoutError {
  return assignCause(new AiRequestTimeoutError(message), cause)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

export function isAiRequestTimeoutError(error: unknown): boolean {
  return error instanceof AiRequestTimeoutError
}

export function isRetryableHttpStatus(status: number): boolean {
  return AI_REQUEST_RETRYABLE_HTTP_STATUSES.has(status)
}

function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const errorName = error.name.toLowerCase()
  const isFetchTransportError =
    error instanceof TypeError || errorName === "typeerror" || errorName === "networkerror"
  if (!isFetchTransportError) return false
  const message = error.message.toLowerCase()
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network error") ||
    message.includes("load failed") ||
    message.includes("fetch failed")
  )
}

export function isRetryableAiRequestError(error: unknown, parentSignal?: AbortSignal): boolean {
  if (parentSignal?.aborted) return false
  if (error instanceof AiHttpStatusError) {
    return isRetryableHttpStatus(error.status)
  }
  if (isAiRequestTimeoutError(error)) return true
  if (isAbortError(error)) return false
  return isFetchNetworkError(error)
}

function createAbortError(message: string): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError")
  }
  const error = new Error(message)
  error.name = "AbortError"
  return error
}

function getAbortSignalReason(signal: AbortSignal): unknown {
  return signal.reason ?? createAbortError("AI request was aborted.")
}

export function throwIfSignalAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw getAbortSignalReason(signal)
  }
}

function aiRequestRetryDelayMs(retryNumber: number): number {
  const baseDelay = AI_REQUEST_BASE_RETRY_DELAY_MS * 2 ** Math.max(0, retryNumber - 1)
  const jitter = Math.floor(Math.random() * Math.min(250, Math.max(1, baseDelay * 0.1)))
  return baseDelay + jitter
}

export function waitForAiRequestRetryDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  throwIfSignalAborted(signal)
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
        timeoutId = undefined
      }
      signal?.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(getAbortSignalReason(signal as AbortSignal))
    }
    timeoutId = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function describeAiRequestFailure(error: unknown): Record<string, unknown> {
  if (error instanceof AiHttpStatusError) {
    return {
      type: "http",
      status: error.status,
      message: error.message,
      payload: error.payload,
    }
  }
  if (isAiRequestTimeoutError(error)) {
    return {
      type: "timeout",
      message: error instanceof Error ? error.message : String(error),
    }
  }
  if (isAbortError(error)) {
    return {
      type: "abort",
      message: error instanceof Error ? error.message : String(error),
    }
  }
  if (error instanceof Error) {
    return {
      type: "error",
      name: error.name,
      message: error.message,
    }
  }
  return {
    type: "unknown",
    message: String(error),
  }
}

export async function withAiRequestRetry<T>(input: {
  requestId: string
  operation: string
  signal?: AbortSignal
  attempt: (context: { attempt: number; maxAttempts: number }) => Promise<T>
  shouldRetryError?: (error: unknown, context: { attempt: number; maxAttempts: number }) => boolean
  canRetryAfterError?: (error: unknown, context: { attempt: number; maxAttempts: number }) => boolean
  onAttempt?: (event: AiRequestAttemptEvent) => void
  retryDelayMs?: (retryNumber: number) => number
}): Promise<T> {
  for (let attempt = 1; attempt <= AI_REQUEST_MAX_ATTEMPTS; attempt += 1) {
    throwIfSignalAborted(input.signal)
    input.onAttempt?.({
      phase: "started",
      attempt,
      maxAttempts: AI_REQUEST_MAX_ATTEMPTS,
      timestamp: Date.now(),
    })
    try {
      const result = await input.attempt({ attempt, maxAttempts: AI_REQUEST_MAX_ATTEMPTS })
      input.onAttempt?.({
        phase: "succeeded",
        attempt,
        maxAttempts: AI_REQUEST_MAX_ATTEMPTS,
        timestamp: Date.now(),
      })
      return result
    } catch (error) {
      if (input.signal?.aborted) {
        const abortReason = getAbortSignalReason(input.signal)
        console.warn(`[Tsian AI ${input.requestId}] ${input.operation} attempt failed`, {
          attempt,
          maxAttempts: AI_REQUEST_MAX_ATTEMPTS,
          willRetry: false,
          aborted: true,
          failure: describeAiRequestFailure(error),
        })
        input.onAttempt?.({
          phase: "failed",
          attempt,
          maxAttempts: AI_REQUEST_MAX_ATTEMPTS,
          timestamp: Date.now(),
          error: abortReason,
          retryable: false,
          willRetry: false,
          aborted: true,
        })
        throw abortReason
      }

      const retryable = input.shouldRetryError
        ? input.shouldRetryError(error, { attempt, maxAttempts: AI_REQUEST_MAX_ATTEMPTS })
        : isRetryableAiRequestError(error, input.signal)
      const retryAllowedByCaller = input.canRetryAfterError
        ? input.canRetryAfterError(error, { attempt, maxAttempts: AI_REQUEST_MAX_ATTEMPTS })
        : true
      const willRetry = retryable && retryAllowedByCaller && attempt < AI_REQUEST_MAX_ATTEMPTS
      const retryInMs = willRetry
        ? (input.retryDelayMs?.(attempt) ?? aiRequestRetryDelayMs(attempt))
        : undefined

      input.onAttempt?.({
        phase: "failed",
        attempt,
        maxAttempts: AI_REQUEST_MAX_ATTEMPTS,
        timestamp: Date.now(),
        error,
        retryable,
        willRetry,
        ...(retryInMs !== undefined ? { retryDelayMs: retryInMs } : {}),
        aborted: false,
      })

      console.warn(`[Tsian AI ${input.requestId}] ${input.operation} attempt failed`, {
        attempt,
        maxAttempts: AI_REQUEST_MAX_ATTEMPTS,
        retryNumber: willRetry ? attempt : undefined,
        nextAttempt: willRetry ? attempt + 1 : undefined,
        willRetry,
        retryable,
        retryAllowedByCaller,
        retryInMs,
        failure: describeAiRequestFailure(error),
      })

      if (!willRetry || retryInMs === undefined) {
        throw error
      }
      await waitForAiRequestRetryDelay(retryInMs, input.signal)
    }
  }

  throw new Error("AI request retry loop exhausted unexpectedly.")
}

export async function readJsonPayload(
  response: Response,
  signal?: AbortSignal,
  allowInvalid = false,
): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (signal?.aborted) {
      throw getAbortSignalReason(signal)
    }
    if (isAbortError(error)) {
      throw error
    }
    if (allowInvalid) return null
    throw assignCause(new AiResponseParseError("AI response body is not valid JSON."), error)
  }
}

export function createTimedAbortSignal(input: {
  signal?: AbortSignal
  timeoutMs: number
  timeoutMessage: string
}): {
  signal: AbortSignal
  cleanup: () => void
  timedOut: () => boolean
} {
  const controller = new AbortController()
  let didTimeout = false

  const abortFromParent = () => {
    controller.abort(input.signal?.reason)
  }

  if (input.signal?.aborted) {
    abortFromParent()
  } else if (input.signal) {
    input.signal.addEventListener("abort", abortFromParent, { once: true })
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true
    controller.abort(new Error(input.timeoutMessage))
  }, input.timeoutMs)

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId)
      input.signal?.removeEventListener("abort", abortFromParent)
    },
    timedOut() {
      return didTimeout
    },
  }
}

export async function fetchJsonWithTimeout(input: {
  url: string
  init: RequestInit
  signal?: AbortSignal
  timeoutMs: number
  timeoutMessage: string
}): Promise<{ response: Response; payload: unknown }> {
  const timed = createTimedAbortSignal({
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    timeoutMessage: input.timeoutMessage,
  })

  try {
    const response = await fetch(input.url, {
      ...input.init,
      signal: timed.signal,
    })
    const payload = await readJsonPayload(response, timed.signal, !response.ok)
    return { response, payload }
  } catch (error) {
    if (timed.timedOut()) {
      throw createAiRequestTimeoutError(input.timeoutMessage, error)
    }
    throw error
  } finally {
    timed.cleanup()
  }
}

/**
 * Split a raw SSE chunk buffer into complete lines plus a trailing partial
 * line. `data:` payloads are returned decoded; `event:` lines surface the
 * current event type (Claude pairs `event:` with the following `data:`).
 * Comment/keep-alive lines (`:`) are dropped. Returns the list of parsed
 * lines and the leftover partial string to prepend to the next chunk.
 */
export function parseSseChunk(
  buffer: string,
): { lines: Array<{ kind: "data"; value: string } | { kind: "event"; value: string }>; rest: string } {
  const lines: Array<{ kind: "data"; value: string } | { kind: "event"; value: string }> = []
  const segments = buffer.split("\n")
  const rest = segments.pop() ?? ""
  for (const rawLine of segments) {
    const line = rawLine.replace(/\r$/, "")
    if (line.startsWith(":")) continue
    if (line.startsWith("data:")) {
      lines.push({ kind: "data", value: line.slice(5).replace(/^ /, "") })
    } else if (line.startsWith("event:")) {
      lines.push({ kind: "event", value: line.slice(6).replace(/^ /, "") })
    }
  }
  return { lines, rest }
}
