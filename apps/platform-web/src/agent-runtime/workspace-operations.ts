import type {
  AgentContextEntry,
  WorkspaceCopyResult,
  WorkspaceDeleteResult,
  WorkspaceDiffResult,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceGlobResult,
  WorkspaceMoveResult,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspaceWriteResult,
  WorkspaceReadResult,
  WorkspaceScope,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
  WorkspaceValidationResult,
} from "@tsian/contracts"
import { normalizeWorkspacePath } from "@/lib/workspace-path"
import { semanticSearch } from "./semantic-index/search"

// barrel re-export (public API)
export type {
  WorkspaceOperationError,
  WorkspaceOperationMutationAdapter,
  WorkspaceOperationExecutionContext,
} from "./workspace-operations-types"
export {
  WORKSPACE_OPERATION_NAMES,
  DEFAULT_RUNTIME_WORKSPACE_OPERATIONS,
  AUTHORING_WORKSPACE_OPERATIONS,
} from "./workspace-operations-types"
// import for internal use (local binding)
import {
  WORKSPACE_OPERATION_NAMES,
  DEFAULT_RUNTIME_WORKSPACE_OPERATIONS,
  AUTHORING_WORKSPACE_OPERATIONS,
} from "./workspace-operations-types"
import type {
  WorkspaceOperationError,
  WorkspaceOperationMutationAdapter,
  WorkspaceOperationExecutionContext,
} from "./workspace-operations-types"
const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
/** Default lines returned by `workspace.read` when `limit` is omitted but
 *  `offset` is supplied. Matches common agent read tools and keeps a single
 *  read under roughly 20–50k tokens. */
const DEFAULT_READ_LIMIT = 2000

/** Blob → base64 字符串(不带 data URL prefix). 用于 workspace_read 图片
 *  返回 imageBase64 字段,供 agent runtime 构造 image ContentPart. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== "string") {
        reject(new Error("FileReader did not produce a string"))
        return
      }
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}
/** Hard cap on lines per `workspace.read` slice. Agents needing more must
 *  page with `offset`. */
const MAX_READ_LIMIT = 5000
/** Per-file match cap for `workspace.search`. Prevents a giant memory/lore
 *  file from flooding the observation when every line matches. */
const MAX_MATCHES_PER_FILE = 50
const MAX_ACCESS_LEVEL = 4
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/
const EDIT_OPERATIONS = new Set<WorkspaceOperationName>([
  "write",
  "edit",
  "copy",
  "move",
  "delete",
])

interface AccessLevels {
  readLevel: number
  editLevel: number
}

const DEFAULT_SCOPE_ACCESS: Record<Exclude<WorkspaceScope, "effective">, AccessLevels> = {
  "card-content": {
    readLevel: 0,
    editLevel: 2,
  },
  "save-runtime": {
    readLevel: 0,
    editLevel: 1,
  },
  "platform-meta": {
    readLevel: 4,
    editLevel: 4,
  },
  "card-frontend": {
    readLevel: 0,
    editLevel: 2,
  },
  // 临时附件目录:无权限限制,所有 actor 可读写.
  temp: {
    readLevel: 0,
    editLevel: 0,
  },
}

function workspaceOperationError(
  code: string,
  message: string,
  details?: unknown,
): WorkspaceOperationError {
  return details === undefined ? { code, message } : { code, message, details }
}

export function normalizeWorkspaceOperationFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
  if (!result.ok) {
    throw workspaceOperationError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceOperationTargetPath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw workspaceOperationError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceOperationDirectoryPath(value: unknown): string {
  const result = normalizeWorkspacePath(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw workspaceOperationError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceOperationName(value: unknown): WorkspaceOperationName {
  if (typeof value !== "string") {
    throw workspaceOperationError(
      "WORKSPACE_OPERATION_REQUIRED",
      "Workspace operation must be a string.",
    )
  }

  if (value in WORKSPACE_OPERATION_NAMES) {
    return value as WorkspaceOperationName
  }

  throw workspaceOperationError(
    "WORKSPACE_OPERATION_UNSUPPORTED",
    `Unsupported workspace operation: ${value}`,
    {
      operation: value,
      supportedOperations: Object.values(WORKSPACE_OPERATION_NAMES),
    },
  )
}

function normalizeWorkspaceScope(value: unknown): WorkspaceScope {
  if (
    value === "effective"
    || value === "card-content"
    || value === "save-runtime"
    || value === "platform-meta"
    || value === "card-frontend"
    || value === "temp"
  ) {
    return value
  }

  throw workspaceOperationError(
    "WORKSPACE_SCOPE_REQUIRED",
    "Workspace operation requires an explicit scope.",
    {
      supportedScopes: [
        "effective",
        "card-content",
        "save-runtime",
        "platform-meta",
        "card-frontend",
        "temp",
      ],
    },
  )
}

/** Resolve the workspace scope for an operation when the caller (typically the
 *  LLM tool args) omits `scope`. Explicit scope always wins. Read ops default
 *  to "effective" (a union view across all scopes). Edit ops infer the scope
 *  from the path prefix via `scopeForPath` so routing + permission checks hit
 *  the right backend — "effective" is read-only. Permission enforcement itself
 *  is path-based (`assertEditAccess` calls `accessForPath`→`scopeForPath`), so
 *  the actor-level boundary is preserved regardless of whether scope is
 *  explicit or inferred. */
function resolveOperationScope(
  operation: WorkspaceOperationName,
  requestInput: WorkspaceOperationRequest,
): WorkspaceScope {
  if (typeof requestInput.scope === "string" && requestInput.scope) {
    return normalizeWorkspaceScope(requestInput.scope)
  }
  if (EDIT_OPERATIONS.has(operation)) {
    const rawPath = typeof requestInput.path === "string" ? requestInput.path : ""
    const normalized = rawPath.trim().replace(/\\/g, "/").replace(/^\/+/, "")
    return scopeForPath(normalized)
  }
  return "effective"
}

function normalizeSearchLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SEARCH_LIMIT
  }

  return Math.min(Math.floor(value), MAX_SEARCH_LIMIT)
}

/** Normalize a 1-based read `offset`. Non-finite or non-positive values fall
 *  back to 1 (the first line). There is no upper cap — an offset beyond the
 *  file length simply yields an empty slice with `truncated: false`. */
function normalizeReadOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return 1
  }
  return Math.floor(value)
}

