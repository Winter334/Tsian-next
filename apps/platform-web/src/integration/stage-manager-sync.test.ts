import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  tsian: { card: { entrypoints: vi.fn() }, workspace: {}, invokeAgent: vi.fn(), onAgentInvocation: vi.fn() },
  prepare: vi.fn(), verify: vi.fn(),
}))
vi.mock("../../../play-frontend-dev/src/composables/useTsian", () => ({ getTsianClient: () => mocks.tsian }))
vi.mock("../../../play-frontend-dev/src/lib/maintenance-context", () => ({ prepareMaintenanceContext: mocks.prepare, verifyMaintenance: mocks.verify }))
let sync: typeof import("../../../play-frontend-dev/src/composables/useSyncAfterTurn")

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.tsian.card.entrypoints.mockResolvedValue({ postTurnMaintenance: "stage-manager" })
  mocks.prepare.mockResolvedValue({ turn: 2, token: "token", alreadyApplied: false })
  mocks.verify.mockResolvedValue(undefined)
  mocks.tsian.invokeAgent.mockResolvedValue({ status: "completed" })
  sync = await import("../../../play-frontend-dev/src/composables/useSyncAfterTurn")
})
afterEach(() => { sync.resetSyncPhase(); vi.useRealTimers(); vi.restoreAllMocks() })

describe("semantic maintenance invocation orchestration", () => {
  it("prepares context, invokes without persisted chat, verifies then refreshes", async () => {
    const onSynced = vi.fn()
    sync.setOnSynced(onSynced)
    await sync.triggerSyncAfterTurn(2)
    expect(mocks.prepare).toHaveBeenCalledWith(mocks.tsian.workspace, 2)
    expect(mocks.tsian.invokeAgent).toHaveBeenCalledWith("stage-manager", expect.any(String), expect.objectContaining({ persist: false, includeRecentHistory: false, checkpoint: { mode: "current-turn-auto" } }))
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(onSynced).toHaveBeenCalledOnce()
    expect(sync.useSyncAfterTurn().syncPhase.value).toBe("synced")
  })
  it("does not accept completed events without a submitted receipt", async () => {
    let finish!: () => void
    mocks.tsian.invokeAgent.mockImplementationOnce((_agent, _input, options) => {
      mocks.tsian.onAgentInvocation.mock.calls[0]![0]({ type: "completed", invocationId: options.invocationId })
      return new Promise<void>(resolve => { finish = resolve })
    })
    mocks.verify.mockRejectedValueOnce(new Error("no receipt"))
    const promise = sync.triggerSyncAfterTurn(2)
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
    expect(sync.useSyncAfterTurn().syncPhase.value).toBe("syncing")
    finish(); await promise
    expect(sync.useSyncAfterTurn().syncPhase.value).toBe("sync-failed")
  })
  it("retries a committed-but-interrupted turn without another model call", async () => {
    mocks.tsian.invokeAgent.mockRejectedValueOnce(new Error("interrupted after commit"))
    await sync.triggerSyncAfterTurn(2)
    mocks.prepare.mockResolvedValueOnce({ turn: 2, token: "token", alreadyApplied: true })
    await sync.retrySyncAfterTurn()
    expect(mocks.tsian.invokeAgent).toHaveBeenCalledOnce()
    expect(mocks.verify).toHaveBeenCalledOnce()
    expect(sync.useSyncAfterTurn().syncPhase.value).toBe("synced")
  })
  it("fails preparation without calling the model", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("missing prose"))
    await sync.triggerSyncAfterTurn(2)
    expect(mocks.tsian.invokeAgent).not.toHaveBeenCalled()
    expect(sync.useSyncAfterTurn().syncPhase.value).toBe("sync-failed")
  })
  it("ignores stale completion after restore/reset", async () => {
    let finish!: () => void
    mocks.tsian.invokeAgent.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const pending = sync.triggerSyncAfterTurn(2)
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"))
    sync.resetSyncPhase(); finish(); await pending
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(sync.useSyncAfterTurn().syncPhase.value).toBe("idle")
  })
  it("does not prepare card business data when no maintenance entrypoint exists", async () => {
    mocks.tsian.card.entrypoints.mockResolvedValueOnce({})
    await sync.triggerSyncAfterTurn(2)
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(sync.useSyncAfterTurn().syncPhase.value).toBe("idle")
  })
  it("does not start duplicate concurrent invocations", async () => {
    await Promise.all([sync.triggerSyncAfterTurn(2), sync.triggerSyncAfterTurn(2)])
    expect(mocks.tsian.invokeAgent).toHaveBeenCalledOnce()
  })
})
