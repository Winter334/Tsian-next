// @vitest-environment happy-dom
import { createApp, h, type App } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  FrontendActionError,
  type JsonValue,
  type RuntimeWorkspaceMutationEvent,
  type TsianApi,
} from "@tsian/play-bridge"
import { useEquipmentManagement } from "./useEquipmentManagement"
import type { CharacterEntity } from "../lib/character-types"
import type { EquipmentMutationResult } from "../lib/equipment-action"

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function character(slotRef: string | null = null, containerRefs: string[] = []): CharacterEntity {
  return {
    id: "character:hero",
    name: "主角",
    brief: "旅行者",
    attributes: { 力量: 10 },
    equipment: { 手部: [slotRef === null ? { ref: null } : { ref: slotRef }] },
    equipmentStatus: "ready",
    containers: containerRefs.map((ref) => ({ ref })),
  }
}

function output(
  input: JsonValue,
  attributes: EquipmentMutationResult["attributes"] = {
    before: { 力量: 10 },
    after: { 力量: 12 },
    delta: { 力量: 2 },
  },
): JsonValue {
  const request = input as unknown as {
    mode: "preview" | "commit"
    operation: "equip" | "unequip"
    characterRef: string
    slotType: string
    slotIndex: number
    expectedCurrentRef: string | null
    itemRef?: string
  }
  const afterRef = request.operation === "equip" ? request.itemRef as string : null
  return {
    kind: "mutation",
    mode: request.mode,
    operation: request.operation,
    characterRef: request.characterRef,
    slot: {
      slotType: request.slotType,
      slotIndex: request.slotIndex,
      beforeRef: request.expectedCurrentRef,
      afterRef,
    },
    attributes,
    equipment: {
      [request.slotType]: [afterRef === null ? { ref: null } : { ref: afterRef, applied: { 力量: 2 } }],
    },
  }
}

function mutationEvent(paths: string[] = ["save/entities/character/hero.json"]): RuntimeWorkspaceMutationEvent {
  return {
    invocationId: "invocation-1",
    saveId: "save-1",
    source: "frontend-action",
    actionId: "equipment",
    writtenPaths: paths,
    deletedPaths: [],
  }
}

function fakeTsian(
  runAction: TsianApi["card"]["runAction"],
  read: TsianApi["workspace"]["read"] = vi.fn(async () => null) as TsianApi["workspace"]["read"],
): TsianApi {
  return {
    ready: true,
    waitForReady: async () => {},
    sessionId: "session-1",
    send: async () => {},
    invokeAgent: async () => ({ invocationId: "invocation-1", response: "" }),
    onMessage: () => () => {},
    onRoundEnd: () => () => {},
    onTurnEnd: () => () => {},
    onTool: () => () => {},
    onAsk: () => () => {},
    onAgentInvocation: () => () => {},
    onWorkspaceMutation: () => () => {},
    answer: async () => {},
    stop: async () => {},
    history: { get: async () => ({ entries: [], turn: 1 }) },
    checkpoints: {
      list: async () => [],
      restore: async () => ({ turn: 0 }),
      create: async () => { throw new Error("unused") },
      update: async () => { throw new Error("unused") },
      overwrite: async () => { throw new Error("unused") },
      delete: async () => {},
    },
    workspace: {
      read,
      list: async () => [],
      search: async () => [],
      write: vi.fn(async () => { throw new Error("unused") }) as TsianApi["workspace"]["write"],
    },
    card: {
      entrypoints: async () => ({}),
      runAction,
    },
    query: async () => null,
    runAction: async () => null,
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function mountCoordinator(
  tsian: TsianApi,
  getCharacter: () => CharacterEntity | null,
  reload: () => Promise<void> = async () => {},
) {
  let coordinator!: ReturnType<typeof useEquipmentManagement>
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup() {
      coordinator = useEquipmentManagement(tsian, getCharacter, reload)
      return () => h("div")
    },
  })
  app.mount(host)
  coordinator.show({
    slotType: "手部",
    slotIndex: 0,
    slot: getCharacter()?.equipment?.手部?.[0] ?? { ref: null },
    trigger: null,
  })
  return { app, coordinator }
}

