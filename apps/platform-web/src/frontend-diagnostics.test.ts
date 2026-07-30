import type { DiagnosticFrontendErrorRecord } from "@tsian/contracts"
import type { App } from "vue"
import { describe, expect, it } from "vitest"
import { createFrontendDiagnosticsCollector, installFrontendDiagnostics } from "./frontend-diagnostics"

describe("frontend diagnostics", () => {
  it("records all four unhandled error kinds and deduplicates the same error object", async () => {
    const records: DiagnosticFrontendErrorRecord[] = []
    let sequence = 0
    const collector = createFrontendDiagnosticsCollector({
      now: () => 1_000 + sequence,
      id: () => `error-${++sequence}`,
      write: async (record) => { records.push(record) },
    })
    const runtimeError = new Error("runtime failed")
    await collector.capture("runtime-error", runtimeError, { sourceUrl: "app.js", line: 10, column: 2 })
    await collector.capture("runtime-error", runtimeError)
    await collector.capture("unhandled-rejection", new Error("promise failed"))
    await collector.capture("vue-error", new Error("vue failed"), { componentName: "Panel" })
    await collector.capture("resource-error", "resource failed", { resourceUrl: "missing.js" })

    expect(records.map((record) => record.kind)).toEqual([
      "runtime-error",
      "unhandled-rejection",
      "vue-error",
      "resource-error",
    ])
    expect(records[0]).toMatchObject({ sourceUrl: "app.js", line: 10, column: 2 })
    expect(records[2].componentName).toBe("Panel")
    expect(records[3].resourceUrl).toBe("missing.js")
  })

  it("does not throw when persistence fails", async () => {
    const collector = createFrontendDiagnosticsCollector({
      write: async () => { throw new Error("storage failed") },
    })
    await expect(collector.capture("runtime-error", new Error("app failed"))).resolves.toBe(false)
  })

  it("does not drop unrelated errors while another diagnostic write is pending", async () => {
    const records: DiagnosticFrontendErrorRecord[] = []
    let releaseFirst!: () => void
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve })
    let writes = 0
    const collector = createFrontendDiagnosticsCollector({
      write: async (record) => {
        records.push(record)
        writes += 1
        if (writes === 1) await firstPending
      },
    })
    const first = collector.capture("runtime-error", new Error("first"))
    const second = collector.capture("unhandled-rejection", new Error("second"))
    releaseFirst()
    await Promise.all([first, second])
    expect(records.map((record) => record.message)).toEqual(["first", "second"])
  })

  it("skips handled runtime events and captures Vue global errors", async () => {
    const records: DiagnosticFrontendErrorRecord[] = []
    const target = new EventTarget()
    const app = { config: { errorHandler: undefined } } as unknown as App
    const cleanup = installFrontendDiagnostics(
      app,
      target as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
      { write: async (record) => { records.push(record) } },
    )
    target.addEventListener("error", (event) => event.preventDefault())
    const handled = new Event("error", { cancelable: true }) as Event & { error?: unknown }
    handled.error = new Error("handled")
    target.dispatchEvent(handled)
    await Promise.resolve()
    expect(records).toEqual([])

    app.config.errorHandler?.(new Error("vue global"), null, "render")
    await Promise.resolve()
    expect(records.map((record) => record.kind)).toEqual(["vue-error"])
    cleanup()
  })

  it("skips resource errors handled with preventDefault", async () => {
    const records: DiagnosticFrontendErrorRecord[] = []
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        listeners.set(type, listener as EventListener)
      },
      removeEventListener(type: string) {
        listeners.delete(type)
      },
    }
    const app = { config: { errorHandler: undefined } } as unknown as App
    const cleanup = installFrontendDiagnostics(
      app,
      target as unknown as Pick<Window, "addEventListener" | "removeEventListener">,
      { write: async (record) => { records.push(record) } },
    )
    listeners.get("error")?.({
      target: { src: "https://example.test/missing.js" },
      defaultPrevented: true,
    } as unknown as Event)
    await Promise.resolve()
    expect(records).toEqual([])
    cleanup()
  })
})
