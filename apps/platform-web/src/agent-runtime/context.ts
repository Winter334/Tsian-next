import type {
  AgentContextEntry,
  AgentRegistryEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import { buildAgentRegistry, buildSkillRegistry, filterSkillsForAgent } from "./registry"

export interface AgentContextAssemblyOptions {
  agentId?: string
  agentPath?: string
}

const AGENT_FILE_NAME = "AGENT.md"
const SOUL_FILE_NAME = "SOUL.md"

function cleanString(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned || undefined
}

function normalizeWorkspaceFilePath(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) {
    return null
  }

  const hadTrailingSlash = /[\\/]$/.test(raw)
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (!normalized || hadTrailingSlash) {
    return null
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    return null
  }

  return normalized
}

function findAgent(
  agents: AgentRegistryEntry[],
  options: AgentContextAssemblyOptions,
): AgentRegistryEntry | null {
  const agentPath = normalizeWorkspaceFilePath(options.agentPath)
  if (agentPath) {
    return agents.find((agent) => agent.path === agentPath) ?? null
  }

  const agentId = cleanString(options.agentId)
  if (!agentId) {
    return null
  }

  return agents.find((agent) => agent.id === agentId) ?? null
}

function agentDirectoryPath(agentFilePath: string): string | null {
  const suffix = `/${AGENT_FILE_NAME}`
  if (!agentFilePath.endsWith(suffix)) {
    return null
  }

  return agentFilePath.slice(0, -suffix.length)
}

export function assembleAgentContext(
  files: WorkspaceFile[],
  options: AgentContextAssemblyOptions,
): AgentContextEntry | null {
  const agents = buildAgentRegistry(files)
  const agent = findAgent(agents, options)
  if (!agent) {
    return null
  }

  const filesByPath = new Map(files.map((file) => [file.path, file]))
  const agentFile = filesByPath.get(agent.path)
  if (!agentFile) {
    return null
  }

  const agentDirectory = agentDirectoryPath(agent.path)
  // Local agents (under .tsian/local/) store notes/session in their own directory.
  // Card agents (under agents/) store them under save/<agentDir>/.
  const isLocalAgent = agentDirectory?.startsWith(".tsian/local/")
  const notesFile = agentDirectory
    ? filesByPath.get(
        isLocalAgent
          ? `${agentDirectory}/notes.md`
          : `save/${agentDirectory}/notes.md`,
      )
    : undefined
  const sessionFile = agentDirectory
    ? filesByPath.get(
        isLocalAgent
          ? `${agentDirectory}/session.jsonl`
          : `save/${agentDirectory}/session.jsonl`,
      )
    : undefined
  const soulFile = agentDirectory
    ? filesByPath.get(`${agentDirectory}/${SOUL_FILE_NAME}`)
    : undefined
  const contextFiles: WorkspaceFile[] = []
  const missingContextPaths: string[] = []

  for (const declaredPath of agent.contextPaths) {
    const path = normalizeWorkspaceFilePath(declaredPath)
    const file = path ? filesByPath.get(path) : undefined
    if (file) {
      contextFiles.push(file)
      continue
    }

    missingContextPaths.push(path ?? declaredPath)
  }

  const knowledgeFiles: WorkspaceFile[] = []
  if (agent.knowledgeMount) {
    const mountDir = agent.knowledgeMount.replace(/\/+$/, "")
    const prefix = `${mountDir}/`
    for (const file of files) {
      if (file.path === mountDir || file.path.startsWith(prefix)) {
        knowledgeFiles.push(file)
      }
    }
  }

  const entry: AgentContextEntry = {
    agent,
    agentFile,
    skillIndex: filterSkillsForAgent(
      buildSkillRegistry(files, { agentId: agent.id }),
      agent,
    ),
    contextFiles,
    knowledgeFiles,
    missingContextPaths,
  }

  if (soulFile) {
    entry.soulFile = soulFile
  }
  if (notesFile) {
    entry.notesFile = notesFile
  }
  if (sessionFile) {
    entry.sessionFile = sessionFile
  }

  return entry
}
