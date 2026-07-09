<script setup lang="ts">
/**
 * TimelineGraph — 纵向命轨树。
 *
 * 这版不再把时间线做成点线图，而是明确按"树"建模：
 * - 中轴是原著主干（trunk）。
 * - source 是长在主干上的章回节点。
 * - player 是从主干左右逸出的分支节点。
 * - 并回后下一段分支换边。
 *
 * 布局使用正常文档流 + CSS grid，避免上一版 absolute/SVG 组合导致的空屏和漂移。
 * 曲线只作为分支的装饰连接线，主干由常驻 trunk 提供，不依赖 SVG 才能看见。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import type { Frontier, SourceAnchor, PlayerAnchor } from "../../lib/frontier-types"

const props = defineProps<{
  frontier: Frontier
  plotOrder: number
  scrollRoot?: HTMLElement | null
}>()

type Side = "left" | "right"

type BranchRole = "none" | "start" | "mid" | "end"

interface TreeItem {
  key: string
  kind: "source" | "player"
  anchor: SourceAnchor | PlayerAnchor
  side: "main" | Side
  isCurrent: boolean
  branchRole: BranchRole
}

const sources = computed<SourceAnchor[]>(() => {
  return props.frontier.timeline
    .filter((a): a is SourceAnchor => a.kind === "source")
    .sort((a, b) => a.order - b.order)
})

const playersSorted = computed<PlayerAnchor[]>(() => {
  return props.frontier.timeline
    .filter((a): a is PlayerAnchor => a.kind === "player")
    .sort((a, b) => (a.order - b.order) || (a.turn - b.turn))
})

const hasPlayers = computed(() => playersSorted.value.length > 0)

const chapterTitleByIndex = computed<Map<number, string>>(() => {
  const map = new Map<number, string>()
  for (const ch of props.frontier.sourceWindow.chapters ?? []) {
    map.set(ch.index, ch.title)
  }
  return map
})

function chapterTitle(source: SourceAnchor): string | null {
  return chapterTitleByIndex.value.get(source.chapter) ?? null
}

const playersByOrder = computed<Map<number, PlayerAnchor[]>>(() => {
  const map = new Map<number, PlayerAnchor[]>()
  for (const p of playersSorted.value) {
    const list = map.get(p.order)
    if (list) list.push(p)
    else map.set(p.order, [p])
  }
  return map
})

const currentSourceOrder = computed<number | null>(() => {
  const list = sources.value
  if (list.length === 0) return null
  const exact = list.find((s) => s.order === props.plotOrder)
  if (exact) return exact.order
  const preceding = [...list].reverse().find((s) => s.order <= props.plotOrder)
  if (preceding) return preceding.order
  return list[0]!.order
})

const items = computed<TreeItem[]>(() => {
  const result: TreeItem[] = []
  let nextSide: Side = "left"
  let activeSide: Side | null = null

  for (const source of sources.value) {
    result.push({
      key: `src-${source.order}`,
      kind: "source",
      anchor: source,
      side: "main",
      isCurrent: source.order === currentSourceOrder.value,
      branchRole: "none",
    })

    const players = playersByOrder.value.get(source.order) ?? []
    for (const player of players) {
      let side: Side
      let branchRole: BranchRole

      if (player.alignment === "rejoined") {
        side = activeSide ?? nextSide
        branchRole = "end"
        activeSide = null
        nextSide = side === "left" ? "right" : "left"
      } else {
        if (activeSide === null) {
          activeSide = nextSide
          branchRole = "start"
        } else {
          branchRole = "mid"
        }
        side = activeSide
      }

      result.push({
        key: `plr-${player.order}-${player.turn}`,
        kind: "player",
        anchor: player,
        side,
        isCurrent: false,
        branchRole,
      })
    }
  }

  return result
})

const visibleKeys = ref<Set<string>>(new Set())
const treeRef = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
let autoLocated = false
let locateRaf = 0

function reveal(key: string): void {
  if (visibleKeys.value.has(key)) return
  const next = new Set(visibleKeys.value)
  next.add(key)
  visibleKeys.value = next
}

function itemVisible(key: string): boolean {
  return visibleKeys.value.has(key)
}

function setupObserver(): void {
  if (observer) observer.disconnect()
  observer = null

  const root = props.scrollRoot ?? null
  const tree = treeRef.value
  if (!tree) return

  if (!root) {
    for (const item of items.value) reveal(item.key)
    return
  }

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const key = (entry.target as HTMLElement).dataset.revealKey
      if (key) reveal(key)
    }
  }, { root, threshold: 0.18, rootMargin: "0px 0px -10% 0px" })

  for (const el of tree.querySelectorAll<HTMLElement>("[data-reveal-key]")) {
    observer.observe(el)
  }
}

function maybeAutoLocate(): void {
  if (autoLocated) return
  const root = props.scrollRoot ?? null
  const tree = treeRef.value
  const currentKey = currentSourceOrder.value === null ? null : `src-${currentSourceOrder.value}`
  if (!root || !tree || !currentKey) return

  const targetEl = tree.querySelector<HTMLElement>(`[data-reveal-key="${CSS.escape(currentKey)}"]`)
  if (!targetEl) return

  autoLocated = true
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  const rootRect = root.getBoundingClientRect()
  const targetRect = targetEl.getBoundingClientRect()
  const target = root.scrollTop + (targetRect.top - rootRect.top) - root.clientHeight * 0.32
  if (reduce) root.scrollTop = target
  else root.scrollTo({ top: target, behavior: "smooth" })
}

function scheduleRefresh(): void {
  if (locateRaf !== 0) cancelAnimationFrame(locateRaf)
  locateRaf = requestAnimationFrame(() => {
    locateRaf = 0
    void nextTick(() => {
      setupObserver()
      maybeAutoLocate()
    })
  })
}

watch(items, scheduleRefresh, { flush: "post", immediate: true })
watch(() => props.scrollRoot, scheduleRefresh, { flush: "post" })

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  if (locateRaf !== 0) cancelAnimationFrame(locateRaf)
})

function alignmentClass(player: PlayerAnchor): string {
  return `align-${player.alignment}`
}

function itemAlignmentClass(item: TreeItem): string {
  return item.kind === "player" ? `row-${alignmentClass(item.anchor as PlayerAnchor)}` : ""
}
</script>

<template>
  <section class="timeline-tree" ref="treeRef" role="img" aria-label="剧情时间线命轨树">
    <div class="tree-body" :class="{ 'source-only': !hasPlayers, branching: hasPlayers }">
      <div
        v-for="item in items"
        :key="item.key"
        class="tree-row"
        :class="[
          `row-${item.kind}`,
          `side-${item.side}`,
          `branch-${item.branchRole}`,
          itemAlignmentClass(item),
          { current: item.isCurrent, revealed: itemVisible(item.key) },
        ]"
        :data-reveal-key="item.key"
      >
        <template v-if="item.kind === 'source'">
          <div class="tree-left" />
          <div class="tree-axis">
            <span class="source-node">
              <span v-if="item.isCurrent" class="source-pulse" />
            </span>
          </div>
          <article class="source-card">
            <h4 class="source-title">{{ (item.anchor as SourceAnchor).label }}</h4>
            <p class="source-meta">
              <span>第 {{ (item.anchor as SourceAnchor).chapter }} 章</span>
              <span v-if="chapterTitle(item.anchor as SourceAnchor)"> · {{ chapterTitle(item.anchor as SourceAnchor) }}</span>
            </p>
            <p class="source-time">{{ (item.anchor as SourceAnchor).time }}</p>
          </article>
        </template>

        <template v-else>
          <article class="player-card">
            <span class="player-dot" :class="alignmentClass(item.anchor as PlayerAnchor)" />
            <div class="player-copy">
              <h4 class="player-title">{{ (item.anchor as PlayerAnchor).label }}</h4>
              <p class="player-meta">回合 {{ (item.anchor as PlayerAnchor).turn }} · {{ (item.anchor as PlayerAnchor).time }}</p>
            </div>
          </article>
          <div class="tree-axis branch-axis" />
          <div class="tree-right" />
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeline-tree {
  position: relative;
  width: 100%;
  padding: 0 0 12px;
}

.tree-body {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 2px 0 12px;
}

/* 无 player 事件时不预留左右分支画布，直接使用紧凑命轨列。 */
.tree-body.source-only {
  max-width: 760px;
  margin: 0 0 0 120px;
}