/** Normalize a read `limit`. Non-finite or non-positive values fall back to
 *  `DEFAULT_READ_LIMIT`. Capped at `MAX_READ_LIMIT`. */
function normalizeReadLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_READ_LIMIT
  }
  return Math.min(Math.floor(value), MAX_READ_LIMIT)
}

/** Normalize a non-negative `contextLines` value for `workspace.search`.
 *  Non-finite or negative values fall back to 0. */
function normalizeContextLines(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.floor(value)
}

function fileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

function createPreview(content: string, index: number): string {
  if (index < 0) {
    return ""
  }

  const start = Math.max(0, index - 48)
  const end = Math.min(content.length, index + 96)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < content.length ? "..." : ""
  return `${prefix}${content.slice(start, end)}${suffix}`.replace(/\s+/g, " ").trim()
}

/** Build per-line `WorkspaceSearchMatch` entries for one file. `matcher`
 *  receives each line and returns the matched substring (or `null` when the
 *  line does not match). Shared by `query` (substring) and `pattern` (regex)
 *  modes so the line walk + context slicing + per-file cap logic is written
 *  once. */
function buildSearchMatches(
  content: string,
  matcher: (line: string) => string | null,
  contextLines: number,
): { matches: WorkspaceSearchMatch[]; truncated: boolean } {
  const lines = content.split("\n")
  const matches: WorkspaceSearchMatch[] = []
  let truncated = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const match = matcher(line)
    if (match === null) {
      continue
    }
    if (matches.length >= MAX_MATCHES_PER_FILE) {
      truncated = true
      break
    }
    const start = Math.max(0, i - contextLines)
    const end = Math.min(lines.length, i + 1 + contextLines)
    matches.push({
      lineNumber: i + 1,
      line,
      contextBefore: lines.slice(start, i),
      contextAfter: lines.slice(i + 1, end),
      match,
    })
  }
  return { matches, truncated }
}

export function isPlatformMetadataPath(path: string): boolean {
  return path === ".tsian" || path.startsWith(".tsian/")
}

export function isSaveRuntimePath(path: string): boolean {
  return path === "save" || path.startsWith("save/")
}

export function isCardFrontendPath(path: string): boolean {
  return path === "frontend" || path.startsWith("frontend/")
}

export function isTempPath(path: string): boolean {
  return path === "temp" || path.startsWith("temp/")
}

function scopeForPath(path: string): Exclude<WorkspaceScope, "effective"> {
  if (isPlatformMetadataPath(path)) {
    return "platform-meta"
  }
  if (isSaveRuntimePath(path)) {
    return "save-runtime"
  }
  if (isCardFrontendPath(path)) {
    return "card-frontend"
  }
  if (isTempPath(path)) {
    return "temp"
  }
  return "card-content"
}

function pathMatchesScope(path: string, scope: WorkspaceScope): boolean {
  if (scope === "effective") {
    return true
  }
  return scopeForPath(path) === scope
}

function accessForPath(path: string): AccessLevels {
  return DEFAULT_SCOPE_ACCESS[scopeForPath(path)]
}

function normalizeAccessLevel(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined
  }

  return Math.max(0, Math.min(MAX_ACCESS_LEVEL, Math.floor(value)))
}

export function resolveWorkspaceActorLevel(
  context: Pick<WorkspaceOperationExecutionContext, "actorLevel" | "agentContext">,
): number {
  return normalizeAccessLevel(context.actorLevel)
    ?? normalizeAccessLevel(context.agentContext?.agent.workspaceAccess.level)
    ?? 1
}

function assertOperationExposed(
  operation: WorkspaceOperationName,
  exposedOperations: Iterable<WorkspaceOperationName> | undefined,
): void {
  const exposed = new Set(exposedOperations ?? DEFAULT_RUNTIME_WORKSPACE_OPERATIONS)
  if (exposed.has(operation)) {
    return
  }

  throw workspaceOperationError(
    "WORKSPACE_OPERATION_NOT_EXPOSED",
    `Workspace operation is not exposed in this context: ${operation}`,
    {
      operation,
      exposedOperations: Array.from(exposed).sort(),
    },
  )
}

