import type {
  AgentContextEntry,
  AgentPlatformToolName,
  AgentRegistryEntry,
  SkillDetailEntry,
  SkillRegistryEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import type { LocalGameCardRecord, LocalSaveRecord } from "../storage"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  isSkillEnabledForAgent,
  loadSkillDetail,
  skillMatchesReference,
  skillMetadataReference,
} from "../agent-runtime/registry"
import { assembleAgentContext } from "../agent-runtime/context"
import {
  cardContentFilesToWorkspaceFiles,
  gameCardForSave,
  getPlatformActiveGameCard,
  isRecord,
  writeCardContentFileForCard,
} from "./internal"
import {
  getActiveSaveId,
  initializeWorkspaceForSave,
  listEffectiveWorkspaceFilesForSave,
  listLocalSaves,
  normalizeWorkspaceFilePath,
} from "../storage"
import { listBrowserAiProviderPresetOptions } from "../config/ai"

export interface PlatformStudioProviderPresetOption {
  id: string
  name: string
}

export interface PlatformStudioSnapshot {
  card: LocalGameCardRecord
  activeSaveId?: string
  usingSaveContext: boolean
  agents: AgentRegistryEntry[]
  skills: SkillRegistryEntry[]
  providerPresets: PlatformStudioProviderPresetOption[]
}

export interface PlatformStudioAgentFileWriteInput {
  agentId: string
  fileName: "AGENT.md" | "SOUL.md"
  content: string
}

export interface PlatformStudioAgentSkillToggleInput {
  agentId: string
  skillPath: string
  enabled: boolean
}

export interface PlatformStudioAgentPlatformToolToggleInput {
  agentId: string
  tool: AgentPlatformToolName
  enabled: boolean
}

export interface PlatformStudioAgentWorkspaceAccessInput {
  agentId: string
  level: number
}

export interface PlatformStudioAgentProviderPresetInput {
  agentId: string
  providerPresetId: string | null
}

async function activeStudioWorkspaceFiles(
  card: LocalGameCardRecord,
): Promise<{
  files: WorkspaceFile[]
  activeSaveId?: string
  usingSaveContext: boolean
}> {
  const activeSaveId = await getActiveSaveId()
  const activeSave = activeSaveId
    ? (await listLocalSaves()).find((save) => save.id === activeSaveId)
    : undefined
  const activeSaveCard = activeSave ? await gameCardForSave(activeSave) : null
  if (activeSave && activeSaveCard?.id === card.id) {
    await initializeWorkspaceForSave(activeSave.id)
    return {
      files: await listEffectiveWorkspaceFilesForSave(activeSave.id, card),
      activeSaveId: activeSave.id,
      usingSaveContext: true,
    }
  }

  return {
    files: await cardContentFilesToWorkspaceFiles(card),
    ...(activeSaveId ? { activeSaveId } : {}),
    usingSaveContext: false,
  }
}

export async function getPlatformStudioSnapshot(): Promise<PlatformStudioSnapshot> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agents = buildAgentRegistry(context.files)
  const skills = buildSkillRegistry(context.files)

  return {
    card,
    ...(context.activeSaveId ? { activeSaveId: context.activeSaveId } : {}),
    usingSaveContext: context.usingSaveContext,
    agents,
    skills,
    providerPresets: listBrowserAiProviderPresetOptions(),
  }
}

export async function getPlatformStudioAgentContext(
  agentId: string,
): Promise<AgentContextEntry | null> {
  const normalizedAgentId = agentId.trim()
  if (!normalizedAgentId) {
    return null
  }

  const card = await getPlatformActiveGameCard()
  if (!card) {
    return null
  }

  const context = await activeStudioWorkspaceFiles(card)
  return assembleAgentContext(context.files, { agentId: normalizedAgentId })
}

export async function getPlatformStudioSkillDetail(
  path: string,
): Promise<SkillDetailEntry | null> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    return null
  }

  try {
    const context = await activeStudioWorkspaceFiles(card)
    return loadSkillDetail(context.files, normalizeWorkspaceFilePath(path))
  } catch {
    return null
  }
}

function agentDirectoryFromFilePath(path: string): string {
  const suffix = "/AGENT.md"
  if (!path.endsWith(suffix)) {
    throw new Error(`Agent path must end with AGENT.md: ${path}`)
  }
  return path.slice(0, -suffix.length)
}

function soulPathForAgent(agent: AgentRegistryEntry): string {
  return `${agentDirectoryFromFilePath(agent.path)}/SOUL.md`
}

function findStudioAgent(files: WorkspaceFile[], agentId: string): AgentRegistryEntry {
  const normalizedAgentId = agentId.trim()
  const agent = buildAgentRegistry(files).find((candidate) => candidate.id === normalizedAgentId)
  if (!agent) {
    throw new Error(`Agent "${normalizedAgentId}" 不存在。`)
  }
  return agent
}

function findStudioSkill(files: WorkspaceFile[], path: string): SkillRegistryEntry {
  const normalizedPath = normalizeWorkspaceFilePath(path)
  const skill = buildSkillRegistry(files).find((candidate) => candidate.path === normalizedPath)
  if (!skill) {
    throw new Error(`Skill "${normalizedPath}" 不存在。`)
  }
  return skill
}

function normalizeSkillList(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const item = value.trim()
    const key = item.toLowerCase()
    if (!item || seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push(item)
  }
  return normalized
}

