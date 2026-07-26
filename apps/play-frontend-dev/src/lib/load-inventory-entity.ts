/** Runtime workspace 中容器/物品实体的按 ref 读取边界。 */
import type { TsianApi } from "@tsian/play-bridge"
import type { InventoryEntity, InventoryEntityLoadStatus } from "./item-types"
import { parseContainer, parseItem } from "./parse-item"
import { parseEntityRef } from "./entity-ref"
import { getTsianClient } from "../composables/useTsian"

export interface InventoryEntityLoadResult {
  entity: InventoryEntity | null
  status: InventoryEntityLoadStatus
  path: string | null
}

export type InventoryRead = TsianApi["workspace"]["read"]

export async function loadInventoryEntityWith(
  read: InventoryRead,
  entityRef: string,
): Promise<InventoryEntityLoadResult> {
  const parsedRef = parseEntityRef(entityRef)
  if (!parsedRef || (parsedRef.type !== "container" && parsedRef.type !== "item")) {
    return { entity: null, status: "wrong-entity-type", path: null }
  }

  let file
  try {
    file = await read(parsedRef.path, "save-runtime")
  } catch {
    return { entity: null, status: "read-failed", path: parsedRef.path }
  }
  if (file === null) return { entity: null, status: "missing", path: parsedRef.path }

  let raw: unknown
  try {
    raw = JSON.parse(file.content)
  } catch {
    return { entity: null, status: "invalid-json", path: parsedRef.path }
  }

  const record = raw as Record<string, unknown>
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)
    || record.id !== entityRef
    || (parsedRef.type === "container" && record.type !== "container")
    || (parsedRef.type === "item" && record.type === "container")) {
    return { entity: null, status: "wrong-entity-type", path: parsedRef.path }
  }

  const entity = parsedRef.type === "container" ? parseContainer(raw) : parseItem(raw)
  if (!entity) return { entity: null, status: "schema-corrupt", path: parsedRef.path }
  if (entity.type !== "container" && entity.equipmentStatus === "schema-corrupt") {
    return { entity, status: "schema-corrupt", path: parsedRef.path }
  }
  return { entity, status: "ready", path: parsedRef.path }
}

export function loadInventoryEntity(entityRef: string): Promise<InventoryEntityLoadResult> {
  return loadInventoryEntityWith(getTsianClient().workspace.read, entityRef)
}
