import type {
  JsonValue,
  RuntimeDiagnosticFact,
  RuntimeDiagnosticHealth,
  RuntimeDiagnosticsQueryParams,
  RuntimeDiagnosticSeverity,
  RuntimeDiagnosticSource,
  RuntimeDiagnosticSummary,
  RuntimeDiagnosticTraceKind,
  WorkspaceFile,
} from "@tsian/contracts"
import type { RuntimeTraceDebugLabel, RuntimeTraceEventType } from "./trace"
import { summarizeTraceValue } from "./trace"

const DIAGNOSTIC_SCHEMA = "tsian.runtime.diagnostic.v1"
const TRACE_TURN_PATH_PATTERN = /^\.tsian\/save\/traces\/turns\/turn-(\d+)(?:-failed-(\d+))?\.jsonl$/
const DEFAULT_LOOKBACK_TURNS = 20
const MAX_LOOKBACK_TURNS = 200
const DEFAULT_RESULT_LIMIT = 10
const MAX_RESULT_LIMIT = 50
const FACT_LIMIT = 12
const RELATED_PATH_LIMIT = 12
const MESSAGE_PREVIEW_LIMIT = 240

interface TraceFileCandidate {
  file: WorkspaceFile
  turn: number
  traceKind: RuntimeDiagnosticTraceKind
  failedAt?: number
}

interface TraceEventShape {
  type: string
  timestamp: number
  turn: number
  agentId?: string
  debugLabel?: RuntimeTraceDebugLabel | string
  ok?: boolean
  data?: Record<string, JsonValue>
}

interface ParsedTraceFile {
  events: TraceEventShape[]
  malformedLineCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asNumber(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback
  }

  return Math.min(Math.floor(value), max)
}

function normalizeTurn(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return Math.floor(value)
}

function parseTraceFileCandidate(file: WorkspaceFile): TraceFileCandidate | null {
  const match = TRACE_TURN_PATH_PATTERN.exec(file.path)
  if (!match) {
    return null
  }

  const turn = Number(match[1])
  if (!Number.isInteger(turn) || turn <= 0) {
    return null
  }

  const failedAt = match[2] === undefined ? undefined : Number(match[2])
  return {
    file,
    turn,
    traceKind: failedAt === undefined ? "success" : "failed",
    ...(Number.isFinite(failedAt) ? { failedAt } : {}),
  }
}

function parseTraceLine(line: string, fallbackTurn: number): TraceEventShape | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null
  }

  const timestamp = typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp)
    ? parsed.timestamp
    : 0
  const turn = typeof parsed.turn === "number" && Number.isFinite(parsed.turn)
    ? Math.floor(parsed.turn)
    : fallbackTurn
  const data = isRecord(parsed.data)
    ? Object.fromEntries(
        Object.entries(parsed.data).filter(([, value]) => value !== undefined),
      ) as Record<string, JsonValue>
    : undefined

  return {
    type: parsed.type,
    timestamp,
    turn,
    ...(typeof parsed.agentId === "string" ? { agentId: parsed.agentId } : {}),
    ...(typeof parsed.debugLabel === "string" ? { debugLabel: parsed.debugLabel } : {}),
    ...(typeof parsed.ok === "boolean" ? { ok: parsed.ok } : {}),
    ...(data ? { data } : {}),
  }
}

function parseTraceFileContent(content: string, fallbackTurn: number): ParsedTraceFile {
  const events: TraceEventShape[] = []
  let malformedLineCount = 0

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    const event = parseTraceLine(line, fallbackTurn)
    if (event) {
      events.push(event)
    } else {
      malformedLineCount += 1
    }
  }

  return { events, malformedLineCount }
}

