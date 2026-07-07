/**
 * composables/useRuntime.ts — runtime 响应式读取 + 刷新（模块级单例）。
 *
 * 设计决策 D3/D4：runtime 全量解析，模块级单例共享状态（同 useTsian/useSyncAfterTurn 模式），
 * 多个组件调 useRuntime() 共用同一份 RuntimeData，refresh 只触发一次读取。
 *
 * 刷新触发（design §4.5）：
 * - ready 初次加载：watch(ready, immediate)。
 * - turn 完成：tsian.onTurnEnd → refresh()。
 * - sync 完成：setOnSynced(() => refresh())（useSyncAfterTurn 已有钩子）。
 * - runtimeStale 事件：onRuntimeStale(() => refresh())。
 * - refresh() 兜底：checkpoint restore 后由 StoryView 显式调（restore 无事件源，D4）。
 *
 * 错误策略 D7：refresh 内部捕获所有错误，走 error 字段，不向上抛。
 */
import { readonly, ref, watch, computed } from "vue"
import type { Ref } from "vue"
import type { RuntimeData } from "../lib/runtime-types"
import { emptyDisplayItems } from "../lib/runtime-types"
import { parseRuntime } from "../lib/parse-runtime"
import { useTsian, getTsianClient } from "./useTsian"
import { setOnSynced } from "./useSyncAfterTurn"
import { onRuntimeStale } from "./useRuntimeStaleBus"

/** runtime.json workspace 路径（与 lib/source.ts RUNTIME_PATH 对齐）。 */
const RUNTIME_PATH = "save/playthrough/runtime.json"

/** 初始 idle RuntimeData。 */
function initialRuntimeData(): RuntimeData {
  return {
    runtime: null,
    error: null,
    displayItems: emptyDisplayItems(),
    itemErrors: [],
    status: "idle",
  }
}

// ── 模块级共享响应式状态（所有 useRuntime() 调用共用）──
const runtimeData = ref<RuntimeData>(initialRuntimeData())
/** refresh 是否在执行中（避免重复并发读取）。 */
let refreshing = false
/** 在 refresh 执行期间又收到新触发时，标记完成后需再刷新一次（避免漏刷新）。 */
let pendingRefresh = false

/**
 * refresh — 读取 runtime.json 并解析填充 runtimeData。
 *
 * 内部流程（design §4.5）：
 * 1. status = "loading"。
 * 2. workspace.read(RUNTIME_PATH, "save-runtime")。
 * 3. file === null → error: "not-found", runtime: null, status: "error"。
 * 4. JSON.parse 失败 → error: "load-failed", runtime: null, status: "error"。
 * 5. parseRuntime(parsed) 填充结果，status: "ready"。
 * 6. read 抛错 → 同 4，不向上抛（D7）。
 *
 * 并发：turn/sync/stale 可能几乎同时触发。若 refresh 执行期间又收到触发，
 * 标记 pendingRefresh，当前 refresh 完成后再跑一次，确保读到最新数据。
 */
async function refresh(): Promise<void> {
  if (refreshing) {
    pendingRefresh = true
    return
  }
  refreshing = true

  const tsian = getTsianClient()
  runtimeData.value = { ...runtimeData.value, status: "loading" }

  try {
    const file = await tsian.workspace.read(RUNTIME_PATH, "save-runtime")
    if (file === null) {
      // 文件不存在（新存档尚未写 runtime.json 等）
      runtimeData.value = {
        runtime: null,
        error: "not-found",
        displayItems: emptyDisplayItems(),
        itemErrors: [],
        status: "error",
      }
      return
    }
    // content 是字符串，需 JSON.parse；parse 异常 → load-failed（D7）
    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      runtimeData.value = {
        runtime: null,
        error: "load-failed",
        displayItems: emptyDisplayItems(),
        itemErrors: [],
        status: "error",
      }
      return
    }
    // parseRuntime 校验固定字段 + 解析 extensions
    runtimeData.value = parseRuntime(parsed)
  } catch {
    // read 抛错（桥/平台异常）→ load-failed，不向上抛（D7）
    runtimeData.value = {
      runtime: null,
      error: "load-failed",
      displayItems: emptyDisplayItems(),
      itemErrors: [],
      status: "error",
    }
  } finally {
    refreshing = false
    // 执行期间又收到触发：再跑一次，确保读到最新数据
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

  // ready 初次加载：bridge ready 后立即 refresh（immediate：注册时若已 ready 则马上触发）
  watch(ready, (v) => {
    if (v) void refresh()
  }, { immediate: true })

  // turn 完成自动刷新：tsian.onTurnEnd 已支持多订阅者（SDK 遍历所有 callback）
  // useTsian 内部也订阅了 onTurnEnd（驱动 triggerSyncAfterTurn），两者互不干扰。
  tsian.onTurnEnd(() => {
    void refresh()
  })

  // sync 完成自动刷新：useSyncAfterTurn 已有 setOnSynced 钩子。
  // 注意：setOnSynced 是幂等"只保留最后一个"的回调（见 useSyncAfterTurn.ts 注释）。
  // 本任务注册的 refresh 回调是当前唯一消费者，无冲突；
  // 若未来有其他消费者需改 setOnSynced 为支持多回调，避免后续踩坑。
  setOnSynced(() => {
    void refresh()
  })

  // runtimeStale 事件触发刷新（事件总线，D4/D5）
  onRuntimeStale(() => {
    void refresh()
  })
}

/**
 * useRuntime — 在组件中调用，返回 runtime 响应式状态 + refresh。
 * 模块级单例：多组件调用共用同一份 RuntimeData。
 * 首次调用时注册刷新触发（watch/onTurnEnd/setOnSynced/onRuntimeStale）。
 */
export function useRuntime() {
  // 首次调用时注册刷新触发（必须在组件 setup 期间调用 watch）
  registerTriggers()

  // status 作为 runtimeData.value.status 的只读 computed 视图，保持响应式
  const status = computed(() => runtimeData.value.status)

  return {
    /** runtime 数据（只读视图）。 */
    runtimeData: readonly(runtimeData) as Readonly<Ref<RuntimeData>>,
    /** 显式刷新（checkpoint restore 后由外部显式调；D4）。 */
    refresh,
    /** 加载状态便捷只读 ref（派生自 runtimeData.status）。 */
    status: readonly(status),
  }
}
