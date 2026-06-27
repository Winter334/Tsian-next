<template>
  <div
    class="grid min-h-dvh w-full overflow-hidden bg-void"
    :class="{ 'animate-crt-switch': splashState === 'animating' }"
    @animationend="onCrtAnimationEnd"
  >
    <DesktopShell class="col-start-1 row-start-1 z-10 min-h-0" />

    <SplashScreen
      v-if="splashState !== 'done'"
      class="col-start-1 row-start-1 z-50"
      @exit="startCrtTransition"
    />

    <ToastHost />
    <ConfirmHost />
    <FloatingWindow />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import DesktopShell from "./components/desktop/DesktopShell.vue"
import FloatingWindow from "./components/feedback/FloatingWindow.vue"
import SplashScreen from "./components/SplashScreen.vue"
import ToastHost from "./components/feedback/ToastHost.vue"
import ConfirmHost from "./components/feedback/ConfirmHost.vue"
import { initializePlatformHost } from "./platform-host"
import { cleanupOrphanAttachments } from "./storage"
import { preheatPlatformConfig } from "./config/platform-config"

type SplashState = "typing" | "animating" | "done"

const splashState = ref<SplashState>("typing")

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
  await initializePlatformHost()
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
</script>
