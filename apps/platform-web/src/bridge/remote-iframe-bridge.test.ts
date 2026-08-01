// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  PlayFrontendBridge,
  RemotePlayBridgeEventMessage,
  RemotePlayBridgeReadyMessage,
  RemotePlayBridgeResponseMessage,
} from "@tsian/contracts"
import {
  mountRemoteIframeFrontend,
  REMOTE_PLAY_BRIDGE_CHANNEL,
} from "./remote-iframe-bridge"
import type {
  RemoteFrontendActionService,
  RemoteFrontendActionServiceRequest,
} from "./remote-frontend-action-lifecycle"
import { emitTurnTool } from "../streaming-events"

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function bridgeStub(): PlayFrontendBridge {
  return {
    interaction: {
      async sendMessage() {
        return {
          turn: 1,
          assistant: { kind: "assistant", content: "" },
        }
      },
      async invokeAgent(request) {
        return { invocationId: request.invocationId ?? "invoke-1", response: "" }
      },
      async stop() {},
    },
    query: {
      async query() {
        return { resource: "unused", data: null } as never
      },
    },
    platform: {
      async getPlatformContext() {
        return { version: "test" }
      },
      async runAction() {
        return { action: "unused", data: null } as never
      },
    },
    workspace: {
      async read() { return null },
      async list() { return [] },
      async search() { return [] },
      async write(request) {
        return {
          path: request.path,
          scope: "save-runtime",
          file: {
            path: request.path,
            content: typeof request.content === "string" ? request.content : "",
            createdAt: 1,
            updatedAt: 1,
          },
          changed: true,
        }
      },
    },
    card: {
      async getEntrypoints() { return {} },
      async runAction() { throw new Error("mount-owned") },
      async abortAction() {},
    },
  }
}

