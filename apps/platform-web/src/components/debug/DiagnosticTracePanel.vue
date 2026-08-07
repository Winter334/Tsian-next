<template>
  <section class="grid min-w-0 gap-3">
    <div
      v-if="health.lostRecordCount > 0"
      class="flex items-start gap-2 border border-warning/50 bg-warning/10 p-3 text-warning"
      role="status"
    >
      <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div class="min-w-0">
        <p class="font-mono text-xs font-bold">诊断记录不完整</p>
        <p class="mt-1 text-xs leading-5 text-text-dim">
          本次会话有 {{ health.lostRecordCount }} 条记录写入失败。{{ health.lastError || "部分请求可能未出现在时间线中。" }}
        </p>
      </div>
    </div>

    <div class="retro-inset grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-[9rem_9rem_minmax(10rem,1fr)_minmax(10rem,1fr)_minmax(12rem,1.4fr)_auto]">
      <label class="grid gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">时间</span>
        <select v-model="timeRange" class="trace-control retro-focus">
          <option value="all">全部</option>
          <option value="hour">最近 1 小时</option>
          <option value="day">最近 24 小时</option>
          <option value="week">最近 7 天</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">状态</span>
        <select v-model="statusFilter" class="trace-control retro-focus">
          <option value="">全部</option>
          <option value="running">进行中</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
          <option value="aborted">已中止</option>
          <option value="interrupted">已中断</option>
          <option value="frontend-error">前端错误</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">Provider</span>
        <select v-model="providerFilter" class="trace-control retro-focus">
          <option value="">全部</option>
          <option v-for="provider in facets.providers" :key="provider" :value="provider">{{ provider }}</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">Model</span>
        <select v-model="modelFilter" class="trace-control retro-focus">
          <option value="">全部</option>
          <option v-for="model in facets.models" :key="model" :value="model">{{ model }}</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">文本搜索</span>
        <input v-model="textFilter" class="trace-control retro-focus" type="search" placeholder="请求、响应、错误或 ID" />
      </label>
      <div class="flex items-end gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 flex-1 items-center justify-center gap-1.5 px-3 font-mono text-xs disabled:opacity-45"
          :disabled="listLoading"
          @click="refreshAll"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': listLoading }" aria-hidden="true" />
          刷新
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 flex-1 items-center justify-center gap-1.5 px-3 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="!canExport || exporting"
          :title="canExport ? exportAnchorDescription : '暂无失败记录，不能生成诊断包'"
          @click="exportDialogOpen = true"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          诊断包
        </button>
      </div>
    </div>

    <p
      v-if="!canExport"
      class="border border-neon-deep/30 bg-panel/45 px-3 py-2 text-xs text-text-dim"
      role="status"
    >
      当前没有失败、中断或前端错误记录，诊断包导出已禁用。
    </p>

    <p v-if="errorMessage" class="border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
      {{ errorMessage }}
    </p>

    <div class="grid min-h-[520px] min-w-0 gap-3 xl:grid-cols-[minmax(18rem,25rem)_minmax(0,1fr)]">
      <aside class="retro-inset grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
        <div class="min-h-0 overflow-auto">
          <p v-if="listLoading && summaries.length === 0" class="grid min-h-52 place-items-center font-mono text-xs text-neon">
            正在读取 Trace
          </p>
          <p v-else-if="summaries.length === 0" class="grid min-h-52 place-items-center px-4 text-center text-sm text-text-dim">
            当前筛选条件下没有统一 Trace 记录。
          </p>
          <button
            v-for="summary in summaries"
            v-else
            :key="summary.id"
            type="button"
            class="retro-focus grid w-full gap-1 border-b border-neon-deep/20 px-3 py-2.5 text-left transition-colors last:border-b-0"
            :class="selectedId === summary.id ? 'bg-neon/10 shadow-[inset_3px_0_0_#5ee08b]' : 'hover:bg-elevated/45'"
            @click="selectRecord(summary.id)"
          >
            <span class="flex min-w-0 items-center justify-between gap-2">
              <span class="flex min-w-0 items-center gap-1.5">
                <Bot v-if="summary.recordType === 'ai-request'" class="h-3.5 w-3.5 shrink-0 text-neon" aria-hidden="true" />
                <Bug v-else class="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
                <span class="truncate font-mono text-xs font-bold text-text-main">{{ summaryTitle(summary) }}</span>
              </span>
              <span class="shrink-0 border px-1.5 py-0.5 font-mono text-[9px] uppercase" :class="summaryStatusClass(summary)">
                {{ summaryStatusLabel(summary) }}
              </span>
            </span>
            <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-text-dim">
              <span>{{ formatTime(summary.timestamp) }}</span>
              <span v-if="summary.durationMs !== undefined">{{ formatDuration(summary.durationMs) }}</span>
              <span v-if="summary.retryCount">重试 {{ summary.retryCount }}</span>
            </span>
            <span v-if="summary.message" class="line-clamp-2 text-[11px] leading-4 text-text-dim">{{ summary.message }}</span>
          </button>
        </div>
        <footer class="flex items-center justify-between gap-2 border-t border-neon-deep/30 px-3 py-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-7 items-center gap-1 px-2 font-mono text-[11px] disabled:opacity-35"
            :disabled="pageOffset === 0 || listLoading"
            @click="changePage(-1)"
          >
            <ChevronLeft class="h-3 w-3" aria-hidden="true" /> 上一页
          </button>
          <span class="font-mono text-[10px] text-text-dim">第 {{ currentPage }} 页</span>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-7 items-center gap-1 px-2 font-mono text-[11px] disabled:opacity-35"
            :disabled="!hasMore || listLoading"
            @click="changePage(1)"
          >
            下一页 <ChevronRight class="h-3 w-3" aria-hidden="true" />
          </button>
        </footer>
      </aside>

      <article class="retro-inset min-h-0 min-w-0 overflow-auto p-3">
        <p v-if="detailLoading" class="grid min-h-52 place-items-center font-mono text-xs text-neon">正在读取记录正文</p>
        <p v-else-if="!selectedRecord" class="grid min-h-52 place-items-center text-sm text-text-dim">选择左侧记录查看详情。</p>

        <div v-else-if="aiRecord" class="grid min-w-0 gap-3">
          <header class="grid gap-2 border-b border-neon-deep/30 pb-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="font-mono text-[10px] uppercase tracking-wider text-neon">AI Request</p>
                <h2 class="mt-1 break-all font-mono text-sm font-bold text-text-main">{{ aiRecord.requestId }}</h2>
              </div>
              <span class="border px-2 py-1 font-mono text-[10px] uppercase" :class="recordStatusClass(aiRecord.status)">{{ statusLabel(aiRecord.status) }}</span>
            </div>
            <dl class="grid gap-x-4 gap-y-1 font-mono text-[10px] text-text-dim sm:grid-cols-2 xl:grid-cols-4">
              <div><dt class="inline text-text-dim/70">Provider </dt><dd class="inline text-text-main">{{ aiRecord.provider }}</dd></div>
              <div><dt class="inline text-text-dim/70">Model </dt><dd class="inline text-text-main">{{ aiRecord.model }}</dd></div>
              <div><dt class="inline text-text-dim/70">耗时 </dt><dd class="inline text-text-main">{{ formatDuration(aiRecord.durationMs) }}</dd></div>
              <div><dt class="inline text-text-dim/70">时间 </dt><dd class="inline text-text-main">{{ formatTime(aiRecord.timestamp) }}</dd></div>
              <div class="sm:col-span-2"><dt class="inline text-text-dim/70">Operation </dt><dd class="inline break-all text-text-main">{{ aiRecord.operationId }}</dd></div>
              <div v-if="aiRecord.parentRequestId"><dt class="inline text-text-dim/70">Parent </dt><dd class="inline break-all text-text-main">{{ aiRecord.parentRequestId }}</dd></div>
              <div v-if="aiRecord.previousRequestId"><dt class="inline text-text-dim/70">Previous </dt><dd class="inline break-all text-text-main">{{ aiRecord.previousRequestId }}</dd></div>
            </dl>
          </header>

          <details class="trace-section" open>
            <summary>请求</summary>
            <div class="p-3">
              <JsonBlock label="完整请求" :value="requestJson" />
            </div>
          </details>

          <details class="trace-section" open>
            <summary>响应</summary>
            <div class="grid gap-2 p-3">
              <pre v-if="aiRecord.response?.text" class="trace-pre whitespace-pre-wrap">{{ aiRecord.response.text }}</pre>
              <p v-else class="text-xs text-text-dim">尚无响应正文。</p>
              <p v-if="aiRecord.response?.finishReason" class="font-mono text-[10px] text-text-dim">Finish: {{ aiRecord.response.finishReason }}</p>
              <JsonBlock v-if="aiRecord.response?.providerPayload !== undefined" label="Provider Payload" :value="aiRecord.response.providerPayload" />
            </div>
          </details>

          <details v-if="aiRecord.response?.toolCalls !== undefined" class="trace-section" open>
            <summary>工具调用</summary>
            <div class="p-3">
              <JsonBlock label="工具调用" :value="aiRecord.response.toolCalls" />
            </div>
          </details>

          <details class="trace-section" open>
            <summary>Usage 与尝试</summary>
            <div class="grid gap-3 p-3">
              <dl class="grid grid-cols-2 gap-2 font-mono text-[10px] sm:grid-cols-5">
                <div class="trace-metric"><dt>Input</dt><dd>{{ formatTokens(aiRecord.response?.usage?.input) }}</dd></div>
                <div class="trace-metric"><dt>Output</dt><dd>{{ formatTokens(aiRecord.response?.usage?.output) }}</dd></div>
                <div class="trace-metric"><dt>Total</dt><dd>{{ formatTokens(aiRecord.response?.usage?.total) }}</dd></div>
                <div class="trace-metric"><dt>Cached</dt><dd>{{ formatTokens(aiRecord.response?.usage?.cached) }}</dd></div>
                <div class="trace-metric"><dt>Cache write</dt><dd>{{ formatTokens(aiRecord.response?.usage?.cacheCreation) }}</dd></div>
              </dl>
              <div class="grid gap-2">
                <article v-for="attempt in aiRecord.attempts" :key="attempt.attempt" class="border border-neon-deep/25 bg-panel/45 p-2">
                  <div class="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px]">
                    <span class="text-text-main">Attempt {{ attempt.attempt }} / {{ attempt.maxAttempts }}</span>
                    <span :class="attempt.status === 'succeeded' ? 'text-neon' : attempt.status === 'running' ? 'text-warning' : 'text-danger'">{{ attempt.status }}</span>
                  </div>
                  <p class="mt-1 font-mono text-[10px] text-text-dim">
                    {{ formatAttemptDuration(attempt.startedAt, attempt.endedAt) }}
                    <span v-if="attempt.willRetry"> · {{ attempt.retryDelayMs ?? 0 }}ms 后重试</span>
                   </p>
                   <p v-if="attempt.error" class="mt-1 break-words text-xs text-danger">{{ attempt.error.type }} · {{ attempt.error.message }}</p>
                   <pre v-if="attempt.error?.stack" class="trace-pre mt-2 whitespace-pre-wrap">{{ attempt.error.stack }}</pre>
                   <JsonBlock v-if="attempt.error?.details !== undefined" class="mt-2" label="Attempt 错误详情" :value="attempt.error.details" />
                </article>
              </div>
            </div>
          </details>

          <details v-if="aiRecord.error" class="trace-section border-danger/35" open>
            <summary class="text-danger">错误</summary>
            <div class="grid gap-2 p-3">
              <p class="text-sm text-danger">{{ aiRecord.error.type }} · {{ aiRecord.error.message }}</p>
              <pre v-if="aiRecord.error.stack" class="trace-pre whitespace-pre-wrap">{{ aiRecord.error.stack }}</pre>
              <JsonBlock v-if="aiRecord.error.details !== undefined" label="错误详情" :value="aiRecord.error.details" />
            </div>
          </details>

          <RawRecordSection :json="rawJson" @copy="copyRawRecord" />
        </div>

        <div v-else-if="frontendError" class="grid min-w-0 gap-3">
          <header class="grid gap-2 border-b border-neon-deep/30 pb-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="font-mono text-[10px] uppercase tracking-wider text-danger">Frontend Error</p>
                <h2 class="mt-1 break-all font-mono text-sm font-bold text-text-main">{{ frontendError.errorId }}</h2>
              </div>
              <span class="border border-danger/45 bg-danger/10 px-2 py-1 font-mono text-[10px] uppercase text-danger">{{ frontendError.kind }}</span>
            </div>
            <p class="text-sm leading-6 text-danger">{{ frontendError.message }}</p>
            <p class="font-mono text-[10px] text-text-dim">{{ formatTime(frontendError.timestamp) }}<span v-if="frontendError.componentName"> · {{ frontendError.componentName }}</span></p>
          </header>
          <section class="trace-section p-3">
            <dl class="grid gap-2 font-mono text-[10px] text-text-dim">
              <div v-if="frontendError.name"><dt class="inline text-text-dim/70">Name </dt><dd class="inline text-text-main">{{ frontendError.name }}</dd></div>
              <div v-if="frontendError.sourceUrl"><dt class="inline text-text-dim/70">Source </dt><dd class="inline break-all text-text-main">{{ frontendError.sourceUrl }}:{{ frontendError.line ?? '?' }}:{{ frontendError.column ?? '?' }}</dd></div>
              <div v-if="frontendError.resourceUrl"><dt class="inline text-text-dim/70">Resource </dt><dd class="inline break-all text-text-main">{{ frontendError.resourceUrl }}</dd></div>
            </dl>
            <pre v-if="frontendError.stack" class="trace-pre mt-3 whitespace-pre-wrap">{{ frontendError.stack }}</pre>
          </section>
          <RawRecordSection :json="rawJson" @copy="copyRawRecord" />
        </div>
      </article>
    </div>

    <FloatingWindow
      v-if="exportDialogOpen"
      title="导出开发者诊断包"
      width-class="max-w-xl"
      overlay="dim"
      @close="closeExportDialog"
    >
      <div class="grid gap-3">
        <div class="border border-neon-deep/35 bg-panel/55 p-3 text-xs leading-5 text-text-dim">
          <p class="font-mono text-[10px] uppercase tracking-wider text-neon">{{ exportAnchorDescription }}</p>
          <p class="mt-1">将包含锚点及其之前最多 50 条记录，并补齐完整关联链。完整请求与响应默认包含，导出时会再次移除凭据。</p>
        </div>
        <label class="grid gap-1.5">
          <span class="font-mono text-[11px] uppercase tracking-wider text-text-dim">复现步骤</span>
          <textarea
            v-model="reproductionSteps"
            rows="8"
            class="retro-focus retro-select-surface w-full resize-y border border-neon-deep/55 bg-elevated px-3 py-2 text-sm leading-6 text-text-main placeholder:text-text-dim/60"
            placeholder="例如：1. 打开某张游戏卡；2. 执行……；3. 观察到……"
          />
        </label>
        <p v-if="exportError" class="text-xs text-danger">{{ exportError }}</p>
        <div class="flex justify-end gap-2 border-t border-neon-deep/30 pt-3">
          <button type="button" class="retro-button retro-focus h-8 px-3 font-mono text-xs" :disabled="exporting" @click="closeExportDialog">取消</button>
          <button type="button" class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs disabled:opacity-45" :disabled="exporting" @click="downloadBundle">
            <Download class="h-3.5 w-3.5" aria-hidden="true" />
            {{ exporting ? "正在构建" : "生成并下载" }}
          </button>
        </div>
      </div>
    </FloatingWindow>
  </section>