function assertReadAccess(path: string, actorLevel: number): void {
  const access = accessForPath(path)
  if (actorLevel >= access.readLevel) {
    return
  }

  throw workspaceOperationError(
    "WORKSPACE_READ_ACCESS_DENIED",
    `Workspace read level ${access.readLevel} is required for: ${path}`,
    {
      path,
      actorLevel,
      readLevel: access.readLevel,
    },
  )
}

function assertEditAccess(path: string, actorLevel: number): void {
  const access = accessForPath(path)
  if (actorLevel >= access.editLevel) {
    return
  }

  throw workspaceOperationError(
    "WORKSPACE_EDIT_ACCESS_DENIED",
    `Workspace edit level ${access.editLevel} is required for: ${path}`,
    {
      path,
      actorLevel,
      editLevel: access.editLevel,
    },
  )
}

function cloneWorkspaceFile(file: WorkspaceFile): WorkspaceFile {
  return { ...file }
}

function scopedReadableFiles(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  actorLevel: number,
): WorkspaceFile[] {
  return files
    .filter((file) => pathMatchesScope(file.path, scope))
    .filter((file) => actorLevel >= accessForPath(file.path).readLevel)
    .map(cloneWorkspaceFile)
    .sort((left, right) => left.path.localeCompare(right.path))
}

function findScopedFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  path: string,
): WorkspaceFile | undefined {
  if (!pathMatchesScope(path, scope)) {
    return undefined
  }

  return files.find((file) => file.path === path)
}

const KNOWLEDGE_MOUNT_DIR = "knowledge"

/**
 * Resolves a knowledge mount virtual path to its real card-content path.
 * If the agent declares a knowledgeMount (e.g. "docs/"), paths under
 * agents/<agentId>/knowledge/ are translated to the real mount target.
 * Returns the original path when no mount applies.
 */
function resolveKnowledgeMountPath(
  path: string,
  agentContext: AgentContextEntry | undefined,
): string {
  if (!agentContext?.agent.knowledgeMount) {
    return path
  }
  const agentDir = agentContext.agent.path.replace(/\/AGENT\.md$/, "")
  const mountVirtualDir = `${agentDir}/${KNOWLEDGE_MOUNT_DIR}`
  const mountTarget = agentContext.agent.knowledgeMount.replace(/\/+$/, "")

  if (path === mountVirtualDir) {
    return mountTarget
  }
  const prefix = `${mountVirtualDir}/`
  if (path.startsWith(prefix)) {
    return `${mountTarget}/${path.slice(prefix.length)}`
  }
  return path
}

/**
 * Resolves a real card-content path back to its knowledge mount virtual path
 * for result normalization. Used when listing entries under the mount.
 */
function resolveKnowledgeMountPathReverse(
  path: string,
  agentContext: AgentContextEntry | undefined,
): string {
  if (!agentContext?.agent.knowledgeMount) {
    return path
  }
  const agentDir = agentContext.agent.path.replace(/\/AGENT\.md$/, "")
  const mountVirtualDir = `${agentDir}/${KNOWLEDGE_MOUNT_DIR}`
  const mountTarget = agentContext.agent.knowledgeMount.replace(/\/+$/, "")

  if (path === mountTarget) {
    return mountVirtualDir
  }
  const prefix = `${mountTarget}/`
  if (path.startsWith(prefix)) {
    return `${mountVirtualDir}/${path.slice(prefix.length)}`
  }
  return path
}

