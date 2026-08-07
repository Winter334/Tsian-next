import type {
  DiagnosticStoreHealth,
  DiagnosticTraceOverview,
  PlayFrontendBridge,
  PlatformContextShell,
} from "@tsian/contracts"
import { computed, ref, shallowRef } from "vue"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import { playFrontendBridge } from "@/platform-host"

export const EMPTY_DIAGNOSTIC_OVERVIEW: DiagnosticTraceOverview = {
  totalRecords: 0,
  aiRequestCount: 0,
  frontendErrorCount: 0,
  succeededCount: 0,
  failedCount: 0,
  abortedCount: 0,
  runningCount: 0,
  interruptedCount: 0,
  retriedRequestCount: 0,
  usage: { input: 0, output: 0, total: 0, cached: 0, cacheCreation: 0 },
  providers: [],
}

export const EMPTY_DIAGNOSTIC_HEALTH: DiagnosticStoreHealth = { lostRecordCount: 0 }

type MonitorBridge = Pick<PlayFrontendBridge, "platform" | "query"> & {
  debug?: NonNullable<PlayFrontendBridge["debug"]>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function checkpointId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : ""
}

export function checkpointLabel(value: unknown): string {
  return isRecord(value) && typeof value.label === "string" ? value.label : checkpointId(value) || "检查点"
}

export function checkpointTurn(value: unknown): string {
  return isRecord(value) && typeof value.turn === "number" ? String(value.turn) : "--"
}

export function checkpointTime(value: unknown): string {
  return isRecord(value) && typeof value.createdAt === "number"
    ? new Date(value.createdAt).toLocaleString()
    : "时间未知"
}

export function createMonitorController(bridge: MonitorBridge = playFrontendBridge) {
  const context = shallowRef<PlatformContextShell | null>(null)
  const checkpoints = shallowRef<unknown[]>([])
  const overview = shallowRef<DiagnosticTraceOverview>(EMPTY_DIAGNOSTIC_OVERVIEW)
  const health = shallowRef<DiagnosticStoreHealth>(EMPTY_DIAGNOSTIC_HEALTH)
  const loading = ref(false)
  const error = ref("")
  const lastRefreshAt = ref("")
  const activeRequest = ref(0)
  const disposed = ref(false)
  let unsubscribeTurnReady: (() => void) | null = null
  let unsubscribeDiagnostics: (() => void) | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let metadataRequest = 0

  const attentionCount = computed(() => overview.value.failedCount + overview.value.interruptedCount + overview.value.frontendErrorCount)
  const overallStatus = computed(() => {
    if (health.value.lostRecordCount > 0) return "incomplete"
    if (attentionCount.value > 0) return "attention"
    return overview.value.runningCount > 0 ? "running" : "healthy"
  })

  async function refreshMetadata(): Promise<boolean> {
    if (disposed.value) return false
    const debug = bridge.debug
    if (!debug) return false
    const sequence = ++metadataRequest
    const [nextOverview, nextHealth] = await Promise.all([
      debug.getDiagnosticOverview(),
      debug.getDiagnosticStoreHealth(),
    ])
    if (disposed.value || sequence !== metadataRequest) return false
    overview.value = nextOverview
    health.value = nextHealth
    return true
  }

  async function refreshRecovery(): Promise<void> {
    if (disposed.value) return
    const response = await bridge.query.query({ resource: "checkpoints" })
    if (disposed.value) return
    checkpoints.value = Array.isArray(response?.items) ? response.items : []
  }

  async function refreshAll(): Promise<void> {
    if (disposed.value) return
    const sequence = ++activeRequest.value
    loading.value = true
    error.value = ""
    try {
      const [nextContext] = await Promise.all([
        bridge.platform.getPlatformContext(),
        refreshMetadata(),
        refreshRecovery(),
      ])
      if (disposed.value || sequence !== activeRequest.value) return
      context.value = nextContext
      lastRefreshAt.value = new Date().toLocaleTimeString()
    } catch (cause) {
      if (!disposed.value && sequence === activeRequest.value) error.value = errorMessage(cause, "刷新系统监视器时发生未知错误。")
    } finally {
      if (sequence === activeRequest.value) loading.value = false
    }
  }

  async function restoreCheckpoint(id: string): Promise<boolean> {
    if (disposed.value || !id) return false
    const confirmed = await confirm({
      message: "恢复检查点会回滚当前存档的运行时状态。确认继续吗？",
      severity: "danger",
      confirmText: "恢复",
    })
    if (disposed.value || !confirmed) return false
    const result = await bridge.platform.runAction({ action: "restore-checkpoint", params: { checkpointId: id } })
    if (disposed.value) return false
    if (!result.ok) {
      toast.error(result.error?.message ?? "恢复检查点失败。")
      return false
    }
    await refreshAll()
    if (disposed.value) return false
    toast.success("已恢复检查点。")
    return true
  }

  function start(): void {
    if (disposed.value || unsubscribeTurnReady || unsubscribeDiagnostics) return
    const debug = bridge.debug
    unsubscribeTurnReady = debug?.onTurnDebugReady(() => {
      void refreshRecovery().catch(() => {
        // The explicit refresh action remains the visible recovery error path.
      })
    }) ?? null
    unsubscribeDiagnostics = debug?.onDiagnosticRecordsChanged(() => {
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = setTimeout(() => {
        void refreshMetadata().catch((cause) => { error.value = errorMessage(cause, "刷新诊断统计失败。") })
      }, 100)
    }) ?? null
  }

  function dispose(): void {
    if (disposed.value) return
    disposed.value = true
    activeRequest.value += 1
    metadataRequest += 1
    unsubscribeTurnReady?.()
    unsubscribeDiagnostics?.()
    unsubscribeTurnReady = null
    unsubscribeDiagnostics = null
    if (refreshTimer) clearTimeout(refreshTimer)
  }

  return {
    context,
    checkpoints,
    overview,
    health,
    loading,
    error,
    lastRefreshAt,
    attentionCount,
    overallStatus,
    refreshMetadata,
    refreshRecovery,
    refreshAll,
    restoreCheckpoint,
    start,
    dispose,
  }
}
