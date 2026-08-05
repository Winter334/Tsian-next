<template>
  <div class="grid min-h-dvh w-full overflow-hidden bg-void">
    <div
      v-if="shellMode === 'booting'"
      class="platform-neutral-boot col-start-1 row-start-1 z-10"
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true" />
      <p>正在初始化平台…</p>
    </div>

    <DesktopShell
      v-else-if="shellMode === 'retro'"
      class="col-start-1 row-start-1 z-10 min-h-0"
    />

    <component
      :is="spatialShellComponent"
      v-else-if="shellMode === 'spatial' && spatialShellComponent"
      class="col-start-1 row-start-1 z-10 min-h-0"
      @fallback="handleSpatialFallback"
    />

    <p v-if="fallbackMessage" class="platform-shell-fallback" role="status">
      {{ fallbackMessage }}
    </p>

    <Transition name="splash-fade">
      <SplashScreen
        v-if="shellMode === 'retro' && showSplash"
        class="col-start-1 row-start-1 z-50"
        @exit="finishSplash"
      />
    </Transition>

    <ToastHost v-if="shellMode === 'retro'" />
    <ConfirmHost v-if="shellMode === 'retro'" />
    <FloatingWindow v-if="shellMode === 'retro'" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, type Component } from "vue"
import DesktopShell from "./components/desktop/DesktopShell.vue"
import FloatingWindow from "./components/feedback/FloatingWindow.vue"
import SplashScreen from "./components/SplashScreen.vue"
import ToastHost from "./components/feedback/ToastHost.vue"
import ConfirmHost from "./components/feedback/ConfirmHost.vue"
import { initializePlatformHost, refreshWorkshopGameCardUpdates, WORKSHOP_GAME_CARD_UPDATE_RESUME_INTERVAL_MS, workshopGameCardUpdatesLastSuccessfulCheckAt } from "./platform-host"
import { cleanupOrphanAttachments } from "./storage"
import { getPlatformConfig, preheatPlatformConfig } from "./config/platform-config"
import {
  currentUiModeEnvironment,
  resolveUiMode,
  SPATIAL_RELEASE_READY,
  uiModeFallbackMessage,
} from "./config/platform-ui-mode"
import { useAuth } from "./composables/useAuth"
import type { SpatialShellFallback } from "./spatial/shell/shell-types"

const SPLASH_SEEN_KEY = "tsian:splash:nyan-bsod:v1"

const { initAuth } = useAuth()

const showSplash = ref(!hasSeenSplash())
const shellMode = ref<"booting" | "retro" | "spatial">("booting")
const spatialShellComponent = shallowRef<Component | null>(null)
const fallbackMessage = ref("")

function hasSeenSplash(): boolean {
  try {
    return localStorage.getItem(SPLASH_SEEN_KEY) === "seen"
  } catch {
    return false
  }
}

function markSplashSeen(): void {
  try {
    localStorage.setItem(SPLASH_SEEN_KEY, "seen")
  } catch {
    // localStorage can be unavailable in private/sandboxed contexts.
  }
}

function finishSplash() {
  markSplashSeen()
  showSplash.value = false
}

function onVisibilityChange(): void {
  if (document.visibilityState !== "visible") {
    return
  }
  const lastCheckedAt = workshopGameCardUpdatesLastSuccessfulCheckAt.value
  if (lastCheckedAt > 0 && Date.now() - lastCheckedAt < WORKSHOP_GAME_CARD_UPDATE_RESUME_INTERVAL_MS) {
    return
  }
  void refreshWorkshopGameCardUpdates({ minIntervalMs: WORKSHOP_GAME_CARD_UPDATE_RESUME_INTERVAL_MS })
}

async function chooseShell(): Promise<void> {
  const environment = currentUiModeEnvironment()
  const resolution = resolveUiMode({
    requested: getPlatformConfig().appearance.uiMode,
    dev: import.meta.env.DEV,
    releaseReady: SPATIAL_RELEASE_READY,
    finePointer: environment.finePointer,
    viewport: environment.viewport,
  })
  if (resolution.mode === "retro") {
    shellMode.value = "retro"
    if (resolution.fallbackReason && resolution.fallbackReason !== "release-gate") {
      fallbackMessage.value = uiModeFallbackMessage(resolution.fallbackReason)
    }
    return
  }

  if (import.meta.env.DEV || SPATIAL_RELEASE_READY) {
    try {
      const module = await import("./spatial/shell/SpatialDesktopShell.vue")
      spatialShellComponent.value = module.default
      shellMode.value = "spatial"
    } catch (error) {
      fallbackMessage.value = `${error instanceof Error ? error.message : "Spatial Desktop 加载失败。"} 已回退到 RetroOS；保存的界面偏好未被修改。`
      shellMode.value = "retro"
    }
    return
  }
  shellMode.value = "retro"
}

function handleSpatialFallback(fallback: SpatialShellFallback): void {
  fallbackMessage.value = `${fallback.message} 已回退到 RetroOS；保存的界面偏好未被修改。`
  spatialShellComponent.value = null
  shellMode.value = "retro"
}

onMounted(async () => {
  try {
    await initializePlatformHost()
    await preheatPlatformConfig()
    await chooseShell()
  } catch (error) {
    fallbackMessage.value = `${error instanceof Error ? error.message : "平台初始化失败。"} 已进入 RetroOS；请检查本地存储后重试。`
    shellMode.value = "retro"
  }
  void refreshWorkshopGameCardUpdates()
  document.addEventListener("visibilitychange", onVisibilityChange)
  void initAuth()
  // 清理孤儿附件(超过 7 天且不属于任何现存会话的附件 Blob).
  void cleanupOrphanAttachments().catch(() => {
    // 清理失败不影响应用启动
  })
})

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibilityChange)
})
</script>

<style scoped>
.splash-fade-leave-active {
  transition: opacity 0.7s ease;
}

.splash-fade-leave-to {
  opacity: 0;
}

.platform-neutral-boot {
  display: grid;
  min-height: 100dvh;
  place-content: center;
  gap: 14px;
  color: rgb(170 215 221 / 62%);
  background: #020812;
  font: 600 11px/1.4 "JetBrains Mono", ui-monospace, monospace;
  letter-spacing: 0.12em;
}

.platform-neutral-boot span {
  width: 32px;
  height: 2px;
  justify-self: center;
  background: #73edf5;
  box-shadow: 0 0 18px rgb(115 237 245 / 35%);
  animation: neutral-boot-pulse 1.2s ease-in-out infinite alternate;
}

.platform-shell-fallback {
  position: fixed;
  z-index: 80;
  right: 16px;
  bottom: 54px;
  max-width: 520px;
  margin: 0;
  padding: 9px 12px;
  border: 1px solid rgb(255 160 91 / 38%);
  color: #ffd7b8;
  background: rgb(31 15 8 / 92%);
  font: 600 10px/1.5 "JetBrains Mono", ui-monospace, monospace;
}

@keyframes neutral-boot-pulse {
  from { opacity: 0.35; transform: scaleX(0.5); }
  to { opacity: 1; transform: scaleX(1); }
}
</style>
