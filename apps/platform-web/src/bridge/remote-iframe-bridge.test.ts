// @vitest-environment happy-dom

import "fake-indexeddb/auto"
import type {
  GameCardManifest,
  PlayFrontendBridge,
  RemotePlayBridgeEventMessage,
  RemotePlayBridgeReadyMessage,
  RemotePlayBridgeResponseMessage,
} from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localDb } from "../storage/db"
import { putLocalGameCard } from "../storage/game-cards"
import {
  createLocalSaveFromGameCard,
  setActiveSaveId,
} from "../storage/saves"
import {
  readWorkspaceFileForSave,
  writeWorkspaceFileForSave,
} from "../storage/workspace"
import {
  createFrontendActionExecutionService,
} from "../platform-host/frontend-actions/service"
import type {
  FrontendActionWorkerFactory,
  FrontendActionWorkerLike,
} from "../platform-host/frontend-actions/worker"
import {
  mountRemoteIframeFrontend,
  REMOTE_PLAY_BRIDGE_CHANNEL,
} from "./remote-iframe-bridge"
import type {
  RemoteFrontendActionService,
} from "./remote-frontend-action-lifecycle"

const CARD_ID = "card-action-smoke"
const ACTION_ID = "update-state"
const ACTION_ROOT = `frontend-actions/${ACTION_ID}`
const DEPENDENCY_PATH = "save/dependency.json"
const TARGET_PATH = "save/state.json"

class RuntimePreflightWorker implements FrontendActionWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null

  postMessage(message: unknown): void {
    const value = message as Record<string, unknown>
    if (value.type !== "execute") return
    queueMicrotask(() => {
      this.onmessage?.({
        data: {
          type: "script-result",
          ok: true,
          output: {
            workerExecuted: true,
            workerOrigin: "null",
            indexedDB: "undefined",
            caches: "undefined",
            workerConstructor: "undefined",
            sharedWorkerConstructor: "undefined",
            navigatorStorage: "undefined",
            navigatorServiceWorker: "undefined",
          },
        },
      } as MessageEvent)
    })
  }

  terminate(): void {}
}

class ScriptedWorkspaceWorker implements FrontendActionWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  private observedContent = ""

  constructor(
    private readonly sources: string[],
    private readonly afterRead?: (result: unknown) => void | Promise<void>,
  ) {}

  postMessage(message: unknown): void {
    const value = message as Record<string, unknown>
    if (value.type === "execute") {
      this.sources.push(String(value.source ?? ""))
      queueMicrotask(() => this.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.read",
        args: { scope: "save-runtime", path: DEPENDENCY_PATH },
      }))
      return
    }
    if (value.type !== "sdk-response" || value.ok !== true) return
    if (value.id === 1) {
      const result = value.result as { content?: unknown }
      this.observedContent = typeof result?.content === "string" ? result.content : ""
      void Promise.resolve(this.afterRead?.(value.result))
        .then(() => this.emit({
          type: "sdk-request",
          id: 2,
          op: "workspace.write",
          args: { scope: "save-runtime", path: TARGET_PATH, content: "after" },
        }))
        .catch((error) => this.onerror?.({ error } as ErrorEvent))
      return
    }
    if (value.id === 2) {
      this.emit({
        type: "script-result",
        ok: true,
        output: { observed: this.observedContent, wrote: true },
      })
    }
  }

  terminate(): void {}

  private emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }
}

function scriptedWorkerFactory(options: {
  afterRead?: (result: unknown) => void | Promise<void>
} = {}): { factory: FrontendActionWorkerFactory; sources: string[] } {
  const sources: string[] = []
  return {
    sources,
    factory: () => ({
      worker: new ScriptedWorkspaceWorker(sources, options.afterRead),
    }),
  }
}