let apps: App[] = []
afterEach(() => {
  for (const app of apps) app.unmount()
  apps = []
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("useEquipmentManagement preview lifecycle", () => {
  it("aborts the previous preview and prevents its stale response from replacing the current result", async () => {
    const first = deferred<JsonValue>()
    const second = deferred<JsonValue>()
    const calls: Array<{ input: JsonValue; signal?: AbortSignal }> = []
    const runAction = vi.fn((_actionId: string, input: JsonValue, options?: { signal?: AbortSignal }) => {
      calls.push({ input, signal: options?.signal })
      return calls.length === 1 ? first.promise : second.promise
    }) as TsianApi["card"]["runAction"]
    const currentCharacter = character()
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter)
    apps.push(app)

    const firstPreview = coordinator.runPreview("equip", "item:first")
    const secondPreview = coordinator.runPreview("equip", "item:second")
    expect(calls[0]?.signal?.aborted).toBe(true)

    first.resolve(output(calls[0].input, {
      before: { 力量: 10 },
      after: { 力量: 11 },
      delta: { 力量: 1 },
    }))
    await firstPreview
    expect(coordinator.preview.value).toBeNull()

    second.resolve(output(calls[1].input, {
      before: { 力量: 10 },
      after: { 力量: 13 },
      delta: { 力量: 3 },
    }))
    await secondPreview
    expect(coordinator.preview.value?.slot.afterRef).toBe("item:second")
    expect(coordinator.preview.value?.attributes.delta).toEqual({ 力量: 3 })
  })

  it("invalidates and rereads when a relevant mutation arrives before the preview response", async () => {
    const pending = deferred<JsonValue>()
    let capturedInput: JsonValue | undefined
    const runAction = vi.fn((_actionId: string, input: JsonValue) => {
      capturedInput = input
      return pending.promise
    }) as TsianApi["card"]["runAction"]
    const reload = vi.fn(async () => {})
    const currentCharacter = character()
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter, reload)
    apps.push(app)

    const previewPromise = coordinator.runPreview("equip", "item:blade")
    await coordinator.handleWorkspaceMutation(mutationEvent())
    pending.resolve(output(capturedInput!))
    await previewPromise

    expect(reload).toHaveBeenCalledTimes(1)
    expect(coordinator.preview.value).toBeNull()
    expect(coordinator.errorMessage.value).toBe("角色或物品状态已变化，请重新预览。")
  })

  it("aborts a pending preview and clears accepted state when the dialog closes", async () => {
    const pending = deferred<JsonValue>()
    let signal: AbortSignal | undefined
    const runAction = vi.fn((_actionId: string, _input: JsonValue, options?: { signal?: AbortSignal }) => {
      signal = options?.signal
      return pending.promise
    }) as TsianApi["card"]["runAction"]
    const currentCharacter = character()
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter)
    apps.push(app)

    const previewPromise = coordinator.runPreview("equip", "item:first")
    coordinator.hide()
    expect(signal?.aborted).toBe(true)
    expect(coordinator.preview.value).toBeNull()
    expect(coordinator.open.value).toBe(false)

    pending.reject(new FrontendActionError({
      kind: "runtime",
      code: "FRONTEND_ACTION_ABORTED",
      message: "aborted",
    }))
    await previewPromise
    expect(coordinator.errorMessage.value).toBe("")
  })
})

