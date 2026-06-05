import type { WorkflowDefinition } from "@tsian/contracts"

const AIRP_RETRIEVAL_STRATEGY_SCRIPT = `
function arrayInput(name) {
  const value = inputs[name]
  return Array.isArray(value) ? value : []
}

function parseJson(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function objectData(record) {
  if (!record || typeof record !== "object") return {}
  const data = record.data
  return data && typeof data === "object" && !Array.isArray(data) ? data : record
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function textArray(value) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : []
}

function normalize(value) {
  return text(value).toLowerCase()
}

function toArchive(record) {
  const data = objectData(record)
  return {
    ...data,
    id: text(record && typeof record === "object" ? record.id : undefined) || text(data.id),
    type: text(data.type) || "other",
    name: text(data.name),
    aliases: textArray(data.aliases),
    background: text(data.background),
    situation: text(data.situation),
    focus: text(data.focus) || undefined,
    linkedNames: textArray(data.linkedNames),
    linkedArchiveIds: textArray(data.linkedArchiveIds),
    presence: text(data.presence) || "background",
  }
}

function toEvent(record) {
  const data = objectData(record)
  return {
    id: text(record && typeof record === "object" ? record.id : undefined) || text(data.id),
    time: text(data.time),
    status: text(data.status) || "done",
    entityTags: textArray(data.entityTags),
    entityArchiveIds: textArray(data.entityArchiveIds),
    content: text(data.content),
  }
}

function namesForArchive(archive) {
  return [archive.name, ...(archive.aliases || [])].map(normalize).filter(Boolean)
}

const history = parseJson(macros["history.recent.json"], [])
const userInput = text(macros["user.input"])
const queryText = normalize([
  userInput,
  ...history.map((message) => text(message && message.content)),
].join("\\n"))

const events = arrayInput("events.records").map(toEvent).filter((event) => event.id && event.content)
const archives = arrayInput("archives.records").map(toArchive).filter((archive) => archive.id && archive.name)
const ongoingEvents = arrayInput("ongoingEvents").map(toEvent).filter((event) => event.id)
const foregroundArchives = arrayInput("foregroundArchives").map(toArchive).filter((archive) => archive.id && archive.name)

const directArchives = archives.filter((archive) => {
  return namesForArchive(archive).some((name) => name.length > 1 && queryText.includes(name))
}).slice(0, 8)

const directArchiveIds = new Set(directArchives.map((archive) => archive.id))
const foregroundArchiveIds = new Set(foregroundArchives.map((archive) => archive.id))
const directNames = new Set(directArchives.map((archive) => archive.name))
const foregroundNames = new Set(foregroundArchives.map((archive) => archive.name))

function eventScore(event, index) {
  let score = 0
  if (event.status === "ongoing") score += 30
  for (const tag of event.entityTags || []) {
    const normalized = normalize(tag)
    if (normalized && queryText.includes(normalized)) score += 20
    if (directNames.has(tag) || foregroundNames.has(tag)) score += 10
  }
  for (const archiveId of event.entityArchiveIds || []) {
    if (directArchiveIds.has(archiveId) || foregroundArchiveIds.has(archiveId)) score += 16
  }
  if (queryText && normalize(event.content).includes(queryText)) score += 12
  score += Math.max(0, 8 - index)
  return score
}

const selectedEvents = events
  .map((event, index) => ({ event, score: eventScore(event, index) }))
  .filter((item) => item.score > 8 || item.event.status === "ongoing")
  .sort((left, right) => right.score - left.score)
  .slice(0, 8)
  .map((item) => item.event)

const relatedNames = new Set()
for (const event of [...selectedEvents, ...ongoingEvents]) {
  for (const tag of event.entityTags || []) relatedNames.add(tag)
}
for (const archive of [...directArchives, ...foregroundArchives]) {
  for (const name of archive.linkedNames || []) relatedNames.add(name)
}

const relatedArchives = archives.filter((archive) => {
  if (directArchiveIds.has(archive.id) || foregroundArchiveIds.has(archive.id)) return false
  if (relatedNames.has(archive.name)) return true
  return (archive.aliases || []).some((alias) => relatedNames.has(alias))
}).slice(0, 8)

const candidateDebug = events.map((event, index) => {
  const score = eventScore(event, index)
  return {
    id: event.id,
    time: event.time,
    status: event.status,
    tags: event.entityTags || [],
    keywordScore: score,
    semanticScore: null,
    finalScore: score,
    selected: selectedEvents.some((item) => item.id === event.id),
    content: event.content,
  }
})

return {
  directArchives,
  foregroundArchives,
  relatedArchives,
  selectedEvents,
  directEntities: directArchives.map((archive) => archive.name),
  debug: {
    directArchiveIds: [...directArchiveIds],
    foregroundArchiveIds: [...foregroundArchiveIds],
    relatedArchiveIds: relatedArchives.map((archive) => archive.id),
    presentEntities: foregroundArchives.map((archive) => archive.name),
    linkedEntities: relatedArchives.map((archive) => archive.name),
    candidates: candidateDebug,
  },
}
`

