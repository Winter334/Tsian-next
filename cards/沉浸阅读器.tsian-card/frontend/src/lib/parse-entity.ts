/**
 * lib/parse-entity.ts — entity/scene JSON → display items 纯函数。
 *
 * 复用 parse-runtime.ts 的 parseExtensions（R7：runtime 与 entity/scene 共享同一套
 * extensions 解析逻辑，避免 4 个 UI 子任务重复实现且降级不一致）。
 *
 * 实体的 fields/sections/status 是固定 schema，由 UI 子任务专门渲染；
 * parse 层只处理 extensions（design.md §4.3）。
 */
import type { EntityData, DisplayItems, DisplayItemError } from "./runtime-types"
import { emptyDisplayItems } from "./runtime-types"
import { parseExtensions } from "./parse-runtime"

/**
 * 解析实体/场景 JSON，提取 extensions 的 display items。
 *
 * 固定字段（id/name/brief/gender/tags/status/fields/sections/contents 等）
 * 原样保留在 `entity`，由 UI 子任务按专门 UI 消费，parse 层不转 display item。
 *
 * @param raw 实体/场景 JSON（unknown，边界归一）
 * @returns EntityData：原始 entity + displayItems + itemErrors
 */
export function parseEntity(raw: unknown): EntityData {
  if (typeof raw !== "object" || raw === null) {
    return {
      entity: {},
      displayItems: emptyDisplayItems(),
      itemErrors: [],
    }
  }
  const entity = raw as Record<string, unknown>
  const { displayItems, itemErrors } = parseExtensions(entity.extensions)
  return { entity, displayItems, itemErrors }
}

/**
 * 解析场景 JSON。场景与实体同构（都有 extensions），复用 parseEntity。
 * scene 的固定字段（location/present/status 等）原样保留在 entity 供 UI 消费。
 */
export function parseScene(raw: unknown): EntityData {
  return parseEntity(raw)
}

/** 仅取分桶结果的便捷导出（供不需要原始 entity 的调用方使用）。 */
export function parseExtensionsOnly(
  raw: unknown,
): { displayItems: DisplayItems; itemErrors: DisplayItemError[] } {
  if (typeof raw !== "object" || raw === null) {
    return { displayItems: emptyDisplayItems(), itemErrors: [] }
  }
  return parseExtensions((raw as Record<string, unknown>).extensions)
}
