// @vitest-environment happy-dom

import type {
  FrontendActionPublicError,
  JsonValue,
  RemotePlayBridgeEventName,
  RuntimeWorkspaceMutationEvent,
} from "@tsian/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createBridge } from "../src/bridge"
import { FrontendActionError } from "../src/frontend-action-error"
import {
  FRONTEND_ACTION_JSON_MAX_BYTES,
  FRONTEND_ACTION_JSON_MAX_DEPTH,
  FRONTEND_ACTION_JSON_MAX_NODES,
} from "../src/strict-json"
import { createTsian } from "../src/tsian-api"

const CHANNEL = "tsian.play-bridge.v1"
const TRUSTED_ORIGIN = "https://platform.example"

interface ProtocolMessage {
  channel: string
  kind: string
  sessionId?: string
  id?: string
  method?: string
  params?: Record<string, unknown>
  ok?: boolean
  result?: unknown
  error?: FrontendActionPublicError | Record<string, unknown>
  event?: RemotePlayBridgeEventName
  payload?: unknown
}

interface PostedMessage {
  message: ProtocolMessage
  targetOrigin: string | WindowPostMessageOptions | undefined
}

interface MessageHarness<T> {
  subject: T
  emit(message: ProtocolMessage, options?: { origin?: string; source?: MessageEventSource | null }): void
  ready(sessionId?: string, options?: { origin?: string; source?: MessageEventSource | null }): void
  requests(method?: string): PostedMessage[]
  respond(
    request: PostedMessage,
    response: { ok: true; result?: unknown } | { ok: false; error: ProtocolMessage["error"] },
    options?: { origin?: string; sessionId?: string },
  ): void
}

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
})

function createMessageHarness<T>(factory: () => T): MessageHarness<T> {
  const addEventListenerSpy = vi.spyOn(window, "addEventListener")
  const postMessageSpy = vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})

  let subject: T
  try {
    subject = factory()
  } catch (error) {
    addEventListenerSpy.mockRestore()
    postMessageSpy.mockRestore()
    throw error
  }

  const listener = addEventListenerSpy.mock.calls.find(([type]) => type === "message")?.[1]
  addEventListenerSpy.mockRestore()
  if (!listener) {
    postMessageSpy.mockRestore()
    throw new Error("Expected createBridge() to register a message listener.")
  }

  const emit = (
    message: ProtocolMessage,
    options: { origin?: string; source?: MessageEventSource | null } = {},
  ) => {
    const event = new MessageEvent("message", {
      data: message,
      origin: options.origin ?? TRUSTED_ORIGIN,
      source: options.source === undefined ? window.parent : options.source,
    })
    if (typeof listener === "function") listener.call(window, event)
    else listener.handleEvent(event)
  }

  const requests = (method?: string): PostedMessage[] => postMessageSpy.mock.calls
    .map(([message, targetOrigin]) => ({
      message: message as ProtocolMessage,
      targetOrigin,
    }))
    .filter(({ message }) => (
      message.kind === "request"
      && (method === undefined || message.method === method)
    ))

  cleanups.push(() => {
    window.removeEventListener("message", listener)
    postMessageSpy.mockRestore()
  })

  return {
    subject,
    emit,
    ready(sessionId = "session-1", options = {}) {
      emit({
        channel: CHANNEL,
        kind: "ready",
        sessionId,
      }, options)
    },
    requests,
    respond(request, response, options = {}) {
      emit({
        channel: CHANNEL,
        kind: "response",
        sessionId: options.sessionId ?? request.message.sessionId,
        id: request.message.id,
        ...response,
      }, { origin: options.origin })
    },
  }
}

function lastRequest<T>(harness: MessageHarness<T>, method: string): PostedMessage {
  const requests = harness.requests(method)
  const request = requests.at(-1)
  if (!request) throw new Error(`Expected an outbound ${method} request.`)
  return request
}

async function rejectedActionError(promise: Promise<unknown>): Promise<FrontendActionError> {
  try {
    await promise
    throw new Error("Expected Frontend Action call to reject.")
  } catch (error) {
    expect(error).toBeInstanceOf(FrontendActionError)
    return error as FrontendActionError
  }
}

function nestedJson(depth: number): JsonValue {
  let value: JsonValue = null
  for (let index = 0; index < depth; index += 1) value = [value]
  return value
}

function respondWithActionError<T>(
  harness: MessageHarness<T>,
  error: ProtocolMessage["error"],
): void {
  harness.respond(lastRequest(harness, "card.runAction"), { ok: false, error })
}

