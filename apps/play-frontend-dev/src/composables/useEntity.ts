/**
 * composables/useEntity.ts — 实体按需读取薄封装（带模块级读取缓存）。
 *
 * 设计决策 D3：不预加载所有实体，由 UI 子任务按需读取。每个调用方独立持有
 * 自己的 data/error ref，调 load() 时才发起 workspace.read。
 *
 * ref → entity 路径：`<type>:<localId>` → `save/entities/<type>/<localId>.json`。
 * 读取用 tsian.workspace.read(path, "save-runtime") 显式传 scope（不省略）。
 * content 是字符串需 JSON.parse；parse 异常 → error: "load-failed"（D7，不抛错）。
 */
import { ref, toValue } from "vue"
import type { MaybeRefOrGetter, Ref } from "vue"
import type { EntityData } from "../lib/runtime-types"
import { parseEntity } from "../lib/parse-entity"
import { refToEntityPath } from "../lib/entity-ref"
import { getTsianClient } from "./useTsian"

export { refToEntityPath } from "../lib/entity-ref"

type EntityLoadError = "load-failed" | "not-found" | null

interface EntityCacheEntry {
  data: EntityData | null
  error: EntityLoadError
}

interface EntityLoadOptions {
  force?: boolean
}

const entityCache = new Map<string, EntityCacheEntry>()
const entityInFlight = new Map<string, Promise<EntityCacheEntry>>()

/**
 * 清空实体读取缓存。runtime 刷新（回合结束 / 回合后维护完成 / runtimeStale）后调用——
 * 维护 agent 改写 save/entities/** 时不保证同步改写 runtime.json，缓存不能靠
 * runtime 内容变化来失效。
 */
export function invalidateEntityCache(): void {
  entityCache.clear()
  entityInFlight.clear()
}

async function readEntity(path: string): Promise<EntityCacheEntry> {
  const tsian = getTsianClient()
  try {
    const file = await tsian.workspace.read(path, "save-runtime")
    if (file === null) return { data: null, error: "not-found" }

    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      return { data: null, error: "load-failed" }
    }

    return { data: parseEntity(parsed), error: null }
  } catch {
    // read 抛错（桥/平台异常）→ load-failed，不向上抛（D7）
    return { data: null, error: "load-failed" }
  }
}

async function loadEntityCached(path: string, options: EntityLoadOptions): Promise<EntityCacheEntry> {
  if (!options.force) {
    const cached = entityCache.get(path)
    if (cached) return cached
    const pending = entityInFlight.get(path)
    if (pending) return pending
  }

  if (options.force) {
    entityCache.delete(path)
    entityInFlight.delete(path)
  }

  const promise = readEntity(path)
    .then((entry) => {
      entityCache.set(path, entry)
      return entry
    })
    .finally(() => {
      if (entityInFlight.get(path) === promise) entityInFlight.delete(path)
    })

  entityInFlight.set(path, promise)
  return promise
}

/**
 * useEntity — 实体按需读取薄封装。
 *
 * @param entityRef 实体引用，格式 `<type>:<localId>`（如 `character:萧玄`）。
 * @returns { data, error, load } —— data 为 EntityData | null，error 为读取级错误。
 *   不自动 onMounted 加载——由 UI 子任务决定何时调 load()（展开/点击时）。
 */
export function useEntity(entityRef: MaybeRefOrGetter<string>): {
  data: Ref<EntityData | null>
  error: Ref<EntityLoadError>
  load: (options?: EntityLoadOptions) => Promise<void>
} {
  const data = ref<EntityData | null>(null)
  const error = ref<EntityLoadError>(null)
  let loadVersion = 0
  let requestedRef = ""

  async function load(options: EntityLoadOptions = {}): Promise<void> {
    const version = ++loadVersion
    const refValue = toValue(entityRef)
    if (refValue !== requestedRef) {
      requestedRef = refValue
      error.value = null
      data.value = null
    }
    const path = refToEntityPath(refValue)
    if (!path) {
      error.value = refValue ? "not-found" : null
      data.value = null
      return
    }

    const entry = await loadEntityCached(path, options)
    if (version !== loadVersion) return
    error.value = entry.error
    data.value = entry.data
  }

  return { data, error, load }
}
