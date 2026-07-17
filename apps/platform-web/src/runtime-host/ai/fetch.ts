export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

export async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return null
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
    const payload = await readJsonPayload(response)
    return { response, payload }
  } catch (error) {
    if (timed.timedOut()) {
      throw new Error(input.timeoutMessage)
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
