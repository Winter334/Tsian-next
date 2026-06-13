import type {
  AgentContextEntry,
  SkillRegistryEntry,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceSearchResult,
} from "@tsian/contracts"

export interface RuntimeWorkspaceToolCall {
  name: string
  arguments: Record<string, unknown>
}

export const RUNTIME_WORKSPACE_TOOL_NAMES = {
  skillLoad: "skill_load",
  workspaceRead: "workspace_read",
  workspaceList: "workspace_list",
  workspaceSearch: "workspace_search",
} as const

export type RuntimeWorkspaceToolName =
  (typeof RUNTIME_WORKSPACE_TOOL_NAMES)[keyof typeof RUNTIME_WORKSPACE_TOOL_NAMES]

export interface ParsedRuntimeWorkspaceToolCall {
  raw: string
  call?: RuntimeWorkspaceToolCall
  error?: RuntimeWorkspaceToolError
}

export interface RuntimeWorkspaceToolError {
  code: string
  message: string
  details?: unknown
}

export interface RuntimeWorkspaceToolObservation {
  index: number
  name: string
  ok: boolean
  result?: unknown
  error?: RuntimeWorkspaceToolError
}

interface NormalizePathOptions {
  allowEmpty: boolean
  rejectTrailingSlash: boolean
}

export interface RuntimeWorkspaceToolExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
}

const TOOL_CALL_PATTERN = /<tsian-tool-call>\s*([\s\S]*?)\s*<\/tsian-tool-call>/g
const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolError(
  code: string,
  message: string,
  details?: unknown,
): RuntimeWorkspaceToolError {
  return details === undefined ? { code, message } : { code, message, details }
}

function normalizePathBase(value: unknown, options: NormalizePathOptions): string {
  if (typeof value !== "string") {
    throw toolError(
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
    throw toolError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path is required.",
    )
  }

  if (options.rejectTrailingSlash && hadTrailingSlash) {
    throw toolError(
      "WORKSPACE_FILE_PATH_REQUIRED",
      "Workspace file path must not end with a slash.",
    )
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    throw toolError(
      "WORKSPACE_PATH_INVALID",
      "Workspace path must not contain empty, current, or parent directory segments.",
    )
  }

  return normalized
}

function normalizeWorkspaceFilePath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
}

function normalizeDirectoryPath(value: unknown): string {
  return normalizePathBase(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
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

function parseToolCall(raw: string): ParsedRuntimeWorkspaceToolCall {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      raw,
      error: toolError(
        "TOOL_CALL_JSON_INVALID",
        error instanceof Error ? error.message : "Tool call JSON is invalid.",
      ),
    }
  }

  if (!isRecord(parsed)) {
    return {
      raw,
      error: toolError(
        "TOOL_CALL_INVALID",
        "Tool call must be a JSON object.",
      ),
    }
  }

  const name = typeof parsed.name === "string" ? parsed.name.trim() : ""
  if (!name) {
    return {
      raw,
      error: toolError(
        "TOOL_NAME_REQUIRED",
        "Tool call requires a non-empty string name.",
      ),
    }
  }

  const args = parsed.arguments
  if (args !== undefined && !isRecord(args)) {
    return {
      raw,
      error: toolError(
        "TOOL_ARGUMENTS_INVALID",
        "Tool call arguments must be a JSON object when provided.",
      ),
    }
  }

  return {
    raw,
    call: {
      name,
      arguments: args ?? {},
    },
  }
}

export function parseRuntimeWorkspaceToolCalls(
  text: string,
): ParsedRuntimeWorkspaceToolCall[] {
  const calls: ParsedRuntimeWorkspaceToolCall[] = []
  for (const match of text.matchAll(TOOL_CALL_PATTERN)) {
    calls.push(parseToolCall(match[1] ?? ""))
  }

  return calls
}

export function stripRuntimeWorkspaceToolCallBlocks(text: string): string {
  return text.replace(TOOL_CALL_PATTERN, "").trim()
}

