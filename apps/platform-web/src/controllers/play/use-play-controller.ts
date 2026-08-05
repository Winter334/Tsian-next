import type {
  GameCardFrontendBinding,
  PlayFrontendBridge,
} from "@tsian/contracts"
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  type MaybeRefOrGetter,
} from "vue"
import {
  registerPlayFrontendTarget,
  resolveRemoteFrontendUrl,
  type MountedRemoteIframeFrontend,
} from "@/bridge"
import { hasPlayableFrontend } from "@/lib/game-card-display"
import {
  ACTIVE_CARD_CHANGED_EVENT,
  FRONTEND_REBUILDING_EVENT,
  FRONTEND_REBUILD_SETTLED_EVENT,
  FRONTEND_RELOAD_EVENT,
  SAVES_CHANGED_EVENT,
  isActiveCardChangedEvent,
  isFrontendRebuildingEvent,
  isFrontendRebuildSettledEvent,
  isFrontendReloadEvent,
  isSavesChangedEvent,
} from "@/lib/platform-events"
import { resolvePackagedFrontendUrl } from "@/package-loader/packaged-frontend"
import {
  getPlatformActiveGameCard,
  getPlatformActiveGameCardId,
  getPlatformActiveSaveId,
  listPlatformSaves,
  playFrontendBridge,
  selectPlatformSave,
  waitForPlatformHostReady,
} from "@/platform-host"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"

export type PlayPhase =
  | "resolving"
  | "launcher"
  | "no-card-guide"
  | "unplayable-guide"
  | "remote-loading"
  | "remote-ready"
  | "packaged-loading"
  | "packaged-ready"
  | "error"

export interface PlayFrontendMountRequest {
  kind: "remote" | "packaged"
  url: string
  bridge: PlayFrontendBridge
  gameCardId: string
  entry?: string
  sandbox?: string
  title?: string
  onLoad(): void
  onError(message: string): void
}

export interface PlayControllerOptions {
  minimized?: MaybeRefOrGetter<boolean | undefined>
  isFrontendMountAvailable(): boolean
  mountFrontend(request: PlayFrontendMountRequest): MountedRemoteIframeFrontend | null
}

const PACKAGED_FRONTEND_SANDBOX = "allow-scripts allow-same-origin allow-forms"