</template>

<script setup lang="ts">
import type {
  DiagnosticAiRequestRecord,
  DiagnosticAiRequestStatus,
  DiagnosticFrontendErrorRecord,
  DiagnosticRecordSummary,
} from "@tsian/contracts"
import {
  AlertTriangle,
  Bot,
  Bug,
  ChevronLeft,
  ChevronRight,
  Download,
  RefreshCw,
} from "lucide-vue-next"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import { createTraceController, traceFormatDuration, traceFormatTime, traceStatusLabel, traceSummaryTitle } from "@/controllers/system-monitor/trace-controller"
import JsonBlock from "./JsonBlock.vue"
import RawRecordSection from "./RawRecordSection.vue"

const trace = createTraceController()
const {
  summaries,
  selectedRecord,
  facets,
  overview,
  health,
  selectedId,
  pageOffset,
  hasMore,
  listLoading,
  detailLoading,
  error: errorMessage,
  timeRange,
  status: statusFilter,
  provider: providerFilter,
  model: modelFilter,
  text: textFilter,
  currentPage,
  rawJson,
  canExport,
  selectedIsFailure,
  refresh: refreshAll,
  select: selectRecord,
  changePage,
  scheduleFilterRefresh,
  copyRaw: copyRawRecord,
} = trace
const exportDialogOpen = ref(false)
const reproductionSteps = ref("")
const exporting = ref(false)
const exportError = ref("")
const aiRecord = computed<DiagnosticAiRequestRecord | null>(() =>
  selectedRecord.value?.recordType === "ai-request" ? selectedRecord.value : null)
