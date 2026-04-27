import type {
  ArchiveKind,
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

const ALLOWED_BASE_KINDS = new Set([
  "character",
  "location",
  "item",
  "organization",
  "other",
])

const ALLOWED_PRESENCE: ArchivePresence[] = [
  "foreground",
  "background",
  "retired",
]

const BASE_ARCHIVE_FIELDS = new Set([
  "kind",
  "name",
  "aliases",
  "background",
  "situation",
  "focus",
  "linkedNames",
  "presence",
])

function buildMaintenancePrompt(input: {
  currentTime: string
  globals: RuntimeGlobalsMap
  messages: ConversationMessageRecord[]
  activeEvent: EventRecord | null
  archives: ArchiveRecord[]
}): string {
  return [
    "You maintain only narrative memory data.",
    "Return JSON only. No markdown. No explanation.",
    "If no maintenance change is needed, return {}.",
    'If maintenance is needed, return a JSON object that may contain "currentTime", "globals", "events" and "archives".',
    "For currentTime: only output it when the narrative time should move forward or be corrected.",
    'For globals: output {"set":{...}} with only non-entity state fields that should be replaced this turn.',
    "Global values may be strings, numbers, booleans, null, arrays, or plain JSON objects.",
    "",
    "For events: at most 1 item. Only allowed target is \"active\".",
    'Event format: {"target":"active","set":{"status":"ongoing|done","time":"...","entityTags":["..."],"content":"..."}}.',
    "Event entityTags must only use archive entity names that already exist or are also created/updated in this same response.",
    "Event content should stay natural language and include enough time,人物,地点 information when the conversation supports it.",
    'Do not write meta phrases like "the event is ongoing" or "the event is finished" inside event content.',
    "",
    "For archives: only keep important entities that are worth recurring in memory.",
    "The provided archives are only the entities touched by the current scene, not the whole archive pool.",
    "Archive update format: {\"target\":\"existing id\",\"set\":{...fields}}.",
    "Archive create format: {\"create\":{...fields}}. Do not provide id when creating.",
    "Allowed archive base kind values before ':' are: character, location, item, organization, other.",
    "Allowed archive presence values: foreground, background, retired.",
    "Allowed archive base fields are: kind, name, aliases, background, situation, focus, linkedNames, presence.",
    "linkedNames should only contain stable strong-related existing entity names.",
    "If you update a touched archive and its current strong relations are clear, rewrite linkedNames as the current full list for that archive.",
    "Do not keep one-off historical co-occurrences in linkedNames after they are no longer strongly relevant.",
    "Archive extension fields are allowed only when they are useful current state fields for that entity kind.",
    "Use natural language short paragraphs for archive text fields.",
    "Do not create archives for every passing mention.",
    "",
    "Missing fields mean no replacement for that field.",
    "Do not invent unsupported facts.",
    "",
    `Current narrative time: ${input.currentTime}`,
    `Current globals: ${JSON.stringify(input.globals)}`,
    `Current active event: ${JSON.stringify(input.activeEvent)}`,
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

function isArchiveKind(value: unknown): value is ArchiveKind {
  if (typeof value !== "string" || !value.trim()) {
    return false
  }

  const baseKind = value.split(":")[0]?.trim()
  return !!baseKind && ALLOWED_BASE_KINDS.has(baseKind)
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

function normalizeEventPatches(raw: unknown): EventPatchItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return []
  }

  const first = raw[0]
  if (typeof first !== "object" || first === null) {
    return []
  }

  const item = first as Record<string, unknown>
  if (item.target !== "active" || typeof item.set !== "object" || item.set === null) {
    return []
  }

  const rawSet = item.set as Record<string, unknown>
  const set: NonNullable<EventPatchItem["set"]> = {}

  if (rawSet.status === "ongoing" || rawSet.status === "done") {
    set.status = rawSet.status
  }
  if (typeof rawSet.time === "string" && rawSet.time.trim()) {
    set.time = rawSet.time.trim()
  }

  const entityTags = normalizeStringArray(rawSet.entityTags)
  if (entityTags) {
    set.entityTags = entityTags
  }

  if (typeof rawSet.content === "string" && rawSet.content.trim()) {
    set.content = rawSet.content.trim()
  }

  return Object.keys(set).length > 0 ? [{ target: "active", set }] : []
}

function normalizeArchiveSet(raw: Record<string, unknown>): Partial<Omit<ArchiveRecord, "id">> {
  const set: Partial<Omit<ArchiveRecord, "id">> = {}

  if (isArchiveKind(raw.kind)) {
    set.kind = raw.kind
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
      if (create.kind && create.name) {
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
  globals: RuntimeGlobalsMap
  messages: ConversationMessageRecord[]
  activeEvent: EventRecord | null
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
      content: buildMaintenancePrompt(input),
    },
  ], {
    debugLabel: "maintenance",
  })

  return normalizeMaintenancePatchDocument(JSON.parse(extractJsonObject(content)))
}
