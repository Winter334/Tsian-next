<template>
  <div class="relative h-full min-h-0 overflow-hidden bg-void text-text-main">
    <!-- 前端挂载点（playing 态可见） -->
    <div ref="frontendMount" class="h-full min-h-0 w-full"></div>

    <!-- resolving 覆盖层 -->
    <div
      v-if="phase === 'resolving' || phase === 'remote-loading' || phase === 'packaged-loading'"
      class="absolute inset-0 grid place-items-center bg-void/90 px-6"
    >
      <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
        {{ loadingLabel }}
      </p>
    </div>

    <!-- 启动器面板（launcher 态） -->
    <GameLauncherPanel
      v-else-if="phase === 'launcher' && activeCard && activeGameCardId"
      class="absolute inset-0 z-10"
      :card="activeCard"
      :saves="saves"
      :active-save-id="activeSaveId"
      :is-loaded-card="activeCard.id === activeGameCardId"
      @continue="onContinue"
      @changed="refreshSaves"
    />

    <!-- 无可玩前端引导 -->
    <div
      v-else-if="phase === 'unplayable-guide'"
      class="absolute inset-0 grid place-items-center bg-void px-6"
      role="alert"
    >
      <section class="w-full max-w-md border border-neon-muted/40 bg-panel/90 p-5 text-center">
        <MonitorOff class="mx-auto h-8 w-8 text-neon-muted" aria-hidden="true" />
        <p class="mt-3 font-mono text-[11px] uppercase tracking-[0.22em] text-warning">
          游戏前端未配置
        </p>
        <p class="mt-3 text-sm leading-7 text-text-dim">
          当前游戏卡「{{ activeCardName }}」还没有可游玩的前端。换一张卡，或为这张卡配置前端。
        </p>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            @click="goToLibrary"
          >
            <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
            去我的应用换卡
          </button>
          <button
            v-if="activeCard"
            type="button"
            class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            @click="goToCardDetail"
          >
            <Settings class="h-3.5 w-3.5" aria-hidden="true" />
            去应用属性配前端
          </button>
        </div>
      </section>
    </div>

    <!-- 前端加载错误覆盖层 -->
    <div
      v-if="phase === 'error'"
      class="absolute inset-0 grid place-items-center bg-void px-6"
      role="alert"
    >
      <section class="w-full max-w-xl border border-neon-muted/40 bg-panel/90 p-5">
        <p class="font-mono text-[11px] uppercase tracking-[0.22em] text-warning">
          {{ errorTitle }}
        </p>
        <p class="mt-3 text-sm leading-7 text-text-dim">
          {{ errorMessage }}
        </p>
        <button
          type="button"
          class="retro-button retro-focus mt-4 inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="returnToLauncher"
        >
          <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />
          返回启动器
        </button>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GameCardFrontendBinding } from "@tsian/contracts"
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { ArrowLeft, FolderOpen, MonitorOff, Settings } from "lucide-vue-next"
import GameLauncherPanel from "@/components/play/GameLauncherPanel.vue"
import { toast } from "@/composables/useToast"

// 桌面窗口透传:窗口最小化时为 true。全局 keydown 监听据此守卫,
// 避免隐藏的游戏窗口拦截 Escape 把不可见的 iframe 退回启动器。
const props = defineProps<{ minimized?: boolean }>()
import {
  ACTIVE_CARD_CHANGED_EVENT,
  SAVES_CHANGED_EVENT,
  isActiveCardChangedEvent,
  isSavesChangedEvent,
} from "@/lib/platform-events"
import {
  mountRemoteIframeFrontend,
  resolveRemoteFrontendUrl,
} from "../bridge"
import { resolvePackagedFrontendUrl } from "../package-loader/packaged-frontend"
import {
  getPlatformActiveGameCard,
  getPlatformActiveGameCardId,
  getPlatformActiveSaveId,
  listPlatformSaves,
  playFrontendBridge,
  selectPlatformSave,
  waitForPlatformHostReady,
} from "../platform-host"
import type { LocalGameCardRecord, LocalSaveRecord } from "../storage/db"
import { hasPlayableFrontend } from "@/lib/game-card-display"