function harness(
  service: RemoteFrontendActionService,
  options: {
    isCurrentBinding?: (saveId: string, gameCardId: string) => boolean | Promise<boolean>
  } = {},
) {
  const container = document.createElement("div")
  document.body.append(container)
  const createElement = document.createElement.bind(document)
  const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((
    qualifiedName: string,
    options?: ElementCreationOptions,
  ) => {
    const element = createElement(qualifiedName, options)
    if (qualifiedName.toLowerCase() === "iframe") {
      element.setAttribute("srcdoc", "<!doctype html><html><body></body></html>")
    }
    return element
  })
  let handle: ReturnType<typeof mountRemoteIframeFrontend>
  try {
    handle = mountRemoteIframeFrontend(container, {
      url: "http://localhost/",
      bridge: bridgeStub(),
      gameCardId: "card-1",
      frontendActionService: service,
      isFrontendActionBindingCurrent: options.isCurrentBinding ?? (() => true),
    })
  } finally {
    createElementSpy.mockRestore()
  }
  const messages: Array<
    RemotePlayBridgeReadyMessage | RemotePlayBridgeResponseMessage | RemotePlayBridgeEventMessage
  > = []
  vi.spyOn(handle.iframe.contentWindow!, "postMessage").mockImplementation((message) => {
    messages.push(message as typeof messages[number])
  })

  function receive(data: Record<string, unknown>) {
    window.dispatchEvent(new MessageEvent("message", {
      source: handle.iframe.contentWindow,
      origin: "http://localhost",
      data,
    }))
  }
  receive({ channel: REMOTE_PLAY_BRIDGE_CHANNEL, kind: "hello" })

  return {
    handle,
    messages,
    request(id: string, method: "card.runAction" | "card.abortAction", params: unknown) {
      receive({
        channel: REMOTE_PLAY_BRIDGE_CHANNEL,
        kind: "request",
        sessionId: handle.sessionId,
        id,
        method,
        params,
      })
    },
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
}

beforeEach(() => {
  document.body.replaceChildren()
})

describe("remote iframe Frontend Action RPC", () => {
  it("advertises methods and orders commit, binding check, mutation, then success", async () => {
    const order: string[] = []
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        expect(request.expectedGameCardId).toBe("card-1")
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        order.push("committed")
        return {
          output: { equipped: true },
          mutation: {
            invocationId: request.invocationId,
            saveId: "save-1",
            source: "frontend-action",
            actionId: request.actionId,
            writtenPaths: ["save/equipment.json"],
            deletedPaths: [],
          },
        }
      },
    }
    const mounted = harness(service, {
      isCurrentBinding(saveId, gameCardId) {
        expect(saveId).toBe("save-1")
        expect(gameCardId).toBe("card-1")
        order.push("binding-checked")
        return true
      },
    })
    const ready = mounted.messages[0] as RemotePlayBridgeReadyMessage
    expect(ready.methods).toEqual(expect.arrayContaining([
      "card.runAction",
      "card.abortAction",
    ]))

    mounted.request("run-1", "card.runAction", {
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: { itemId: "sword-1" },
    })
    await settle()

    const relevant = mounted.messages.slice(1)
    for (const message of relevant) {
      if (message.kind === "event" && message.event === "workspace-mutation") {
        order.push("mutation")
      } else if (message.kind === "response" && message.id === "run-1" && message.ok) {
        order.push("success")
      }
    }
    expect(order).toEqual(["committed", "binding-checked", "mutation", "success"])
    expect(relevant.map((message) => message.kind)).toEqual(["event", "response"])
    expect(relevant[0]).toMatchObject({
      kind: "event",
      event: "workspace-mutation",
      payload: { invocationId: "invocation-1", saveId: "save-1" },
    })
    expect(relevant[1]).toMatchObject({
      kind: "response",
      id: "run-1",
      ok: true,
      result: { equipped: true },
    })
    mounted.handle.dispose()
  })

  it("does not deliver mutation or success when the active save switches after commit", async () => {
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
        return {
          output: { equipped: true },
          mutation: {
            invocationId: request.invocationId,
            saveId: "save-1",
            source: "frontend-action",
            actionId: request.actionId,
            writtenPaths: ["save/equipment.json"],
            deletedPaths: [],
          },
        }
      },
    }
    const mounted = harness(service, {
      isCurrentBinding: () => verifyBinding.promise,
    })
    mounted.request("run-1", "card.runAction", {
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await committed.promise

    verifyBinding.resolve(false)
    await settle()

    expect(durableWriteCount).toBe(1)
    expect(mounted.messages.some((message) => (
      message.kind === "event" && message.event === "workspace-mutation"
    ))).toBe(false)
    expect(mounted.messages.some((message) => (
      message.kind === "response" && message.id === "run-1" && message.ok
    ))).toBe(false)
    expect(mounted.messages).toContainEqual(expect.objectContaining({
      kind: "response",
      id: "run-1",
      ok: false,
      error: expect.objectContaining({ code: "FRONTEND_ACTION_SESSION_REPLACED" }),
    }))
    mounted.handle.dispose()
  })

  it("does not deliver mutation or success when the save-to-card binding switches after commit", async () => {
    let saveGameCardId = "card-1"
    let durableWriteCount = 0
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        durableWriteCount += 1
        saveGameCardId = "card-2"
        return {
          output: { equipped: true },
          mutation: {
            invocationId: request.invocationId,
            saveId: "save-1",
            source: "frontend-action",
            actionId: request.actionId,
            writtenPaths: ["save/equipment.json"],
            deletedPaths: [],
          },
        }
      },
    }
    const mounted = harness(service, {
      isCurrentBinding: (saveId, gameCardId) => (
        saveId === "save-1" && saveGameCardId === gameCardId
      ),
    })
    mounted.request("run-1", "card.runAction", {
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await settle()

    expect(durableWriteCount).toBe(1)
    expect(mounted.messages.some((message) => (
      message.kind === "event" && message.event === "workspace-mutation"
    ))).toBe(false)
    expect(mounted.messages.some((message) => (
      message.kind === "response" && message.id === "run-1" && message.ok
    ))).toBe(false)
    expect(mounted.messages).toContainEqual(expect.objectContaining({
      kind: "response",
      id: "run-1",
      ok: false,
      error: expect.objectContaining({ code: "FRONTEND_ACTION_SESSION_REPLACED" }),
    }))
    mounted.handle.dispose()
  })

  it("aborts a running invocation and returns a typed Action error", async () => {
    const running = deferred<void>()
    const release = deferred<void>()
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        running.resolve()
        await release.promise
        await request.beforeCommit({ saveId: "save-1" })
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        return { output: null }
      },
    }
    const mounted = harness(service)
    mounted.request("run-1", "card.runAction", {
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await running.promise
    mounted.request("abort-1", "card.abortAction", { invocationId: "invocation-1" })
    release.resolve()
    await settle()

    expect(mounted.messages).toContainEqual(expect.objectContaining({
      kind: "response",
      id: "abort-1",
      ok: true,
    }))
    expect(mounted.messages).toContainEqual(expect.objectContaining({
      kind: "response",
      id: "run-1",
      ok: false,
      error: expect.objectContaining({ code: "FRONTEND_ACTION_ABORTED" }),
    }))
    expect(mounted.messages.some((message) => (
      message.kind === "event" && message.event === "workspace-mutation"
    ))).toBe(false)
    mounted.handle.dispose()
  })

  it("disposes after preparation and prevents the commit transaction from writing", async () => {
    const commitPrepared = deferred<void>()
    const enterTransaction = deferred<void>()
    let writeCount = 0
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        await request.beforeCommit({ saveId: "save-1" })
        commitPrepared.resolve()
        await enterTransaction.promise
        request.assertCommitAllowed()
        request.assertCommitAllowed()
        writeCount += 1
        return {
          output: true,
          mutation: {
            invocationId: request.invocationId,
            saveId: "save-1",
            source: "frontend-action",
            actionId: request.actionId,
            writtenPaths: ["save/state.json"],
            deletedPaths: [],
          },
        }
      },
    }
    const mounted = harness(service)
    mounted.request("run-1", "card.runAction", {
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await commitPrepared.promise
    const beforeDispose = mounted.messages.length

    mounted.handle.dispose()
    enterTransaction.resolve()
    await settle()

    expect(writeCount).toBe(0)
    expect(mounted.messages).toHaveLength(beforeDispose)
    expect(mounted.messages.some((message) => (
      message.kind === "event" && message.event === "workspace-mutation"
    ))).toBe(false)
  })

  it("suppresses stale responses and events after dispose", async () => {
    const running = deferred<void>()
    const release = deferred<void>()
    let observedSignal: AbortSignal | undefined
    const service: RemoteFrontendActionService = {
      async runAction(request) {
        observedSignal = request.signal
        running.resolve()
        await release.promise
        return {
          output: true,
          mutation: {
            invocationId: request.invocationId,
            saveId: "save-1",
            source: "frontend-action",
            actionId: request.actionId,
            writtenPaths: ["save/state.json"],
            deletedPaths: [],
          },
        }
      },
    }
    const mounted = harness(service)
    mounted.request("run-1", "card.runAction", {
      invocationId: "invocation-1",
      actionId: "equip-item",
      input: null,
    })
    await running.promise
    const beforeDispose = mounted.messages.length
    mounted.handle.dispose()
    expect(observedSignal?.aborted).toBe(true)
    release.resolve()
    await settle()

    expect(mounted.messages).toHaveLength(beforeDispose)
  })

  it("rejects invalid Action input without calling the service", async () => {
    const runAction = vi.fn(async (_request: RemoteFrontendActionServiceRequest) => ({
      output: null,
    }))
    const mounted = harness({ runAction })
    mounted.request("run-1", "card.runAction", {
      invocationId: "invalid/id",
      actionId: "equip-item",
      input: null,
    })
    await settle()

    expect(runAction).not.toHaveBeenCalled()
    expect(mounted.messages).toContainEqual(expect.objectContaining({
      kind: "response",
      id: "run-1",
      ok: false,
      error: expect.objectContaining({ code: "FRONTEND_ACTION_INPUT_INVALID" }),
    }))
    mounted.handle.dispose()
  })
})

describe("remote iframe turn-tool forwarding", () => {
  it("forwards an optional display name without requiring it", () => {
    const mounted = harness({
      async runAction() {
        throw new Error("unused")
      },
    })

    emitTurnTool(
      "master",
      3,
      1,
      "call-title",
      "read_entity",
      "loading",
      undefined,
      "读取实体",
    )
    emitTurnTool("master", 3, 1, "call-fallback", "read", "success")

    const toolEvents = mounted.messages.filter(
      (message): message is RemotePlayBridgeEventMessage => (
        message.kind === "event" && message.event === "turn-tool"
      ),
    )
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0]).toMatchObject({
      payload: {
        callId: "call-title",
        name: "read_entity",
        displayName: "读取实体",
      },
    })
    expect(toolEvents[1]?.payload).not.toHaveProperty("displayName")
    mounted.handle.dispose()
  })
})