function listWorkspaceEntries(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  pathInput: unknown,
  actorLevel: number,
): { path: string; entries: WorkspaceEntry[] } {
  const directoryPath = normalizeWorkspaceOperationDirectoryPath(pathInput)
  const prefix = directoryPath ? `${directoryPath}/` : ""
  const fileEntries = new Map<string, WorkspaceEntry>()
  const directoryEntries = new Map<string, WorkspaceEntry & { children: Set<string> }>()

  for (const file of scopedReadableFiles(files, scope, actorLevel)) {
    if (directoryPath && file.path !== directoryPath && !file.path.startsWith(prefix)) {
      continue
    }

    const remainder = directoryPath
      ? file.path.slice(prefix.length)
      : file.path
    if (!remainder) {
      continue
    }

    const slashIndex = remainder.indexOf("/")
    if (slashIndex === -1) {
      fileEntries.set(file.path, {
        path: file.path,
        name: fileName(file.path),
        kind: "file",
        size: file.binary?.size ?? file.content.length,
        updatedAt: file.updatedAt,
      })
      continue
    }

    const childName = remainder.slice(0, slashIndex)
    const childPath = prefix ? `${prefix}${childName}` : childName
    const nextSegment = remainder.slice(slashIndex + 1).split("/")[0]
    const existing = directoryEntries.get(childPath)
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt ?? 0, file.updatedAt)
      if (nextSegment) existing.children.add(nextSegment)
      continue
    }

    const children = new Set<string>()
    if (nextSegment) children.add(nextSegment)
    directoryEntries.set(childPath, {
      path: childPath,
      name: childName,
      kind: "directory",
      updatedAt: file.updatedAt,
      childCount: 0,
      children,
    })
  }

  return {
    path: directoryPath,
    entries: [
      ...Array.from(directoryEntries.values())
        .map(({ children, ...entry }) => ({
          ...entry,
          childCount: children.size,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      ...Array.from(fileEntries.values())
        .sort((left, right) => left.name.localeCompare(right.name)),
    ],
  }
}

function readWorkspaceFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  pathInput: unknown,
  actorLevel: number,
  options: { offset?: number; limit?: number } = {},
): WorkspaceReadResult {
  const path = normalizeWorkspaceOperationFilePath(pathInput)
  assertReadAccess(path, actorLevel)
  const file = findScopedFile(files, scope, path)
  if (!file) {
    throw workspaceOperationError(
      "WORKSPACE_FILE_NOT_FOUND",
      `Workspace file was not found in ${scope}: ${path}`,
      { scope, path },
    )
  }

  const cloned = cloneWorkspaceFile(file)

  // Binary files surface a placeholder description string as `content`; line
  // slicing does not apply. Surface the whole placeholder and mark it so the
  // agent does not try to page through a binary blob.
  // 图片文件额外标记 imageMimeType,调用方(executeWorkspaceOperation read 分支)
  // 据此做 async base64 编码并设置 imageBase64(此处不能 await,保持 sync).
  if (file.binary) {
    return {
      ...cloned,
      totalLines: 1,
      returnedLines: 1,
      offset: 1,
      truncated: false,
      isBinaryPlaceholder: true,
    }
  }

  const lines = file.content.split("\n")
  const totalLines = lines.length

  // No offset/limit supplied → return the whole file but still report total
  // lines so the agent can decide whether to page on a later call.
  const hasOffset = typeof options.offset === "number"
  const hasLimit = typeof options.limit === "number"
  if (!hasOffset && !hasLimit) {
    return {
      ...cloned,
      totalLines,
      returnedLines: totalLines,
      offset: 1,
      truncated: false,
    }
  }

  const offset = normalizeReadOffset(options.offset)
  const limit = normalizeReadLimit(options.limit)

  // Offset beyond the file → empty slice, not an error. The agent reads the
  // metadata and stops paging.
  if (offset > totalLines) {
    return {
      ...cloned,
      content: "",
      totalLines,
      returnedLines: 0,
      offset,
      truncated: false,
    }
  }

  const slice = lines.slice(offset - 1, offset - 1 + limit)
  return {
    ...cloned,
    content: slice.join("\n"),
    totalLines,
    returnedLines: slice.length,
    offset,
    truncated: offset + limit - 1 < totalLines,
  }
}

function searchWorkspaceFiles(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  input: WorkspaceOperationRequest,
  actorLevel: number,
): WorkspaceSearchResult[] {
  const hasQuery = typeof input.query === "string" && input.query.trim().length > 0
  const hasPattern = typeof input.pattern === "string" && input.pattern.trim().length > 0

  // `query` and `pattern` are mutually exclusive — do not guess intent.
  if (hasQuery && hasPattern) {
    throw workspaceOperationError(
      "WORKSPACE_QUERY_PATTERN_MUTEX",
      "Pass either `query` (substring) or `pattern` (regex) to workspace.search, not both.",
      { query: input.query, pattern: input.pattern },
    )
  }
  // Neither supplied → empty result, matching the legacy empty-query behavior.
  if (!hasQuery && !hasPattern) {
    return []
  }

  // `query` defaults to case-insensitive (legacy behavior); `pattern`
  // defaults to case-sensitive (regex convention). Explicit `ignoreCase`
  // overrides either default.
  const mode = hasPattern ? "pattern" : "query"
  const ignoreCase = typeof input.ignoreCase === "boolean"
    ? input.ignoreCase
    : mode === "query"

  let regex: RegExp | null = null
  if (mode === "pattern") {
    try {
      regex = new RegExp(input.pattern as string, ignoreCase ? "i" : "")
    } catch (error) {
      throw workspaceOperationError(
        "WORKSPACE_PATTERN_INVALID",
        `Invalid workspace.search pattern: ${error instanceof Error ? error.message : "regex compile failed"}.`,
        { pattern: input.pattern },
      )
    }
  }

  const queryRaw = mode === "query" ? (input.query as string).trim() : ""
  const queryLower = mode === "query" ? queryRaw.toLowerCase() : ""
  const contextLines = normalizeContextLines(input.contextLines)
  const limit = normalizeSearchLimit(input.limit)

  // Per-line matcher shared by both modes via buildSearchMatches.
  const matchLine = (line: string): string | null => {
    if (mode === "pattern" && regex) {
      const m = line.match(regex)
      return m ? m[0] : null
    }
    // query mode: substring on the lowercased line (ignoreCase default true
    // for query is implemented by comparing lowercased slices).
    if (ignoreCase) {
      return line.toLowerCase().includes(queryLower) ? queryRaw : null
    }
    return line.includes(queryRaw) ? queryRaw : null
  }

  // Path matcher mirrors the line matcher's case behavior.
  const pathMatches = (lowerPath: string, rawPath: string): boolean => {
    if (mode === "pattern" && regex) {
      return regex.test(rawPath)
    }
    return ignoreCase ? lowerPath.includes(queryLower) : rawPath.includes(queryRaw)
  }

  return scopedReadableFiles(files, scope, actorLevel)
    .flatMap((file): WorkspaceSearchResult[] => {
      const lowerPath = file.path.toLowerCase()
      const matchesPath = pathMatches(lowerPath, file.path)

      // Binary files carry a placeholder content string; skip content
      // matching but keep path-matched files visible.
      if (file.binary) {
        if (!matchesPath) {
          return []
        }
        return [{
          path: file.path,
          name: fileName(file.path),
          updatedAt: file.updatedAt,
          score: 2,
          matches: [],
          matchesTruncated: false,
          preview: file.path,
        }]
      }

      const { matches, truncated } = buildSearchMatches(file.content, matchLine, contextLines)

      // Drop files that match neither path nor content.
      if (!matchesPath && matches.length === 0) {
        return []
      }

      // `preview` is a back-compat short fragment for trace/debug consumers.
      // Prefer the first match's line; fall back to the path.
      const preview = matches.length > 0
        ? createPreview(matches[0].line, matches[0].line.indexOf(matches[0].match))
        : file.path

      return [{
        path: file.path,
        name: fileName(file.path),
        updatedAt: file.updatedAt,
        score: (matchesPath ? 2 : 0) + (matches.length > 0 ? 1 : 0),
        matches,
        matchesTruncated: truncated,
        preview,
      }]
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.updatedAt - left.updatedAt
    })
    .slice(0, limit)
}

/**
 * Convert a glob pattern into an anchored RegExp. Supports the basic wildcards
 * most agent tools expose:
 *   - A double-star followed by a slash matches zero or more directory
 *     segments (so `star-star-slash agent.json` matches both `agent.json`
 *     and `a/b/agent.json`).
 *   - A bare double-star (not followed by a slash) matches any sequence
 *     including slashes.
 *   - A single star matches any sequence except a slash (one directory level).
 *   - A question mark matches a single character except a slash.
 * Every other character is escaped as a RegExp literal. The result is anchored
 * with start and end anchors so the whole path must match.
 */
function globToRegExp(pattern: string): RegExp {
  let source = ""
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` → zero or more directory segments (optional `dir/dir/.../`).
        if (pattern[i + 2] === "/") {
          source += "(?:.*/)?"
          i += 2
        } else {
          // Bare `**` matches anything including `/`.
          source += ".*"
          i += 1
        }
      } else {
        source += "[^/]*"
      }
    } else if (char === "?") {
      source += "[^/]"
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${source}$`)
}

