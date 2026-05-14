import type {
  ArchiveRecord,
  CatalogEventRecord,
  ConversationMessageRecord,
  RuntimeGlobalsMap,
} from "@tsian/contracts"
import {
  DEFAULT_BROWSER_RETRIEVAL_SETTINGS,
  type BrowserRetrievalSettings,
} from "../config/ai"
import { getBrowserEmbeddingConfig, getBrowserRetrievalConfig } from "../config/ai"
import { generateAssistantReply, generateEmbeddings } from "./ai"
import {
  archiveEmbeddingContent,
  eventEmbeddingContent,
  findSimilarEmbeddingSources,
  getMissingEmbeddingSources,
  putEmbeddingVectors,
  type EmbeddingMatchRecord,
  type EmbeddingSourceRecord,
  type LocalEventRecord,
} from "../storage"

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
  source: "direct" | "present" | "event" | "bridge" | "semantic"
}

export interface RetrievalCatalogEventDebugRecord {
  id: string
  name: string
  score: number
  selected: boolean
  content: string
  guidance?: string
}

export interface RetrievalSemanticDebugRecord {
  enabled: boolean
  keywords: string[]
  eventIds: string[]
  archiveIds: string[]
  error?: string
}

export interface RetrievalHintEntityDebugRecord {
  archiveId: string
  name: string
  type: string
}

export interface RetrievalDebugRecord {
  input: string
  settings: BrowserRetrievalSettings
  semantic: RetrievalSemanticDebugRecord
  directEntities: string[]
  presentEntities: string[]
  linkedEntities: string[]
  groups: string[][]
  candidates: RetrievalCandidateDebugRecord[]
  archives: RetrievalArchiveDebugRecord[]
  catalogEvents: RetrievalCatalogEventDebugRecord[]
  hintEntities?: RetrievalHintEntityDebugRecord[]
}

export interface RetrievalAssemblyResult {
  prompt: string
  debug: RetrievalDebugRecord
}

interface RankedEventRecord extends RetrievalCandidateDebugRecord {
  event: LocalEventRecord
}

interface SemanticRetrievalResult {
  keywords: string[]
  events: EmbeddingMatchRecord[]
  archives: EmbeddingMatchRecord[]
  error?: string
}

function mergeRetrievalSettings(
  settings?: Partial<BrowserRetrievalSettings>,
): BrowserRetrievalSettings {
  return {
    ...DEFAULT_BROWSER_RETRIEVAL_SETTINGS,
    ...settings,
  }
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’，。！？、：；（）()\[\]【】<>《》]/g, "")
}

function buildRecentMessages(
  messages: ConversationMessageRecord[],
  settings: BrowserRetrievalSettings,
): ConversationMessageRecord[] {
  return messages.slice(-settings.recentMessageLimit)
}

function archiveNameMap(archives: ArchiveRecord[]): Map<string, ArchiveRecord> {
  const map = new Map<string, ArchiveRecord>()
  archives.forEach((archive) => {
    const keys = [archive.name, ...archive.aliases]
    keys.forEach((key) => {
      const normalized = normalizeToken(key)
      if (normalized && !map.has(normalized)) {
        map.set(normalized, archive)
      }
    })
  })
  return map
}

function uniqueArchives(items: ArchiveRecord[]): ArchiveRecord[] {
  const seen = new Set<string>()
  const result: ArchiveRecord[] = []
  for (const item of items) {
    if (seen.has(item.id)) {
      continue
    }
    seen.add(item.id)
    result.push(item)
  }
  return result
}

function uniqueEvents(items: LocalEventRecord[]): LocalEventRecord[] {
  const seen = new Set<string>()
  const result: LocalEventRecord[] = []
  for (const item of items) {
    if (seen.has(item.id)) {
      continue
    }
    seen.add(item.id)
    result.push(item)
  }
  return result
}

