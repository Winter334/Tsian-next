/**
 * composables/useScene.ts — 场景按需读取薄封装（非模块级单例）。
 *
 * 设计决策 D3：与 useEntity 同构，不预加载。scene id 是 `scene:<localId>`，
 * 路径 `save/scenes/<localId>.json`。
 *
 * 读取用 tsian.workspace.read(path, "save-runtime") 显式传 scope（不省略）。
 * content 是字符串需 JSON.parse；parse 异常 → error: "load-failed"（D7，不抛错）。
 */
import { ref } from "vue"
import type { Ref } from "vue"
import type { EntityData } from "../lib/runtime-types"
import { parseScene } from "../lib/parse-entity"
import { useTsian } from "./useTsian"

/**
 * 把 scene id 转成 workspace 文件路径。
 * `scene:山门冲突` → `save/scenes/山门冲突.json`
 */
export function sceneIdToPath(id: string): string {
  const idx = id.indexOf(":")
  const localId = idx >= 0 ? id.slice(idx + 1) : id
  return `save/scenes/${localId}.json`
}

/**
 * useScene — 场景按需读取薄封装。
 *
 * @param id 场景 id，格式 `scene:<localId>`（如 `scene:山门冲突`）。
 * @returns { data, error, load } —— data 为 EntityData | null，error 为读取级错误。
 *   不自动 onMounted 加载——由 UI 子任务决定何时调 load()（展开/点击时）。
 */
export function useScene(id: string): {
  data: Ref<EntityData | null>
  error: Ref<"load-failed" | "not-found" | null>
  load: () => Promise<void>
} {
  const data = ref<EntityData | null>(null)
  const error = ref<"load-failed" | "not-found" | null>(null)

  async function load(): Promise<void> {
    const { tsian } = useTsian()
    const path = sceneIdToPath(id)
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
      data.value = parseScene(parsed)
    } catch {
      // read 抛错（桥/平台异常）→ load-failed，不向上抛（D7）
      error.value = "load-failed"
      data.value = null
    }
  }

  return { data, error, load }
}
