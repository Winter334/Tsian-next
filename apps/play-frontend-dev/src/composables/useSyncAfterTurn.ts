import { readonly, ref } from "vue"
import { useTsian } from "./useTsian"
import type { SyncPhase } from "../types"

/**
 * useSyncAfterTurn — 回合后同步编排。
 *
 * 主回合正文落定（onTurnEnd）后，若卡配置了 entrypoints.postTurnMaintenance，
 * 前端发起一次 invokeAgent 调用回合后维护 Agent，并驱动 SyncPhase 状态轴：
 *   standby → syncing → synced → idle
 *                     └→ sync-failed → (重试) → syncing
 *
 * 不硬编码 agent 名：从 tsian.card.entrypoints() 读 postTurnMaintenance agent id，
 * 用它调 invokeAgent。Toast 文案只描述阶段行为（"本回合整理中"），不引用 agent id/title。
 *
 * 状态是模块级共享（同 useTsian 模式），多组件调用共用同一 syncPhase。
 */
const syncPhase = ref<SyncPhase>("idle")

let activeInvocationId: string | null = null
let syncedTimer: ReturnType<typeof setTimeout> | null = null
let invocationSubscribed = false
let onSyncedCallback: (() => void) | null = null

/** 注册"同步完成"回调（状态栏数据源刷新等）。幂等，只保留最后一个。 */
export function setOnSynced(cb: () => void): void {
  onSyncedCallback = cb
}

/**
 * 触发回合后同步。在 onTurnEnd（正文已落定）后调用。
 * 若卡未配置 postTurnMaintenance，直接 return（不启动同步流程）。
 */
export async function triggerSyncAfterTurn(turn: number): Promise<void> {
  const { tsian } = useTsian()

  // 上一轮同步未结束（syncing/sync-failed）时不重复触发；
  // sync-failed 需用户显式重试，不自动覆盖。
  if (syncPhase.value === "syncing" || syncPhase.value === "sync-failed") return

  const input = `玩家回合 #${turn} 已完成，正文已落定。请维护本回合的 runtime/entity/scene/relationship/memory/status bar 变动。`
  await runSyncInvocation(tsian, input, `sync-turn-${turn}-${Date.now().toString(36)}`, "post-turn-maintenance")
}

/** 用户点击"重试"：重新发起同步调用。 */
export async function retrySyncAfterTurn(): Promise<void> {
  if (syncPhase.value !== "sync-failed") return
  const { tsian } = useTsian()
  const input = "请重新维护上一回合的 runtime/entity/scene/relationship/memory/status bar 变动。"
  await runSyncInvocation(tsian, input, `sync-retry-${Date.now().toString(36)}`, "post-turn-maintenance-retry")
}

/**
 * 同步调用的共享执行体：读 entrypoints → 取 postTurnMaintenance agent id → invokeAgent。
 * 不硬编码 agent 名：agentId 完全来自卡配置。Toast 文案由调用方决定，与本函数无关。
 * - 卡未配置 postTurnMaintenance：静默 return（无同步流程）
 * - 成功（completed 事件或 Promise resolve）：handleSynced
 * - 失败（failed 事件或 Promise reject）：handleSyncFailed
 */
async function runSyncInvocation(
  tsian: ReturnType<typeof useTsian>["tsian"],
  input: string,
  invocationId: string,
  purpose: string,
): Promise<void> {
  let entrypoints
  try {
    entrypoints = await tsian.card.entrypoints()
  } catch (err) {
    console.error("[useSyncAfterTurn] card.entrypoints() failed:", err)
    return
  }

  const agentId = entrypoints.postTurnMaintenance?.trim()
  if (!agentId) return // 卡未配置回合后维护入口，无同步流程

  ensureInvocationSubscription(tsian)
  activeInvocationId = invocationId
  syncPhase.value = "syncing"

  try {
    await tsian.invokeAgent(agentId, input, {
      invocationId,
      purpose,
      commitMode: "workspace",
      persist: true,
    })
    // 成功 resolve：onAgentInvocation 的 completed 事件会驱动 synced，
    // 但若平台未发 completed 事件（仅 resolve），这里兜底切 synced。
    if (activeInvocationId === invocationId && syncPhase.value === "syncing") {
      handleSynced()
    }
  } catch (err) {
    if (activeInvocationId === invocationId) {
      handleSyncFailed()
    }
    console.error("[useSyncAfterTurn] invokeAgent failed:", err)
  }
}

function ensureInvocationSubscription(tsian: ReturnType<typeof useTsian>["tsian"]): void {
  if (invocationSubscribed) return
  invocationSubscribed = true
  tsian.onAgentInvocation((event) => {
    if (!activeInvocationId) return
    if (event.invocationId !== activeInvocationId) return
    if (event.type === "completed") {
      handleSynced()
    } else if (event.type === "failed") {
      handleSyncFailed()
    }
  })
}

function handleSynced(): void {
  syncPhase.value = "synced"
  activeInvocationId = null
  // 触发状态栏数据源刷新（待 07-04-left-status-bar-mvp 接入实际状态栏 composable）
  try {
    onSyncedCallback?.()
  } catch (err) {
    console.error("[useSyncAfterTurn] onSynced callback threw:", err)
  }
  // 1.5s 后回 idle（Toast 淡出）
  if (syncedTimer) clearTimeout(syncedTimer)
  syncedTimer = setTimeout(() => {
    syncPhase.value = "idle"
    syncedTimer = null
  }, 1500)
}

function handleSyncFailed(): void {
  syncPhase.value = "sync-failed"
  activeInvocationId = null
}

/** 重置同步状态（restore 回溯后调，丢弃残留）。 */
export function resetSyncPhase(): void {
  if (syncedTimer) {
    clearTimeout(syncedTimer)
    syncedTimer = null
  }
  activeInvocationId = null
  syncPhase.value = "idle"
}

export function useSyncAfterTurn() {
  return {
    syncPhase: readonly(syncPhase),
    triggerSyncAfterTurn,
    retrySyncAfterTurn,
    resetSyncPhase,
  }
}
