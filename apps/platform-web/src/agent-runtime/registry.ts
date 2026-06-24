import type {
  AgentConfig,
  AgentPlatformToolName,
  AgentRegistryEntry,
  SkillActionSummary,
  SkillConfigItem,
  SkillDetailEntry,
  SkillRegistryEntry,
  SkillRegistryScope,
  SkillResourceEntry,
  WorkspaceFile,
} from "@tsian/contracts"

type MetadataValue = string | string[]
type Metadata = Record<string, MetadataValue>

export interface SkillRegistryQueryOptions {
  agentId?: string
  includeShared?: boolean
  includeLocal?: boolean
}

interface ParsedMarkdown {
  metadata: Metadata
  body: string
}

interface AgentPathInfo {
  agentId: string
  directoryPath: string
  agentFilePath: string
}

interface SkillPathInfo {
  scope: SkillRegistryScope
  skillId: string
  directoryPath: string
  agentId?: string
}

const AGENT_CONFIG_FILE_PATH_PATTERN = /^(?:agents\/([^/]+)|\.tsian\/local\/([^/]+))\/agent\.json$/
const SHARED_SKILL_FILE_PATH_PATTERN = /^skills\/([^/]+)\/SKILL\.md$/
const AGENT_LOCAL_SKILL_FILE_PATH_PATTERN = /^(?:agents\/([^/]+)|\.tsian\/local\/([^/]+))\/skills\/([^/]+)\/SKILL\.md$/
// Sibling of SKILL.md: `skills/<id>/skill.config` or
// `agents/<agent>/skills/<id>/skill.config` (also `.tsian/local/<agent>/...`).
// Matches the same directory prefixes as the SKILL.md patterns above.
const SKILL_CONFIG_FILE_PATH_PATTERN = /^(?:skills\/([^/]+)|(?:agents\/([^/]+)|\.tsian\/local\/([^/]+))\/skills\/([^/]+))\/skill\.config$/
const DEFAULT_AGENT_ACCESS_LEVEL = 1
const MAX_AGENT_ACCESS_LEVEL = 4
const AGENT_PLATFORM_TOOL_NAMES = new Set<AgentPlatformToolName>([
  "agent_call",
  "workspace_read",
  "workspace_write",
  "inspect_frontend",
  "workspace_semantic_search",
])

// Mirrors the `tsian-actions` fence pattern in workspace-tools.ts. Kept here so
// registry parsing (contracts-adjacent layer) does not reverse-depend on the
// runtime layer. The two must stay in sync if the fence format changes.
const SKILL_ACTIONS_FENCE_PATTERN = /```([^\n`]*)\r?\n([\s\S]*?)```/g
const SKILL_ACTIONS_FENCE_LABEL = "tsian-actions"
// After the tool/skill decouple task, browser_script is the only supported
// executor type. builtin/platform_action/workspace_operation are rejected here
// (reported in actionDeclarationErrors) and again strictly in use_skill.
const SUPPORTED_SKILL_ACTION_EXECUTOR_TYPE = "browser_script"

interface ParsedSkillActionSummaries {
  actions: SkillActionSummary[]
  errors: string[]
}

function parseSkillActionSummaries(body: string): ParsedSkillActionSummaries {
  const actions: SkillActionSummary[] = []
  const errors: string[] = []
  const seenNames = new Set<string>()

  for (const match of body.matchAll(SKILL_ACTIONS_FENCE_PATTERN)) {
    const info = (match[1] ?? "").toLowerCase()
    if (!info.split(/\s+/).includes(SKILL_ACTIONS_FENCE_LABEL)) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(match[2] ?? "")
    } catch (error) {
      errors.push(`tsian-actions fence JSON is invalid: ${error instanceof Error ? error.message : "parse error"}`)
      continue
    }

    const rawActions = Array.isArray(parsed) ? parsed : [parsed]
    for (const [index, rawAction] of rawActions.entries()) {
      if (!isRecord(rawAction)) {
        errors.push(`Action declaration #${index} must be a JSON object.`)
        continue
      }

      const name = typeof rawAction.name === "string" ? rawAction.name.trim() : ""
      if (!name) {
        errors.push(`Action declaration #${index} requires a non-empty string name.`)
        continue
      }

      const nameKey = name.toLowerCase()
      if (seenNames.has(nameKey)) {
        errors.push(`Duplicate action declaration: ${name}`)
        continue
      }
      seenNames.add(nameKey)

      const executor = isRecord(rawAction.executor) ? rawAction.executor : null
      const executorType = typeof executor?.type === "string" ? executor.type.trim() : ""
      if (executorType !== SUPPORTED_SKILL_ACTION_EXECUTOR_TYPE) {
        errors.push(
          `Action "${name}" uses executor type "${executorType || "(missing)"}" which is no longer supported; only "${SUPPORTED_SKILL_ACTION_EXECUTOR_TYPE}" is supported.`,
        )
        continue
      }

      const description = typeof rawAction.description === "string" ? rawAction.description.trim() : ""
      actions.push({
        name,
        description,
        executorType,
        executable: true,
      })
    }
  }

  return { actions, errors }
}

