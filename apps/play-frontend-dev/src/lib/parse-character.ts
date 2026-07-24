/**
 * lib/parse-character.ts — character entity / relationships 分片解析纯函数。
 *
 * 对齐：
 * - design.md §3.3
 * - `lib/parse-entity.ts` 的 parseEntity 保持原状（不破坏现有调用方）。
 *
 * 本文件只做 character 固定字段的强类型归一；extensions 由 UI 调
 * `parseExtensionsOnly` 单独解析（不在本文件重复）。
 *
 * 错误策略（type-safety §"play-frontend Workspace Data Consumption"）：
 * - 必填字段缺失 → 返回 null（调用方按"档案缺失"降级）。
 * - 单字段类型不符 → 该字段静默丢弃（不整体失败）。
 * - 不抛错；纯函数。
 */
import type {
  CharacterAttributes,
  CharacterEntity,
  CharacterEquipment,
  CharacterEquipmentSlot,
  CharacterGauge,
  CharacterGoals,
  CharacterHistoryEvent,
  CharacterIdentity,
  CharacterPortraitMeta,
  CharacterStatus,
  CharacterTrait,
  GaugeTone,
  Polarity,
  RelationshipEdge,
  RelationshipFile,
} from "./character-types"

const VALID_POLARITIES: ReadonlySet<Polarity> = new Set(["positive", "negative", "neutral"])
const VALID_TONES: ReadonlySet<GaugeTone> = new Set([
  "neutral",
  "accent",
  "success",
  "warning",
  "danger",
  "muted",
])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined
}

/** 归一 identity 对象（逐键）。 */
function parseIdentity(raw: unknown): CharacterIdentity | undefined {
  if (!isRecord(raw)) return undefined
  const out: CharacterIdentity = {}
  const age = raw.age
  if (typeof age === "string" && age.length > 0) out.age = age
  else if (typeof age === "number" && Number.isFinite(age)) out.age = age
  const gender = asString(raw.gender)
  if (gender) out.gender = gender
  const role = asString(raw.role)
  if (role) out.role = role
  const affiliation = asString(raw.affiliation)
  if (affiliation) out.affiliation = affiliation
  const realm = asString(raw.realm)
  if (realm) out.realm = realm
  return Object.keys(out).length > 0 ? out : undefined
}

/** 归一 gauges 数组（逐项校验 id/name/value；缺则丢弃该项）。 */
function parseGauges(raw: unknown): CharacterGauge[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CharacterGauge[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = asString(item.id)
    const name = asString(item.name)
    const value = asNumber(item.value)
    if (!id || !name || value === undefined) continue
    const g: CharacterGauge = { id, name, value }
    const max = asNumber(item.max)
    if (max !== undefined) g.max = max
    const min = asNumber(item.min)
    if (min !== undefined) g.min = min
    const unit = asString(item.unit)
    if (unit) g.unit = unit
    const toneRaw = item.tone
    if (typeof toneRaw === "string" && VALID_TONES.has(toneRaw as GaugeTone)) {
      g.tone = toneRaw as GaugeTone
    }
    out.push(g)
  }
  return out.length > 0 ? out : undefined
}

/** 归一 attributes（固定 6 维，键名由世界架构师按世界观定义）。
 *  遍历全部键取 number 值，非 number 丢弃该键。 */
