import type {
  ArchivePatchItem,
  ArchivePresence,
  ArchiveRecord,
  ConversationMessageRecord,
  EventPatchItem,
  EventRecord,
  JsonValue,
  MaintenancePatchDocument,
  RuntimeGlobalsMap,
} from "@tsian/contracts"
import { generateAssistantReply } from "./ai"

const ALLOWED_PRESENCE: ArchivePresence[] = [
  "foreground",
  "background",
  "retired",
]

const BASE_ARCHIVE_FIELDS = new Set([
  "type",
  "name",
  "aliases",
  "background",
  "situation",
  "focus",
  "linkedNames",
  "linkedArchiveIds",
  "presence",
])

function formatDefaultNarrativeTime(value: string): string {
  return value.trim() || "未设置"
}

function buildMaintenancePrompt(input: {
  currentTime: string
  narrativeTimeText: string
  globals: RuntimeGlobalsMap
  messages: ConversationMessageRecord[]
  activeEvents: EventRecord[]
  archives: ArchiveRecord[]
}): string {
  return [
    "你是 AIRP 的叙事记忆维护 AI。你不写剧情，只把刚发生的剧情转成可持久化的运行时记忆 patch。",
    "只输出 JSON，不要 markdown，不要解释。",
    "你每一轮都应评估并维护 currentTime、events 与 archives；除非本轮只是系统错误或完全没有剧情正文，否则不要返回空对象 {}。",
    '输出对象可包含 "currentTime", "globals", "events", "archives"。',
    "不要输出空 set、空 globals 或没有实际字段变化的 archives 项；不改就省略该项。",
    "",
    "currentTime 规则：",
    "1. currentTime 是当前叙事时间，不是现实时间。",
    "2. currentTime 和 event.time 必须使用 YYYY-MM-DD HH:mm 格式，例如 2026-04-27 13:58；不要输出 ISO、时区或秒。",
    "3. 只要本轮剧情发生了动作、观察、交谈、移动、等待、战斗、施法、调查等推进，就应输出新的 currentTime。",
    "4. 如果正文明确给出时间，使用正文时间；否则按叙事节奏从 Current narrative time 小幅推进，通常推进 1-10 分钟。",
    "5. 剧情推进时，新的 currentTime 必须晚于 Current narrative time，不能原样复用旧时间。",
    "6. events[0].set.time 通常应与新的 currentTime 一致，除非事件正文明确在回写历史事件。",
    "7. 如果本轮只是同一瞬间的纯心理描写或系统报错，才可以不输出 currentTime。",
    "8. Current formatted narrative time 只用于事件正文、档案正文等自然语言表达。",
    "",
    'globals 规则：输出 {"set":{...}}，只放不属于单个实体、但影响当前局面的状态，例如场所、焦点、风险、天气、章节。',
    "Global values 可为 string, number, boolean, null, array 或普通 JSON object。",
    "",
    "events 规则：可以更新已有事件，也可以创建新事件。",
    '更新格式：{"target":"event id 或 active","set":{"status":"ongoing|done","time":"...","entityTags":["..."],"content":"..."}}。',
    '创建格式：{"create":{"status":"ongoing|done","time":"...","entityTags":["..."],"content":"..."}}，创建时不要提供 id。',
    "当当前进行中事件完成时，把对应事件 status 改为 done；如果没有新的进行中事件，可以暂时不 create。",
    "当剧情产生新的进行中事件时，用 create 新建 ongoing 事件；允许同时存在多个 ongoing 事件。",
    "active event 是当前进行中事件摘要。本轮剧情有任何实质推进时，应更新相关事件 content 或创建新事件。",
    "content 应用自然语言概括当前事件到最新状态，包含足以锚定的时间、地点、人物、物件或目标。",
    "更新事件时，只要 set 里包含 status、time 或 content，就必须同时输出该事件当前完整 entityTags；entityTags 不是增量字段，而是这条事件当前关联实体名称的完整列表。",
    "entityTags 只能使用已存在档案名称，或本次 archives.create / archives.set.name 同时创建或改名出的实体名称；不要输出 entityArchiveIds。",
    "不要在 content 里写“事件正在进行/事件已结束”这类元描述。",
    "",
    "archives 规则：档案就是实体当前状态的唯一真源，只维护值得复用的重要实体。",
    "输入的 Current archives 只是当前场景命中的实体，不是全量档案。",
    "更新已有档案：{\"target\":\"existing id\",\"set\":{...fields}}。新建档案：{\"create\":{...fields}}，创建时不要提供 id。",
    "type 规则：使用最终实体类型，例如 character、monster、location、equipment、consumable、material、organization、clue。",
    "允许的 presence：foreground, background, retired。",
    "基础字段：type, name, aliases, background, situation, linkedNames, presence。focus 只在该类型需要表达当前目标或诉求时使用。",
    "situation 记录实体当前处境，background 只放低频长期事实。",
    "linkedNames 只放稳定强关联实体名称；如果强关联已清楚，重写为当前完整列表，不保留一次性同场出现；不要输出 linkedArchiveIds。",
    "可以输出对当前 type 有用的扁平扩展字段，但不要输出内部继承结构或嵌套类型实例。",
    "不要为每个路人、随口提及或无持续价值的对象创建档案。",
    "",
    "缺字段表示不改；不要输出 del；不要编造正文没有支持的新事实。",
    "如果不确定某个档案是否要改，优先更新 active event 和 currentTime，而不是返回空对象。",
    "",
    `Current narrative time: ${input.currentTime}`,
    `Current formatted narrative time: ${input.narrativeTimeText}`,
    `Current globals: ${JSON.stringify(input.globals)}`,
    `Current active events: ${JSON.stringify(input.activeEvents)}`,
    `Current archives: ${JSON.stringify(input.archives)}`,
    `Conversation: ${JSON.stringify(input.messages)}`,
  ].join("\n")
}