/* 原著主干：不靠节点/曲线撑起来，始终是一棵树的 trunk。 */
.tree-body::before {
  content: "";
  position: absolute;
  top: 20px;
  bottom: 24px;
  left: calc(42% + 34px);
  width: 2px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: linear-gradient(180deg,
    transparent 0%,
    rgba(232, 169, 72, 0.46) 8%,
    rgba(181, 137, 61, 0.82) 48%,
    rgba(232, 169, 72, 0.38) 92%,
    transparent 100%);
  box-shadow: 0 0 12px rgba(181, 137, 61, 0.35), 0 0 28px rgba(43, 4, 4, 0.65);
  pointer-events: none;
}

.tree-body.source-only::before {
  left: 114px;
}

.tree-row {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns: minmax(180px, 42%) 36px minmax(240px, 1fr);
  column-gap: 16px;
  align-items: center;
  min-height: 104px;
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.42s ease, transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
}

.tree-body.source-only .tree-row {
  grid-template-columns: 82px 36px minmax(420px, 1fr);
  column-gap: 14px;
  min-height: 102px;
}

.tree-row.revealed {
  opacity: 1;
  transform: translateY(0);
}

.tree-row.row-player {
  min-height: 86px;
}

.tree-left,
.tree-right {
  min-width: 0;
}