function selectDirectArchives(input: {
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

  return uniqueArchives(
    input.archives.flatMap((archive) => {
      if (archive.presence === "retired") {
        return []
      }

      const keys = [archive.name, ...archive.aliases]
        .map((item) => normalizeToken(item))
        .filter(Boolean)

      return keys.some((item) => contextText.includes(item)) ? [archive] : []
    }),
  )
}

function selectPresentArchives(input: {
  activeEvents: LocalEventRecord[]
  archives: ArchiveRecord[]
}): ArchiveRecord[] {
  if (input.activeEvents.length === 0) {
    return []
  }

  const archiveByName = archiveNameMap(input.archives)
  return uniqueArchives(
    input.activeEvents.flatMap((event) => event.entityTags).flatMap((name) => {
      const archive = archiveByName.get(normalizeToken(name))
      return archive && archive.presence !== "retired" ? [archive] : []
    }),
  )
}

function selectBridgeArchives(input: {
  directArchives: ArchiveRecord[]
  presentArchives: ArchiveRecord[]
  archives: ArchiveRecord[]
  settings: BrowserRetrievalSettings
}): ArchiveRecord[] {
  const baseArchives = uniqueArchives([...input.directArchives, ...input.presentArchives])
  const baseIds = new Set(baseArchives.map((item) => item.id))
  const archiveByName = archiveNameMap(input.archives)
  const scores = new Map<string, number>()

  for (const archive of baseArchives) {
    for (const name of new Set(archive.linkedNames ?? [])) {
      const linked = archiveByName.get(normalizeToken(name))
      if (!linked || linked.presence === "retired" || baseIds.has(linked.id)) {
        continue
      }
      scores.set(linked.id, (scores.get(linked.id) ?? 0) + 1)
    }
  }

  return input.archives
    // 先过关联分阈值，再用数量上限控制注入体积。
    .filter((archive) => (scores.get(archive.id) ?? 0) >= input.settings.minBridgeEntityScore)
    .sort((left, right) => {
      const scoreDiff = (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0)
      if (scoreDiff !== 0) {
        return scoreDiff
      }

      const presenceDiff =
        (right.presence === "foreground" ? 1 : 0) -
        (left.presence === "foreground" ? 1 : 0)
      if (presenceDiff !== 0) {
        return presenceDiff
      }

      return left.name.localeCompare(right.name, "zh-CN")
    })
    .slice(0, input.settings.bridgeEntityLimit)
}

function entityFrequency(events: LocalEventRecord[]): Map<string, number> {
  const frequency = new Map<string, number>()
  for (const event of events) {
    for (const tag of new Set(event.entityTags.map(normalizeToken).filter(Boolean))) {
      frequency.set(tag, (frequency.get(tag) ?? 0) + 1)
    }
  }
  return frequency
}

function rarityScore(normalizedName: string, frequency: Map<string, number>): number {
  const count = frequency.get(normalizedName) ?? 0
  if (count <= 1) {
    return 2
  }
  if (count <= 3) {
    return 1
  }
  return 0
}

function buildPlayerEntityTagSet(input: {
  archives: ArchiveRecord[]
  playerEntityIds: string[]
}): Set<string> {
  if (input.playerEntityIds.length === 0) {
    return new Set()
  }
  const idSet = new Set(input.playerEntityIds)
  const tags = new Set<string>()
  for (const archive of input.archives) {
    if (!idSet.has(archive.id)) {
      continue
    }
    const candidates = [archive.name, ...(archive.aliases ?? [])]
    for (const candidate of candidates) {
      const normalized = normalizeToken(candidate)
      if (normalized) {
        tags.add(normalized)
      }
    }
  }
  return tags
}

function narrativeGapHours(currentTime: string | undefined, eventTime: string): number | null {
  if (!currentTime || !eventTime) {
    return null
  }
  const cur = parseNarrativeTime(currentTime)
  const evt = parseNarrativeTime(eventTime)
  if (cur === 0 || evt === 0) {
    return null
  }
  return Math.max(0, (cur - evt) / 3_600_000)
}

function rankEventsByEntityGraph(input: {
  events: LocalEventRecord[]
  activeEvents: LocalEventRecord[]
  directArchives: ArchiveRecord[]
  presentArchives: ArchiveRecord[]
  bridgeArchives: ArchiveRecord[]
  archives: ArchiveRecord[]
  currentTime?: string
  playerArchiveIds: string[]
  settings: BrowserRetrievalSettings
}): RankedEventRecord[] {
  const direct = new Set(input.directArchives.map((item) => normalizeToken(item.name)))
  const present = new Set(input.presentArchives.map((item) => normalizeToken(item.name)))
  const bridge = new Set(input.bridgeArchives.map((item) => normalizeToken(item.name)))
  const activeIds = new Set(input.activeEvents.map((event) => event.id))
  const active = new Set(
    input.activeEvents.flatMap((event) => event.entityTags).map(normalizeToken).filter(Boolean),
  )
  const frequency = entityFrequency(input.events)
  const playerTags = buildPlayerEntityTagSet({
    archives: input.archives,
    playerEntityIds: input.playerArchiveIds,
  })
  const halfH = Math.max(0, input.settings.timeDecayHalfLifeHours)
  const ongoingMult = Math.max(1, input.settings.ongoingDecayMultiplier)

  return input.events
    .filter((event) => !activeIds.has(event.id))
    .map((event): RankedEventRecord | null => {
      const tags = [...new Set(event.entityTags.map(normalizeToken).filter(Boolean))]
      if (tags.length === 0) {
        return null
      }
      let raw = 0
      let strongHitCount = 0

      // 互斥分组：同一 tag 只在最高优先级桶里计分（避免 direct+bridge 双计）
      for (const tag of tags) {
        const r = playerTags.has(tag) ? 1.0 : rarityScore(tag, frequency)
        if (direct.has(tag)) {
          raw += 4 + r
          strongHitCount += 1
        } else if (present.has(tag)) {
          raw += 3 + r
          strongHitCount += 1
        } else if (active.has(tag)) {
          raw += 2.5
        } else if (bridge.has(tag)) {
          raw += 1.5
        }
      }

      // AIRP 关键：无 direct/present 强命中则淘汰，宁可少召回也不要噪声
      if (input.settings.noStrongHitFilter && strongHitCount === 0) {
        return null
      }

      // 共现奖励：≥2 个 direct/present tag
      if (strongHitCount >= 2) {
        raw += Math.min(2, strongHitCount - 1)
      }

      // 长度归一化：避免长事件因 tag 多而被天然拉高
      let score = raw / Math.sqrt(Math.max(1, tags.length))

      // ongoing 加成：进行中的剧情线必须保
      const isOngoing = event.status === "ongoing"
      if (isOngoing) {
        score *= 1.6
      }

      // 叙事时间衰减：远古事件影响力衰减，但保留 40% 基础分
      if (halfH > 0) {
        const gap = narrativeGapHours(input.currentTime, event.time)
        if (gap !== null) {
          const effectiveHalfLife = halfH * (isOngoing ? ongoingMult : 1)
          const decay = Math.exp(-gap / effectiveHalfLife)
          score *= 0.4 + 0.6 * decay
        }
      }

      return {
        id: event.id,
        time: event.time,
        status: event.status,
        tags: event.entityTags,
        keywordScore: score,
        semanticScore: null,
        finalScore: score,
        selected: false,
        content: event.content,
        event,
      }
    })
    .filter((item): item is RankedEventRecord => item !== null && item.finalScore > 0)
    .sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore
      }
      return right.time.localeCompare(left.time)
    })
    .slice(0, input.settings.maxCandidates)
}

