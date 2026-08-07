<template>
  <section class="spatial-app spatial-monitor" data-spatial-source-animation aria-label="系统监视器">
    <header class="spatial-app__header">
      <div class="spatial-app__identity"><span class="spatial-app__eyebrow">RUNTIME DIAGNOSTICS</span><h1>系统监视器</h1></div>
      <SpatialActionButton :disabled="loading" @click="refresh"><template #icon><RefreshCw /></template>{{ loading ? '刷新中…' : '刷新' }}</SpatialActionButton>
    </header>
    <nav class="spatial-monitor__tabs" role="tablist" aria-label="监视器分区">
      <button v-for="item in tabs" :key="item.id" type="button" role="tab" :aria-selected="tab === item.id" @click="tab = item.id">{{ item.label }}</button>
    </nav>
    <main class="spatial-app__scroll spatial-monitor__content">
      <p v-if="monitorError || traceError" class="spatial-app__banner spatial-app__banner--error" role="alert">{{ monitorError || traceError }}</p>

      <template v-if="tab === 'overview'">
        <div class="spatial-monitor__stats">
          <article v-for="item in overviewStats" :key="item.label"><span>{{ item.label }}</span><strong>{{ item.value }}</strong></article>
        </div>
        <section class="spatial-app__section"><h2>健康与用量</h2><p>诊断存储丢失记录：{{ health.lostRecordCount }}。诊断数据遵循现有保留、脱敏和 bundle 契约。</p><div class="spatial-monitor__health"><span>AI 请求 {{ overview.aiRequestCount }}</span><span>前端错误 {{ overview.frontendErrorCount }}</span><span>缓存 {{ cacheHitRate }}</span></div></section>
        <section class="spatial-app__section"><h2>Provider / Model 统计</h2><p v-if="!overview.providers.length" class="spatial-app__hint">暂无服务商 Trace。</p><div v-for="provider in overview.providers" :key="`${provider.provider}:${provider.model}`" class="spatial-monitor__provider"><strong>{{ provider.provider || 'unknown' }} · {{ provider.model || 'unknown' }}</strong><span>{{ provider.calls }} 请求 · {{ (provider.inputTokens + provider.outputTokens).toLocaleString() }} tokens · {{ providerCacheRate(provider.inputTokens, provider.cachedTokens) }}</span></div></section>
      </template>

      <template v-else-if="tab === 'trace'">
        <section class="spatial-app__section spatial-monitor__filters">
          <label class="spatial-app__field"><span>时间</span><SpatialSelect v-model="timeRange" :options="timeOptions" aria-label="时间范围" /></label>
          <label class="spatial-app__field"><span>状态</span><SpatialSelect v-model="status" :options="statusOptions" aria-label="状态" /></label>
          <label class="spatial-app__field"><span>服务商</span><SpatialSelect v-model="provider" :options="providerOptions" aria-label="服务商" /></label>
          <label class="spatial-app__field"><span>模型</span><SpatialSelect v-model="model" :options="modelOptions" aria-label="模型" /></label>
          <label class="spatial-app__field spatial-monitor__search"><span>全文</span><input v-model="text" type="search" placeholder="模型、错误或请求文本" /></label>
        </section>
        <div class="spatial-monitor__trace">
          <aside class="spatial-monitor__records">
            <p v-if="listLoading && !summaries.length" class="spatial-app__empty">读取 Trace…</p>
            <template v-else>
              <button v-for="record in summaries" :key="record.id" type="button" :aria-pressed="selectedId === record.id" @click="select(record.id)"><strong>{{ summaryTitle(record) }}</strong><span>{{ statusLabel(record) }} · {{ formatTime(record.timestamp) }}<i v-if="record.durationMs !== undefined"> · {{ formatDuration(record.durationMs) }}</i></span><small v-if="record.message">{{ record.message }}</small></button>
              <p v-if="!summaries.length" class="spatial-app__empty">没有匹配的 Trace。</p>
            </template>
            <div class="spatial-app__actions"><SpatialActionButton :disabled="pageOffset === 0 || listLoading" @click="changePage(-1)">上一页</SpatialActionButton><span class="spatial-app__meta">第 {{ currentPage }} 页 · 30 条</span><SpatialActionButton :disabled="!hasMore || listLoading" @click="changePage(1)">下一页</SpatialActionButton></div>
          </aside>
          <article class="spatial-monitor__detail spatial-app__scroll">
            <p v-if="detailLoading" class="spatial-app__empty">读取详情…</p>
            <template v-else-if="selectedRecord">
              <header><span class="spatial-app__eyebrow">{{ selectedRecord.id }}</span><h2>{{ summaryTitle(selectedRecord) }}</h2><div class="spatial-app__actions"><SpatialActionButton @click="copyRaw">复制原始记录</SpatialActionButton><SpatialActionButton :disabled="!canExport" @click="requestDiagnosticBundle"><template #icon><Download /></template>导出诊断包</SpatialActionButton></div></header>
              <dl class="spatial-monitor__metadata"><div><dt>状态</dt><dd>{{ statusLabel(selectedRecord) }}</dd></div><div><dt>时间</dt><dd>{{ formatTime(selectedRecord.timestamp) }}</dd></div><template v-if="selectedRecord.recordType === 'ai-request'"><div><dt>Provider / Model</dt><dd>{{ selectedRecord.provider || 'unknown' }} / {{ selectedRecord.model || 'unknown' }}</dd></div><div><dt>耗时</dt><dd>{{ formatDuration(selectedRecord.durationMs) }}</dd></div><div><dt>Operation</dt><dd>{{ selectedRecord.operationId }}</dd></div><div v-if="selectedRecord.parentRequestId"><dt>Parent</dt><dd>{{ selectedRecord.parentRequestId }}</dd></div><div v-if="selectedRecord.previousRequestId"><dt>Previous</dt><dd>{{ selectedRecord.previousRequestId }}</dd></div></template></dl>
              <template v-if="aiRecord"><SpatialJsonTree label="完整请求" :value="requestJson" /><SpatialJsonTree v-if="aiRecord.response?.providerPayload !== undefined" label="Provider Payload" :value="aiRecord.response.providerPayload" /><SpatialJsonTree v-if="aiRecord.response?.toolCalls !== undefined" label="工具调用" :value="aiRecord.response.toolCalls" /><section class="spatial-monitor__text-block"><h3>响应</h3><pre v-if="aiRecord.response?.text">{{ aiRecord.response.text }}</pre><p v-else>尚无响应正文。</p></section><section v-if="aiRecord.error" class="spatial-monitor__error"><h3>{{ aiRecord.error.type }}</h3><p>{{ aiRecord.error.message }}</p><pre v-if="aiRecord.error.stack">{{ aiRecord.error.stack }}</pre><SpatialJsonTree v-if="aiRecord.error.details !== undefined" label="错误详情" :value="aiRecord.error.details" /></section></template>
              <section v-else-if="frontendError" class="spatial-monitor__error"><h3>{{ frontendError.kind }} · {{ frontendError.errorId }}</h3><p>{{ frontendError.message }}</p><pre v-if="frontendError.stack">{{ frontendError.stack }}</pre></section>
              <SpatialRawRecordSection :json="rawJson" />
            </template>
            <p v-else class="spatial-app__empty">选择左侧记录查看详情。</p>
          </article>
        </div>
      </template>

      <section v-else class="spatial-app__section"><h2>检查点恢复</h2><p class="spatial-app__hint">恢复会回滚当前存档的运行时状态，并保留既有危险操作确认。</p><p v-if="!checkpoints.length" class="spatial-app__empty">{{ context?.activeSaveId ? '暂无检查点。' : '当前未选择存档。' }}</p><article v-for="checkpoint in checkpoints" :key="checkpointId(checkpoint)" class="spatial-monitor__checkpoint"><div><strong>{{ checkpointLabel(checkpoint) }}</strong><small>Turn {{ checkpointTurn(checkpoint) }} · {{ checkpointTime(checkpoint) }}</small></div><SpatialActionButton variant="danger" @click="restoreCheckpoint(checkpointId(checkpoint))"><template #icon><RotateCcw /></template>恢复</SpatialActionButton></article></section>
    </main>
  </section>
