import type {
  DiagnosticAiRequestStatus,
  DiagnosticRecord,
  DiagnosticRecordQuery,
  DiagnosticRecordSummary,
  DiagnosticStoreHealth,
  DiagnosticTraceFacets,
  DiagnosticTraceOverview,
  PlayFrontendBridge,
} from "@tsian/contracts"
import { computed, ref, shallowRef } from "vue"
import { toast } from "@/composables/useToast"
import { playFrontendBridge } from "@/platform-host"
import { EMPTY_DIAGNOSTIC_HEALTH, EMPTY_DIAGNOSTIC_OVERVIEW } from "./monitor-controller"

export const TRACE_PAGE_SIZE = 30
export type TraceStatusFilter = "" | DiagnosticAiRequestStatus | "frontend-error"
export type TraceTimeRange = "all" | "hour" | "day" | "week"
type TraceBridge = { debug?: NonNullable<PlayFrontendBridge["debug"]> }

const EMPTY_FACETS: DiagnosticTraceFacets = { providers: [], models: [] }

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function diagnosticQuery(input: {
  offset: number
  timeRange: TraceTimeRange
  status: TraceStatusFilter
  provider: string
  model: string
  text: string
}): DiagnosticRecordQuery {
  const rangeMs = input.timeRange === "hour" ? 3_600_000 : input.timeRange === "day" ? 86_400_000 : input.timeRange === "week" ? 604_800_000 : 0
  return {
    offset: input.offset,
    limit: TRACE_PAGE_SIZE,
    ...(rangeMs > 0 ? { fromTimestamp: Date.now() - rangeMs } : {}),
    ...(input.status === "frontend-error" ? { recordType: "frontend-error" as const } : input.status ? { status: input.status } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.text.trim() ? { text: input.text.trim() } : {}),
  }
}

export function traceSummaryTitle(record: Pick<DiagnosticRecordSummary, "recordType" | "provider" | "model">): string {
  return record.recordType === "frontend-error" ? "前端错误" : `${record.provider ?? "unknown"} · ${record.model ?? "unknown"}`
}

export function traceStatusLabel(record: Pick<DiagnosticRecordSummary, "recordType" | "status">): string {
  if (record.recordType === "frontend-error") return "前端错误"
  if (record.status === "running") return "进行中"
  if (record.status === "succeeded") return "成功"
  if (record.status === "aborted") return "已中止"
  if (record.status === "interrupted") return "已中断"
  if (record.status === "failed") return "失败"
  return "未知"
}

export function traceFormatTime(timestamp: number): string { return new Date(timestamp).toLocaleString() }
export function traceFormatDuration(duration?: number): string {
  if (duration === undefined) return "--"
  if (duration < 1_000) return `${Math.round(duration)}ms`
  return `${(duration / 1_000).toFixed(duration < 10_000 ? 1 : 0)}s`
}