type PlayPhase =
  | "resolving"
  | "launcher"
  | "unplayable-guide"
  | "remote-loading"
  | "remote-ready"
  | "packaged-loading"
  | "packaged-ready"
  | "error"

const router = useRouter()
const frontendMount = ref<HTMLElement | null>(null)
const phase = ref<PlayPhase>("resolving")
const errorTitle = ref("")
const errorMessage = ref("")
const activeCard = ref<LocalGameCardRecord | null>(null)
const activeGameCardId = ref("")
const activeSaveId = ref("")
const saves = ref<LocalSaveRecord[]>([])
const packagedFrontendSandbox = "allow-scripts allow-same-origin allow-forms"

let disposeFrontend: (() => void) | null = null
let isDisposed = false
let mountVersion = 0

const activeCardName = computed(() => activeCard.value?.manifest.name ?? "")
const loadingLabel = computed(() =>
  phase.value === "packaged-loading"
    ? "正在加载打包前端"
    : phase.value === "remote-loading"
    ? "正在加载远程前端"
    : "正在解析前端",
)

function unmountFrontend() {
  disposeFrontend?.()
  disposeFrontend = null
}

function setError(title: string, message: string) {
  unmountFrontend()
  phase.value = "error"
  errorTitle.value = title
  errorMessage.value = message
}

function setMissingFrontendError(cardName: string | undefined) {
  setError(
    "游戏前端未配置",
    cardName
      ? `游戏卡「${cardName}」尚未配置远程或打包前端。`
      : "当前没有可用的游戏卡前端。请先导入或创建带远程/打包前端的游戏卡。",
  )
}

function mountRemoteFrontend(
  frontend: GameCardFrontendBinding & { kind: "remote" },
  title: string | undefined,
  version: number,
) {
  const resolvedUrl = resolveRemoteFrontendUrl(frontend.url)
  if (!resolvedUrl.ok) {
    setError("远程前端被拒绝", resolvedUrl.error.message)
    return
  }

  if (!frontendMount.value) {
    setError("前端挂载失败", "游戏前端挂载点不可用。")
    return
  }

  phase.value = "remote-loading"
  disposeFrontend = mountRemoteIframeFrontend(frontendMount.value, {
    url: resolvedUrl.url,
    bridge: playFrontendBridge,
    title,
    onLoad() {
      if (!isDisposed && mountVersion === version) {
        phase.value = "remote-ready"
      }
    },
    onError(message) {
      if (!isDisposed && mountVersion === version) {
        setError("远程前端加载失败", message)
      }
    },
  })
}

async function mountPackagedFrontend(
  frontend: GameCardFrontendBinding & { kind: "packaged" },
  cardId: string,
  title: string | undefined,
  version: number,
) {
  if (!frontendMount.value) {
    setError("前端挂载失败", "游戏前端挂载点不可用。")
    return
  }

  phase.value = "packaged-loading"
  const url = await resolvePackagedFrontendUrl({
    gameCardId: cardId,
    entry: frontend.entry,
  })
  if (isDisposed || mountVersion !== version || !frontendMount.value) {
    return
  }

  disposeFrontend = mountRemoteIframeFrontend(frontendMount.value, {
    url,
    bridge: playFrontendBridge,
    // Service Worker-backed virtual URLs need a same-origin controlled iframe client.
    sandbox: packagedFrontendSandbox,
    title,
    onLoad() {
      if (!isDisposed && mountVersion === version) {
        phase.value = "packaged-ready"
      }
    },
    onError(message) {
      if (!isDisposed && mountVersion === version) {
        setError("打包前端加载失败", message)
      }
    },
  })
}