function listWorkspaceEntries(
  files: WorkspaceFile[],
  pathInput: unknown,
): { path: string; entries: WorkspaceEntry[] } {
  const directoryPath = normalizeDirectoryPath(pathInput)
  const prefix = directoryPath ? `${directoryPath}/` : ""
  const fileEntries = new Map<string, WorkspaceEntry>()
  const directoryEntries = new Map<string, WorkspaceEntry & { children: Set<string> }>()

  for (const file of files) {
    if (directoryPath && !file.path.startsWith(prefix)) {
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
        mediaType: file.mediaType,
        size: file.content.length,
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
  pathInput: unknown,
): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(pathInput)
  const file = files.find((candidate) => candidate.path === path)
  if (!file) {
    throw toolError(
      "WORKSPACE_FILE_NOT_FOUND",
      `Workspace file was not found: ${path}`,
    )
  }

  return file
}

function searchWorkspaceFiles(
  files: WorkspaceFile[],
  input: Record<string, unknown>,
): WorkspaceSearchResult[] {
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
  if (!query) {
    return []
  }

  const limit = normalizeSearchLimit(input.limit)
  return files
    .flatMap((file): WorkspaceSearchResult[] => {
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
        mediaType: file.mediaType,
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

function normalizeSkillName(value: unknown): string {
  if (typeof value !== "string") {
    throw toolError(
      "SKILL_NAME_REQUIRED",
      "Skill name must be a string.",
    )
  }

  const name = value.trim()
  if (!name) {
    throw toolError(
      "SKILL_NAME_REQUIRED",
      "Skill name is required.",
    )
  }

  return name
}

function normalizedLookupKey(value: string): string {
  return value.trim().toLowerCase()
}

function skillCandidateDetails(skill: SkillRegistryEntry): Record<string, unknown> {
  const details: Record<string, unknown> = {
    name: skill.name,
    title: skill.title,
    description: skill.description,
    scope: skill.scope,
  }
  if (skill.agentId) {
    details.agentId = skill.agentId
  }
  return details
}

function narrowSkillCandidates(
  candidates: SkillRegistryEntry[],
  agentContext: AgentContextEntry,
): SkillRegistryEntry[] {
  const localCandidates = candidates.filter((skill) =>
    skill.scope === "agent-local" && skill.agentId === agentContext.agent.id
  )

  return localCandidates.length ? localCandidates : candidates
}

function resolveVisibleSkillByName(
  agentContext: AgentContextEntry,
  value: unknown,
): SkillRegistryEntry {
  const requestedName = normalizeSkillName(value)
  const requestedKey = normalizedLookupKey(requestedName)
  const nameMatches = agentContext.skillIndex.filter((skill) =>
    normalizedLookupKey(skill.name) === requestedKey
  )
  const candidates = nameMatches.length
    ? nameMatches
    : agentContext.skillIndex.filter((skill) => normalizedLookupKey(skill.id) === requestedKey)

  if (candidates.length === 0) {
    throw toolError(
      "SKILL_NOT_FOUND",
      `Skill was not found or is not visible to this agent: ${requestedName}`,
    )
  }

  const narrowed = narrowSkillCandidates(candidates, agentContext)
  if (narrowed.length !== 1) {
    throw toolError(
      "SKILL_NAME_AMBIGUOUS",
      `Skill name is ambiguous for this agent: ${requestedName}`,
      {
        candidates: narrowed.map(skillCandidateDetails),
      },
    )
  }

  return narrowed[0]
}

function loadSkillEntryFile(
  files: WorkspaceFile[],
  skill: SkillRegistryEntry,
): WorkspaceFile {
  const file = files.find((candidate) => candidate.path === skill.path)
  if (!file) {
    throw toolError(
      "SKILL_DETAIL_NOT_FOUND",
      `Skill detail file was not found for skill: ${skill.name}`,
    )
  }

  return file
}

function loadSkillByName(
  context: RuntimeWorkspaceToolExecutionContext,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!context.agentContext) {
    throw toolError(
      "SKILL_CONTEXT_REQUIRED",
      "skill_load requires an active Agent context.",
    )
  }

  const skill = resolveVisibleSkillByName(context.agentContext, input.name)
  const file = loadSkillEntryFile(context.workspaceFiles, skill)
  const loadedSkill: Record<string, unknown> = {
    name: skill.name,
    title: skill.title,
    description: skill.description,
    triggers: skill.triggers,
    appliesTo: skill.appliesTo,
    scope: skill.scope,
  }
  if (skill.agentId) {
    loadedSkill.agentId = skill.agentId
  }

  return {
    loadedSkill,
    file: {
      mediaType: file.mediaType,
      content: file.content,
      updatedAt: file.updatedAt,
    },
  }
}

function executeRuntimeWorkspaceToolCall(
  context: RuntimeWorkspaceToolExecutionContext,
  parsed: ParsedRuntimeWorkspaceToolCall,
  index: number,
): RuntimeWorkspaceToolObservation {
  if (parsed.error) {
    return {
      index,
      name: "invalid",
      ok: false,
      error: parsed.error,
    }
  }

  const call = parsed.call
  if (!call) {
    return {
      index,
      name: "invalid",
      ok: false,
      error: toolError(
        "TOOL_CALL_INVALID",
        "Tool call was not parsed.",
      ),
    }
  }

  try {
    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.skillLoad) {
      return {
        index,
        name: call.name,
        ok: true,
        result: loadSkillByName(context, call.arguments),
      }
    }

    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.workspaceRead) {
      return {
        index,
        name: call.name,
        ok: true,
        result: readWorkspaceFile(context.workspaceFiles, call.arguments.path),
      }
    }

    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.workspaceList) {
      return {
        index,
        name: call.name,
        ok: true,
        result: listWorkspaceEntries(context.workspaceFiles, call.arguments.path),
      }
    }

    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.workspaceSearch) {
      return {
        index,
        name: call.name,
        ok: true,
        result: searchWorkspaceFiles(context.workspaceFiles, call.arguments),
      }
    }

    return {
      index,
      name: call.name,
      ok: false,
      error: toolError(
        "UNSUPPORTED_WORKSPACE_TOOL",
        `Unsupported workspace tool: ${call.name}`,
      ),
    }
  } catch (error) {
    return {
      index,
      name: call.name,
      ok: false,
      error: isRecord(error) && typeof error.code === "string" && typeof error.message === "string"
        ? {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          }
        : toolError(
            "WORKSPACE_TOOL_FAILED",
            error instanceof Error ? error.message : "Workspace tool failed.",
          ),
    }
  }
}

export function executeRuntimeWorkspaceToolCalls(
  context: RuntimeWorkspaceToolExecutionContext,
  calls: ParsedRuntimeWorkspaceToolCall[],
): RuntimeWorkspaceToolObservation[] {
  return calls.map((call, index) => executeRuntimeWorkspaceToolCall(context, call, index))
}

export function formatRuntimeWorkspaceToolObservationMessage(
  observations: RuntimeWorkspaceToolObservation[],
): string {
  return [
    "Workspace tool observations:",
    "<tsian-tool-observation>",
    JSON.stringify(observations, null, 2),
    "</tsian-tool-observation>",
    "Use these observations to continue. If you have enough context, provide the required final output without tool-call blocks.",
  ].join("\n")
}
