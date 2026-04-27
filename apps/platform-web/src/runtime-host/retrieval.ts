import type {
  ArchiveRecord,
  ConversationMessageRecord,
  RuntimeGlobalsMap,
} from "@tsian/contracts"
import { getBrowserRetrievalConfig } from "../config/ai"
import type { LocalEventRecord } from "../storage"
import { generateAssistantReply, generateEmbeddings } from "./ai"

interface RetrievalPlanDocument {
  groups: string[][]
}

export interface RetrievalCandidateDebugRecord {
  id: string
  time: string
  status: string
  tags: string[]
  keywordScore: number
  semanticScore: number | null
  finalScore: number
  selected: boolean
  content: string
}

export interface RetrievalArchiveDebugRecord {
  id: string
  name: string
  presence: string
  score: number
}

export interface RetrievalDebugRecord {
  input: string
  directEntities: string[]
  linkedEntities: string[]
  groups: string[][]
  candidates: RetrievalCandidateDebugRecord[]
  archives: RetrievalArchiveDebugRecord[]
}

export interface RetrievalAssemblyResult {
  prompt: string
  debug: RetrievalDebugRecord
}

const MAX_GROUPS = 3
const MAX_GROUP_TERMS = 3
const MAX_CANDIDATES = 12
const MAX_SELECTED_EVENTS = 3
const MAX_SELECTED_ARCHIVES = 4
const RECENT_MESSAGE_LIMIT = 6
const MIN_EVENT_INJECTION_SCORE = 0.72

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’，。！？、：；（）()\[\]【】<>《》]/g, "")
}

