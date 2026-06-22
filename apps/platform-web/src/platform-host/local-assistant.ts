import type {
  AgentPlatformToolName,
  AgentRegistryEntry,
  SkillRegistryEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import type { BrowserAiToolCallMode } from "../config/ai"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  isSkillEnabledForAgent,
} from "../agent-runtime/registry"
import { isAgentPlatformToolEnabled } from "../agent-runtime/permissions"
import {
  buildAgentProviderPresetMap,
  isRecord,
  resolveAgentModelConfig,
} from "./internal"
import {
  getBrowserAiConfig,
  listBrowserAiProviderPresetOptions,
} from "../config/ai"
import {
  loadLocalAssistantFiles,
  saveLocalAssistantFiles,
  LOCAL_ASSISTANT_AGENT_ID,
  normalizeWorkspaceFilePath,
} from "../storage"
import {
  parseAgentConfigRecord,
  removeSkillReferences,
  appendSkillReference,
  removePlatformToolReference,
  appendPlatformToolReference,
  normalizeWorkspaceAccessLevel,
  type PlatformStudioProviderPresetOption,
} from "./studio-agents"

export interface LocalAssistantSkillToggleInput {
  skillPath: string
  enabled: boolean
}

export interface LocalAssistantPlatformToolToggleInput {
  tool: AgentPlatformToolName
  enabled: boolean
}

const LOCAL_ASSISTANT_AGENT_CONFIG_PATH = ".tsian/local/assistant/agent.json"

/**
 * Resolve the desktop assistant's workspace actor level from its agent.json
 * (`workspaceAccess.level`). The desktop assistant is the platform management
 * assistant — a high-trust actor distinct from runtime game agents — and its
 * configured level must drive workspace access decisions, not a hardcoded
 * fallback. Returns undefined when the config is missing/unparseable, so the
 * caller falls back to `resolveWorkspaceActorLevel`'s default (1).
 */