function eventSource(type: string): RuntimeDiagnosticSource {
  if (type.startsWith("turn_")) return "turn"
  if (type.startsWith("agent_step_")) return "agent"
  if (type === "model_call_completed") return "model"
  if (type === "skill_loaded") return "skill"
  if (type === "agent_called") return "agent_call"
  if (type === "workspace_tool_called" || type === "workspace_mutation") return "workspace"
  if (type === "action_executor_policy_checked" || type === "action_called") return "action"
  if (type === "script_log") return "script"
  if (
    type === "agent_context_staged"
    || type === "context_compressed"
    || type === "context_compression_failed"
  ) {
    return "session"
  }
  return "trace"
}

function eventSeverity(event: TraceEventShape): RuntimeDiagnosticSeverity {
  if (event.ok === false || event.type.endsWith("_failed")) {
    return "error"
  }

  const data = event.data
  const level = isJsonRecord(data) ? asString(data.level) : undefined
  if (event.type === "script_log" && level) {
    if (level === "error") return "error"
    if (level === "warn" || level === "warning") return "warning"
  }

  const declarationErrorCount = isJsonRecord(data)
    ? asNumber(data.declarationErrorCount)
    : undefined
  if (event.type === "skill_loaded" && declarationErrorCount && declarationErrorCount > 0) {
    return "warning"
  }

  return "info"
}

function shouldKeepFact(event: TraceEventShape): boolean {
  return eventSeverity(event) !== "info"
}

function truncateMessage(message: string | undefined): string | undefined {
  if (!message) {
    return undefined
  }

  return message.length > MESSAGE_PREVIEW_LIMIT
    ? message.slice(0, MESSAGE_PREVIEW_LIMIT)
    : message
}

function nestedError(data: Record<string, JsonValue>): Record<string, JsonValue> | undefined {
  const error = data.error
  return isJsonRecord(error) ? error : undefined
}

function errorCode(data: Record<string, JsonValue>): string | undefined {
  return asString(data.code) ?? asString(nestedError(data)?.code)
}

function errorMessage(data: Record<string, JsonValue>): string | undefined {
  return truncateMessage(
    asString(data.message)
      ?? asString(nestedError(data)?.message)
      ?? asString(data.error)
      ?? asString(data.messagePreview),
  )
}

function detailsSummary(data: Record<string, JsonValue>): Record<string, JsonValue> | undefined {
  const error = nestedError(data)
  const details = isJsonRecord(error?.details)
    ? error.details
    : isJsonRecord(data.details)
      ? data.details
      : undefined

  if (details) {
    return summarizeTraceValue(details)
  }

  if (error) {
    return summarizeTraceValue(error)
  }

  return undefined
}

function nestedName(
  data: Record<string, JsonValue>,
  key: "skill" | "action",
): string | undefined {
  const value = data[key]
  if (typeof value === "string") {
    return value
  }
  return isJsonRecord(value) ? asString(value.name) : undefined
}

function executorLabel(value: JsonValue | undefined): string | undefined {
  if (!isJsonRecord(value)) {
    return undefined
  }

  const type = asString(value.type)
  const name = asString(value.name) ?? asString(value.path)
  if (type && name) return `${type}/${name}`
  return type
}

function normalizeRelatedPath(path: string | undefined): string | null {
  const normalized = path?.trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (!normalized || normalized === ".tsian" || normalized.startsWith(".tsian/")) {
    return null
  }

  return normalized
}

function addRelatedPath(paths: Set<string>, path: string | undefined): void {
  const normalized = normalizeRelatedPath(path)
  if (normalized && paths.size < RELATED_PATH_LIMIT) {
    paths.add(normalized)
  }
}

function addRelatedPaths(paths: Set<string>, value: JsonValue | undefined): void {
  if (!Array.isArray(value)) {
    return
  }

  for (const item of value) {
    if (typeof item === "string") {
      addRelatedPath(paths, item)
    } else if (isJsonRecord(item)) {
      addRelatedPath(paths, asString(item.path))
    }
  }
}