function normalizeGlobPattern(value: unknown): string {
  if (typeof value !== "string") {
    throw workspaceOperationError(
      "WORKSPACE_PATTERN_REQUIRED",
      "Workspace glob pattern must be a string.",
    )
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw workspaceOperationError(
      "WORKSPACE_PATTERN_REQUIRED",
      "Workspace glob pattern must not be empty.",
    )
  }

  return trimmed.replace(/\\/g, "/").replace(/^\/+/, "")
}

function globWorkspaceFiles(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  input: WorkspaceOperationRequest,
  actorLevel: number,
): WorkspaceGlobResult {
  const pattern = normalizeGlobPattern(input.pattern)
  const limit = normalizeSearchLimit(input.limit)
  const matcher = globToRegExp(pattern)
  const matches = scopedReadableFiles(files, scope, actorLevel)
    .filter((file) => matcher.test(file.path))
    .map((file) => file.path)
  const truncated = matches.length > limit
  return {
    scope,
    pattern,
    matches: matches.slice(0, limit),
    truncated,
  }
}

function normalizeContent(value: unknown): string {
  if (typeof value !== "string") {
    throw workspaceOperationError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace content must be a string.",
    )
  }

  return value
}

function assertMutableScope(scope: WorkspaceScope): asserts scope is Exclude<WorkspaceScope, "effective"> {
  if (scope !== "effective") {
    return
  }

  throw workspaceOperationError(
    "WORKSPACE_EFFECTIVE_SCOPE_READ_ONLY",
    "The effective workspace scope is read-only. Choose card-content, save-runtime, or platform-meta for writes.",
  )
}

function assertMutationAdapter(
  mutations: WorkspaceOperationMutationAdapter | undefined,
): WorkspaceOperationMutationAdapter {
  if (mutations) {
    return mutations
  }

  throw workspaceOperationError(
    "WORKSPACE_MUTATION_UNAVAILABLE",
    "Workspace mutation is not available in this context.",
  )
}

function diffWorkspaceFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  actorLevel: number,
): WorkspaceDiffResult {
  const path = normalizeWorkspaceOperationFilePath(request.path)
  assertReadAccess(path, actorLevel)
  const existing = findScopedFile(files, scope, path)
  if (!existing) {
    throw workspaceOperationError(
      "WORKSPACE_FILE_NOT_FOUND",
      `Workspace file was not found in ${scope}: ${path}`,
      { scope, path },
    )
  }

  if (existing.binary) {
    throw workspaceOperationError(
      "WORKSPACE_BINARY_NOT_DIFFABLE",
      `Binary files cannot be diffed as text: ${path}`,
      { scope, path },
    )
  }

  const nextContent = normalizeContent(request.content)
  return {
    path,
    scope,
    currentContent: existing.content,
    nextContent,
    changed: existing.content !== nextContent,
    currentSize: existing.content.length,
    nextSize: nextContent.length,
  }
}

