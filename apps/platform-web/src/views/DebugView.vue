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
              <span class="font-mono text-3xl font-bold text-text-main">{{ tokenStats.callsWithUsage }}</span>
              <span class="font-mono text-[11px] text-text-dim">次</span>
            </div>
            <p class="font-mono text-[10px] text-text-dim">{{ providerStats.length }} 个 provider/model</p>
          </article>
        </section>

        <!-- 命中率趋势（独立全宽面板）-->
        <section v-if="latestCachePoint" class="retro-inset grid gap-2 p-4">
          <div class="flex items-center justify-between">
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">命中率趋势</p>
            <span class="font-mono text-[10px] text-text-dim">最近 {{ cacheTrendPoints.length }} 次</span>
          </div>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="h-24 w-full">
            <line x1="0" y1="30" x2="100" y2="30" stroke="currentColor" stroke-width="0.3" class="text-neon-deep/40" />
            <line x1="0" y1="15" x2="100" y2="15" stroke="currentColor" stroke-width="0.2" stroke-dasharray="1,1" class="text-neon-deep/30" />
            <line x1="0" y1="0" x2="100" y2="0" stroke="currentColor" stroke-width="0.3" class="text-neon-deep/40" />
            <polyline v-if="cacheTrendPolyline" :points="cacheTrendPolyline" fill="none" stroke="var(--neon, currentColor)" stroke-width="0.8" />
            <circle :cx="latestCachePoint.x" :cy="latestCachePoint.y" r="1.2" fill="var(--neon, currentColor)" />
          </svg>
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

        <!-- 最近问题（仅在有错误/警告时出现） -->
        <section v-if="recentIssues.length > 0" class="grid gap-2">
          <p class="font-mono text-xs uppercase tracking-wider text-neon">最近问题</p>
          <div
            v-for="issue in recentIssues"
            :key="issue.key"
            class="border px-3 py-2"
            :class="issue.tone === 'error' ? 'border-danger/45 bg-danger/10' : 'border-warning/45 bg-warning/10'"
          >
            <p class="font-mono text-xs" :class="issue.tone === 'error' ? 'text-danger' : 'text-warning'">{{ issue.title }}</p>
            <p class="mt-1 line-clamp-2 text-xs leading-5 text-text-dim">{{ issue.detail }}</p>
          </div>
        </section>

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
  RuntimeDiagnosticFact,
  RuntimeDiagnosticSource,
  RuntimeDiagnosticSummary,
  SessionHistoryEntry,
} from "@tsian/contracts"
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileClock, RefreshCw, RotateCcw, Terminal } from "lucide-vue-next"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue"
import { playFrontendBridge, waitForPlatformHostReady } from "../platform-host"
import { formatTraceForHuman, type RuntimeTraceEvent } from "../agent-runtime/trace"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"

interface IssueSummary {
  key: string
  tone: "warning" | "error"
  title: string
  detail: string
}

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
  let callsWithUsage = 0

  for (const record of aiDebugRecords.value) {
    const usage = record.usage
    if (!usage) continue
    const input = usage.input ?? 0
    const output = usage.output ?? 0
    const total = usage.total ?? (input + output)
    inputTotal += input
    outputTotal += output
    totalTotal += total
    callsWithUsage += 1
  }

  return { inputTotal, outputTotal, totalTotal, callsWithUsage }
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

/** 最近 N 次调用的命中率点序列（供 SVG 折线图）。null 点 = 该调用无缓存数据。 */
const cacheTrendPoints = computed(() => {
  const records = aiDebugRecords.value
  // 按时间升序（旧→新），取最近 20 条
  const sorted = [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-20)
  return sorted.map((r) => {
    const cached = r.usage?.cached
    const input = r.usage?.input
    if (typeof cached !== "number" || typeof input !== "number" || input <= 0) return null
    return Math.round((cached / input) * 100)
  })
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

/** SVG 折线图的 points 字符串（viewBox 0 0 100 30，纵轴 0-100% → 30-0 反转）。
 *  1 个点时返回空（polyline 画不出线），但面板仍渲染——模板用 latestCachePoint 画圆点标记。 */
const cacheTrendPolyline = computed(() => {
  const points = cacheTrendPoints.value
  if (points.length < 2) return ""
  const step = 100 / (points.length - 1)
  return points
    .map((rate, i) => {
      if (rate === null) return "" // 无数据点跳过（留空隙）
      const x = i * step
      const y = 30 - (rate / 100) * 30 // 反转：100% 在顶部
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(" ")
})

/** 最后一个有效点的坐标（供单点标记或折线末端圆点）。null = 无有效点。 */
const latestCachePoint = computed(() => {
  const points = cacheTrendPoints.value
  if (points.length === 0) return null
  const step = points.length > 1 ? 100 / (points.length - 1) : 50
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const rate = points[i]
    if (rate === null) continue
    const x = i * step
    const y = 30 - (rate / 100) * 30
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), rate }
  }
  return null
})

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
  const hasAiError = aiDebugRecords.value.some((record) => Boolean(record.error))
  const hasDiagnosticError = diagnosticItems.value.some((item) => item.severity === "error" || item.status === "failed")
  const hasWarning = diagnosticItems.value.some((item) => item.severity === "warning" || item.status === "anomalous")

  if (hasAiError || hasDiagnosticError) {
    return {
      label: "需要关注",
      detail: "最近的运行记录包含错误。查看下方最近问题。",
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

const recentIssues = computed<IssueSummary[]>(() => {
  const issues: IssueSummary[] = []

  for (const diagnostic of diagnosticItems.value) {
    for (const fact of diagnostic.facts) {
      if (fact.severity === "info") continue
      issues.push({
        key: `diagnostic-${diagnostic.turn}-${issues.length}`,
        tone: fact.severity === "error" ? "error" : "warning",
        title: `Turn ${diagnostic.turn} · ${sourceLabel(fact.source)}`,
        detail: factLine(fact),
      })
      if (issues.length >= 5) return issues
    }
  }

  for (const record of aiDebugRecords.value) {
    if (!record.error) continue
    issues.push({
      key: `ai-${record.id}`,
      tone: "error",
      title: `AI · ${record.label}`,
      detail: record.error,
    })
    if (issues.length >= 5) return issues
  }

  return issues
})

function formatTokens(value: number): string {
  return value.toLocaleString()
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

function sourceLabel(source: RuntimeDiagnosticSource): string {
  const labels: Record<RuntimeDiagnosticSource, string> = {
    turn: "回合",
    agent: "Agent",
    model: "模型",
    skill: "Skill",
    action: "Action",
    agent_call: "Agent 调用",
    workspace: "工作区",
    script: "脚本",
    session: "会话",
    trace: "Trace",
  }
  return labels[source] ?? source
}

function factLine(fact: RuntimeDiagnosticFact): string {
  const parts = [
    fact.code,
    fact.message,
    fact.agentId ? `agent=${fact.agentId}` : "",
    fact.debugLabel ? `label=${fact.debugLabel}` : "",
    fact.skill ? `skill=${fact.skill}` : "",
    fact.action ? `action=${fact.action}` : "",
    fact.tool ? `tool=${fact.tool}` : "",
    fact.executor ? `executor=${fact.executor}` : "",
  ].filter(Boolean)

  if (parts.length > 0) {
    return parts.join(" · ")
  }

  if (fact.detailsSummary) {
    return JSON.stringify(fact.detailsSummary, null, 2)
  }

  return fact.ok === false ? "事件标记为失败。" : "记录到一条运行时事实。"
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
