import type { DiagnosticAiRequestRecord } from "@tsian/contracts"
import { beforeEach, describe, expect, it } from "vitest"
import {
  AiResponseParseError,
  AiStreamResponseError,
  readJsonPayload,
  withAiRequestRetry,
} from "./fetch"
import {
  createAiTraceOperationContext,
  forkAiTraceOperationContext,
} from "./trace-context"
import {
  beginAiRequestTrace,
  diagnosticErrorFromUnknown,
  getDiagnosticStoreHealth,
  resetDiagnosticStoreHealthForTest,
} from "./trace-recorder"

function traceInput(context = createAiTraceOperationContext("operation-test")) {
  return {
    context,
    provider: "openai-compatible",
    model: "model",
    endpoint: "https://example.test/chat/completions",
    streaming: false,
    parameters: { temperature: 0.5 },
    messages: [{ role: "user", content: "hello" }],
    tools: [{ name: "read" }],
    headers: { Authorization: "Bearer secret" },
    body: { model: "model" },
  }
}

beforeEach(() => resetDiagnosticStoreHealthForTest())

describe("AI trace recorder", () => {
  it("records each retry attempt and preserves previous/parent correlation", async () => {
    const writes: DiagnosticAiRequestRecord[] = []
    let time = 100
    const root = createAiTraceOperationContext("operation-test")
    const first = await beginAiRequestTrace(traceInput(root), {
      requestId: "request-1",
      now: () => ++time,
      write: async (record) => { writes.push(structuredClone(record)) },
    })
    let calls = 0
    const result = await withAiRequestRetry({
      requestId: first.requestId,
      operation: "test",
      onAttempt: first.onAttempt,
      retryDelayMs: () => 0,
      attempt: async () => {
        calls += 1
        if (calls === 1) throw new TypeError("Failed to fetch")
        return "ok"
      },
    })
    await first.succeed({ text: result, finishReason: "stop" })

    const second = await beginAiRequestTrace(traceInput(root), {
      requestId: "request-2",
      now: () => ++time,
      write: async (record) => { writes.push(structuredClone(record)) },
    })
    await second.succeed({ text: "second" })

    const delegated = await beginAiRequestTrace(traceInput(forkAiTraceOperationContext(root)), {
      requestId: "request-3",
      now: () => ++time,
      write: async (record) => { writes.push(structuredClone(record)) },
    })
    await delegated.succeed({ text: "delegated" })

    const finalFirst = [...writes].reverse().find((record) => record.id === "request-1")!
    const finalSecond = [...writes].reverse().find((record) => record.id === "request-2")!
    const finalDelegated = [...writes].reverse().find((record) => record.id === "request-3")!
    expect(finalFirst.attempts.map((attempt) => attempt.status)).toEqual(["failed", "succeeded"])
    expect(finalFirst.attempts[0]).toMatchObject({ retryable: true, willRetry: true, retryDelayMs: 0 })
    expect(finalSecond.previousRequestId).toBe("request-1")
    expect(finalDelegated.parentRequestId).toBe("request-2")
    expect([finalFirst.sequence, finalSecond.sequence, finalDelegated.sequence]).toEqual([1, 2, 3])
  })

  it("isolates storage failures from the AI result and exposes session health", async () => {
    const trace = await beginAiRequestTrace(traceInput(), {
      requestId: "lost-request",
      write: async () => { throw new Error("IndexedDB unavailable") },
    })
    await expect(trace.succeed({ text: "model result remains successful" })).resolves.toBeUndefined()
    expect(getDiagnosticStoreHealth()).toMatchObject({
      lostRecordCount: 2,
      lastError: "IndexedDB unavailable",
    })
  })

  it("classifies HTTP, timeout, cancellation, and parsing failures", () => {
    const http = Object.assign(new Error("rate limited"), { status: 429, payload: { code: "rate_limit" } })
    const timeout = Object.assign(new Error("request timed out"), { name: "AiRequestTimeoutError" })
    const aborted = Object.assign(new Error("cancelled"), { name: "AbortError" })
    expect(diagnosticErrorFromUnknown(http)).toMatchObject({ type: "http", status: 429 })
    expect(diagnosticErrorFromUnknown(timeout).type).toBe("timeout")
    expect(diagnosticErrorFromUnknown(aborted).type).toBe("abort")
    expect(diagnosticErrorFromUnknown(new SyntaxError("Unexpected JSON")).type).toBe("parse")
    expect(diagnosticErrorFromUnknown(new AiStreamResponseError("provider stream failed")).type).toBe("stream")
  })

  it("classifies aborted string reasons and preserves a partial streamed response", async () => {
    const writes: DiagnosticAiRequestRecord[] = []
    const trace = await beginAiRequestTrace(traceInput(), {
      requestId: "partial-request",
      write: async (record) => { writes.push(structuredClone(record)) },
    })
    const controller = new AbortController()
    controller.abort("user-cancelled")
    await trace.fail(controller.signal.reason, {
      signal: controller.signal,
      response: { text: "partial response" },
    })
    const final = writes[writes.length - 1]!
    expect(final.status).toBe("aborted")
    expect(final.error?.type).toBe("abort")
    expect(final.response?.text).toBe("partial response")

    const timed = new AbortController()
    timed.abort("task-timeout")
    expect(diagnosticErrorFromUnknown(timed.signal.reason, { aborted: true }).type).toBe("timeout")
  })

  it("surfaces invalid successful JSON as a parse error while allowing invalid HTTP error bodies", async () => {
    await expect(readJsonPayload(new Response("not-json", { status: 200 })))
      .rejects.toBeInstanceOf(AiResponseParseError)
    await expect(readJsonPayload(new Response("not-json", { status: 500 }), undefined, true))
      .resolves.toBeNull()
  })

  it("generates unique request ids for concurrent callers", async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, async () => {
      const trace = await beginAiRequestTrace(traceInput(), { write: async () => undefined })
      await trace.succeed({ text: "ok" })
      return trace.requestId
    }))
    expect(new Set(ids).size).toBe(ids.length)
  })
})
