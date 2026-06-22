import type {
  AgentContextEntry,
  WorkspaceDeleteResult,
  WorkspaceDiffResult,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceGlobResult,
  WorkspaceMoveResult,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspacePatchResult,
  WorkspaceScope,
  WorkspaceSearchResult,
  WorkspaceValidationResult,
} from "@tsian/contracts"

export interface WorkspaceOperationError {
  code: string
  message: string
  details?: unknown
}

export interface WorkspaceOperationMutationAdapter {
  write(input: {
    scope: WorkspaceScope
    path: string
    content?: string
    data?: Blob
  }): WorkspaceFile | Promise<WorkspaceFile>
  delete(input: {
    scope: WorkspaceScope
    path: string
  }): WorkspaceDeleteResult | Promise<WorkspaceDeleteResult>
}

export interface WorkspaceOperationExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  actorLevel?: number
  exposedOperations?: Iterable<WorkspaceOperationName>
  mutations?: WorkspaceOperationMutationAdapter
}

export const WORKSPACE_OPERATION_NAMES = {
  list: "list",
  search: "search",
  read: "read",
  glob: "glob",
  diff: "diff",
  patch: "patch",
  write: "write",
  move: "move",
  delete: "delete",
  validate: "validate",
} as const satisfies Record<WorkspaceOperationName, WorkspaceOperationName>

export const DEFAULT_RUNTIME_WORKSPACE_OPERATIONS: WorkspaceOperationName[] = [
  "list",
  "search",
  "read",
  "glob",
]

export const AUTHORING_WORKSPACE_OPERATIONS: WorkspaceOperationName[] = [
  "list",
  "search",
  "read",
  "glob",
  "diff",
  "patch",
  "write",
  "move",
  "delete",
  "validate",
]

const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const MAX_ACCESS_LEVEL = 4
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---/
const EDIT_OPERATIONS = new Set<WorkspaceOperationName>([
  "patch",
  "write",
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
}

function workspaceOperationError(
  code: string,
  message: string,
  details?: unknown,
): WorkspaceOperationError {
  return details === undefined ? { code, message } : { code, message, details }
}

function normalizePathBase(
  value: unknown,
  options: { allowEmpty: boolean; rejectTrailingSlash: boolean },
): string {
  if (typeof value !== "string") {
    throw workspaceOperationError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path must be a string.",
    )
  }

  const raw = value.trim()
  const hadTrailingSlash = /[\\/]$/.test(raw)
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (!normalized) {
    if (options.allowEmpty) {
      return ""
    }
    throw workspaceOperationError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path is required.",
    )
  }

  if (options.rejectTrailingSlash && hadTrailingSlash) {
    throw workspaceOperationError(
      "WORKSPACE_FILE_PATH_REQUIRED",
      "Workspace file path must not end with a slash.",
    )
  }

  if (normalized.includes("\0")) {
    throw workspaceOperationError(
      "WORKSPACE_PATH_INVALID",
      "Workspace path must not contain NUL bytes.",
    )
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    throw workspaceOperationError(
      "WORKSPACE_PATH_INVALID",
      "Workspace path must not contain empty, current, or parent directory segments.",
    )
  }

  return normalized
}

export function normalizeWorkspaceOperationFilePath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
}

function normalizeWorkspaceOperationTargetPath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: false,
  })
}

function normalizeWorkspaceOperationDirectoryPath(value: unknown): string {
  return normalizePathBase(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
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
      ],
    },
  )
}

function normalizeSearchLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SEARCH_LIMIT
  }

  return Math.min(Math.floor(value), MAX_SEARCH_LIMIT)
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

export function isPlatformMetadataPath(path: string): boolean {
  return path === ".tsian" || path.startsWith(".tsian/")
}

export function isSaveRuntimePath(path: string): boolean {
  return path === "save" || path.startsWith("save/")
}