/**
 * Parse a `.env`-style `skill.config` source into declared config items.
 *
 * Rules:
 * - `#`-prefixed lines are comments and describe the *next* key line.
 * - `KEY=VALUE` lines declare a config item; VALUE is always a string.
 * - Blank lines clear the pending comment.
 * - Other lines are ignored.
 *
 * Registry-adjacent pure function (no Dexie/bridge imports), mirroring
 * `parseSkillActionSummaries`'s placement.
 */
export function parseSkillConfig(source: string): SkillConfigItem[] {
  const items: SkillConfigItem[] = []
  let pendingDescription = ""

  for (const rawLine of normalizeLineEndings(source).split("\n")) {
    const line = rawLine.trim()
    if (!line) {
      pendingDescription = ""
      continue
    }

    if (line.startsWith("#")) {
      const comment = line.slice(1).trim()
      pendingDescription = pendingDescription ? `${pendingDescription} ${comment}` : comment
      continue
    }

    // KEY=VALUE — key is uppercase snake-case by convention; VALUE stays a raw
    // string (scripts convert via Number() etc.). A key with no `=` is ignored.
    const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (!match) {
      pendingDescription = ""
      continue
    }

    items.push({
      key: match[1],
      description: pendingDescription,
      defaultValue: match[2].trim(),
    })
    pendingDescription = ""
  }

  return items
}

/**
 * Resolve a `skill.config` file path to the skill directory it belongs to.
 * Returns the directory path (e.g. `skills/my-skill`) or null when the path
 * is not a skill config file. Mirrors `skillPathInfo`'s directory resolution.
 */
function skillConfigDirectoryPath(path: string): string | null {
  const match = SKILL_CONFIG_FILE_PATH_PATTERN.exec(path)
  if (!match) {
    return null
  }

  // Group 1: skills/<id>/skill.config ; Groups 2/3/4: (agents|local)/<agent>/skills/<id>/skill.config
  if (match[1]) {
    return `skills/${match[1]}`
  }
  const agentId = match[2] ?? match[3]
  const skillId = match[4]
  if (!agentId || !skillId) {
    return null
  }
  return match[3]
    ? `.tsian/local/${agentId}/skills/${skillId}`
    : `agents/${agentId}/skills/${skillId}`
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

function cleanScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) {
    return trimmed
  }

  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

function parseMetadataLines(lines: string[]): Metadata {
  const metadata: Metadata = {}
  let currentListKey: string | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) {
      continue
    }

    const listItemMatch = /^-\s*(.*)$/.exec(line)
    if (listItemMatch && currentListKey) {
      const existing = metadata[currentListKey]
      const nextList = Array.isArray(existing) ? existing : []
      const item = cleanScalar(listItemMatch[1] ?? "")
      if (item) {
        nextList.push(item)
      }
      metadata[currentListKey] = nextList
      continue
    }

    const keyValueMatch = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/.exec(line)
    if (!keyValueMatch) {
      currentListKey = null
      continue
    }

    const key = keyValueMatch[1]
    const value = cleanScalar(keyValueMatch[2] ?? "")
    if (!value) {
      metadata[key] = []
      currentListKey = key
      continue
    }

    metadata[key] = value
    currentListKey = null
  }

  return metadata
}