function getSeedLimit(input: {
  directArchives: ArchiveRecord[]
  presentArchives: ArchiveRecord[]
  activeEvents: LocalEventRecord[]
  settings: BrowserRetrievalSettings
}): number {
  const entityCount = new Set([
    ...input.directArchives.map((item) => item.id),
    ...input.presentArchives.map((item) => item.id),
    ...input.activeEvents.flatMap((event) => event.entityTags),
  ]).size

  return entityCount >= input.settings.complexEntityThreshold
    ? input.settings.complexSeedEventLimit
    : input.settings.baseSeedEventLimit
}

function parseNarrativeTime(value: string): number {
  const time = Date.parse(value.replace(" ", "T"))
  return Number.isFinite(time) ? time : 0
}

function eventChain(input: {
  seed: RankedEventRecord
  events: LocalEventRecord[]
  settings: BrowserRetrievalSettings
}): LocalEventRecord[] {
  const ordered = [...input.events].sort((left, right) => {
    const timeDiff = parseNarrativeTime(left.time) - parseNarrativeTime(right.time)
    if (timeDiff !== 0) {
      return timeDiff
    }
    return left.id.localeCompare(right.id)
  })
  const index = ordered.findIndex((event) => event.id === input.seed.id)
  if (index < 0) {
    return [input.seed.event]
  }

  return ordered.slice(
    Math.max(0, index - input.settings.maxChainNeighborsPerSeed),
    Math.min(ordered.length, index + input.settings.maxChainNeighborsPerSeed + 1),
  )
}

function selectEventChains(input: {
  ranked: RankedEventRecord[]
  events: LocalEventRecord[]
  seedLimit: number
  settings: BrowserRetrievalSettings
}): RetrievalCandidateDebugRecord[] {
  const selectedIds = new Set<string>()
  const selected: RetrievalCandidateDebugRecord[] = []
  const seeds = input.ranked
    .filter((item) => item.finalScore >= input.settings.minSeedScore)
    .slice(0, input.seedLimit)

  for (const seed of seeds) {
    for (const event of eventChain({ seed, events: input.events, settings: input.settings })) {
      if (selectedIds.has(event.id) || selected.length >= input.settings.maxInjectedEvents) {
        continue
      }
      selectedIds.add(event.id)
      const ranked = input.ranked.find((item) => item.id === event.id)
      selected.push({
        id: event.id,
        time: event.time,
        status: event.status,
        tags: event.entityTags,
        keywordScore: ranked?.keywordScore ?? 0,
        semanticScore: null,
        finalScore: ranked?.finalScore ?? 0,
        selected: true,
        content: event.content,
      })
    }
  }

  return selected.sort((left, right) => {
    const timeDiff = parseNarrativeTime(left.time) - parseNarrativeTime(right.time)
    if (timeDiff !== 0) {
      return timeDiff
    }
    return left.id.localeCompare(right.id)
  })
}

function eventChainForRecord(input: {
  event: LocalEventRecord
  events: LocalEventRecord[]
  settings: BrowserRetrievalSettings
}): LocalEventRecord[] {
  const ranked: RankedEventRecord = {
    id: input.event.id,
    time: input.event.time,
    status: input.event.status,
    tags: input.event.entityTags,
    keywordScore: 0,
    semanticScore: null,
    finalScore: 0,
    selected: false,
    content: input.event.content,
    event: input.event,
  }
  return eventChain({ seed: ranked, events: input.events, settings: input.settings })
}

