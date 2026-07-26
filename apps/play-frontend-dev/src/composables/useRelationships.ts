/**
 * composables/useRelationships.ts — relationships 分片按需读取薄封装（带模块级读取缓存）。
 *
 * 与 useEntity/useScene 同构（design §3.4）：
 * - 输入 subject ref（如 `character:萧玄`）。
 * - 路径 `save/relationships/<type>-<localId>.json`，与 platform 写入约定一致
 *   （workspace-templates.ts scopeFromSubject: `type + '-' + localId`）。
 * - 输出 `{ data, error, load }`。
 * - 错误策略：not-found / load-failed，不抛错（type-safety §"play-frontend
 *   Workspace Data Consumption"）。
 * - 不自动 onMounted 加载——由 UI 决定。
 */
import { ref, toValue } from "vue"
import type { MaybeRefOrGetter, Ref } from "vue"
import type { RelationshipFile } from "../lib/character-types"
import { parseRelationships } from "../lib/parse-character"
import { getTsianClient } from "./useTsian"

type RelationshipsLoadError = "load-failed" | "not-found" | null

interface RelationshipsCacheEntry {
  data: RelationshipFile | null
  error: RelationshipsLoadError
}

interface RelationshipsLoadOptions {
  force?: boolean
}

const relationshipsCache = new Map<string, RelationshipsCacheEntry>()
const relationshipsInFlight = new Map<string, Promise<RelationshipsCacheEntry>>()

/**
 * 把 subject ref 转成 relationships 分片 workspace 路径。
 * `character:萧玄` → `save/relationships/character-萧玄.json`
 * （scope = `<type>-<localId>`，对齐 platform 的 scopeFromSubject 实现）。
 * 兼容无 `type:` 前缀的 ref（直接当文件名用，不强制重组）。
 */
export function subjectRefToRelationshipPath(subjectRef: string): string {
  const idx = subjectRef.indexOf(":")
  if (idx < 0) return `save/relationships/${subjectRef}.json`
  const type = subjectRef.slice(0, idx)
  const localId = subjectRef.slice(idx + 1)
  return `save/relationships/${type}-${localId}.json`
}

async function readRelationships(path: string): Promise<RelationshipsCacheEntry> {
  const tsian = getTsianClient()
  try {
    const file = await tsian.workspace.read(path, "save-runtime")
    if (file === null) {
      // 分片不存在（多数角色无关系分片）→ not-found，UI 隐藏关系区段（非错误）。
      return { data: null, error: "not-found" }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(file.content)
    } catch {
      return { data: null, error: "load-failed" }
    }

    const rel = parseRelationships(parsed)
    if (rel === null) {
      // 必填字段缺失 → load-failed（type-safety §"play-frontend Workspace Data
      // Consumption"：parsed object missing fixed fields → load-failed）。
      return { data: null, error: "load-failed" }
    }

    return { data: rel, error: null }
  } catch {
    // read 抛错（桥/平台异常）→ load-failed，不向上抛（type-safety §D7）
    return { data: null, error: "load-failed" }
  }
}

async function loadRelationshipsCached(
  path: string,
  options: RelationshipsLoadOptions,
): Promise<RelationshipsCacheEntry> {
  if (!options.force) {
    const cached = relationshipsCache.get(path)
    if (cached) return cached
    const pending = relationshipsInFlight.get(path)
    if (pending) return pending
  }

  if (options.force) {
    relationshipsCache.delete(path)
    relationshipsInFlight.delete(path)
  }

  const promise = readRelationships(path)
    .then((entry) => {
      relationshipsCache.set(path, entry)
      return entry
    })
    .finally(() => {
      if (relationshipsInFlight.get(path) === promise) relationshipsInFlight.delete(path)
    })

  relationshipsInFlight.set(path, promise)
  return promise
}

/**
 * useRelationships — relationships 分片按需读取薄封装。
 *
 * @param subjectRef 主体引用，格式 `<type>:<localId>`（如 `character:萧玄`）。
 *   文件名约定：`<type>-<localId>`，存为 `save/relationships/<type>-<localId>.json`。
 * @returns { data, error, load } —— data 为 RelationshipFile | null，
 *   error 为读取级错误。不自动 onMounted 加载——由 UI 决定何时调 load()。
 */
export function useRelationships(subjectRef: MaybeRefOrGetter<string>): {
  data: Ref<RelationshipFile | null>
  error: Ref<RelationshipsLoadError>
  load: (options?: RelationshipsLoadOptions) => Promise<void>
} {
  const data = ref<RelationshipFile | null>(null)
  const error = ref<RelationshipsLoadError>(null)
  let loadVersion = 0
  let requestedRef = ""

  async function load(options: RelationshipsLoadOptions = {}): Promise<void> {
    const version = ++loadVersion
    const refValue = toValue(subjectRef)
    if (refValue !== requestedRef) {
      requestedRef = refValue
      error.value = null
      data.value = null
    }
    const path = refValue ? subjectRefToRelationshipPath(refValue) : ""
    if (!path) {
      error.value = null
      data.value = null
      return
    }

    const entry = await loadRelationshipsCached(path, options)
    if (version !== loadVersion) return
    error.value = entry.error
    data.value = entry.data
  }

  return { data, error, load }
}
