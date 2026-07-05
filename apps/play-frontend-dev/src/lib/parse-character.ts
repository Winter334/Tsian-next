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
  CharacterGauge,
  CharacterGoals,
  CharacterIdentity,
  CharacterStatus,
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

/** 归一六维 attributes（逐键校验 number；非 number 丢弃）。 */
function parseAttributes(raw: unknown): CharacterAttributes | undefined {
  if (!isRecord(raw)) return undefined
  const out: CharacterAttributes = {}
  const KEYS: Array<keyof CharacterAttributes> = ["体魄", "悟性", "气运", "根骨", "法力", "魅力"]
  for (const k of KEYS) {
    const v = raw[k]
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v
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
    const entry: { ref: string; count?: number } = { ref }
    const count = asNumber(item.count)
    if (count !== undefined) entry.count = count
    out.push(entry)
  }
  return out.length > 0 ? out : undefined
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

  const appearance = asString(raw.appearance)
  if (appearance) entity.appearance = appearance

  const attributes = parseAttributes(raw.attributes)
  if (attributes) entity.attributes = attributes

  const gauges = parseGauges(raw.gauges)
  if (gauges) entity.gauges = gauges

  const status = parseStatus(raw.status)
  if (status) entity.status = status

  const goals = parseGoals(raw.goals)
  if (goals) entity.goals = goals

  const background = asString(raw.background)
  if (background) entity.background = background

  const containers = parseContainers(raw.containers)
  if (containers) entity.containers = containers

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