.tree-axis {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}

.source-node {
  position: relative;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ember);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.55), 0 0 24px rgba(181, 137, 61, 0.16);
}

.source-node::after {
  content: "";
  position: absolute;
  inset: -7px;
  border: 1px solid rgba(181, 137, 61, 0.24);
  border-radius: 50%;
}

.tree-row.current .source-node {
  background: var(--ember-bright);
  box-shadow: 0 0 14px rgba(232, 169, 72, 0.72), 0 0 30px rgba(181, 137, 61, 0.22);
  animation: source-breathe 3s ease-in-out infinite;
}

.source-pulse {
  position: absolute;
  inset: -12px;
  border: 1.5px solid var(--ember-bright);
  border-radius: 50%;
  opacity: 0.4;
  animation: source-pulse 3s ease-out infinite;
}

.source-card {
  position: relative;
  justify-self: start;
  min-width: 340px;
  max-width: 520px;
  padding: 12px 18px 13px 17px;
  border: none;
  border-left: 2px solid rgba(232, 169, 72, 0.58);
  border-radius: 0 13px 13px 0;
  background:
    radial-gradient(circle at 0% 50%, rgba(232, 169, 72, 0.12), transparent 56%),
    linear-gradient(90deg, rgba(181, 137, 61, 0.11), rgba(10, 5, 6, 0.22) 62%, transparent);
  box-shadow:
    inset 10px 0 22px rgba(181, 137, 61, 0.035),
    0 0 22px rgba(43, 4, 4, 0.24);
}

.source-card::before {
  content: "";
  position: absolute;
  left: -31px;
  top: 50%;
  width: 30px;
  height: 1px;
  transform: translateY(-50%);
  background: linear-gradient(90deg, rgba(232, 169, 72, 0.65), rgba(232, 169, 72, 0.18));
}

.tree-row.current .source-card {
  border-left-color: var(--ember-bright);
  background:
    radial-gradient(circle at 0% 50%, rgba(232, 169, 72, 0.20), transparent 58%),
    linear-gradient(90deg, rgba(181, 137, 61, 0.18), rgba(10, 5, 6, 0.26) 64%, transparent);
  box-shadow:
    inset 10px 0 24px rgba(232, 169, 72, 0.055),
    0 0 22px rgba(181, 137, 61, 0.10),
    0 0 34px rgba(43, 4, 4, 0.34);
}

.source-kicker {
  display: block;
  margin-bottom: 2px;
  font-family: var(--font-mono);
  font-size: 0.58rem;
  color: var(--ember);
  letter-spacing: 0.16em;
}

.source-title,
.player-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 0.96rem;
  font-weight: 400;
  color: var(--prose);
  letter-spacing: 0.04em;
  line-height: 1.25;
}

.tree-row.current .source-title {
  color: var(--ember-bright);
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.16);
}

.source-meta,
.player-meta {
  margin: 3px 0 0;
  font-family: var(--font-mono);
  font-size: 0.66rem;
  color: var(--prose-faint);
  letter-spacing: 0.04em;
}

.source-time {
  margin: 5px 0 0;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--prose-muted);
  letter-spacing: 0.03em;
}

/* player 分支：左右交换 grid 区域，形成真正的 branch，而不是主干上的点。 */
.tree-row.row-player.side-left .player-card {
  grid-column: 1;
  justify-self: end;
}
.tree-row.row-player.side-left .branch-axis {
  grid-column: 2;
}
.tree-row.row-player.side-left .tree-right {
  grid-column: 3;
}

.tree-row.row-player.side-right .player-card {
  grid-column: 3;
  justify-self: start;
}
.tree-row.row-player.side-right .branch-axis {
  grid-column: 2;
}
.tree-row.row-player.side-right .tree-right {
  grid-column: 1;
}

/* 分支线：按 branch-start/mid/end 形成一条侧枝，而不是每个节点独立短线。 */
.tree-row.row-player::before,
.tree-row.row-player::after {
  content: "";
  position: absolute;
  pointer-events: none;
  z-index: 0;
}