function parseMarkdown(content: string): ParsedMarkdown {
  const normalized = normalizeLineEndings(content)
  const lines = normalized.split("\n")
  if (lines[0]?.trim() !== "---") {
    return {
      metadata: {},
      body: normalized,
    }
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (closingIndex < 0) {
    return {
      metadata: {},
      body: normalized,
    }
  }

  return {
    metadata: parseMetadataLines(lines.slice(1, closingIndex)),
    body: lines.slice(closingIndex + 1).join("\n"),
  }
}

function metadataValue(metadata: Metadata, keys: string[]): MetadataValue | undefined {
  const metadataKeys = Object.keys(metadata)
  for (const key of keys) {
    if (metadata[key] !== undefined) {
      return metadata[key]
    }

    const lowerKey = key.toLowerCase()
    const matchingKey = metadataKeys.find((candidate) => candidate.toLowerCase() === lowerKey)
    if (matchingKey && metadata[matchingKey] !== undefined) {
      return metadata[matchingKey]
    }
  }

  return undefined
}

function metadataString(metadata: Metadata, keys: string[]): string | undefined {
  const value = metadataValue(metadata, keys)
  if (Array.isArray(value)) {
    return value.map(cleanScalar).find(Boolean)
  }

  if (typeof value === "string") {
    const cleaned = cleanScalar(value)
    return cleaned || undefined
  }

  return undefined
}

function splitScalarList(value: string): string[] {
  const cleaned = cleanScalar(value)
  if (!cleaned || cleaned === "[]") {
    return []
  }

  const inner = cleaned.startsWith("[") && cleaned.endsWith("]")
    ? cleaned.slice(1, -1)
    : cleaned

  if (!inner.trim()) {
    return []
  }

  if (!inner.includes(",")) {
    return [cleanScalar(inner)].filter(Boolean)
  }

  return inner
    .split(",")
    .map(cleanScalar)
    .filter(Boolean)
}

function metadataArray(metadata: Metadata, keys: string[]): string[] {
  const value = metadataValue(metadata, keys)
  const rawItems = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? splitScalarList(value)
      : []
  const seen = new Set<string>()
  const items: string[] = []

  for (const rawItem of rawItems) {
    const item = cleanScalar(rawItem)
    if (!item || seen.has(item)) {
      continue
    }
    seen.add(item)
    items.push(item)
  }

  return items
}

function firstHeading(body: string): string | undefined {
  for (const line of normalizeLineEndings(body).split("\n")) {
    const match = /^#(?!#)\s+(.+?)\s*#*\s*$/.exec(line.trim())
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return undefined
}

function firstBodyParagraph(body: string): string {
  const blocks = normalizeLineEndings(body).split(/\n\s*\n/)
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length === 0) {
      continue
    }

    if (lines[0].startsWith("#") || lines[0].startsWith("```") || lines[0] === "---") {
      continue
    }

    return lines.join(" ")
  }

  return ""
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right)
}

