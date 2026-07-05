/**
 * composables/useEntity.ts — 实体按需读取薄封装（非模块级单例）。
 *
 * 设计决策 D3：不预加载所有实体，由 UI 子任务按需读取。每个调用方独立持有
 * 自己的 data/error ref，调 load() 时才发起 workspace.read。
 *
 * ref → entity 路径：`<type>:<localId>` → `save/entities/<type>/<localId>.json`。
 * 读取用 tsian.workspace.read(path, "save-runtime") 显式传 scope（不省略）。
 * content 是字符串需 JSON.parse；parse 异常 → error: "load-failed"（D7，不抛错）。
 */
import { ref } from "vue"
import type { Ref } from "vue"
import type { EntityData } from "../lib/runtime-types"
import { parseEntity } from "../lib/parse-entity"
import { useTsian } from "./useTsian"

/**
 * 把实体 ref 转成 workspace 文件路径。
 * `character:萧玄` → `save/entities/character/萧玄.json`
 */
export function refToEntityPath(ref: string): string {
  const idx = ref.indexOf(":")
  if (idx <= 0) return `save/entities/${ref}.json`
  const type = ref.slice(0, idx)
  const localId = ref.slice(idx + 1)
  return `save/entities/${type}/${localId}.json`
}

/**
 * useEntity — 实体按需读取薄封装。
 *
 * @param entityRef 实体引用，格式 `<type>:<localId>`（如 `character:萧玄`）。
 * @returns { data, error, load } —— data 为 EntityData | null，error 为读取级错误。
 *   不自动 onMounted 加载——由 UI 子任务决定何时调 load()（展开/点击时）。
 */
export function useEntity(entityRef: string): {
  data: Ref<EntityData | null>
  error: Ref<"load-failed" | "not-found" | null>
  load: () => Promise<void>
} {
  const data = ref<EntityData | null>(null)
  const error = ref<"load-failed" | "not-found" | null>(null)

  async function load(): Promise<void> {
    const { tsian } = useTsian()
    const path = refToEntityPath(entityRef)
    try {
      const file = await tsian.workspace.read(path, "save-runtime")
      if (file === null) {
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
      error.value = null
      data.value = parseEntity(parsed)
    } catch {
      // read 抛错（桥/平台异常）→ load-failed，不向上抛（D7）
      error.value = "load-failed"
      data.value = null
    }
  }

  return { data, error, load }
}