function buildPlanPrompt(input: {
  messages: ConversationMessageRecord[]
  userInput: string
  directEntityNames: string[]
  relatedEntityNames: string[]
}): string {
  return [
    "你是 AIRP 的检索规划 AI，只输出 JSON，不要解释。",
    '输出格式固定为 {"groups":[["词1","词2"],["词3"]]}。',
    "最多输出 3 组，每组必须是 2 到 3 个实体名称。",
    "你只能使用下面提供给你的实体名称，禁止输出列表外的词。",
    "每组必须至少包含 1 个直接命中的实体名称。",
    "不要输出时间推理，不要输出完整句子，不要输出多余字段。",
    "如果当前输入不需要历史检索，返回 {\"groups\":[]}。",
    `最近对话: ${JSON.stringify(input.messages)}`,
    `玩家当前输入: ${input.userInput}`,
    `当前已直接命中的实体名称: ${JSON.stringify(input.directEntityNames)}`,
    `可辅助使用的高频关联实体名称: ${JSON.stringify(input.relatedEntityNames)}`,
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

  throw new Error("Retrieval AI did not return JSON.")
}

function normalizeGroups(
  raw: unknown,
  input: {
    allowedNames: string[]
    directNames: string[]
  },
): string[][] {
  if (!Array.isArray(raw)) {
    return []
  }

  const allowedNameMap = new Map(
    input.allowedNames.map((item) => [normalizeToken(item), item] as const),
  )
  const directNameSet = new Set(input.directNames.map((item) => normalizeToken(item)))
  const groups: string[][] = []
  for (const item of raw.slice(0, MAX_GROUPS)) {
    if (!Array.isArray(item)) {
      continue
    }

    const dedup = new Set<string>()
    const group: string[] = []
    for (const value of item.slice(0, MAX_GROUP_TERMS)) {
      if (typeof value !== "string") {
        continue
      }

      const term = value.trim()
      const normalized = normalizeToken(term)
      const canonical = allowedNameMap.get(normalized)
      if (!normalized || !canonical || dedup.has(normalizeToken(canonical))) {
        continue
      }

      dedup.add(normalizeToken(canonical))
      group.push(canonical)
    }

    const hasDirectEntity = group.some((term) => directNameSet.has(normalizeToken(term)))
    if (group.length >= 2 && hasDirectEntity) {
      groups.push(group)
    }
  }

  return groups
}

async function generateRetrievalPlan(input: {
  messages: ConversationMessageRecord[]
  userInput: string
  directEntityNames: string[]
  relatedEntityNames: string[]
}): Promise<RetrievalPlanDocument> {
  const config = getBrowserRetrievalConfig()
  if (!config) {
    return {
      groups: [],
    }
  }

  try {
    const content = await generateAssistantReply(
      [
        {
          role: "system",
          content: "你是稳定、克制的 JSON 检索规划器。",
        },
        {
          role: "user",
          content: buildPlanPrompt(input),
        },
      ],
      {
        debugLabel: "retrieval",
        config,
      },
    )

    const raw = JSON.parse(extractJsonObject(content)) as {
      groups?: unknown
    }

    return {
      groups: normalizeGroups(raw.groups, {
        allowedNames: [...input.directEntityNames, ...input.relatedEntityNames],
        directNames: input.directEntityNames,
      }),
    }
  } catch (error) {
    console.warn("Tsian retrieval planning failed.", error)
    return {
      groups: [],
    }
  }
}

function selectPlannerArchiveNames(input: {
  messages: ConversationMessageRecord[]
  userInput: string
  archives: ArchiveRecord[]
}): ArchiveRecord[] {
  const contextText = normalizeToken(
    [...input.messages.map((item) => item.content), input.userInput].join(" "),
  )
  if (!contextText) {
    return []
  }

  return input.archives.flatMap((archive) => {
    if (archive.presence === "retired") {
      return []
    }

    const keys = [archive.name, ...archive.aliases]
      .map((item) => normalizeToken(item))
      .filter(Boolean)

    if (keys.some((item) => contextText.includes(item))) {
      return [archive]
    }

    return []
  })
}

function selectRelatedPlannerNames(input: {
  directArchives: ArchiveRecord[]
  allArchives: ArchiveRecord[]
}): string[] {
  const directNameSet = new Set(input.directArchives.map((item) => item.name))
  const archiveByName = new Map(input.allArchives.map((item) => [item.name, item] as const))
  const scores = new Map<string, number>()

  for (const archive of input.directArchives) {
    const uniqueRelatedNames = [...new Set(archive.linkedNames ?? [])]
    for (const relatedName of uniqueRelatedNames) {
      if (!relatedName || directNameSet.has(relatedName)) {
        continue
      }

      const relatedArchive = archiveByName.get(relatedName)
      if (!relatedArchive || relatedArchive.presence === "retired") {
        continue
      }

      scores.set(relatedName, (scores.get(relatedName) ?? 0) + 1)
    }
  }

  return [...scores.entries()]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1]
      }

      const leftArchive = archiveByName.get(left[0])
      const rightArchive = archiveByName.get(right[0])
      const leftPresenceScore = leftArchive?.presence === "foreground" ? 1 : 0
      const rightPresenceScore = rightArchive?.presence === "foreground" ? 1 : 0
      if (rightPresenceScore !== leftPresenceScore) {
        return rightPresenceScore - leftPresenceScore
      }

      return left[0].localeCompare(right[0], "zh-CN")
    })
    .slice(0, 2)
    .map(([name]) => name)
}

function buildRecentMessages(
  messages: ConversationMessageRecord[],
): ConversationMessageRecord[] {
  return messages.slice(-RECENT_MESSAGE_LIMIT)
}

