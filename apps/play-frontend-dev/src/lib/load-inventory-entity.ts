/** Runtime workspace 中容器/物品实体的按 ref 读取边界。 */
import type { InventoryEntity } from "./item-types"
import { parseContainer, parseItem } from "./parse-item"
import { refToEntityPath } from "../composables/useEntity"
import { getTsianClient } from "../composables/useTsian"

export type InventoryEntityLoadStatus = "ready" | "missing"

export interface InventoryEntityLoadResult {
  entity: InventoryEntity | null
  status: InventoryEntityLoadStatus
}

/** 读取并容错解析一个容器或物品；读取、JSON、实体错误统一降级为 missing。 */
export async function loadInventoryEntity(entityRef: string): Promise<InventoryEntityLoadResult> {
  try {
    const file = await getTsianClient().workspace.read(
      refToEntityPath(entityRef),
      "save-runtime",
    )
    if (file === null) return { entity: null, status: "missing" }

    let raw: unknown
    try {
      raw = JSON.parse(file.content)
    } catch {
      return { entity: null, status: "missing" }
    }

    const container = parseContainer(raw)
    if (container) return { entity: container, status: "ready" }
    const item = parseItem(raw)
    if (item) return { entity: item, status: "ready" }
    return { entity: null, status: "missing" }
  } catch {
    return { entity: null, status: "missing" }
  }
}
