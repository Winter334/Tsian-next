// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  ACTIVE_CARD_CHANGED_EVENT,
  FRONTEND_REBUILDING_EVENT,
  FRONTEND_REBUILD_SETTLED_EVENT,
  FRONTEND_RELOAD_EVENT,
  SAVES_CHANGED_EVENT,
} from "@/lib/platform-events"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"

const lifecycle = vi.hoisted(() => ({
  onMounted: vi.fn(),
  onBeforeUnmount: vi.fn(),
}))
const host = vi.hoisted(() => ({
  getPlatformActiveGameCard: vi.fn(),
  getPlatformActiveGameCardId: vi.fn(),
  getPlatformActiveSaveId: vi.fn(),
  listPlatformSaves: vi.fn(),
  playFrontendBridge: { platform: {} },
  selectPlatformSave: vi.fn(),
  waitForPlatformHostReady: vi.fn(),
}))
const bridge = vi.hoisted(() => ({
  registerPlayFrontendTarget: vi.fn(),
  resolveRemoteFrontendUrl: vi.fn(),
}))
const packaged = vi.hoisted(() => ({ resolvePackagedFrontendUrl: vi.fn() }))

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, ...lifecycle }
})
vi.mock("@/platform-host", () => host)
vi.mock("@/bridge", () => bridge)
vi.mock("@/package-loader/packaged-frontend", () => packaged)

import {
  usePlayController,
  type PlayFrontendMountRequest,
} from "./use-play-controller"

