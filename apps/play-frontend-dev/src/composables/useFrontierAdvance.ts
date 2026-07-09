import { readonly, ref } from "vue"
import { getTsianClient } from "./useTsian"
import type { AgentInvocationEvent } from "@tsian/play-bridge"

/**
 * useFrontierAdvance — frontier 推进触发编排（模块级单例，同 useSyncAfterTurn 模式）。
 *
 * 在回合后维护成功、runtime 刷新后，前端做客观边界检查：
 *   runtime.plotOrder > frontier.timeline 最后 source 锚点 order
 *   AND frontier.sourceWindow.end < 源章节总数
 *   AND 去重（同 plotOrder 已完成/进行中不重复触发）
 * 满足则 invokeAgent("world-architect", { purpose:"frontier-advance",
 * contextSlot:"frontier-advance", commitMode:"workspace" }) 推进素材边界。
 *
 * 状态轴：idle → advancing → succeeded → idle
 *                      └→ failed → (手动重试) → advancing
 *
 * 非阻塞：不锁 Composer，玩家可在推进期间继续下一轮。
 * 去重状态持久化到 save/playthrough/frontier-trigger-state.json；
 * in-flight（isInFlight）仅内存，刷新后不形成 stale lock。
 *
 * 不硬编码 agent 名到 Toast 文案（AIRP 原则 2）：Toast 说"正在拓展素材边界"，
 * 不说"world-architect 正在工作"。agentId "world-architect" 是默认 novel AIRP
 * 卡模板的局部约定，不进入平台 contracts（R9）。
 */

// ── 模块级共享响应式状态 ──
type FrontierAdvancePhase = "idle" | "advancing" | "succeeded" | "failed"

const phase = ref<FrontierAdvancePhase>("idle")
const lastError = ref<string | null>(null)

// in-flight 仅内存，不持久化（避免刷新后 stale lock）
let isInFlight = false
let activeInvocationId: string | null = null
let invocationSubscribed = false
let succeededTimer: ReturnType<typeof setTimeout> | null = null

// 手动重试标志：retryFrontierAdvance 置 true 后 checkFrontierAdvance 忽略 lastFailed 去重
let manualRetry = false

// ── 常量 ──
const RUNTIME_PATH = "save/playthrough/runtime.json"
const FRONTIER_PATH = "save/playthrough/frontier.json"
const MANIFEST_PATH = "save/source/manifest.json"
const TRIGGER_STATE_PATH = "save/playthrough/frontier-trigger-state.json"
const FRONTIER_ADVANCE_AGENT = "world-architect"
const FRONTIER_ADVANCE_INPUT =
  "请推进 source frontier：读取下一段源章节窗口，识别剧情节点建立 source 锚点，抽取最小素材增量。"

// ── trigger-state 类型 ──
interface TriggerState {
  version: number
  /** 源章节已读完终态标记：true 时短路，不再读 runtime/frontier/manifest。 */
  exhausted: boolean
  lastChecked: {
    turn: number
    plotOrder: number
    lastSourceOrder: number
    key: number
  } | null
  lastCompleted: {
    turn: number
    key: number
    completedAt: string
  } | null
  lastFailed: {
    turn: number
    key: number
    message: string
    failedAt: string
  } | null
}

function defaultTriggerState(): TriggerState {
  return { version: 1, exhausted: false, lastChecked: null, lastCompleted: null, lastFailed: null }
}

// ── trigger-state 读写 ──
async function loadTriggerState(tsian: ReturnType<typeof getTsianClient>): Promise<TriggerState> {
  try {
    const file = await tsian.workspace.read(TRIGGER_STATE_PATH, "save-runtime")
    if (!file?.content) return defaultTriggerState()
    const parsed = JSON.parse(file.content) as Partial<TriggerState>
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      exhausted: typeof parsed.exhausted === "boolean" ? parsed.exhausted : false,
      lastChecked: parsed.lastChecked ?? null,
      lastCompleted: parsed.lastCompleted ?? null,
      lastFailed: parsed.lastFailed ?? null,
    }
  } catch {
    // 文件不存在或解析失败 → 默认值
    return defaultTriggerState()
  }
}

async function saveTriggerState(
  tsian: ReturnType<typeof getTsianClient>,
  state: TriggerState,
): Promise<void> {
  try {
    await tsian.workspace.write(TRIGGER_STATE_PATH, JSON.stringify(state, null, 2), "save-runtime")
  } catch (err) {
    // 持久化失败不影响内存状态轴，只 log
    console.error("[useFrontierAdvance] saveTriggerState failed:", err)
  }
}