describe("useEquipmentManagement commit lifecycle", () => {
  it("commits the immutable accepted preview request even if current character state changes", async () => {
    let currentCharacter = character()
    const calls: JsonValue[] = []
    const runAction = vi.fn(async (_actionId: string, input: JsonValue) => {
      calls.push(input)
      return output(input)
    }) as TsianApi["card"]["runAction"]
    const reload = vi.fn(async () => {})
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter, reload)
    apps.push(app)

    await coordinator.runPreview("equip", "item:blade")
    currentCharacter = character("item:someone-else")
    await coordinator.commit()

    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      mode: "commit",
      operation: "equip",
      expectedCurrentRef: null,
      itemRef: "item:blade",
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("records a relevant mutation before the commit response and reconciles after success without aborting or retrying", async () => {
    const commitDeferred = deferred<JsonValue>()
    const calls: JsonValue[] = []
    const runAction = vi.fn((_actionId: string, input: JsonValue) => {
      calls.push(input)
      return calls.length === 1 ? Promise.resolve(output(input)) : commitDeferred.promise
    }) as TsianApi["card"]["runAction"]
    let currentCharacter = character()
    const reload = vi.fn(async () => {
      currentCharacter = character("item:blade")
    })
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter, reload)
    apps.push(app)

    await coordinator.runPreview("equip", "item:blade")
    const commitPromise = coordinator.commit()
    expect(coordinator.commitPending.value).toBe(true)
    await coordinator.handleWorkspaceMutation(mutationEvent())
    expect(coordinator.commitPending.value).toBe(true)
    expect(runAction).toHaveBeenCalledTimes(2)

    commitDeferred.resolve(output(calls[1]))
    await commitPromise
    expect(runAction).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(coordinator.selection.value?.slot.ref).toBe("item:blade")
    expect(coordinator.successMessage.value).toBe("装备变更已写入。")
  })

  it.each([
    ["domain expected-ref mismatch", new FrontendActionError({
      kind: "domain",
      code: "EQUIPMENT_EXPECTED_REF_MISMATCH",
      message: "stale",
    })],
    ["runtime workspace conflict", new FrontendActionError({
      kind: "runtime",
      code: "FRONTEND_ACTION_WORKSPACE_CONFLICT",
      message: "conflict",
    })],
  ])("authoritatively rereads and requires a fresh preview after %s without retrying", async (_label, failure) => {
    const calls: JsonValue[] = []
    const runAction = vi.fn(async (_actionId: string, input: JsonValue) => {
      calls.push(input)
      if (calls.length === 1) return output(input)
      throw failure
    }) as TsianApi["card"]["runAction"]
    const reload = vi.fn(async () => {})
    const currentCharacter = character()
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter, reload)
    apps.push(app)

    await coordinator.runPreview("equip", "item:blade")
    await coordinator.commit()

    expect(runAction).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(coordinator.preview.value).toBeNull()
    expect(coordinator.errorMessage.value).toBe("角色状态刚刚发生变化，请重新选择并预览。")
  })

  it("ignores unrelated mutations without invalidating an accepted preview", async () => {
    const runAction = vi.fn(async (_actionId: string, input: JsonValue) => output(input)) as TsianApi["card"]["runAction"]
    const reload = vi.fn(async () => {})
    const currentCharacter = character()
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter, reload)
    apps.push(app)

    await coordinator.runPreview("equip", "item:blade")
    await coordinator.handleWorkspaceMutation(mutationEvent(["save/playthrough/runtime.json"]))

    expect(coordinator.preview.value?.slot.afterRef).toBe("item:blade")
    expect(reload).not.toHaveBeenCalled()
  })

  it.each([
    "save/entities/character/other.json",
    "save/entities/container/foreign-root.json",
  ])("invalidates an accepted preview when an ownership dependency changes at %s", async (path) => {
    const runAction = vi.fn(async (_actionId: string, input: JsonValue) => output(input)) as TsianApi["card"]["runAction"]
    const reload = vi.fn(async () => {})
    const currentCharacter = character()
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter, reload)
    apps.push(app)

    await coordinator.runPreview("equip", "item:blade")
    await coordinator.handleWorkspaceMutation(mutationEvent([path]))

    expect(coordinator.preview.value).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(coordinator.errorMessage.value).toBe("角色或物品状态已变化，请重新预览。")
  })

  it("discards candidate discovery when a dependency mutates before the initial traversal finishes", async () => {
    const pendingContainer = deferred<Awaited<ReturnType<TsianApi["workspace"]["read"]>>>()
    const read = vi.fn((input: { path?: string }) => {
      if (input.path === "save/entities/container/root.json") return pendingContainer.promise
      return Promise.resolve(null)
    }) as TsianApi["workspace"]["read"]
    const runAction = vi.fn(async (_actionId: string, input: JsonValue) => output(input)) as TsianApi["card"]["runAction"]
    const reload = vi.fn(async () => {})
    const currentCharacter = character(null, ["container:root"])
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction, read), () => currentCharacter, reload)
    apps.push(app)

    expect(coordinator.candidatesLoading.value).toBe(true)
    const mutation = coordinator.handleWorkspaceMutation(mutationEvent(["save/entities/item/blade.json"]))
    pendingContainer.resolve(null)
    await mutation
    await flush()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(coordinator.errorMessage.value).toBe("角色或物品状态已变化，请重新预览。")
  })

  it("invalidates an accepted preview on an external relevant mutation and reloads authoritative state", async () => {
    const runAction = vi.fn(async (_actionId: string, input: JsonValue) => output(input)) as TsianApi["card"]["runAction"]
    const reload = vi.fn(async () => {})
    const currentCharacter = character()
    const { app, coordinator } = mountCoordinator(fakeTsian(runAction), () => currentCharacter, reload)
    apps.push(app)

    await coordinator.runPreview("equip", "item:blade")
    expect(coordinator.preview.value).not.toBeNull()
    await coordinator.handleWorkspaceMutation(mutationEvent())
    await flush()

    expect(coordinator.preview.value).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(coordinator.errorMessage.value).toBe("角色或物品状态已变化，请重新预览。")
  })
})
