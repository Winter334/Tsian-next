<script setup lang="ts">
/**
 * TimelineGraph — 分支图主体（核心渲染）。
 *
 * 渲染算法（纯 CSS/HTML）：
 * 1. 主干线：source 锚点按 order 水平排列，节点间用 --ember 横线连接。
 * 2. 分支：每个 source order 区间下方的 player 锚点按 turn 排序，排成一条支线。
 * 3. 分叉线：diverged + sourceRef 的 player 锚点，从主干分叉。
 * 4. 并回线：rejoined + sourceRef 的 player 锚点，连回主干。
 * 5. 当前位置：plotOrder 对应的主干位置高亮（ember-bright 脉冲）。
 *
 * 布局结构：每个 source order 是一个"列"。列内上方是 source 节点（主干），
 * 下方是该区间内的 player 锚点（分支）。列间用横线连接形成主干。
 *
 * 纯展示，不可点击。
 */
import { computed } from "vue"
import type { Frontier, SourceAnchor, PlayerAnchor, TimelineAnchor } from "../../lib/frontier-types"

const props = defineProps<{
  frontier: Frontier
  plotOrder: number
}>()

/** 一个 source 区间及其下方的 player 锚点。 */
interface TimelineColumn {
  source: SourceAnchor
  players: PlayerAnchor[]
  isCurrent: boolean
}

/**
 * 将 timeline 分桶：按 source order 分列，每列挂载其区间内的 player 锚点。
 * player 锚点的 order = 它所在 source 区间的起始 source order。
 */
const columns = computed<TimelineColumn[]>(() => {
  const timeline = props.frontier.timeline
  // 按 order 分 source 锚点
  const sources = timeline.filter((a): a is SourceAnchor => a.kind === "source")
  sources.sort((a, b) => a.order - b.order)

  // 为每个 source order 建列
  const colMap = new Map<number, TimelineColumn>()
  for (const s of sources) {
    colMap.set(s.order, {
      source: s,
      players: [],
      isCurrent: s.order === props.plotOrder,
    })
  }

  // 将 player 锚点分配到对应 order 的列
  const players = timeline.filter((a): a is PlayerAnchor => a.kind === "player")
  for (const p of players) {
    const col = colMap.get(p.order)
    if (col) {
      col.players.push(p)
    }
    // player.order 找不到对应 source 列时跳过（数据异常容错）
  }

  // 每列内 player 按 turn 排序
  for (const col of colMap.values()) {
    col.players.sort((a, b) => a.turn - b.turn)
  }

  // 按 order 排列列
  return Array.from(colMap.values()).sort((a, b) => a.source.order - b.source.order)
})

/** player 锚点的 alignment 对应的 CSS class。 */
function alignmentClass(p: PlayerAnchor): string {
  return `align-${p.alignment}`
}

/** player 锚点是否有分叉/并回线（sourceRef 非 null）。 */
function hasBranchLine(p: PlayerAnchor): boolean {
  return p.sourceRef !== null
}
</script>

<template>
  <div class="timeline-graph" role="img" aria-label="剧情时间线分支图">
    <!-- 主干线背景：贯穿全图的 --ember 横线 -->
    <div class="trunk-line" />

    <div class="columns-wrapper">
      <div class="columns">
        <div
          v-for="col in columns"
          :key="col.source.order"
          class="column"
          :class="{ current: col.isCurrent }"
        >
          <!-- 主干节点 -->
          <div class="source-node" :class="{ current: col.isCurrent }">
            <span class="source-dot" />
            <div class="source-label" v-if="col.isCurrent">
              <span class="source-pulse" />
            </div>
          </div>

          <!-- source 节点信息 -->
          <div class="source-info">
            <span class="source-title">{{ col.source.label }}</span>
            <span class="source-meta">{{ col.source.time }}</span>
            <span class="source-chapter">第 {{ col.source.chapter }} 章</span>
          </div>

          <!-- 分支区：该区间内的 player 锚点 -->
          <div v-if="col.players.length > 0" class="branch-area">
            <!-- 分叉指示线 -->
            <div class="branch-fork-line" v-if="col.players.some(p => p.alignment === 'diverged' && hasBranchLine(p))" />
            <div
              v-for="p in col.players"
              :key="`${p.order}-${p.turn}`"
              class="player-node"
              :class="alignmentClass(p)"
            >
              <span class="player-dot" />
              <span class="player-info">
                <span class="player-label">{{ p.label }}</span>
                <span class="player-meta">{{ p.time }} · 回合 {{ p.turn }}</span>
              </span>
              <!-- 并回指示线 -->
              <span v-if="p.alignment === 'rejoined'" class="rejoin-indicator" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-graph {
  position: relative;
  width: 100%;
  min-height: 200px;
  padding: 24px 0;
}