function buildQueryText(input: {
  messages: ConversationMessageRecord[]
  userInput: string
  groups: string[][]
}): string {
  return [
    ...input.messages.map((item) => `${item.role}: ${item.content}`),
    `user: ${input.userInput}`,
    input.groups.length > 0
      ? `query-groups: ${input.groups.map((group) => group.join(" + ")).join(" | ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n")
}

function getEventTagSet(event: LocalEventRecord): Set<string> {
  return new Set(event.entityTags.map((item) => normalizeToken(item)).filter(Boolean))
}

function getKeywordScore(event: LocalEventRecord, groups: string[][]): number {
  const tagSet = getEventTagSet(event)
  let best = 0

  for (const group of groups) {
    const normalizedGroup = group.map((item) => normalizeToken(item)).filter(Boolean)
    if (normalizedGroup.length === 0) {
      continue
    }

    const hitCount = normalizedGroup.filter((item) => tagSet.has(item)).length
    best = Math.max(best, hitCount / normalizedGroup.length)
  }

  return best
}

function recallCandidateEvents(
  events: LocalEventRecord[],
  groups: string[][],
  activeEventId?: string,
): LocalEventRecord[] {
  const filtered = events.filter((item) => item.id !== activeEventId)
  if (groups.length === 0) {
    return []
  }

  const precise = filtered.filter((item) => {
    const tagSet = getEventTagSet(item)
    return groups.some((group) => {
      const normalizedGroup = group.map((term) => normalizeToken(term)).filter(Boolean)
      return normalizedGroup.length > 0 && normalizedGroup.every((term) => tagSet.has(term))
    })
  })

  const loose = filtered.filter((item) => {
    if (precise.some((candidate) => candidate.id === item.id)) {
      return false
    }

    return getKeywordScore(item, groups) > 0
  })

  return [...precise, ...loose].slice(0, MAX_CANDIDATES)
}

function buildEventEmbeddingText(event: LocalEventRecord): string {
  return [
    `time: ${event.time}`,
    `tags: ${event.entityTags.join(", ")}`,
    event.content,
  ].join("\n")
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0
  }

  let dot = 0
  let leftNorm = 0
  let rightNorm = 0

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]
    leftNorm += left[index] * left[index]
    rightNorm += right[index] * right[index]
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
}

async function rankCandidateEvents(
  candidates: LocalEventRecord[],
  queryText: string,
  groups: string[][],
): Promise<RetrievalCandidateDebugRecord[]> {
  if (candidates.length === 0) {
    return []
  }

  let semanticScores = new Map<string, number>()

  try {
    const vectors = await generateEmbeddings(
      [queryText, ...candidates.map(buildEventEmbeddingText)],
      {
        debugLabel: "embed",
      },
    )

    const queryVector = vectors[0]
    if (queryVector) {
      semanticScores = new Map(
        candidates.map((candidate, index) => {
          const eventVector = vectors[index + 1] ?? []
          return [candidate.id, cosineSimilarity(queryVector, eventVector)]
        }),
      )
    }
  } catch (error) {
    console.warn("Tsian retrieval embedding failed.", error)
  }

  return candidates
    .map((candidate) => {
      const keywordScore = getKeywordScore(candidate, groups)
      const semanticScore = semanticScores.get(candidate.id)
      const finalScore =
        semanticScore === undefined ? keywordScore : semanticScore * 0.7 + keywordScore * 0.3

      return {
        id: candidate.id,
        time: candidate.time,
        status: candidate.status,
        tags: candidate.entityTags,
        keywordScore,
        semanticScore: semanticScore ?? null,
        finalScore,
        selected: false,
        content: candidate.content,
      }
    })
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore
      }
      return right.time.localeCompare(left.time)
    })
}

function findArchiveTextScore(
  archive: ArchiveRecord,
  text: string,
): number {
  const normalizedText = normalizeToken(text)
  if (!normalizedText) {
    return 0
  }

  const names = [archive.name, ...archive.aliases]
  let score = 0

  for (const name of names) {
    const normalized = normalizeToken(name)
    if (normalized && normalizedText.includes(normalized)) {
      score += 2
    }
  }

  return score
}

function selectRelevantArchives(input: {
  archives: ArchiveRecord[]
  groups: string[][]
  queryText: string
  selectedEvents: RetrievalCandidateDebugRecord[]
}): RetrievalArchiveDebugRecord[] {
  const selectedTagSet = new Set(
    input.selectedEvents.flatMap((item) =>
      item.tags.map((tag) => normalizeToken(tag)).filter(Boolean),
    ),
  )
  const groupTerms = new Set(
    input.groups.flatMap((group) => group.map((term) => normalizeToken(term)).filter(Boolean)),
  )

  return input.archives
    .filter((item) => item.presence !== "retired")
    .map((archive) => {
      let score = findArchiveTextScore(archive, input.queryText)

      if (groupTerms.has(normalizeToken(archive.name))) {
        score += 2
      }

      if (selectedTagSet.has(normalizeToken(archive.name))) {
        score += 1
      }

      for (const alias of archive.aliases) {
        const normalizedAlias = normalizeToken(alias)
        if (groupTerms.has(normalizedAlias) || selectedTagSet.has(normalizedAlias)) {
          score += 1
        }
      }

      return {
        id: archive.id,
        name: archive.name,
        presence: archive.presence,
        score,
      }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return left.name.localeCompare(right.name, "zh-CN")
    })
    .slice(0, MAX_SELECTED_ARCHIVES)
}

function formatGlobalValue(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function buildMemoryPrompt(input: {
  currentTime?: string
  globals?: RuntimeGlobalsMap
  activeEvent: LocalEventRecord | null
  selectedEvents: RetrievalCandidateDebugRecord[]
  archives: ArchiveRecord[]
  selectedArchiveIds: Set<string>
}): string {
  const memoryLines: string[] = [
    "你正在继续当前 AIRP 剧情。",
    "以下是系统提供的记忆补充，只在相关时使用，保持叙事一致。",
  ]

  if (input.currentTime) {
    memoryLines.push("")
    memoryLines.push("当前叙事时间：")
    memoryLines.push(input.currentTime)
  }

  const globalEntries = Object.entries(input.globals ?? {}).filter(([key]) => key.trim())
  if (globalEntries.length > 0) {
    memoryLines.push("")
    memoryLines.push("当前全局状态：")
    globalEntries.forEach(([key, value]) => {
      memoryLines.push(`${key}：${formatGlobalValue(value)}`)
    })
  }

  if (input.activeEvent) {
    memoryLines.push("")
    memoryLines.push("当前进行中的事件：")
    memoryLines.push(input.activeEvent.content)
  }

  if (input.selectedEvents.length > 0) {
    memoryLines.push("")
    memoryLines.push("检索到的相关历史事件：")
    input.selectedEvents.forEach((item, index) => {
      memoryLines.push(`${index + 1}. ${item.content}`)
    })
  }

  const selectedArchives = input.archives.filter((item) => input.selectedArchiveIds.has(item.id))
  if (selectedArchives.length > 0) {
    memoryLines.push("")
    memoryLines.push("相关叙事实体档案：")
    selectedArchives.forEach((archive) => {
      memoryLines.push(
        `${archive.name}｜背景：${archive.background || "无"}｜现状：${
          archive.situation || "无"
        }｜关注点：${archive.focus || "无"}`,
      )
    })
  }

  return memoryLines.join("\n")
}

export async function assembleRetrievalContext(input: {
  messages: ConversationMessageRecord[]
  userInput: string
  events: LocalEventRecord[]
  activeEvent: LocalEventRecord | null
  archives: ArchiveRecord[]
  currentTime?: string
  globals?: RuntimeGlobalsMap
}): Promise<RetrievalAssemblyResult> {
  // 这一层只做“召回 + 重排 + 注入文本组装”，不在这里改写存储数据。
  const recentMessages = buildRecentMessages(input.messages)
  const directArchives = selectPlannerArchiveNames({
    messages: recentMessages,
    userInput: input.userInput,
    archives: input.archives,
  })
  const directArchiveNames = [...new Set(directArchives.map((item) => item.name))]
  const relatedArchiveNames = selectRelatedPlannerNames({
    directArchives,
    allArchives: input.archives,
  })
  const plan = await generateRetrievalPlan({
    messages: recentMessages,
    userInput: input.userInput,
    directEntityNames: directArchiveNames,
    relatedEntityNames: relatedArchiveNames,
  })
  const groups = plan.groups
  const queryText = buildQueryText({
    messages: recentMessages,
    userInput: input.userInput,
    groups,
  })
  const candidates = recallCandidateEvents(
    input.events,
    groups,
    input.activeEvent?.id,
  )
  const ranked = await rankCandidateEvents(candidates, queryText, groups)
  const selected = ranked
    .filter((item) => item.finalScore >= MIN_EVENT_INJECTION_SCORE)
    .slice(0, MAX_SELECTED_EVENTS)
    .map((item) => ({
      ...item,
      selected: true,
    }))
  const selectedIds = new Set(selected.map((item) => item.id))
  const candidatesWithSelection = ranked.map((item) => ({
    ...item,
    selected: selectedIds.has(item.id),
  }))
  const archiveHits = selectRelevantArchives({
    archives: input.archives,
    groups,
    queryText,
    selectedEvents: selected,
  })

  return {
    prompt: buildMemoryPrompt({
      currentTime: input.currentTime,
      globals: input.globals,
      activeEvent: input.activeEvent,
      selectedEvents: selected,
      archives: input.archives,
      selectedArchiveIds: new Set(archiveHits.map((item) => item.id)),
    }),
    debug: {
      input: input.userInput,
      directEntities: directArchiveNames,
      linkedEntities: relatedArchiveNames,
      groups,
      candidates: candidatesWithSelection,
      archives: archiveHits,
    },
  }
}