const frontendError = computed<DiagnosticFrontendErrorRecord | null>(() =>
  selectedRecord.value?.recordType === "frontend-error" ? selectedRecord.value : null)
const requestJson = computed(() => {
  const record = aiRecord.value
  if (!record) return undefined
  return {
    endpoint: record.endpoint,
    streaming: record.streaming,
    ...(record.parameters !== undefined ? { parameters: record.parameters } : {}),
    messages: record.request.messages,
    ...(record.request.tools !== undefined ? { tools: record.request.tools } : {}),
    ...(record.request.headers !== undefined ? { headers: record.request.headers } : {}),
    ...(record.request.body !== undefined ? { providerBody: record.request.body } : {}),
  }
})
const exportAnchorDescription = computed(() => selectedIsFailure.value
  ? `锚点：已选失败记录 ${selectedRecord.value?.id}`
  : overview.value.latestFailureId
    ? `锚点：最新失败记录 ${overview.value.latestFailureId}`
    : "暂无失败记录")

function summaryTitle(summary: DiagnosticRecordSummary): string {
  return traceSummaryTitle(summary)
}

function summaryStatusLabel(summary: DiagnosticRecordSummary): string {
  return summary.recordType === "frontend-error" ? "error" : traceStatusLabel(summary)
}

function summaryStatusClass(summary: DiagnosticRecordSummary): string {
  return summary.recordType === "frontend-error"
    ? "border-danger/45 bg-danger/10 text-danger"
    : recordStatusClass(summary.status)
}

