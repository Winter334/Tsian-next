import type {
  DiagnosticRecord,
  DiagnosticRecordSummary,
  WorkspaceEntry,
  WorkspaceReadResult,
  WorkspaceScope,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from "@tsian/contracts"
import {
  BUILT_IN_READ_ONLY_VIRTUAL_WORKSPACE_PREFIXES,
  type WorkspaceOperationVirtualReadAdapter,
} from "../agent-runtime/workspace-operations"
import {
  getDiagnosticRecord,
  queryDiagnosticRecordSummaries,
  scanDiagnosticRecords,
} from "../storage/diagnostic-records"

export const DIAGNOSTICS_WORKSPACE_ROOT = BUILT_IN_READ_ONLY_VIRTUAL_WORKSPACE_PREFIXES[0]
export const DIAGNOSTICS_INDEX_PATH = `${DIAGNOSTICS_WORKSPACE_ROOT}/index.jsonl`
export const DIAGNOSTICS_REQUESTS_PATH = `${DIAGNOSTICS_WORKSPACE_ROOT}/requests`
export const DIAGNOSTICS_FRONTEND_ERRORS_PATH = `${DIAGNOSTICS_WORKSPACE_ROOT}/frontend-errors`

const DEFAULT_INDEX_LIMIT = 100
const MAX_INDEX_LIMIT = 200
const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const DEFAULT_READ_LIMIT = 2000
const MAX_READ_LIMIT = 5000
const MAX_MATCHES_PER_FILE = 50

interface DiagnosticsWorkspaceDependencies {
  getRecord(id: string): Promise<DiagnosticRecord | undefined>
  querySummaries(input: { offset: number; limit: number }): Promise<{
    items: DiagnosticRecordSummary[]
    hasMore: boolean
  }>
  scanRecords(
    matches: (record: DiagnosticRecord) => boolean,
    limit: number,
  ): Promise<DiagnosticRecord[]>
}

const defaultDependencies: DiagnosticsWorkspaceDependencies = {
  getRecord: getDiagnosticRecord,
  querySummaries: queryDiagnosticRecordSummaries,
  scanRecords: scanDiagnosticRecords,
}

function supportsScope(scope: WorkspaceScope): boolean {
  return scope === "effective" || scope === "platform-meta"
}

function isDiagnosticsPath(path: string): boolean {
  return path === DIAGNOSTICS_WORKSPACE_ROOT
    || path.startsWith(`${DIAGNOSTICS_WORKSPACE_ROOT}/`)
}

function directory(path: string, name: string, childCount?: number): WorkspaceEntry {
  return {
    path,
    name,
    kind: "directory",
    ...(childCount === undefined ? {} : { childCount }),
  }
}

function staticList(path: string): WorkspaceEntry[] | undefined {
  if (path === "") return [directory(".tsian", ".tsian")]
  if (path === ".tsian") return [directory(".tsian/local", "local")]
  if (path === ".tsian/local") return [directory(DIAGNOSTICS_WORKSPACE_ROOT, "diagnostics", 3)]
  if (path === DIAGNOSTICS_WORKSPACE_ROOT) {
    return [
      directory(DIAGNOSTICS_FRONTEND_ERRORS_PATH, "frontend-errors"),
      directory(DIAGNOSTICS_REQUESTS_PATH, "requests"),
      {
        path: DIAGNOSTICS_INDEX_PATH,
        name: "index.jsonl",
        kind: "file",
      },
    ]
  }
  if (path === DIAGNOSTICS_REQUESTS_PATH || path === DIAGNOSTICS_FRONTEND_ERRORS_PATH) {
    // IDs are discovered through the paged index; listing this directory must
    // not enumerate retained full-body records or fabricate an unpaged result.
    return []
  }
  return undefined
}

function positiveInteger(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(max, Math.floor(value))
}

function readOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return 1
  return Math.floor(value)
}

function sliceTextRead(input: {
  path: string
  content: string
  createdAt: number
  updatedAt: number
  offset?: number
  limit?: number
}): WorkspaceReadResult {
  const lines = input.content.split("\n")
  const totalLines = lines.length
  if (input.offset === undefined && input.limit === undefined) {
    return {
      path: input.path,
      content: input.content,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      totalLines,
      returnedLines: totalLines,
      offset: 1,
      truncated: false,
    }
  }
  const offset = readOffset(input.offset)
  const limit = positiveInteger(input.limit, DEFAULT_READ_LIMIT, MAX_READ_LIMIT)
  const selected = offset > totalLines ? [] : lines.slice(offset - 1, offset - 1 + limit)
  return {
    path: input.path,
    content: selected.join("\n"),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    totalLines,
    returnedLines: selected.length,
    offset,
    truncated: offset + limit - 1 < totalLines,
  }
}

function recordPath(record: DiagnosticRecord): string {
  return record.recordType === "ai-request"
    ? `${DIAGNOSTICS_REQUESTS_PATH}/${record.id}.json`
    : `${DIAGNOSTICS_FRONTEND_ERRORS_PATH}/${record.id}.json`
}

function idFromPath(path: string, directoryPath: string): string | undefined {
  const prefix = `${directoryPath}/`
  if (!path.startsWith(prefix) || !path.endsWith(".json")) return undefined
  const id = path.slice(prefix.length, -".json".length)
  return id && !id.includes("/") ? id : undefined
}

function notFound(path: string): never {
  throw {
    code: "WORKSPACE_FILE_NOT_FOUND",
    message: `Diagnostic workspace file was not found: ${path}`,
    details: { scope: "platform-meta", path },
  }
}