function addDirectRelatedPaths(paths: Set<string>, value: JsonValue | undefined): void {
  if (!isJsonRecord(value)) {
    return
  }

  addRelatedPath(paths, asString(value.path))
  addRelatedPath(paths, asString(value.scriptPath))
  addRelatedPath(paths, asString(value.skillPath))
  addRelatedPath(paths, asString(value.agentPath))
  addRelatedPaths(paths, value.deletedPaths)
  addRelatedPaths(paths, value.files)

  const skill = isJsonRecord(value.skill) ? value.skill : undefined
  addRelatedPath(paths, asString(skill?.path))

  const file = isJsonRecord(value.file) ? value.file : undefined
  addRelatedPath(paths, asString(file?.path))

  const error = isJsonRecord(value.error) ? value.error : undefined
  const details = isJsonRecord(error?.details) ? error.details : undefined
  addDirectRelatedPaths(paths, details)
}

function relatedPathsForEvent(event: TraceEventShape): string[] {
  const paths = new Set<string>()
  if (event.agentId) {
    addRelatedPath(paths, `agents/${event.agentId}/AGENT.md`)
  }
  addDirectRelatedPaths(paths, event.data)
  return Array.from(paths)
}

function factFromEvent(event: TraceEventShape): RuntimeDiagnosticFact | null {
  if (!shouldKeepFact(event)) {
    return null
  }

  const data = event.data ?? {}
  const code = errorCode(data)
  const message = errorMessage(data)
  const summary = detailsSummary(data)
  const skill = nestedName(data, "skill")
  const action = nestedName(data, "action")
  const tool = asString(data.tool)
  const executor = executorLabel(data.executor)

  return {
    source: eventSource(event.type),
    eventType: event.type,
    severity: eventSeverity(event),
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
    ...(event.ok !== undefined ? { ok: event.ok } : {}),
    ...(event.agentId ? { agentId: event.agentId } : {}),
    ...(event.debugLabel ? { debugLabel: event.debugLabel } : {}),
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(summary ? { detailsSummary: summary } : {}),
    ...(skill ? { skill } : {}),
    ...(action ? { action } : {}),
    ...(tool ? { tool } : {}),
    ...(executor ? { executor } : {}),
    relatedPaths: relatedPathsForEvent(event),
  }
}

function malformedTraceFact(malformedLineCount: number, updatedAt: number): RuntimeDiagnosticFact {
  return {
    source: "trace",
    severity: "warning",
    eventType: "trace_parse",
    timestamp: updatedAt,
    code: "TRACE_JSONL_MALFORMED",
    message: "Trace file contains malformed JSONL lines.",
    detailsSummary: summarizeTraceValue({ malformedLineCount }),
    relatedPaths: [],
  }
}

function compareFactSeverity(left: RuntimeDiagnosticFact, right: RuntimeDiagnosticFact): number {
  const rank: Record<RuntimeDiagnosticSeverity, number> = {
    error: 0,
    warning: 1,
    info: 2,
  }
  const severityDelta = rank[left.severity] - rank[right.severity]
  if (severityDelta !== 0) {
    return severityDelta
  }
  return (left.timestamp ?? 0) - (right.timestamp ?? 0)
}

function addSetValue(values: Set<string>, value: string | undefined): void {
  if (value) {
    values.add(value)
  }
}

function limitedSorted(values: Set<string>): string[] {
  return Array.from(values).sort().slice(0, RELATED_PATH_LIMIT)
}

