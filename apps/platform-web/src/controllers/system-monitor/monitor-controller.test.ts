import { afterEach, describe, expect, it, vi } from "vitest"
import { EMPTY_DIAGNOSTIC_HEALTH, EMPTY_DIAGNOSTIC_OVERVIEW, createMonitorController } from "./monitor-controller"

const feedback = vi.hoisted(() => ({
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock("@/composables/useConfirm", () => ({ confirm: feedback.confirm }))
vi.mock("@/composables/useToast", () => ({
  toast: { success: feedback.success, error: feedback.error },
}))

function overview(overrides: Partial<typeof EMPTY_DIAGNOSTIC_OVERVIEW> = {}) {
  return {
    ...EMPTY_DIAGNOSTIC_OVERVIEW,
    usage: { ...EMPTY_DIAGNOSTIC_OVERVIEW.usage },
    providers: [],
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function createHarness() {
  let turnReady: (() => void) | null = null
  let diagnosticsChanged: (() => void) | null = null
  const unsubscribeTurnReady = vi.fn()
  const unsubscribeDiagnostics = vi.fn()
  const bridge = {
    platform: {
      getPlatformContext: vi.fn(async () => ({ mountedGameCardId: "card-1" })),
      runAction: vi.fn(async () => ({ ok: true })),
    },
    query: {
      query: vi.fn(async () => ({ items: [{ id: "checkpoint-1", label: "Before turn" }] })),
    },
    debug: {
      getDiagnosticOverview: vi.fn(async () => overview({ totalRecords: 3, failedCount: 1 })),
      getDiagnosticStoreHealth: vi.fn(async () => ({ ...EMPTY_DIAGNOSTIC_HEALTH })),
      onTurnDebugReady: vi.fn((callback: () => void) => {
        turnReady = callback
        return unsubscribeTurnReady
      }),
      onDiagnosticRecordsChanged: vi.fn((callback: () => void) => {
        diagnosticsChanged = callback
        return unsubscribeDiagnostics
      }),
    },
  }
  return {
    bridge,
    controller: createMonitorController(bridge as never),
    emitTurnReady: () => turnReady?.(),
    emitDiagnosticsChanged: () => diagnosticsChanged?.(),
    unsubscribeTurnReady,
    unsubscribeDiagnostics,
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe("createMonitorController", () => {
  it("refreshes context, diagnostics, and recovery data together", async () => {
    const harness = createHarness()

    await harness.controller.refreshAll()

    expect(harness.controller.context.value).toEqual({ mountedGameCardId: "card-1" })
    expect(harness.controller.checkpoints.value).toEqual([{ id: "checkpoint-1", label: "Before turn" }])
    expect(harness.controller.overview.value.totalRecords).toBe(3)
    expect(harness.controller.overallStatus.value).toBe("attention")
    expect(harness.controller.loading.value).toBe(false)
    expect(harness.controller.lastRefreshAt.value).not.toBe("")
  })

  it("confirms restore, invokes the existing action, and refreshes all monitor data", async () => {
    feedback.confirm.mockResolvedValueOnce(true)
    const harness = createHarness()

    await expect(harness.controller.restoreCheckpoint("checkpoint-1")).resolves.toBe(true)

    expect(feedback.confirm).toHaveBeenCalledWith(expect.objectContaining({ severity: "danger" }))
    expect(harness.bridge.platform.runAction).toHaveBeenCalledWith({
      action: "restore-checkpoint",
      params: { checkpointId: "checkpoint-1" },
    })
    expect(harness.bridge.platform.getPlatformContext).toHaveBeenCalledOnce()
    expect(feedback.success).toHaveBeenCalledWith("已恢复检查点。")
  })

  it("subscribes once, debounces updates, refreshes recovery, and cleans up", async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    harness.controller.start()
    harness.controller.start()
    expect(harness.bridge.debug.onTurnDebugReady).toHaveBeenCalledOnce()
    expect(harness.bridge.debug.onDiagnosticRecordsChanged).toHaveBeenCalledOnce()

    harness.emitDiagnosticsChanged()
    harness.emitDiagnosticsChanged()
    await vi.advanceTimersByTimeAsync(99)
    expect(harness.bridge.debug.getDiagnosticOverview).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.bridge.debug.getDiagnosticOverview).toHaveBeenCalledOnce()

    harness.emitTurnReady()
    await Promise.resolve()
    expect(harness.bridge.query.query).toHaveBeenCalledWith({ resource: "checkpoints" })

    harness.emitDiagnosticsChanged()
    harness.controller.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(harness.bridge.debug.getDiagnosticOverview).toHaveBeenCalledOnce()
    expect(harness.unsubscribeTurnReady).toHaveBeenCalledOnce()
    expect(harness.unsubscribeDiagnostics).toHaveBeenCalledOnce()
  })

  it("does not start new bridge work after disposal", async () => {
    const harness = createHarness()
    harness.controller.dispose()

    await harness.controller.refreshAll()
    await harness.controller.refreshMetadata()
    await harness.controller.refreshRecovery()

    expect(harness.bridge.platform.getPlatformContext).not.toHaveBeenCalled()
    expect(harness.bridge.query.query).not.toHaveBeenCalled()
    expect(harness.bridge.debug.getDiagnosticOverview).not.toHaveBeenCalled()
  })

  it("does not restore after confirmation resolves for a disposed controller", async () => {
    const confirmation = deferred<boolean>()
    feedback.confirm.mockReturnValueOnce(confirmation.promise)
    const harness = createHarness()

    const restore = harness.controller.restoreCheckpoint("checkpoint-1")
    await Promise.resolve()
    harness.controller.dispose()
    confirmation.resolve(true)

    await expect(restore).resolves.toBe(false)
    expect(harness.bridge.platform.runAction).not.toHaveBeenCalled()
  })
})
