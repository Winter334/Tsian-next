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
    <DialogForm />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import DesktopShell from "./components/desktop/DesktopShell.vue"
import DialogForm from "./components/feedback/DialogForm.vue"
import SplashScreen from "./components/SplashScreen.vue"
import ToastHost from "./components/feedback/ToastHost.vue"
import ConfirmHost from "./components/feedback/ConfirmHost.vue"
import { initializePlatformHost } from "./platform-host"

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
})
</script>