function actionErrorCall<T extends { card: { runAction(actionId: string, input: JsonValue): Promise<JsonValue> } }>(
  harness: MessageHarness<T>,
  error: ProtocolMessage["error"],
): Promise<JsonValue> {
  const call = harness.subject.card.runAction("use-item", {})
  respondWithActionError(harness, error)
  return call
}

describe("play-bridge Frontend Action SDK", () => {
  it("rejects non-strict JSON input before posting a run request", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()

    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        throw new Error("must not run")
      },
    })
    const sparse = new Array(2)
    sparse[1] = "value"

    for (const input of [undefined, Number.NaN, 1n, new Date(), sparse, accessor, cycle]) {
      const error = await rejectedActionError(
        harness.subject.card.runAction("use-item", input as never),
      )
      expect(error).toMatchObject({
        kind: "runtime",
        code: "FRONTEND_ACTION_INPUT_INVALID",
      })
    }

    expect(harness.requests("card.runAction")).toHaveLength(0)
  })

  it("enforces exact input byte, depth, and node transport boundaries", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()

    const exactBytes = "a".repeat(FRONTEND_ACTION_JSON_MAX_BYTES - 2)
    const exactCall = harness.subject.card.runAction("use-item", exactBytes)
    const exactRequest = lastRequest(harness, "card.runAction")
    harness.respond(exactRequest, { ok: true, result: null })
    await expect(exactCall).resolves.toBeNull()

    for (const input of [
      "a".repeat(FRONTEND_ACTION_JSON_MAX_BYTES - 1),
      nestedJson(FRONTEND_ACTION_JSON_MAX_DEPTH + 1),
      new Array(FRONTEND_ACTION_JSON_MAX_NODES).fill(null),
    ]) {
      const countBefore = harness.requests("card.runAction").length
      const error = await rejectedActionError(
        harness.subject.card.runAction("use-item", input),
      )
      expect(error.code).toBe("FRONTEND_ACTION_INPUT_INVALID")
      expect(harness.requests("card.runAction")).toHaveLength(countBefore)
    }

    const exactDepthCall = harness.subject.card.runAction(
      "use-item",
      nestedJson(FRONTEND_ACTION_JSON_MAX_DEPTH),
    )
    harness.respond(lastRequest(harness, "card.runAction"), { ok: true, result: null })
    await expect(exactDepthCall).resolves.toBeNull()

    const exactNodes = new Array(FRONTEND_ACTION_JSON_MAX_NODES - 1).fill(null)
    const exactNodesCall = harness.subject.card.runAction("use-item", exactNodes)
    harness.respond(lastRequest(harness, "card.runAction"), { ok: true, result: null })
    await expect(exactNodesCall).resolves.toBeNull()
  })

  it("counts compact JSON UTF-8 and escaping bytes at the input boundary", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()

    const escapedAtLimit = "\\".repeat((FRONTEND_ACTION_JSON_MAX_BYTES - 2) / 2)
    const escapedCall = harness.subject.card.runAction("use-item", escapedAtLimit)
    harness.respond(lastRequest(harness, "card.runAction"), { ok: true, result: null })
    await expect(escapedCall).resolves.toBeNull()

    await expect(harness.subject.card.runAction(
      "use-item",
      `${escapedAtLimit}\\`,
    )).rejects.toMatchObject({ code: "FRONTEND_ACTION_INPUT_INVALID" })

    const utf8AtLimit = "界".repeat((FRONTEND_ACTION_JSON_MAX_BYTES - 4) / 3) + "aa"
    const utf8Call = harness.subject.card.runAction("use-item", utf8AtLimit)
    harness.respond(lastRequest(harness, "card.runAction"), { ok: true, result: null })
    await expect(utf8Call).resolves.toBeNull()

    await expect(harness.subject.card.runAction(
      "use-item",
      `${utf8AtLimit}界`,
    )).rejects.toMatchObject({ code: "FRONTEND_ACTION_INPUT_INVALID" })
  })

  it("enforces output byte, depth, and node transport limits", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()

    const acceptedOutput = "a".repeat(FRONTEND_ACTION_JSON_MAX_BYTES - 2)
    const acceptedCall = harness.subject.card.runAction("use-item", null)
    harness.respond(lastRequest(harness, "card.runAction"), {
      ok: true,
      result: acceptedOutput,
    })
    await expect(acceptedCall).resolves.toBe(acceptedOutput)

    for (const result of [
      "a".repeat(FRONTEND_ACTION_JSON_MAX_BYTES - 1),
      nestedJson(FRONTEND_ACTION_JSON_MAX_DEPTH + 1),
      new Array(FRONTEND_ACTION_JSON_MAX_NODES).fill(null),
    ]) {
      const call = harness.subject.card.runAction("use-item", null)
      harness.respond(lastRequest(harness, "card.runAction"), { ok: true, result })
      await expect(rejectedActionError(call)).resolves.toMatchObject({
        code: "FRONTEND_ACTION_OUTPUT_INVALID",
      })
    }
  })

  it("returns strict JSON output and rejects malformed host output", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()

    const success = harness.subject.card.runAction("use-item", { itemId: "item-1" })
    const successRequest = lastRequest(harness, "card.runAction")
    expect(successRequest.message.params).toMatchObject({
      actionId: "use-item",
      input: { itemId: "item-1" },
    })
    expect(successRequest.message.params?.invocationId).toEqual(expect.any(String))
    harness.respond(successRequest, { ok: true, result: { consumed: true } })
    await expect(success).resolves.toEqual({ consumed: true })

    const malformed = harness.subject.card.runAction("use-item", null)
    harness.respond(lastRequest(harness, "card.runAction"), {
      ok: true,
      result: Number.POSITIVE_INFINITY,
    })
    const error = await rejectedActionError(malformed)
    expect(error).toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_OUTPUT_INVALID",
    })
  })

  it("preserves valid domain/runtime errors and sanitizes invalid transport errors", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()

    const domainCall = harness.subject.card.runAction("use-item", {})
    harness.respond(lastRequest(harness, "card.runAction"), {
      ok: false,
      error: {
        kind: "domain",
        code: "ITEM_UNAVAILABLE",
        message: "Item is unavailable.",
        details: { itemId: "item-1" },
        correlationId: "invocation-1",
      },
    })
    const domainError = await rejectedActionError(domainCall)
    expect(domainError).toMatchObject({
      kind: "domain",
      code: "ITEM_UNAVAILABLE",
      message: "Item is unavailable.",
      details: { itemId: "item-1" },
      correlationId: "invocation-1",
    })

    const runtimeCall = harness.subject.card.runAction("use-item", {})
    harness.respond(lastRequest(harness, "card.runAction"), {
      ok: false,
      error: {
        kind: "runtime",
        code: "FRONTEND_ACTION_TIMEOUT",
        message: "Frontend Action timed out.",
      },
    })
    const runtimeError = await rejectedActionError(runtimeCall)
    expect(runtimeError).toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_TIMEOUT",
      message: "Frontend Action timed out.",
    })

    const invalidCall = harness.subject.card.runAction("use-item", {})
    harness.respond(lastRequest(harness, "card.runAction"), {
      ok: false,
      error: {
        code: "REMOTE_INTERNAL_ERROR",
        message: "secret worker source and stack",
      },
    })
    const invalidError = await rejectedActionError(invalidCall)
    expect(invalidError).toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_EXECUTION_FAILED",
      message: "The Frontend Action could not be completed.",
    })
    expect(invalidError.message).not.toContain("secret")
  })

  it("enforces public error code, message, correlation, details, and field bounds", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()

    for (const valid of [
      {
        kind: "domain",
        code: "A",
        message: "m".repeat(500),
        details: "d".repeat(64 * 1024 - 2),
        correlationId: `a${"b".repeat(126)}c`,
      },
      {
        kind: "runtime",
        code: "FRONTEND_ACTION_OUTPUT_INVALID",
        message: "m".repeat(500),
        details: nestedJson(60),
        correlationId: "a",
      },
    ] satisfies Array<Record<string, unknown>>) {
      const error = await rejectedActionError(actionErrorCall(harness, valid))
      expect(error).toMatchObject(valid)
    }

    const accessor = Object.defineProperty({
      kind: "domain",
      code: "BUSINESS_FAILURE",
      message: "failed",
    }, "details", {
      enumerable: true,
      get: () => {
        throw new Error("must not run")
      },
    })
    const nonEnumerable = Object.defineProperty({
      kind: "domain",
      code: "BUSINESS_FAILURE",
      message: "failed",
    }, "secret", {
      enumerable: false,
      value: "hidden",
    })
    const symbolField = {
      kind: "domain",
      code: "BUSINESS_FAILURE",
      message: "failed",
      [Symbol("secret")]: "hidden",
    }

    for (const invalid of [
      { kind: "runtime", code: "FRONTEND_ACTION_UNKNOWN", message: "failed" },
      { kind: "domain", code: "lowercase", message: "failed" },
      { kind: "domain", code: "BUSINESS_FAILURE", message: "" },
      { kind: "domain", code: "BUSINESS_FAILURE", message: "m".repeat(501) },
      { kind: "domain", code: "BUSINESS_FAILURE", message: "failed", correlationId: " a" },
      { kind: "domain", code: "BUSINESS_FAILURE", message: "failed", correlationId: "a".repeat(129) },
      {
        kind: "domain",
        code: "BUSINESS_FAILURE",
        message: "failed",
        details: "d".repeat(64 * 1024 - 1),
      },
      {
        kind: "domain",
        code: "BUSINESS_FAILURE",
        message: "failed",
        details: nestedJson(17),
      },
      {
        kind: "runtime",
        code: "FRONTEND_ACTION_TIMEOUT",
        message: "failed",
        details: new Array(FRONTEND_ACTION_JSON_MAX_NODES).fill(null),
      },
      { kind: "domain", code: "BUSINESS_FAILURE", message: "failed", source: "run.js" },
      accessor,
      nonEnumerable,
      symbolField,
      Object.assign(Object.create({ inherited: true }), {
        kind: "domain",
        code: "BUSINESS_FAILURE",
        message: "failed",
      }),
    ]) {
      const error = await rejectedActionError(
        actionErrorCall(harness, invalid as Record<string, unknown>),
      )
      expect(error).toMatchObject({
        kind: "runtime",
        code: "FRONTEND_ACTION_EXECUTION_FAILED",
        message: "The Frontend Action could not be completed.",
      })
    }
  })

  it("sends no RPC for a pre-aborted signal", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()
    const controller = new AbortController()
    controller.abort()

    const error = await rejectedActionError(
      harness.subject.card.runAction("use-item", {}, { signal: controller.signal }),
    )
    expect(error).toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_ABORTED",
    })
    expect(harness.requests("card.runAction")).toHaveLength(0)
    expect(harness.requests("card.abortAction")).toHaveLength(0)
  })

  it("sends an abort RPC for the active invocation and keeps the host response authoritative", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()
    const controller = new AbortController()

    const call = harness.subject.card.runAction("use-item", {}, { signal: controller.signal })
    const runRequest = lastRequest(harness, "card.runAction")
    controller.abort()

    const abortRequest = lastRequest(harness, "card.abortAction")
    expect(abortRequest.message.params).toEqual({
      invocationId: runRequest.message.params?.invocationId,
    })
    harness.respond(abortRequest, { ok: true })
    harness.respond(runRequest, {
      ok: false,
      error: {
        kind: "runtime",
        code: "FRONTEND_ACTION_ABORTED",
        message: "The Frontend Action was aborted.",
      },
    })

    const error = await rejectedActionError(call)
    expect(error).toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_ABORTED",
    })
    expect(harness.requests("card.abortAction")).toHaveLength(1)
  })

  it("rejects an old card request on session replacement", async () => {
    const harness = createMessageHarness(createTsian)
    harness.ready("session-old")

    const call = harness.subject.card.runAction("use-item", {})
    const oldRequest = lastRequest(harness, "card.runAction")
    harness.ready("session-new")

    const error = await rejectedActionError(call)
    expect(error).toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_SESSION_REPLACED",
    })

    harness.respond(oldRequest, { ok: true, result: { stale: true } }, {
      sessionId: "session-old",
    })
    expect(harness.subject.sessionId).toBe("session-new")
  })

  it("ignores malformed workspace mutations without affecting later valid delivery", () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()
    const received: RuntimeWorkspaceMutationEvent[] = []
    harness.subject.onWorkspaceMutation((event) => received.push(event))

    const valid: RuntimeWorkspaceMutationEvent = {
      invocationId: "invocation-1",
      saveId: "save-1",
      source: "frontend-action",
      actionId: "use-item",
      writtenPaths: ["save/a.json", "save/b.json"],
      deletedPaths: ["save/c.json"],
    }
    const sparsePaths = new Array(2)
    sparsePaths[1] = "save/a.json"
    const accessorPaths = Object.defineProperty([], "0", {
      enumerable: true,
      get: () => {
        throw new Error("must not run")
      },
    })
    Object.defineProperty(accessorPaths, "length", { value: 1 })
    const cyclic: Record<string, unknown> = { ...valid }
    cyclic.extra = cyclic

    const malformed: unknown[] = [
      null,
      { ...valid, source: "workspace" },
      { ...valid, invocationId: " invocation-1" },
      { ...valid, invocationId: "a".repeat(129) },
      { ...valid, saveId: " save-1" },
      { ...valid, actionId: "Use-Item" },
      { ...valid, writtenPaths: ["save/a.json", 1] },
      { ...valid, writtenPaths: ["save/a.json", "save/a.json"] },
      { ...valid, writtenPaths: ["save/b.json", "save/a.json"] },
      { ...valid, writtenPaths: [" save/a.json"] },
      { ...valid, writtenPaths: sparsePaths },
      { ...valid, writtenPaths: accessorPaths },
      { ...valid, writtenPaths: [], deletedPaths: [] },
      { ...valid, unexpected: true },
      Object.assign(Object.create({ inherited: true }), valid),
      cyclic,
    ]

    for (const payload of malformed) {
      harness.emit({
        channel: CHANNEL,
        kind: "event",
        sessionId: "session-1",
        event: "workspace-mutation",
        payload,
      })
    }
    expect(received).toEqual([])

    harness.emit({
      channel: CHANNEL,
      kind: "event",
      sessionId: "session-1",
      event: "workspace-mutation",
      payload: valid,
    })
    expect(received).toEqual([valid])
  })

  it("delivers current workspace mutations, isolates subscribers, and supports unsubscribe", () => {
    const harness = createMessageHarness(createTsian)
    harness.ready()
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
    const received: RuntimeWorkspaceMutationEvent[] = []
    harness.subject.onWorkspaceMutation(() => {
      throw new Error("subscriber failure")
    })
    const unsubscribe = harness.subject.onWorkspaceMutation((event) => received.push(event))
    const event: RuntimeWorkspaceMutationEvent = {
      invocationId: "invocation-1",
      saveId: "save-1",
      source: "frontend-action",
      actionId: "use-item",
      writtenPaths: ["save/entities/item-1.json"],
      deletedPaths: [],
    }

    harness.emit({
      channel: CHANNEL,
      kind: "event",
      sessionId: "session-1",
      event: "workspace-mutation",
      payload: event,
    })
    expect(received).toEqual([event])
    expect(consoleError).toHaveBeenCalledTimes(1)

    unsubscribe()
    harness.emit({
      channel: CHANNEL,
      kind: "event",
      sessionId: "session-1",
      event: "workspace-mutation",
      payload: event,
    })
    expect(received).toEqual([event])
  })
})