function recentContextText(input: {
  messages: ConversationMessageRecord[]
  userInput: string
  currentTime?: string
  narrativeTimeText?: string
}): string {
  return [
    input.currentTime ? `结构化时间：${input.currentTime}` : "",
    input.narrativeTimeText ? `当前时间：${input.narrativeTimeText}` : "",
    ...input.messages.map((message) => `${message.role}：${message.content}`),
    `玩家输入：${input.userInput}`,
  ]
    .filter(Boolean)
    .join("\n")
}

function parseKeywordResponse(value: string): string[] {
  const trimmed = value.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : []))
    }
    if (typeof parsed === "object" && parsed !== null && "keywords" in parsed) {
      const keywords = (parsed as { keywords?: unknown }).keywords
      if (Array.isArray(keywords)) {
        return keywords.flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : [],
        )
      }
    }
  } catch {
    return trimmed
      .split(/[\n,，、]/g)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

async function generateSemanticKeywords(input: {
  contextText: string
}): Promise<string[]> {
  const response = await generateAssistantReply(
    [
      {
        role: "system",
        content: [
          "你是 Tsian 的可选增强检索助手。",
          "你的任务是从当前上下文和玩家输入中提取非实体语义关键词，用于向量检索事件记录和实体档案。",
          "不要输出人物、地点、物品等实体名称；这些实体已由结构检索处理。",
          "优先输出能描述行动、动机、线索性质、冲突关系、案件手法、异常现象的短词组。",
          "只输出 JSON：{\"keywords\":[\"关键词\"]}，最多 6 个。",
        ].join("\n"),
      },
      {
        role: "user",
        content: input.contextText,
      },
    ],
    {
      debugLabel: "retrieval-keywords",
      config: getBrowserRetrievalConfig(),
    },
  )

  return [...new Set(parseKeywordResponse(response))].slice(0, 6)
}

function buildEmbeddingSources(input: {
  events: LocalEventRecord[]
  archives: ArchiveRecord[]
}): EmbeddingSourceRecord[] {
  return [
    ...input.events.map((event) => ({
      targetType: "event" as const,
      targetId: event.id,
      content: eventEmbeddingContent(event),
    })),
    ...input.archives
      .filter((archive) => archive.presence !== "retired")
      .map((archive) => ({
        targetType: "archive" as const,
        targetId: archive.id,
        content: archiveEmbeddingContent(archive),
      })),
  ]
}

async function ensureEmbeddingCache(input: {
  sources: EmbeddingSourceRecord[]
  embeddingModel: string
}): Promise<void> {
  const missing = await getMissingEmbeddingSources(input)
  if (missing.length === 0) {
    return
  }

  const vectors = await generateEmbeddings(
    missing.map((item) => item.content),
    { debugLabel: "retrieval-cache" },
  )
  await putEmbeddingVectors({
    sources: missing,
    embeddingModel: input.embeddingModel,
    vectors,
  })
}

async function runSemanticRetrieval(input: {
  settings: BrowserRetrievalSettings
  recentMessages: ConversationMessageRecord[]
  userInput: string
  events: LocalEventRecord[]
  archives: ArchiveRecord[]
  currentTime?: string
  narrativeTimeText?: string
}): Promise<SemanticRetrievalResult> {
  if (!input.settings.aiEnhanced) {
    return { keywords: [], events: [], archives: [] }
  }

  const embeddingConfig = getBrowserEmbeddingConfig()
  if (!embeddingConfig) {
    return {
      keywords: [],
      events: [],
      archives: [],
      error: "AI 增强检索已开启，但 embedding 配置缺失。",
    }
  }

  try {
    const contextText = recentContextText({
      messages: input.recentMessages,
      userInput: input.userInput,
      currentTime: input.currentTime,
      narrativeTimeText: input.narrativeTimeText,
    })
    if (!contextText.trim()) {
      return { keywords: [], events: [], archives: [] }
    }

    // AIRP 改造：直接 embed 上下文文本，避免"上下文 → 关键词 → 向量"的双层信息损失。
    // keywords 仅作为可观测调试输出，失败不影响主路径。
    const sources = buildEmbeddingSources(input)
    await ensureEmbeddingCache({ sources, embeddingModel: embeddingConfig.model })
    const [queryVector] = await generateEmbeddings([contextText], {
      debugLabel: "retrieval-query",
    })

    if (!queryVector) {
      return { keywords: [], events: [], archives: [], error: "语义查询 embedding 为空。" }
    }

    const keywords = await generateSemanticKeywords({ contextText }).catch(() => [] as string[])

    const events = await findSimilarEmbeddingSources({
      sources,
      embeddingModel: embeddingConfig.model,
      queryVector,
      targetType: "event",
      limit: input.settings.semanticEventLimit,
      minScore: input.settings.semanticScoreThreshold,
    })
    const archives = await findSimilarEmbeddingSources({
      sources,
      embeddingModel: embeddingConfig.model,
      queryVector,
      targetType: "archive",
      limit: input.settings.semanticArchiveLimit,
      minScore: input.settings.semanticScoreThreshold,
    })

    return { keywords, events, archives }
  } catch (error) {
    return {
      keywords: [],
      events: [],
      archives: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
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

function normalizeJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => normalizeJsonValue(item)).sort())
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value)
  }
  return String(value)
}

function triggerGlobalMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.some((item) => triggerGlobalMatches(actual, item))
  }
  return normalizeJsonValue(actual) === normalizeJsonValue(expected)
}

function catalogTriggerPassed(input: {
  event: CatalogEventRecord
  currentTime?: string
  globals?: RuntimeGlobalsMap
  entityPool: Set<string>
}): boolean {
  const trigger = input.event.trigger
  if (!trigger) {
    return true
  }

  if (trigger.notBefore && input.currentTime && input.currentTime < trigger.notBefore) {
    return false
  }
  if (trigger.notAfter && input.currentTime && input.currentTime > trigger.notAfter) {
    return false
  }

  for (const name of trigger.requiredEntityNames ?? []) {
    if (!input.entityPool.has(normalizeToken(name))) {
      return false
    }
  }

  for (const [key, expected] of Object.entries(trigger.requiredGlobals ?? {})) {
    if (!triggerGlobalMatches(input.globals?.[key], expected)) {
      return false
    }
  }

  return true
}

function selectCatalogEventCandidates(input: {
  catalogEvents: CatalogEventRecord[]
  currentTime?: string
  globals?: RuntimeGlobalsMap
  userInput: string
  recentMessages: ConversationMessageRecord[]
  directArchives: ArchiveRecord[]
  presentArchives: ArchiveRecord[]
  activeEvents: LocalEventRecord[]
  settings: BrowserRetrievalSettings
}): RetrievalCatalogEventDebugRecord[] {
  const entityNames = [
    ...input.directArchives.map((archive) => archive.name),
    ...input.presentArchives.map((archive) => archive.name),
    ...input.activeEvents.flatMap((event) => event.entityTags),
  ]
  const entityPool = new Set(entityNames.map(normalizeToken).filter(Boolean))
  const contextText = normalizeToken(
    [
      input.userInput,
      ...input.recentMessages.map((message) => message.content),
      ...input.activeEvents.map((event) => event.content),
    ].join(" "),
  )

  const ranked = input.catalogEvents
    .flatMap((event) => {
      if (!catalogTriggerPassed({
        event,
        currentTime: input.currentTime,
        globals: input.globals,
        entityPool,
      })) {
        return []
      }

      const tagScore = event.entityTags.reduce((score, tag) => {
        const normalized = normalizeToken(tag)
        if (!normalized) {
          return score
        }
        if (entityPool.has(normalized)) {
          return score + 20
        }
        if (contextText.includes(normalized)) {
          return score + 10
        }
        return score
      }, 0)
      const textScore = contextText.includes(normalizeToken(event.name)) ? 5 : 0
      const score = tagScore + textScore
      if (score <= 0) {
        return []
      }

      return [
        {
          id: event.id,
          name: event.name,
          score,
          selected: false,
          content: event.content,
          guidance: event.guidance,
        },
      ]
    })
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))

  // 预设剧情钩子先按分数阈值筛，再用数量上限兜底，避免固定 top N 误注入弱相关钩子。
  let selectedCount = 0
  return ranked.map((event) => {
    const selected =
      event.score >= input.settings.minCatalogEventScore &&
      selectedCount < input.settings.maxCatalogInjected

    if (selected) {
      selectedCount += 1
    }

    return {
      ...event,
      selected,
    }
  })
}
function formatDefaultNarrativeTime(value: string): string {
  return value.trim() || "未设置"
}

function archiveLine(archive: ArchiveRecord): string {
  return `${archive.name}｜背景：${archive.background || "无"}｜现状：${
    archive.situation || "无"
  }${archive.focus ? `｜关注点：${archive.focus}` : ""}`
}

interface HintEntityRecord {
  archiveId: string
  name: string
  type: string
}

/**
 * AIRP L4 防幻觉提示位：扫描最近 N 轮消息，挑出"被提到但本轮未在 L1-L3 召回"的实体。
 * 给正文 AI 一个温和提示："这些你接触过，引用时保持已有事实一致；不确定别展开"。
 * 比 Graphiti 时序边更直接解决"AI 看到当前态但要引用历史"的问题。
 */
function computeHintEntities(input: {
  recentMessages: ConversationMessageRecord[]
  archives: ArchiveRecord[]
  excludedArchiveIds: Set<string>
  recencyTurns: number
}): HintEntityRecord[] {
  if (input.recencyTurns <= 0) {
    return []
  }
  const slice = input.recentMessages.slice(-input.recencyTurns)
  if (slice.length === 0) {
    return []
  }
  const text = slice.map((m) => m.content ?? "").join(" ")
  const normalizedText = normalizeToken(text)
  if (!normalizedText) {
    return []
  }
  const result: HintEntityRecord[] = []
  const seen = new Set<string>()
  for (const archive of input.archives) {
    if (input.excludedArchiveIds.has(archive.id)) {
      continue
    }
    if (seen.has(archive.id)) {
      continue
    }
    if (archive.presence === "retired") {
      continue
    }
    const candidates = [archive.name, ...(archive.aliases ?? [])]
    const tokens = candidates.map(normalizeToken).filter((token) => token.length >= 2)
    const hit = tokens.some((token) => normalizedText.includes(token))
    if (hit) {
      result.push({
        archiveId: archive.id,
        name: archive.name,
        type: archive.type ?? "实体",
      })
      seen.add(archive.id)
    }
  }
  return result
}

