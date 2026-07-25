import { describe, expect, it, vi } from "vitest"
import type {
  FrontendActionPublicError,
  JsonValue,
  RuntimeWorkspaceMutationEvent,
} from "@tsian/contracts"
import {
  createRemoteFrontendActionLifecycle,
  normalizeFrontendActionPublicError,
  normalizeRemoteFrontendActionAbortRequest,
  normalizeRemoteFrontendActionRunRequest,
  type RemoteFrontendActionService,
  type RemoteFrontendActionServiceRequest,
  type RemoteFrontendActionServiceResult,
} from "./remote-frontend-action-lifecycle"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function runtimeCode(error: unknown): string | undefined {
  return (error as FrontendActionPublicError | undefined)?.code
}

function mutation(
  invocationId = "invocation-1",
  actionId = "equip-item",
): RuntimeWorkspaceMutationEvent {
  return {
    invocationId,
    saveId: "save-1",
    source: "frontend-action",
    actionId,
    writtenPaths: ["save/z.json", "save/a.json"],
    deletedPaths: ["save/old.json"],
  }
}

function createHarness(
  service: RemoteFrontendActionService,
  options: {
    isCurrentBinding?: (saveId: string, gameCardId: string) => boolean | Promise<boolean>
    onWorkspaceMutation?: (event: RuntimeWorkspaceMutationEvent) => void
  } = {},
) {
  let current = true
  const events: RuntimeWorkspaceMutationEvent[] = []
  const lifecycle = createRemoteFrontendActionLifecycle({
    expectedGameCardId: "card-1",
    service,
    isCurrent: () => current,
    isCurrentBinding: options.isCurrentBinding ?? (() => true),
    onWorkspaceMutation: options.onWorkspaceMutation ?? ((event) => events.push(event)),
  })
  return {
    lifecycle,
    events,
    replaceSession() {
      current = false
      lifecycle.dispose()
    },
  }
}

describe("remote Frontend Action request normalization", () => {
  it("accepts exact invocation/action ids and strict JSON input", () => {
    const request = normalizeRemoteFrontendActionRunRequest({
      invocationId: "f4b5ea4c-3ab5-4a40-a85f-414d86f6b2a6",
      actionId: "equip-item",
      input: Object.assign(Object.create(null), { itemId: "sword-1" }),
    })

    expect(request).toEqual({
      invocationId: "f4b5ea4c-3ab5-4a40-a85f-414d86f6b2a6",
      actionId: "equip-item",
      input: { itemId: "sword-1" },
    })
  })

  it.each([
    { invocationId: " invoke-1", actionId: "equip-item", input: null },
    { invocationId: "invoke/1", actionId: "equip-item", input: null },
    { invocationId: "a".repeat(129), actionId: "equip-item", input: null },
    { invocationId: "invoke-1", actionId: "EquipItem", input: null },
    { invocationId: "invoke-1", actionId: "equip-item", input: new Date() },
    { invocationId: "invoke-1", actionId: "equip-item", input: undefined },
    Object.defineProperty(
      { invocationId: "invoke-1", actionId: "equip-item" },
      "input",
      { enumerable: true, get: () => null },
    ),
    { invocationId: "invoke-1", actionId: "equip-item", input: null, extra: true },
  ])("rejects invalid run request %#", (request) => {
    expect(() => normalizeRemoteFrontendActionRunRequest(request))
      .toThrow(expect.objectContaining({ code: "FRONTEND_ACTION_INPUT_INVALID" }))
  })

  it("strictly normalizes abort requests", () => {
    expect(normalizeRemoteFrontendActionAbortRequest({ invocationId: "invoke-1" }))
      .toBe("invoke-1")
    expect(() => normalizeRemoteFrontendActionAbortRequest({
      invocationId: "invoke-1",
      extra: true,
    })).toThrow(expect.objectContaining({ code: "FRONTEND_ACTION_INPUT_INVALID" }))
    expect(() => normalizeRemoteFrontendActionAbortRequest(Object.defineProperty({}, "invocationId", {
      enumerable: true,
      get: () => "invoke-1",
    }))).toThrow(expect.objectContaining({ code: "FRONTEND_ACTION_INPUT_INVALID" }))
  })

  it("preserves valid public errors and sanitizes ordinary failures", () => {
    const domain: FrontendActionPublicError = {
      kind: "domain",
      code: "ITEM_LOCKED",
      message: "The item is locked.",
      details: { itemId: "sword-1" },
    }
    expect(normalizeFrontendActionPublicError(domain)).toBe(domain)
    expect(normalizeFrontendActionPublicError(new Error("secret path C:/private"))).toEqual({
      kind: "runtime",
      code: "FRONTEND_ACTION_EXECUTION_FAILED",
      message: "Frontend Action execution failed.",
    })
  })
})

