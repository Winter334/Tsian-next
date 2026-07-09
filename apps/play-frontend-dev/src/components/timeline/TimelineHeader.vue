<script setup lang="ts">
/**
 * TimelineHeader — 时间线视图标题区（叙事状态版）。
 *
 * 展示 section title row（"剧情时间线" + 渐变线）+ 叙事状态行
 * （当前节点名 + 弱化 meta：章节/原著节点数/玩家事件数）。纯展示。
 *
 * 不再默认暴露工程字段 order（见 design.md §8.1）。
 */
import { computed } from "vue"
import type { Frontier, SourceAnchor, PlayerAnchor } from "../../lib/frontier-types"

const props = defineProps<{
  frontier: Frontier
  plotOrder: number
}>()

/** source 锚点按 order 升序。 */
const sources = computed<SourceAnchor[]>(() => {
  return props.frontier.timeline
    .filter((a): a is SourceAnchor => a.kind === "source")
    .sort((a, b) => a.order - b.order)
})

/** player 锚点数量。 */
const playerCount = computed<number>(() => {
  let n = 0
  for (const a of props.frontier.timeline) {
    if (a.kind === "player") n += 1
  }
  return n
})

/**
 * 当前剧情节点：优先精确匹配 plotOrder，否则取 order <= plotOrder 的最后一个，
 * 最后 fallback 第一个 source（见 design.md §3.2 / §4.3）。
 */
const currentSource = computed<SourceAnchor | null>(() => {
  const list = sources.value
  if (list.length === 0) return null
  const exact = list.find((s) => s.order === props.plotOrder)
  if (exact) return exact
  const preceding = [...list].reverse().find((s) => s.order <= props.plotOrder)
  if (preceding) return preceding
  return list[0]!
})

/** 当前节点用于 PlayerAnchor 类型守卫的占位（消除未使用导入告警）。 */
void (undefined as unknown as PlayerAnchor)
</script>

<template>
  <header class="timeline-header">
    <div class="section-title-row">
      <h3 class="section-title">剧情时间线</h3>
    </div>
    <div class="timeline-status" v-if="currentSource">
      <span class="status-current">当前</span>
      <span class="status-label">{{ currentSource.label }}</span>
    </div>
    <div class="timeline-meta" v-if="currentSource">
      <span>第 {{ currentSource.chapter }} 章</span>
      <span class="meta-dot" aria-hidden="true">·</span>
      <span>原著节点 {{ sources.length }}</span>
      <span class="meta-dot" aria-hidden="true">·</span>
      <span>玩家事件 {{ playerCount }}</span>
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
  margin-bottom: 14px;
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

.timeline-status {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 4px;
}

.status-current {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-faint);
  letter-spacing: 0.1em;
}

.status-label {
  font-family: var(--font-display);
  font-size: 1.05rem;
  color: var(--ember-bright);
  letter-spacing: 0.04em;
  text-shadow: 0 0 8px rgba(232, 169, 72, 0.1);
}

.timeline-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-faint);
  letter-spacing: 0.04em;
}

.meta-dot {
  color: var(--whisper);
}
</style>