// ── JSON 安全解析辅助 ──
function parseJsonFile(content: string | undefined): Record<string, unknown> | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * checkFrontierAdvance — 客观边界检查 + 触发推进。
 *
 * 在 useRuntime refresh 完成后调用（setOnSynced 链式）。流程：
 * 1. 去重：isInFlight → return
 * 2. 读 trigger-state；exhausted === true → return（源章节已读完短路）
 * 3. 读 runtime.plotOrder
 * 4. 读 frontier.json → timeline source 锚点 max order + sourceWindow.end
 * 5. 读 source manifest → totalChapters (chapterCount 字段)
 * 6. 去重：lastCompleted.key === plotOrder → return
 * 7. 去重：lastFailed.key === plotOrder 且非手动重试 → return
 * 8. 条件：plotOrder > lastSourceOrder AND sourceWindow.end < totalChapters
 *    - sourceWindow.end >= totalChapters → 置 exhausted=true 持久化 → return
 * 9. 满足 → invokeAgent("world-architect", frontier-advance)
 * 10. onAgentInvocation completed/failed 驱动状态轴 + 持久化 trigger-state
 */
export async function checkFrontierAdvance(): Promise<void> {
  if (isInFlight) return

  const tsian = getTsianClient()

  // 1. 读 trigger-state；exhausted 短路（源章节已读完，不再读 runtime/frontier/manifest）
  const triggerState = await loadTriggerState(tsian)
  if (triggerState.exhausted) return

  // 2. 读 runtime.plotOrder
  const runtimeFile = await tsian.workspace.read(RUNTIME_PATH, "save-runtime")
  const runtime = parseJsonFile(runtimeFile?.content)
  if (!runtime) return
  const plotOrderRaw = runtime.plotOrder
  if (typeof plotOrderRaw !== "number" || !Number.isFinite(plotOrderRaw)) return
  const plotOrder = plotOrderRaw

  // 3. 读 frontier.json
  const frontierFile = await tsian.workspace.read(FRONTIER_PATH, "save-runtime")
  const frontier = parseJsonFile(frontierFile?.content)
  if (!frontier) return
  const timelineRaw = frontier.timeline
  if (!Array.isArray(timelineRaw)) return
  // source 锚点：kind === "source"，取 max order
  let lastSourceOrder = 0
  for (const anchor of timelineRaw) {
    if (anchor && typeof anchor === "object" && (anchor as Record<string, unknown>).kind === "source") {
      const order = (anchor as Record<string, unknown>).order
      if (typeof order === "number" && order > lastSourceOrder) {
        lastSourceOrder = order
      }
    }
  }
  // sourceWindow.end
  const sourceWindowRaw = frontier.sourceWindow
  const sourceWindowEnd =
    sourceWindowRaw && typeof sourceWindowRaw === "object"
      ? (sourceWindowRaw as Record<string, unknown>).end
      : undefined
  const sourceWindowEndNum = typeof sourceWindowEnd === "number" ? sourceWindowEnd : 0

  // 4. 读 source manifest totalChapters（字段名 chapterCount）
  const manifestFile = await tsian.workspace.read(MANIFEST_PATH, "save-runtime")
  const manifest = parseJsonFile(manifestFile?.content)
  if (!manifest) return
  const chapterCountRaw = manifest.chapterCount
  const totalChapters = typeof chapterCountRaw === "number" ? chapterCountRaw : 0

  // 更新 lastChecked（调试信息，不阻塞流程）
  const checkedKey = plotOrder
  triggerState.lastChecked = {
    turn: typeof runtime.turn === "number" ? (runtime.turn as number) : 0,
    plotOrder,
    lastSourceOrder,
    key: checkedKey,
  }

  // 5. 去重：已 completed 同 key → 跳过
  if (triggerState.lastCompleted?.key === plotOrder) {
    await saveTriggerState(tsian, triggerState)
    return
  }
  // 6. 去重：已 failed 同 key 且非手动重试 → 跳过（等 plotOrder 变化或手动重试）
  if (triggerState.lastFailed?.key === plotOrder && !manualRetry) {
    await saveTriggerState(tsian, triggerState)
    return
  }
  // 消费手动重试标志
  manualRetry = false

  // 7. 触发条件
  if (plotOrder <= lastSourceOrder) {
    // 还在素材覆盖范围内
    await saveTriggerState(tsian, triggerState)
    return
  }
  if (totalChapters <= 0 || sourceWindowEndNum >= totalChapters) {
    // 没有更多未读章节 → 标记 exhausted 终态，后续回合短路
    triggerState.exhausted = true
    await saveTriggerState(tsian, triggerState)
    return
  }

  // 8. 触发推进
  isInFlight = true
  phase.value = "advancing"
  lastError.value = null
  activeInvocationId = `frontier-${plotOrder}-${Date.now().toString(36)}`
  const invocationId = activeInvocationId

  ensureInvocationSubscription(tsian)

  // 先持久化 lastChecked（记录触发前的状态）
  await saveTriggerState(tsian, triggerState)

  try {
    await tsian.invokeAgent(FRONTIER_ADVANCE_AGENT, FRONTIER_ADVANCE_INPUT, {
      invocationId,
      purpose: "frontier-advance",
      contextSlot: "frontier-advance",
      persist: true,
      commitMode: "workspace",
    })
    // 成功 resolve：onAgentInvocation completed 事件会驱动 succeeded，
    // 但若平台未发 completed 事件（仅 resolve），这里兜底。
    if (activeInvocationId === invocationId && phase.value === "advancing") {
      await handleAdvanceSucceeded(tsian, plotOrder, invocationId)
    }
  } catch (err) {
    if (activeInvocationId === invocationId) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "invokeAgent rejected"
      await handleAdvanceFailed(tsian, plotOrder, message, invocationId)
    }
    console.error("[useFrontierAdvance] invokeAgent failed:", err)
  }
}