function pushArchiveSection(
  lines: string[],
  title: string,
  archives: ArchiveRecord[],
) {
  if (archives.length === 0) {
    return
  }

  lines.push("")
  lines.push(title)
  archives.forEach((archive) => lines.push(archiveLine(archive)))
}

function buildMemoryPrompt(input: {
  currentTime?: string
  narrativeTimeText?: string
  globals?: RuntimeGlobalsMap
  catalogEvents: RetrievalCatalogEventDebugRecord[]
  activeEvents: LocalEventRecord[]
  selectedEvents: RetrievalCandidateDebugRecord[]
  directArchives: ArchiveRecord[]
  presentArchives: ArchiveRecord[]
  eventArchives: ArchiveRecord[]
  bridgeArchives: ArchiveRecord[]
  semanticArchives: ArchiveRecord[]
  hintEntities?: HintEntityRecord[]
}): string {
  const memoryLines: string[] = [
    "你是 AIRP 正文叙事 AI，负责根据玩家输入生成本轮可游玩的剧情正文。",
    "你会看到当前叙事时间、全局状态、进行中事件、相关历史事件和实体档案。",
    "你的任务：承接玩家动作，推进当前事件，写出具体可感的结果，并留下足够清晰的事实供维护 AI 更新记忆。",
    "优秀回复标准：",
    "1. 先回应玩家当前动作，再自然推进环境、人物、物件或风险变化。",
    "2. 使用记忆补充保持一致，但不要机械复述档案或调试信息。",
    "3. 当玩家推动调查、移动、交涉、战斗或时间流逝时，应写出明确的新事实。",
    "4. 不替玩家做重大决定，不直接跳过关键选择。",
    "5. 保持中文叙事正文，不输出 JSON，不解释系统规则。",
    "以下是系统提供的记忆补充：",
  ]

  if (input.currentTime) {
    memoryLines.push("")
    memoryLines.push("当前叙事时间：")
    memoryLines.push(input.narrativeTimeText ?? formatDefaultNarrativeTime(input.currentTime))
  }

  const globalEntries = Object.entries(input.globals ?? {}).filter(([key]) => key.trim())
  if (globalEntries.length > 0) {
    memoryLines.push("")
    memoryLines.push("当前全局状态：")
    globalEntries.forEach(([key, value]) => {
      memoryLines.push(`${key}：${formatGlobalValue(value)}`)
    })
  }

  if (input.catalogEvents.length > 0) {
    memoryLines.push("")
    memoryLines.push("当前可吸收的预设剧情钩子：")
    memoryLines.push("以下内容来自作者预设事件目录，只表示本轮可参考的剧情钩子，不是已经发生的事实；如果不适合当前剧情，可以忽略。")
    input.catalogEvents.forEach((event, index) => {
      memoryLines.push(`${index + 1}. ${event.name}｜剧情骨架：${event.content}`)
      if (event.guidance) {
        memoryLines.push(`   作者备注：${event.guidance}`)
      }
    })
  }

  if (input.activeEvents.length > 0) {
    memoryLines.push("")
    memoryLines.push("当前进行中的事件：")
    input.activeEvents.forEach((event, index) => {
      memoryLines.push(`${index + 1}. ${event.content}`)
    })
  }

  pushArchiveSection(memoryLines, "当前直接命中的实体档案：", input.directArchives)
  pushArchiveSection(memoryLines, "当前在场或关键实体档案：", input.presentArchives)

  if (input.selectedEvents.length > 0) {
    memoryLines.push("")
    memoryLines.push("回忆到的相关事件链：")
    input.selectedEvents.forEach((item, index) => {
      memoryLines.push(`${index + 1}. ${item.content}`)
    })
  }

  pushArchiveSection(memoryLines, "回忆事件涉及的实体档案：", input.eventArchives)
  pushArchiveSection(memoryLines, "语义增强命中的实体档案：", input.semanticArchives)
  pushArchiveSection(memoryLines, "桥接关联实体档案：", input.bridgeArchives)

  if (input.hintEntities && input.hintEntities.length > 0) {
    memoryLines.push("")
    memoryLines.push("最近提及但本轮未展开的实体：")
    input.hintEntities.forEach((hint) => {
      memoryLines.push(`- ${hint.name}（${hint.type}）`)
    })
    memoryLines.push("")
    memoryLines.push(
      "说明：你曾在剧情中接触过这些实体，引用时请保持已有事实一致；如不确定，倾向于不展开新细节，不要为之自行编造未确认的属性。",
    )
  }

  return memoryLines.join("\n")
}

