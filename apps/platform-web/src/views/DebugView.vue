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
      <div class="flex items-center gap-2">
        <span class="inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs" :class="overallStatus.badgeClass">
          <span class="h-2 w-2" :class="overallStatus.dotClass" aria-hidden="true" />
          {{ overallStatus.label }}
        </span>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="loading"
          @click="refreshAll"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
          刷新
        </button>
      </div>
    </header>

    <main class="min-h-0 overflow-auto p-3">
      <div v-if="loading && !lastRefreshAt" class="retro-inset grid h-full min-h-[420px] place-items-center p-4">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取诊断状态</p>
      </div>

      <div v-else-if="errorMessage && !lastRefreshAt" class="retro-inset grid h-full min-h-[420px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">系统监视器不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
          <button type="button" class="retro-button retro-focus mt-4 h-8 px-3 font-mono text-xs" @click="refreshAll">重试</button>
        </div>
      </div>

      <div v-else class="grid min-w-0 gap-3">
        <div
          v-if="errorMessage"
          class="flex flex-wrap items-center justify-between gap-2 border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          role="alert"
        >
          <span>{{ errorMessage }}</span>
          <button type="button" class="retro-button retro-focus h-7 px-2 font-mono text-[11px]" @click="refreshAll">重试</button>
        </div>
        <nav class="retro-inset flex flex-wrap gap-1 p-1" aria-label="系统监视器分区">
          <button
            v-for="tab in monitorTabs"
            :key="tab.id"
            type="button"
            class="retro-focus inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs transition-colors"
            :class="activeTab === tab.id
              ? 'border-neon bg-neon/15 text-neon shadow-neon-glow'
              : 'border-transparent text-text-dim hover:border-neon-deep/45 hover:bg-elevated/40 hover:text-text-main'"
            :aria-current="activeTab === tab.id ? 'page' : undefined"
            @click="activeTab = tab.id"
          >
            <span class="text-[10px] uppercase tracking-wider opacity-70">{{ tab.code }}</span>
            <span>{{ tab.label }}</span>
          </button>
        </nav>

        <section v-if="activeTab === 'overview'" class="grid min-w-0 gap-3">
          <div
            v-if="health.lostRecordCount > 0"
            class="flex items-start gap-2 border border-warning/50 bg-warning/10 p-3 text-warning"
          >
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p class="font-mono text-xs font-bold">诊断记录不完整</p>
              <p class="mt-1 text-xs text-text-dim">本次会话有 {{ health.lostRecordCount }} 条诊断记录写入失败。</p>
            </div>
          </div>

          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article class="retro-inset grid content-start gap-2 p-4">
              <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">Token 累计</p>
              <p class="font-mono text-3xl font-bold text-neon glow-text">{{ formatTokens(overview.usage.total) }}</p>
              <p class="font-mono text-[10px] text-text-dim">in {{ formatTokens(overview.usage.input) }} · out {{ formatTokens(overview.usage.output) }}</p>
            </article>
            <article class="retro-inset grid content-start gap-2 p-4">
              <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">缓存命中</p>
              <p class="font-mono text-3xl font-bold text-neon glow-text">{{ cacheHitRate === null ? '—' : `${cacheHitRate}%` }}</p>
              <p class="font-mono text-[10px] text-text-dim">cached {{ formatTokens(overview.usage.cached) }} · write {{ formatTokens(overview.usage.cacheCreation) }}</p>
            </article>
            <article class="retro-inset grid content-start gap-2 p-4">
              <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">AI 请求</p>
              <p class="font-mono text-3xl font-bold text-text-main">{{ overview.aiRequestCount }}</p>
              <p class="font-mono text-[10px] text-text-dim">成功 {{ overview.succeededCount }} · 重试 {{ overview.retriedRequestCount }} · 进行中 {{ overview.runningCount }}</p>
            </article>
            <article class="retro-inset grid content-start gap-2 p-4">
              <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">需要关注</p>
              <p class="font-mono text-3xl font-bold" :class="attentionCount > 0 ? 'text-danger' : 'text-neon'">{{ attentionCount }}</p>
              <p class="font-mono text-[10px] text-text-dim">AI 失败 {{ overview.failedCount }} · 中断 {{ overview.interruptedCount }} · 前端错误 {{ overview.frontendErrorCount }}</p>
            </article>
          </div>

          <section class="retro-inset grid gap-2 p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">Provider / Model 统计</p>
              <span class="font-mono text-[10px] text-text-dim">统一 Trace · 最近 7 天保留窗口</span>
            </div>
            <div v-if="overview.providers.length > 0" class="grid gap-0.5">
              <div
                v-for="stat in overview.providers"
                :key="`${stat.provider}-${stat.model}`"
                class="grid grid-cols-[minmax(0,1fr)_4rem_7rem_5rem] items-center gap-3 border-b border-neon-deep/15 py-1.5 font-mono text-[11px] last:border-b-0"
              >
                <span class="truncate text-text-main">{{ stat.provider }} · {{ stat.model }}</span>
                <span class="text-right text-text-dim">{{ stat.calls }} 次</span>
                <span class="text-right text-text-dim">{{ formatTokens(stat.inputTokens + stat.outputTokens) }} tok</span>
                <span class="text-right text-neon">{{ providerCacheRate(stat.inputTokens, stat.cachedTokens) }}</span>
              </div>
            </div>
            <p v-else class="py-6 text-center text-sm text-text-dim">暂无 AI 请求统计。</p>
          </section>
        </section>

        <DiagnosticTracePanel
          v-else-if="activeTab === 'trace'"
          ref="tracePanelRef"
        />

        <section v-else class="grid gap-3">
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
                  <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-0.5 font-mono text-[11px] text-text-dim">Turn {{ checkpointTurn(item) }}</span>
                  <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-0.5 font-mono text-[11px] text-text-dim">{{ checkpointReasonLabel(item) }}</span>
                </div>
                <p class="mt-2 font-mono text-[11px] text-text-dim">{{ checkpointTime(item) }}</p>
                <p class="mt-1 text-xs text-text-dim">{{ checkpointMessageCount(item) }} 条消息 · {{ checkpointWorkspaceFileCount(item) }} 个运行时文件</p>
              </div>
              <button type="button" class="retro-button retro-focus inline-flex h-8 items-center justify-center gap-2 px-3 font-mono text-xs" @click="restoreCheckpoint(checkpointId(item))">
                <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" /> 恢复
              </button>
            </article>
          </div>
          <p v-else class="border border-neon-deep/35 bg-panel/60 p-4 text-sm text-text-dim">
            {{ platformContext?.activeSaveId ? "暂无检查点。" : "当前未选择存档，统一 Trace 仍可在 Trace 分区查看。" }}
          </p>
        </section>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center gap-2 border-t px-3 py-2">
      <span class="font-mono text-[11px] text-text-dim">{{ lastRefreshAt ? `上次刷新：${lastRefreshAt}` : "尚未刷新" }}</span>
      <span class="font-mono text-[11px] text-text-dim">· {{ overview.totalRecords }} 条统一 Trace</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { AlertTriangle, CheckCircle2, FileClock, RefreshCw, RotateCcw } from "lucide-vue-next"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import DiagnosticTracePanel from "@/components/debug/DiagnosticTracePanel.vue"
