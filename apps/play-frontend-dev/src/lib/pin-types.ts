/**
 * lib/pin-types.ts — 左侧状态栏"钉选"字段类型 + `readPinValue` 纯函数。
 *
 * 对齐：
 * - design.md §5（PinPathKind / PinTarget / PinnedStore）
 * - design.md §6（PinValue + `readPinValue` 纯函数）
 *
 * 语义：
 * - PinTarget 只存字段引用（entityRef + kind + key），不保存值快照；
 *   渲染时通过 `readPinValue(entity, target)` 现读现算，字段缺失走 missing 分支。
 * - 首版覆盖 6 类字段：status / attribute / gauge / identity / appearance / goals。
 *
 * 错误策略（type-safety §"Runtime Boundaries"）：
 * - entity 为 null/undefined 或字段类型不符 → 返回 `{ kind: "missing", ... }`，不抛错。
 * - 静态类型全部严格；本文件不出现 `any`。
 */
import type {
  CharacterEntity,
  CharacterGauge,
  CharacterGoals,
  CharacterIdentity,
  CharacterStatus,
  GaugeTone,
  Polarity,
} from "./character-types"

/** 钉选路径 kind（design §5）。 */
export type PinPathKind =
  | "status" // key = status.id
  | "attribute" // key = attributes 的维度键名（由世界观定，不固定）
  | "gauge" // key = gauge.id
  | "identity" // key = age|gender|role|affiliation|realm
  | "appearance" // 无 key
  | "goals" // key = current|shortTerm|longTerm

/** 钉选项（design §5）。 */
export interface PinTarget {
  /** 首版恒为主角 protagonistRef.ref（形如 `character:<localId>`）。 */
  entityRef: string
  kind: PinPathKind
  /** appearance 缺省；其余 kind 必填。 */
  key?: string
  /** UI 显示名（去实体化，便于 entity 缺失时仍可展示）。 */
  label: string
  /** 添加时间戳（Date.now()），用于稳定排序。 */
  addedAt: number
}

/** localStorage 存储结构（design §5，version=1）。 */
export interface PinnedStore {
  version: 1
  targets: PinTarget[]
}

/** 钉选项当前值的判别联合（design §6）。 */
export type PinValue =
  | { kind: "status"; name: string; polarity?: Polarity; description?: string }
  | { kind: "attribute"; label: string; value: number }
  | { kind: "gauge"; name: string; value: number; max?: number; unit?: string; tone?: GaugeTone }
  | { kind: "identity"; label: string; value: string }
  | { kind: "appearance"; text: string }
  | { kind: "goals"; label: string; value: string }
  | { kind: "missing"; target: PinTarget; label: string }

/** identity 子键白名单。 */
const IDENTITY_KEYS: ReadonlySet<keyof CharacterIdentity> = new Set<keyof CharacterIdentity>([
  "age",
  "gender",
  "role",
  "affiliation",
  "realm",
])

/** goals 子键白名单。 */
const GOALS_KEYS: ReadonlySet<keyof CharacterGoals> = new Set<keyof CharacterGoals>([
  "current",
  "shortTerm",
  "longTerm",
])

function missing(target: PinTarget): PinValue {
  return { kind: "missing", target, label: target.label }
}

/**
 * readPinValue — 现读现算 PinTarget 的当前值。
 *
 * @param entity 主角 CharacterEntity（可为 null；例如未加载/加载失败/无主角）。
 * @param target PinTarget。
 * @returns PinValue；命中时返回对应 kind 分支，否则 missing。
 *
 * 语义：
 * - status: 通过 `entity.status.find(s => s.id === target.key)` 命中；name 取 `s.name ?? target.label`。
 * - attribute: `entity.attributes?.[key]` 为 number 才成立。
 * - gauge: `entity.gauges?.find(g => g.id === key)` 命中且 value 为 number。
 * - identity: `entity.identity?.[key]`，number 值走 String() 转换。
 * - appearance: `entity.appearance` 非空字符串即成立。
 * - goals: `entity.goals?.[key]` 非空字符串。
 */
export function readPinValue(entity: CharacterEntity | null | undefined, target: PinTarget): PinValue {
  if (entity === null || entity === undefined) return missing(target)

  switch (target.kind) {
    case "status": {
      const key = target.key
      if (key === undefined) return missing(target)
      const list: CharacterStatus[] = entity.status ?? []
      const hit = list.find((s) => s.id === key)
      if (hit === undefined) return missing(target)
      const name = hit.name ?? target.label
      return {
        kind: "status",
        name,
        polarity: hit.polarity,
        description: hit.description,
      }
    }

    case "attribute": {
      const key = target.key
      if (key === undefined) return missing(target)
      const attrs = entity.attributes
      if (attrs === undefined) return missing(target)
      const v = attrs[key]
      if (typeof v !== "number" || !Number.isFinite(v)) return missing(target)
      return { kind: "attribute", label: target.label, value: v }
    }

    case "gauge": {
      const key = target.key
      if (key === undefined) return missing(target)
      const list: CharacterGauge[] = entity.gauges ?? []
      const hit = list.find((g) => g.id === key)
      if (hit === undefined) return missing(target)
      if (typeof hit.value !== "number" || !Number.isFinite(hit.value)) return missing(target)
      return {
        kind: "gauge",
        name: hit.name,
        value: hit.value,
        max: hit.max,
        unit: hit.unit,
        tone: hit.tone,
      }
    }

    case "identity": {
      const key = target.key
      if (key === undefined) return missing(target)
      if (!IDENTITY_KEYS.has(key as keyof CharacterIdentity)) return missing(target)
      const id = entity.identity
      if (id === undefined) return missing(target)
      const raw = id[key as keyof CharacterIdentity]
      if (raw === undefined || raw === null) return missing(target)
      const value = typeof raw === "number" ? String(raw) : raw
      if (typeof value !== "string" || value.length === 0) return missing(target)
      return { kind: "identity", label: target.label, value }
    }

    case "appearance": {
      const text = entity.appearance
      if (typeof text !== "string" || text.length === 0) return missing(target)
      return { kind: "appearance", text }
    }

    case "goals": {
      const key = target.key
      if (key === undefined) return missing(target)
      if (!GOALS_KEYS.has(key as keyof CharacterGoals)) return missing(target)
      const g = entity.goals
      if (g === undefined) return missing(target)
      const v = g[key as keyof CharacterGoals]
      if (typeof v !== "string" || v.length === 0) return missing(target)
      return { kind: "goals", label: target.label, value: v }
    }

    default: {
      // 穷举保证：kind 若未来扩展，此处 TypeScript 会报错。
      const _exhaustive: never = target.kind
      void _exhaustive
      return missing(target)
    }
  }
}