function normalizedLookupKey(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

function fileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

function skillPathInfo(path: string): SkillPathInfo | null {
  const sharedMatch = SHARED_SKILL_FILE_PATH_PATTERN.exec(path)
  if (sharedMatch?.[1]) {
    const skillId = sharedMatch[1]
    return {
      scope: "shared",
      skillId,
      directoryPath: `skills/${skillId}`,
    }
  }

  const localMatch = AGENT_LOCAL_SKILL_FILE_PATH_PATTERN.exec(path)
  // Group 1: agents/<agent>/skills/<skill> ; Group 2: .tsian/local/<agent>/skills/<skill>
  // Group 3: <skill> in both cases.
  const localAgentId = localMatch?.[1] ?? localMatch?.[2]
  if (localAgentId && localMatch?.[3]) {
    const skillId = localMatch[3]
    const isLocal = Boolean(localMatch?.[2])
    const directoryPath = isLocal
      ? `.tsian/local/${localAgentId}/skills/${skillId}`
      : `agents/${localAgentId}/skills/${skillId}`
    return {
      scope: "agent-local",
      agentId: localAgentId,
      skillId,
      directoryPath,
    }
  }

  return null
}

function agentPathInfo(path: string): AgentPathInfo | null {
  const match = AGENT_CONFIG_FILE_PATH_PATTERN.exec(path)
  if (!match) {
    return null
  }

  // Group 1: agents/<id>/agent.json ; Group 2: .tsian/local/<id>/agent.json
  const agentId = match[1] ?? match[2]
  if (!agentId) {
    return null
  }

  const isLocal = Boolean(match[2])
  const directoryPath = isLocal ? `.tsian/local/${agentId}` : `agents/${agentId}`
  return {
    agentId,
    directoryPath,
    agentFilePath: `${directoryPath}/AGENT.md`,
  }
}

function pathDerivedSkillId(path: string): string | undefined {
  return skillPathInfo(path)?.skillId
}

function addLookupKey(keys: Set<string>, value: string | undefined): void {
  const key = normalizedLookupKey(value)
  if (key) {
    keys.add(key)
  }
}

function skillReferenceKeys(skill: SkillRegistryEntry): Set<string> {
  const keys = new Set<string>()
  addLookupKey(keys, skill.id)
  addLookupKey(keys, skill.name)
  addLookupKey(keys, skill.title)
  addLookupKey(keys, pathDerivedSkillId(skill.path))
  return keys
}

function agentReferenceKeys(agent: AgentRegistryEntry): Set<string> {
  const keys = new Set<string>()
  addLookupKey(keys, agent.id)
  addLookupKey(keys, agent.title)
  return keys
}

function referencesContainSkill(
  references: string[],
  skill: SkillRegistryEntry,
): boolean {
  return references.some((reference) => skillMatchesReference(skill, reference))
}

function referencesContainAgent(
  references: string[],
  agent: AgentRegistryEntry,
): boolean {
  const agentKeys = agentReferenceKeys(agent)
  return references.some((reference) => agentKeys.has(normalizedLookupKey(reference)))
}

function buildSkillRegistryEntry(
  file: WorkspaceFile,
  pathInfo: SkillPathInfo,
  configItems: SkillConfigItem[] | undefined,
): SkillRegistryEntry {
  const parsed = parseMarkdown(file.content)
  const name = metadataString(parsed.metadata, ["name", "id"]) ?? pathInfo.skillId
  const id = metadataString(parsed.metadata, ["id", "name"]) ?? name
  const title =
    metadataString(parsed.metadata, ["title", "name"]) ??
    firstHeading(parsed.body) ??
    name
  const description =
    metadataString(parsed.metadata, ["description", "summary"]) ??
    firstBodyParagraph(parsed.body)
  const summary =
    metadataString(parsed.metadata, ["summary", "description"]) ??
    description

  const entry: SkillRegistryEntry = {
    id,
    name,
    title,
    description,
    summary,
    path: file.path,
    scope: pathInfo.scope,
    triggers: metadataArray(parsed.metadata, ["triggers"]),
    appliesTo: metadataArray(parsed.metadata, ["appliesTo", "applicability"]),
    updatedAt: file.updatedAt,
  }

  if (pathInfo.agentId) {
    entry.agentId = pathInfo.agentId
  }

  // Parse `tsian-actions` fence summaries at registry build time so the model
  // can see which browser_script actions a Skill offers before use_skill.
  const { actions, errors } = parseSkillActionSummaries(parsed.body)
  if (actions.length > 0) {
    entry.actions = actions
  }
  if (errors.length > 0) {
    entry.actionDeclarationErrors = errors
  }

  // Attach config items parsed from a sibling `skill.config` file. Absent
  // config file → no `configItems` field (skill has no config needs).
  if (configItems && configItems.length > 0) {
    entry.configItems = configItems
  }

  return entry
}

function compareAgentEntries(
  left: AgentRegistryEntry,
  right: AgentRegistryEntry,
): number {
  const idComparison = compareText(left.id, right.id)
  if (idComparison !== 0) {
    return idComparison
  }

  return compareText(left.path, right.path)
}

function compareSkillEntries(
  left: SkillRegistryEntry,
  right: SkillRegistryEntry,
): number {
  const leftScopeRank = left.scope === "shared" ? 0 : 1
  const rightScopeRank = right.scope === "shared" ? 0 : 1
  if (leftScopeRank !== rightScopeRank) {
    return leftScopeRank - rightScopeRank
  }

  const agentComparison = compareText(left.agentId ?? "", right.agentId ?? "")
  if (agentComparison !== 0) {
    return agentComparison
  }

  const idComparison = compareText(left.id, right.id)
  if (idComparison !== 0) {
    return idComparison
  }

  return compareText(left.path, right.path)
}

function compareResourceEntries(
  left: SkillResourceEntry,
  right: SkillResourceEntry,
): number {
  const relativePathComparison = compareText(left.relativePath, right.relativePath)
  if (relativePathComparison !== 0) {
    return relativePathComparison
  }

  return compareText(left.path, right.path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function jsonString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined
}

function jsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const items: string[] = []
  for (const entry of value) {
    const item = jsonString(entry)
    const key = item?.toLowerCase() ?? ""
    if (!item || seen.has(key)) {
      continue
    }
    seen.add(key)
    items.push(item)
  }

  return items
}

function jsonPlatformToolArray(value: unknown): AgentPlatformToolName[] {
  return jsonStringArray(value)
    .filter((item): item is AgentPlatformToolName =>
      AGENT_PLATFORM_TOOL_NAMES.has(item as AgentPlatformToolName)
    )
}

function normalizeAgentAccessLevel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AGENT_ACCESS_LEVEL
  }

  return Math.max(0, Math.min(MAX_AGENT_ACCESS_LEVEL, Math.floor(value)))
}