function createPreview(content: string, index: number): string {
  if (index < 0) return ""
  const start = Math.max(0, index - 48)
  const end = Math.min(content.length, index + 96)
  return `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`
    .replace(/\s+/g, " ")
    .trim()
}

function searchMatches(
  content: string,
  matcher: (line: string) => string | null,
  contextLines: number,
): { matches: WorkspaceSearchMatch[]; truncated: boolean } {
  const lines = content.split("\n")
  const matches: WorkspaceSearchMatch[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const match = matcher(lines[index])
    if (match === null) continue
    if (matches.length >= MAX_MATCHES_PER_FILE) return { matches, truncated: true }
    matches.push({
      lineNumber: index + 1,
      line: lines[index],
      contextBefore: lines.slice(Math.max(0, index - contextLines), index),
      contextAfter: lines.slice(index + 1, index + 1 + contextLines),
      match,
    })
  }
  return { matches, truncated: false }
}

export function createDiagnosticsWorkspaceAdapter(
  dependencies: DiagnosticsWorkspaceDependencies = defaultDependencies,
): WorkspaceOperationVirtualReadAdapter {
  return {
    readonlyPathPrefixes: [DIAGNOSTICS_WORKSPACE_ROOT],
    list({ scope, path, actorLevel }) {
      if (!supportsScope(scope) || actorLevel < 4) return undefined
      const entries = staticList(path)
      if (entries !== undefined) return { path, entries }
      // The reserved namespace is authoritative even for an unknown child;
      // never fall back to a colliding eager WorkspaceFile snapshot.
      return isDiagnosticsPath(path) ? { path, entries: [] } : undefined
    },
    async read({ scope, path, actorLevel, offset, limit }) {
      if (!supportsScope(scope) || actorLevel < 4) return undefined
      if (!isDiagnosticsPath(path)) return undefined
      if (path === DIAGNOSTICS_INDEX_PATH) {
        const normalizedOffset = readOffset(offset)
        const normalizedLimit = positiveInteger(limit, DEFAULT_INDEX_LIMIT, MAX_INDEX_LIMIT)
        const page = await dependencies.querySummaries({
          offset: normalizedOffset - 1,
          limit: normalizedLimit,
        })
        const content = page.items.map((summary) => JSON.stringify(summary)).join("\n")
        const updatedAt = page.items.reduce(
          (latest, summary) => Math.max(latest, summary.updatedAt),
          0,
        )
        return {
          path,
          content,
          createdAt: updatedAt,
          updatedAt,
          returnedLines: page.items.length,
          offset: normalizedOffset,
          truncated: page.hasMore,
        }
      }

      const requestId = idFromPath(path, DIAGNOSTICS_REQUESTS_PATH)
      const errorId = idFromPath(path, DIAGNOSTICS_FRONTEND_ERRORS_PATH)
      if (!requestId && !errorId) return notFound(path)
      const record = await dependencies.getRecord(requestId ?? errorId!)
      if (!record) return notFound(path)
      if (requestId && record.recordType !== "ai-request") return notFound(path)
      if (errorId && record.recordType !== "frontend-error") return notFound(path)
      return sliceTextRead({
        path,
        content: JSON.stringify(record, null, 2),
        createdAt: record.timestamp,
        updatedAt: record.updatedAt,
        offset,
        limit,
      })
    },
    async search({ scope, request, actorLevel }) {
      if (!supportsScope(scope) || actorLevel < 4) return undefined
      const query = typeof request.query === "string" ? request.query.trim() : ""
      const pattern = typeof request.pattern === "string" ? request.pattern.trim() : ""
      if (!query && !pattern) return []
      const ignoreCase = typeof request.ignoreCase === "boolean"
        ? request.ignoreCase
        : !pattern
      const regex = pattern ? new RegExp(pattern, ignoreCase ? "i" : "") : undefined
      const queryComparable = ignoreCase ? query.toLocaleLowerCase() : query
      const contextLines = typeof request.contextLines === "number"
        && Number.isFinite(request.contextLines)
        && request.contextLines >= 0
        ? Math.floor(request.contextLines)
        : 0
      const limit = positiveInteger(request.limit, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)
      const matchLine = (line: string): string | null => {
        if (regex) return line.match(regex)?.[0] ?? null
        const comparable = ignoreCase ? line.toLocaleLowerCase() : line
        const index = comparable.indexOf(queryComparable)
        return index >= 0 ? line.slice(index, index + query.length) : null
      }
      const matchesPath = (path: string): boolean => {
        if (regex) return regex.test(path)
        const comparable = ignoreCase ? path.toLocaleLowerCase() : path
        return comparable.includes(queryComparable)
      }
      const matched = new Map<string, WorkspaceSearchResult>()
      await dependencies.scanRecords((record) => {
        const path = recordPath(record)
        const content = JSON.stringify(record, null, 2)
        const pathMatched = matchesPath(path)
        const contentMatches = searchMatches(content, matchLine, contextLines)
        if (!pathMatched && contentMatches.matches.length === 0) return false
        const firstMatch = contentMatches.matches[0]
        matched.set(record.id, {
          path,
          name: `${record.id}.json`,
          updatedAt: record.updatedAt,
          score: (pathMatched ? 2 : 0) + (firstMatch ? 1 : 0),
          matches: contentMatches.matches,
          matchesTruncated: contentMatches.truncated,
          preview: firstMatch
            ? createPreview(firstMatch.line, firstMatch.line.indexOf(firstMatch.match))
            : path,
        })
        return true
      }, limit)
      return [...matched.values()].sort((left, right) =>
        right.score - left.score
        || right.updatedAt - left.updatedAt
        || left.path.localeCompare(right.path)
      )
    },
  }
}