export function removeSkillReferences(
  values: string[],
  skill: SkillRegistryEntry,
): string[] {
  return normalizeSkillList(values)
    .filter((value) => !skillMatchesReference(skill, value))
}

export function appendSkillReference(
  values: string[],
  skill: SkillRegistryEntry,
): string[] {
  return normalizeSkillList([
    ...removeSkillReferences(values, skill),
    skillMetadataReference(skill),
  ])
}

export function removePlatformToolReference(
  values: AgentPlatformToolName[],
  tool: AgentPlatformToolName,
): AgentPlatformToolName[] {
  return values.filter((value) => value !== tool)
}

export function appendPlatformToolReference(
  values: AgentPlatformToolName[],
  tool: AgentPlatformToolName,
): AgentPlatformToolName[] {
  return Array.from(new Set([
    ...removePlatformToolReference(values, tool),
    tool,
  ]))
}

export function normalizeWorkspaceAccessLevel(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.max(0, Math.min(4, Math.floor(value)))
}

function agentConfigFileForAgent(
  files: WorkspaceFile[],
  agent: AgentRegistryEntry,
): WorkspaceFile {
  const file = files.find((candidate) => candidate.path === agent.configPath)
  if (!file) {
    throw new Error(`Agent 配置文件 "${agent.configPath}" 不存在。`)
  }
  return file
}

export function parseAgentConfigRecord(file: WorkspaceFile): Record<string, unknown> {
  try {
    const parsed = JSON.parse(file.content) as unknown
    if (isRecord(parsed)) {
      return parsed
    }
  } catch {
    // Fall through to the normalized error below.
  }

  throw new Error(`Agent 配置文件 "${file.path}" 不是有效 JSON 对象。`)
}

function writeAgentConfigRecord(
  cardId: string,
  agent: AgentRegistryEntry,
  config: Record<string, unknown>,
): Promise<WorkspaceFile> {
  return writeCardContentFileForCard(cardId, {
    path: agent.configPath,
    content: JSON.stringify(config, null, 2) + "\n",
  })
}

export async function writePlatformStudioAgentFile(
  input: PlatformStudioAgentFileWriteInput,
): Promise<WorkspaceFile> {
  if (typeof input.content !== "string") {
    throw new Error("文件内容必须是字符串。")
  }

  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const path = input.fileName === "AGENT.md"
    ? agent.path
    : soulPathForAgent(agent)

  return writeCardContentFileForCard(card.id, {
    path,
    content: input.content,
  })
}

export async function updatePlatformStudioAgentSkillEnabled(
  input: PlatformStudioAgentSkillToggleInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const skill = findStudioSkill(context.files, input.skillPath)
  if (skill.scope === "agent-local" && skill.agentId !== agent.id) {
    throw new Error("这个 Agent 不能启用其它 Agent 目录下的 Skill。")
  }

  let enabledSkills = removeSkillReferences(agent.enabledSkills, skill)
  let disabledSkills = removeSkillReferences(agent.disabledSkills, skill)

  if (input.enabled) {
    const nextAgent = {
      ...agent,
      enabledSkills,
      disabledSkills,
    }
    if (!isSkillEnabledForAgent(skill, nextAgent)) {
      enabledSkills = appendSkillReference(enabledSkills, skill)
    }
  } else {
    const nextAgent = {
      ...agent,
      enabledSkills,
      disabledSkills,
    }
    if (isSkillEnabledForAgent(skill, nextAgent)) {
      disabledSkills = appendSkillReference(disabledSkills, skill)
    }
  }

  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingSkills = isRecord(config.skills) ? config.skills : {}

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    skills: {
      ...existingSkills,
      enabled: enabledSkills,
      disabled: disabledSkills,
    },
  })
}

export async function updatePlatformStudioAgentPlatformToolEnabled(
  input: PlatformStudioAgentPlatformToolToggleInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  let enabled = removePlatformToolReference(agent.platformTools.enabled, input.tool)
  let disabled = removePlatformToolReference(agent.platformTools.disabled, input.tool)
  // 无条件 append 到目标侧：removePlatformToolReference 已清理对侧，显式落盘
  // 表达用户明确意图。不依赖 isAgentPlatformToolEnabled 判断——默认态派生会让
  // "启用一个默认就开的工具"误判为已开而跳过写入（与 local-assistant.ts 同 bug）。
  if (input.enabled) {
    enabled = appendPlatformToolReference(enabled, input.tool)
  } else {
    disabled = appendPlatformToolReference(disabled, input.tool)
  }

  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingTools = isRecord(config.platformTools) ? config.platformTools : {}

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    platformTools: {
      ...existingTools,
      enabled,
      disabled,
    },
  })
}

export async function updatePlatformStudioAgentWorkspaceAccess(
  input: PlatformStudioAgentWorkspaceAccessInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingAccess = isRecord(config.workspaceAccess) ? config.workspaceAccess : {}

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    workspaceAccess: {
      ...existingAccess,
      level: normalizeWorkspaceAccessLevel(input.level),
    },
  })
}

export async function updatePlatformStudioAgentProviderPreset(
  input: PlatformStudioAgentProviderPresetInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)

  const nextConfig: Record<string, unknown> = { ...config }
  const presetId = input.providerPresetId?.trim() ?? ""
  if (presetId) {
    nextConfig.providerPresetId = presetId
  } else {
    delete nextConfig.providerPresetId
  }

  return writeAgentConfigRecord(card.id, agent, nextConfig)
}
