<script setup lang="ts">
/**
 * TimelineLegend — 时间线图例（轻量 caption 版）。
 *
 * 没有玩家事件时不显示完整图例，避免空时间线被说明文本抢焦点（design.md §3.4 / R5）。
 * 有玩家事件时显示紧凑说明：原著 / 偏离 / 并回，去掉大块边框卡片感。
 * 纯展示，纯视觉，不含数据逻辑。
 */
defineProps<{
  /** 是否存在 player 锚点；为 false 时仅显示极轻的单行说明或不渲染。 */
  hasPlayerEvents: boolean
}>()
</script>

<template>
  <!-- 有玩家事件：紧凑三色说明 -->
  <div v-if="hasPlayerEvents" class="timeline-legend">
    <div class="legend-item">
      <span class="legend-mark source-mark" />
      <span class="legend-text">原著命轨</span>
    </div>
    <div class="legend-item">
      <span class="legend-mark diverge-mark" />
      <span class="legend-text">偏离</span>
    </div>
    <div class="legend-item">
      <span class="legend-mark rejoin-mark" />
      <span class="legend-text">并回</span>
    </div>
  </div>

  <!-- 无玩家事件：极轻单行，不抢焦点 -->
  <div v-else class="timeline-legend-hint">
    <span class="legend-mark source-mark" />
    <span class="legend-text">金色命轨为原著剧情节点</span>
  </div>
</template>

<style scoped>
.timeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  padding: 4px 2px;
  /* 去掉大块边框卡片感：无边框、无玻璃底，作为弱信息层 */
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 7px;
}

.legend-mark {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.source-mark {
  background: var(--ember);
  box-shadow: 0 0 4px rgba(181, 137, 61, 0.4);
}

.diverge-mark {
  background: var(--blood);
  opacity: 0.85;
}

.rejoin-mark {
  background: var(--ember-bright);
  opacity: 0.7;
}

.legend-text {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--prose-faint);
  letter-spacing: 0.06em;
  white-space: nowrap;
}

/* 无玩家事件的极轻提示：更弱的存在感 */
.timeline-legend-hint {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 2px 2px;
  opacity: 0.7;
}

.timeline-legend-hint .legend-mark {
  width: 7px;
  height: 7px;
}

.timeline-legend-hint .legend-text {
  font-size: 0.64rem;
  color: var(--prose-faint);
}
</style>
