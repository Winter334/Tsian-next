<script setup lang="ts">
/**
 * TimelineLegend — 时间线图例。
 *
 * 横排四个图例项：主干节点 / 分支节点 / 当前进度 / 偏离·并回线。
 * 纯展示，纯视觉，不含数据逻辑。
 */
</script>

<template>
  <div class="timeline-legend">
    <div class="legend-item">
      <span class="legend-mark source-mark" />
      <span class="legend-text">原著剧情节点</span>
    </div>
    <div class="legend-item">
      <span class="legend-mark player-mark" />
      <span class="legend-text">玩家剧情事件</span>
    </div>
    <div class="legend-item">
      <span class="legend-mark current-mark" />
      <span class="legend-text">当前进度</span>
    </div>
    <div class="legend-item">
      <span class="legend-mark branch-mark" />
      <span class="legend-text">偏离 · 并回</span>
    </div>
  </div>
</template>

<style scoped>
.timeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  padding: 12px 16px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(10, 5, 6, 0.5);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-mark {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.source-mark {
  background: var(--ember);
  box-shadow: 0 0 4px rgba(181, 137, 61, 0.3);
}

.player-mark {
  width: 7px;
  height: 7px;
  background: var(--prose-dim);
}

.current-mark {
  background: var(--ember-bright);
  animation: legend-breathe 2.5s ease-in-out infinite;
}

@keyframes legend-breathe {
  0%, 100% { box-shadow: 0 0 3px rgba(232, 169, 72, 0.4); }
  50% { box-shadow: 0 0 8px rgba(232, 169, 72, 0.7), 0 0 2px var(--ember-bright); }
}

.branch-mark {
  width: 14px;
  height: 10px;
  border-radius: 0;
  background: transparent;
  border-bottom: 1.5px solid var(--line-strong);
  border-left: 1.5px solid var(--line-strong);
  border-radius: 0 0 0 3px;
}

.legend-text {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-faint);
  letter-spacing: 0.04em;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .current-mark { animation: none; }
}
</style>