function parseAgentConfigFile(file: WorkspaceFile): Partial<AgentConfig> | null {
  try {
    const parsed = JSON.parse(file.content) as unknown
    return isRecord(parsed) ? parsed as Partial<AgentConfig> : null
  } catch {
    return null
  }
}

function normalizeAgentSkillConfig(value: unknown): AgentConfig["skills"] {
  const record = isRecord(value) ? value : {}
  return {
    enabled: jsonStringArray(record.enabled),
    disabled: jsonStringArray(record.disabled),
  }
}

function normalizeAgentPlatformToolConfig(
  value: unknown,
): AgentConfig["platformTools"] {
  const record = isRecord(value) ? value : {}
  return {
    enabled: jsonPlatformToolArray(record.enabled),
    disabled: jsonPlatformToolArray(record.disabled),
  }
}

function normalizeAgentWorkspaceAccessConfig(
  value: unknown,
): AgentConfig["workspaceAccess"] {
  const record = isRecord(value) ? value : {}
  return {
    level: normalizeAgentAccessLevel(record.level),
  }
}

function buildAgentRegistryEntry(
  file: WorkspaceFile,
  pathInfo: AgentPathInfo,
): AgentRegistryEntry | null {
  const config = parseAgentConfigFile(file)
  if (!config) {
    return null
  }

  const skills = normalizeAgentSkillConfig(config.skills)
  const platformTools = normalizeAgentPlatformToolConfig(config.platformTools)
  const id = jsonString(config.id) ?? pathInfo.agentId
  const title = jsonString(config.title) ?? id
  const summary = jsonString(config.summary) ?? ""

  const knowledgeMount = jsonString(config.knowledgeMount)
  const providerPresetId = jsonString(config.providerPresetId)

  return {
    id,
    title,
    summary,
    configPath: file.path,
    path: pathInfo.agentFilePath,
    contacts: jsonStringArray(config.contacts),
    defaultSkills: [],
    enabledSkills: skills.enabled,
    disabledSkills: skills.disabled,
    platformTools,
    workspaceAccess: normalizeAgentWorkspaceAccessConfig(config.workspaceAccess),
    contextPaths: jsonStringArray(config.contextPaths),
    ...(knowledgeMount ? { knowledgeMount } : {}),
    ...(providerPresetId ? { providerPresetId } : {}),
    updatedAt: file.updatedAt,
  }
}

export function buildAgentRegistry(files: WorkspaceFile[]): AgentRegistryEntry[] {
  const filesByPath = new Map(files.map((file) => [file.path, file]))
  return files
    .flatMap((file): AgentRegistryEntry[] => {
      const pathInfo = agentPathInfo(file.path)
      if (!pathInfo || !filesByPath.has(pathInfo.agentFilePath)) {
        return []
      }

      const entry = buildAgentRegistryEntry(file, pathInfo)
      return entry ? [entry] : []
    })
    .sort(compareAgentEntries)
}