/** 挂载 active card 的前端。仅在选定存档后调用。 */
async function mountActiveFrontend() {
  const version = ++mountVersion
  unmountFrontend()
  phase.value = "resolving"
  errorTitle.value = ""
  errorMessage.value = ""

  try {
    await waitForPlatformHostReady()
    if (isDisposed || mountVersion !== version) {
      return
    }

    const activeCardRecord = await getPlatformActiveGameCard()
    if (isDisposed || mountVersion !== version) {
      return
    }

    const frontend = activeCardRecord?.manifest.frontend
    if (!frontend) {
      setMissingFrontendError(activeCardRecord?.manifest.name)
      return
    }

    if (frontend.kind === "remote") {
      mountRemoteFrontend(frontend, activeCardRecord?.manifest.name, version)
      return
    }

    if (frontend.kind === "packaged") {
      if (!activeCardRecord) {
        setMissingFrontendError(undefined)
        return
      }
      await mountPackagedFrontend(frontend, activeCardRecord.id, activeCardRecord.manifest.name, version)
      return
    }

    setError(
      "不支持的游戏前端",
      `当前游戏前端类型不受支持：${String((frontend as { kind?: unknown }).kind)}`,
    )
  } catch (error) {
    if (!isDisposed && mountVersion !== version) {
      setError(
        "前端解析失败",
        error instanceof Error ? error.message : "解析游戏前端失败。",
      )
    }
  }
}

/** 进入启动器：解析 active card，分流到 launcher 或 unplayable-guide。 */
async function enterLauncher() {
  phase.value = "resolving"
  try {
    await waitForPlatformHostReady()
    if (isDisposed) {
      return
    }

    const [card, cardId, saveId, allSaves] = await Promise.all([
      getPlatformActiveGameCard(),
      getPlatformActiveGameCardId(),
      getPlatformActiveSaveId(),
      listPlatformSaves(),
    ])

    if (isDisposed) {
      return
    }

    activeCard.value = card
    activeGameCardId.value = cardId
    activeSaveId.value = saveId ?? ""
    saves.value = allSaves

    if (!card) {
      setError("无可用游戏卡", "当前没有可用的游戏卡，请先导入或创建一张。")
      return
    }

    if (!hasPlayableFrontend(card)) {
      phase.value = "unplayable-guide"
      return
    }

    phase.value = "launcher"
  } catch (error) {
    setError(
      "启动器初始化失败",
      error instanceof Error ? error.message : "无法加载游戏启动器。",
    )
  }
}

async function refreshSaves() {
  const [saveId, allSaves] = await Promise.all([
    getPlatformActiveSaveId(),
    listPlatformSaves(),
  ])
  activeSaveId.value = saveId ?? ""
  saves.value = allSaves
}

async function onContinue(saveId: string) {
  try {
    await selectPlatformSave(saveId)
    await mountActiveFrontend()
  } catch (error) {
    setError(
      "切换存档失败",
      error instanceof Error ? error.message : "无法切换到该存档。",
    )
  }
}

function returnToLauncher() {
  mountVersion += 1
  unmountFrontend()
  void nextTick(() => enterLauncher())
}

function goToLibrary() {
  void router.push("/library")
}

function goToCardDetail() {
  if (activeCard.value) {
    void router.push({ name: "game-card-detail", params: { cardId: activeCard.value.id } })
  } else {
    goToLibrary()
  }
}

function onSavesChanged(event: Event) {
  if (!isSavesChangedEvent(event)) {
    return
  }
  // launcher 态刷新存档列表；playing 态不打断游玩，仅更新缓存
  if (phase.value === "launcher") {
    void refreshSaves()
  }
}

function onActiveCardChanged(event: Event) {
  if (!isActiveCardChangedEvent(event)) {
    return
  }
  // launcher 态重新解析（卡可能被换）；playing 态不打断
  if (phase.value === "launcher" || phase.value === "unplayable-guide") {
    void enterLauncher()
  }
}

function onKeydown(event: KeyboardEvent) {
  if (props.minimized) {
    return
  }
  if (event.key === "Escape" && (phase.value === "remote-ready" || phase.value === "packaged-ready")) {
    returnToLauncher()
  }
}

onMounted(() => {
  window.addEventListener(SAVES_CHANGED_EVENT, onSavesChanged)
  window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  window.addEventListener("keydown", onKeydown)
  void enterLauncher()
})

onBeforeUnmount(() => {
  isDisposed = true
  mountVersion += 1
  unmountFrontend()
  window.removeEventListener(SAVES_CHANGED_EVENT, onSavesChanged)
  window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  window.removeEventListener("keydown", onKeydown)
})
</script>