function extractJsonObject(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return text.slice(start, end + 1)
  }

  throw new Error("Maintenance AI did not return JSON.")
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }

  if (typeof value !== "object") {
    return false
  }

  return Object.values(value).every((item) => isJsonValue(item))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isArchivePresence(value: unknown): value is ArchivePresence {
  return typeof value === "string" && ALLOWED_PRESENCE.includes(value as ArchivePresence)
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!isStringArray(value)) {
    return undefined
  }

  const items = value.map((item) => item.trim()).filter(Boolean)
  return items.length > 0 ? [...new Set(items)] : []
}

function normalizeGlobalsPatch(raw: unknown): MaintenancePatchDocument["globals"] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return undefined
  }

  const set = (raw as { set?: unknown }).set
  if (typeof set !== "object" || set === null || Array.isArray(set)) {
    return undefined
  }

  const entries = Object.entries(set).flatMap(([key, value]) => {
    const normalizedKey = key.trim()
    if (!normalizedKey || !isJsonValue(value)) {
      return []
    }

    return [[normalizedKey, value] as const]
  })

  return entries.length > 0 ? { set: Object.fromEntries(entries) } : undefined
}

function normalizeEventSet(raw: Record<string, unknown>): NonNullable<EventPatchItem["set"]> {
  const set: NonNullable<EventPatchItem["set"]> = {}

  if (raw.status === "ongoing" || raw.status === "done") {
    set.status = raw.status
  }
  if (typeof raw.time === "string" && raw.time.trim()) {
    set.time = raw.time.trim()
  }

  const entityTags = normalizeStringArray(raw.entityTags)
  if (entityTags) {
    set.entityTags = entityTags
  }

  if (typeof raw.content === "string" && raw.content.trim()) {
    set.content = raw.content.trim()
  }

  return set
}

function normalizeEventPatches(raw: unknown): EventPatchItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return []
  }

  const patches: EventPatchItem[] = []

  for (const rawItem of raw) {
    if (typeof rawItem !== "object" || rawItem === null) {
      continue
    }

    const item = rawItem as Record<string, unknown>
    if (typeof item.target === "string" && typeof item.set === "object" && item.set !== null) {
      const set = normalizeEventSet(item.set as Record<string, unknown>)
      if (Object.keys(set).length > 0) {
        patches.push({ target: item.target.trim(), set })
      }
      continue
    }

    if (typeof item.create === "object" && item.create !== null) {
      const create = normalizeEventSet(item.create as Record<string, unknown>)
      if (create.status) {
        patches.push({ create: create as NonNullable<EventPatchItem["create"]> })
      }
    }
  }

  return patches
}

