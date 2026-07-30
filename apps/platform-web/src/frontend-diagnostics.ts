import type {
  App,
  ComponentPublicInstance,
} from "vue"
import type {
  DiagnosticFrontendErrorKind,
  DiagnosticFrontendErrorRecord,
} from "@tsian/contracts"
import { DIAGNOSTIC_RECORD_SCHEMA_VERSION } from "@tsian/contracts"
import { putDiagnosticRecord } from "./storage/diagnostic-records"
import { reportDiagnosticStoreFailure } from "./runtime-host/ai/trace-recorder"

interface FrontendErrorDetails {
  sourceUrl?: string
  line?: number
  column?: number
  resourceUrl?: string
  componentName?: string
}

interface FrontendDiagnosticsDependencies {
  now?: () => number
  id?: () => string
  write?: (record: DiagnosticFrontendErrorRecord) => Promise<unknown>
}

function createErrorId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID()
  return `frontend-error-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function errorFields(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, ...(error.stack ? { stack: error.stack } : {}) }
  }
  if (typeof error === "object" && error !== null) {
    const value = error as { message?: unknown; name?: unknown; stack?: unknown }
    return {
      message: typeof value.message === "string" ? value.message : String(error),
      ...(typeof value.name === "string" ? { name: value.name } : {}),
      ...(typeof value.stack === "string" ? { stack: value.stack } : {}),
    }
  }
  return { message: String(error) }
}

export function createFrontendDiagnosticsCollector(dependencies: FrontendDiagnosticsDependencies = {}) {
  const now = dependencies.now ?? Date.now
  const id = dependencies.id ?? createErrorId
  const write = dependencies.write ?? putDiagnosticRecord
  const seenObjects = new WeakSet<object>()
  const recentFingerprints = new Map<string, number>()

  return {
    async capture(
      kind: DiagnosticFrontendErrorKind,
      error: unknown,
      details: FrontendErrorDetails = {},
    ): Promise<boolean> {
      if (typeof error === "object" && error !== null) {
        if (seenObjects.has(error)) return false
        seenObjects.add(error)
      }
      const fields = errorFields(error)
      const timestamp = now()
      const fingerprint = [kind, fields.name, fields.message, fields.stack, details.sourceUrl, details.resourceUrl]
        .join("\u0000")
      const seenAt = recentFingerprints.get(fingerprint)
      if (seenAt !== undefined && timestamp - seenAt < 5_000) return false
      recentFingerprints.set(fingerprint, timestamp)
      for (const [key, value] of recentFingerprints) {
        if (timestamp - value >= 5_000) recentFingerprints.delete(key)
      }

      const errorId = id()
      const record: DiagnosticFrontendErrorRecord = {
        id: errorId,
        errorId,
        recordType: "frontend-error",
        kind,
        timestamp,
        updatedAt: timestamp,
        schemaVersion: DIAGNOSTIC_RECORD_SCHEMA_VERSION,
        sizeBytes: 0,
        ...fields,
        ...details,
      }
      try {
        await write(record)
        return true
      } catch (writeError) {
        reportDiagnosticStoreFailure(writeError, timestamp)
        return false
      }
    },
  }
}

function resourceUrlFromTarget(target: EventTarget | null): string | undefined {
  if (!target || typeof target !== "object") return undefined
  const value = target as { currentSrc?: unknown; src?: unknown; href?: unknown }
  for (const candidate of [value.currentSrc, value.src, value.href]) {
    if (typeof candidate === "string" && candidate) return candidate
  }
  return undefined
}

function vueComponentName(instance: ComponentPublicInstance | null): string | undefined {
  const type = instance?.$?.type as { name?: unknown; __name?: unknown } | undefined
  if (typeof type?.name === "string") return type.name
  if (typeof type?.__name === "string") return type.__name
  return undefined
}

export function installFrontendDiagnostics(
  app: App,
  target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
  dependencies: FrontendDiagnosticsDependencies = {},
): () => void {
  const collector = createFrontendDiagnosticsCollector(dependencies)
  const previousVueHandler = app.config.errorHandler

  const onError = (rawEvent: Event) => {
    const event = rawEvent as Event & {
      error?: unknown
      message?: string
      filename?: string
      lineno?: number
      colno?: number
    }
    const resourceUrl = resourceUrlFromTarget(event.target)
    if (resourceUrl && event.target !== target) {
      queueMicrotask(() => {
        if (!event.defaultPrevented) {
          void collector.capture("resource-error", `Failed to load resource: ${resourceUrl}`, { resourceUrl })
        }
      })
      return
    }
    queueMicrotask(() => {
      if (event.defaultPrevented) return
      void collector.capture("runtime-error", event.error ?? event.message ?? event, {
        ...(event.filename ? { sourceUrl: event.filename } : {}),
        ...(typeof event.lineno === "number" ? { line: event.lineno } : {}),
        ...(typeof event.colno === "number" ? { column: event.colno } : {}),
      })
    })
  }
  const onUnhandledRejection = (rawEvent: Event) => {
    const event = rawEvent as Event & { reason?: unknown }
    queueMicrotask(() => {
      if (!event.defaultPrevented) void collector.capture("unhandled-rejection", event.reason)
    })
  }

  target.addEventListener("error", onError as EventListener, true)
  target.addEventListener("unhandledrejection", onUnhandledRejection as EventListener)
  app.config.errorHandler = (error, instance, info) => {
    void collector.capture("vue-error", error, {
      componentName: vueComponentName(instance),
    })
    previousVueHandler?.(error, instance, info)
  }

  return () => {
    target.removeEventListener("error", onError as EventListener, true)
    target.removeEventListener("unhandledrejection", onUnhandledRejection as EventListener)
    app.config.errorHandler = previousVueHandler
  }
}
