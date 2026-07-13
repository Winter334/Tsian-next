import type {
  AgentContextEntry,
  AgentRegistryEntry,
  ContextInjection,
  ContextPathPosition,
  ToolRegistryEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  buildToolRegistry,
  filterSkillsForAgent,
  filterToolsForAgent,
} from "./registry"
import { expandMacros, normalizeWorkspaceFilePath } from "./macro-engine"

export interface AgentContextAssemblyOptions {
  agentId?: string
  agentPath?: string
  /** Optional host-level filter for user Tools after Agent enablement/scoping. */
  toolFilter?: (tool: ToolRegistryEntry) => boolean
}

const AGENT_FILE_NAME = "AGENT.md"
const SOUL_FILE_NAME = "SOUL.md"
const PREFILL_FILE_NAME = "PREFILL.md"

function cleanString(value: string | undefined): string | undefined {
  const cleaned = value?.trim()
  return cleaned || undefined
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
  // Local agents (under .tsian/local/) store notes in their own directory.
  // Card agents (under agents/) store them under save/<agentDir>/.
  const isLocalAgent = agentDirectory?.startsWith(".tsian/local/")
  const notesFile = agentDirectory
    ? filesByPath.get(
        isLocalAgent
          ? `${agentDirectory}/notes.md`
          : `save/${agentDirectory}/notes.md`,
      )
    : undefined
  const soulFile = agentDirectory
    ? filesByPath.get(`${agentDirectory}/${SOUL_FILE_NAME}`)
    : undefined
  const prefillFile = agentDirectory
    ? filesByPath.get(`${agentDirectory}/${PREFILL_FILE_NAME}`)
    : undefined

  /** 按 position 分组的注入缓冲区。4 个数组始终存在（即使为空）。 */
  const contextInjectionsByPosition: Record<
    ContextPathPosition,
    ContextInjection[]
  > = {
    "before-history": [],
    "workspace-context": [],
    "after-input": [],
    tail: [],
  }
  const missingContextPaths: string[] = []

  for (const entry of agent.contextPaths) {
    // 1. Resolve entry form → raw content, role, source, baseDir, position for macros.
    let rawContent: string
    let role: "system" | "user" | "assistant"
    let source: string
    let baseDir: string
    let position: ContextPathPosition

    if (typeof entry === "string") {
      // Pure string: read file, role=user (backward compat), default position.
      const path = normalizeWorkspaceFilePath(entry)
      const file = path ? filesByPath.get(path) : undefined
      if (!file || !path) {
        missingContextPaths.push(path ?? entry)
        continue
      }
      rawContent = file.content
      role = "user"
      source = file.path
      baseDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
      position = "workspace-context"
    } else if (entry.path) {
      // Path object: read file, role may be specified.
      const path = normalizeWorkspaceFilePath(entry.path)
      const file = path ? filesByPath.get(path) : undefined
      if (!file || !path) {
        missingContextPaths.push(path ?? entry.path)
        continue
      }
      rawContent = file.content
      role = entry.role ?? "user"
      source = file.path
      baseDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""
      position = entry.position ?? "workspace-context"
    } else if (entry.template) {
      // Template object: inline template string, role may be specified.
      rawContent = entry.template
      role = entry.role ?? "user"
      source = "inline template"
      baseDir = agentDirectory ?? ""
      position = entry.position ?? "workspace-context"
    } else {
      continue
    }

    // 2. Expand macros ({{file:...}}, {{random:...}}, implicit whitespace cleanup).
    //    enabledModules empty → pass undefined so ?enabled defaults to include.
    const expanded = expandMacros(rawContent, {
      baseDir,
      filesByPath,
      enabledModules: agent.enabledModules.length > 0 ? agent.enabledModules : undefined,
    })
    missingContextPaths.push(...expanded.missing)

    // 3. Skip empty content — no empty messages injected.
    const content = expanded.content.trim()
    if (!content) {
      continue
    }

    // 4. Resolve position: missing/invalid → "workspace-context" (backward compat).
    //    Position was resolved per-branch above (string entries default, object
    //    entries read entry.position). Group the compiled injection accordingly.
    contextInjectionsByPosition[position].push({ role, content, source, position })
  }

  // PREFILL.md legacy compat migration: when no contextPath declared `position:
  // "tail"`, auto-create a tail injection from PREFILL.md so existing agents
  // (and old game-card archives) keep their prefill behavior without config
  // changes. If the tail group already has entries, PREFILL.md is ignored.
  if (
    contextInjectionsByPosition["tail"].length === 0 &&
    prefillFile &&
    prefillFile.content.trim()
  ) {
    contextInjectionsByPosition["tail"].push({
      role: "assistant",
      content: prefillFile.content,
      source: "PREFILL.md (compat)",
      position: "tail",
    })
  }

  const contextInjections = contextInjectionsByPosition["workspace-context"]

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

  const toolRegistry = buildToolRegistry(files)
  const filteredTools = filterToolsForAgent(toolRegistry.tools, agent)
  const toolIndex = options.toolFilter
    ? filteredTools.tools.filter(options.toolFilter)
    : filteredTools.tools
  // Tool registry diagnostics are surfaced through Studio / assistant config
  // diagnostics channels. Runtime context keeps only visible callable entries.
  void toolRegistry.diagnostics
  void filteredTools.diagnostics

  const entry: AgentContextEntry = {
    agent,
    agentFile,
    skillIndex: filterSkillsForAgent(
      buildSkillRegistry(files, { agentId: agent.id }),
      agent,
    ),
    toolIndex,
    contextInjectionsByPosition,
    contextInjections,
    knowledgeFiles,
    missingContextPaths,
  }

  if (soulFile) {
    entry.soulFile = soulFile
  }
  if (notesFile) {
    entry.notesFile = notesFile
  }
  if (prefillFile) {
    entry.prefillFile = prefillFile
  }

  return entry
}
