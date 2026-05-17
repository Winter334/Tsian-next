<template>
  <!-- 游戏页：进入后挂载游玩前端，不再保留平台壳样式 -->
  <div ref="frontendMount" class="w-full min-h-screen"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { playFrontendBridge } from "../platform-host"
import { loadOfficialDefaultFrontend } from "../package-loader/official-default"

const frontendMount = ref<HTMLElement | null>(null)
let disposeFrontend: (() => void) | null = null

function unmountFrontend() {
  disposeFrontend?.()
  disposeFrontend = null
}

function mountFrontend() {
  unmountFrontend()
  const frontend = loadOfficialDefaultFrontend()
  if (frontendMount.value) {
    disposeFrontend = frontend.mount(frontendMount.value, playFrontendBridge)
  }
}

onMounted(() => {
  mountFrontend()
})

onBeforeUnmount(() => {
  unmountFrontend()
})
</script>