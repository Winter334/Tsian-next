<script setup lang="ts">
/**
 * TimelineGraph — 纵向命轨树。
 *
 * DOM 负责排版卡片与语义节点；SVG path 负责主干、分支与卡片引线。
 * 这样轨道是一条真正的连续曲线，而不是由多段 CSS 边框拼接出来。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue"
import type { Frontier, SourceAnchor, PlayerAnchor } from "../../lib/frontier-types"

const props = defineProps<{
  frontier: Frontier
  plotOrder: number
  scrollRoot?: HTMLElement | null
}>()

type Side = "left" | "right"
type CardSide = "left" | "right"
type NodeLane = "trunk" | "branch-left" | "branch-right"
type TrackRole = "source-trunk" | "player-trunk" | "player-branch"
type BranchPhase = "none" | "start" | "mid" | "end"
type AnchorKind = "node" | "split" | "join" | "card"

interface RenderItem {
  key: string
  kind: "source" | "player"
  anchor: SourceAnchor | PlayerAnchor
  cardSide: CardSide
  nodeLane: NodeLane
  trackRole: TrackRole
  branchPhase: BranchPhase
  branchId: string | null
  branchSide: Side | null
  isCurrent: boolean
}

interface Point {
  x: number
  y: number
}

interface TrackBox {
  width: number
  height: number
}

interface BranchPath {
  id: string
  side: Side
  d: string
  open: boolean
}

interface LeaderPath {
  id: string
  kind: "source" | "player-trunk" | "player-branch"
  side: CardSide
  d: string
}

interface TrackPaths {
  trunk: string
  branches: BranchPath[]
  leaders: LeaderPath[]
}

const EMPTY_TRACK_PATHS: TrackPaths = { trunk: "", branches: [], leaders: [] }

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

const items = computed<RenderItem[]>(() => {
  const result: RenderItem[] = []
  let nextSide: Side = "left"
  let activeSide: Side | null = null
  let activeBranchId: string | null = null
  let branchIndex = 0

  for (const source of sources.value) {
    result.push({
      key: `src-${source.order}`,
      kind: "source",
      anchor: source,
      cardSide: "right",
      nodeLane: "trunk",
      trackRole: "source-trunk",
      branchPhase: "none",
      branchId: null,
      branchSide: null,
      isCurrent: source.order === currentSourceOrder.value,
    })

    const players = playersByOrder.value.get(source.order) ?? []
    for (const player of players) {
      if (player.alignment === "aligned") {
        result.push({
          key: `plr-${player.order}-${player.turn}`,
          kind: "player",
          anchor: player,
          cardSide: "left",
          nodeLane: "trunk",
          trackRole: "player-trunk",
          branchPhase: "none",
          branchId: null,
          branchSide: null,
          isCurrent: false,
        })
        continue
      }

      if (player.alignment === "rejoined" && activeSide === null) {
        result.push({
          key: `plr-${player.order}-${player.turn}`,
          kind: "player",
          anchor: player,
          cardSide: "left",
          nodeLane: "trunk",
          trackRole: "player-trunk",
          branchPhase: "none",
          branchId: null,
          branchSide: null,
          isCurrent: false,
        })
        continue
      }

      let phase: BranchPhase
      if (activeSide === null) {
        activeSide = nextSide
        activeBranchId = `branch-${branchIndex}`
        branchIndex += 1
        phase = "start"
      } else if (player.alignment === "rejoined") {
        phase = "end"
      } else {
        phase = "mid"
      }

      const branchSide = activeSide
      result.push({
        key: `plr-${player.order}-${player.turn}`,
        kind: "player",
        anchor: player,
        cardSide: branchSide,
        nodeLane: branchSide === "left" ? "branch-left" : "branch-right",
        trackRole: "player-branch",
        branchPhase: phase,
        branchId: activeBranchId,
        branchSide,
        isCurrent: false,
      })

      if (phase === "end") {
        activeSide = null
        activeBranchId = null
        nextSide = branchSide === "left" ? "right" : "left"
      }
    }
  }

  return result
})

const visibleKeys = ref<Set<string>>(new Set())
const treeRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)
const trackBox = ref<TrackBox>({ width: 0, height: 0 })
const trackPaths = ref<TrackPaths>(EMPTY_TRACK_PATHS)
let observer: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let autoLocated = false
let layoutRaf = 0
let measureRaf = 0

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

function setupResizeObserver(): void {
  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = null

  const body = bodyRef.value
  if (!body || typeof ResizeObserver === "undefined") return

  resizeObserver = new ResizeObserver(() => scheduleMeasure())
  resizeObserver.observe(body)
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
  if (layoutRaf !== 0) cancelAnimationFrame(layoutRaf)
  layoutRaf = requestAnimationFrame(() => {
    layoutRaf = 0
    void nextTick(() => {
      setupObserver()
      setupResizeObserver()
      measureTracks()
      maybeAutoLocate()
    })
  })
}

function scheduleMeasure(): void {
  if (measureRaf !== 0) cancelAnimationFrame(measureRaf)
  measureRaf = requestAnimationFrame(() => {
    measureRaf = 0
    void nextTick(measureTracks)
  })
}

function pointOf(el: HTMLElement, rootRect: DOMRect): Point {
  const rect = el.getBoundingClientRect()
  return {
    x: rect.left - rootRect.left + rect.width / 2,
    y: rect.top - rootRect.top + rect.height / 2,
  }
}

function collectAnchors(body: HTMLElement, rootRect: DOMRect): Map<string, Partial<Record<AnchorKind, Point>>> {
  const anchors = new Map<string, Partial<Record<AnchorKind, Point>>>()
  for (const el of body.querySelectorAll<HTMLElement>("[data-anchor-key][data-anchor-kind]")) {
    const key = el.dataset.anchorKey
    const kind = el.dataset.anchorKind as AnchorKind | undefined
    if (!key || !kind) continue
    const entry = anchors.get(key) ?? {}
    entry[kind] = pointOf(el, rootRect)
    anchors.set(key, entry)
  }
  return anchors
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : "0"
}

function moveTo(p: Point): string {
  return `M ${fmt(p.x)} ${fmt(p.y)}`
}

function lineTo(p: Point): string {
  return `L ${fmt(p.x)} ${fmt(p.y)}`
}

function branchStartCurve(from: Point, to: Point): string {
  const dx = to.x - from.x
  const c1 = { x: from.x + dx * 0.48, y: from.y }
  const c2 = { x: to.x - dx * 0.22, y: to.y }
  return `C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(to.x)} ${fmt(to.y)}`
}

function branchEndCurve(from: Point, to: Point): string {
  const dx = to.x - from.x
  const c1 = { x: from.x + dx * 0.22, y: from.y }
  const c2 = { x: to.x - dx * 0.48, y: to.y }
  return `C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(to.x)} ${fmt(to.y)}`
}

function leaderPath(from: Point, to: Point): string {
  const dx = to.x - from.x
  const c1 = { x: from.x + dx * 0.46, y: from.y }
  const c2 = { x: to.x - dx * 0.24, y: to.y }
  return `${moveTo(from)} C ${fmt(c1.x)} ${fmt(c1.y)}, ${fmt(c2.x)} ${fmt(c2.y)}, ${fmt(to.x)} ${fmt(to.y)}`
}

function buildTrunkPath(points: Point[], height: number): string {
  if (points.length === 0) return ""
  const sorted = [...points].sort((a, b) => a.y - b.y)
  const x = sorted.reduce((sum, p) => sum + p.x, 0) / sorted.length
  const firstY = sorted[0]!.y
  const lastY = sorted[sorted.length - 1]!.y
  const pad = points.length === 1 ? 46 : 34
  const start = { x, y: Math.max(0, firstY - pad) }
  const end = { x, y: Math.min(height, lastY + pad) }
  return `${moveTo(start)} ${lineTo(end)}`
}

function railPointBefore(node: Point, junction: Point): Point {
  const distance = Math.abs(node.y - junction.y)
  const offset = Math.min(18, Math.max(8, distance * 0.72))
  const y = node.y >= junction.y ? node.y - offset : node.y + offset
  return { x: node.x, y }
}

function railPointAfter(node: Point, junction: Point): Point {
  const distance = Math.abs(node.y - junction.y)
  const offset = Math.min(18, Math.max(8, distance * 0.72))
  const y = node.y <= junction.y ? node.y + offset : node.y - offset
  return { x: node.x, y }
}

function buildBranchPaths(anchors: Map<string, Partial<Record<AnchorKind, Point>>>): BranchPath[] {
  const branchMap = new Map<string, { id: string; side: Side; branchItems: RenderItem[] }>()

  for (const item of items.value) {
    if (item.trackRole !== "player-branch" || !item.branchId || !item.branchSide) continue
    const branch = branchMap.get(item.branchId)
    if (branch) branch.branchItems.push(item)
    else branchMap.set(item.branchId, { id: item.branchId, side: item.branchSide, branchItems: [item] })
  }

  const paths: BranchPath[] = []
  for (const branch of branchMap.values()) {
    const parts: string[] = []
    let started = false
    let lastNode: Point | null = null
    let closed = false

    for (const item of branch.branchItems) {
      const anchor = anchors.get(item.key)
      const node = anchor?.node
      if (!node) continue

      if (!started) {
        const split = item.branchPhase === "start" ? anchor?.split : null
        if (split) {
          const entry = railPointBefore(node, split)
          parts.push(moveTo(split), branchStartCurve(split, entry), lineTo(node))
        } else {
          parts.push(moveTo(node))
        }
        started = true
      } else {
        parts.push(lineTo(node))
      }

      lastNode = node

      if (item.branchPhase === "end") {
        const join = anchor?.join
        if (join) {
          const exit = railPointAfter(node, join)
          parts.push(lineTo(exit), branchEndCurve(exit, join))
          closed = true
        }
        break
      }
    }

    if (!started || !lastNode) continue
    if (!closed) {
      parts.push(lineTo({ x: lastNode.x, y: lastNode.y + 30 }))
    }

    paths.push({ id: branch.id, side: branch.side, d: parts.join(" "), open: !closed })
  }

  return paths
}

function buildLeaderPaths(anchors: Map<string, Partial<Record<AnchorKind, Point>>>): LeaderPath[] {
  const leaders: LeaderPath[] = []

  for (const item of items.value) {
    const anchor = anchors.get(item.key)
    const node = anchor?.node
    const card = anchor?.card
    if (!node || !card) continue

    leaders.push({
      id: `leader-${item.key}`,
      kind: item.trackRole === "source-trunk" ? "source" : item.trackRole === "player-trunk" ? "player-trunk" : "player-branch",
      side: item.cardSide,
      d: leaderPath(node, card),
    })
  }

  return leaders
}

function measureTracks(): void {
  const body = bodyRef.value
  if (!body) return

  const rect = body.getBoundingClientRect()
  const width = Math.max(rect.width, body.scrollWidth)
  const height = Math.max(rect.height, body.scrollHeight)
  trackBox.value = { width, height }

  const anchors = collectAnchors(body, rect)
  const trunkPoints = items.value
    .flatMap((item) => {
      const anchor = anchors.get(item.key)
      const points: Point[] = []
      if ((item.trackRole === "source-trunk" || item.trackRole === "player-trunk") && anchor?.node) {
        points.push(anchor.node)
      }
      if (item.branchPhase === "start" && anchor?.split) points.push(anchor.split)
      if (item.branchPhase === "end" && anchor?.join) points.push(anchor.join)
      return points
    })

  trackPaths.value = {
    trunk: buildTrunkPath(trunkPoints, height),
    branches: buildBranchPaths(anchors),
    leaders: buildLeaderPaths(anchors),
  }
}

watch(items, scheduleRefresh, { flush: "post", immediate: true })
watch(() => props.scrollRoot, scheduleRefresh, { flush: "post" })

onBeforeUnmount(() => {
  if (observer) observer.disconnect()
  if (resizeObserver) resizeObserver.disconnect()
  if (layoutRaf !== 0) cancelAnimationFrame(layoutRaf)
  if (measureRaf !== 0) cancelAnimationFrame(measureRaf)
})

function alignmentClass(player: PlayerAnchor): string {
  return `align-${player.alignment}`
}

function itemAlignmentClass(item: RenderItem): string {
  return item.kind === "player" ? `row-${alignmentClass(item.anchor as PlayerAnchor)}` : ""
}

function nodeAlignmentClass(item: RenderItem): string {
  return item.kind === "player" ? alignmentClass(item.anchor as PlayerAnchor) : ""
}
</script>

<template>
  <section class="timeline-tree" ref="treeRef" aria-label="剧情时间线命轨树">
    <div ref="bodyRef" class="tree-body" :class="{ 'source-only': !hasPlayers, branching: hasPlayers }" role="list">
      <svg
        v-if="trackBox.width > 0 && trackBox.height > 0"
        class="timeline-track-layer"
        :width="trackBox.width"
        :height="trackBox.height"
        :viewBox="`0 0 ${trackBox.width} ${trackBox.height}`"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter id="timelineTrackGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          v-if="trackPaths.trunk"
          class="timeline-track timeline-track--trunk"
          :d="trackPaths.trunk"
          pathLength="1"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-for="branch in trackPaths.branches"
          :key="branch.id"
          class="timeline-track timeline-track--branch"
          :class="[`timeline-track--${branch.side}`, { 'timeline-track--open': branch.open }]"
          :d="branch.d"
          pathLength="1"
          vector-effect="non-scaling-stroke"
        />
        <path
          v-for="leader in trackPaths.leaders"
          :key="leader.id"
          class="timeline-leader"
          :class="[`timeline-leader--${leader.kind}`, `timeline-leader--${leader.side}`]"
          :d="leader.d"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <div
        v-for="item in items"
        :key="item.key"
        class="tree-row"
        :class="[
          `row-${item.kind}`,
          `card-side-${item.cardSide}`,
          `node-lane-${item.nodeLane}`,
          `track-${item.trackRole}`,
          `branch-${item.branchPhase}`,
          item.branchSide ? `branch-side-${item.branchSide}` : '',
          itemAlignmentClass(item),
          { current: item.isCurrent, revealed: itemVisible(item.key) },
        ]"
        role="listitem"
        :data-reveal-key="item.key"
      >
        <template v-if="item.kind === 'source'">
          <div class="player-slot left-slot" />
          <div class="branch-lane lane-left" />
          <div class="tree-axis source-axis">
            <span
              class="timeline-node timeline-node--source timeline-node--trunk"
              :class="{ current: item.isCurrent }"
              :data-anchor-key="item.key"
              data-anchor-kind="node"
              aria-hidden="true"
            >
              <span v-if="item.isCurrent" class="source-pulse" />
            </span>
          </div>
          <div class="branch-lane lane-right" />
          <article class="source-card timeline-card">
            <span class="card-anchor" :data-anchor-key="item.key" data-anchor-kind="card" aria-hidden="true" />
            <h4 class="source-title">{{ (item.anchor as SourceAnchor).label }}</h4>
            <p class="source-meta">
              <span>第 {{ (item.anchor as SourceAnchor).chapter }} 章</span>
              <span v-if="chapterTitle(item.anchor as SourceAnchor)"> · {{ chapterTitle(item.anchor as SourceAnchor) }}</span>
            </p>
            <p class="source-time">{{ (item.anchor as SourceAnchor).time }}</p>
          </article>
        </template>

        <template v-else>
          <div class="player-slot left-slot">
            <article v-if="item.cardSide === 'left'" class="player-card player-card-left timeline-card">
              <span class="card-anchor" :data-anchor-key="item.key" data-anchor-kind="card" aria-hidden="true" />
              <div class="player-copy">
                <h4 class="player-title">{{ (item.anchor as PlayerAnchor).label }}</h4>
                <p class="player-meta">回合 {{ (item.anchor as PlayerAnchor).turn }} · {{ (item.anchor as PlayerAnchor).time }}</p>
              </div>
            </article>
          </div>

          <div class="branch-lane lane-left">
            <span
              v-if="item.nodeLane === 'branch-left'"
              class="timeline-node timeline-node--player timeline-node--branch"
              :class="nodeAlignmentClass(item)"
              :data-anchor-key="item.key"
              data-anchor-kind="node"
              aria-hidden="true"
            />
          </div>

          <div class="tree-axis branch-axis">
            <span
              v-if="item.nodeLane === 'trunk'"
              class="timeline-node timeline-node--player timeline-node--trunk"
              :class="nodeAlignmentClass(item)"
              :data-anchor-key="item.key"
              data-anchor-kind="node"
              aria-hidden="true"
            />
            <span
              v-if="item.branchPhase === 'start'"
              class="measure-anchor junction-anchor junction-anchor--split"
              :data-anchor-key="item.key"
              data-anchor-kind="split"
              aria-hidden="true"
            />
            <span
              v-if="item.branchPhase === 'end'"
              class="measure-anchor junction-anchor junction-anchor--join"
              :data-anchor-key="item.key"
              data-anchor-kind="join"
              aria-hidden="true"
            />
          </div>

          <div class="branch-lane lane-right">
            <span
              v-if="item.nodeLane === 'branch-right'"
              class="timeline-node timeline-node--player timeline-node--branch"
              :class="nodeAlignmentClass(item)"
              :data-anchor-key="item.key"
              data-anchor-kind="node"
              aria-hidden="true"
            />
          </div>

          <div class="player-slot right-slot">
            <article v-if="item.cardSide === 'right'" class="player-card player-card-right timeline-card">
              <span class="card-anchor" :data-anchor-key="item.key" data-anchor-kind="card" aria-hidden="true" />
              <div class="player-copy">
                <h4 class="player-title">{{ (item.anchor as PlayerAnchor).label }}</h4>
                <p class="player-meta">回合 {{ (item.anchor as PlayerAnchor).turn }} · {{ (item.anchor as PlayerAnchor).time }}</p>
              </div>
            </article>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.timeline-tree {
  position: relative;
  width: 100%;
  min-height: 100%;
  padding: 0 0 12px;
  display: flex;
  flex-direction: column;
}

.tree-body {
  --axis-width: 36px;
  --branch-gutter: 68px;
  --card-gap: 16px;
  --junction-clearance: 24px;
  --trunk-line: rgba(181, 137, 61, 0.80);
  --branch-line: rgba(155, 58, 46, 0.58);
  --branch-line-soft: rgba(155, 58, 46, 0.18);

  position: relative;
  display: flex;
  flex: 1 0 auto;
  flex-direction: column;
  justify-content: space-evenly;
  gap: 0;
  min-height: 100%;
  padding: 2px 0 12px;
}

.tree-body.source-only {
  max-width: 760px;
  margin: 0 auto;
}

.timeline-track-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: visible;
  pointer-events: none;
}

.timeline-track,
.timeline-leader {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.timeline-track--trunk {
  filter: drop-shadow(0 0 7px rgba(181, 137, 61, 0.42));
  stroke: rgba(232, 169, 72, 0.72);
  stroke-width: 2.4;
  opacity: 1;
  animation: trunk-breathe 6.8s ease-in-out infinite;
}

.timeline-track--branch {
  filter: drop-shadow(0 0 5px rgba(155, 58, 46, 0.32));
  stroke: var(--branch-line);
  stroke-width: 1.6;
  opacity: 0.9;
}

.timeline-track--open {
  opacity: 0.62;
}

.timeline-leader {
  stroke-width: 1.15;
  opacity: 0.62;
}

.timeline-leader--source {
  stroke: rgba(232, 169, 72, 0.55);
}

.timeline-leader--player-branch {
  stroke: rgba(155, 58, 46, 0.42);
}

.timeline-leader--player-trunk {
  stroke: rgba(181, 137, 61, 0.40);
}

.tree-row {
  position: relative;
  z-index: 2;
  display: grid;
  grid-template-columns:
    minmax(220px, 0.68fr)
    var(--branch-gutter)
    var(--axis-width)
    var(--branch-gutter)
    minmax(360px, 1.32fr);
  align-items: center;
  min-height: 104px;
  opacity: 0;
  transition: opacity 0.42s ease;
}

.tree-body.source-only .tree-row {
  grid-template-columns: 82px 0 var(--axis-width) 34px minmax(360px, 1fr);
  min-height: 102px;
}

.tree-row.revealed {
  opacity: 1;
}

.tree-row.row-player {
  min-height: 88px;
}

.player-slot,
.branch-lane,
.tree-axis {
  position: relative;
  min-width: 0;
  align-self: stretch;
}

.player-slot {
  display: flex;
  align-items: center;
}

.left-slot { justify-content: flex-end; }
.right-slot { justify-content: flex-start; }

.tree-axis {
  display: flex;
  align-items: center;
  justify-content: center;
}

.timeline-node,
.measure-anchor {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

.measure-anchor {
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.timeline-node {
  z-index: 5;
  border-radius: 50%;
  pointer-events: none;
}

.timeline-node--source {
  width: 14px;
  height: 14px;
  background: var(--ember);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.55), 0 0 24px rgba(181, 137, 61, 0.16);
  animation: node-ember-drift 5.6s ease-in-out infinite;
}

.timeline-node--source::after {
  content: "";
  position: absolute;
  inset: -7px;
  border: 1px solid rgba(181, 137, 61, 0.24);
  border-radius: 50%;
}

.tree-row.current .timeline-node--source {
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

.timeline-node--player {
  width: 9px;
  height: 9px;
  background: var(--blood);
  box-shadow: 0 0 7px rgba(155, 58, 46, 0.42), 0 0 15px rgba(43, 4, 4, 0.44);
}

.timeline-node--player.align-rejoined {
  background: var(--ember-bright);
  box-shadow: 0 0 7px rgba(232, 169, 72, 0.45), 0 0 16px rgba(43, 4, 4, 0.44);
}

.timeline-node--player.align-aligned {
  width: 7px;
  height: 7px;
  background: var(--ember);
  box-shadow: 0 0 6px rgba(181, 137, 61, 0.36), 0 0 14px rgba(43, 4, 4, 0.36);
}

.tree-row.branch-start .junction-anchor--split {
  top: calc(50% - var(--junction-clearance));
}

.tree-row.branch-end .junction-anchor--join {
  top: calc(50% + var(--junction-clearance));
}

.timeline-card {
  position: relative;
  z-index: 4;
}

.card-anchor {
  position: absolute;
  top: 50%;
  width: 1px;
  height: 1px;
  transform: translateY(-50%);
  opacity: 0;
  pointer-events: none;
}

.source-card .card-anchor,
.player-card-right .card-anchor {
  left: 0;
}

.player-card-left .card-anchor {
  right: 0;
}

.source-card {
  justify-self: start;
  width: min(100%, 520px);
  min-width: 0;
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

.player-card {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  width: min(100%, 270px);
  padding: 8px 10px;
  border: 1px solid rgba(181, 137, 61, 0.14);
  background: rgba(10, 5, 6, 0.44);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.player-card-left {
  margin-right: var(--card-gap);
  text-align: right;
  border-color: rgba(181, 137, 61, 0.10);
  border-right: 1.5px solid rgba(181, 137, 61, 0.30);
  border-radius: 12px 4px 4px 12px;
  background:
    radial-gradient(circle at 100% 50%, rgba(181, 137, 61, 0.13), transparent 54%),
    linear-gradient(270deg, rgba(181, 137, 61, 0.075), rgba(10, 5, 6, 0.34) 48%, rgba(10, 5, 6, 0.16));
  box-shadow:
    inset -10px 0 18px rgba(181, 137, 61, 0.025),
    0 0 18px rgba(43, 4, 4, 0.20);
}

.track-player-branch .player-card-left {
  border-right-color: rgba(155, 58, 46, 0.42);
  background:
    radial-gradient(circle at 100% 50%, rgba(155, 58, 46, 0.16), transparent 56%),
    linear-gradient(270deg, rgba(155, 58, 46, 0.11), rgba(10, 5, 6, 0.36) 48%, rgba(10, 5, 6, 0.16));
  box-shadow:
    inset -10px 0 18px rgba(155, 58, 46, 0.035),
    0 0 20px rgba(43, 4, 4, 0.22);
}

.player-card-right {
  margin-left: var(--card-gap);
  border-left-color: rgba(155, 58, 46, 0.36);
  border-radius: 3px 8px 8px 3px;
  background:
    linear-gradient(90deg, rgba(155, 58, 46, 0.10), rgba(10, 5, 6, 0.44) 42%),
    rgba(10, 5, 6, 0.34);
}

.player-copy {
  min-width: 0;
  flex: 1;
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

@keyframes node-ember-drift {
  0%, 100% { filter: brightness(0.98); }
  50% { filter: brightness(1.16); }
}

@keyframes trunk-breathe {
  0%, 100% { opacity: 0.82; }
  50% { opacity: 1; }
}

@keyframes source-pulse {
  0% { transform: scale(0.75); opacity: 0.45; }
  100% { transform: scale(1.75); opacity: 0; }
}

@media (max-width: 860px) {
  .tree-body {
    --axis-width: 32px;
    --branch-gutter: 50px;
    --card-gap: 12px;
    --junction-clearance: 20px;
  }

  .tree-row {
    grid-template-columns:
      minmax(170px, 0.72fr)
      var(--branch-gutter)
      var(--axis-width)
      var(--branch-gutter)
      minmax(260px, 1.28fr);
    min-height: 98px;
  }

  .tree-body.source-only .tree-row {
    grid-template-columns: 64px 0 var(--axis-width) 28px minmax(260px, 1fr);
  }

  .source-card {
    max-width: 460px;
  }

  .player-card {
    width: min(100%, 230px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .tree-row {
    opacity: 1;
    transition: none;
  }
  .timeline-track--trunk,
  .timeline-node--source,
  .tree-row.current .timeline-node--source,
  .source-pulse {
    animation: none;
  }
}
</style>
