<template>
  <div
    class="grid min-h-dvh w-full overflow-hidden bg-void"
    :class="{ 'animate-crt-switch': splashState === 'animating' }"
    @animationend="onCrtAnimationEnd"
  >
    <DesktopShell
      class="col-start-1 row-start-1 z-10 min-h-0"
      :storage-status="storageStatus"
      :ai-status-short="aiStatusShort"
    />

    <SplashScreen
      v-if="splashState !== 'done'"
      class="col-start-1 row-start-1 z-50"
      @exit="startCrtTransition"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import DesktopShell from "./components/desktop/DesktopShell.vue"
import SplashScreen from "./components/SplashScreen.vue"
import { getBrowserAiConfig } from "./config/ai"
import { initializePlatformHost } from "./platform-host"
import { ensureLocalStorageReady } from "./storage"

type SplashState = "typing" | "animating" | "done"

const splashState = ref<SplashState>("typing")
const storageStatus = ref("检查中")

const aiStatusShort = computed(() => {
  const chat = getBrowserAiConfig() ? "OK" : "--"
  return `CHAT:${chat}`
})

function startCrtTransition() {
  if (splashState.value !== "typing") {
    return
  }

  splashState.value = "animating"
  setTimeout(() => {
    if (splashState.value === "animating") {
      splashState.value = "done"
    }
  }, 440)
}

function onCrtAnimationEnd() {
  splashState.value = "done"
}

onMounted(async () => {
  const status = await ensureLocalStorageReady()
  storageStatus.value = status === "ready" ? "就绪" : "不可用"
  await initializePlatformHost()
})
</script>
