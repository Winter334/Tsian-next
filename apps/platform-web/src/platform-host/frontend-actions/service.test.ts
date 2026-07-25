import "fake-indexeddb/auto"
import type {
  GameCardManifest,
  JsonValue,
  WorkspaceFile,
} from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  commitFrontendActionWorkspace,
  loadFrontendActionWorkspaceSnapshot,
  type CommitFrontendActionWorkspaceInput,
} from "@/storage/frontend-action-workspace"
import type { LocalGameCardRecord, LocalWorkspaceFileRecord } from "@/storage/db"
import { localDb } from "@/storage/db"
import { gameCardContentFileId } from "@/storage/game-cards"
import {
  FrontendActionDomainError,
  FrontendActionRuntimeError,
} from "./errors"
import {
  createFrontendActionExecutionService,
  type FrontendActionExecutionService,
  type FrontendActionExecutionServiceOptions,
} from "./service"
import { subscribeRuntimeWorkspaceMutation } from "./events"
import type {
  FrontendActionWorkerFactory,
  FrontendActionWorkerLike,
} from "./worker"

const CARD_ID = "card-action-service"
const SAVE_ID = "save-action-service"
const ROOT = "frontend-actions/use-item"

class ScriptedWorker implements FrontendActionWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  private readonly responses = new Map<number, unknown>()

  constructor(private readonly start: (worker: ScriptedWorker) => void) {}

  postMessage(message: unknown): void {
    const value = message as Record<string, unknown>
    if (value.type === "execute") queueMicrotask(() => this.start(this))
    if (value.type === "sdk-response" && typeof value.id === "number") {
      this.responses.set(value.id, value)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  emit(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  emitAfterSdk(id: number, data: unknown): void {
    const wait = () => {
      if (this.responses.has(id)) {
        this.emit(data)
        return
      }
      setTimeout(wait, 0)
    }
    wait()
  }
}

function workerFactory(start: (worker: ScriptedWorker) => void): {
  factory: FrontendActionWorkerFactory
  workers: ScriptedWorker[]
} {
  const workers: ScriptedWorker[] = []
  return {
    workers,
    factory: () => {
      const worker = new ScriptedWorker(start)
      workers.push(worker)
      return { worker }
    },
  }
}

function testServiceOptions(
  factory: FrontendActionWorkerFactory,
): Pick<FrontendActionExecutionServiceOptions, "workerFactory" | "ensureRuntimeReady"> {
  return {
    workerFactory: factory,
    ensureRuntimeReady: async () => undefined,
  }
}

function manifest(
  outputSchema: JsonValue = { type: "object" },
  helpers: string[] = [],
): string {
  return JSON.stringify({
    schemaVersion: 1,
    inputSchema: { type: "object" },
    outputSchema,
    executor: {
      type: "browser_script",
      path: "run.js",
      timeoutMs: 100,
      ...(helpers.length > 0 ? { helpers } : {}),
    },
  })
}

function cardManifest(): GameCardManifest {
  return {
    schema: "tsian.game-card.v1",
    id: CARD_ID,
    name: "Action Service Test",
    version: "1.0.0",
    summary: "Fixture",
  }
}

function workspaceRow(path: string, content: string): LocalWorkspaceFileRecord {
  return {
    id: `${SAVE_ID}:workspace:${encodeURIComponent(path)}`,
    saveId: SAVE_ID,
    path,
    content,
    createdAt: 10,
    updatedAt: 10,
  }
}

async function seed(
  outputSchema?: JsonValue,
  options: {
    source?: string
    helpers?: Array<{ path: string; content: string }>
  } = {},
): Promise<void> {
  const helpers = options.helpers ?? []
  const card: LocalGameCardRecord = {
    id: CARD_ID,
    manifest: cardManifest(),
    source: "local",
    createdAt: 1,
    updatedAt: 1,
  }
  await localDb.meta.put({ key: "active-save-id", value: SAVE_ID })
  await localDb.saves.put({
    id: SAVE_ID,
    name: "Save",
    gameCardId: CARD_ID,
    gameCardVersion: "1.0.0",
    createdAt: 1,
    updatedAt: 1,
  })
  await localDb.gameCards.put(card)
  await localDb.gameCardContentFiles.bulkPut([
    {
      id: gameCardContentFileId(CARD_ID, `${ROOT}/action.json`),
      gameCardId: CARD_ID,
      path: `${ROOT}/action.json`,
      content: manifest(outputSchema, helpers.map((helper) => helper.path)),
      createdAt: 2,
      updatedAt: 2,
    },
    {
      id: gameCardContentFileId(CARD_ID, `${ROOT}/run.js`),
      gameCardId: CARD_ID,
      path: `${ROOT}/run.js`,
      content: options.source ?? "return { ok: true }",
      createdAt: 3,
      updatedAt: 3,
    },
    ...helpers.map((helper, index) => ({
      id: gameCardContentFileId(CARD_ID, `${ROOT}/${helper.path}`),
      gameCardId: CARD_ID,
      path: `${ROOT}/${helper.path}`,
      content: helper.content,
      createdAt: 4 + index,
      updatedAt: 4 + index,
    })),
  ])
  await localDb.workspaceFiles.put(workspaceRow("save/state.json", "before"))
}

function run(service: FrontendActionExecutionService, overrides: Record<string, unknown> = {}) {
  return service.runAction({
    mountedGameCardId: CARD_ID,
    invocationId: "invocation-1",
    actionId: "use-item",
    input: {},
    ...overrides,
  })
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

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
})

afterEach(async () => {
  await localDb.delete()
})

describe("Frontend Action execution service", () => {
  it("fails closed before snapshot loading or Worker creation when runtime preflight rejects", async () => {
    let snapshotLoads = 0
    const fake = workerFactory(() => {
      throw new Error("Worker must not start when preflight fails.")
    })
    const service = createFrontendActionExecutionService({
      workerFactory: fake.factory,
      ensureRuntimeReady: async () => {
        throw new Error("production runtime gate failed")
      },
      loadSnapshot: async (...args) => {
        snapshotLoads += 1
        return loadFrontendActionWorkspaceSnapshot(...args)
      },
    })

    await expectRuntimeCode(run(service), "FRONTEND_ACTION_EXECUTION_FAILED")
    expect(snapshotLoads).toBe(0)
    expect(fake.workers).toHaveLength(0)
  })

  it("commits only exact statically imported helper resource dependencies", async () => {
    await seed(undefined, {
      source: `importScripts("helpers/used.js");\nreturn { ok: true }`,
      helpers: [
        { path: "helpers/used.js", content: "globalThis.used = true" },
        { path: "helpers/unused.js", content: "globalThis.unused = true" },
      ],
    })
    const fake = workerFactory((worker) => {
      worker.emit({ type: "script-result", ok: true, output: { ok: true } })
    })
    let committedResources: CommitFrontendActionWorkspaceInput["resources"] = []
    const service = createFrontendActionExecutionService({
      ...testServiceOptions(fake.factory),
      commitWorkspace: async (input) => {
        committedResources = input.resources
        return commitFrontendActionWorkspace(input)
      },
    })

    await expect(run(service)).resolves.toMatchObject({ output: { ok: true } })
    expect(committedResources.map((resource) => resource.path)).toEqual([
      `${ROOT}/action.json`,
      `${ROOT}/run.js`,
      `${ROOT}/helpers/used.js`,
    ])
  })

  it("commits a staged write and returns path-only event data", async () => {
    await seed()
    const fake = workerFactory((worker) => {
      worker.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.write",
        args: { scope: "save-runtime", path: "save/state.json", content: "after" },
      })
      worker.emitAfterSdk(1, { type: "script-result", ok: true, output: { ok: true } })
    })
    const events: unknown[] = []
    const unsubscribe = subscribeRuntimeWorkspaceMutation((event) => events.push(event))
    const result = await run(createFrontendActionExecutionService(testServiceOptions(fake.factory)))
    unsubscribe()
    expect(result).toEqual({
      output: { ok: true },
      mutationEvent: {
        invocationId: "invocation-1",
        saveId: SAVE_ID,
        source: "frontend-action",
        actionId: "use-item",
        writtenPaths: ["save/state.json"],
        deletedPaths: [],
      },
    })
    expect(events).toEqual([result.mutationEvent])
    expect((await localDb.workspaceFiles.get(workspaceRow("save/state.json", "").id))?.content).toBe("after")
    expect(fake.workers[0]?.terminated).toBe(true)
  })

  it("preserves valid domain failure and rolls back staged writes", async () => {
    await seed()
    const fake = workerFactory((worker) => {
      worker.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.write",
        args: { scope: "save-runtime", path: "save/state.json", content: "after" },
      })
      worker.emitAfterSdk(1, {
        type: "script-result",
        ok: false,
        error: { kind: "domain", envelope: { code: "BLOCKED", message: "Blocked." } },
      })
    })
    try {
      await run(createFrontendActionExecutionService(testServiceOptions(fake.factory)))
      throw new Error("Expected domain error.")
    } catch (error) {
      expect(error).toBeInstanceOf(FrontendActionDomainError)
      expect((error as FrontendActionDomainError).publicError).toMatchObject({
        kind: "domain",
        code: "BLOCKED",
      })
    }
    expect((await localDb.workspaceFiles.get(workspaceRow("save/state.json", "").id))?.content).toBe("before")
  })

  it("rejects invalid output before commit", async () => {
    await seed({ type: "boolean" })
    const fake = workerFactory((worker) => {
      worker.emit({ type: "script-result", ok: true, output: { secret: true } })
    })
    await expectRuntimeCode(
      run(createFrontendActionExecutionService(testServiceOptions(fake.factory))),
      "FRONTEND_ACTION_OUTPUT_INVALID",
    )
    expect((await localDb.workspaceFiles.get(workspaceRow("save/state.json", "").id))?.content).toBe("before")
  })

  it("allows the beforeCommit barrier to abort durable commit", async () => {
    await seed()
    const controller = new AbortController()
    const fake = workerFactory((worker) => {
      worker.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.write",
        args: { scope: "save-runtime", path: "save/state.json", content: "after" },
      })
      worker.emitAfterSdk(1, { type: "script-result", ok: true, output: { ok: true } })
    })
    await expectRuntimeCode(run(createFrontendActionExecutionService(testServiceOptions(fake.factory)), {
      signal: controller.signal,
      beforeCommit: () => controller.abort(),
    }), "FRONTEND_ACTION_ABORTED")
    expect((await localDb.workspaceFiles.get(workspaceRow("save/state.json", "").id))?.content).toBe("before")
  })

  it("forwards the commit assertion through both storage boundaries", async () => {
    await seed()
    const fake = workerFactory((worker) => {
      worker.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.write",
        args: { scope: "save-runtime", path: "save/state.json", content: "after" },
      })
      worker.emitAfterSdk(1, { type: "script-result", ok: true, output: { ok: true } })
    })
    let assertionCount = 0

    const result = await run(createFrontendActionExecutionService(testServiceOptions(fake.factory)), {
      assertCommitAllowed: () => {
        assertionCount += 1
      },
    })

    expect(result.mutationEvent?.writtenPaths).toEqual(["save/state.json"])
    expect(assertionCount).toBe(2)
  })

  it("does not write when commit permission is invalidated between assertions", async () => {
    await seed()
    const fake = workerFactory((worker) => {
      worker.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.write",
        args: { scope: "save-runtime", path: "save/state.json", content: "after" },
      })
      worker.emitAfterSdk(1, { type: "script-result", ok: true, output: { ok: true } })
    })
    let assertionCount = 0

    await expectRuntimeCode(run(createFrontendActionExecutionService(testServiceOptions(fake.factory)), {
      assertCommitAllowed: () => {
        assertionCount += 1
        if (assertionCount === 2) {
          throw new FrontendActionRuntimeError("FRONTEND_ACTION_ABORTED", {
            correlationId: "invocation-1",
          })
        }
      },
    }), "FRONTEND_ACTION_ABORTED")

    expect(assertionCount).toBe(2)
    expect((await localDb.workspaceFiles.get(workspaceRow("save/state.json", "").id))?.content)
      .toBe("before")
  })

  it("lets durable commit win when abort arrives after the final assertion", async () => {
    await seed()
    const controller = new AbortController()
    const fake = workerFactory((worker) => {
      worker.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.write",
        args: { scope: "save-runtime", path: "save/state.json", content: "after" },
      })
      worker.emitAfterSdk(1, { type: "script-result", ok: true, output: { ok: true } })
    })
    let assertionCount = 0

    const result = await run(createFrontendActionExecutionService(testServiceOptions(fake.factory)), {
      signal: controller.signal,
      assertCommitAllowed: () => {
        assertionCount += 1
        if (assertionCount === 2) queueMicrotask(() => controller.abort())
      },
    })

    expect(assertionCount).toBe(2)
    expect(controller.signal.aborted).toBe(true)
    expect(result.mutationEvent?.writtenPaths).toEqual(["save/state.json"])
    expect((await localDb.workspaceFiles.get(workspaceRow("save/state.json", "").id))?.content)
      .toBe("after")
  })

  it("maps a relevant dependency change to conflict with no write", async () => {
    await seed()
    const fake = workerFactory((worker) => {
      worker.emit({
        type: "sdk-request",
        id: 1,
        op: "workspace.read",
        args: { scope: "save-runtime", path: "save/state.json" },
      })
      worker.emitAfterSdk(1, { type: "script-result", ok: true, output: { ok: true } })
    })
    const service = createFrontendActionExecutionService(testServiceOptions(fake.factory))
    await expectRuntimeCode(run(service, {
      beforeCommit: async () => {
        await localDb.workspaceFiles.put({ ...workspaceRow("save/state.json", "concurrent"), updatedAt: 30 })
      },
    }), "FRONTEND_ACTION_WORKSPACE_CONFLICT")
    expect((await localDb.workspaceFiles.get(workspaceRow("save/state.json", "").id))?.content).toBe("concurrent")
  })
})
