/**
 * composables/useFrontier.ts — frontier.json 响应式读取 + 刷新（模块级单例）。
 *
 * 同 useRuntime 模式：模块级共享 frontierData ref，多组件调 useFrontier() 共用一份。
 * TimelineView 消费 frontierData.frontier.timeline 渲染分支图。
 *
 * 刷新触发：
 * - ready 初次加载：watch(ready, immediate)。
 * - turn 完成：tsian.onTurnEnd（stage-manager 维护后 timeline 可能有新 player 锚点）。
 * - sync 完成：setOnSynced 链式（同 useRuntime，sync 后 frontier 可能变）。
 * - runtimeStale 事件：onRuntimeStale。
 *
 * 错误策略：refresh 内部捕获所有错误，走 error 字段，不向上抛（同 useRuntime D7）。
 */
import { readonly, ref, watch, computed } from "vue"
import type { Ref } from "vue"
import type { FrontierData } from "../lib/frontier-types"
import { initialFrontierData } from "../lib/frontier-types"
import { parseFrontier } from "../lib/parse-frontier"
import { FRONTIER_PATH } from "../lib/source"
import { useTsian, getTsianClient } from "./useTsian"
import { setOnSynced } from "./useSyncAfterTurn"
import { onRuntimeStale } from "./useRuntimeStaleBus"

// ── 模块级共享响应式状态 ──
const frontierData = ref<FrontierData>(initialFrontierData())
let refreshing = false
let pendingRefresh = false

/**
 * refresh — 读取 frontier.json 并解析填充 frontierData。
 *
 * 内部流程：
 * 1. status = "loading"。
 * 2. workspace.read(FRONTIER_PATH, "save-runtime")。
 * 3. file === null → error: "not-found", frontier: null, status: "error"。
 * 4. JSON.parse 失败 → error: "load-failed", frontier: null, status: "error"。
 * 5. parseFrontier(parsed) 填充结果，status: "ready"。
 * 6. read 抛错 → load-failed，不向上抛。
 *
 * 并发：同 useRuntime 的 pendingRefresh 模式。
 */
async function refresh(): Promise<void> {
  if (refreshing) {
    pendingRefresh = true
    return
  }
  refreshing = true

  const tsian = getTsianClient()
  frontierData.value = { ...frontierData.value, status: "loading" }

  try {
    const file = await tsian.workspace.read(FRONTIER_PATH, "save-runtime")
    if (file === null) {
      frontierData.value = { frontier: null, error: "not-found", status: "error" }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      frontierData.value = { frontier: null, error: "load-failed", status: "error" }
      return
    }
    frontierData.value = parseFrontier(parsed)
  } catch {
    frontierData.value = { frontier: null, error: "load-failed", status: "error" }
  } finally {
    refreshing = false
    if (pendingRefresh) {
      pendingRefresh = false
      void refresh()
    }
  }
}

// ── 刷新触发注册（只注册一次，模块级幂等）──
let registered = false

function registerTriggers(): void {
  if (registered) return
  registered = true

  const { tsian, ready } = useTsian()

  watch(ready, (v) => {
    if (v) void refresh()
  }, { immediate: true })

  tsian.onTurnEnd(() => {
    void refresh()
  })

  // sync 完成后刷新：setOnSynced 是幂等"只保留最后一个"的回调（见 useSyncAfterTurn 注释）。
  // useRuntime 已注册了一个 async 回调（refresh + frontier 检查）。
  // 这里不能覆盖 useRuntime 的回调——useFrontier 的 refresh 通过 onTurnEnd 和
  // onRuntimeStale 已经能覆盖 sync 后刷新（sync 完成 → useRuntime refresh →
  // frontier advance succeeded → onRuntimeStale 或 onTurnEnd 触发 useFrontier refresh）。
  // 不调 setOnSynced，避免覆盖 useRuntime 的回调。

  onRuntimeStale(() => {
    void refresh()
  })
}

/**
 * useFrontier — 在组件中调用，返回 frontier 响应式状态 + refresh。
 * 模块级单例：多组件调用共用同一份 FrontierData。
 * 首次调用时注册刷新触发。
 */
export function useFrontier() {
  registerTriggers()

  const status = computed(() => frontierData.value.status)

  return {
    frontierData: readonly(frontierData) as Readonly<Ref<FrontierData>>,
    refresh,
    status: readonly(status),
  }
}