export async function resolveLocalAssistantActorLevel(): Promise<number | undefined> {
  const files = await loadLocalAssistantFiles()
  const configFile = files.find((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  if (!configFile) {
    return undefined
  }
  try {
    const parsed = JSON.parse(configFile.content) as unknown
    const access = isRecord(parsed) && isRecord(parsed.workspaceAccess) ? parsed.workspaceAccess : undefined
    const level = access?.level
    return typeof level === "number" && Number.isFinite(level)
      ? Math.max(0, Math.min(4, Math.floor(level)))
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the local assistant's current provider preset id and available presets.
 * Used by the Assistant chat UI to render the provider selection control.
 */
export async function getLocalAssistantProviderPreset(): Promise<{
  providerPresetId: string
  presets: PlatformStudioProviderPresetOption[]
}> {
  const files = await loadLocalAssistantFiles()
  const configFile = files.find((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  let providerPresetId = ""
  if (configFile) {
    try {
      const parsed = JSON.parse(configFile.content) as unknown
      if (isRecord(parsed) && typeof parsed.providerPresetId === "string") {
        providerPresetId = parsed.providerPresetId
      }
    } catch {
      // Ignore parse errors; treat as no selection.
    }
  }
  return {
    providerPresetId,
    presets: listBrowserAiProviderPresetOptions(),
  }
}

/**
 * Update the local assistant's provider preset selection by rewriting
 * .tsian/local/assistant/agent.json via the Dexie meta store.
 */
export async function updateLocalAssistantProviderPreset(
  providerPresetId: string | null,
): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const presetId = providerPresetId?.trim() ?? ""

  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const nextConfig = { ...config }
    if (presetId) {
      nextConfig.providerPresetId = presetId
    } else {
      delete nextConfig.providerPresetId
    }
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify(nextConfig, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    // agent.json should always exist (seeded on first load), but handle gracefully.
    const nextConfig: Record<string, unknown> = {}
    if (presetId) {
      nextConfig.providerPresetId = presetId
    }
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify(nextConfig, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }

  await saveLocalAssistantFiles(files)
}

/**
 * Local assistant config snapshot consumed by the Assistant config panel.
 * `agent` is the resolved registry entry (skills/tools/workspace state);
 * `skills` lists every skill visible to the assistant (shared + agent-local);
 * `providerPresets` lists saved presets for the provider dropdown.
 */
export interface LocalAssistantConfig {
  agent: AgentRegistryEntry | null
  skills: SkillRegistryEntry[]
  providerPresets: PlatformStudioProviderPresetOption[]
}

/**
 * Read the local assistant's full config for the Assistant config panel.
 * Resolves the agent registry entry via `buildAgentRegistry`, the skill list
 * via `buildSkillRegistry` (shared + agent-local, same scope as StudioView),
 * and the saved provider presets for the dropdown.
 */
export async function getLocalAssistantConfig(): Promise<LocalAssistantConfig> {
  const files = await loadLocalAssistantFiles()
  const agent = buildAgentRegistry(files).find((candidate) => candidate.id === LOCAL_ASSISTANT_AGENT_ID) ?? null
  const skills = buildSkillRegistry(files, {
    includeShared: true,
    includeLocal: true,
    agentId: LOCAL_ASSISTANT_AGENT_ID,
  })
  return {
    agent,
    skills,
    providerPresets: listBrowserAiProviderPresetOptions(),
  }
}

/**
 * Toggle a skill on the local assistant by rewriting
 * `.tsian/local/assistant/agent.json` via the Dexie meta store.
 * Mirrors the card-agent setter but simplified for the fixed single assistant.
 */
export async function updateLocalAssistantSkillEnabled(
  input: LocalAssistantSkillToggleInput,
): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const skill = buildSkillRegistry(files).find((candidate) => candidate.path === normalizeWorkspaceFilePath(input.skillPath))
  if (!skill) {
    throw new Error(`Skill "${input.skillPath}" 不存在。`)
  }
  // agent-local skills can only be toggled by their owning agent; the local
  // assistant owns the `.tsian/local/assistant/skills/` tree, so reject others.
  if (skill.scope === "agent-local" && skill.agentId !== LOCAL_ASSISTANT_AGENT_ID) {
    throw new Error("这个 Agent 不能启用其它 Agent 目录下的 Skill。")
  }
  const existingAgent = buildAgentRegistry(files).find((candidate) => candidate.id === LOCAL_ASSISTANT_AGENT_ID)
  let enabledSkills = removeSkillReferences(existingAgent?.enabledSkills ?? [], skill)
  let disabledSkills = removeSkillReferences(existingAgent?.disabledSkills ?? [], skill)
  if (input.enabled) {
    const nextAgent = existingAgent
      ? { ...existingAgent, enabledSkills, disabledSkills }
      : null
    if (!nextAgent || !isSkillEnabledForAgent(skill, nextAgent)) {
      enabledSkills = appendSkillReference(enabledSkills, skill)
    }
  } else {
    const nextAgent = existingAgent
      ? { ...existingAgent, enabledSkills, disabledSkills }
      : null
    if (!nextAgent || isSkillEnabledForAgent(skill, nextAgent)) {
      disabledSkills = appendSkillReference(disabledSkills, skill)
    }
  }
  const nextSkills = { enabled: enabledSkills, disabled: disabledSkills }
  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const existingSkills = isRecord(config.skills) ? config.skills : {}
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify({ ...config, skills: { ...existingSkills, ...nextSkills } }, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify({ skills: nextSkills }, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }
  await saveLocalAssistantFiles(files)
}

/**
 * Toggle a platform tool on the local assistant by rewriting
 * `.tsian/local/assistant/agent.json` via the Dexie meta store.
 */
export async function updateLocalAssistantPlatformToolEnabled(
  input: LocalAssistantPlatformToolToggleInput,
): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const existingAgent = buildAgentRegistry(files).find((candidate) => candidate.id === LOCAL_ASSISTANT_AGENT_ID)
  let enabled = removePlatformToolReference(existingAgent?.platformTools.enabled ?? [], input.tool)
  let disabled = removePlatformToolReference(existingAgent?.platformTools.disabled ?? [], input.tool)
  if (input.enabled) {
    const nextAgent = existingAgent
      ? { ...existingAgent, platformTools: { enabled, disabled } }
      : null
    if (!nextAgent || !isAgentPlatformToolEnabled(nextAgent, input.tool)) {
      enabled = appendPlatformToolReference(enabled, input.tool)
    }
  } else {
    const nextAgent = existingAgent
      ? { ...existingAgent, platformTools: { enabled, disabled } }
      : null
    if (!nextAgent || isAgentPlatformToolEnabled(nextAgent, input.tool)) {
      disabled = appendPlatformToolReference(disabled, input.tool)
    }
  }
  const nextTools = { enabled, disabled }
  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const existingTools = isRecord(config.platformTools) ? config.platformTools : {}
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify({ ...config, platformTools: { ...existingTools, ...nextTools } }, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify({ platformTools: nextTools }, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }
  await saveLocalAssistantFiles(files)
}

/**
 * Set the local assistant's workspace access level by rewriting
 * `.tsian/local/assistant/agent.json` via the Dexie meta store.
 * The level is clamped to 0-4 by `normalizeWorkspaceAccessLevel`.
 */
export async function updateLocalAssistantWorkspaceAccess(level: number): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const nextLevel = normalizeWorkspaceAccessLevel(level)
  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const existingAccess = isRecord(config.workspaceAccess) ? config.workspaceAccess : {}
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify({ ...config, workspaceAccess: { ...existingAccess, level: nextLevel } }, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify({ workspaceAccess: { level: nextLevel } }, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }
  await saveLocalAssistantFiles(files)
}

/**
 * Resolve the local assistant agent's currently effective tool-call mode.
 * Mirrors the resolution used by the chat turn: the selected provider preset's
 * primary model `toolCallMode`, falling back to the platform-global active
 * provider, then to `"text"`. Used by AssistantView to surface the active mode.
 */
export async function getLocalAssistantToolCallMode(): Promise<BrowserAiToolCallMode> {
  const files = await loadLocalAssistantFiles()
  const presetMap = buildAgentProviderPresetMap(files)
  const resolved = resolveAgentModelConfig(LOCAL_ASSISTANT_AGENT_ID, presetMap)
  return resolved?.toolCallMode ?? getBrowserAiConfig()?.toolCallMode ?? "text"
}