/** Per-mounted-Play-window runtime controller. DOM attachment stays in the presentation. */
export function usePlayController(options: PlayControllerOptions) {
  const phase = ref<PlayPhase>("resolving")
  const errorTitle = ref("")
  const errorMessage = ref("")
  const activeCard = ref<LocalGameCardRecord | null>(null)
  const activeGameCardId = ref("")
  const activeSaveId = ref("")
  const saves = ref<LocalSaveRecord[]>([])
  const isRebuilding = ref(false)

  let frontendHandle: MountedRemoteIframeFrontend | null = null
  let unregisterFrontendTarget: (() => void) | null = null
  let disposed = false
  let started = false
  let continuing = false
  let mountGeneration = 0
  let launcherGeneration = 0
  let savesGeneration = 0

  const activeCardName = computed(() => activeCard.value?.manifest.name ?? "")
  const loadingLabel = computed(() =>
    phase.value === "packaged-loading"
      ? "正在加载打包前端"
      : phase.value === "remote-loading"
        ? "正在加载远程前端"
        : "正在解析前端",
  )

  function isCurrentMount(generation: number): boolean {
    return !disposed && mountGeneration === generation
  }

  function isCurrentLauncherRequest(generation: number): boolean {
    return !disposed && launcherGeneration === generation
  }

  function unmountFrontend(): void {
    unregisterFrontendTarget?.()
    unregisterFrontendTarget = null
    frontendHandle?.dispose()
    frontendHandle = null
  }

  function setError(title: string, message: string): void {
    mountGeneration += 1
    unmountFrontend()
    phase.value = "error"
    errorTitle.value = title
    errorMessage.value = message
  }

  function setMissingFrontendError(cardName: string | undefined): void {
    setError(
      "游戏前端未配置",
      cardName
        ? `游戏卡「${cardName}」尚未配置远程或打包前端。`
        : "当前没有可用的游戏卡前端。请先导入或创建带远程/打包前端的游戏卡。",
    )
  }

  function installFrontend(
    input: {
      kind: "remote" | "packaged"
      url: string
      cardId: string
      title: string | undefined
      entry?: string
      sandbox?: string
      readyPhase: Extract<PlayPhase, "remote-ready" | "packaged-ready">
      loadingPhase: Extract<PlayPhase, "remote-loading" | "packaged-loading">
      errorTitle: string
    },
    generation: number,
  ): void {
    if (!isCurrentMount(generation)) return
    if (!options.isFrontendMountAvailable()) {
      setError("前端挂载失败", "游戏前端挂载点不可用。")
      return
    }

    phase.value = input.loadingPhase
    let callbackFailed = false
    const handle = options.mountFrontend({
      kind: input.kind,
      url: input.url,
      bridge: playFrontendBridge,
      gameCardId: input.cardId,
      ...(input.entry ? { entry: input.entry } : {}),
      ...(input.sandbox ? { sandbox: input.sandbox } : {}),
      title: input.title,
      onLoad() {
        if (isCurrentMount(generation)) phase.value = input.readyPhase
      },
      onError(message) {
        if (!isCurrentMount(generation)) return
        callbackFailed = true
        setError(input.errorTitle, message)
      },
    })

    if (!handle) {
      if (isCurrentMount(generation)) {
        setError("前端挂载失败", "游戏前端挂载点不可用。")
      }
      return
    }
    if (callbackFailed || !isCurrentMount(generation)) {
      handle.dispose()
      return
    }

    frontendHandle = handle
    unregisterFrontendTarget = registerPlayFrontendTarget({
      kind: input.kind,
      gameCardId: input.cardId,
      ...(input.kind === "packaged" ? { entry: input.entry ?? "" } : {}),
      mount: handle,
    })
  }

  function mountRemoteFrontend(
    frontend: GameCardFrontendBinding & { kind: "remote" },
    cardId: string,
    title: string | undefined,
    generation: number,
  ): void {
    const resolvedUrl = resolveRemoteFrontendUrl(frontend.url)
    if (!resolvedUrl.ok) {
      setError("远程前端被拒绝", resolvedUrl.error.message)
      return
    }
    installFrontend({
      kind: "remote",
      url: resolvedUrl.url,
      cardId,
      title,
      readyPhase: "remote-ready",
      loadingPhase: "remote-loading",
      errorTitle: "远程前端加载失败",
    }, generation)
  }

  async function mountPackagedFrontend(
    frontend: GameCardFrontendBinding & { kind: "packaged" },
    cardId: string,
    title: string | undefined,
    generation: number,
  ): Promise<void> {
    if (!options.isFrontendMountAvailable()) {
      setError("前端挂载失败", "游戏前端挂载点不可用。")
      return
    }
    phase.value = "packaged-loading"
    const url = await resolvePackagedFrontendUrl({
      gameCardId: cardId,
      entry: frontend.entry,
    })
    if (!isCurrentMount(generation)) return
    installFrontend({
      kind: "packaged",
      url,
      cardId,
      title,
      entry: frontend.entry,
      sandbox: PACKAGED_FRONTEND_SANDBOX,
      readyPhase: "packaged-ready",
      loadingPhase: "packaged-loading",
      errorTitle: "打包前端加载失败",
    }, generation)
  }

  async function mountActiveFrontend(): Promise<void> {
    if (disposed) return
    const generation = ++mountGeneration
    launcherGeneration += 1
    savesGeneration += 1
    unmountFrontend()
    phase.value = "resolving"
    errorTitle.value = ""
    errorMessage.value = ""

    try {
      await waitForPlatformHostReady()
      if (!isCurrentMount(generation)) return

      const activeCardRecord = await getPlatformActiveGameCard()
      if (!isCurrentMount(generation)) return

      const frontend = activeCardRecord?.manifest.frontend
      if (!frontend) {
        setMissingFrontendError(activeCardRecord?.manifest.name)
        return
      }
      if (frontend.kind === "remote") {
        mountRemoteFrontend(frontend, activeCardRecord.id, activeCardRecord.manifest.name, generation)
        return
      }
      if (frontend.kind === "packaged") {
        await mountPackagedFrontend(frontend, activeCardRecord.id, activeCardRecord.manifest.name, generation)
        return
      }

      setError(
        "不支持的游戏前端",
        `当前游戏前端类型不受支持：${String((frontend as { kind?: unknown }).kind)}`,
      )
    } catch (error) {
      if (isCurrentMount(generation)) {
        setError("前端解析失败", error instanceof Error ? error.message : "解析游戏前端失败。")
      }
    }
  }

  async function enterLauncher(): Promise<void> {
    if (disposed) return
    const generation = ++launcherGeneration
    savesGeneration += 1
    phase.value = "resolving"
    try {
      await waitForPlatformHostReady()
      if (!isCurrentLauncherRequest(generation)) return

      const [card, cardId, saveId, allSaves] = await Promise.all([
        getPlatformActiveGameCard(),
        getPlatformActiveGameCardId(),
        getPlatformActiveSaveId(),
        listPlatformSaves(),
      ])
      if (!isCurrentLauncherRequest(generation)) return

      activeCard.value = card
      activeGameCardId.value = cardId ?? ""
      activeSaveId.value = saveId ?? ""
      saves.value = allSaves

      if (!card) {
        activeCard.value = null
        activeGameCardId.value = ""
        phase.value = "no-card-guide"
        return
      }
      phase.value = hasPlayableFrontend(card) ? "launcher" : "unplayable-guide"
    } catch (error) {
      if (isCurrentLauncherRequest(generation)) {
        setError("启动器初始化失败", error instanceof Error ? error.message : "无法加载游戏启动器。")
      }
    }
  }

  async function refreshSaves(): Promise<void> {
    if (disposed) return
    const generation = ++savesGeneration
    const [saveId, allSaves] = await Promise.all([
      getPlatformActiveSaveId(),
      listPlatformSaves(),
    ])
    if (disposed || savesGeneration !== generation) return
    activeSaveId.value = saveId ?? ""
    saves.value = allSaves
  }

  async function continueSave(saveId: string): Promise<void> {
    if (continuing || disposed) return
    continuing = true
    launcherGeneration += 1
    savesGeneration += 1
    try {
      await selectPlatformSave(saveId)
      if (disposed) return
      activeSaveId.value = saveId
      await mountActiveFrontend()
    } catch (error) {
      if (!disposed) {
        setError("切换存档失败", error instanceof Error ? error.message : "无法切换到该存档。")
      }
    } finally {
      continuing = false
    }
  }

  function returnToLauncher(): void {
    if (disposed) return
    mountGeneration += 1
    launcherGeneration += 1
    savesGeneration += 1
    unmountFrontend()
    void nextTick(() => enterLauncher())
  }

  function onSavesChanged(event: Event): void {
    if (isSavesChangedEvent(event) && phase.value === "launcher" && !continuing) {
      void refreshSaves()
    }
  }

  function onActiveCardChanged(event: Event): void {
    if (!isActiveCardChangedEvent(event) || continuing) return
    if (phase.value === "launcher" || phase.value === "unplayable-guide" || phase.value === "no-card-guide") {
      void enterLauncher()
    }
  }

  function onFrontendReload(event: Event): void {
    if (!isFrontendReloadEvent(event)) return
    isRebuilding.value = false
    if (phase.value === "remote-ready" || phase.value === "packaged-ready") {
      void mountActiveFrontend()
    }
  }

  function onFrontendRebuilding(event: Event): void {
    if (isFrontendRebuildingEvent(event)) isRebuilding.value = true
  }

  function onFrontendRebuildSettled(event: Event): void {
    if (isFrontendRebuildSettledEvent(event)) isRebuilding.value = false
  }

  function onKeydown(event: KeyboardEvent): void {
    if (toValue(options.minimized) || event.key !== "Escape") return
    if (phase.value === "remote-ready" || phase.value === "packaged-ready") {
      returnToLauncher()
    }
  }

  function start(): void {
    if (started || disposed) return
    started = true
    window.addEventListener(SAVES_CHANGED_EVENT, onSavesChanged)
    window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
    window.addEventListener(FRONTEND_RELOAD_EVENT, onFrontendReload)
    window.addEventListener(FRONTEND_REBUILDING_EVENT, onFrontendRebuilding)
    window.addEventListener(FRONTEND_REBUILD_SETTLED_EVENT, onFrontendRebuildSettled)
    window.addEventListener("keydown", onKeydown)
    void enterLauncher()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    mountGeneration += 1
    launcherGeneration += 1
    savesGeneration += 1
    unmountFrontend()
    if (!started) return
    started = false
    window.removeEventListener(SAVES_CHANGED_EVENT, onSavesChanged)
    window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
    window.removeEventListener(FRONTEND_RELOAD_EVENT, onFrontendReload)
    window.removeEventListener(FRONTEND_REBUILDING_EVENT, onFrontendRebuilding)
    window.removeEventListener(FRONTEND_REBUILD_SETTLED_EVENT, onFrontendRebuildSettled)
    window.removeEventListener("keydown", onKeydown)
  }

  onMounted(start)
  onBeforeUnmount(dispose)

  return {
    phase,
    errorTitle,
    errorMessage,
    activeCard,
    activeGameCardId,
    activeSaveId,
    activeCardName,
    saves,
    loadingLabel,
    isRebuilding,
    mountActiveFrontend,
    enterLauncher,
    refreshSaves,
    continueSave,
    returnToLauncher,
    start,
    dispose,
  }
}
