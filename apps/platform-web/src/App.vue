<template>
  <div class="grid min-h-dvh w-full overflow-hidden bg-void">
    <DesktopShell class="col-start-1 row-start-1 z-10 min-h-0" />

    <Transition name="splash-fade">
      <SplashScreen
        v-if="showSplash"
        class="col-start-1 row-start-1 z-50"
        @exit="finishSplash"
      />
    </Transition>

    <ToastHost />
    <ConfirmHost />
    <FloatingWindow />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import DesktopShell from "./components/desktop/DesktopShell.vue"
import FloatingWindow from "./components/feedback/FloatingWindow.vue"
import SplashScreen from "./components/SplashScreen.vue"
import ToastHost from "./components/feedback/ToastHost.vue"
import ConfirmHost from "./components/feedback/ConfirmHost.vue"
import { initializePlatformHost, refreshWorkshopGameCardUpdates, WORKSHOP_GAME_CARD_UPDATE_RESUME_INTERVAL_MS, workshopGameCardUpdatesLastSuccessfulCheckAt } from "./platform-host"
import { cleanupOrphanAttachments } from "./storage"
import { preheatPlatformConfig } from "./config/platform-config"
import { useAuth } from "./composables/useAuth"

const SPLASH_SEEN_KEY = "tsian:splash:nyan-bsod:v1"

const { initAuth } = useAuth()

const showSplash = ref(!hasSeenSplash())

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

onMounted(async () => {
  await initializePlatformHost()
  void refreshWorkshopGameCardUpdates()
  document.addEventListener("visibilitychange", onVisibilityChange)
  void initAuth()
  // 预热平台配置 cache：读 .tsian/local/platform-config.json → merge 默认 → 内存。
  // 完成前 46 个同步读调用点用默认值（provider 未配时本就走 env/默认，窗口无感）。
  void preheatPlatformConfig().catch(() => {
    // 预热失败不影响启动，getPlatformConfig() 会返默认值。
  })
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
</style>