function eventArchives(input: {
  selectedEvents: RetrievalCandidateDebugRecord[]
  archives: ArchiveRecord[]
  excludedArchiveIds: Set<string>
}): ArchiveRecord[] {
  const archiveByName = archiveNameMap(input.archives)
  return uniqueArchives(
    input.selectedEvents.flatMap((event) =>
      event.tags.flatMap((tag) => {
        const archive = archiveByName.get(normalizeToken(tag))
        if (!archive || input.excludedArchiveIds.has(archive.id)) {
          return []
        }
        return [archive]
      }),
    ),
  )
}

function archiveDebugRecord(
  archive: ArchiveRecord,
  source: RetrievalArchiveDebugRecord["source"],
  score: number,
): RetrievalArchiveDebugRecord {
  return {
    id: archive.id,
    name: archive.name,
    presence: archive.presence,
    score,
    source,
  }
}

function eventDebugRecordFromEvent(
  event: LocalEventRecord,
  semanticScore: number | null,
): RetrievalCandidateDebugRecord {
  return {
    id: event.id,
    time: event.time,
    status: event.status,
    tags: event.entityTags,
    keywordScore: 0,
    semanticScore,
    finalScore: semanticScore ?? 0,
    selected: true,
    content: event.content,
  }
}

function mergeSelectedEvents(input: {
  structuralEvents: RetrievalCandidateDebugRecord[]
  semanticEvents: EmbeddingMatchRecord[]
  events: LocalEventRecord[]
  settings: BrowserRetrievalSettings
}): RetrievalCandidateDebugRecord[] {
  const selected = [...input.structuralEvents]
  const selectedIds = new Set(selected.map((item) => item.id))
  const eventById = new Map(input.events.map((event) => [event.id, event]))

  for (const semanticEvent of input.semanticEvents) {
    const event = eventById.get(semanticEvent.targetId)
    if (!event) {
      continue
    }
    for (const chained of eventChainForRecord({
      event,
      events: input.events,
      settings: input.settings,
    })) {
      if (selectedIds.has(chained.id) || selected.length >= input.settings.maxInjectedEvents) {
        continue
      }
      selectedIds.add(chained.id)
      selected.push(
        eventDebugRecordFromEvent(
          chained,
          chained.id === semanticEvent.targetId ? semanticEvent.score : null,
        ),
      )
    }
  }

  return selected.sort((left, right) => {
    const timeDiff = parseNarrativeTime(left.time) - parseNarrativeTime(right.time)
    if (timeDiff !== 0) {
      return timeDiff
    }
    return left.id.localeCompare(right.id)
  })
}

function semanticArchives(input: {
  semanticMatches: EmbeddingMatchRecord[]
  archives: ArchiveRecord[]
  excludedArchiveIds: Set<string>
}): ArchiveRecord[] {
  const archiveById = new Map(input.archives.map((archive) => [archive.id, archive]))
  return uniqueArchives(
    input.semanticMatches.flatMap((match) => {
      const archive = archiveById.get(match.targetId)
      if (!archive || input.excludedArchiveIds.has(archive.id)) {
        return []
      }
      return [archive]
    }),
  )
}