export function buildSkillRegistry(
  files: WorkspaceFile[],
  options: SkillRegistryQueryOptions = {},
): SkillRegistryEntry[] {
  const includeShared = options.includeShared ?? true
  const includeLocal = options.includeLocal ?? true
  const agentId = options.agentId?.trim()

  // First pass: collect sibling `skill.config` files keyed by skill directory
  // so each SKILL.md entry can attach its declared config items without a
  // second scan. A skill without a config file simply has no entry here.
  const configByDirectory = new Map<string, SkillConfigItem[]>()
  for (const file of files) {
    const directory = skillConfigDirectoryPath(file.path)
    if (directory) {
      configByDirectory.set(directory, parseSkillConfig(file.content))
    }
  }

  return files
    .flatMap((file): SkillRegistryEntry[] => {
      const pathInfo = skillPathInfo(file.path)
      if (!pathInfo) {
        return []
      }

      if (pathInfo.scope === "shared" && !includeShared) {
        return []
      }
      if (
        pathInfo.scope === "agent-local" &&
        (!includeLocal || (agentId && pathInfo.agentId !== agentId))
      ) {
        return []
      }

      const configItems = configByDirectory.get(pathInfo.directoryPath)
      return [buildSkillRegistryEntry(file, pathInfo, configItems)]
    })
    .sort(compareSkillEntries)
}

export function skillMetadataReference(skill: SkillRegistryEntry): string {
  return pathDerivedSkillId(skill.path) ?? (skill.name || skill.id || skill.title)
}

export function skillMatchesReference(
  skill: SkillRegistryEntry,
  reference: string,
): boolean {
  return skillReferenceKeys(skill).has(normalizedLookupKey(reference))
}

export function isSkillEnabledForAgent(
  skill: SkillRegistryEntry,
  agent: AgentRegistryEntry,
): boolean {
  if (skill.scope === "agent-local" && skill.agentId !== agent.id) {
    return false
  }

  if (referencesContainSkill(agent.disabledSkills, skill)) {
    return false
  }

  if (agent.enabledSkills.length > 0) {
    return referencesContainSkill(agent.enabledSkills, skill)
  }

  if (referencesContainSkill(agent.defaultSkills, skill)) {
    return true
  }

  if (skill.scope === "agent-local") {
    return skill.agentId === agent.id
  }

  if (skill.appliesTo.length > 0) {
    return referencesContainAgent(skill.appliesTo, agent)
  }

  return true
}

export function filterSkillsForAgent(
  skills: SkillRegistryEntry[],
  agent: AgentRegistryEntry,
): SkillRegistryEntry[] {
  return skills.filter((skill) => isSkillEnabledForAgent(skill, agent))
}

export function loadSkillDetail(
  files: WorkspaceFile[],
  path: string,
): SkillDetailEntry | null {
  const pathInfo = skillPathInfo(path)
  if (!pathInfo) {
    return null
  }

  const file = files.find((candidate) => candidate.path === path)
  if (!file) {
    return null
  }

  const resourcePrefix = `${pathInfo.directoryPath}/`
  const resources = files
    .flatMap((candidate): SkillResourceEntry[] => {
      if (candidate.path === file.path || !candidate.path.startsWith(resourcePrefix)) {
        return []
      }

      const relativePath = candidate.path.slice(resourcePrefix.length)
      if (!relativePath) {
        return []
      }

      return [{
        path: candidate.path,
        name: fileName(candidate.path),
        relativePath,
        size: candidate.binary?.size ?? candidate.content.length,
        updatedAt: candidate.updatedAt,
      }]
    })
    .sort(compareResourceEntries)

  // Attach sibling `skill.config` items if present (same directory lookup as
  // buildSkillRegistry, single-file scope here).
  const configFile = files.find(
    (candidate) => candidate.path === `${pathInfo.directoryPath}/skill.config`,
  )
  const configItems = configFile ? parseSkillConfig(configFile.content) : undefined

  return {
    registry: buildSkillRegistryEntry(file, pathInfo, configItems),
    file,
    resources,
  }
}