async function writeWorkspaceFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  context: WorkspaceOperationExecutionContext,
): Promise<WorkspaceWriteResult> {
  assertMutableScope(scope)
  const path = normalizeWorkspaceOperationFilePath(request.path)
  assertEditAccess(path, resolveWorkspaceActorLevel(context))
  if (!pathMatchesScope(path, scope)) {
    throw workspaceOperationError(
      "WORKSPACE_SCOPE_PATH_MISMATCH",
      `Workspace path does not belong to ${scope}: ${path}`,
      { scope, path, pathScope: scopeForPath(path) },
    )
  }

  const existing = findScopedFile(files, scope, path)
  // Optimistic-concurrency guard: when `expectedContent` is provided, reject
  // the write if the file's current content does not match. This detects
  // stale overwrites (the file changed between read and write). Omitting it
  // means an unconditional overwrite. Formerly the `patch` operation's duty;
  // now folded into `write` so the misleading `patch` op could retire.
  if (
    typeof request.expectedContent === "string"
    && existing?.content !== request.expectedContent
  ) {
    throw workspaceOperationError(
      "WORKSPACE_EXPECTED_CONTENT_MISMATCH",
      `Workspace file changed before write: ${path}`,
      { scope, path },
    )
  }

  // Write supports either text content (string) or binary data (Blob). The
  // request.content is `string | Blob` per the contract; a Blob is routed to
  // the `data` field so the storage layer stores it as binary.
  const binaryData = request.content instanceof Blob ? request.content : undefined
  const textContent = typeof request.content === "string" ? request.content : undefined
  if (!binaryData && textContent === undefined) {
    throw workspaceOperationError(
      "WORKSPACE_CONTENT_REQUIRED",
      `Workspace write requires content (string) or a Blob: ${path}`,
      { scope, path },
    )
  }

  const file = await assertMutationAdapter(context.mutations).write({
    scope,
    path,
    ...(textContent !== undefined ? { content: textContent } : {}),
    ...(binaryData ? { data: binaryData } : {}),
  })
  return {
    path,
    scope,
    file,
    changed: existing?.content !== file.content,
  }
}

/** Count non-overlapping occurrences of `needle` in `haystack`. `needle` must
 *  be non-empty (validated by the caller). Uses split-join to avoid regex
 *  metacharacter interpretation — `oldString` is a literal string. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  return haystack.split(needle).length - 1
}

/** Apply a partial edit to a workspace file via literal string replacement.
 *  `oldString` must match exactly once unless `replaceAll` is set. Binary
 *  files are rejected. The implicit conflict signal: if the file changed
 *  since the caller last read it, `oldString` likely won't match — surfacing
 *  the conflict without an explicit `expectedContent`. Falls back to the
 *  shared `mutations.write` adapter so staged-transaction/rollback semantics
 *  are identical to `write`. */
async function editWorkspaceFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  context: WorkspaceOperationExecutionContext,
): Promise<WorkspaceWriteResult> {
  assertMutableScope(scope)
  const path = normalizeWorkspaceOperationFilePath(request.path)
  assertEditAccess(path, resolveWorkspaceActorLevel(context))
  if (!pathMatchesScope(path, scope)) {
    throw workspaceOperationError(
      "WORKSPACE_SCOPE_PATH_MISMATCH",
      `Workspace path does not belong to ${scope}: ${path}`,
      { scope, path, pathScope: scopeForPath(path) },
    )
  }

  const oldString = request.oldString
  const newString = typeof request.newString === "string" ? request.newString : ""
  const replaceAll = request.replaceAll === true

  if (typeof oldString !== "string" || oldString.length === 0) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_OLD_STRING_REQUIRED",
      `workspace.edit requires a non-empty oldString: ${path}`,
      { scope, path },
    )
  }

  const existing = findScopedFile(files, scope, path)
  if (!existing) {
    throw workspaceOperationError(
      "WORKSPACE_FILE_NOT_FOUND",
      `Cannot edit a non-existent file: ${path}`,
      { scope, path },
    )
  }
  if (existing.binary) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_BINARY_UNSUPPORTED",
      `workspace.edit cannot edit binary files: ${path}`,
      { scope, path },
    )
  }

  const content = existing.content
  const matchCount = countOccurrences(content, oldString)
  if (matchCount === 0) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_NO_MATCH",
      `oldString not found in ${path}. The file may have changed since you read it, or oldString does not exactly match the file (check indentation and surrounding whitespace).`,
      { scope, path },
    )
  }
  if (matchCount > 1 && !replaceAll) {
    throw workspaceOperationError(
      "WORKSPACE_EDIT_NOT_UNIQUE",
      `oldString matches ${matchCount} occurrences in ${path}. Expand oldString (include surrounding lines) so it matches exactly once, or set replaceAll: true to replace every match.`,
      { scope, path, matchCount },
    )
  }

  // Single replacement: String.replace with a string pattern replaces only
  // the first match. replaceAll path uses split-join to substitute every one.
  const nextContent = replaceAll
    ? content.split(oldString).join(newString)
    : content.replace(oldString, newString)

  if (nextContent === content) {
    return { path, scope, file: existing, changed: false }
  }

  const file = await assertMutationAdapter(context.mutations).write({
    scope,
    path,
    content: nextContent,
  })
  return { path, scope, file, changed: true }
}

