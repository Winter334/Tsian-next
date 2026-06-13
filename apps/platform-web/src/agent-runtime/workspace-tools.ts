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
  actionCall: "action_call",
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

interface RuntimeSkillActionDeclaration {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
}

interface RuntimeLoadedSkill {
  skill: SkillRegistryEntry
  actions: RuntimeSkillActionDeclaration[]
}

export interface RuntimeWorkspaceToolSessionState {
  loadedSkills: RuntimeLoadedSkill[]
}

interface SkillActionParseResult {
  actions: RuntimeSkillActionDeclaration[]
  errors: RuntimeWorkspaceToolError[]
}

interface NormalizePathOptions {
  allowEmpty: boolean
  rejectTrailingSlash: boolean
}

export interface RuntimeWorkspaceToolExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  sessionState?: RuntimeWorkspaceToolSessionState
}

const TOOL_CALL_PATTERN = /<tsian-tool-call>\s*([\s\S]*?)\s*<\/tsian-tool-call>/g
const SKILL_ACTIONS_FENCE_PATTERN = /```([^\n`]*)\r?\n([\s\S]*?)```/g
const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const SKILL_ACTIONS_FENCE_LABEL = "tsian-actions"
const SUPPORTED_ACTION_INPUT_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
])

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

export function createRuntimeWorkspaceToolSessionState(): RuntimeWorkspaceToolSessionState {
  return {
    loadedSkills: [],
  }
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

function normalizeRequiredString(
  value: unknown,
  code: string,
  message: string,
): string {
  if (typeof value !== "string") {
    throw toolError(code, message)
  }

  const normalized = value.trim()
  if (!normalized) {
    throw toolError(code, message)
  }

  return normalized
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

function parseActionDeclarations(content: string): SkillActionParseResult {
  const actions: RuntimeSkillActionDeclaration[] = []
  const errors: RuntimeWorkspaceToolError[] = []
  const seenNames = new Set<string>()

  for (const match of content.matchAll(SKILL_ACTIONS_FENCE_PATTERN)) {
    const info = (match[1] ?? "").toLowerCase()
    if (!info.split(/\s+/).includes(SKILL_ACTIONS_FENCE_LABEL)) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(match[2] ?? "")
    } catch (error) {
      errors.push(toolError(
        "ACTION_DECLARATION_JSON_INVALID",
        error instanceof Error ? error.message : "Action declaration JSON is invalid.",
      ))
      continue
    }

    const rawActions = Array.isArray(parsed) ? parsed : [parsed]
    for (const [index, rawAction] of rawActions.entries()) {
      if (!isRecord(rawAction)) {
        errors.push(toolError(
          "ACTION_DECLARATION_INVALID",
          "Action declaration must be a JSON object.",
          { index },
        ))
        continue
      }

      const name = typeof rawAction.name === "string" ? rawAction.name.trim() : ""
      if (!name) {
        errors.push(toolError(
          "ACTION_DECLARATION_NAME_REQUIRED",
          "Action declaration requires a non-empty string name.",
          { index },
        ))
        continue
      }

      const normalizedName = normalizedLookupKey(name)
      if (seenNames.has(normalizedName)) {
        errors.push(toolError(
          "ACTION_DECLARATION_DUPLICATE",
          `Duplicate action declaration: ${name}`,
          { index, name },
        ))
        continue
      }

      const action: RuntimeSkillActionDeclaration = {
        name,
        description: typeof rawAction.description === "string"
          ? rawAction.description.trim()
          : "",
      }

      if (rawAction.inputSchema !== undefined) {
        if (!isRecord(rawAction.inputSchema)) {
          errors.push(toolError(
            "ACTION_INPUT_SCHEMA_INVALID",
            `Action inputSchema must be an object: ${name}`,
            { index, name },
          ))
          continue
        }

        action.inputSchema = rawAction.inputSchema
      }

      seenNames.add(normalizedName)
      actions.push(action)
    }
  }

  return { actions, errors }
}

function loadedSkillDetails(
  skill: SkillRegistryEntry,
  actions: RuntimeSkillActionDeclaration[],
  actionDeclarationErrors: RuntimeWorkspaceToolError[],
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    name: skill.name,
    title: skill.title,
    description: skill.description,
    triggers: skill.triggers,
    appliesTo: skill.appliesTo,
    scope: skill.scope,
    actions: actions.map((action) => ({
      name: action.name,
      description: action.description,
      hasInputSchema: action.inputSchema !== undefined,
    })),
  }
  if (skill.agentId) {
    details.agentId = skill.agentId
  }
  if (actionDeclarationErrors.length) {
    details.actionDeclarationErrors = actionDeclarationErrors
  }
  return details
}

function registerLoadedSkill(
  state: RuntimeWorkspaceToolSessionState | undefined,
  skill: SkillRegistryEntry,
  actions: RuntimeSkillActionDeclaration[],
): void {
  if (!state) {
    return
  }

  const existingIndex = state.loadedSkills.findIndex((entry) => entry.skill.path === skill.path)
  const loadedSkill = { skill, actions }
  if (existingIndex >= 0) {
    state.loadedSkills[existingIndex] = loadedSkill
    return
  }

  state.loadedSkills.push(loadedSkill)
}

function findLoadedSkill(
  state: RuntimeWorkspaceToolSessionState | undefined,
  skillName: string,
): RuntimeLoadedSkill | null {
  if (!state) {
    return null
  }

  const requestedKey = normalizedLookupKey(skillName)
  return state.loadedSkills.find((entry) =>
    normalizedLookupKey(entry.skill.name) === requestedKey
      || normalizedLookupKey(entry.skill.id) === requestedKey
  ) ?? null
}

function findDeclaredAction(
  loadedSkill: RuntimeLoadedSkill,
  actionName: string,
): RuntimeSkillActionDeclaration | null {
  const requestedKey = normalizedLookupKey(actionName)
  return loadedSkill.actions.find((action) => normalizedLookupKey(action.name) === requestedKey) ?? null
}

function schemaTypeMatches(type: string, value: unknown): boolean {
  if (type === "array") return Array.isArray(value)
  if (type === "boolean") return typeof value === "boolean"
  if (type === "integer") return Number.isInteger(value)
  if (type === "null") return value === null
  if (type === "number") return typeof value === "number" && Number.isFinite(value)
  if (type === "object") return isRecord(value)
  if (type === "string") return typeof value === "string"
  return true
}

function validateActionInputSchema(
  schema: Record<string, unknown> | undefined,
  input: Record<string, unknown>,
): void {
  if (!schema) {
    return
  }

  const rootType = typeof schema.type === "string" ? schema.type : "object"
  if (rootType !== "object") {
    throw toolError(
      "ACTION_INPUT_SCHEMA_UNSUPPORTED",
      "Action inputSchema root type must be object for the MVP.",
      { type: rootType },
    )
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : []
  for (const field of required) {
    if (input[field] === undefined) {
      throw toolError(
        "ACTION_INPUT_INVALID",
        `Action input is missing required field: ${field}`,
        { field },
      )
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {}
  for (const [field, rawPropertySchema] of Object.entries(properties)) {
    if (input[field] === undefined || !isRecord(rawPropertySchema)) {
      continue
    }

    const fieldType = typeof rawPropertySchema.type === "string"
      ? rawPropertySchema.type
      : ""
    if (!fieldType || !SUPPORTED_ACTION_INPUT_TYPES.has(fieldType)) {
      continue
    }

    if (!schemaTypeMatches(fieldType, input[field])) {
      throw toolError(
        "ACTION_INPUT_INVALID",
        `Action input field has invalid type: ${field}`,
        {
          field,
          expected: fieldType,
          actual: Array.isArray(input[field]) ? "array" : input[field] === null ? "null" : typeof input[field],
        },
      )
    }
  }
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
  const { actions, errors: actionDeclarationErrors } = parseActionDeclarations(file.content)
  registerLoadedSkill(context.sessionState, skill, actions)

  return {
    loadedSkill: loadedSkillDetails(skill, actions, actionDeclarationErrors),
    file: {
      mediaType: file.mediaType,
      content: file.content,
      updatedAt: file.updatedAt,
    },
  }
}

function validateSkillActionCall(
  context: RuntimeWorkspaceToolExecutionContext,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const skillName = normalizeRequiredString(
    input.skill,
    "ACTION_SKILL_REQUIRED",
    "action_call requires a non-empty string skill.",
  )
  const actionName = normalizeRequiredString(
    input.action,
    "ACTION_NAME_REQUIRED",
    "action_call requires a non-empty string action.",
  )
  const actionInput = input.input === undefined ? {} : input.input
  if (!isRecord(actionInput)) {
    throw toolError(
      "ACTION_INPUT_INVALID",
      "action_call input must be a JSON object when provided.",
    )
  }

  const loadedSkill = findLoadedSkill(context.sessionState, skillName)
  if (!loadedSkill) {
    throw toolError(
      "SKILL_ACTION_NOT_LOADED",
      `Skill must be loaded before calling its actions: ${skillName}`,
      { skill: skillName },
    )
  }

  const action = findDeclaredAction(loadedSkill, actionName)
  if (!action) {
    throw toolError(
      "ACTION_NOT_FOUND",
      `Action is not declared by loaded Skill "${loadedSkill.skill.name}": ${actionName}`,
      {
        skill: loadedSkill.skill.name,
        action: actionName,
        availableActions: loadedSkill.actions.map((candidate) => ({
          name: candidate.name,
          description: candidate.description,
        })),
      },
    )
  }

  validateActionInputSchema(action.inputSchema, actionInput)

  return {
    status: "validated",
    skill: {
      name: loadedSkill.skill.name,
      title: loadedSkill.skill.title,
      scope: loadedSkill.skill.scope,
      ...(loadedSkill.skill.agentId ? { agentId: loadedSkill.skill.agentId } : {}),
    },
    action: {
      name: action.name,
      description: action.description,
      hasInputSchema: action.inputSchema !== undefined,
    },
    input: actionInput,
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

    if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.actionCall) {
      return {
        index,
        name: call.name,
        ok: true,
        result: validateSkillActionCall(context, call.arguments),
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