const AIRP_RETRIEVAL_ASSEMBLY_SCRIPT = `
function arrayInput(name) {
  const value = inputs[name]
  return Array.isArray(value) ? value : []
}

function text(value) {
  return typeof value === "string" ? value.trim() : ""
}

function objectData(record) {
  if (!record || typeof record !== "object") return {}
  const data = record.data
  return data && typeof data === "object" && !Array.isArray(data) ? data : record
}

function toGlobalMap(records) {
  const globals = {}
  for (const record of records) {
    const data = objectData(record)
    const key = text(data.key || (record && record.id))
    if (!key) continue
    globals[key] = data.value
  }
  return globals
}

const archives = arrayInput("archives")
const directEntities = arrayInput("directEntities").filter((item) => typeof item === "string")
const strategyDebug = inputs.strategyDebug && typeof inputs.strategyDebug === "object"
  ? inputs.strategyDebug
  : {}
const globals = toGlobalMap(arrayInput("globals.records"))
const currentTime = text(globals.currentTime) || text(macros["narrative.currentTime"])
const formattedTime = text(macros["narrative.formattedTime"]) || currentTime
const eventText = text(inputs.eventsText)
const archiveText = text(inputs.archivesText)

const globalLines = Object.entries(globals)
  .filter(([key]) => key !== "currentTime")
  .map(([key, value]) => "- " + key + ": " + (typeof value === "string" ? value : JSON.stringify(value)))

const sections = []
if (formattedTime) sections.push("【当前时间】\\n" + formattedTime)
if (globalLines.length > 0) sections.push("【全局状态】\\n" + globalLines.join("\\n"))
if (eventText) sections.push("【相关事件】\\n" + eventText)
if (archiveText) sections.push("【相关档案】\\n" + archiveText)

const archiveDebug = archives.map((archive) => {
  const source = (strategyDebug.directArchiveIds || []).includes(archive.id)
    ? "direct"
    : (strategyDebug.foregroundArchiveIds || []).includes(archive.id)
      ? "present"
      : "event"
  const score = source === "direct" ? 100 : source === "present" ? 90 : 70
  return {
    id: archive.id,
    name: archive.name,
    presence: archive.presence || "background",
    score,
    source,
  }
})

return {
  prompt: sections.join("\\n\\n"),
  directEntities,
  archives,
  debug: {
    input: text(macros["user.input"]),
    settings: { mode: "mixed-airp-workflow", semanticDeferred: true },
    semantic: { enabled: false, keywords: [], eventIds: [], archiveIds: [] },
    directEntities,
    presentEntities: strategyDebug.presentEntities || [],
    linkedEntities: strategyDebug.linkedEntities || [],
    groups: [],
    candidates: strategyDebug.candidates || [],
    archives: archiveDebug,
    catalogEvents: [],
    hintEntities: [],
  },
}
`