/**
 * retryFrontierAdvance — 手动重试。忽略 lastFailed key 去重，强制重新触发。
 * 仅在 failed 状态时有意义（UI 按钮仅在 failed 时显示）。
 */
export async function retryFrontierAdvance(): Promise<void> {
  if (phase.value !== "failed") return
  manualRetry = true
  await checkFrontierAdvance()
}

// ── 事件订阅（同 useSyncAfterTurn 模式）──
function ensureInvocationSubscription(tsian: ReturnType<typeof getTsianClient>): void {
  if (invocationSubscribed) return
  invocationSubscribed = true
  tsian.onAgentInvocation((event: AgentInvocationEvent) => {
    if (!activeInvocationId) return
    if (event.invocationId !== activeInvocationId) return
    if (event.type === "completed") {
      void handleAdvanceSucceeded(tsian, 0, activeInvocationId)
    } else if (event.type === "failed") {
      const message = event.error?.message ?? "agent invocation failed"
      void handleAdvanceFailed(tsian, 0, message, activeInvocationId)
    }
  })
}

// 事件回调中 plotOrder 未知（事件不携带），用 0 占位——
// 实际 key 在 checkFrontierAdvance 的 try/catch 路径中已通过闭包传入。
// 事件路径是兜底：若 try/catch 已处理则 activeInvocationId 已清，不会重复进入。
async function handleAdvanceSucceeded(
  tsian: ReturnType<typeof getTsianClient>,
  plotOrder: number,
  invocationId: string,
): Promise<void> {
  if (activeInvocationId !== invocationId) return
  phase.value = "succeeded"
  activeInvocationId = null
  isInFlight = false

  // 持久化 lastCompleted（用当前 runtime plotOrder 作 key）
  const state = await loadTriggerState(tsian)
  const key = plotOrder > 0 ? plotOrder : state.lastChecked?.plotOrder ?? 0
  if (key > 0) {
    state.lastCompleted = {
      turn: state.lastChecked?.turn ?? 0,
      key,
      completedAt: new Date().toISOString(),
    }
    state.lastFailed = null
    await saveTriggerState(tsian, state)
  }

  // 1.5s 后回 idle（Toast 淡出，同 handleSynced 模式）
  if (succeededTimer) clearTimeout(succeededTimer)
  succeededTimer = setTimeout(() => {
    phase.value = "idle"
    succeededTimer = null
  }, 1500)
}

async function handleAdvanceFailed(
  tsian: ReturnType<typeof getTsianClient>,
  plotOrder: number,
  message: string,
  invocationId: string,
): Promise<void> {
  if (activeInvocationId !== invocationId) return
  phase.value = "failed"
  lastError.value = message
  activeInvocationId = null
  isInFlight = false

  // 持久化 lastFailed
  const state = await loadTriggerState(tsian)
  const key = plotOrder > 0 ? plotOrder : state.lastChecked?.plotOrder ?? 0
  if (key > 0) {
    state.lastFailed = {
      turn: state.lastChecked?.turn ?? 0,
      key,
      message,
      failedAt: new Date().toISOString(),
    }
    await saveTriggerState(tsian, state)
  }
}

/** 重置 frontier 推进状态（restore/rollback 后调，丢弃残留）。 */
export function resetFrontierAdvancePhase(): void {
  if (succeededTimer) {
    clearTimeout(succeededTimer)
    succeededTimer = null
  }
  isInFlight = false
  manualRetry = false
  activeInvocationId = null
  phase.value = "idle"
  lastError.value = null
}

export function useFrontierAdvance() {
  return {
    phase: readonly(phase),
    lastError: readonly(lastError),
    checkFrontierAdvance,
    retryFrontierAdvance,
    resetFrontierAdvancePhase,
  }
}