export async function assembleRetrievalContext(input: {
  messages: ConversationMessageRecord[]
  userInput: string
  events: LocalEventRecord[]
  catalogEvents?: CatalogEventRecord[]
  activeEvent: LocalEventRecord | null
  activeEvents?: LocalEventRecord[]
  archives: ArchiveRecord[]
  currentTime?: string
  narrativeTimeText?: string
  globals?: RuntimeGlobalsMap
  playerArchiveIds: string[]
  settings?: Partial<BrowserRetrievalSettings>
}): Promise<RetrievalAssemblyResult> {
  const settings = mergeRetrievalSettings(input.settings)
  const activeEvents = input.activeEvents ?? (input.activeEvent ? [input.activeEvent] : [])
  const recentMessages = buildRecentMessages(input.messages, settings)
  const directArchives = selectDirectArchives({
    messages: recentMessages,
    userInput: input.userInput,
    archives: input.archives,
  })
  const presentArchives = selectPresentArchives({
    activeEvents,
    archives: input.archives,
  })
  const catalogCandidates = selectCatalogEventCandidates({
    catalogEvents: input.catalogEvents ?? [],
    currentTime: input.currentTime,
    globals: input.globals,
    userInput: input.userInput,
    recentMessages,
    directArchives,
    presentArchives,
    activeEvents,
    settings,
  })
  const selectedCatalogEvents = catalogCandidates.filter((item) => item.selected)
  const bridgeArchives = selectBridgeArchives({
    directArchives,
    presentArchives,
    archives: input.archives,
    settings,
  })
  const ranked = rankEventsByEntityGraph({
    events: input.events,
    activeEvents,
    directArchives,
    presentArchives,
    bridgeArchives,
    archives: input.archives,
    currentTime: input.currentTime,
    playerArchiveIds: input.playerArchiveIds,
    settings,
  })
  const selectedEvents = selectEventChains({
    ranked,
    events: input.events,
    seedLimit: getSeedLimit({
      directArchives,
      presentArchives,
      activeEvents,
      settings,
    }),
    settings,
  })
  const semantic = await runSemanticRetrieval({
    settings,
    recentMessages,
    userInput: input.userInput,
    events: input.events,
    archives: input.archives,
    currentTime: input.currentTime,
    narrativeTimeText: input.narrativeTimeText,
  })
  const mergedEvents = mergeSelectedEvents({
    structuralEvents: selectedEvents,
    semanticEvents: semantic.events,
    events: input.events,
    settings,
  })
  const baseArchiveIds = new Set(
    [...directArchives, ...presentArchives].map((archive) => archive.id),
  )
  const selectedEventArchives = eventArchives({
    selectedEvents: mergedEvents,
    archives: input.archives,
    excludedArchiveIds: baseArchiveIds,
  })
  const eventArchiveIds = new Set(selectedEventArchives.map((archive) => archive.id))
  const selectedSemanticArchives = semanticArchives({
    semanticMatches: semantic.archives,
    archives: input.archives,
    excludedArchiveIds: new Set([...baseArchiveIds, ...eventArchiveIds]),
  })
  const semanticArchiveIds = new Set(selectedSemanticArchives.map((archive) => archive.id))
  const selectedBridgeArchives = bridgeArchives.filter(
    (archive) =>
      !baseArchiveIds.has(archive.id) &&
      !eventArchiveIds.has(archive.id) &&
      !semanticArchiveIds.has(archive.id),
  )
  const selectedIds = new Set(mergedEvents.map((item) => item.id))
  const semanticScoreByEventId = new Map(
    semantic.events.map((item) => [item.targetId, item.score]),
  )
  const rankedCandidateIds = new Set(ranked.map((item) => item.id))
  const candidates: RetrievalCandidateDebugRecord[] = ranked.map((item) => ({
    ...item,
    semanticScore: semanticScoreByEventId.get(item.id) ?? item.semanticScore,
    finalScore: item.finalScore + (semanticScoreByEventId.get(item.id) ?? 0),
    selected: selectedIds.has(item.id),
  }))
  for (const item of mergedEvents) {
    if (!rankedCandidateIds.has(item.id)) {
      candidates.push(item)
    }
  }
  const archiveHits = [
    ...directArchives.map((archive) => archiveDebugRecord(archive, "direct", 100)),
    ...presentArchives
      .filter((archive) => !directArchives.some((item) => item.id === archive.id))
      .map((archive) => archiveDebugRecord(archive, "present", 90)),
    ...selectedEventArchives.map((archive) => archiveDebugRecord(archive, "event", 80)),
    ...selectedSemanticArchives.map((archive) => archiveDebugRecord(archive, "semantic", 70)),
    ...selectedBridgeArchives.map((archive) => archiveDebugRecord(archive, "bridge", 10)),
  ]

  // AIRP L4 防幻觉提示位：把"被提到但本轮未召回"的实体喂给正文 AI 作温和提示
  const excludedArchiveIds = new Set<string>()
  for (const archive of directArchives) excludedArchiveIds.add(archive.id)
  for (const archive of presentArchives) excludedArchiveIds.add(archive.id)
  for (const archive of selectedEventArchives) excludedArchiveIds.add(archive.id)
  for (const archive of selectedSemanticArchives) excludedArchiveIds.add(archive.id)
  for (const archive of selectedBridgeArchives) excludedArchiveIds.add(archive.id)
  const hintEntities = computeHintEntities({
    recentMessages: input.messages,
    archives: input.archives,
    excludedArchiveIds,
    recencyTurns: settings.hintEntityRecencyTurns,
  })

  return {
    prompt: buildMemoryPrompt({
      currentTime: input.currentTime,
      narrativeTimeText: input.narrativeTimeText,
      globals: input.globals,
      catalogEvents: selectedCatalogEvents,
      activeEvents,
      selectedEvents: mergedEvents,
      directArchives,
      presentArchives: presentArchives.filter(
        (archive) => !directArchives.some((item) => item.id === archive.id),
      ),
      eventArchives: selectedEventArchives,
      semanticArchives: selectedSemanticArchives,
      bridgeArchives: selectedBridgeArchives,
      hintEntities,
    }),
    debug: {
      input: input.userInput,
      settings,
      semantic: {
        enabled: settings.aiEnhanced,
        keywords: semantic.keywords,
        eventIds: semantic.events.map((item) => item.targetId),
        archiveIds: semantic.archives.map((item) => item.targetId),
        error: semantic.error,
      },
      directEntities: directArchives.map((item) => item.name),
      presentEntities: presentArchives.map((item) => item.name),
      linkedEntities: bridgeArchives.map((item) => item.name),
      groups: [],
      candidates,
      archives: archiveHits,
      catalogEvents: catalogCandidates,
      hintEntities,
    },
  }
}



