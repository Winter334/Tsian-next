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

    <!-- 未加载游戏卡引导 -->
    <div
      v-else-if="phase === 'no-card-guide'"
      class="absolute inset-0 grid place-items-center bg-void px-6"
      role="alert"
    >
      <section class="w-full max-w-md border border-neon-muted/40 bg-panel/90 p-5 text-center">
        <FolderOpen class="mx-auto h-8 w-8 text-neon-muted" aria-hidden="true" />
        <p class="mt-3 font-mono text-[11px] uppercase tracking-[0.22em] text-warning">
          未加载游戏卡
        </p>
        <p class="mt-3 text-sm leading-7 text-text-dim">
          开始游戏需要先创建、导入或加载一张游戏卡。
        </p>
        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            @click="goToLibrary"
          >
            <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
            去我的应用
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
            @click="goToMarket"
          >
            <Store class="h-3.5 w-3.5" aria-hidden="true" />
            去创意工坊
          </button>
        </div>
      </section>
    </div>

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

    <!-- 前端重建中提示（助手改了 frontend/src，平台正在重建） -->
    <div
      v-if="isRebuilding && (phase === 'remote-ready' || phase === 'packaged-ready')"
      class="pointer-events-none absolute bottom-3 right-3 z-20 border border-neon-muted/30 bg-panel/90 px-3 py-1.5"
      role="status"
      aria-live="polite"
    >
      <p class="font-mono text-[10px] uppercase tracking-[0.2em] text-neon-muted">
        前端重建中…
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { useRouter } from "vue-router"
import { ArrowLeft, FolderOpen, MonitorOff, Settings, Store } from "lucide-vue-next"
import { mountRemoteIframeFrontend } from "@/bridge"
import GameLauncherPanel from "@/components/play/GameLauncherPanel.vue"
import { usePlayController } from "@/controllers/play/use-play-controller"

// 桌面窗口透传:窗口最小化时为 true。全局 keydown 监听据此守卫,
// 避免隐藏的游戏窗口拦截 Escape 把不可见的 iframe 退回启动器。
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
      onLoad: request.onLoad,
      onError: request.onError,
    })
  },
})

function goToLibrary() {
  void router.push("/library")
}

function goToMarket() {
  void router.push("/market")
}

function goToCardDetail() {
  if (activeCard.value) {
    void router.push({ name: "game-card-detail", params: { cardId: activeCard.value.id } })
  } else {
    goToLibrary()
  }
}
</script>
