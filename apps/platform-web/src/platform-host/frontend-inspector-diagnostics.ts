import type {
  InspectFrontendDiagnostics,
} from "../agent-runtime/workspace-tools"

const MAX_ERRORS = 50
const MAX_CONSOLE = 100
const MAX_RESOURCE_FAILURES = 50
const MAX_ERROR_STACK = 2_000
const MAX_CONSOLE_ARG = 500

export interface FrontendDiagnosticsCollector {
  readonly truncated: boolean
  snapshot(
    bridgeHandshake: InspectFrontendDiagnostics["bridgeHandshake"],
  ): InspectFrontendDiagnostics
  dispose(): void
}

export function emptyInspectDiagnostics(): InspectFrontendDiagnostics {
  return {
    errors: [],
    console: [],
    resourceFailures: [],
    bridgeHandshake: "pending",
  }
}

export function createFrontendDiagnosticsCollector(
  iframe: HTMLIFrameElement,
): FrontendDiagnosticsCollector {
  const frameWindow = iframe.contentWindow as (Window & typeof globalThis) | null
  const frameDocument = iframe.contentDocument
  if (!frameWindow || !frameDocument) {
    return {
      truncated: false,
      snapshot: () => emptyInspectDiagnostics(),
      dispose: () => undefined,
    }
  }

  const errors: InspectFrontendDiagnostics["errors"] = []
  const consoleEntries: InspectFrontendDiagnostics["console"] = []
  const resourceFailures: InspectFrontendDiagnostics["resourceFailures"] = []
  let truncated = false
  let disposed = false

  function pushBounded<T>(target: T[], value: T, limit: number): void {
    if (target.length >= limit) {
      target.shift()
      truncated = true
    }
    target.push(value)
  }

  function pushError(
    message: string,
    stack?: string,
    source?: string,
    line?: number,
    col?: number,
  ): void {
    pushBounded(errors, {
      message,
      ...(stack ? { stack: stack.slice(0, MAX_ERROR_STACK) } : {}),
      ...(source ? { source } : {}),
      ...(typeof line === "number" ? { line } : {}),
      ...(typeof col === "number" ? { col } : {}),
    }, MAX_ERRORS)
  }

  function onWindowError(event: ErrorEvent): void {
    const error = errorLike(event.error)
    pushError(
      event.message || error.message || String(event),
      error.stack,
      event.filename,
      event.lineno,
      event.colno,
    )
  }

  function onUnhandledRejection(event: PromiseRejectionEvent): void {
    const reason = errorLike(event.reason)
    pushError(reason.message || String(event.reason), reason.stack)
  }

  function onResourceError(event: Event): void {
    const target = event.target
    if (!target || typeof target !== "object") return
    const candidate = target as {
      tagName?: unknown
      src?: unknown
      href?: unknown
    }
    const tag = typeof candidate.tagName === "string"
      ? candidate.tagName.toLowerCase()
      : ""
    const url = tag === "link"
      ? candidate.href
      : tag === "script" || tag === "img"
        ? candidate.src
        : undefined
    if (typeof url === "string" && url) {
      pushBounded(resourceFailures, {
        url,
        reason: "Resource element emitted an error event.",
      }, MAX_RESOURCE_FAILURES)
    }
  }

  frameWindow.addEventListener("error", onWindowError)
  frameWindow.addEventListener("unhandledrejection", onUnhandledRejection)
  frameDocument.addEventListener("error", onResourceError, true)

  const originalConsole = {
    error: frameWindow.console.error,
    warn: frameWindow.console.warn,
    log: frameWindow.console.log,
  }
  const wrappedConsole = {
    error: (...args: unknown[]) => {
      pushBounded(consoleEntries, {
        level: "error",
        args: args.map(stringifyConsoleArg),
      }, MAX_CONSOLE)
      originalConsole.error.apply(frameWindow.console, args)
    },
    warn: (...args: unknown[]) => {
      pushBounded(consoleEntries, {
        level: "warn",
        args: args.map(stringifyConsoleArg),
      }, MAX_CONSOLE)
      originalConsole.warn.apply(frameWindow.console, args)
    },
    log: (...args: unknown[]) => {
      pushBounded(consoleEntries, {
        level: "log",
        args: args.map(stringifyConsoleArg),
      }, MAX_CONSOLE)
      originalConsole.log.apply(frameWindow.console, args)
    },
  }
  frameWindow.console.error = wrappedConsole.error
  frameWindow.console.warn = wrappedConsole.warn
  frameWindow.console.log = wrappedConsole.log

  try {
    const entries = frameWindow.performance.getEntriesByType("resource")
    for (const rawEntry of entries) {
      const entry = rawEntry as PerformanceResourceTiming
      if (
        entry.transferSize === 0
        && entry.decodedBodySize === 0
        && entry.duration > 0
      ) {
        pushBounded(resourceFailures, {
          url: entry.name,
          reason: "Resource timing has no transferred or decoded bytes.",
        }, MAX_RESOURCE_FAILURES)
      }
    }
  } catch {
    // Some frame policies do not expose resource timing.
  }

  return {
    get truncated() {
      return truncated
    },
    snapshot(bridgeHandshake) {
      return {
        errors: errors.slice(),
        console: consoleEntries.slice(),
        resourceFailures: resourceFailures.slice(),
        bridgeHandshake,
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      frameWindow.removeEventListener("error", onWindowError)
      frameWindow.removeEventListener("unhandledrejection", onUnhandledRejection)
      frameDocument.removeEventListener("error", onResourceError, true)
      if (frameWindow.console.error === wrappedConsole.error) {
        frameWindow.console.error = originalConsole.error
      }
      if (frameWindow.console.warn === wrappedConsole.warn) {
        frameWindow.console.warn = originalConsole.warn
      }
      if (frameWindow.console.log === wrappedConsole.log) {
        frameWindow.console.log = originalConsole.log
      }
    },
  }
}

function errorLike(value: unknown): { message: string; stack?: string } {
  if (!value || typeof value !== "object") {
    return { message: typeof value === "string" ? value : "" }
  }
  const candidate = value as { message?: unknown; stack?: unknown }
  return {
    message: typeof candidate.message === "string" ? candidate.message : "",
    ...(typeof candidate.stack === "string" ? { stack: candidate.stack } : {}),
  }
}

function stringifyConsoleArg(value: unknown): string {
  if (typeof value === "string") return value.slice(0, MAX_CONSOLE_ARG)
  const error = errorLike(value)
  if (error.message) return error.message.slice(0, MAX_CONSOLE_ARG)
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, MAX_CONSOLE_ARG)
  } catch {
    return String(value).slice(0, MAX_CONSOLE_ARG)
  }
}