function statusLabel(status?: DiagnosticAiRequestStatus): string {
  return traceStatusLabel({ recordType: "ai-request", status })
}

function recordStatusClass(status?: DiagnosticAiRequestStatus): string {
  if (status === "succeeded") return "border-neon/45 bg-neon/10 text-neon"
  if (status === "running") return "border-warning/45 bg-warning/10 text-warning"
  if (status === "aborted") return "border-text-dim/45 bg-elevated/45 text-text-dim"
  return "border-danger/45 bg-danger/10 text-danger"
}

function formatTime(timestamp: number): string {
  return traceFormatTime(timestamp)
}

function formatDuration(duration?: number): string {
  return traceFormatDuration(duration)
}

function formatAttemptDuration(startedAt: number, endedAt?: number): string {
  return endedAt === undefined ? "进行中" : formatDuration(Math.max(0, endedAt - startedAt))
}

function formatTokens(value?: number): string {
  return value === undefined ? "--" : value.toLocaleString()
}

function closeExportDialog(): void {
  if (exporting.value) return
  exportDialogOpen.value = false
  exportError.value = ""
}

async function downloadBundle(): Promise<void> {
  exporting.value = true
  exportError.value = ""
  try {
    if (await trace.downloadBundle(reproductionSteps.value)) exportDialogOpen.value = false
    else exportError.value = errorMessage.value || "生成诊断包失败。"
  } catch (cause) {
    exportError.value = cause instanceof Error ? cause.message : "生成诊断包失败。"
  } finally {
    exporting.value = false
  }
}

