/**
 * lib/parse-item.ts — container/item entity 归一解析。
 *
 * 契约（task 07-04 design §5.2）：
 * - 纯函数，永不抛错；缺失必填 → 返回 null。
 * - id/name/brief 必填。
 * - container.type 必须为 "container"；item.type ∈ 5 类固定值集。
 * - contents 数组逐项校验 `{ ref: string, count?: number }`；status 数组逐项校验 `id`。
 * - tags 校验 string[]。
 * - extensions 原样透传（Record<string, unknown>）。
 *
 * 复用 parse-character 的 isRecord/asString/asNumber 风格；不引入外部依赖。
 */

import type {
  ContainerContent,
  ContainerEntity,
  ItemEntity,
  ItemType,
} from "./item-types"

const ITEM_TYPES: ReadonlySet<ItemType> = new Set([
  "equipment",
  "material",
  "consumable",
  "special",
  "other",
])

const POLARITY_SET: ReadonlySet<"positive" | "negative" | "neutral"> = new Set([
  "positive",
  "negative",
  "neutral",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    if (typeof item === "string" && item.length > 0) out.push(item)
  }
  return out.length > 0 ? out : undefined
}

function parseContents(raw: unknown): ContainerContent[] {
  if (!Array.isArray(raw)) return []
  const out: ContainerContent[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const ref = asString(item.ref)
    if (!ref) continue
    const entry: ContainerContent = { ref }
    const count = asNumber(item.count)
    if (count !== undefined) entry.count = count
    out.push(entry)
  }
  return out
}

function parseStatus(
  raw: unknown,
): ContainerEntity["status"] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<ContainerEntity["status"]> = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = asString(item.id)
    if (!id) continue
    const entry: NonNullable<ContainerEntity["status"]>[number] = { id }
    const name = asString(item.name)
    if (name) entry.name = name
    const description = asString(item.description)
    if (description) entry.description = description
    const polarity = asString(item.polarity)
    if (
      polarity !== undefined &&
      POLARITY_SET.has(polarity as "positive" | "negative" | "neutral")
    ) {
      entry.polarity = polarity as "positive" | "negative" | "neutral"
    }
    out.push(entry)
  }
  return out.length > 0 ? out : undefined
}

function parseExtensions(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined
  return raw
}

function parseUpdatedBy(raw: unknown): string | null | undefined {
  if (raw === null) return null
  if (typeof raw === "string") return raw
  return undefined
}

/**
 * 解析容器实体。id/name/brief 必填；type 必须为 "container"；contents 校验为数组。
 * 缺失关键字段返回 null。design §5.2 / task 07-04 D3。
 */
export function parseContainer(raw: unknown): ContainerEntity | null {
  if (!isRecord(raw)) return null
  const id = asString(raw.id)
  const name = asString(raw.name)
  const brief = asString(raw.brief)
  if (!id || !name || !brief) return null
  if (raw.type !== "container") return null

  const entity: ContainerEntity = {
    id,
    name,
    brief,
    type: "container",
    contents: parseContents(raw.contents),
  }

  const status = parseStatus(raw.status)
  if (status) entity.status = status
  const extensions = parseExtensions(raw.extensions)
  if (extensions) entity.extensions = extensions
  const updatedAtTurn = asNumber(raw.updatedAtTurn)
  if (updatedAtTurn !== undefined) entity.updatedAtTurn = updatedAtTurn
  const updatedBy = parseUpdatedBy(raw.updatedBy)
  if (updatedBy !== undefined) entity.updatedBy = updatedBy

  return entity
}

/**
 * 解析物品实体。id/name/brief 必填；type ∈ 5 类固定值集。
 * 缺失关键字段或 type 未识别返回 null。design §5.2 / task 07-04 D3。
 */
export function parseItem(raw: unknown): ItemEntity | null {
  if (!isRecord(raw)) return null
  const id = asString(raw.id)
  const name = asString(raw.name)
  const brief = asString(raw.brief)
  if (!id || !name || !brief) return null
  const type = asString(raw.type)
  if (!type || !ITEM_TYPES.has(type as ItemType)) return null

  const entity: ItemEntity = {
    id,
    name,
    brief,
    type: type as ItemType,
  }

  const tags = asStringArray(raw.tags)
  if (tags) entity.tags = tags
  const extensions = parseExtensions(raw.extensions)
  if (extensions) entity.extensions = extensions
  const updatedAtTurn = asNumber(raw.updatedAtTurn)
  if (updatedAtTurn !== undefined) entity.updatedAtTurn = updatedAtTurn
  const updatedBy = parseUpdatedBy(raw.updatedBy)
  if (updatedBy !== undefined) entity.updatedBy = updatedBy

  return entity
}
