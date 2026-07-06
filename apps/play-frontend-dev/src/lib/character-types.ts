/**
 * lib/character-types.ts — character entity 强类型契约 + relationships 分片类型。
 *
 * 对齐：
 * - design.md §3.1 + §3.2
 * - `apps/platform-web/src/storage/workspace-templates.ts` 中 character 推荐字段
 *   （identity: age/gender/role/affiliation/realm；gauges 自由命名数组；
 *    appearance 单段字符串；goals: current/shortTerm/longTerm；background 单段字符串）
 *
 * 本文件只出 character 视图用到的强类型；通用 entity 解析仍走
 * `parse-entity.ts` 的 EntityData（含 displayItems）。CharacterEntity 是
 * character entity 的"固定字段视图"，由 parse-character.ts 从 raw 归一得到。
 */
import type { DisplayItems, DisplayItemError } from "./runtime-types"

/** 状态倾向语义提示，决定 UI 颜色 tone（design D5）。 */
export type Polarity = "positive" | "negative" | "neutral"

/**
 * 角色立绘（玩家上传头像）UI/media 引用元数据。
 *
 * task 07-05 design D3：`portrait` 只作为 UI/media 引用，不内嵌 base64 或
 * object URL，也不默认进入 AIRP runtime / character injection。`path` 指向
 * save-runtime workspace 中的 media asset（如
 * `save/assets/portraits/characters/萧玄.webp`）。
 */
export interface CharacterPortraitMeta {
  /** save-runtime workspace media asset 路径，非空字符串。 */
  path: string
  /** MIME 类型，当前上传流程写入 `image/webp`。 */
  mimeType?: string
  /** 最近一次更新 ISO timestamp。 */
  updatedAt?: string
  /** 最近一次更新来源（当前上传流程写 `player`）。 */
  updatedBy?: string
}

/** character entity 的稳定身份锚点（design §2.1）。所有键可选。 */
export interface CharacterIdentity {
  /** 年龄；允许 string（如"十七"）或 number。 */
  age?: string | number
  /** 性别。 */
  gender?: string
  /** 身份/职责（如"外门弟子"）。 */
  role?: string
  /** 所属组织（如"青玄门"）。 */
  affiliation?: string
  /** 境界/世界观阶位（如"炼气后期"，非修仙世界观可缺省）。 */
  realm?: string
}

/** 量表 tone（与 DisplayItem.tone 一致）。 */
export type GaugeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted"

/** 自由命名量表项（design §2.2）。id/name/value 必填，其余可选。 */
export interface CharacterGauge {
  id: string
  name: string
  value: number
  max?: number
  min?: number
  unit?: string
  tone?: GaugeTone
}

/** 状态项（design D5）。id 必填；name 主展示；description 走 title/tooltip。 */
export interface CharacterStatus {
  id: string
  name?: string
  description?: string
  polarity?: Polarity
}

/** 意图与目标（design §2.4）。所有键可选；缺省项 UI 不展示该行。 */
export interface CharacterGoals {
  current?: string
  shortTerm?: string
  longTerm?: string
}

/** 六维基础维度（design D7）。键名固定中文；值为正整数，基线 5（不在 UI 解释）。 */
export interface CharacterAttributes {
  体魄?: number
  悟性?: number
  气运?: number
  根骨?: number
  法力?: number
  魅力?: number
}

/**
 * character entity 强类型视图（design §3.1）。
 * id/name/brief 必填；其余字段可选。extensions 由 parseCharacter 透传 raw，
 * 由 UI 调 parseExtensionsOnly/displayItems 单独解析（不在本类型展开）。
 */
export interface CharacterEntity {
  id: string
  name: string
  brief: string
  aliases?: string[]
  identity?: CharacterIdentity
  /**
   * 顶层 gender 兼容字段。默认头像选择优先 `identity.gender`，缺失时回退此字段
   * （task 07-05 design D5 / R5）。仅用于 UI 默认头像 fallback，不替代 identity。
   */
  gender?: string
  appearance?: string
  attributes?: CharacterAttributes
  gauges?: CharacterGauge[]
  status?: CharacterStatus[]
  goals?: CharacterGoals
  background?: string
  /**
   * 玩家上传头像的 UI/media 引用元数据（task 07-05 design D2/D3）。
   * 缺省表示该角色无上传头像，UI 展示内置默认头像。
   */
  portrait?: CharacterPortraitMeta
  /**
   * 当前持有的容器指针数组，每项 `{ ref, count? }`；ref 指向 container entity。
   * 缺省或空数组表示角色未持有容器。物品数量落在 container.contents[*].count。
   * design §4 / task 07-04 D2。
   */
  containers?: Array<{ ref: string; count?: number }>
  /** 原始 extensions JSON，由 UI 自行调 parseExtensionsOnly 解析。 */
  extensions?: Record<string, unknown>
  updatedAtTurn?: number
  updatedBy?: string | null
}

/** relationships 分片单条边（design §3.2 / §2.6）。 */
export interface RelationshipEdge {
  /** 目标实体 ref，如 `character:玄衣少女`。 */
  to: string
  /** 关系类型，如"相识"/"师徒"/"敌对"。 */
  type: string
  since?: number
  until?: number
  note?: string
}

/** relationships 分片文件（`save/relationships/character-<localId>.json`）。 */
export interface RelationshipFile {
  /** 主体 ref，如 `character:萧玄`。 */
  subject: string
  edges: RelationshipEdge[]
  updatedTurn?: number
  updatedBy?: string | null
}

/** 概况页 extensions 解析结果（与 EntityData 同构子集）。 */
export interface CharacterDisplayItems {
  displayItems: DisplayItems
  itemErrors: DisplayItemError[]
}
