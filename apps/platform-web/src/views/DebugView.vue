<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <component :is="statusIcon" class="h-4 w-4 shrink-0" :class="overallStatus.iconClass" aria-hidden="true" />
        <div class="min-w-0">
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon">System Monitor</p>
          <h1 class="truncate text-base font-bold text-text-main">系统监视器</h1>
        </div>
      </div>
      <span
        class="inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs"
        :class="overallStatus.badgeClass"
      >
        <span class="h-2 w-2" :class="overallStatus.dotClass" aria-hidden="true" />
        {{ overallStatus.label }}
      </span>
    </header>

    <main class="min-h-0 overflow-auto p-3">
      <div v-if="loading && !lastRefreshAt" class="retro-inset grid h-full min-h-[420px] place-items-center p-4">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取运行时状态</p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset grid h-full min-h-[420px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">系统监视器不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
          <button
            type="button"
            class="retro-button retro-focus mt-4 inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            @click="refreshAll"
          >
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            重试
          </button>
        </div>
      </div>

      <div v-else class="grid min-w-0 gap-3">
        <nav class="retro-inset flex flex-wrap gap-1 p-1" aria-label="系统监视器分区">
          <button
            v-for="tab in monitorTabs"
            :key="tab.id"
            type="button"
            class="retro-focus inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs transition-colors"
            :class="activeMonitorTab === tab.id
              ? 'border-neon bg-neon/15 text-neon shadow-neon-glow'
              : 'border-transparent text-text-dim hover:border-neon-deep/45 hover:bg-elevated/40 hover:text-text-main'"
            :aria-current="activeMonitorTab === tab.id ? 'page' : undefined"
            @click="activeMonitorTab = tab.id"
          >
            <span class="text-[10px] uppercase tracking-wider opacity-70">{{ tab.code }}</span>
            <span>{{ tab.label }}</span>
          </button>
        </nav>

        <div v-if="activeMonitorTab === 'overview'" class="grid min-w-0 gap-3">
        <!-- KPI 卡片行 -->
        <section class="grid min-w-0 gap-3 sm:grid-cols-3">
          <!-- 缓存命中 -->
          <article class="retro-inset grid content-start gap-2 p-4">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">缓存命中</p>
            <div class="flex items-baseline gap-2">
              <span v-if="latestCacheHitRate !== null" class="font-mono text-3xl font-bold text-neon glow-text">{{ latestCacheHitRate }}%</span>
              <span v-else class="font-mono text-xl text-text-dim">—</span>
            </div>
            <p v-if="latestAiCall" class="truncate font-mono text-[10px] text-text-dim">
              {{ latestAiCall.providerKind ?? "unknown" }} · {{ latestAiCall.model || "?" }}
            </p>
            <div v-if="latestCacheShares" class="flex h-1.5 overflow-hidden border border-neon-deep/30">
              <div class="bg-neon" :style="{ width: latestCacheShares.cached + '%' }" :title="`cached ${latestCacheShares.cachedTokens}`" />
              <div class="bg-neon-deep" :style="{ width: latestCacheShares.cacheCreation + '%' }" :title="`cache write ${latestCacheShares.cacheCreationTokens}`" />
              <div class="bg-warning/70" :style="{ width: latestCacheShares.miss + '%' }" :title="`miss ${latestCacheShares.missTokens}`" />
            </div>
            <div v-if="latestCacheShares" class="flex flex-wrap gap-x-3 font-mono text-[10px]">
              <span class="text-neon">● {{ formatTokens(latestCacheShares.cachedTokens) }}</span>
              <span v-if="latestCacheShares.cacheCreationTokens > 0" class="text-neon-deep">● {{ formatTokens(latestCacheShares.cacheCreationTokens) }}</span>
              <span class="text-warning/80">● {{ formatTokens(latestCacheShares.missTokens) }}</span>
            </div>
          </article>

          <!-- Token 累计 -->
          <article class="retro-inset grid content-start gap-2 p-4">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">Token 累计</p>
            <p class="font-mono text-3xl font-bold text-neon glow-text">{{ formatTokens(tokenStats.totalTotal) }}</p>
            <div v-if="tokenStats.totalTotal > 0" class="flex h-1.5 overflow-hidden border border-neon-deep/30">
              <div class="bg-neon" :style="{ width: tokenShare.input + '%' }" />
              <div class="bg-neon-deep/50" :style="{ width: tokenShare.output + '%' }" />
            </div>
            <div v-if="tokenStats.totalTotal > 0" class="flex justify-between font-mono text-[10px]">
              <span class="text-text-main">in {{ formatTokens(tokenStats.inputTotal) }}</span>
              <span class="text-text-dim">out {{ formatTokens(tokenStats.outputTotal) }}</span>
            </div>
          </article>

          <!-- AI 调用 -->
          <article class="retro-inset grid content-start gap-2 p-4">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">AI 调用</p>
            <div class="flex items-baseline gap-1.5">
              <span class="font-mono text-3xl font-bold text-text-main">{{ tokenStats.totalCalls }}</span>
              <span class="font-mono text-[11px] text-text-dim">次</span>
            </div>
            <p class="font-mono text-[10px] text-text-dim">{{ providerStats.length }} 个 provider/model</p>
          </article>
        </section>

        <!-- 近期调用消耗（token 叠柱 + 缓存命中折线）-->
        <section v-if="usageChartBars.length > 0" class="retro-inset grid gap-3 p-5">
          <div class="flex items-center justify-between gap-3">
            <p class="font-mono text-[11px] uppercase tracking-wider text-text-dim">近期调用消耗</p>
            <span class="font-mono text-[10px] text-text-dim">峰值 {{ formatTokens(usageChartPeakTotal) }} · 最近 {{ usageChartBars.length }} 次</span>
          </div>
          <svg viewBox="0 0 100 46" preserveAspectRatio="none" shape-rendering="crispEdges" class="h-40 w-full overflow-visible md:h-44">
            <line x1="5" y1="40" x2="98" y2="40" stroke="currentColor" stroke-width="0.25" vector-effect="non-scaling-stroke" class="text-neon-deep/50" />
            <line x1="5" y1="22.5" x2="98" y2="22.5" stroke="currentColor" stroke-width="0.18" stroke-dasharray="1,1" vector-effect="non-scaling-stroke" class="text-neon-deep/35" />
            <line x1="5" y1="5" x2="98" y2="5" stroke="currentColor" stroke-width="0.25" vector-effect="non-scaling-stroke" class="text-neon-deep/35" />
            <g v-for="bar in usageChartBars" :key="bar.id">
              <title>{{ usageChartBarTitle(bar) }}</title>
              <rect
                v-if="bar.hCached > 0"
                class="usage-chart-bar"
                :style="usageChartAnimationStyle(bar)"
                :x="bar.x"
                :y="bar.yCached"
                :width="bar.width"
                :height="bar.hCached"
                fill="#5ee08b"
                opacity="0.95"
              />
              <rect
                v-if="bar.hCacheCreation > 0"
                class="usage-chart-bar"
                :style="usageChartAnimationStyle(bar)"
                :x="bar.x"
                :y="bar.yCacheCreation"
                :width="bar.width"
                :height="bar.hCacheCreation"
                fill="#9f8cff"
                opacity="0.9"
              />
              <rect
                v-if="bar.hMiss > 0"
                class="usage-chart-bar"
                :style="usageChartAnimationStyle(bar)"
                :x="bar.x"
                :y="bar.yMiss"
                :width="bar.width"
                :height="bar.hMiss"
                fill="#ffb454"
                opacity="0.88"
              />
              <rect
                v-if="bar.hOutput > 0"
                class="usage-chart-bar"
                :style="usageChartAnimationStyle(bar)"
                :x="bar.x"
                :y="bar.yOutput"
                :width="bar.width"
                :height="bar.hOutput"
                fill="#57c7ff"
                opacity="0.82"
              />
            </g>
            <polyline
              v-for="segment in usageChartLineSegments"
              :key="segment.id"
              class="usage-chart-hit-line"
              :points="segment.points"
              fill="none"
              stroke="#f6ecd7"
              stroke-width="1.05"
              stroke-linecap="square"
              stroke-linejoin="miter"
              vector-effect="non-scaling-stroke"
              shape-rendering="geometricPrecision"
            />
            <line
              v-for="dot in usageChartLineDots"
              :key="dot.id"
              class="usage-chart-hit-marker"
              :style="usageChartAnimationStyle(dot)"
              :x1="dot.x - 1.25"
              :x2="dot.x + 1.25"
              :y1="dot.y"
              :y2="dot.y"
              stroke="#f6ecd7"
              stroke-width="1.55"
              stroke-linecap="square"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <div class="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-text-dim">
            <span style="color: #5ee08b">■ 缓存命中</span>
            <span style="color: #9f8cff">■ 缓存写入</span>
            <span style="color: #ffb454">■ 未命中输入</span>
            <span style="color: #57c7ff">■ 输出</span>
            <span style="color: #f6ecd7">━ 命中率</span>
          </div>
        </section>

        <!-- Provider 统计（独立面板）-->
        <section v-if="providerStats.length > 0" class="retro-inset grid gap-2 p-4">
          <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">Provider 统计</p>
          <div class="grid gap-0.5">
            <div
              v-for="stat in providerStats"
              :key="`${stat.provider}-${stat.model}`"
              class="grid grid-cols-[minmax(0,1fr)_3rem_3rem] items-center gap-3 border-b border-neon-deep/15 py-1 font-mono text-[11px] last:border-b-0"
            >
              <span class="truncate text-text-main">{{ stat.provider }} · {{ stat.model }}</span>
              <span class="text-right text-text-dim">{{ stat.calls }}次</span>
              <span v-if="stat.avgHitRate !== null" class="text-right text-neon">{{ stat.avgHitRate }}%</span>
              <span v-else class="text-right text-text-dim">—</span>
            </div>
          </div>
        </section>
        </div>

        <div v-else-if="activeMonitorTab === 'recovery'" class="grid min-w-0 gap-3">
        <!-- 检查点（兜底恢复） -->
        <section class="grid gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <FileClock class="h-4 w-4 text-neon" aria-hidden="true" />
              <p class="font-mono text-xs uppercase tracking-wider text-neon">检查点</p>
            </div>
            <span class="font-mono text-xs text-text-dim">{{ checkpointItems.length }} 个可恢复点</span>
          </div>

          <div v-if="checkpointItems.length > 0" class="grid gap-2">
            <article
              v-for="item in checkpointItems"
              :key="checkpointId(item)"
              class="grid gap-3 border border-neon-deep/35 bg-panel/60 p-3 lg:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-sm font-bold text-text-main">{{ checkpointLabel(item) }}</span>
                  <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-0.5 font-mono text-[11px] text-text-dim">
                    Turn {{ checkpointTurn(item) }}
                  </span>
                  <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-0.5 font-mono text-[11px] text-text-dim">
                    {{ checkpointReasonLabel(item) }}
                  </span>
                </div>
                <p class="mt-2 font-mono text-[11px] text-text-dim">{{ checkpointTime(item) }}</p>
                <p class="mt-1 text-xs text-text-dim">
                  {{ checkpointMessageCount(item) }} 条消息 · {{ checkpointWorkspaceFileCount(item) }} 个运行时文件
                </p>
              </div>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-8 items-center justify-center gap-2 px-3 font-mono text-xs"
                @click="restoreCheckpoint(checkpointId(item))"
              >
                <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
                恢复
              </button>
            </article>
          </div>
          <p v-else class="border border-neon-deep/35 bg-panel/60 p-4 text-sm text-text-dim">暂无检查点。</p>
        </section>

        <!-- 运行日志（trace 人类可读事件流） -->
        <section class="grid gap-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <Terminal class="h-4 w-4 text-neon" aria-hidden="true" />
              <p class="font-mono text-xs uppercase tracking-wider text-neon">运行日志</p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center gap-1 px-2 font-mono text-[11px] disabled:opacity-40"
                :disabled="traceViewTurn <= 1 || traceLoading"
                @click="stepTraceTurn(-1)"
              >
                <ChevronLeft class="h-3 w-3" aria-hidden="true" /> 上一回合
              </button>
              <span class="font-mono text-[11px] text-text-dim">Turn {{ traceViewTurn || "--" }}</span>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center gap-1 px-2 font-mono text-[11px] disabled:opacity-40"
                :disabled="traceViewTurn >= runtimeTurn || traceLoading"
                @click="stepTraceTurn(1)"
              >
                下一回合 <ChevronRight class="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-7 items-center gap-1 px-2 font-mono text-[11px] disabled:opacity-40"
                :disabled="traceViewTurn >= runtimeTurn || traceLoading"
                title="跳到最新回合"
                @click="jumpTraceToLatest"
              >
                最新
              </button>
            </div>
          </div>

          <div class="retro-inset min-h-[280px] overflow-auto">
            <pre v-if="traceText" class="whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-5 text-text-main">{{ traceText }}</pre>
            <p v-else-if="traceLoading" class="grid h-full min-h-[260px] place-items-center font-mono text-xs uppercase tracking-[0.22em] text-neon">
              正在加载运行日志
            </p>
            <p v-else-if="!platformContext?.activeSaveId" class="grid h-full min-h-[260px] place-items-center font-mono text-[11px] text-text-dim">
              当前无活动存档
            </p>
            <p v-else class="grid h-full min-h-[260px] place-items-center font-mono text-[11px] text-text-dim">
              该回合暂无 trace 事件
            </p>
          </div>
        </section>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center gap-2 border-t px-3 py-2">
      <span class="font-mono text-[11px] text-text-dim">{{ lastRefreshAt ? `上次刷新：${lastRefreshAt}` : "尚未刷新" }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import type {
  AiDebugRecord,
  PlatformContextShell,
  RuntimeDiagnosticSummary,
  SessionHistoryEntry,
} from "@tsian/contracts"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileClock, RefreshCw, RotateCcw, Terminal } from "lucide-vue-next"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue"
import { playFrontendBridge, waitForPlatformHostReady } from "../platform-host"
import { formatTraceForHuman, type RuntimeTraceEvent } from "../agent-runtime/trace"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"

interface TraceEventShape {
  type: string
  timestamp: number
  turn: number
  agentId?: string
  debugLabel?: string
  ok?: boolean
  data?: Record<string, unknown>
}

interface RuntimeTraceLoadout {
  turn: number
  traceKind: string
  failedAt?: number
  events: TraceEventShape[]
  malformedLineCount: number
}

interface UsageChartPoint {
  id: string
  input: number
  output: number
  cached: number
  cacheCreation: number
  miss: number
  total: number
  hitRate: number | null
}

interface UsageChartBar extends UsageChartPoint {
  x: number
  width: number
  lineX: number
  lineY: number | null
  animationDelayMs: number
  yCached: number
  hCached: number
  yCacheCreation: number
  hCacheCreation: number
  yMiss: number
  hMiss: number
  yOutput: number
  hOutput: number
}

const USAGE_CHART_LIMIT = 20
const USAGE_CHART_LEFT = 5
const USAGE_CHART_RIGHT = 98
const USAGE_CHART_TOP = 5
const USAGE_CHART_BOTTOM = 40
const USAGE_CHART_HEIGHT = USAGE_CHART_BOTTOM - USAGE_CHART_TOP
const USAGE_CHART_BAR_MAX_WIDTH = 5.8
const USAGE_CHART_BAR_MIN_WIDTH = 1.8
const USAGE_CHART_BAR_GAP = 1.25

const loading = ref(false)
const errorMessage = ref("")
const lastRefreshAt = ref("")
const platformContext = shallowRef<PlatformContextShell | null>(null)
const aiDebugRecords = shallowRef<AiDebugRecord[]>([])
const sessionHistory = shallowRef<SessionHistoryEntry[]>([])
const checkpointItems = shallowRef<unknown[]>([])
const diagnosticItems = shallowRef<RuntimeDiagnosticSummary[]>([])

// 运行日志浏览器：默认显示最新回合，可切换历史回合。
const traceViewTurn = ref(0)
const traceLoading = ref(false)
const traceLoadout = shallowRef<RuntimeTraceLoadout | null>(null)

let unsubscribeTurnReady: (() => void) | null = null

const runtimeTurn = computed(() => {
  const entries = sessionHistory.value
  return entries.length > 0 ? Math.max(...entries.map((e) => e.turn)) : 0
})

const tokenStats = computed(() => {
  let inputTotal = 0
  let outputTotal = 0
  let totalTotal = 0

  for (const record of aiDebugRecords.value) {
    const usage = record.usage
    if (!usage) continue
    const input = usage.input ?? 0
    const output = usage.output ?? 0
    const total = usage.total ?? (input + output)
    inputTotal += input
    outputTotal += output
    totalTotal += total
  }

  return { inputTotal, outputTotal, totalTotal, totalCalls: aiDebugRecords.value.length }
})

const latestAiCall = computed(() => {
  let latest: AiDebugRecord | null = null
  for (const record of aiDebugRecords.value) {
    if (!latest || record.createdAt > latest.createdAt) {
      latest = record
    }
  }
  return latest
})

const tokenShare = computed(() => {
  const total = tokenStats.value.totalTotal
  if (total <= 0) return { input: 0, output: 0 }
  return {
    input: Math.round((tokenStats.value.inputTotal / total) * 100),
    output: Math.round((tokenStats.value.outputTotal / total) * 100),
  }
})

// ── 缓存命中（provider 真实数据，非本地估算）──────────────────────────────
// 任务 06-30-debugview-cache-hit-display：删掉 stablePrefixChars/Ratio/cacheBreakpointLabel
// 本地字符估算，改用 provider 返回的 cached_tokens 真实命中率。

/** 最近一次调用的真实缓存命中率（cached/prompt_tokens，%）。无 cached 数据时 null。 */
const latestCacheHitRate = computed(() => {
  const call = latestAiCall.value
  if (!call?.usage) return null
  const cached = call.usage.cached
  const input = call.usage.input
  if (typeof cached !== "number" || typeof input !== "number" || input <= 0) return null
  return Math.round((cached / input) * 100)
})

/** 最近一次调用的 token 构成：cached/cacheCreation/miss（按 input 比例涂色）。 */
const latestCacheShares = computed(() => {
  const call = latestAiCall.value
  if (!call?.usage) return null
  const input = call.usage.input ?? 0
  const cached = call.usage.cached ?? 0
  const cacheCreation = call.usage.cacheCreation ?? 0
  if (input <= 0) return null
  const miss = Math.max(0, input - cached - cacheCreation)
  return {
    cached: Math.round((cached / input) * 100),
    cacheCreation: Math.round((cacheCreation / input) * 100),
    miss: Math.round((miss / input) * 100),
    cachedTokens: cached,
    cacheCreationTokens: cacheCreation,
    missTokens: miss,
    inputTokens: input,
  }
})

/** 最近调用的 token 消耗和缓存命中点。无 usage 的调用不参与 token 图。 */
const usageChartPoints = computed<UsageChartPoint[]>(() => {
  const sorted = [...aiDebugRecords.value].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const points: UsageChartPoint[] = []

  for (const record of sorted) {
    const usage = record.usage
    if (!usage) continue

    const cachedRaw = Math.max(0, usage.cached ?? 0)
    const cacheCreationRaw = Math.max(0, usage.cacheCreation ?? 0)
    const input = Math.max(0, usage.input ?? cachedRaw + cacheCreationRaw)
    const output = Math.max(0, usage.output ?? Math.max(0, (usage.total ?? 0) - input))
    const cached = clampNumber(cachedRaw, 0, input)
    const cacheCreation = clampNumber(cacheCreationRaw, 0, Math.max(0, input - cached))
    const miss = Math.max(0, input - cached - cacheCreation)
    const total = input + output

    if (total <= 0) continue

    points.push({
      id: record.id,
      input,
      output,
      cached,
      cacheCreation,
      miss,
      total,
      hitRate: input > 0 && typeof usage.cached === "number" ? Math.round((cached / input) * 100) : null,
    })
  }

  return points.slice(-USAGE_CHART_LIMIT)
})

const usageChartPeakTotal = computed(() => Math.max(...usageChartPoints.value.map((point) => point.total), 0))

const usageChartBars = computed<UsageChartBar[]>(() => {
  const points = usageChartPoints.value
  if (points.length === 0) return []

  const maxTotal = Math.max(usageChartPeakTotal.value, 1)
  const chartWidth = USAGE_CHART_RIGHT - USAGE_CHART_LEFT
  const slotWidth = chartWidth / points.length
  const barWidth = clampNumber(slotWidth - USAGE_CHART_BAR_GAP, USAGE_CHART_BAR_MIN_WIDTH, USAGE_CHART_BAR_MAX_WIDTH)

  return points.map((point, index) => {
    const lineX = points.length === 1
      ? USAGE_CHART_LEFT + chartWidth / 2
      : USAGE_CHART_LEFT + index * slotWidth + slotWidth / 2
    const x = lineX - barWidth / 2
    let y = USAGE_CHART_BOTTOM
    const partHeight = (value: number) => (value / maxTotal) * USAGE_CHART_HEIGHT

    const hCached = partHeight(point.cached)
    y -= hCached
    const yCached = y

    const hCacheCreation = partHeight(point.cacheCreation)
    y -= hCacheCreation
    const yCacheCreation = y

    const hMiss = partHeight(point.miss)
    y -= hMiss
    const yMiss = y

    const hOutput = partHeight(point.output)
    y -= hOutput
    const yOutput = y

    const lineY = point.hitRate === null
      ? null
      : USAGE_CHART_BOTTOM - (point.hitRate / 100) * USAGE_CHART_HEIGHT

    return {
      ...point,
      x,
      width: barWidth,
      lineX,
      lineY,
      animationDelayMs: index * 24,
      yCached,
      hCached,
      yCacheCreation,
      hCacheCreation,
      yMiss,
      hMiss,
      yOutput,
      hOutput,
    }
  })
})

const usageChartLineSegments = computed(() => {
  const segments: Array<{ id: string; points: string }> = []
  let current: string[] = []
  let segmentIndex = 0

  const flush = () => {
    if (current.length > 1) {
      segments.push({ id: `hit-${segmentIndex}`, points: current.join(" ") })
      segmentIndex += 1
    }
    current = []
  }

  for (const bar of usageChartBars.value) {
    if (bar.lineY === null) {
      flush()
      continue
    }
    current.push(`${bar.lineX.toFixed(2)},${bar.lineY.toFixed(2)}`)
  }
  flush()

  return segments
})

const usageChartLineDots = computed(() => usageChartBars.value
  .filter((bar): bar is UsageChartBar & { lineY: number } => bar.lineY !== null)
  .map((bar) => ({ id: bar.id, x: bar.lineX, y: bar.lineY, animationDelayMs: bar.animationDelayMs + 120 })))

/** 按 provider+model 分组的统计。 */
const providerStats = computed(() => {
  const groups = new Map<string, { provider: string; model: string; calls: number; cachedSum: number; inputSum: number; outputSum: number; cacheHitCalls: number }>()
  for (const record of aiDebugRecords.value) {
    const provider = record.providerKind ?? "unknown"
    const model = record.model ?? "unknown"
    const key = `${provider}::${model}`
    let g = groups.get(key)
    if (!g) {
      g = { provider, model, calls: 0, cachedSum: 0, inputSum: 0, outputSum: 0, cacheHitCalls: 0 }
      groups.set(key, g)
    }
    g.calls += 1
    if (record.usage) {
      g.inputSum += record.usage.input ?? 0
      g.outputSum += record.usage.output ?? 0
      if (typeof record.usage.cached === "number") {
        g.cachedSum += record.usage.cached
        g.cacheHitCalls += 1
      }
    }
  }
  return [...groups.values()].map((g) => ({
    ...g,
    avgHitRate: g.inputSum > 0 ? Math.round((g.cachedSum / g.inputSum) * 100) : null,
  })).sort((a, b) => b.calls - a.calls)
})

// 运行日志：把 trace events 渲染为人类可读事件流（非 JSONL 原文）。
const traceText = computed(() => {
  const loadout = traceLoadout.value
  if (!loadout || loadout.events.length === 0) return ""
  return formatTraceForHuman(loadout.events as RuntimeTraceEvent[])
})

const overallStatus = computed(() => {
  // 只看最新回合的诊断——历史错误已在 trace 日志中可查，
  // 状态徽章反映"当前是否健康"，不积累全量历史。
  const latest = diagnosticItems.value[0]
  const hasDiagnosticError = latest && (latest.severity === "error" || latest.status === "failed")
  const hasWarning = latest && (latest.severity === "warning" || latest.status === "anomalous")

  if (hasDiagnosticError) {
    return {
      label: "需要关注",
      detail: "最近的运行记录包含错误。查看下方运行日志。",
      badgeClass: "border-danger/50 bg-danger/10 text-danger",
      dotClass: "bg-danger",
      iconClass: "text-danger",
      textClass: "text-danger",
      icon: AlertTriangle,
    }
  }

  if (!platformContext.value?.activeSaveId) {
    return {
      label: "未选择存档",
      detail: "当前没有活动存档，运行时查询会返回空结果。",
      badgeClass: "border-warning/50 bg-warning/10 text-warning",
      dotClass: "bg-warning",
      iconClass: "text-warning",
      textClass: "text-warning",
      icon: AlertTriangle,
    }
  }

  if (hasWarning) {
    return {
      label: "有警告",
      detail: "运行时没有致命错误，但诊断摘要中存在警告项。",
      badgeClass: "border-warning/50 bg-warning/10 text-warning",
      dotClass: "bg-warning",
      iconClass: "text-warning",
      textClass: "text-warning",
      icon: AlertTriangle,
    }
  }

  return {
    label: "运行正常",
    detail: "当前监视器没有发现错误或警告。",
    badgeClass: "border-neon/45 bg-neon/10 text-neon",
    dotClass: "bg-neon",
    iconClass: "text-neon",
    textClass: "text-text-dim",
    icon: CheckCircle2,
  }
})

const statusIcon = computed(() => overallStatus.value.icon)

function formatTokens(value: number): string {
  return value.toLocaleString()
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function usageChartBarTitle(bar: UsageChartBar): string {
  const parts = [
    `总计 ${formatTokens(bar.total)}`,
    `输入 ${formatTokens(bar.input)}`,
    `输出 ${formatTokens(bar.output)}`,
  ]
  if (bar.cached > 0) parts.push(`缓存命中 ${formatTokens(bar.cached)}`)
  if (bar.cacheCreation > 0) parts.push(`缓存写入 ${formatTokens(bar.cacheCreation)}`)
  if (bar.hitRate !== null) parts.push(`命中率 ${bar.hitRate}%`)
  return parts.join(" · ")
}

function usageChartAnimationStyle(item: { animationDelayMs?: number }): Record<string, string> {
  return { animationDelay: `${item.animationDelayMs ?? 0}ms` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function isRuntimeDiagnosticSummary(value: unknown): value is RuntimeDiagnosticSummary {
  return isRecord(value)
    && value.schema === "tsian.runtime.diagnostic.v1"
    && typeof value.turn === "number"
    && Array.isArray(value.facts)
}

function normalizeDiagnostics(items: unknown[]): RuntimeDiagnosticSummary[] {
  return items
    .filter(isRuntimeDiagnosticSummary)
    .sort((a, b) => b.turn - a.turn)
}

function checkpointId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : ""
}

function checkpointLabel(value: unknown): string {
  return isRecord(value) && typeof value.label === "string"
    ? value.label
    : checkpointId(value) || "检查点"
}

function checkpointTurn(value: unknown): string {
  const turn = isRecord(value) ? readNumber(value.turn) : null
  return turn === null ? "--" : String(turn)
}

function checkpointReasonLabel(value: unknown): string {
  if (!isRecord(value)) return "unknown"
  if (value.reason === "initial") return "初始"
  if (value.reason === "after-turn") return "回合后"
  if (value.reason === "manual") return "手动"
  if (value.reason === "post-turn-maintenance") return "维护"
  return "unknown"
}

function checkpointTime(value: unknown): string {
  const createdAt = isRecord(value) ? readNumber(value.createdAt) : null
  if (createdAt === null) return "时间未知"
  return new Date(createdAt).toLocaleString()
}

function checkpointMessageCount(value: unknown): number {
  const count = isRecord(value) ? readNumber(value.messageCount) : null
  return count ?? 0
}

function checkpointWorkspaceFileCount(value: unknown): number {
  const count = isRecord(value) ? readNumber(value.workspaceFileCount) : null
  return count ?? 0
}

function markRefreshTime() {
  lastRefreshAt.value = new Date().toLocaleTimeString()
}

async function refreshAiDebug() {
  if (!playFrontendBridge.debug) {
    aiDebugRecords.value = []
    return
  }
  aiDebugRecords.value = await playFrontendBridge.debug.getAiDebugRecords()
}

async function refreshSessionHistory() {
  const result = await playFrontendBridge.query.query<{ turn: number; messages: unknown[] }[]>(
    { resource: "session-history" },
  )
  sessionHistory.value = (result?.items ?? []) as unknown as SessionHistoryEntry[]
}

async function refreshPlatformContext() {
  platformContext.value = await playFrontendBridge.platform.getPlatformContext()
}

async function refreshQueryResource(
  resource: string,
  setter: (items: unknown[]) => void,
  params?: Record<string, unknown>,
) {
  if (typeof playFrontendBridge.query?.query !== "function") {
    setter([])
    return
  }
  const result = await playFrontendBridge.query.query({ resource, params })
  setter(Array.isArray(result?.items) ? result.items : [])
}

async function refreshAll() {
  loading.value = true
  errorMessage.value = ""
  try {
    await Promise.all([
      refreshPlatformContext(),
      refreshAiDebug(),
      refreshSessionHistory(),
      refreshQueryResource("checkpoints", (items) => (checkpointItems.value = items)),
      refreshQueryResource(
        "runtime-diagnostics",
        (items) => (diagnosticItems.value = normalizeDiagnostics(items)),
        { limit: 8, lookbackTurns: 12, includeHealth: true },
      ),
    ])
    // 运行日志：默认显示最新回合。首次加载或回合前进时跳到最新。
    if (traceViewTurn.value === 0 || traceViewTurn.value >= runtimeTurn.value) {
      traceViewTurn.value = runtimeTurn.value
    }
    await refreshTrace()
    markRefreshTime()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "刷新系统监视器时发生未知错误。"
  } finally {
    loading.value = false
  }
}

/** 加载当前 traceViewTurn 的 trace events（人类可读渲染用）。 */
async function refreshTrace() {
  const turn = traceViewTurn.value
  if (!platformContext.value?.activeSaveId || turn <= 0) {
    traceLoadout.value = null
    return
  }
  traceLoading.value = true
  try {
    const result = await playFrontendBridge.query.query<RuntimeTraceLoadout[]>(
      { resource: "runtime-trace", params: { turn } },
    )
    const items = Array.isArray(result?.items) ? result.items : []
    traceLoadout.value = items.length > 0 ? normalizeTraceLoadout(items[0]) : null
  } catch {
    traceLoadout.value = null
  } finally {
    traceLoading.value = false
  }
}

function normalizeTraceLoadout(value: unknown): RuntimeTraceLoadout | null {
  if (!isRecord(value) || typeof value.turn !== "number") return null
  const events = Array.isArray(value.events) ? value.events.filter(isRecord) : []
  return {
    turn: value.turn,
    traceKind: typeof value.traceKind === "string" ? value.traceKind : "success",
    ...(typeof value.failedAt === "number" ? { failedAt: value.failedAt } : {}),
    events: events as unknown as TraceEventShape[],
    malformedLineCount: typeof value.malformedLineCount === "number" ? value.malformedLineCount : 0,
  }
}

/** 切换历史回合：direction = -1 上一回合 / +1 下一回合。 */
async function stepTraceTurn(direction: number): Promise<void> {
  const next = traceViewTurn.value + direction
  if (next < 1 || next > runtimeTurn.value) return
  traceViewTurn.value = next
  await refreshTrace()
}

/** 跳到最新回合。 */
async function jumpTraceToLatest(): Promise<void> {
  traceViewTurn.value = runtimeTurn.value
  await refreshTrace()
}

async function restoreCheckpoint(checkpointIdValue: string) {
  if (!checkpointIdValue) return
  const confirmed = await confirm({
    message: "恢复检查点会回滚当前存档的运行时状态。确认继续吗？",
    severity: "danger",
    confirmText: "恢复",
  })
  if (!confirmed) return

  const result = await playFrontendBridge.platform.runAction({
    action: "restore-checkpoint",
    params: { checkpointId: checkpointIdValue },
  })
  if (!result.ok) {
    toast.error(result.error?.message ?? "恢复检查点失败。")
    return
  }
  await refreshAll()
}

onMounted(async () => {
  await waitForPlatformHostReady()
  await refreshAll()

  if (playFrontendBridge.debug) {
    unsubscribeTurnReady = playFrontendBridge.debug.onTurnDebugReady(() => {
      void refreshAll()
    })
  }
})

onBeforeUnmount(() => {
  unsubscribeTurnReady?.()
  unsubscribeTurnReady = null
})
</script>

<style scoped>
.usage-chart-bar {
  animation: usage-chart-rise 360ms cubic-bezier(0.22, 0.8, 0.32, 1) both;
  transform-box: fill-box;
  transform-origin: center bottom;
}

.usage-chart-hit-line {
  animation: usage-chart-scan 520ms ease-out both;
  filter: drop-shadow(0 0 2px rgba(246, 236, 215, 0.5));
}

.usage-chart-hit-marker {
  animation: usage-chart-blip 420ms ease-out both;
  filter: drop-shadow(0 0 3px rgba(246, 236, 215, 0.65));
}

@keyframes usage-chart-rise {
  from {
    opacity: 0;
    transform: scaleY(0.08);
  }
  to {
    opacity: 1;
    transform: scaleY(1);
  }
}

@keyframes usage-chart-scan {
  from {
    opacity: 0;
    clip-path: inset(0 100% 0 0);
  }
  to {
    opacity: 1;
    clip-path: inset(0 0 0 0);
  }
}

@keyframes usage-chart-blip {
  0% {
    opacity: 0;
    transform: scaleX(0.2);
  }
  70% {
    opacity: 1;
    transform: scaleX(1.2);
  }
  100% {
    opacity: 1;
    transform: scaleX(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .usage-chart-bar,
  .usage-chart-hit-line,
  .usage-chart-hit-marker {
    animation: none;
  }
}
</style>
