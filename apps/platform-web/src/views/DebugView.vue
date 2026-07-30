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
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取运行时状态</p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset grid h-full min-h-[420px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">系统监视器不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
        </div>
      </div>

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
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center gap-2 border-t px-3 py-2">
      <span class="font-mono text-[11px] text-text-dim">{{ lastRefreshAt ? `上次刷新：${lastRefreshAt}` : "尚未刷新" }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import type { PlatformContextShell } from "@tsian/contracts"
import { AlertTriangle, CheckCircle2, FileClock, RefreshCw, RotateCcw } from "lucide-vue-next"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import { playFrontendBridge, waitForPlatformHostReady } from "../platform-host"

const platformContext = shallowRef<PlatformContextShell | null>(null)
const checkpointItems = shallowRef<unknown[]>([])
const loading = ref(true)
const errorMessage = ref("")
const lastRefreshAt = ref("")
let unsubscribeTurnReady: (() => void) | null = null

const overallStatus = computed(() => {
  if (!platformContext.value?.activeSaveId) {
    return {
      label: "未选择存档",
      badgeClass: "border-warning/50 bg-warning/10 text-warning",
      dotClass: "bg-warning",
      iconClass: "text-warning",
      icon: AlertTriangle,
    }
  }
  return {
    label: "运行正常",
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
  const legacyReasonLabels: Record<string, string> = {
    initial: "初始",
    "after-turn": "回合后",
    manual: "手动",
    "post-turn-maintenance": "维护",
  }
  return typeof value.reason === "string" ? legacyReasonLabels[value.reason] ?? "unknown" : "unknown"
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

async function refreshAll() {
  loading.value = true
  errorMessage.value = ""
  try {
    const [context, checkpoints] = await Promise.all([
      playFrontendBridge.platform.getPlatformContext(),
      playFrontendBridge.query.query({ resource: "checkpoints" }),
    ])
    platformContext.value = context
    checkpointItems.value = Array.isArray(checkpoints?.items) ? checkpoints.items : []
    lastRefreshAt.value = new Date().toLocaleTimeString()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "刷新系统监视器时发生未知错误。"
  } finally {
    loading.value = false
  }
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
    unsubscribeTurnReady = playFrontendBridge.debug.onTurnDebugReady(() => { void refreshAll() })
  }
})

onBeforeUnmount(() => {
  unsubscribeTurnReady?.()
  unsubscribeTurnReady = null
})
</script>