import { createMonitorController } from "@/controllers/system-monitor/monitor-controller"
import { waitForPlatformHostReady } from "../platform-host"

type MonitorTab = "overview" | "trace" | "recovery"

const monitorTabs: Array<{ id: MonitorTab; code: string; label: string }> = [
  { id: "overview", code: "01", label: "总览" },
  { id: "trace", code: "02", label: "Trace" },
  { id: "recovery", code: "03", label: "恢复" },
]
const monitor = createMonitorController()
const {
  context: platformContext,
  checkpoints: checkpointItems,
  overview,
  health,
  loading,
  error: errorMessage,
  lastRefreshAt,
  attentionCount,
} = monitor
const activeTab = ref<MonitorTab>("overview")
const tracePanelRef = ref<{ refresh(): Promise<void> } | null>(null)
const cacheHitRate = computed(() => overview.value.usage.input > 0
  ? Math.round((overview.value.usage.cached / overview.value.usage.input) * 100)
  : null)
const overallStatus = computed(() => {
  if (health.value.lostRecordCount > 0) {
    return {
      label: "记录不完整",
      badgeClass: "border-warning/50 bg-warning/10 text-warning",
      dotClass: "bg-warning",
      iconClass: "text-warning",
      icon: AlertTriangle,
    }
  }
  if (attentionCount.value > 0) {
    return {
      label: "需要关注",
      badgeClass: "border-danger/50 bg-danger/10 text-danger",
      dotClass: "bg-danger",
      iconClass: "text-danger",
      icon: AlertTriangle,
    }
  }
  return {
    label: overview.value.runningCount > 0 ? "请求进行中" : "运行正常",
    badgeClass: "border-neon/45 bg-neon/10 text-neon",
    dotClass: "bg-neon",
    iconClass: "text-neon",
    icon: CheckCircle2,
  }
})
const statusIcon = computed(() => overallStatus.value.icon)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function formatTokens(value: number): string {
  return value.toLocaleString()
}

function providerCacheRate(input: number, cached: number): string {
  return input > 0 ? `${Math.round((cached / input) * 100)}%` : "—"
}

function checkpointId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : ""
}

function checkpointLabel(value: unknown): string {
  return isRecord(value) && typeof value.label === "string" ? value.label : checkpointId(value) || "检查点"
}

function checkpointTurn(value: unknown): string {
  const turn = isRecord(value) ? readNumber(value.turn) : null
  return turn === null ? "--" : String(turn)
}

function checkpointReasonLabel(value: unknown): string {
  if (!isRecord(value)) return "unknown"
  const retention = value.retention === "pinned" ? "固定" : value.retention === "auto" ? "自动" : ""
  const source = value.source === "platform"
    ? "平台"
    : value.source === "user"
      ? "用户"
      : value.source === "card"
        ? "卡片"
        : value.source === "agent"
          ? "Agent"
          : ""
  if (retention || source) return [retention, source].filter(Boolean).join(" · ")
  return typeof value.reason === "string" ? value.reason : "unknown"
}

function checkpointTime(value: unknown): string {
  const createdAt = isRecord(value) ? readNumber(value.createdAt) : null
  return createdAt === null ? "时间未知" : new Date(createdAt).toLocaleString()
}

function checkpointMessageCount(value: unknown): number {
  return (isRecord(value) ? readNumber(value.messageCount) : null) ?? 0
}

function checkpointWorkspaceFileCount(value: unknown): number {
  return (isRecord(value) ? readNumber(value.workspaceFileCount) : null) ?? 0
}

async function refreshAll(): Promise<void> {
  await monitor.refreshAll()
  if (activeTab.value === "trace") await tracePanelRef.value?.refresh()
}

async function restoreCheckpoint(id: string): Promise<void> {
  if (await monitor.restoreCheckpoint(id)) await tracePanelRef.value?.refresh()
}

onMounted(async () => {
  await waitForPlatformHostReady()
  monitor.start()
  await refreshAll()
})

onBeforeUnmount(() => {
  monitor.dispose()
})
</script>