async function deleteWorkspacePath(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  context: WorkspaceOperationExecutionContext,
): Promise<WorkspaceDeleteResult> {
  assertMutableScope(scope)
  const path = normalizeWorkspaceOperationTargetPath(request.path)
  const actorLevel = resolveWorkspaceActorLevel(context)
  assertEditAccess(path, actorLevel)
  if (!pathMatchesScope(path, scope)) {
    throw workspaceOperationError(
      "WORKSPACE_SCOPE_PATH_MISMATCH",
      `Workspace path does not belong to ${scope}: ${path}`,
      { scope, path, pathScope: scopeForPath(path) },
    )
  }

  return assertMutationAdapter(context.mutations).delete({ scope, path })
}

async function moveWorkspacePath(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  context: WorkspaceOperationExecutionContext,
): Promise<WorkspaceMoveResult> {
  assertMutableScope(scope)
  const fromPath = normalizeWorkspaceOperationTargetPath(request.path)
  const toPath = normalizeWorkspaceOperationTargetPath(request.targetPath)
  const fromScope = scopeForPath(fromPath)
  const toScope = scopeForPath(toPath)
  const actorLevel = resolveWorkspaceActorLevel(context)
  assertEditAccess(fromPath, actorLevel)
  assertEditAccess(toPath, actorLevel)
  if (!pathMatchesScope(fromPath, scope)) {
    throw workspaceOperationError(
      "WORKSPACE_SCOPE_PATH_MISMATCH",
      `Workspace source path does not belong to ${scope}: ${fromPath}`,
      {
        scope,
        fromPath,
        toPath,
        fromScope,
        toScope,
      },
    )
  }

  const prefix = `${fromPath}/`
  const matches = files
    .filter((file) =>
      pathMatchesScope(file.path, fromScope)
      && (file.path === fromPath || file.path.startsWith(prefix))
    )
    .sort((left, right) => left.path.localeCompare(right.path))
  if (matches.length === 0) {
    throw workspaceOperationError(
      "WORKSPACE_FILE_NOT_FOUND",
      `Workspace path was not found in ${scope}: ${fromPath}`,
      { scope, path: fromPath },
    )
  }

  const mutations = assertMutationAdapter(context.mutations)
  const movedPaths: string[] = []
  for (const file of matches) {
    const nextPath = file.path === fromPath
      ? toPath
      : `${toPath}/${file.path.slice(prefix.length)}`
    assertEditAccess(nextPath, actorLevel)
    await mutations.write({
      scope: toScope,
      path: nextPath,
      ...(file.binary ? { data: file.binary } : { content: file.content }),
    })
    movedPaths.push(nextPath)
  }
  await mutations.delete({ scope: fromScope, path: fromPath })

  return {
    scope: fromScope,
    fromPath,
    toPath,
    movedPaths,
  }
}

async function copyWorkspacePath(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  context: WorkspaceOperationExecutionContext,
): Promise<WorkspaceCopyResult> {
  assertMutableScope(scope)
  const fromPath = normalizeWorkspaceOperationTargetPath(request.path)
  const toPath = normalizeWorkspaceOperationTargetPath(request.targetPath)
  const fromScope = scopeForPath(fromPath)
  const toScope = scopeForPath(toPath)
  const actorLevel = resolveWorkspaceActorLevel(context)
  assertReadAccess(fromPath, actorLevel)
  assertEditAccess(toPath, actorLevel)
  if (!pathMatchesScope(fromPath, scope)) {
    throw workspaceOperationError(
      "WORKSPACE_SCOPE_PATH_MISMATCH",
      `Workspace source path does not belong to ${scope}: ${fromPath}`,
      { scope, fromPath, toPath, fromScope, toScope },
    )
  }

  const prefix = `${fromPath}/`
  const matches = files
    .filter((file) =>
      pathMatchesScope(file.path, fromScope)
      && (file.path === fromPath || file.path.startsWith(prefix))
    )
    .sort((left, right) => left.path.localeCompare(right.path))
  if (matches.length === 0) {
    throw workspaceOperationError(
      "WORKSPACE_FILE_NOT_FOUND",
      `Workspace path was not found in ${scope}: ${fromPath}`,
      { scope, path: fromPath },
    )
  }

  const copiedPaths: string[] = []
  for (const file of matches) {
    const nextPath = file.path === fromPath
      ? toPath
      : `${toPath}/${file.path.slice(prefix.length)}`
    assertEditAccess(nextPath, actorLevel)
    if (findScopedFile(files, toScope, nextPath)) {
      throw workspaceOperationError(
        "WORKSPACE_TARGET_EXISTS",
        `Workspace copy target already exists: ${nextPath}`,
        { scope: toScope, path: nextPath },
      )
    }
  }

  const mutations = assertMutationAdapter(context.mutations)
  for (const file of matches) {
    const nextPath = file.path === fromPath
      ? toPath
      : `${toPath}/${file.path.slice(prefix.length)}`
    await mutations.write({
      scope: toScope,
      path: nextPath,
      ...(file.binary ? { data: file.binary } : { content: file.content }),
    })
    copiedPaths.push(nextPath)
  }

  return {
    scope: fromScope,
    fromPath,
    toPath,
    copiedPaths,
  }
}

function validateJsonFile(file: WorkspaceFile): WorkspaceValidationResult["errors"] {
  try {
    JSON.parse(file.content)
    return []
  } catch (error) {
    return [{
      code: "WORKSPACE_JSON_INVALID",
      message: error instanceof Error ? error.message : "JSON is invalid.",
      path: file.path,
    }]
  }
}