</template>

<script setup lang="ts">
import type { DiagnosticAiRequestRecord, DiagnosticRecord, DiagnosticRecordSummary } from "@tsian/contracts"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { Download, RefreshCw, RotateCcw } from "lucide-vue-next"
import { openDialogForm } from "@/composables/useDialogForm"
import { createMonitorController, checkpointId, checkpointLabel, checkpointTime, checkpointTurn } from "@/controllers/system-monitor/monitor-controller"
import { createTraceController, traceFormatDuration, traceFormatTime, traceStatusLabel, traceSummaryTitle } from "@/controllers/system-monitor/trace-controller"
import { waitForPlatformHostReady } from "@/platform-host"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialSelect from "../primitives/SpatialSelect.vue"
import SpatialJsonTree from "./SpatialJsonTree.vue"
import SpatialRawRecordSection from "./SpatialRawRecordSection.vue"
import "../spatial-apps.css"

type Tab = "overview" | "trace" | "recovery"
const tabs = [{ id: "overview", label: "总览" }, { id: "trace", label: "Trace" }, { id: "recovery", label: "恢复" }] as const
const monitor = createMonitorController()
const trace = createTraceController()
const { context, checkpoints, overview, health, loading, error: monitorError, attentionCount, refreshAll: refreshMonitor, restoreCheckpoint } = monitor
const { summaries, selectedRecord, selectedId, pageOffset, hasMore, listLoading, detailLoading, error: traceError, timeRange, status, provider, model, text, currentPage, rawJson, canExport, select, changePage, refresh: refreshTrace, scheduleFilterRefresh, copyRaw, downloadBundle } = trace
const tab = ref<Tab>("overview")
const aiRecord = computed<DiagnosticAiRequestRecord | null>(() => selectedRecord.value?.recordType === "ai-request" ? selectedRecord.value : null)
const frontendError = computed(() => selectedRecord.value?.recordType === "frontend-error" ? selectedRecord.value : null)
const requestJson = computed(() => aiRecord.value ? { endpoint: aiRecord.value.endpoint, streaming: aiRecord.value.streaming, ...(aiRecord.value.parameters !== undefined ? { parameters: aiRecord.value.parameters } : {}), messages: aiRecord.value.request.messages, ...(aiRecord.value.request.tools !== undefined ? { tools: aiRecord.value.request.tools } : {}), ...(aiRecord.value.request.headers !== undefined ? { headers: aiRecord.value.request.headers } : {}), ...(aiRecord.value.request.body !== undefined ? { providerBody: aiRecord.value.request.body } : {}) } : undefined)
const overviewStats = computed(() => [{ label: "Trace", value: overview.value.totalRecords }, { label: "成功", value: overview.value.succeededCount }, { label: "关注", value: attentionCount.value }, { label: "运行中", value: overview.value.runningCount }, { label: "Tokens", value: overview.value.usage.total.toLocaleString() }])
const cacheHitRate = computed(() => overview.value.usage.input > 0 ? `${Math.round(overview.value.usage.cached / overview.value.usage.input * 100)}%` : "—")
const timeOptions = [{ value: "all", label: "全部时间" }, { value: "hour", label: "最近一小时" }, { value: "day", label: "最近一天" }, { value: "week", label: "最近一周" }]
const statusOptions = [{ value: "", label: "全部状态" }, { value: "running", label: "进行中" }, { value: "succeeded", label: "成功" }, { value: "failed", label: "失败" }, { value: "aborted", label: "中止" }, { value: "interrupted", label: "中断" }, { value: "frontend-error", label: "前端错误" }]
const providerOptions = computed(() => [{ value: "", label: "全部服务商" }, ...trace.facets.value.providers.map((value) => ({ value, label: value }))])
const modelOptions = computed(() => [{ value: "", label: "全部模型" }, ...trace.facets.value.models.map((value) => ({ value, label: value }))])
function refresh(): Promise<void> { return Promise.all([refreshMonitor(), refreshTrace()]).then(() => undefined) }
function summaryTitle(record: Pick<DiagnosticRecordSummary, "recordType" | "provider" | "model"> | DiagnosticRecord): string { return traceSummaryTitle(record) }
function statusLabel(record: Pick<DiagnosticRecordSummary, "recordType" | "status"> | DiagnosticRecord): string { return traceStatusLabel(record) }
function formatTime(value: number): string { return traceFormatTime(value) }
function formatDuration(value?: number): string { return traceFormatDuration(value) }
function providerCacheRate(input: number, cached: number): string { return input > 0 ? `${Math.round(cached / input * 100)}%` : "—" }
async function requestDiagnosticBundle(): Promise<void> { const values = await openDialogForm({ title: "导出开发者诊断包", widthClass: "max-w-xl", confirmText: "生成并下载", fields: [{ name: "reproductionSteps", label: "复现步骤", type: "textarea", rows: 8, placeholder: "例如：1. 打开某张游戏卡；2. 执行……；3. 观察到……" }] }); if (values) await downloadBundle(values.reproductionSteps ?? "") }
watch([timeRange, status, provider, model, text], scheduleFilterRefresh)
onMounted(async () => { await waitForPlatformHostReady(); monitor.start(); trace.start(); await refresh() })
onBeforeUnmount(() => { monitor.dispose(); trace.dispose() })
</script>