describe("play-bridge parent and session pinning", () => {
  it("accepts ready only from window.parent and pins its origin for requests and responses", async () => {
    const harness = createMessageHarness(createBridge)

    harness.ready("session-ignored", { source: null })
    expect(harness.subject.ready).toBe(false)

    harness.ready("session-1")
    expect(harness.subject.ready).toBe(true)
    expect(harness.subject.sessionId).toBe("session-1")

    const call = harness.subject.call<JsonValue>("query.query", { resource: "example" })
    const request = lastRequest(harness, "query.query")
    expect(request.targetOrigin).toBe(TRUSTED_ORIGIN)

    harness.respond(request, { ok: true, result: "wrong-origin" }, {
      origin: "https://attacker.example",
    })
    harness.ready("attacker-session", { origin: "https://attacker.example" })
    expect(harness.subject.sessionId).toBe("session-1")

    harness.respond(request, { ok: true, result: "trusted" })
    await expect(call).resolves.toBe("trusted")
  })

  it("ignores stale-session responses and events after rejecting old pending requests", async () => {
    const harness = createMessageHarness(createBridge)
    const onEvent = vi.fn()
    harness.subject.on({ onEvent })
    harness.ready("session-old")

    const oldCall = harness.subject.call("query.query", { resource: "old" })
    harness.ready("session-new")
    await expect(oldCall).rejects.toMatchObject({
      kind: "runtime",
      code: "FRONTEND_ACTION_SESSION_REPLACED",
    })

    const newCall = harness.subject.call<JsonValue>("query.query", { resource: "new" })
    const newRequest = lastRequest(harness, "query.query")
    harness.respond(newRequest, { ok: true, result: "stale" }, {
      sessionId: "session-old",
    })
    harness.emit({
      channel: CHANNEL,
      kind: "event",
      sessionId: "session-old",
      event: "workspace-mutation",
      payload: {
        invocationId: "old-invocation",
        saveId: "save-1",
        source: "frontend-action",
        actionId: "old-action",
        writtenPaths: [],
        deletedPaths: [],
      },
    })
    expect(onEvent).not.toHaveBeenCalled()

    harness.respond(newRequest, { ok: true, result: "current" })
    await expect(newCall).resolves.toBe("current")

    harness.emit({
      channel: CHANNEL,
      kind: "event",
      sessionId: "session-new",
      event: "workspace-mutation",
      payload: {
        invocationId: "new-invocation",
        saveId: "save-1",
        source: "frontend-action",
        actionId: "new-action",
        writtenPaths: [],
        deletedPaths: [],
      },
    })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
})