describe("remote Frontend Action lifecycle", () => {
  it("passes exact card/signal/barrier and verifies binding before mutation and resolution", async () => {
    const order: string[] = []
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        expect(request.expectedGameCardId).toBe("card-1")
        expect(request.signal).toBeInstanceOf(AbortSignal)
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        order.push("committed")
        return { output: { ok: true }, mutation: mutation() }
      },
    }
    const harness = createHarness(service, {
      isCurrentBinding(saveId, gameCardId) {
        expect(saveId).toBe("save-1")
        expect(gameCardId).toBe("card-1")
        order.push("binding-checked")
        return true
      },
      onWorkspaceMutation(event) {
        order.push("mutation")
        harness.events.push(event)
      },
    })
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: { itemId: "sword-1" },
    }).then((value) => {
      order.push("response")
      return value
    })

    expect(await result).toEqual({ ok: true })
    expect(order).toEqual(["committed", "binding-checked", "mutation", "response"])
    expect(harness.events).toEqual([{
      ...mutation(),
      writtenPaths: ["save/a.json", "save/z.json"],
    }])
    expect(harness.lifecycle.phase("invocation-1")).toBe("completed")
  })

  it("aborts before commit and prevents the barrier", async () => {
    const running = deferred<void>()
    const continueRun = deferred<void>()
    let commitCalled = false
    let observedSignal: AbortSignal | undefined
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        observedSignal = request.signal
        running.resolve()
        await continueRun.promise
        commitCalled = true
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        return { output: null }
      },
    }
    const harness = createHarness(service)
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await running.promise

    harness.lifecycle.abortAction("invocation-1")
    expect(observedSignal?.aborted).toBe(true)
    continueRun.resolve()

    await expect(result).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_ABORTED",
    })
    expect(commitCalled).toBe(true)
    expect(harness.events).toEqual([])
    expect(harness.lifecycle.phase("invocation-1")).toBe("aborted")
  })

  it("invalidates commit when the mount is disposed after preparation but before the transaction", async () => {
    const commitPrepared = deferred<void>()
    const enterTransaction = deferred<void>()
    let signal: AbortSignal | undefined
    let writeCount = 0
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        signal = request.signal
        await request.beforeCommit({ saveId: "save-1" })
        commitPrepared.resolve()
        await enterTransaction.promise
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        writeCount += 1
        return { output: "stale", mutation: mutation() }
      },
    }
    const harness = createHarness(service)
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await commitPrepared.promise

    harness.replaceSession()
    expect(signal?.aborted).toBe(true)
    enterTransaction.resolve()

    await expect(result).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_SESSION_REPLACED",
    })
    expect(writeCount).toBe(0)
    expect(harness.events).toEqual([])
  })

  it("invalidates commit when the mount is disposed between storage assertions", async () => {
    const firstAssertionPassed = deferred<void>()
    const resumeValidation = deferred<void>()
    let signal: AbortSignal | undefined
    let writeCount = 0
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        signal = request.signal
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        firstAssertionPassed.resolve()
        await resumeValidation.promise
        request.assertCommitAllowed()
        writeCount += 1
        return { output: "stale", mutation: mutation() }
      },
    }
    const harness = createHarness(service)
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await firstAssertionPassed.promise

    harness.replaceSession()
    expect(signal?.aborted).toBe(true)
    resumeValidation.resolve()

    await expect(result).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_SESSION_REPLACED",
    })
    expect(writeCount).toBe(0)
    expect(harness.events).toEqual([])
  })

  it("lets durable commit win over an abort after the second storage assertion", async () => {
    const committing = deferred<void>()
    const durableCommit = deferred<void>()
    let signal: AbortSignal | undefined
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        signal = request.signal
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        committing.resolve()
        await durableCommit.promise
        return { output: "done", mutation: mutation() }
      },
    }
    const harness = createHarness(service)
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await committing.promise

    harness.lifecycle.abortAction("invocation-1")
    expect(signal?.aborted).toBe(false)
    durableCommit.resolve()

    await expect(result).resolves.toBe("done")
    expect(harness.events).toHaveLength(1)
  })

  it("suppresses delivery when the active save changes after durable commit", async () => {
    const committed = deferred<void>()
    const verifyBinding = deferred<boolean>()
    let durableWriteCount = 0
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        durableWriteCount += 1
        committed.resolve()
        return { output: "done", mutation: mutation() }
      },
    }
    const harness = createHarness(service, {
      isCurrentBinding: () => verifyBinding.promise,
    })
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await committed.promise

    // The authoritative query observes another active save while this mount stays alive.
    verifyBinding.resolve(false)

    await expect(result).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_SESSION_REPLACED",
    })
    expect(durableWriteCount).toBe(1)
    expect(harness.events).toEqual([])
    expect(harness.lifecycle.phase("invocation-1")).toBe("session-replaced")
  })

  it("suppresses delivery when the committed save moves to another card after commit", async () => {
    let saveGameCardId = "card-1"
    let durableWriteCount = 0
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        durableWriteCount += 1
        saveGameCardId = "card-2"
        return { output: "done", mutation: mutation() }
      },
    }
    const harness = createHarness(service, {
      isCurrentBinding: (saveId, gameCardId) => (
        saveId === "save-1" && saveGameCardId === gameCardId
      ),
    })
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })

    await expect(result).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_SESSION_REPLACED",
    })
    expect(durableWriteCount).toBe(1)
    expect(harness.events).toEqual([])
  })

  it("rejects a duplicate active id while keeping the original invocation alive", async () => {
    const running = deferred<void>()
    const release = deferred<void>()
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        running.resolve()
        await release.promise
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        return { output: 1 }
      },
    }
    const harness = createHarness(service)
    const first = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await running.promise

    await expect(harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_EXECUTION_FAILED",
    })
    expect(harness.lifecycle.activeInvocationCount).toBe(1)

    release.resolve()
    await expect(first).resolves.toBe(1)
  })

  it("treats unknown and completed aborts as idempotent success", async () => {
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        return { output: true }
      },
    }
    const harness = createHarness(service)
    expect(() => harness.lifecycle.abortAction("unknown-id")).not.toThrow()
    await harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    expect(() => harness.lifecycle.abortAction("invocation-1")).not.toThrow()
    expect(harness.lifecycle.phase("invocation-1")).toBe("completed")
  })

  it("disposes running invocations and suppresses stale events/results", async () => {
    const running = deferred<void>()
    const release = deferred<RemoteFrontendActionServiceResult>()
    let signal: AbortSignal | undefined
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        signal = request.signal
        running.resolve()
        return release.promise
      },
    }
    const harness = createHarness(service)
    const result = harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await running.promise
    harness.replaceSession()
    expect(signal?.aborted).toBe(true)

    release.resolve({ output: "stale", mutation: mutation() })
    await expect(result).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_SESSION_REPLACED",
    })
    expect(harness.events).toEqual([])
  })

  it("passes the host-bound card id and rejects mismatched durable mutation correlation", async () => {
    const runAction = vi.fn(async (
      request: RemoteFrontendActionServiceRequest,
    ): Promise<RemoteFrontendActionServiceResult> => {
      expect(request.expectedGameCardId).toBe("card-1")
      await request.beforeCommit({ saveId: "save-1" })
      request.assertCommitAllowed()
      request.assertCommitAllowed()
      return {
        output: null,
        mutation: mutation("another-invocation", "equip-item"),
      }
    })
    const harness = createHarness({ runAction })

    await expect(harness.lifecycle.runAction({
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })).rejects.toSatisfy((error: unknown) => (
      runtimeCode(error) === "FRONTEND_ACTION_EXECUTION_FAILED"
    ))
    expect(runAction).toHaveBeenCalledOnce()
    expect(harness.events).toEqual([])
  })
})