/* 侧枝竖线：start 从节点向下，mid 贯穿，end 从上方抵达节点。 */
.tree-row.row-player.side-left::before {
  left: calc(42% - 18px);
  width: 1.5px;
  background: linear-gradient(180deg, transparent, rgba(155, 58, 46, 0.48), transparent);
  box-shadow: 0 0 8px rgba(155, 58, 46, 0.16);
}
.tree-row.row-player.side-right::before {
  left: calc(42% + 86px);
  width: 1.5px;
  background: linear-gradient(180deg, transparent, rgba(155, 58, 46, 0.48), transparent);
  box-shadow: 0 0 8px rgba(155, 58, 46, 0.16);
}
.tree-row.row-player.branch-start::before { top: 50%; bottom: -50%; }
.tree-row.row-player.branch-mid::before { top: -50%; bottom: -50%; }
.tree-row.row-player.branch-end::before { top: -50%; bottom: 50%; }

/* 卡片连接线：从卡片接到侧枝。 */
.tree-row.row-player.side-left::after {
  top: 50%;
  left: 24%;
  right: calc(58% - 18px);
  height: 1.5px;
  background: linear-gradient(90deg, rgba(155, 58, 46, 0.42), rgba(155, 58, 46, 0.12));
}
.tree-row.row-player.side-right::after {
  top: 50%;
  left: calc(42% + 86px);
  right: 24%;
  height: 1.5px;
  background: linear-gradient(90deg, rgba(155, 58, 46, 0.12), rgba(155, 58, 46, 0.42));
}

/* start/end 额外用短弯折暗示从主干分出/并回。 */
.tree-row.row-player.branch-start .branch-axis::before,
.tree-row.row-player.branch-end .branch-axis::before {
  content: "";
  position: absolute;
  top: 50%;
  width: 46px;
  height: 28px;
  transform: translateY(-50%);
  pointer-events: none;
}
.tree-row.row-player.side-left.branch-start .branch-axis::before {
  right: 50%;
  border-top: 1.5px solid rgba(155, 58, 46, 0.46);
  border-left: 1.5px solid rgba(155, 58, 46, 0.46);
  border-radius: 16px 0 0 0;
}
.tree-row.row-player.side-left.branch-end .branch-axis::before {
  right: 50%;
  border-bottom: 1.5px solid rgba(232, 169, 72, 0.50);
  border-left: 1.5px solid rgba(232, 169, 72, 0.50);
  border-radius: 0 0 0 16px;
}
.tree-row.row-player.side-right.branch-start .branch-axis::before {
  left: 50%;
  border-top: 1.5px solid rgba(155, 58, 46, 0.46);
  border-right: 1.5px solid rgba(155, 58, 46, 0.46);
  border-radius: 0 16px 0 0;
}
.tree-row.row-player.side-right.branch-end .branch-axis::before {
  left: 50%;
  border-bottom: 1.5px solid rgba(232, 169, 72, 0.50);
  border-right: 1.5px solid rgba(232, 169, 72, 0.50);
  border-radius: 0 0 16px 0;
}
.tree-row.row-player.branch-end::before {
  background: linear-gradient(180deg, transparent, rgba(232, 169, 72, 0.44), transparent);
  box-shadow: 0 0 8px rgba(232, 169, 72, 0.16);
}

.player-card {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  max-width: 260px;
  padding: 8px 10px;
  border: 1px solid rgba(181, 137, 61, 0.14);
  border-radius: 8px;
  background: rgba(10, 5, 6, 0.44);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.player-dot,
.branch-joint {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--blood);
  box-shadow: 0 0 6px rgba(155, 58, 46, 0.42);
}

.branch-joint {
  width: 9px;
  height: 9px;
  margin-top: 0;
  background: rgba(155, 58, 46, 0.82);
}

.player-dot.align-rejoined {
  background: var(--ember-bright);
  box-shadow: 0 0 7px rgba(232, 169, 72, 0.45);
}

.player-dot.align-aligned {
  background: var(--ember);
  box-shadow: 0 0 6px rgba(181, 137, 61, 0.35);
}

.player-copy {
  min-width: 0;
}

.player-title {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--prose-dim);
  word-break: break-word;
}

@keyframes source-breathe {
  0%, 100% { box-shadow: 0 0 10px rgba(232, 169, 72, 0.45), 0 0 22px rgba(181, 137, 61, 0.14); }
  50% { box-shadow: 0 0 18px rgba(232, 169, 72, 0.78), 0 0 34px rgba(181, 137, 61, 0.24); }
}

@keyframes source-pulse {
  0% { transform: scale(0.75); opacity: 0.45; }
  100% { transform: scale(1.75); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .tree-row {
    opacity: 1;
    transform: none;
    transition: none;
  }
  .tree-row.current .source-node,
  .source-pulse {
    animation: none;
  }
}
</style>
