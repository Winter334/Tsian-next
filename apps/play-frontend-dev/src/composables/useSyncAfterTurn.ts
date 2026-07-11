import { readonly, ref } from "vue"
import { getTsianClient } from "./useTsian"
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
let onSyncedCallback: (() => void | Promise<void>) | null = null

/** 注册"同步完成"回调（状态栏数据源刷新等）。幂等，只保留最后一个。
 *  回调支持 async（返回 Promise）——handleSynced 会 await 它，确保 runtime 刷新
 *  等下游依赖在 frontier 检查触发前完成。 */
export function setOnSynced(cb: () => void | Promise<void>): void {
  onSyncedCallback = cb
}

/**
 * 触发回合后同步。在 onTurnEnd（正文已落定）后调用。
 * 若卡未配置 postTurnMaintenance，直接 return（不启动同步流程）。
 */
export async function triggerSyncAfterTurn(turn: number): Promise<void> {
  const tsian = getTsianClient()

  // 上一轮同步未结束（syncing/sync-failed）时不重复触发；
  // sync-failed 需用户显式重试，不自动覆盖。
  if (syncPhase.value === "syncing" || syncPhase.value === "sync-failed") return

  const input = `玩家回合 #${turn} 已完成，正文已落定。请按回合后维护标准流程执行：第一步调用 read_maintenance_context({ turn: ${turn}, includeTimeline: true }) 聚合事实；基于聚合上下文维护 runtime（含 worldTime/plotOrder）/entity/scene/relationship/memory/timeline 变动。只有聚合上下文缺失必要事实时，才进行有针对性的补充 workspace_read。`
  await runSyncInvocation(tsian, input, `sync-turn-${turn}-${Date.now().toString(36)}`, "post-turn-maintenance")
}

/** 用户点击"重试"：重新发起同步调用。 */
export async function retrySyncAfterTurn(): Promise<void> {
  if (syncPhase.value !== "sync-failed") return
  const tsian = getTsianClient()
  const input = "请重新按回合后维护标准流程维护上一回合：第一步调用 read_maintenance_context({ includeTimeline: true }) 聚合事实；基于聚合上下文维护 runtime（含 worldTime/plotOrder）/entity/scene/relationship/memory/timeline 变动。只有聚合上下文缺失必要事实时，才进行有针对性的补充 workspace_read。"
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
  tsian: ReturnType<typeof getTsianClient>,
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
      commitMode: "workspace-with-checkpoint",
      checkpointReason: "post-turn-maintenance",
      persist: true,
    })
    // 成功 resolve：onAgentInvocation 的 completed 事件会驱动 synced，
    // 但若平台未发 completed 事件（仅 resolve），这里兜底切 synced。
    if (activeInvocationId === invocationId && syncPhase.value === "syncing") {
      void handleSynced()
    }
  } catch (err) {
    if (activeInvocationId === invocationId) {
      handleSyncFailed()
    }
    console.error("[useSyncAfterTurn] invokeAgent failed:", err)
  }
}

function ensureInvocationSubscription(tsian: ReturnType<typeof getTsianClient>): void {
  if (invocationSubscribed) return
  invocationSubscribed = true
  tsian.onAgentInvocation((event) => {
    if (!activeInvocationId) return
    if (event.invocationId !== activeInvocationId) return
    if (event.type === "completed") {
      void handleSynced()
    } else if (event.type === "failed") {
      handleSyncFailed()
    }
  })
}

/**
 * 同步成功处理。async 以支持 onSynced 回调返回 Promise（如 useRuntime.refresh +
 * 链式 frontier 检查）。1.5s 淡出定时器在回调完成后启动，确保下游依赖
 * （runtime 刷新、frontier 触发）在 Toast 切到 idle 前跑完。
 *
 * Toast 立即切 synced（视觉反馈），回调异步跑完后启动淡出计时。
 * 若回调异常只 log 不影响 Toast 状态轴。
 */
async function handleSynced(): Promise<void> {
  syncPhase.value = "synced"
  activeInvocationId = null
  // 触发状态栏数据源刷新 + 链式 frontier 检查（useRuntime 注册的 async 回调）
  try {
    const result = onSyncedCallback?.()
    if (result instanceof Promise) {
      await result
    }
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