<style scoped>
.spatial-monitor { grid-template-rows: auto auto minmax(0, 1fr); }
.spatial-monitor__tabs { display:flex; border-bottom:1px solid var(--spatial-app-border); }
.spatial-monitor__tabs button { flex:1; min-height:34px; border:0; border-right:1px solid var(--spatial-app-border); background:var(--spatial-app-surface-muted); font:10px "JetBrains Mono",monospace; }
.spatial-monitor__tabs button[aria-selected="true"] { color:var(--spatial-window-frame); background:var(--spatial-window-tab); }
.spatial-monitor__content { display:grid; align-content:start; gap:12px; padding:14px; }
.spatial-monitor__stats { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:7px; }
.spatial-monitor__stats article,.spatial-monitor__provider,.spatial-monitor__health span,.spatial-monitor__checkpoint { border:1px solid var(--spatial-app-border); padding:9px; }
.spatial-monitor__stats span,.spatial-monitor__provider span,.spatial-monitor__health span { display:block; color:var(--spatial-app-muted); font:9px "JetBrains Mono",monospace; }
.spatial-monitor__stats strong { display:block; margin-top:4px; font-size:17px; }
.spatial-monitor__health { display:flex; flex-wrap:wrap; gap:6px; margin-top:9px; }
.spatial-monitor__provider { display:flex; justify-content:space-between; gap:8px; margin-top:6px; }
.spatial-monitor__filters { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
.spatial-monitor__search { grid-column:1/-1; }
.spatial-monitor__trace { display:grid; min-height:350px; grid-template-columns:minmax(180px,34%) minmax(0,1fr); border:1px solid var(--spatial-app-border); }
.spatial-monitor__records { display:grid; align-content:start; gap:4px; padding:7px; border-right:1px solid var(--spatial-app-border); overflow:auto; }
.spatial-monitor__records>button { display:grid; gap:3px; border:1px solid transparent; padding:8px; text-align:left; background:transparent; }
.spatial-monitor__records>button[aria-pressed="true"] { border-color:var(--spatial-app-border-strong); background:var(--spatial-app-surface-strong); }
.spatial-monitor__records strong { overflow:hidden; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
.spatial-monitor__records span,.spatial-monitor__records small { color:var(--spatial-app-muted); font:9px "JetBrains Mono",monospace; }
.spatial-monitor__records small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.spatial-monitor__detail { min-width:0; padding:12px; }
.spatial-monitor__detail h2 { margin:3px 0 8px; font-size:16px; }
.spatial-monitor__metadata { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }
.spatial-monitor__metadata div { min-width:0; border:1px solid var(--spatial-app-border); padding:6px; }
.spatial-monitor__metadata dt { color:var(--spatial-app-muted); font:9px "JetBrains Mono",monospace; }
.spatial-monitor__metadata dd { margin:3px 0 0; overflow-wrap:anywhere; font-size:11px; }
.spatial-monitor__text-block,.spatial-monitor__error { margin-top:10px; border:1px solid var(--spatial-app-border); padding:9px; }
.spatial-monitor__text-block h3,.spatial-monitor__error h3 { margin:0 0 6px; font:10px "JetBrains Mono",monospace; text-transform:uppercase; }
.spatial-monitor__text-block pre,.spatial-monitor__error pre { max-height:24rem; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; font:10px/1.45 "JetBrains Mono",monospace; }
.spatial-monitor__error { border-color:color-mix(in srgb,var(--spatial-app-error) 50%,transparent); color:var(--spatial-app-error); }
.spatial-monitor__checkpoint { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; }
.spatial-monitor__checkpoint strong,.spatial-monitor__checkpoint small { display:block; }.spatial-monitor__checkpoint small { margin-top:3px; color:var(--spatial-app-muted); font-size:10px; }
.spatial-monitor-json { min-width:0; margin-top:10px; }.spatial-monitor-json__header,.spatial-monitor-raw summary { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--spatial-app-muted); font:10px "JetBrains Mono",monospace; text-transform:uppercase; }
.spatial-monitor-json__tree,.spatial-monitor-raw pre { max-height:26rem; overflow:auto; overflow-wrap:anywhere; border:1px solid var(--spatial-app-border); background:color-mix(in srgb,var(--spatial-app-surface) 60%,transparent); padding:8px; font:10px/1.45 "JetBrains Mono",monospace; }
.spatial-monitor-json__node { padding-left:calc(var(--json-depth) * 12px); }.spatial-monitor-json__toggle,.spatial-monitor-json__string { color:var(--spatial-window-frame); }.spatial-monitor-json__value-label { margin-right:5px; color:var(--spatial-app-muted); }.spatial-monitor-json__value,.spatial-monitor-json__string { white-space:pre-wrap; overflow-wrap:anywhere; }.spatial-monitor-json__children { border-left:1px solid var(--spatial-app-border); }.spatial-monitor-json__muted { color:var(--spatial-app-muted); }.spatial-monitor-raw { margin-top:10px; border:1px solid var(--spatial-app-border); }.spatial-monitor-raw summary { padding:7px; cursor:pointer; }.spatial-monitor-raw pre { margin:0; border:0; white-space:pre-wrap; }
@container (max-width:620px) { .spatial-monitor__stats,.spatial-monitor__filters { grid-template-columns:repeat(2,minmax(0,1fr)); }.spatial-monitor__trace { grid-template-columns:1fr; grid-template-rows:180px minmax(0,1fr); }.spatial-monitor__records { border-right:0; border-bottom:1px solid var(--spatial-app-border); }.spatial-monitor__metadata { grid-template-columns:1fr; }.spatial-monitor__provider { display:grid; } }
</style>
