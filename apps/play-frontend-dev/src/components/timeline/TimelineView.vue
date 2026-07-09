<script setup lang="ts">
/**
 * TimelineView — 时间线可视化视图根（由 App.vue 在 navCurrent==='timeline' 时挂载）。
 *
 * 消费 useFrontier() 的 frontierData + useRuntime() 的 runtime.plotOrder，
 * 挂载 TimelineGraph 渲染纵向命轨树。
 *
 * 布局：view-stage 同款 padding（顶 header + 左右栏让位），内部居中 max-width
 * ~900px 可垂直滚动。暗色背景上直接承载 tree，不再额外插入会影响文档流的装饰层。
 *
 * 空态/降级：
 * - frontier 读取中 → "读取时间线…"
 * - frontier 读取失败 → "时间线数据不可读"
 * - frontier 为 null → "尚未建立时间线"
 * - 只有开局一个锚点 → 正常渲染（主干上一个点）
 */
import { computed, onMounted, ref } from "vue"
import { useFrontier } from "../../composables/useFrontier"
import { useRuntime } from "../../composables/useRuntime"
import TimelineGraph from "./TimelineGraph.vue"

const { frontierData, refresh: refreshFrontier } = useFrontier()
const { runtimeData } = useRuntime()

const frontier = computed(() => frontierData.value.frontier)
const frontierError = computed(() => frontierData.value.error)
const frontierStatus = computed(() => frontierData.value.status)
const plotOrder = computed(() => runtimeData.value.runtime?.plotOrder ?? 0)

const isLoading = computed(() => frontierStatus.value === "loading" || frontierStatus.value === "idle")
const hasError = computed(() => frontierStatus.value === "error")
const hasFrontier = computed(() => frontier.value !== null && frontier.value.timeline.length > 0)
const scrollRootRef = ref<HTMLElement | null>(null)

onMounted(() => {
  // 时间线视图 v-if 挂载；每次进入主动刷新，避免看到 useFrontier 模块级旧缓存。
  void refreshFrontier()
})
</script>

<template>
  <div class="timeline-view view-stage" ref="scrollRootRef">
    <div class="timeline-container">
      <!-- 读取中 -->
      <div v-if="isLoading" class="timeline-placeholder">
        <span class="placeholder-glyph" />
        <p class="placeholder-text-sm">读取时间线…</p>
      </div>

      <!-- 读取失败 / 无数据 -->
      <div v-else-if="hasError || !hasFrontier" class="timeline-placeholder">
        <span class="placeholder-glyph error" />
        <p class="placeholder-text-sm">{{ hasError ? '时间线数据不可读' : '尚未建立时间线' }}</p>
        <p v-if="frontierError" class="placeholder-sub-sm">{{ frontierError }}</p>
      </div>

      <!-- 正常渲染：纵向命轨树 -->
      <template v-else-if="frontier">
        <TimelineGraph :frontier="frontier" :plot-order="plotOrder" :scroll-root="scrollRootRef" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.timeline-view {
  /* view-stage 已提供 padding（顶 header + 左右栏让位）；
     这里覆盖 align/justify 让内容靠上 + 居中。 */
  align-items: center;
  justify-content: flex-start;
  overflow-y: auto;
}

.timeline-container {
  position: relative;
  width: 100%;
  max-width: 1040px;
  padding: 12px 28px 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 占位态 ── */
.timeline-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 80px 20px;
  text-align: center;
}

.placeholder-glyph {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--line-strong);
  border-top-color: var(--ember);
  animation: glyph-spin 1.2s linear infinite;
}

.placeholder-glyph.error {
  border: none;
  border-radius: 0;
  width: 24px;
  height: 24px;
  position: relative;
  animation: none;
}

.placeholder-glyph.error::before,
.placeholder-glyph.error::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 24px;
  height: 2px;
  background: var(--blood);
}

.placeholder-glyph.error::before {
  transform: translate(-50%, -50%) rotate(45deg);
}

.placeholder-glyph.error::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

@keyframes glyph-spin {
  to { transform: rotate(360deg); }
}

.placeholder-text-sm {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--prose-dim);
  letter-spacing: 0.06em;
}

.placeholder-sub-sm {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-faint);
}

@media (prefers-reduced-motion: reduce) {
  .placeholder-glyph { animation: none; }
}
</style>