function buildHealth(events: TraceEventShape[], facts: RuntimeDiagnosticFact[]): RuntimeDiagnosticHealth {
  const agentIds = new Set<string>()
  const skillNames = new Set<string>()
  const actionNames = new Set<string>()
  const workspaceMutationPaths = new Set<string>()
  let modelCallCount = 0
  let workspaceToolCallCount = 0
  let actionCallCount = 0
  let agentCallCount = 0
  let scriptLogCount = 0
  let workspaceMutationCount = 0

  for (const event of events) {
    const data = event.data ?? {}
    addSetValue(agentIds, event.agentId)
    addSetValue(agentIds, asString(data.targetAgentId))
    addSetValue(skillNames, nestedName(data, "skill"))
    addSetValue(actionNames, nestedName(data, "action"))

    if (event.type === "model_call_completed") modelCallCount += 1
    if (event.type === "workspace_tool_called") workspaceToolCallCount += 1
    if (event.type === "action_called") actionCallCount += 1
    if (event.type === "agent_called") agentCallCount += 1
    if (event.type === "script_log") scriptLogCount += 1
    if (event.type === "workspace_mutation") {
      workspaceMutationCount += 1
      for (const path of relatedPathsForEvent(event)) {
        workspaceMutationPaths.add(path)
      }
    }
  }

  return {
    agentIds: limitedSorted(agentIds),
    skillNames: limitedSorted(skillNames),
    actionNames: limitedSorted(actionNames),
    workspaceMutationPaths: limitedSorted(workspaceMutationPaths),
    modelCallCount,
    workspaceToolCallCount,
    actionCallCount,
    agentCallCount,
    scriptLogCount,
    workspaceMutationCount,
    warningCount: facts.filter((fact) => fact.severity === "warning").length,
    errorCount: facts.filter((fact) => fact.severity === "error").length,
  }
}

function summaryStatus(
  traceKind: RuntimeDiagnosticTraceKind,
  events: TraceEventShape[],
  facts: RuntimeDiagnosticFact[],
): RuntimeDiagnosticSummary["status"] {
  if (traceKind === "failed" || events.some((event) => event.type === "turn_failed")) {
    return "failed"
  }

  if (facts.some((fact) => fact.severity !== "info")) {
    return "anomalous"
  }

  return "completed"
}

function summarySeverity(
  status: RuntimeDiagnosticSummary["status"],
  facts: RuntimeDiagnosticFact[],
): RuntimeDiagnosticSeverity {
  if (status === "failed" || facts.some((fact) => fact.severity === "error")) {
    return "error"
  }
  if (facts.some((fact) => fact.severity === "warning")) {
    return "warning"
  }
  return "info"
}

function eventTimestamp(events: TraceEventShape[], type: RuntimeTraceEventType): number | undefined {
  return events.find((event) => event.type === type)?.timestamp
}

function lastEventTimestamp(events: TraceEventShape[]): number | undefined {
  const timestamps = events
    .map((event) => event.timestamp)
    .filter((timestamp) => timestamp > 0)
  return timestamps.length ? Math.max(...timestamps) : undefined
}

function buildDiagnosticSummary(
  candidate: TraceFileCandidate,
  includeHealth: boolean,
  exactTurn: boolean,
): RuntimeDiagnosticSummary {
  const parsed = parseTraceFileContent(candidate.file.content, candidate.turn)
  const eventFacts = parsed.events
    .map(factFromEvent)
    .filter((fact): fact is RuntimeDiagnosticFact => fact !== null)
  const allFacts = [
    ...(parsed.malformedLineCount
      ? [malformedTraceFact(parsed.malformedLineCount, candidate.file.updatedAt)]
      : []),
    ...eventFacts,
  ].sort(compareFactSeverity)
  const facts = allFacts.slice(0, FACT_LIMIT)
  const status = summaryStatus(candidate.traceKind, parsed.events, allFacts)
  const shouldIncludeHealth = includeHealth || exactTurn || status !== "completed"

  return {
    schema: DIAGNOSTIC_SCHEMA,
    turn: candidate.turn,
    status,
    severity: summarySeverity(status, allFacts),
    traceKind: candidate.traceKind,
    startedAt: eventTimestamp(parsed.events, "turn_started"),
    endedAt: eventTimestamp(parsed.events, status === "failed" ? "turn_failed" : "turn_completed")
      ?? lastEventTimestamp(parsed.events),
    updatedAt: candidate.file.updatedAt,
    eventCount: parsed.events.length,
    malformedLineCount: parsed.malformedLineCount,
    omittedFactCount: Math.max(0, allFacts.length - facts.length),
    ...(shouldIncludeHealth ? { health: buildHealth(parsed.events, allFacts) } : {}),
    facts,
  }
}