function normalizeArchiveSet(raw: Record<string, unknown>): Partial<Omit<ArchiveRecord, "id">> {
  const set: Partial<Omit<ArchiveRecord, "id">> = {}

  if (typeof raw.type === "string" && raw.type.trim()) {
    set.type = raw.type.trim()
  }
  if (typeof raw.name === "string" && raw.name.trim()) {
    set.name = raw.name.trim()
  }

  const aliases = normalizeStringArray(raw.aliases)
  if (aliases) {
    set.aliases = aliases
  }

  if (typeof raw.background === "string") {
    set.background = raw.background.trim()
  }
  if (typeof raw.situation === "string") {
    set.situation = raw.situation.trim()
  }
  if (typeof raw.focus === "string") {
    set.focus = raw.focus.trim()
  }

  const linkedNames = normalizeStringArray(raw.linkedNames)
  if (linkedNames) {
    set.linkedNames = linkedNames
  }

  if (isArchivePresence(raw.presence)) {
    set.presence = raw.presence
  }

  for (const [key, value] of Object.entries(raw)) {
    if (BASE_ARCHIVE_FIELDS.has(key) || key === "id") {
      continue
    }

    if (isJsonValue(value)) {
      set[key] = value
    }
  }

  return set
}

function normalizeArchivePatches(raw: unknown): ArchivePatchItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return []
  }

  const patches: ArchivePatchItem[] = []

  for (const item of raw) {
    if (typeof item !== "object" || item === null) {
      continue
    }

    const record = item as Record<string, unknown>
    if (typeof record.target === "string" && record.target.trim() && typeof record.set === "object" && record.set !== null) {
      const set = normalizeArchiveSet(record.set as Record<string, unknown>)
      if (Object.keys(set).length > 0) {
        patches.push({ target: record.target.trim(), set })
      }
      continue
    }

    if (typeof record.create === "object" && record.create !== null) {
      const create = normalizeArchiveSet(record.create as Record<string, unknown>)
      if (create.type && create.name) {
        patches.push({ create: create as Omit<ArchiveRecord, "id"> })
      }
    }
  }

  return patches
}

function normalizeMaintenancePatchDocument(raw: unknown): MaintenancePatchDocument {
  if (typeof raw !== "object" || raw === null) {
    return {}
  }

  const doc = raw as {
    currentTime?: unknown
    globals?: unknown
    events?: unknown
    archives?: unknown
  }

  const events = normalizeEventPatches(doc.events)
  const archives = normalizeArchivePatches(doc.archives)
  const globals = normalizeGlobalsPatch(doc.globals)

  const normalized: MaintenancePatchDocument = {}
  if (typeof doc.currentTime === "string" && doc.currentTime.trim()) {
    normalized.currentTime = doc.currentTime.trim()
  }
  if (globals) {
    normalized.globals = globals
  }
  if (events.length > 0) {
    normalized.events = events
  }
  if (archives.length > 0) {
    normalized.archives = archives
  }
  return normalized
}

export async function generateMaintenancePatch(input: {
  currentTime: string
  narrativeTimeText?: string
  globals: RuntimeGlobalsMap
  messages: ConversationMessageRecord[]
  activeEvents: EventRecord[]
  archives: ArchiveRecord[]
}): Promise<MaintenancePatchDocument> {
  const content = await generateAssistantReply([
    {
      role: "system",
      content:
        "You are a deterministic narrative maintenance assistant. Output valid JSON only.",
    },
    {
      role: "user",
      content: buildMaintenancePrompt({
        ...input,
        narrativeTimeText:
          input.narrativeTimeText ?? formatDefaultNarrativeTime(input.currentTime),
      }),
    },
  ], {
    debugLabel: "maintenance",
  })

  const patch = normalizeMaintenancePatchDocument(JSON.parse(extractJsonObject(content)))

  console.debug("[Tsian maintenance] normalized patch", patch)

  return patch
}
