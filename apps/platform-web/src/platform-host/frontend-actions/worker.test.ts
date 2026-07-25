import { describe, expect, it } from "vitest"
import { FrontendActionDomainError, FrontendActionRuntimeError } from "./errors"
import {
  FRONTEND_ACTION_WORKER_SOURCE,
  runFrontendActionWorker,
  type FrontendActionWorkerFactory,
  type FrontendActionWorkerLike,
} from "./worker"

class FakeWorker implements FrontendActionWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: unknown[] = []
  terminated = false

  postMessage(message: unknown): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }
}

function factory(worker: FakeWorker, disposed: { value: boolean }): FrontendActionWorkerFactory {
  return () => ({
    worker,
    dispose: () => {
      disposed.value = true
    },
  })
}

function run(worker: FakeWorker, signal?: AbortSignal, timeoutMs = 100) {
  const disposed = { value: false }
  return {
    disposed,
    promise: runFrontendActionWorker({
      invocationId: "invocation-1",
      source: "return true",
      input: null,
      timeoutMs,
      signal,
      workerFactory: factory(worker, disposed),
      handleSdkRequest: async () => null,
    }),
  }
}

async function expectRuntimeCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise
    throw new Error("Expected runtime error.")
  } catch (error) {
    expect(error).toBeInstanceOf(FrontendActionRuntimeError)
    expect((error as FrontendActionRuntimeError).code).toBe(code)
  }
}

describe("Frontend Action Worker runner", () => {
  it("returns raw Worker output and cleans up", async () => {
    const worker = new FakeWorker()
    const execution = run(worker)
    worker.emit({ type: "script-result", ok: true, output: { ok: true } })
    await expect(execution.promise).resolves.toEqual({ ok: true })
    expect(worker.terminated).toBe(true)
    expect(execution.disposed.value).toBe(true)
  })

  it("preserves a valid dedicated domain envelope", async () => {
    const worker = new FakeWorker()
    const execution = run(worker)
    worker.emit({
      type: "script-result",
      ok: false,
      error: {
        kind: "domain",
        envelope: { code: "ITEM_UNAVAILABLE", message: "Item unavailable.", details: { itemId: "one" } },
      },
    })
    try {
      await execution.promise
      throw new Error("Expected domain error.")
    } catch (error) {
      expect(error).toBeInstanceOf(FrontendActionDomainError)
      expect((error as FrontendActionDomainError).publicError).toMatchObject({
        kind: "domain",
        code: "ITEM_UNAVAILABLE",
        correlationId: "invocation-1",
      })
    }
  })

  it("sanitizes ordinary and invalid domain failures", async () => {
    for (const error of [
      { kind: "runtime", message: "secret" },
      { kind: "domain", envelope: { code: "bad", message: "secret" } },
    ]) {
      const worker = new FakeWorker()
      const execution = run(worker)
      worker.emit({ type: "script-result", ok: false, error })
      await expectRuntimeCode(execution.promise, "FRONTEND_ACTION_EXECUTION_FAILED")
    }
  })

  it("maps the Worker output-invalid marker to the public output error", async () => {
    const worker = new FakeWorker()
    const execution = run(worker)
    worker.emit({ type: "script-result", ok: false, error: { kind: "output-invalid" } })
    await expectRuntimeCode(execution.promise, "FRONTEND_ACTION_OUTPUT_INVALID")
  })

  it("uses an opaque-origin Worker and tames storage and nested Worker globals", () => {
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("validateStrictJson(args, OUTPUT_LIMITS)")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("validDomainEnvelope(error.envelope)")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("validateStrictJson(output, OUTPUT_LIMITS)")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("tameAmbientProperty(self, \"importScripts\"")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("tameAmbientProperty(self, \"indexedDB\", undefined)")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("tameAmbientProperty(self, \"caches\", undefined)")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("tameAmbientProperty(self, \"Worker\", undefined)")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("tameAmbientProperty(self, \"SharedWorker\", undefined)")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("self.location.origin === \"null\"")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("ambientPropertyUnavailable(self, \"indexedDB\")")
    expect(FRONTEND_ACTION_WORKER_SOURCE).toContain("kind: \"runtime-isolation\"")
    // These native Worker capabilities intentionally remain outside the isolation promise.
    expect(FRONTEND_ACTION_WORKER_SOURCE).not.toContain('tameAmbientProperty(self, "fetch"')
    expect(FRONTEND_ACTION_WORKER_SOURCE).not.toContain('tameAmbientProperty(self, "Date"')
    expect(FRONTEND_ACTION_WORKER_SOURCE).not.toContain('tameAmbientProperty(self, "Math"')
    expect(FRONTEND_ACTION_WORKER_SOURCE).not.toContain('tameAmbientProperty(self, "setTimeout"')
    expect(FRONTEND_ACTION_WORKER_SOURCE).not.toContain('tameAmbientProperty(self, "setInterval"')
  })

  it("times out and cleans up", async () => {
    const worker = new FakeWorker()
    const execution = run(worker, undefined, 1)
    await expectRuntimeCode(execution.promise, "FRONTEND_ACTION_TIMEOUT")
    expect(worker.terminated).toBe(true)
    expect(execution.disposed.value).toBe(true)
  })

  it("aborts and cleans up", async () => {
    const controller = new AbortController()
    const worker = new FakeWorker()
    const execution = run(worker, controller.signal)
    controller.abort()
    await expectRuntimeCode(execution.promise, "FRONTEND_ACTION_ABORTED")
    expect(worker.posted).toContainEqual({ type: "abort" })
    expect(worker.terminated).toBe(true)
  })
})