function bridgeStub(): PlayFrontendBridge {
  return {
    interaction: {
      async sendMessage() {
        return { turn: 1, assistant: { kind: "assistant", content: "" } }
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

function realActionService(workerFactory: FrontendActionWorkerFactory): RemoteFrontendActionService {
  const service = createFrontendActionExecutionService({ workerFactory })
  return {
    async runAction(request) {
      const result = await service.runAction({
        mountedGameCardId: request.expectedGameCardId,
        invocationId: request.invocationId,
        actionId: request.actionId,
        input: request.input,
        signal: request.signal,
        beforeCommit: request.beforeCommit,
        assertCommitAllowed: request.assertCommitAllowed,
      })
      return {
        output: result.output,
        ...(result.mutationEvent ? { mutation: result.mutationEvent } : {}),
      }
    },
  }
}

function harness(service: RemoteFrontendActionService) {
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
      gameCardId: CARD_ID,
      frontendActionService: service,
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
    run() {
      receive({
        channel: REMOTE_PLAY_BRIDGE_CHANNEL,
        kind: "request",
        sessionId: handle.sessionId,
        id: "run-1",
        method: "card.runAction",
        params: {
          invocationId: "invocation-1",
          actionId: ACTION_ID,
          input: { next: "after" },
        },
      })
    },
  }
}

function actionManifest(): string {
  return JSON.stringify({
    schemaVersion: 1,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["next"],
      properties: { next: { const: "after" } },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["observed", "wrote"],
      properties: {
        observed: { type: "string" },
        wrote: { const: true },
      },
    },
    executor: {
      type: "browser_script",
      path: "run.js",
      helpers: ["helper.js"],
      timeoutMs: 2_000,
    },
  })
}

async function seed(): Promise<string> {
  const manifest: GameCardManifest = {
    schema: "tsian.game-card.v1",
    id: CARD_ID,
    name: "Frontend Action Smoke",
    version: "1.0.0",
    summary: "Cross-layer transaction fixture",
  }
  const card = await putLocalGameCard({
    manifest,
    source: "local",
    contentFiles: [
      { path: `${ACTION_ROOT}/action.json`, content: actionManifest() },
      {
        path: `${ACTION_ROOT}/run.js`,
        content: "importScripts(\"helper.js\"); return { observed: helperReady, wrote: true }",
      },
      { path: `${ACTION_ROOT}/helper.js`, content: "const helperReady = \"helper-ready\"" },
    ],
  })
  const save = await createLocalSaveFromGameCard(card, { name: "Action smoke" })
  await setActiveSaveId(save.id)
  await writeWorkspaceFileForSave(save.id, { path: DEPENDENCY_PATH, content: "baseline" })
  await writeWorkspaceFileForSave(save.id, { path: TARGET_PATH, content: "before" })
  return save.id
}

async function waitForRunResponse(
  messages: Array<RemotePlayBridgeReadyMessage | RemotePlayBridgeResponseMessage | RemotePlayBridgeEventMessage>,
): Promise<RemotePlayBridgeResponseMessage> {
  await vi.waitFor(() => {
    expect(messages.some((message) => message.kind === "response" && message.id === "run-1"))
      .toBe(true)
  })
  const response = messages.find((message): message is RemotePlayBridgeResponseMessage => (
    message.kind === "response" && message.id === "run-1"
  ))
  if (!response) throw new Error("Frontend Action response was not delivered.")
  return response
}

beforeEach(async () => {
  document.body.replaceChildren()
  vi.stubGlobal("Worker", RuntimePreflightWorker)
  await localDb.delete()
  await localDb.open()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await localDb.delete()
})

describe("remote iframe Frontend Action transaction smoke", () => {
  it("commits durable workspace bytes and emits mutation before success", async () => {
    const saveId = await seed()
    const scripted = scriptedWorkerFactory()
    const mounted = harness(realActionService(scripted.factory))
    const ready = mounted.messages[0] as RemotePlayBridgeReadyMessage
    expect(ready.methods).toEqual(expect.arrayContaining(["card.runAction", "card.abortAction"]))

    mounted.run()
    const response = await waitForRunResponse(mounted.messages)

    expect(response).toMatchObject({
      ok: true,
      result: { observed: "baseline", wrote: true },
    })
    expect((await readWorkspaceFileForSave(saveId, TARGET_PATH))?.content).toBe("after")
    expect(scripted.sources).toHaveLength(1)
    expect(scripted.sources[0]).toContain("helper-ready")
    const transactionMessages = mounted.messages.slice(1)
    expect(transactionMessages).toHaveLength(2)
    expect(transactionMessages[0]).toMatchObject({
      kind: "event",
      event: "workspace-mutation",
      payload: {
        invocationId: "invocation-1",
        saveId,
        source: "frontend-action",
        actionId: ACTION_ID,
        writtenPaths: [TARGET_PATH],
        deletedPaths: [],
      },
    })
    expect(transactionMessages[1]).toBe(response)
    mounted.handle.dispose()
  })

  it("rejects a CAS conflict with zero Action writes and no mutation event", async () => {
    const saveId = await seed()
    const saveBefore = await localDb.saves.get(saveId)
    const checkpointsBefore = await localDb.checkpoints.where("saveId").equals(saveId).toArray()
    const targetBefore = await readWorkspaceFileForSave(saveId, TARGET_PATH)
    const scripted = scriptedWorkerFactory({
      async afterRead() {
        const dependency = await localDb.workspaceFiles
          .where("saveId")
          .equals(saveId)
          .and((row) => row.path === DEPENDENCY_PATH)
          .first()
        if (!dependency) throw new Error("Dependency fixture is missing.")
        await localDb.workspaceFiles.put({
          ...dependency,
          content: "concurrent",
          updatedAt: dependency.updatedAt + 1,
        })
      },
    })
    const mounted = harness(realActionService(scripted.factory))

    mounted.run()
    const response = await waitForRunResponse(mounted.messages)

    expect(response).toMatchObject({
      ok: false,
      error: { code: "FRONTEND_ACTION_WORKSPACE_CONFLICT" },
    })
    expect((await readWorkspaceFileForSave(saveId, DEPENDENCY_PATH))?.content).toBe("concurrent")
    expect(await readWorkspaceFileForSave(saveId, TARGET_PATH)).toEqual(targetBefore)
    expect(await localDb.saves.get(saveId)).toEqual(saveBefore)
    expect(await localDb.checkpoints.where("saveId").equals(saveId).toArray())
      .toEqual(checkpointsBefore)
    expect(mounted.messages.some((message) => (
      message.kind === "event" && message.event === "workspace-mutation"
    ))).toBe(false)
    expect(mounted.messages.some((message) => (
      message.kind === "response" && message.id === "run-1" && message.ok
    ))).toBe(false)
    mounted.handle.dispose()
  })
})
