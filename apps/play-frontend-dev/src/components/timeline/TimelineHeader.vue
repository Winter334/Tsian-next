<script setup lang="ts">
/**
 * TimelineHeader — 时间线视图标题区。
 *
 * 展示 section title row（"剧情时间线" + 渐变线）+ 事实行
 * （已读窗口、剧情进度、锚点总数）。纯展示。
 */
import type { Frontier, SourceAnchor, PlayerAnchor } from "../../lib/frontier-types"

const props = defineProps<{
  frontier: Frontier
  plotOrder: number
}>()

function countAnchors(timeline: Frontier["timeline"]): { source: number; player: number } {
  let source = 0
  let player = 0
  for (const a of timeline) {
    if (a.kind === "source") source++
    else player++
  }
  return { source, player }
}

function windowLabel(sw: Frontier["sourceWindow"]): string {
  if (sw.start === null || sw.end === null) return "未建立"
  return `第 ${sw.start} – ${sw.end} 章`
}
</script>

<template>
  <header class="timeline-header">
    <div class="section-title-row">
      <h3 class="section-title">剧情时间线</h3>
      <span class="section-line" />
    </div>
    <div class="timeline-facts">
      <div class="fact">
        <span class="fact-label">已读窗口</span>
        <span class="fact-value">{{ windowLabel(frontier.sourceWindow) }}</span>
      </div>
      <div class="fact">
        <span class="fact-label">剧情进度</span>
        <span class="fact-value">order {{ plotOrder }}</span>
      </div>
      <div class="fact">
        <span class="fact-label">剧情节点</span>
        <span class="fact-value">{{ countAnchors(frontier.timeline).source }}</span>
      </div>
      <div class="fact">
        <span class="fact-label">玩家事件</span>
        <span class="fact-value">{{ countAnchors(frontier.timeline).player }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.timeline-header {
  width: 100%;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}

.section-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 400;
  color: var(--ember-bright);
  letter-spacing: 0.08em;
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.12);
  white-space: nowrap;
}

.section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(232, 169, 72, 0.42), transparent);
}

.timeline-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-bottom: 8px;
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fact-label {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-faint);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.fact-value {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--prose-dim);
}
</style>
