// @vitest-environment happy-dom

import { createApp, nextTick, ref, type App } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"
import type {
  GameLauncherControllerOptions,
  SaveBackupDownload,
} from "./use-game-launcher-controller"
import type {
  PlayControllerOptions,
  PlayFrontendMountRequest,
} from "./use-play-controller"

const integration = vi.hoisted(() => ({
  playOptions: null as PlayControllerOptions | null,
  launcherOptions: null as GameLauncherControllerOptions | null,
  playController: null as object | null,
  launcherController: null as object | null,
  mountRemoteIframeFrontend: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock("@/controllers/play/use-play-controller", () => ({
  usePlayController(options: PlayControllerOptions) {
    integration.playOptions = options
    return integration.playController
  },
}))
vi.mock("@/controllers/play/use-game-launcher-controller", () => ({
  useGameLauncherController(options: GameLauncherControllerOptions) {
    integration.launcherOptions = options
    return integration.launcherController
  },
}))
vi.mock("@/bridge", () => ({
  mountRemoteIframeFrontend: integration.mountRemoteIframeFrontend,
}))
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: integration.routerPush }),
}))

import GameLauncherPanel from "@/components/play/GameLauncherPanel.vue"
import PlayView from "@/views/PlayView.vue"

const mountedApps: Array<{ app: App; host: HTMLElement }> = []

function gameCard(): LocalGameCardRecord {
  return {
    id: "card-row",
    source: "local",
    manifest: {
      schema: "tsian.game-card.v1",
      id: "card",
      name: "测试卡",
      version: "1.0.0",
      summary: "summary",
      frontend: {
        kind: "remote",
        url: "https://game.example/",
        bridgeVersion: "tsian.play-bridge.v1",
      },
      runtime: { entrypoints: { playerTurn: "agent" } },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function save(): LocalSaveRecord {
  return {
    id: "save",
    name: "存档",
    gameCardId: "card",
    gameCardVersion: "1.0.0",
    createdAt: 1,
    updatedAt: 1,
  }
}

function mount(component: Parameters<typeof createApp>[0], props: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(component, props)
  app.mount(host)
  mountedApps.push({ app, host })
  return host
}

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...host.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.includes(text))
}

describe("Retro Play controller integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    integration.playOptions = null
    integration.launcherOptions = null
  })

  afterEach(() => {
    for (const { app, host } of mountedApps.splice(0)) {
      app.unmount()
      host.remove()
    }
    document.body.replaceChildren()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("keeps iframe DOM attachment and route navigation in PlayView", async () => {
    const phase = ref("remote-ready")
    integration.playController = {
      phase,
      errorTitle: ref(""),
      errorMessage: ref(""),
      activeCard: ref(gameCard()),
      activeGameCardId: ref("card-row"),
      activeSaveId: ref("save"),
      activeCardName: ref("测试卡"),
      saves: ref([save()]),
      loadingLabel: ref("正在解析前端"),
      isRebuilding: ref(false),
      refreshSaves: vi.fn(),
      continueSave: vi.fn(),
      returnToLauncher: vi.fn(),
    }
    const mounted = { dispose: vi.fn() }
    integration.mountRemoteIframeFrontend.mockReturnValue(mounted)
    const host = mount(PlayView, { minimized: false })
    const options = integration.playOptions!
    const request: PlayFrontendMountRequest = {
      kind: "remote",
      url: "https://game.example/",
      bridge: {} as PlayFrontendMountRequest["bridge"],
      gameCardId: "card-row",
      title: "测试卡",
      onLoad: vi.fn(),
      onError: vi.fn(),
    }

    expect(options.isFrontendMountAvailable()).toBe(true)
    expect(options.mountFrontend(request)).toBe(mounted)
    expect(integration.mountRemoteIframeFrontend).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        url: request.url,
        bridge: request.bridge,
        gameCardId: "card-row",
        onLoad: request.onLoad,
        onError: request.onError,
      }),
    )

    phase.value = "no-card-guide"
    await nextTick()
    buttonByText(host, "去我的应用")?.click()
    buttonByText(host, "去创意工坊")?.click()
    expect(integration.routerPush).toHaveBeenNthCalledWith(1, "/library")
    expect(integration.routerPush).toHaveBeenNthCalledWith(2, "/market")
  })

  it("keeps trusted file selection, download DOM cleanup, and component emits in GameLauncherPanel", async () => {
    vi.useFakeTimers()
    const targetSave = save()
    const importSave = vi.fn()
    const startCreate = vi.fn()
    integration.launcherController = {
      busy: ref(false),
      creating: ref(false),
      createName: ref(""),
      renamingId: ref(""),
      renameName: ref(""),
      cardSaves: ref([targetSave]),
      cardTitle: ref("测试卡"),
      coverUrl: ref(null),
      defaultNewName: ref("测试卡 存档 2"),
      saveNeedsVersionConfirmation: vi.fn(() => false),
      requestContinue: vi.fn(),
      startCreate,
      cancelCreate: vi.fn(),
      confirmCreate: vi.fn(),
      startRename: vi.fn(),
      cancelRename: vi.fn(),
      confirmRename: vi.fn(),
      backupToCloud: vi.fn(),
      exportSave: vi.fn(),
      importSave,
      syncFromCloud: vi.fn(),
      requestDelete: vi.fn(),
    }
    const onContinue = vi.fn()
    const onChanged = vi.fn()
    const host = mount(GameLauncherPanel, {
      card: gameCard(),
      saves: [targetSave],
      activeSaveId: "save",
      isLoadedCard: true,
      onContinue,
      onChanged,
    })
    const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
    const inputClick = vi.spyOn(input, "click")

    buttonByText(host, "导入")?.click()
    expect(inputClick).toHaveBeenCalledTimes(1)
    const file = new File(["zip"], "save.zip", { type: "application/zip" })
    Object.defineProperty(input, "files", { configurable: true, value: [file] })
    input.dispatchEvent(new Event("change", { bubbles: true }))
    await Promise.resolve()
    expect(importSave).toHaveBeenCalledWith(file)

    buttonByText(host, "新建存档")?.click()
    expect(startCreate).toHaveBeenCalledTimes(1)
    integration.launcherOptions?.onContinue("save")
    integration.launcherOptions?.onChanged()
    expect(onContinue).toHaveBeenCalledWith("save")
    expect(onChanged).toHaveBeenCalledTimes(1)

    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download")
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)
    const download: SaveBackupDownload = {
      blob: new Blob(["backup"]),
      filename: "save.tsian-save.zip",
    }
    integration.launcherOptions?.downloadBackup(download)

    expect(createObjectUrl).toHaveBeenCalledWith(download.blob)
    expect(anchorClick).toHaveBeenCalledTimes(1)
    vi.runAllTimers()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:download")

    createObjectUrl.mockReturnValueOnce("blob:failed-download")
    anchorClick.mockImplementationOnce(() => { throw new Error("activation failed") })
    expect(() => integration.launcherOptions?.downloadBackup(download)).toThrow("activation failed")
    expect(document.body.querySelector("a")).toBeNull()
    vi.runAllTimers()
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:failed-download")
  })
})
