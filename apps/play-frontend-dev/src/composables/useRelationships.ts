/**
 * composables/useRelationships.ts — relationships 分片按需读取薄封装（非模块级单例）。
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
import { ref } from "vue"
import type { Ref } from "vue"
import type { RelationshipFile } from "../lib/character-types"
import { parseRelationships } from "../lib/parse-character"
import { getTsianClient } from "./useTsian"

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

/**
 * useRelationships — relationships 分片按需读取薄封装。
 *
 * @param subjectRef 主体引用，格式 `<type>:<localId>`（如 `character:萧玄`）。
 *   文件名约定：`<type>-<localId>`，存为 `save/relationships/<type>-<localId>.json`。
 * @returns { data, error, load } —— data 为 RelationshipFile | null，
 *   error 为读取级错误。不自动 onMounted 加载——由 UI 决定何时调 load()。
 */
export function useRelationships(subjectRef: string): {
  data: Ref<RelationshipFile | null>
  error: Ref<"load-failed" | "not-found" | null>
  load: () => Promise<void>
} {
  const data = ref<RelationshipFile | null>(null)
  const error = ref<"load-failed" | "not-found" | null>(null)
  let loadVersion = 0

  async function load(): Promise<void> {
    const version = ++loadVersion
    const tsian = getTsianClient()
    const path = subjectRefToRelationshipPath(subjectRef)
    try {
      const file = await tsian.workspace.read(path, "save-runtime")
      if (version !== loadVersion) return
      if (file === null) {
        // 分片不存在（多数角色无关系分片）→ not-found，UI 隐藏关系区段（非错误）。
        error.value = "not-found"
        data.value = null
        return
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(file.content)
      } catch {
        error.value = "load-failed"
        data.value = null
        return
      }
      const rel = parseRelationships(parsed)
      if (rel === null) {
        // 必填字段缺失 → load-failed（type-safety §"play-frontend Workspace Data
        // Consumption"：parsed object missing fixed fields → load-failed）。
        error.value = "load-failed"
        data.value = null
        return
      }
      error.value = null
      data.value = rel
    } catch {
      if (version !== loadVersion) return
      // read 抛错（桥/平台异常）→ load-failed，不向上抛（type-safety §D7）
      error.value = "load-failed"
      data.value = null
    }
  }

  return { data, error, load }
}