export function createTraceController(bridge: TraceBridge = playFrontendBridge) {
  const summaries = shallowRef<DiagnosticRecordSummary[]>([])
  const selectedRecord = shallowRef<DiagnosticRecord | null>(null)
  const facets = shallowRef<DiagnosticTraceFacets>(EMPTY_FACETS)
  const overview = shallowRef<DiagnosticTraceOverview>(EMPTY_DIAGNOSTIC_OVERVIEW)
  const health = shallowRef<DiagnosticStoreHealth>(EMPTY_DIAGNOSTIC_HEALTH)
  const selectedId = ref("")
  const pageOffset = ref(0)
  const hasMore = ref(false)
  const listLoading = ref(false)
  const detailLoading = ref(false)
  const error = ref("")
  const timeRange = ref<TraceTimeRange>("all")
  const status = ref<TraceStatusFilter>("")
  const provider = ref("")
  const model = ref("")
  const text = ref("")
  const disposed = ref(false)
  let filterTimer: ReturnType<typeof setTimeout> | null = null
  let updateTimer: ReturnType<typeof setTimeout> | null = null
  let listRequest = 0
  let detailRequest = 0
  let metadataRequest = 0
  let pendingRecordRefresh = false
  let unsubscribe: (() => void) | null = null
  const pendingDownloadUrls = new Set<string>()

  const currentPage = computed(() => Math.floor(pageOffset.value / TRACE_PAGE_SIZE) + 1)
  const rawJson = computed(() => selectedRecord.value ? JSON.stringify(selectedRecord.value, null, 2) : "")
  const selectedIsFailure = computed(() => selectedRecord.value !== null && (selectedRecord.value.recordType === "frontend-error" || selectedRecord.value.status === "failed" || selectedRecord.value.status === "interrupted"))
  const canExport = computed(() => selectedIsFailure.value || !!overview.value.latestFailureId)

  function buildQuery(): DiagnosticRecordQuery {
    return diagnosticQuery({ offset: pageOffset.value, timeRange: timeRange.value, status: status.value, provider: provider.value, model: model.value, text: text.value })
  }

  async function loadDetail(id: string): Promise<boolean> {
    if (disposed.value) return false
    const request = ++detailRequest
    if (!id) { selectedRecord.value = null; detailLoading.value = false; return true }
    const debug = bridge.debug
    if (!debug) return false
    detailLoading.value = true
    try {
      const record = await debug.getDiagnosticRecord(id)
      if (disposed.value || request !== detailRequest || selectedId.value !== id) return false
      selectedRecord.value = record
      return true
    } catch (cause) {
      if (disposed.value || request !== detailRequest || selectedId.value !== id) return false
      throw cause
    } finally {
      if (request === detailRequest) detailLoading.value = false
    }
  }

  async function loadList(): Promise<boolean> {
    if (disposed.value) return false
    const debug = bridge.debug
    if (!debug) throw new Error("当前环境未提供诊断查询接口。")
    const request = ++listRequest
    listLoading.value = true
    try {
      const page = await debug.queryDiagnosticSummaries(buildQuery())
      if (disposed.value || request !== listRequest) return false
      summaries.value = page.items
      hasMore.value = page.hasMore
      const nextId = page.items.some((item) => item.id === selectedId.value) ? selectedId.value : page.items[0]?.id ?? ""
      if (nextId !== selectedId.value || selectedRecord.value?.id !== nextId) {
        selectedId.value = nextId
        await loadDetail(nextId)
      }
      return true
    } finally {
      if (request === listRequest) listLoading.value = false
    }
  }

  async function loadMetadata(): Promise<void> {
    if (disposed.value) return
    const debug = bridge.debug
    if (!debug) return
    const request = ++metadataRequest
    const [nextFacets, nextOverview, nextHealth] = await Promise.all([debug.getDiagnosticFacets(), debug.getDiagnosticOverview(), debug.getDiagnosticStoreHealth()])
    if (!disposed.value && request === metadataRequest) {
      facets.value = nextFacets
      overview.value = nextOverview
      health.value = nextHealth
    }
  }

  async function refresh(): Promise<void> {
    if (disposed.value) return
    error.value = ""
    try { await Promise.all([loadList(), loadMetadata()]) }
    catch (cause) { if (!disposed.value) error.value = errorMessage(cause, "刷新统一 Trace 时发生未知错误。") }
  }

  async function select(id: string): Promise<void> {
    if (disposed.value) return
    if (selectedId.value === id && selectedRecord.value?.id === id) return
    selectedId.value = id
    try { if (await loadDetail(id)) error.value = "" }
    catch (cause) { error.value = errorMessage(cause, "读取 Trace 详情失败。") }
  }

  async function changePage(direction: -1 | 1): Promise<void> {
    if (disposed.value) return
    const previous = pageOffset.value
    pageOffset.value = Math.max(0, pageOffset.value + direction * TRACE_PAGE_SIZE)
    try { if (await loadList()) error.value = "" }
    catch (cause) { pageOffset.value = previous; error.value = errorMessage(cause, "翻页失败。") }
  }

  function scheduleFilterRefresh(): void {
    if (disposed.value) return
    if (filterTimer) clearTimeout(filterTimer)
    filterTimer = setTimeout(() => { pageOffset.value = 0; void loadList().catch((cause) => { error.value = errorMessage(cause, "筛选 Trace 失败。") }) }, 250)
  }

  async function copyRaw(): Promise<void> {
    if (disposed.value || !rawJson.value) return
    try { await navigator.clipboard.writeText(rawJson.value); toast.success("已复制原始 JSON。") }
    catch { toast.error("复制失败，请手动选择文本。") }
  }

  async function downloadBundle(reproductionSteps = ""): Promise<boolean> {
    const debug = bridge.debug
    if (disposed.value || !debug || !canExport.value) return false
    let url: string | undefined
    let link: HTMLAnchorElement | undefined
    try {
      const result = await debug.exportDiagnosticBundle({ ...(selectedIsFailure.value && selectedRecord.value ? { selectedFailureId: selectedRecord.value.id } : {}), reproductionSteps })
      if (disposed.value) return false
      url = URL.createObjectURL(result.blob)
      pendingDownloadUrls.add(url)
      link = document.createElement("a")
      link.href = url; link.download = result.fileName; link.rel = "noopener"
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => { if (pendingDownloadUrls.delete(url!)) URL.revokeObjectURL(url!) }, 1_000)
      toast.success(`诊断包已生成，共 ${result.recordCount} 条记录。`)
      return true
    } catch (cause) { if (!disposed.value) error.value = errorMessage(cause, "生成诊断包失败。"); return false }
    finally { link?.remove() }
  }

  function start(): void {
    if (disposed.value || unsubscribe) return
    unsubscribe = bridge.debug?.onDiagnosticRecordsChanged((change) => {
      pendingRecordRefresh ||= change.type !== "health"
      if (updateTimer) clearTimeout(updateTimer)
      updateTimer = setTimeout(() => {
        const refreshRecords = pendingRecordRefresh
        pendingRecordRefresh = false
        void (refreshRecords ? Promise.all([loadList(), loadMetadata(), selectedId.value ? loadDetail(selectedId.value) : Promise.resolve(true)]) : loadMetadata())
          .catch((cause) => { error.value = errorMessage(cause, "刷新 Trace 更新失败。") })
      }, 100)
    }) ?? null
  }

  function dispose(): void {
    if (disposed.value) return
    disposed.value = true
    unsubscribe?.(); unsubscribe = null
    if (filterTimer) clearTimeout(filterTimer)
    if (updateTimer) clearTimeout(updateTimer)
    listRequest += 1; detailRequest += 1; metadataRequest += 1
    for (const url of pendingDownloadUrls) URL.revokeObjectURL(url)
    pendingDownloadUrls.clear()
  }

  return { summaries, selectedRecord, facets, overview, health, selectedId, pageOffset, hasMore, listLoading, detailLoading, error, timeRange, status, provider, model, text, currentPage, rawJson, canExport, selectedIsFailure, loadList, loadDetail, loadMetadata, refresh, select, changePage, scheduleFilterRefresh, copyRaw, downloadBundle, start, dispose }
}