function parseAttributes(raw: unknown): CharacterAttributes | undefined {
  if (!isRecord(raw)) return undefined
  const out: CharacterAttributes = {}
  for (const [key, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) out[key] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 归一动态装备槽。单槽非法仅丢弃该槽，并按源对象遍历顺序写入结果。
 * `ref` 必须显式存在且为非空字符串或 null；`applied` 只保留有限数值。
 */
function parseEquipment(raw: unknown): CharacterEquipment | undefined {
  if (!isRecord(raw)) return undefined
  const out: CharacterEquipment = {}
  for (const [slotName, slotRaw] of Object.entries(raw)) {
    if (!isRecord(slotRaw)) continue
    const refRaw = slotRaw.ref
    if (refRaw !== null && asString(refRaw) === undefined) continue

    const slot: CharacterEquipmentSlot = {
      ref: refRaw === null ? null : (refRaw as string),
    }
    if (isRecord(slotRaw.applied)) {
      const applied: Record<string, number> = {}
      for (const [attribute, value] of Object.entries(slotRaw.applied)) {
        if (typeof value === "number" && Number.isFinite(value)) applied[attribute] = value
      }
      if (Object.keys(applied).length > 0) slot.applied = applied
    }
    out[slotName] = slot
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** 归一 status 数组（逐项校验 id；polarity 归一 union）。 */
function parseStatus(raw: unknown): CharacterStatus[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CharacterStatus[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = asString(item.id)
    if (!id) continue
    const s: CharacterStatus = { id }
    const name = asString(item.name)
    if (name) s.name = name
    const description = asString(item.description)
    if (description) s.description = description
    const p = item.polarity
    if (typeof p === "string" && VALID_POLARITIES.has(p as Polarity)) {
      s.polarity = p as Polarity
    }
    out.push(s)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 归一 traits 数组（task 07-07 design §2.4）。
 *
 * 永久性稳定特质，区别于 status[]（临时状态）。逐项校验 id 必填；
 * name/description 可选字符串，effects 可选字符串数组。缺 id 的项丢弃。
 */
function parseTraits(raw: unknown): CharacterTrait[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CharacterTrait[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const id = asString(item.id)
    if (!id) continue
    const t: CharacterTrait = { id }
    const name = asString(item.name)
    if (name) t.name = name
    const description = asString(item.description)
    if (description) t.description = description
    const effectsRaw = item.effects
    if (Array.isArray(effectsRaw)) {
      const effects: string[] = []
      for (const e of effectsRaw) {
        const s = asString(e)
        if (s) effects.push(s)
      }
      if (effects.length > 0) t.effects = effects
    }
    out.push(t)
  }
  return out.length > 0 ? out : undefined
}

/** 归一 goals 对象（逐键校验 string）。 */
function parseGoals(raw: unknown): CharacterGoals | undefined {
  if (!isRecord(raw)) return undefined
  const out: CharacterGoals = {}
  const current = asString(raw.current)
  if (current) out.current = current
  const shortTerm = asString(raw.shortTerm)
  if (shortTerm) out.shortTerm = shortTerm
  const longTerm = asString(raw.longTerm)
  if (longTerm) out.longTerm = longTerm
  return Object.keys(out).length > 0 ? out : undefined
}

function parseHistory(raw: unknown): CharacterHistoryEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CharacterHistoryEvent[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const event = asString(item.event)
    if (event) out.push({ event })
  }
  return out.length > 0 ? out : undefined
}

/** 归一 aliases（string[]）。 */
function parseAliases(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const item of raw) {
    const s = asString(item)
    if (s) out.push(s)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 归一 containers 数组（逐项校验 ref 字符串；count 可选 number）。
 * 缺 ref 的项丢弃；空数组返回 undefined（调用方按"未持有容器"降级）。
 * 对齐 task 07-04 design §4 / §5.3。
 */
function parseContainers(raw: unknown): Array<{ ref: string; count?: number }> | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Array<{ ref: string; count?: number }> = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const ref = asString(item.ref)
    if (!ref) continue
    const count = asNumber(item.count)
    if (count !== undefined && count <= 0) continue
    const entry: { ref: string; count?: number } = { ref }
    if (count !== undefined) entry.count = count
    out.push(entry)
  }
  return out.length > 0 ? out : undefined
}

/**
 * 归一 portrait 元数据（task 07-05 design D2/D3）。
 * 必检 path 非空字符串；mimeType/updatedAt/updatedBy 可选字符串。
 * 缺 path 或非对象 → undefined（UI 按"无上传头像"展示默认头像）。
 */
function parsePortrait(raw: unknown): CharacterPortraitMeta | undefined {
  if (!isRecord(raw)) return undefined
  const path = asString(raw.path)
  if (!path) return undefined
  const out: CharacterPortraitMeta = { path }
  const mimeType = asString(raw.mimeType)
  if (mimeType) out.mimeType = mimeType
  const updatedAt = asString(raw.updatedAt)
  if (updatedAt) out.updatedAt = updatedAt
  const updatedBy = asString(raw.updatedBy)
  if (updatedBy) out.updatedBy = updatedBy
  return out
}

/**
 * parseCharacter — 把 raw JSON 归一为 CharacterEntity。
 *
 * 必检 id/name/brief；缺一返回 null。其余字段逐项归一，类型不符则丢弃该字段，
 * 不影响整体解析（design §3.3）。
 *
 * @param raw character entity JSON（unknown，边界归一）
 * @returns CharacterEntity | null
 */
export function parseCharacter(raw: unknown): CharacterEntity | null {
  if (!isRecord(raw)) return null
  const id = asString(raw.id)
  const name = asString(raw.name)
  const brief = asString(raw.brief)
  if (!id || !name || !brief) return null

  const entity: CharacterEntity = { id, name, brief }

  const aliases = parseAliases(raw.aliases)
  if (aliases) entity.aliases = aliases

  const identity = parseIdentity(raw.identity)
  if (identity) entity.identity = identity

  // 顶层 gender 兼容字段（task 07-05 design D5）：仅用于默认头像 fallback。
  const gender = asString(raw.gender)
  if (gender) entity.gender = gender

  const appearance = asString(raw.appearance)
  if (appearance) entity.appearance = appearance

  const attributes = parseAttributes(raw.attributes)
  if (attributes) entity.attributes = attributes

  const equipment = parseEquipment(raw.equipment)
  if (equipment) entity.equipment = equipment

  const gauges = parseGauges(raw.gauges)
  if (gauges) entity.gauges = gauges

  const status = parseStatus(raw.status)
  if (status) entity.status = status

  const traits = parseTraits(raw.traits)
  if (traits) entity.traits = traits

  const goals = parseGoals(raw.goals)
  if (goals) entity.goals = goals

  const background = asString(raw.background)
  if (background) entity.background = background

  const history = parseHistory(raw.history)
  if (history) entity.history = history

  const containers = parseContainers(raw.containers)
  if (containers) entity.containers = containers

  // portrait UI/media 引用元数据（task 07-05 design D3）。
  const portrait = parsePortrait(raw.portrait)
  if (portrait) entity.portrait = portrait

  if (isRecord(raw.extensions)) {
    entity.extensions = raw.extensions
  }

  const updatedAtTurn = asNumber(raw.updatedAtTurn)
  if (updatedAtTurn !== undefined) entity.updatedAtTurn = updatedAtTurn

  const updatedBy = raw.updatedBy
  if (typeof updatedBy === "string") entity.updatedBy = updatedBy
  else if (updatedBy === null) entity.updatedBy = null

  return entity
}

/**
 * parseRelationships — 把 relationships 分片 raw JSON 归一为 RelationshipFile。
 *
 * 必检 subject/edges；缺一返回 null。逐 edge 校验 to/type；缺则丢弃该 edge。
 *
 * @param raw relationships 分片 JSON（unknown，边界归一）
 * @returns RelationshipFile | null
 */
export function parseRelationships(raw: unknown): RelationshipFile | null {
  if (!isRecord(raw)) return null
  const subject = asString(raw.subject)
  const edgesRaw = raw.edges
  if (!subject || !Array.isArray(edgesRaw)) return null

  const edges: RelationshipEdge[] = []
  for (const item of edgesRaw) {
    if (!isRecord(item)) continue
    const to = asString(item.to)
    const type = asString(item.type)
    if (!to || !type) continue
    const e: RelationshipEdge = { to, type }
    const since = asNumber(item.since)
    if (since !== undefined) e.since = since
    const until = asNumber(item.until)
    if (until !== undefined) e.until = until
    const note = asString(item.note)
    if (note) e.note = note
    edges.push(e)
  }

  const file: RelationshipFile = { subject, edges }

  const updatedTurn = asNumber(raw.updatedTurn)
  if (updatedTurn !== undefined) file.updatedTurn = updatedTurn

  const updatedBy = raw.updatedBy
  if (typeof updatedBy === "string") file.updatedBy = updatedBy
  else if (updatedBy === null) file.updatedBy = null

  return file
}
