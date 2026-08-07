// @vitest-environment happy-dom

import type { DiagnosticAiRequestRecord, DiagnosticRecordSummary, DiagnosticRecordSummaryPage } from "@tsian/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { EMPTY_DIAGNOSTIC_HEALTH, EMPTY_DIAGNOSTIC_OVERVIEW } from "./monitor-controller"
import { TRACE_PAGE_SIZE, createTraceController, diagnosticQuery } from "./trace-controller"

const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("@/composables/useToast", () => ({ toast: feedback }))

function summary(id: string): DiagnosticRecordSummary {
  return {
    id,
    recordType: "ai-request",
    timestamp: 100,
    updatedAt: 100,
    sizeBytes: 100,
    status: "failed",
    provider: "openai",
    model: "gpt-test",
    retryCount: 0,
  }
}

function record(id: string): DiagnosticAiRequestRecord {
  return {
    ...summary(id),
    schemaVersion: 1,
    recordType: "ai-request",
    requestId: id,
    operationId: `operation-${id}`,
    sequence: 1,
    status: "failed",
    provider: "openai",
    model: "gpt-test",
    endpoint: "https://example.test/v1/chat/completions",
    streaming: false,
    request: { messages: [] },
    attempts: [],
    error: { type: "network", message: "offline" },
  }
}

function page(items: DiagnosticRecordSummary[], offset = 0, hasMore = false): DiagnosticRecordSummaryPage {
  return { items, offset, limit: TRACE_PAGE_SIZE, hasMore }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function createHarness() {
  let diagnosticsChanged: ((change: { type: "upsert" | "delete" | "health"; ids: string[] }) => void) | null = null
  const unsubscribe = vi.fn()
  const bridge = {
    debug: {
      queryDiagnosticSummaries: vi.fn(async () => page([])),
      getDiagnosticRecord: vi.fn(async (id: string) => record(id)),
      getDiagnosticFacets: vi.fn(async () => ({ providers: ["openai"], models: ["gpt-test"] })),
      getDiagnosticOverview: vi.fn(async () => ({ ...EMPTY_DIAGNOSTIC_OVERVIEW, usage: { ...EMPTY_DIAGNOSTIC_OVERVIEW.usage }, providers: [] })),
      getDiagnosticStoreHealth: vi.fn(async () => ({ ...EMPTY_DIAGNOSTIC_HEALTH })),
      exportDiagnosticBundle: vi.fn(async () => ({
        blob: new Blob(["bundle"]),
        fileName: "diagnostics.zip",
        anchorId: "failure-1",
        recordCount: 2,
      })),
      onDiagnosticRecordsChanged: vi.fn((callback: typeof diagnosticsChanged) => {
        diagnosticsChanged = callback
        return unsubscribe
      }),
    },
  }
  return {
    bridge,
    controller: createTraceController(bridge as never),
    emitDiagnosticsChanged: (change: { type: "upsert" | "delete" | "health"; ids: string[] }) => diagnosticsChanged?.(change),
    unsubscribe,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("trace controller", () => {
  it("builds filtered 30-record queries", () => {
    vi.setSystemTime(new Date("2026-08-06T00:00:00Z"))
    expect(diagnosticQuery({
      offset: 30,
      timeRange: "hour",
      status: "frontend-error",
      provider: "openai",
      model: "gpt-test",
      text: "  timeout  ",
    })).toEqual({
      offset: 30,
      limit: 30,
      fromTimestamp: Date.now() - 3_600_000,
      recordType: "frontend-error",
      provider: "openai",
      model: "gpt-test",
      text: "timeout",
    })
  })

  it("pages by 30 records and selects full details by id", async () => {
    const harness = createHarness()
    harness.bridge.debug.queryDiagnosticSummaries
      .mockResolvedValueOnce(page([summary("first")], 0, true))
      .mockResolvedValueOnce(page([summary("second")], 30, false))

    await harness.controller.loadList()
    expect(harness.controller.selectedRecord.value?.id).toBe("first")
    await harness.controller.changePage(1)

    expect(harness.bridge.debug.queryDiagnosticSummaries).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 30, limit: 30 }))
    expect(harness.controller.currentPage.value).toBe(2)
    expect(harness.controller.selectedRecord.value?.id).toBe("second")
  })

  it("ignores stale list responses", async () => {
    const harness = createHarness()
    const first = deferred<DiagnosticRecordSummaryPage>()
    const second = deferred<DiagnosticRecordSummaryPage>()
    harness.bridge.debug.queryDiagnosticSummaries
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstLoad = harness.controller.loadList()
    const secondLoad = harness.controller.loadList()
    second.resolve(page([summary("new")]))
    await secondLoad
    first.resolve(page([summary("stale")]))
    await firstLoad

    expect(harness.controller.summaries.value.map((item) => item.id)).toEqual(["new"])
    expect(harness.controller.selectedRecord.value?.id).toBe("new")
  })

  it("debounces record subscriptions and tears them down", async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.controller.start()
    harness.controller.start()
    expect(harness.bridge.debug.onDiagnosticRecordsChanged).toHaveBeenCalledOnce()

    harness.emitDiagnosticsChanged({ type: "health", ids: [] })
    await vi.advanceTimersByTimeAsync(100)
    expect(harness.bridge.debug.getDiagnosticOverview).toHaveBeenCalledOnce()
    expect(harness.bridge.debug.queryDiagnosticSummaries).not.toHaveBeenCalled()

    harness.emitDiagnosticsChanged({ type: "upsert", ids: ["failure-1"] })
    harness.controller.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(harness.bridge.debug.queryDiagnosticSummaries).not.toHaveBeenCalled()
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })

  it("revokes generated download URLs after completion and on dispose", async () => {
    vi.useFakeTimers()
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second")
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    const harness = createHarness()
    harness.controller.selectedRecord.value = record("failure-1")

    await expect(harness.controller.downloadBundle("steps")).resolves.toBe(true)
    expect(createObjectUrl).toHaveBeenCalledOnce()
    expect(harness.bridge.debug.exportDiagnosticBundle).toHaveBeenCalledWith({ selectedFailureId: "failure-1", reproductionSteps: "steps" })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:first")

    await harness.controller.downloadBundle()
    harness.controller.dispose()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:second")
  })

  it("does not start new diagnostic requests after disposal", async () => {
    const harness = createHarness()
    harness.controller.dispose()

    await harness.controller.refresh()
    await harness.controller.loadList()
    await harness.controller.loadMetadata()
    await harness.controller.select("failure-1")

    expect(harness.bridge.debug.queryDiagnosticSummaries).not.toHaveBeenCalled()
    expect(harness.bridge.debug.getDiagnosticOverview).not.toHaveBeenCalled()
    expect(harness.bridge.debug.getDiagnosticRecord).not.toHaveBeenCalled()
  })

  it("does not create a download after bundle export resolves for a disposed controller", async () => {
    const bundle = deferred<{
      blob: Blob
      fileName: string
      anchorId: string
      recordCount: number
    }>()
    const createObjectUrl = vi.spyOn(URL, "createObjectURL")
    const harness = createHarness()
    harness.controller.selectedRecord.value = record("failure-1")
    harness.bridge.debug.exportDiagnosticBundle.mockReturnValueOnce(bundle.promise)

    const download = harness.controller.downloadBundle()
    await Promise.resolve()
    harness.controller.dispose()
    bundle.resolve({
      blob: new Blob(["bundle"]),
      fileName: "diagnostics.zip",
      anchorId: "failure-1",
      recordCount: 1,
    })

    await expect(download).resolves.toBe(false)
    expect(createObjectUrl).not.toHaveBeenCalled()
  })
})
