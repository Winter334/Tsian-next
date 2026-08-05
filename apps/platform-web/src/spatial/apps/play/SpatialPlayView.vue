<template>
  <section class="spatial-app spatial-play" aria-label="游戏前端">
    <div ref="frontendMount" class="spatial-play__frontend" />

    <div
      v-if="phase === 'resolving' || phase === 'remote-loading' || phase === 'packaged-loading'"
      class="spatial-play__overlay spatial-play__loading"
      role="status"
    >
      <Gamepad2 aria-hidden="true" />
      <strong>{{ loadingLabel }}</strong>
      <span>正在准备同一个游戏前端实例。</span>
    </div>

    <SpatialGameLauncherPanel
      v-else-if="phase === 'launcher' && activeCard && activeGameCardId"
      class="spatial-play__overlay"
      :card="activeCard"
      :saves="saves"
      :active-save-id="activeSaveId"
      :is-loaded-card="activeCard.id === activeGameCardId"
      @continue="onContinue"
      @changed="refreshSaves"
    />

    <div v-else-if="phase === 'no-card-guide'" class="spatial-play__overlay spatial-play__guide" role="alert">
      <FolderOpen aria-hidden="true" />
      <div><span class="spatial-app__eyebrow">NO ACTIVE GAME CARD</span><h2>先加载一张游戏卡</h2></div>
      <p>开始游戏需要一张已创建、导入或安装的游戏卡。</p>
      <div class="spatial-app__actions">
        <SpatialActionButton variant="primary" @click="goToLibrary"><template #icon><FolderOpen /></template>去我的应用</SpatialActionButton>
        <SpatialActionButton @click="goToMarket"><template #icon><Store /></template>去创意工坊</SpatialActionButton>
      </div>
    </div>

    <div v-else-if="phase === 'unplayable-guide'" class="spatial-play__overlay spatial-play__guide" role="alert">
      <MonitorOff aria-hidden="true" />
      <div><span class="spatial-app__eyebrow">FRONTEND REQUIRED</span><h2>游戏前端未配置</h2></div>
      <p>游戏卡「{{ activeCardName }}」还没有可游玩的远程或打包前端。</p>
      <div class="spatial-app__actions">
        <SpatialActionButton variant="primary" @click="goToLibrary"><template #icon><FolderOpen /></template>去我的应用换卡</SpatialActionButton>
        <SpatialActionButton v-if="activeCard" @click="goToCardDetail"><template #icon><Settings /></template>配置前端</SpatialActionButton>
      </div>
    </div>

    <div v-if="phase === 'error'" class="spatial-play__overlay spatial-play__guide" role="alert">
      <CircleAlert aria-hidden="true" />
      <div><span class="spatial-app__eyebrow">PLAY ERROR</span><h2>{{ errorTitle }}</h2></div>
      <p>{{ errorMessage }}</p>
      <SpatialActionButton variant="primary" @click="returnToLauncher"><template #icon><ArrowLeft /></template>返回启动器</SpatialActionButton>
    </div>

    <div v-if="isReady" class="spatial-play__ready-bar">
      <SpatialActionButton @click="returnToLauncher"><template #icon><ArrowLeft /></template>返回启动器</SpatialActionButton>
      <span>曲面预览 · 使用标题栏最大化进入原生全屏</span>
    </div>

    <div v-if="isRebuilding && isReady" class="spatial-play__rebuilding" role="status" aria-live="polite">
      前端重建中…
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { ArrowLeft, CircleAlert, FolderOpen, Gamepad2, MonitorOff, Settings, Store } from "lucide-vue-next"
import { mountRemoteIframeFrontend } from "@/bridge"
import { usePlayController } from "@/controllers/play/use-play-controller"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialGameLauncherPanel from "./SpatialGameLauncherPanel.vue"
import "../spatial-apps.css"

const props = defineProps<{ minimized?: boolean }>()
const router = useRouter()
const frontendMount = ref<HTMLElement | null>(null)

const {
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
  refreshSaves,
  continueSave: onContinue,
  returnToLauncher,
} = usePlayController({
  minimized: () => props.minimized,
  isFrontendMountAvailable: () => frontendMount.value !== null,
  mountFrontend(request) {
    if (!frontendMount.value) return null
    return mountRemoteIframeFrontend(frontendMount.value, {
      url: request.url,
      bridge: request.bridge,
      gameCardId: request.gameCardId,
      ...(request.sandbox ? { sandbox: request.sandbox } : {}),
      title: request.title,
      onLoad() {
        markFrontendReady(true)
        request.onLoad()
      },
      onError(message) {
        markFrontendReady(false)
        request.onError(message)
      },
    })
  },
})

const isReady = computed(() => phase.value === "remote-ready" || phase.value === "packaged-ready")

watch(isReady, (ready) => markFrontendReady(ready), { flush: "post" })

function markFrontendReady(ready: boolean): void {
  const iframe = frontendMount.value?.querySelector("iframe")
  if (!iframe) return
  if (ready) iframe.dataset.spatialPlayReady = "true"
  else delete iframe.dataset.spatialPlayReady
}

function goToLibrary(): void {
  void router.push("/library")
}

function goToMarket(): void {
  void router.push("/market")
}

function goToCardDetail(): void {
  if (activeCard.value) {
    void router.push({ name: "game-card-detail", params: { cardId: activeCard.value.id } })
  } else {
    goToLibrary()
  }
}
</script>