export function createDefaultAirpWorkflow(): WorkflowDefinition {
  return {
    nodes: [
      {
        id: "airpEvents",
        type: "memory-query",
        config: {
          source: "collection",
          namespace: "airp",
          collection: "events",
          query: "",
          limit: 80,
        },
      },
      {
        id: "airpArchives",
        type: "memory-query",
        config: {
          source: "collection",
          namespace: "airp",
          collection: "archives",
          query: "",
          limit: 120,
        },
      },
      {
        id: "airpGlobals",
        type: "memory-query",
        config: {
          source: "collection",
          namespace: "airp",
          collection: "globals",
          query: "",
          limit: 20,
        },
      },
      {
        id: "ongoingEvents",
        type: "record-filter",
        config: {
          inputVarName: "records",
          outputName: "records",
          predicates: [{ path: "data.status", op: "equals", value: "ongoing" }],
        },
      },
      {
        id: "foregroundArchives",
        type: "record-filter",
        config: {
          inputVarName: "records",
          outputName: "records",
          predicates: [{ path: "data.presence", op: "equals", value: "foreground" }],
        },
      },
      {
        id: "retrievalStrategy",
        type: "compute",
        config: {
          script: AIRP_RETRIEVAL_STRATEGY_SCRIPT,
          timeout: 5000,
        },
        inputs: [
          { name: "events.records", valueType: "array", semanticSlot: "memory.events", required: true },
          { name: "archives.records", valueType: "array", semanticSlot: "memory.archives", required: true },
          { name: "globals.records", valueType: "array", semanticSlot: "memory.globals", required: false },
          { name: "ongoingEvents", valueType: "array", semanticSlot: "memory.events.ongoing", required: false },
          { name: "foregroundArchives", valueType: "array", semanticSlot: "memory.archives.foreground", required: false },
        ],
        outputs: [
          { name: "directArchives", extract: { type: "raw" }, valueType: "array" },
          { name: "foregroundArchives", extract: { type: "raw" }, valueType: "array" },
          { name: "relatedArchives", extract: { type: "raw" }, valueType: "array" },
          { name: "selectedEvents", extract: { type: "raw" }, valueType: "array" },
          { name: "directEntities", extract: { type: "raw" }, valueType: "array" },
          { name: "debug", extract: { type: "raw" }, valueType: "object" },
        ],
      },
      {
        id: "selectedArchiveMerge",
        type: "record-merge",
        config: {
          inputVarNames: ["directArchives", "foregroundArchives", "relatedArchives"],
          keyPath: "id",
          outputName: "records",
          limit: 12,
        },
      },
      {
        id: "selectedEventsText",
        type: "record-format",
        config: {
          inputVarName: "records",
          outputName: "text",
          itemTemplate: "- {{item.time}} [{{item.status}}] {{item.content}}",
          separator: "\n",
          emptyText: "",
        },
      },
      {
        id: "selectedArchivesText",
        type: "record-format",
        config: {
          inputVarName: "records",
          outputName: "text",
          itemTemplate:
            "- {{item.name}} ({{item.type}} / {{item.presence}})\n  background: {{item.background}}\n  situation: {{item.situation}}\n  focus: {{item.focus}}",
          separator: "\n",
          emptyText: "",
        },
      },
      {
        id: "retrieval",
        type: "compute",
        config: {
          script: AIRP_RETRIEVAL_ASSEMBLY_SCRIPT,
          timeout: 5000,
          recordRetrievalDebugOutputName: "debug",
        },
        inputs: [
          { name: "globals.records", valueType: "array", semanticSlot: "memory.globals", required: false },
          { name: "directEntities", valueType: "array", semanticSlot: "memory.directEntities", required: false },
          { name: "strategyDebug", valueType: "object", semanticSlot: "memory.debug", required: false },
          { name: "archives", valueType: "array", semanticSlot: "memory.archives", required: false },
          { name: "eventsText", valueType: "string", semanticSlot: "memory.events.text", required: false },
          { name: "archivesText", valueType: "string", semanticSlot: "memory.archives.text", required: false },
        ],
        outputs: [
          { name: "prompt", extract: { type: "raw" }, valueType: "string" },
          { name: "directEntities", extract: { type: "raw" }, valueType: "array" },
          { name: "archives", extract: { type: "raw" }, valueType: "array" },
          { name: "debug", extract: { type: "raw" }, valueType: "object" },
        ],
      },
      {
        id: "chat",
        type: "ai-call",
        config: { presetId: "builtin.chat", appendUserInput: true },
      },
      {
        id: "reply",
        type: "result",
        config: { name: "reply" },
      },
      {
        id: "maintenance",
        type: "ai-call",
        config: { presetId: "builtin.maintenance" },
        retry: { maxRetries: 0 },
        outputs: [
          { name: "operations", extract: { type: "raw", parse: "json" } },
        ],
      },
      {
        id: "memoryWrite",
        type: "memory-write",
        config: { operationsVarName: "operations", pushCheckpointReason: "none" },
      },
    ],
    edges: [
      {
        from: { nodeId: "airpEvents", outputName: "records" },
        to: { nodeId: "ongoingEvents", varName: "records" },
      },
      {
        from: { nodeId: "airpArchives", outputName: "records" },
        to: { nodeId: "foregroundArchives", varName: "records" },
      },
      {
        from: { nodeId: "airpEvents", outputName: "records" },
        to: { nodeId: "retrievalStrategy", varName: "events.records" },
      },
      {
        from: { nodeId: "airpArchives", outputName: "records" },
        to: { nodeId: "retrievalStrategy", varName: "archives.records" },
      },
      {
        from: { nodeId: "airpGlobals", outputName: "records" },
        to: { nodeId: "retrievalStrategy", varName: "globals.records" },
      },
      {
        from: { nodeId: "ongoingEvents", outputName: "records" },
        to: { nodeId: "retrievalStrategy", varName: "ongoingEvents" },
      },
      {
        from: { nodeId: "foregroundArchives", outputName: "records" },
        to: { nodeId: "retrievalStrategy", varName: "foregroundArchives" },
      },
      {
        from: { nodeId: "retrievalStrategy", outputName: "directArchives" },
        to: { nodeId: "selectedArchiveMerge", varName: "directArchives" },
      },
      {
        from: { nodeId: "retrievalStrategy", outputName: "foregroundArchives" },
        to: { nodeId: "selectedArchiveMerge", varName: "foregroundArchives" },
      },
      {
        from: { nodeId: "retrievalStrategy", outputName: "relatedArchives" },
        to: { nodeId: "selectedArchiveMerge", varName: "relatedArchives" },
      },
      {
        from: { nodeId: "retrievalStrategy", outputName: "selectedEvents" },
        to: { nodeId: "selectedEventsText", varName: "records" },
      },
      {
        from: { nodeId: "selectedArchiveMerge", outputName: "records" },
        to: { nodeId: "selectedArchivesText", varName: "records" },
      },
      {
        from: { nodeId: "airpGlobals", outputName: "records" },
        to: { nodeId: "retrieval", varName: "globals.records" },
      },
      {
        from: { nodeId: "retrievalStrategy", outputName: "directEntities" },
        to: { nodeId: "retrieval", varName: "directEntities" },
      },
      {
        from: { nodeId: "retrievalStrategy", outputName: "debug" },
        to: { nodeId: "retrieval", varName: "strategyDebug" },
      },
      {
        from: { nodeId: "selectedArchiveMerge", outputName: "records" },
        to: { nodeId: "retrieval", varName: "archives" },
      },
      {
        from: { nodeId: "selectedEventsText", outputName: "text" },
        to: { nodeId: "retrieval", varName: "eventsText" },
      },
      {
        from: { nodeId: "selectedArchivesText", outputName: "text" },
        to: { nodeId: "retrieval", varName: "archivesText" },
      },
      {
        from: { nodeId: "retrieval", outputName: "prompt" },
        to: { nodeId: "chat", varName: "retrieval.prompt" },
      },
      {
        from: { nodeId: "chat", outputName: "raw" },
        to: { nodeId: "reply", varName: "value" },
      },
      {
        from: { nodeId: "chat", outputName: "raw" },
        to: { nodeId: "maintenance", varName: "lastReply" },
      },
      {
        from: { nodeId: "retrieval", outputName: "directEntities" },
        to: { nodeId: "maintenance", varName: "retrieval.directEntities" },
      },
      {
        from: { nodeId: "retrieval", outputName: "archives" },
        to: { nodeId: "maintenance", varName: "archives.recent.json" },
      },
      {
        from: { nodeId: "maintenance", outputName: "operations" },
        to: { nodeId: "memoryWrite", varName: "operations" },
      },
    ],
  }
}
