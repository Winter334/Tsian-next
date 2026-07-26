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

import { parseEntityRef, validManagedName } from "./entity-ref"
import type {
  ContainerContent,
  ContainerEntity,
  ItemEntity,
  ItemEquipment,
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

function parseContents(raw: unknown): ContainerContent[] | null {
  if (!Array.isArray(raw)) return null
  const out: ContainerContent[] = []
  for (const item of raw) {
    if (!isRecord(item)) return null
    const keys = Object.keys(item)
    if (keys.some((key) => key !== "ref" && key !== "count")) return null
    const parsed = parseEntityRef(item.ref)
    if (!parsed || (parsed.type !== "container" && parsed.type !== "item")) return null
    if (parsed.type === "container") {
      if (item.count !== undefined && item.count !== 1) return null
    } else if (item.count !== undefined
      && (!Number.isSafeInteger(item.count) || (item.count as number) <= 0)) return null
    const entry: ContainerContent = { ref: parsed.ref }
    if (item.count !== undefined) entry.count = item.count as number
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

function isSafeIntegerMap(value: unknown): value is Record<string, number> {
  return isRecord(value)
    && Object.entries(value).every(([key, entry]) => validManagedName(key) && Number.isSafeInteger(entry))
}

/** 只接受 slotType/add/percent/effects；返回 null 表示结构损坏。 */
function parseEquipment(raw: unknown): ItemEquipment | null {
  if (!isRecord(raw)) return null
  const allowed = new Set(["slotType", "add", "percent", "effects"])
  if (Object.keys(raw).some((key) => !allowed.has(key)) || !validManagedName(raw.slotType)) return null
  const out: ItemEquipment = { slotType: raw.slotType }

  for (const key of ["add", "percent"] as const) {
    if (raw[key] === undefined) continue
    if (!isSafeIntegerMap(raw[key])) return null
    if (Object.keys(raw[key]).length > 0) out[key] = { ...raw[key] }
  }

  if (raw.effects !== undefined) {
    if (!Array.isArray(raw.effects) || raw.effects.some((effect) => typeof effect !== "string")) return null
    if (raw.effects.length > 0) out.effects = raw.effects.slice()
  }
  return out
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
  if (!id || !name || !brief || !parseEntityRef(id, "container") || raw.type !== "container") return null

  const contents = parseContents(raw.contents)
  if (contents === null) return null
  const entity: ContainerEntity = {
    id,
    name,
    brief,
    type: "container",
    contents,
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
  if (!id || !name || !brief || !parseEntityRef(id, "item")) return null
  const type = asString(raw.type)
  if (!type || !ITEM_TYPES.has(type as ItemType)) return null

  const entity: ItemEntity = {
    id,
    name,
    brief,
    type: type as ItemType,
    equipmentStatus: raw.equipment === undefined
      ? (type === "equipment" ? "schema-corrupt" : "absent")
      : "schema-corrupt",
  }

  const tags = asStringArray(raw.tags)
  if (tags) entity.tags = tags
  if (raw.equipment !== undefined) {
    const equipment = parseEquipment(raw.equipment)
    if (equipment) {
      entity.equipment = equipment
      entity.equipmentStatus = "ready"
    }
  }
  const extensions = parseExtensions(raw.extensions)
  if (extensions) entity.extensions = extensions
  const updatedAtTurn = asNumber(raw.updatedAtTurn)
  if (updatedAtTurn !== undefined) entity.updatedAtTurn = updatedAtTurn
  const updatedBy = parseUpdatedBy(raw.updatedBy)
  if (updatedBy !== undefined) entity.updatedBy = updatedBy

  return entity
}
