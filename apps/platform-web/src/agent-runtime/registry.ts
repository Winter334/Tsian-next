import type {
  AgentRegistryEntry,
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

interface SkillPathInfo {
  scope: SkillRegistryScope
  skillId: string
  directoryPath: string
  agentId?: string
}

const AGENT_FILE_PATH_PATTERN = /^agents\/([^/]+)\/AGENT\.md$/
const SHARED_SKILL_FILE_PATH_PATTERN = /^skills\/([^/]+)\/SKILL\.md$/
const AGENT_LOCAL_SKILL_FILE_PATH_PATTERN = /^agents\/([^/]+)\/skills\/([^/]+)\/SKILL\.md$/

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
  if (localMatch?.[1] && localMatch[2]) {
    const agentId = localMatch[1]
    const skillId = localMatch[2]
    return {
      scope: "agent-local",
      agentId,
      skillId,
      directoryPath: `agents/${agentId}/skills/${skillId}`,
    }
  }

  return null
}

function buildSkillRegistryEntry(
  file: WorkspaceFile,
  pathInfo: SkillPathInfo,
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

export function buildAgentRegistry(files: WorkspaceFile[]): AgentRegistryEntry[] {
  return files
    .flatMap((file): AgentRegistryEntry[] => {
      const match = AGENT_FILE_PATH_PATTERN.exec(file.path)
      if (!match?.[1]) {
        return []
      }

      const parsed = parseMarkdown(file.content)
      const pathAgentId = match[1]
      const id = metadataString(parsed.metadata, ["id", "name"]) ?? pathAgentId
      const title =
        metadataString(parsed.metadata, ["title", "name"]) ??
        firstHeading(parsed.body) ??
        id

      return [{
        id,
        title,
        summary:
          metadataString(parsed.metadata, ["summary", "description"]) ??
          firstBodyParagraph(parsed.body),
        path: file.path,
        contacts: metadataArray(parsed.metadata, ["contacts"]),
        defaultSkills: metadataArray(parsed.metadata, ["defaultSkills"]),
        contextPaths: metadataArray(parsed.metadata, ["contextPaths"]),
        updatedAt: file.updatedAt,
      }]
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

      return [buildSkillRegistryEntry(file, pathInfo)]
    })
    .sort(compareSkillEntries)
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
        mediaType: candidate.mediaType,
        size: candidate.content.length,
        updatedAt: candidate.updatedAt,
      }]
    })
    .sort(compareResourceEntries)

  return {
    registry: buildSkillRegistryEntry(file, pathInfo),
    file,
    resources,
  }
}