defineExpose({ refresh: refreshAll })

watch([timeRange, statusFilter, providerFilter, modelFilter, textFilter], () => {
  scheduleFilterRefresh()
})

onMounted(() => {
  void refreshAll()
  trace.start()
})

onBeforeUnmount(() => {
  trace.dispose()
})
</script>

<style scoped>
.trace-control {
  height: 2rem;
  min-width: 0;
  width: 100%;
  border: 1px solid rgb(51 102 80 / 0.55);
  background: var(--color-elevated, #24251f);
  padding: 0 0.55rem;
  color: var(--color-text-main, #f6ecd7);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6875rem;
}

.trace-section {
  min-width: 0;
  border: 1px solid rgb(51 102 80 / 0.35);
  background: rgb(26 30 25 / 0.55);
}

.trace-section > summary {
  cursor: pointer;
  border-bottom: 1px solid rgb(51 102 80 / 0.2);
  padding: 0.55rem 0.75rem;
  color: var(--color-neon, #5ee08b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.trace-pre {
  max-height: 24rem;
  overflow: auto;
  overflow-wrap: anywhere;
  border: 1px solid rgb(51 102 80 / 0.28);
  background: rgb(10 14 12 / 0.65);
  padding: 0.7rem;
  color: var(--color-text-main, #f6ecd7);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.6875rem;
  line-height: 1.45;
}

.trace-metric {
  border: 1px solid rgb(51 102 80 / 0.25);
  background: rgb(36 40 33 / 0.55);
  padding: 0.5rem;
}

.trace-metric dt {
  color: var(--color-text-dim, #a7aa9d);
}

.trace-metric dd {
  margin-top: 0.2rem;
  color: var(--color-text-main, #f6ecd7);
}
</style>
