<template>
  <section class="spatial-pending-app">
    <div class="spatial-pending-app__identity">
      <component :is="icon" class="spatial-pending-app__icon" aria-hidden="true" />
      <div>
        <p class="spatial-eyebrow">PRESENTATION LINK / PENDING</p>
        <h2>{{ title }}</h2>
        <p>{{ caption }}</p>
      </div>
    </div>
    <div class="spatial-pending-app__notice">
      <span aria-hidden="true">◈</span>
      <p>Spatial 外壳已连接。此应用的专用空间面板将在后续适配任务中接入。</p>
    </div>
    <label class="spatial-pending-app__probe">
      <span>会话状态探针（最小化后应保留）</span>
      <input v-model="probeText" type="text" placeholder="输入临时内容…" />
    </label>
    <button type="button" class="spatial-action" @click="probeCount += 1">
      本地计数 {{ probeCount }}
    </button>
  </section>
</template>

<script setup lang="ts">
import { ref, type Component } from "vue"

defineProps<{
  title: string
  caption: string
  icon: Component
}>()

const probeText = ref("")
const probeCount = ref(0)
</script>