function gameCard(
  id: string,
  frontend: LocalGameCardRecord["manifest"]["frontend"],
): LocalGameCardRecord {
  return {
    id,
    source: "local",
    manifest: {
      schema: "tsian.game-card.v1",
      id,
      name: id,
      version: "1.0.0",
      summary: `${id} summary`,
      frontend,
      runtime: { entrypoints: { playerTurn: "agent" } },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function save(id: string, cardId = "card"): LocalSaveRecord {
  return {
    id,
    name: id,
    gameCardId: cardId,
    gameCardVersion: "1.0.0",
    createdAt: 1,
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function mountedHandle() {
  const dispose = vi.fn()
  return {
    iframe: document.createElement("iframe"),
    sessionId: crypto.randomUUID(),
    status: "loading" as const,
    activitySequence: 0,
    inFlightRequestCount: 0,
    lastActivityAt: null,
    subscribeStatus: vi.fn(() => vi.fn()),
    subscribeActivity: vi.fn(() => vi.fn()),
    waitForReady: vi.fn(async () => false),
    dispose,
  }
}

describe("usePlayController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    host.waitForPlatformHostReady.mockResolvedValue(undefined)
    host.getPlatformActiveGameCard.mockResolvedValue(gameCard("card", {
      kind: "remote",
      url: "https://game.example/",
      bridgeVersion: "tsian.play-bridge.v1",
    }))
    host.getPlatformActiveGameCardId.mockResolvedValue("card")
    host.getPlatformActiveSaveId.mockResolvedValue("save-1")
    host.listPlatformSaves.mockResolvedValue([save("save-1")])
    host.selectPlatformSave.mockResolvedValue(undefined)
    bridge.resolveRemoteFrontendUrl.mockImplementation((url: string) => ({ ok: true, url }))
    bridge.registerPlayFrontendTarget.mockImplementation(() => vi.fn())
    packaged.resolvePackagedFrontendUrl.mockResolvedValue("https://platform.test/packaged/index.html")
  })

  it("resolves launcher state, ignores selection echo events, registers the bridge target, and cleans up exactly once", async () => {
    const requests: PlayFrontendMountRequest[] = []
    const handles = [mountedHandle()]
    const removeListener = vi.spyOn(window, "removeEventListener")
    host.selectPlatformSave.mockImplementation(async () => {
      window.dispatchEvent(new CustomEvent(SAVES_CHANGED_EVENT))
      window.dispatchEvent(new CustomEvent(ACTIVE_CARD_CHANGED_EVENT))
    })
    const controller = usePlayController({
      minimized: false,
      isFrontendMountAvailable: () => true,
      mountFrontend(request) {
        requests.push(request)
        return handles[requests.length - 1] ?? null
      },
    })

    controller.start()
    await vi.waitFor(() => expect(controller.phase.value).toBe("launcher"))
    await controller.continueSave("save-2")

    expect(host.selectPlatformSave).toHaveBeenCalledWith("save-2")
    expect(controller.activeSaveId.value).toBe("save-2")
    expect(requests).toHaveLength(1)
    expect(requests[0]?.kind).toBe("remote")
    expect(bridge.registerPlayFrontendTarget).toHaveBeenCalledWith(expect.objectContaining({
      kind: "remote",
      gameCardId: "card",
      mount: handles[0],
    }))
    requests[0]?.onLoad()
    expect(controller.phase.value).toBe("remote-ready")

    const unregister = bridge.registerPlayFrontendTarget.mock.results[0]?.value
    controller.dispose()
    controller.dispose()

    expect(unregister).toHaveBeenCalledTimes(1)
    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith(SAVES_CHANGED_EVENT, expect.any(Function))
    expect(removeListener).toHaveBeenCalledWith("keydown", expect.any(Function))
  })

  it("drops a stale packaged URL resolution after a newer remote mount wins", async () => {
    const oldPackaged = gameCard("old", {
      kind: "packaged",
      entry: "dist/index.html",
      bridgeVersion: "tsian.play-bridge.v1",
    })
    const currentRemote = gameCard("current", {
      kind: "remote",
      url: "https://current.example/",
      bridgeVersion: "tsian.play-bridge.v1",
    })
    const packagedUrl = deferred<string>()
    host.getPlatformActiveGameCard
      .mockResolvedValueOnce(oldPackaged)
      .mockResolvedValueOnce(currentRemote)
    packaged.resolvePackagedFrontendUrl.mockReturnValueOnce(packagedUrl.promise)
    const requests: PlayFrontendMountRequest[] = []
    const controller = usePlayController({
      isFrontendMountAvailable: () => true,
      mountFrontend(request) {
        requests.push(request)
        return mountedHandle()
      },
    })

    const firstMount = controller.mountActiveFrontend()
    await vi.waitFor(() => expect(packaged.resolvePackagedFrontendUrl).toHaveBeenCalledTimes(1))
    await controller.mountActiveFrontend()
    packagedUrl.resolve("https://platform.test/stale/index.html")
    await firstMount

    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ kind: "remote", gameCardId: "current" })
    expect(controller.phase.value).toBe("remote-loading")
  })

  it("ignores callbacks from a disposed mount generation", async () => {
    host.getPlatformActiveGameCard
      .mockResolvedValueOnce(gameCard("first", {
        kind: "remote",
        url: "https://first.example/",
        bridgeVersion: "tsian.play-bridge.v1",
      }))
      .mockResolvedValueOnce(gameCard("second", {
        kind: "remote",
        url: "https://second.example/",
        bridgeVersion: "tsian.play-bridge.v1",
      }))
    const requests: PlayFrontendMountRequest[] = []
    const handles = [mountedHandle(), mountedHandle()]
    const controller = usePlayController({
      isFrontendMountAvailable: () => true,
      mountFrontend(request) {
        requests.push(request)
        return handles[requests.length - 1] ?? null
      },
    })

    await controller.mountActiveFrontend()
    await controller.mountActiveFrontend()
    requests[0]?.onLoad()
    requests[0]?.onError("stale failure")

    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1)
    expect(controller.phase.value).toBe("remote-loading")
    expect(controller.errorMessage.value).toBe("")
    requests[1]?.onLoad()
    expect(controller.phase.value).toBe("remote-ready")
  })

  it("invalidates a failed mount before any later callback can revive it", async () => {
    const requests: PlayFrontendMountRequest[] = []
    const handle = mountedHandle()
    const unregister = vi.fn()
    bridge.registerPlayFrontendTarget.mockReturnValueOnce(unregister)
    const controller = usePlayController({
      isFrontendMountAvailable: () => true,
      mountFrontend(request) {
        requests.push(request)
        return handle
      },
    })

    await controller.mountActiveFrontend()
    requests[0]?.onError("load failed")
    requests[0]?.onLoad()

    expect(controller.phase.value).toBe("error")
    expect(controller.errorMessage.value).toBe("load failed")
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(handle.dispose).toHaveBeenCalledTimes(1)
    controller.dispose()
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(handle.dispose).toHaveBeenCalledTimes(1)
  })

  it("honors rebuild events and only lets a visible ready Play window consume Escape", async () => {
    let minimized = true
    const request: PlayFrontendMountRequest[] = []
    const handles = [mountedHandle(), mountedHandle()]
    const controller = usePlayController({
      minimized: () => minimized,
      isFrontendMountAvailable: () => true,
      mountFrontend(input) {
        request.push(input)
        return handles[request.length - 1] ?? null
      },
    })
    controller.start()
    await vi.waitFor(() => expect(controller.phase.value).toBe("launcher"))
    await controller.continueSave("save-1")
    request[0]?.onLoad()

    window.dispatchEvent(new CustomEvent(FRONTEND_REBUILDING_EVENT))
    expect(controller.isRebuilding.value).toBe(true)
    window.dispatchEvent(new CustomEvent(FRONTEND_REBUILD_SETTLED_EVENT))
    expect(controller.isRebuilding.value).toBe(false)
    window.dispatchEvent(new CustomEvent(FRONTEND_REBUILDING_EVENT))
    window.dispatchEvent(new CustomEvent(FRONTEND_RELOAD_EVENT))
    await vi.waitFor(() => expect(request).toHaveLength(2))
    expect(controller.isRebuilding.value).toBe(false)
    expect(handles[0]?.dispose).toHaveBeenCalledTimes(1)
    request[1]?.onLoad()

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(handles[1]?.dispose).not.toHaveBeenCalled()
    minimized = false
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    await vi.waitFor(() => expect(controller.phase.value).toBe("launcher"))
    expect(handles[1]?.dispose).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
})