export function isCardFrontendPath(path: string): boolean {
  return path === "frontend" || path.startsWith("frontend/")
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
): WorkspaceFile {
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

  return cloneWorkspaceFile(file)
}

function searchWorkspaceFiles(
  files: WorkspaceFile[],
  scope: WorkspaceScope,
  input: WorkspaceOperationRequest,
  actorLevel: number,
): WorkspaceSearchResult[] {
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
  if (!query) {
    return []
  }

  const limit = normalizeSearchLimit(input.limit)
  return scopedReadableFiles(files, scope, actorLevel)
    .flatMap((file): WorkspaceSearchResult[] => {
      // Binary files surface a placeholder string as content; skip content
      // matching for them (path matching still applies).
      if (file.binary) {
        const lowerPath = file.path.toLowerCase()
        if (!lowerPath.includes(query)) {
          return []
        }
        return [{
          path: file.path,
          name: fileName(file.path),
          updatedAt: file.updatedAt,
          score: 2,
          preview: file.path,
        }]
      }
      const lowerPath = file.path.toLowerCase()
      const lowerContent = file.content.toLowerCase()
      const contentIndex = lowerContent.indexOf(query)
      const matchesPath = lowerPath.includes(query)
      if (!matchesPath && contentIndex < 0) {
        return []
      }

      return [{
        path: file.path,
        name: fileName(file.path),
        updatedAt: file.updatedAt,
        score: (matchesPath ? 2 : 0) + (contentIndex >= 0 ? 1 : 0),
        preview: contentIndex >= 0 ? createPreview(file.content, contentIndex) : file.path,
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
  options: { checkExpectedContent: boolean },
): Promise<WorkspacePatchResult> {
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
  if (
    options.checkExpectedContent
    && typeof request.expectedContent === "string"
    && existing?.content !== request.expectedContent
  ) {
    throw workspaceOperationError(
      "WORKSPACE_EXPECTED_CONTENT_MISMATCH",
      `Workspace file changed before patch: ${path}`,
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
  const actorLevel = resolveWorkspaceActorLevel(context)
  assertEditAccess(fromPath, actorLevel)
  assertEditAccess(toPath, actorLevel)
  if (!pathMatchesScope(fromPath, scope) || !pathMatchesScope(toPath, scope)) {
    throw workspaceOperationError(
      "WORKSPACE_SCOPE_PATH_MISMATCH",
      `Workspace move paths must both belong to ${scope}.`,
      {
        scope,
        fromPath,
        toPath,
        fromScope: scopeForPath(fromPath),
        toScope: scopeForPath(toPath),
      },
    )
  }

  const prefix = `${fromPath}/`
  const matches = files
    .filter((file) =>
      pathMatchesScope(file.path, scope)
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
      scope,
      path: nextPath,
      ...(file.binary ? { data: file.binary } : { content: file.content }),
    })
    movedPaths.push(nextPath)
  }
  await mutations.delete({ scope, path: fromPath })

  return {
    scope,
    fromPath,
    toPath,
    movedPaths,
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
  const scope = normalizeWorkspaceScope(requestInput.scope)
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
    return readWorkspaceFile(context.workspaceFiles, scope, requestInput.path, actorLevel)
  }
  if (operation === "glob") {
    return globWorkspaceFiles(context.workspaceFiles, scope, requestInput, actorLevel)
  }
  if (operation === "diff") {
    return diffWorkspaceFile(context.workspaceFiles, scope, requestInput, actorLevel)
  }
  if (operation === "patch") {
    return writeWorkspaceFile(context.workspaceFiles, scope, requestInput, context, {
      checkExpectedContent: true,
    })
  }
  if (operation === "write") {
    return writeWorkspaceFile(context.workspaceFiles, scope, requestInput, context, {
      checkExpectedContent: false,
    })
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

  throw workspaceOperationError(
    "WORKSPACE_OPERATION_UNSUPPORTED",
    `Unsupported workspace operation: ${operation}`,
  )
}