/* 主干线：贯穿全图的水平 --ember 线，位于 source 节点中心高度 */
.trunk-line {
  position: absolute;
  top: 40px; /* 对齐 source-dot 中心 */
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg,
    transparent 0%,
    var(--ember) 4%,
    var(--ember) 96%,
    transparent 100%);
  opacity: 0.5;
  z-index: 0;
}

.columns-wrapper {
  overflow-x: auto;
  overflow-y: visible;
  padding-bottom: 8px;
}

.columns {
  display: flex;
  gap: 0;
  min-width: max-content;
  position: relative;
  z-index: 1;
}

.column {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 140px;
  max-width: 200px;
  padding: 0 8px;
  position: relative;
}

/* ── 主干节点 ── */
.source-node {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 32px; /* trunk-line 对齐此区域中心 */
}

.source-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ember);
  box-shadow: 0 0 4px rgba(181, 137, 61, 0.4);
  z-index: 2;
}

/* 当前位置：ember-bright 脉冲 */
.source-node.current .source-dot {
  background: var(--ember-bright);
  box-shadow: 0 0 10px rgba(232, 169, 72, 0.6), 0 0 3px var(--ember-bright);
  animation: source-breathe 2.5s ease-in-out infinite;
}

.source-pulse {
  position: absolute;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--ember-bright);
  opacity: 0.4;
  animation: source-pulse-ring 2.5s ease-out infinite;
}

@keyframes source-breathe {
  0%, 100% { box-shadow: 0 0 6px rgba(232, 169, 72, 0.4); }
  50% { box-shadow: 0 0 14px rgba(232, 169, 72, 0.7), 0 0 3px var(--ember-bright); }
}

@keyframes source-pulse-ring {
  0% { transform: scale(0.8); opacity: 0.5; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* ── source 节点信息 ── */
.source-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  margin-top: 6px;
  text-align: center;
}

.source-title {
  font-family: var(--font-display);
  font-size: 0.85rem;
  color: var(--prose);
  letter-spacing: 0.04em;
}

.column.current .source-title {
  color: var(--ember-bright);
  text-shadow: 0 0 8px rgba(232, 169, 72, 0.15);
}

.source-meta {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-muted);
}

.source-chapter {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--prose-faint);
  letter-spacing: 0.06em;
}

/* ── 分支区 ── */
.branch-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(10, 5, 6, 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  position: relative;
  width: 100%;
}

/* 分叉指示线：从主干到分支区的垂直短线 */
.branch-fork-line {
  position: absolute;
  top: -16px;
  left: 50%;
  width: 1.5px;
  height: 16px;
  background: var(--line-strong);
}

/* ── player 节点 ── */
.player-node {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  position: relative;
}

.player-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--prose-dim);
  margin-top: 4px;
}

/* alignment 变体 */
.player-node.align-diverged .player-dot {
  background: var(--ember);
  opacity: 0.7;
}

.player-node.align-rejoined .player-dot {
  background: var(--ember-bright);
  opacity: 0.8;
}

.player-node.align-aligned .player-dot {
  background: var(--ember);
  opacity: 0.5;
}

.player-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.player-label {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-dim);
  line-height: 1.3;
  word-break: break-all;
}

.player-meta {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  color: var(--prose-faint);
  letter-spacing: 0.04em;
}

/* 并回指示：右侧小弧线标记 */
.rejoin-indicator {
  position: absolute;
  right: -2px;
  top: 3px;
  width: 12px;
  height: 8px;
  border: 1.5px solid var(--ember-bright);
  border-left: none;
  border-bottom: none;
  border-radius: 0 4px 0 0;
  opacity: 0.6;
}

@media (prefers-reduced-motion: reduce) {
  .source-node.current .source-dot { animation: none; }
  .source-pulse { animation: none; opacity: 0.3; }
}
</style>