function traceCandidates(workspaceFiles: WorkspaceFile[]): TraceFileCandidate[] {
  return workspaceFiles
    .map(parseTraceFileCandidate)
    .filter((candidate): candidate is TraceFileCandidate => candidate !== null)
    .sort((left, right) => {
      if (right.turn !== left.turn) return right.turn - left.turn
      if (right.file.updatedAt !== left.file.updatedAt) {
        return right.file.updatedAt - left.file.updatedAt
      }
      const leftTraceRank = left.traceKind === "failed" ? 0 : 1
      const rightTraceRank = right.traceKind === "failed" ? 0 : 1
      return leftTraceRank - rightTraceRank
    })
}

function windowCandidates(
  candidates: TraceFileCandidate[],
  params: RuntimeDiagnosticsQueryParams,
): TraceFileCandidate[] {
  const turn = normalizeTurn(params.turn)
  if (turn !== undefined) {
    return candidates.filter((candidate) => candidate.turn === turn)
  }

  const lookbackTurns = normalizePositiveInteger(
    params.lookbackTurns,
    DEFAULT_LOOKBACK_TURNS,
    MAX_LOOKBACK_TURNS,
  )
  const latestTurn = candidates[0]?.turn
  if (latestTurn === undefined) {
    return []
  }

  const oldestTurn = Math.max(1, latestTurn - lookbackTurns + 1)
  return candidates.filter((candidate) => candidate.turn >= oldestTurn)
}

export function buildRuntimeDiagnostics(
  workspaceFiles: WorkspaceFile[],
  params: RuntimeDiagnosticsQueryParams = {},
): RuntimeDiagnosticSummary[] {
  const turn = normalizeTurn(params.turn)
  const includeHealth = params.includeHealth === true
  const limit = normalizePositiveInteger(params.limit, DEFAULT_RESULT_LIMIT, MAX_RESULT_LIMIT)
  const candidates = windowCandidates(traceCandidates(workspaceFiles), {
    ...params,
    turn,
  })

  return candidates
    .map((candidate) => buildDiagnosticSummary(candidate, includeHealth, turn !== undefined))
    .filter((summary) => (
      summary.status !== "completed"
      || includeHealth
      || turn !== undefined
    ))
    .slice(0, limit)
}

// ─── trace events 加载（DebugView 运行日志浏览器用）─────────────────────────
// diagnostics 的 summary 是聚合视图；这里导出原始 events 供 formatTraceForHuman 渲染。
// 复用 parseTraceFileContent（同一解析逻辑），不重复实现。

export interface RuntimeTraceEventLoadout {
  turn: number
  traceKind: RuntimeDiagnosticTraceKind
  failedAt?: number
  events: TraceEventShape[]
  malformedLineCount: number
}

/** 从 effective workspace 文件里加载 trace events。
 *  turn 省略 → 返回全部 trace 回合（按 turn 倒序）；指定 turn → 只返回该回合。
 *  events 与 RuntimeTraceEvent 结构兼容（type/timestamp/turn/agentId/debugLabel/ok/data）。 */
export function loadRuntimeTraceEvents(
  workspaceFiles: WorkspaceFile[],
  turn?: number,
): RuntimeTraceEventLoadout[] {
  const targetTurn = normalizeTurn(turn)
  const candidates = traceCandidates(workspaceFiles)
  const filtered = targetTurn !== undefined
    ? candidates.filter((candidate) => candidate.turn === targetTurn)
    : candidates
  return filtered.map((candidate) => {
    const parsed = parseTraceFileContent(candidate.file.content, candidate.turn)
    return {
      turn: candidate.turn,
      traceKind: candidate.traceKind,
      ...(candidate.failedAt !== undefined ? { failedAt: candidate.failedAt } : {}),
      events: parsed.events,
      malformedLineCount: parsed.malformedLineCount,
    }
  })
}
