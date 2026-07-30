import type {
  DiagnosticRecordQuery,
  DiagnosticRecordsChange,
  DiagnosticRecordSummary,
  DiagnosticTraceFacets,
  DiagnosticTraceOverview,
} from "@tsian/contracts"
import {
  getAllDiagnosticRecordSummaries,
  getDiagnosticRecord,
  getDiagnosticRecordSummaries,
  queryDiagnosticRecordSummaries,
  subscribeDiagnosticRecords,
} from "../storage/diagnostic-records"
import {
  getDiagnosticStoreHealth,
  subscribeDiagnosticStoreHealth,
} from "../runtime-host/ai/trace-recorder"

interface DiagnosticAggregateSnapshot {
  facets: DiagnosticTraceFacets
  overview: DiagnosticTraceOverview
}

let summaryCache: Map<string, DiagnosticRecordSummary> | null = null
let summaryCacheLoad: Promise<Map<string, DiagnosticRecordSummary>> | null = null
let summaryCacheUpdates: Promise<void> = Promise.resolve()
let aggregateSnapshot: DiagnosticAggregateSnapshot | null = null

function queueSummaryCacheChange(change: DiagnosticRecordsChange): void {
  if ((!summaryCache && !summaryCacheLoad) || change.type === "health") return
  const pendingLoad = summaryCacheLoad
  summaryCacheUpdates = summaryCacheUpdates.catch(() => undefined).then(async () => {
    const cache = summaryCache ?? await pendingLoad
    if (!cache) return
    if (change.type === "delete") {
      for (const id of change.ids) cache.delete(id)
    } else {
      const summaries = await getDiagnosticRecordSummaries(change.ids)
      const foundIds = new Set(summaries.map((summary) => summary.id))
      for (const id of change.ids) {
        if (!foundIds.has(id)) cache.delete(id)
      }
      for (const summary of summaries) cache.set(summary.id, summary)
    }
    aggregateSnapshot = null
  }, () => undefined)
}

subscribeDiagnosticRecords(queueSummaryCacheChange)

async function getSummaryCache(): Promise<Map<string, DiagnosticRecordSummary>> {
  if (!summaryCache && !summaryCacheLoad) {
    const load = getAllDiagnosticRecordSummaries().then((summaries) => {
      summaryCache = new Map(summaries.map((summary) => [summary.id, summary]))
      return summaryCache
    })
    summaryCacheLoad = load
    void load.then(() => {
      if (summaryCacheLoad === load) summaryCacheLoad = null
    }, () => {
      if (summaryCacheLoad === load) summaryCacheLoad = null
    })
  }
  if (summaryCacheLoad) await summaryCacheLoad
  await summaryCacheUpdates
  return summaryCache ?? new Map()
}

export function buildDiagnosticFacets(
  summaries: Iterable<DiagnosticRecordSummary>,
): DiagnosticTraceFacets {
  const providers = new Set<string>()
  const models = new Set<string>()
  let fromTimestamp: number | undefined
  let toTimestamp: number | undefined
  for (const summary of summaries) {
    if (summary.provider) providers.add(summary.provider)
    if (summary.model) models.add(summary.model)
    fromTimestamp = fromTimestamp === undefined
      ? summary.timestamp
      : Math.min(fromTimestamp, summary.timestamp)
    toTimestamp = toTimestamp === undefined
      ? summary.timestamp
      : Math.max(toTimestamp, summary.timestamp)
  }
  return {
    providers: [...providers].sort((left, right) => left.localeCompare(right)),
    models: [...models].sort((left, right) => left.localeCompare(right)),
    ...(fromTimestamp !== undefined ? { fromTimestamp } : {}),
    ...(toTimestamp !== undefined ? { toTimestamp } : {}),
  }
}

export async function getDiagnosticFacets(): Promise<DiagnosticTraceFacets> {
  return (await getAggregateSnapshot()).facets
}