function validateFrontmatterFile(file: WorkspaceFile): WorkspaceValidationResult["errors"] {
  if (FRONTMATTER_PATTERN.test(file.content)) {
    return []
  }

  return [{
    code: "WORKSPACE_FRONTMATTER_MISSING",
    message: "File does not start with YAML frontmatter.",
    path: file.path,
  }]
}

function validateWorkspaceFile(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  request: WorkspaceOperationRequest,
  actorLevel: number,
): WorkspaceValidationResult {
  if (request.autoFix) {
    throw workspaceOperationError(
      "WORKSPACE_VALIDATE_AUTOFIX_UNSUPPORTED",
      "Workspace validate autoFix is not supported yet.",
    )
  }

  const path = request.path === undefined
    ? undefined
    : normalizeWorkspaceOperationFilePath(request.path)
  const validator = request.validator
    ?? (path?.endsWith(".json") ? "json" : "frontmatter")

  if (!path) {
    return {
      scope,
      valid: true,
      validator,
      errors: [],
    }
  }

  assertReadAccess(path, actorLevel)
  const file = readWorkspaceFile(files, scope, path, actorLevel)
  if (file.binary) {
    // Binary files carry a placeholder string as content; text-format
    // validators (json/frontmatter) do not apply.
    return {
      scope,
      path,
      valid: true,
      validator,
      errors: [],
    }
  }
  const errors = validator === "json"
    ? validateJsonFile(file)
    : validateFrontmatterFile(file)
  return {
    scope,
    path,
    valid: errors.length === 0,
    validator,
    errors,
  }
}

export async function executeWorkspaceOperation(
  requestInput: WorkspaceOperationRequest,
  context: WorkspaceOperationExecutionContext,
): Promise<unknown> {
  const operation = normalizeWorkspaceOperationName(requestInput.operation)
  const scope = resolveOperationScope(operation, requestInput)
  const actorLevel = resolveWorkspaceActorLevel(context)

  assertOperationExposed(operation, context.exposedOperations)

  if (EDIT_OPERATIONS.has(operation) && scope === "effective") {
    assertMutableScope(scope)
  }
  if (EDIT_OPERATIONS.has(operation) && !context.mutations) {
    assertMutationAdapter(context.mutations)
  }

  if (operation === "list") {
    return listWorkspaceEntries(context.workspaceFiles, scope, requestInput.path, actorLevel)
  }
  if (operation === "search") {
    return searchWorkspaceFiles(context.workspaceFiles, scope, requestInput, actorLevel)
  }
  if (operation === "read") {
    const result = readWorkspaceFile(context.workspaceFiles, scope, requestInput.path, actorLevel, {
      offset: requestInput.offset,
      limit: requestInput.limit,
    })
    // 图片 binary 文件:async base64 编码,设置 imageBase64 + imageMimeType,
    // 清除 isBinaryPlaceholder(不再是不可读的 binary,而是可发 LLM 的 image block).
    if (result.binary && result.imageMimeType && result.imageMimeType.startsWith("image/") && result.imageMimeType !== "image/svg+xml") {
      const base64 = await blobToBase64(result.binary)
      return {
        ...result,
        imageBase64: base64,
        isBinaryPlaceholder: false,
      }
    }
    return result
  }
  if (operation === "glob") {
    return globWorkspaceFiles(context.workspaceFiles, scope, requestInput, actorLevel)
  }
  if (operation === "diff") {
    return diffWorkspaceFile(context.workspaceFiles, scope, requestInput, actorLevel)
  }
  if (operation === "write") {
    return writeWorkspaceFile(context.workspaceFiles, scope, requestInput, context)
  }
  if (operation === "edit") {
    return editWorkspaceFile(context.workspaceFiles, scope, requestInput, context)
  }
  if (operation === "copy") {
    return copyWorkspacePath(context.workspaceFiles, scope, requestInput, context)
  }
  if (operation === "move") {
    return moveWorkspacePath(context.workspaceFiles, scope, requestInput, context)
  }
  if (operation === "delete") {
    return deleteWorkspacePath(context.workspaceFiles, scope, requestInput, context)
  }
  if (operation === "validate") {
    return validateWorkspaceFile(context.workspaceFiles, scope, requestInput, actorLevel)
  }
  if (operation === "semantic_search") {
    // 只读 op,与 search 同级. owner(saveId)从 context 取;effective view 的
    // workspaceFiles 过滤出 save-runtime 路径作 staleness 兜底枚举集.
    const ownerId = context.semanticSearchOwnerId
    if (!ownerId) {
      // 无 ownerId(如非 save 场景调用)→ 返回空,不抛错.
      return []
    }
    const saveRuntimeFiles = scopedReadableFiles(context.workspaceFiles, "save-runtime", actorLevel)
    return semanticSearch(
      {
        query: requestInput.semanticQuery ?? requestInput.query ?? "",
        typeFilter: requestInput.typeFilter,
        limit: requestInput.limit,
        ownerId,
        files: saveRuntimeFiles,
      },
      "save-runtime",
    )
  }

  throw workspaceOperationError(
    "WORKSPACE_OPERATION_UNSUPPORTED",
    `Unsupported workspace operation: ${operation}`,
  )
}
