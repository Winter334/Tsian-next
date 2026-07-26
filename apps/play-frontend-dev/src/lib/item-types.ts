/**
 * lib/item-types.ts — container/item entity 强类型契约。
 *
 * 对齐：
 * - task 07-04 design.md §5.1
 * - platform-web workspace-templates schema（container.type="container"；
 *   item.type ∈ equipment/material/consumable/special/other）
 *
 * 与 character-types 平级：本文件只出 container/item 视图用到的强类型；
 * 通用 entity 解析仍走 parse-entity.ts 的 EntityData（含 displayItems）。
 * ContainerEntity/ItemEntity 是"固定字段视图"，由 parse-item.ts 从 raw 归一得到。
 */

/** item type 5 类固定值集（design §3）。 */
export type ItemType = "equipment" | "material" | "consumable" | "special" | "other"

/** container type 固定字符串。 */
export type ContainerType = "container"

/** container.contents / character.containers 的指针形态。 */
export interface ContainerContent {
  ref: string
  count?: number
}

/** 装备物品的确定性规则；前端只展示，不执行贡献公式。 */
export interface ItemEquipment {
  slotType: string
  add?: Record<string, number>
  percent?: Record<string, number>
  effects?: string[]
}

export type InventoryEntityLoadStatus =
  | "ready"
  | "missing"
  | "read-failed"
  | "invalid-json"
  | "wrong-entity-type"
  | "schema-corrupt"

/**
 * container entity 强类型视图。id/name/brief 必填；type 必须为 "container"；
 * contents 至少存在（可为空数组）。design §2 / §5.1。
 */
export interface ContainerEntity {
  id: string
  name: string
  brief: string
  type: "container"
  contents: ContainerContent[]
  status?: Array<{
    id: string
    name?: string
    description?: string
    polarity?: "positive" | "negative" | "neutral"
  }>
  extensions?: Record<string, unknown>
  updatedAtTurn?: number
  updatedBy?: string | null
}

/**
 * item entity 强类型视图。id/name/brief 必填；type ∈ 5 类之一。
 * 无 status（损坏改 name/brief）；无 quantity（数量落在 container.contents[*].count）。
 * design §3 / §5.1。
 */
export interface ItemEntity {
  id: string
  name: string
  brief: string
  type: ItemType
  tags?: string[]
  equipment?: ItemEquipment
  /** 装备规则字段缺省、有效或结构损坏。 */
  equipmentStatus: "ready" | "absent" | "schema-corrupt"
  extensions?: Record<string, unknown>
  updatedAtTurn?: number
  updatedBy?: string | null
}

/** 容器或物品的联合类型，用于 InventoryPane / ItemDetailModal 的 entity props。 */
export type InventoryEntity = ContainerEntity | ItemEntity

/** 类型守卫：是否为容器实体（design §5.1）。 */
export function isContainerEntity(e: InventoryEntity): e is ContainerEntity {
  return e.type === "container"
}
