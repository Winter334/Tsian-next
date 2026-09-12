<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue"
import { getTsianClient } from "../../composables/useTsian"
import { onRuntimeStale } from "../../composables/useRuntimeStaleBus"
import { loadHistoricalTimeline, type HistoricalNode } from "../../lib/history-timeline"
import TimelineGraph from "./TimelineGraph.vue"
const nodes = ref<HistoricalNode[]>([])
const loading = ref(true), error = ref<string | null>(null)
let generation = 0
async function refresh() {
  const own = ++generation
  loading.value = true
  try {
    const result = await loadHistoricalTimeline(getTsianClient().workspace)
    if (own !== generation) return
    nodes.value = result; error.value = null
  } catch (err) {
    if (own === generation) error.value = err instanceof Error ? err.message : "读取历史失败，请重试。"
  } finally { if (own === generation) loading.value = false }
}
const unsubscribe = onRuntimeStale(() => { void refresh() })
onMounted(() => { void refresh() })
onBeforeUnmount(() => { generation++; unsubscribe() })
</script>

<template>
  <div class="timeline-view view-stage">
    <section class="timeline-container">
      <h2>本局足迹</h2>
      <p class="timeline-intro">这里只记录已经发生的重要剧情。</p>
      <p v-if="loading" class="placeholder-text-sm">读取历史…</p>
      <div v-else-if="error" role="alert"><p>{{ error }}</p><button @click="refresh">重试</button></div>
      <p v-else-if="!nodes.length" class="placeholder-text-sm">尚无重要历史记录。故事发生后，值得记住的节点会留在这里。</p>
      <TimelineGraph v-else :nodes="nodes" />
    </section>
  </div>
</template>

<style scoped>
.timeline-view { box-sizing: border-box; align-items: center; justify-content: flex-start; overflow-y: auto; }
.timeline-container { width: 100%; max-width: 880px; padding: 20px 28px 48px; box-sizing: border-box; }
h2 { color: var(--ink, #ddd4c2); font-size: 1.4rem; font-weight: 500; }
.timeline-intro, .placeholder-text-sm { color: var(--ink-muted, #9a9387); line-height: 1.8; }
button { cursor: pointer; padding: 6px 18px; color: inherit; background: transparent; border: 1px solid #8e744f; border-radius: 4px; }
</style>