export function buildDiagnosticOverview(
  summaries: Iterable<DiagnosticRecordSummary>,
): DiagnosticTraceOverview {
  const overview: DiagnosticTraceOverview = {
    totalRecords: 0,
    aiRequestCount: 0,
    frontendErrorCount: 0,
    succeededCount: 0,
    failedCount: 0,
    abortedCount: 0,
    runningCount: 0,
    interruptedCount: 0,
    retriedRequestCount: 0,
    usage: { input: 0, output: 0, total: 0, cached: 0, cacheCreation: 0 },
    providers: [],
  }
  const providerGroups = new Map<string, DiagnosticTraceOverview["providers"][number]>()

  for (const summary of summaries) {
    overview.totalRecords += 1
    if (summary.recordType === "frontend-error") {
      overview.frontendErrorCount += 1
      if (
        overview.latestFailureTimestamp === undefined
        || summary.timestamp > overview.latestFailureTimestamp
      ) {
        overview.latestFailureId = summary.id
        overview.latestFailureTimestamp = summary.timestamp
      }
      continue
    }

    overview.aiRequestCount += 1
    if (summary.status === "succeeded") overview.succeededCount += 1
    if (summary.status === "failed") overview.failedCount += 1
    if (summary.status === "aborted") overview.abortedCount += 1
    if (summary.status === "running") overview.runningCount += 1
    if (summary.status === "interrupted") overview.interruptedCount += 1
    if ((summary.retryCount ?? 0) > 0) overview.retriedRequestCount += 1
    if (
      (summary.status === "failed" || summary.status === "interrupted")
      && (
        overview.latestFailureTimestamp === undefined
        || summary.timestamp > overview.latestFailureTimestamp
      )
    ) {
      overview.latestFailureId = summary.id
      overview.latestFailureTimestamp = summary.timestamp
    }

    const usage = summary.usage
    if (usage) {
      overview.usage.input += usage.input ?? 0
      overview.usage.output += usage.output ?? 0
      overview.usage.total += usage.total ?? ((usage.input ?? 0) + (usage.output ?? 0))
      overview.usage.cached += usage.cached ?? 0
      overview.usage.cacheCreation += usage.cacheCreation ?? 0
      if (!overview.latestUsage || summary.timestamp > overview.latestUsage.timestamp) {
        overview.latestUsage = {
          timestamp: summary.timestamp,
          provider: summary.provider ?? "unknown",
          model: summary.model ?? "unknown",
          usage: { ...usage },
        }
      }
    }

    const provider = summary.provider ?? "unknown"
    const model = summary.model ?? "unknown"
    const key = `${provider}\u0000${model}`
    const group = providerGroups.get(key) ?? {
      provider,
      model,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      cacheCreationTokens: 0,
    }
    group.calls += 1
    group.inputTokens += usage?.input ?? 0
    group.outputTokens += usage?.output ?? 0
    group.cachedTokens += usage?.cached ?? 0
    group.cacheCreationTokens += usage?.cacheCreation ?? 0
    providerGroups.set(key, group)
  }

  overview.providers = [...providerGroups.values()].sort((left, right) =>
    right.calls - left.calls
    || left.provider.localeCompare(right.provider)
    || left.model.localeCompare(right.model))
  return overview
}

export async function getDiagnosticOverview(): Promise<DiagnosticTraceOverview> {
  return (await getAggregateSnapshot()).overview
}

async function getAggregateSnapshot(): Promise<DiagnosticAggregateSnapshot> {
  const summaries = await getSummaryCache()
  aggregateSnapshot ??= {
    facets: buildDiagnosticFacets(summaries.values()),
    overview: buildDiagnosticOverview(summaries.values()),
  }
  return aggregateSnapshot
}

export function queryDiagnosticSummaries(query: DiagnosticRecordQuery = {}) {
  return queryDiagnosticRecordSummaries(query)
}

export async function readDiagnosticRecord(id: string) {
  return (await getDiagnosticRecord(id)) ?? null
}

export function readDiagnosticStoreHealth() {
  return getDiagnosticStoreHealth()
}

export function subscribeDiagnosticChanges(
  listener: (change: DiagnosticRecordsChange) => void,
): () => void {
  const unsubscribeRecords = subscribeDiagnosticRecords((change) => listener(change))
  const unsubscribeHealth = subscribeDiagnosticStoreHealth(() => listener({ type: "health", ids: [] }))
  return () => {
    unsubscribeRecords()
    unsubscribeHealth()
  }
}
