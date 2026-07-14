import type {
  AgentContextEntry,
  AgentPlatformToolName,
  AgentRegistryEntry,
  ContextPathEntry,
  ContextPathObject,
  ContextPathPosition,
  MessageLayersConfig,
  RegistryDiagnostic,
  SkillDetailEntry,
  SkillRegistryEntry,
  ToolRegistryEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import type { LocalGameCardRecord } from "../storage"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  buildToolRegistry,
  isSkillEnabledForAgent,
  isToolEnabledForAgent,
  loadSkillDetail,
  skillMatchesReference,
  skillMetadataReference,
  toolMatchesReference,
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
  deleteLocalGameCardContentPathForCard,
  getActiveSaveId,
  initializeWorkspaceForSave,
  listEffectiveWorkspaceFilesForSave,
  listLocalSaves,
  normalizeWorkspaceFilePath,
  deleteSkillConfig,
} from "../storage"
import { listBrowserAiProviderPresetOptions } from "../config/ai"

export interface PlatformStudioProviderPresetOption {
  id: string
  name: string
}

/**
 * One discoverable rule-module file under `agents/<agentId>/modules/` or
 * `.tsian/local/<agentId>/modules/`. Studio renders a per-module Switch
 * whose state reflects whether `agent.enabledModules` includes `stem`; the
 * stem is what `{{file:modules/...md?enabled}}` matches against
 * (see `macro-engine.ts` `fileStem`).
 */
export interface PlatformStudioModuleInfo {
  /** Agent id that owns this module. */
  agentId: string
  /** File stem (filename without extension) — matched against `enabledModules`. */
  stem: string
  /** Display name extracted from the file's first `# ` line, fallback to stem. */
  title: string
  /** Workspace file path. */
  path: string
}

export interface PlatformStudioSnapshot {
  card: LocalGameCardRecord
  activeSaveId?: string
  usingSaveContext: boolean
  agents: AgentRegistryEntry[]
  skills: SkillRegistryEntry[]
  /**
   * All Tool manifests discovered in the workspace (shared + agent-local +
   * `.tsian/local/**`). Studio renders per-Agent enable/disable state by
   * cross-referencing this list with `agent.tools.enabled/disabled` and the
   * usual same-name-shadowing rules (see `filterToolsForAgent`). Empty when no
   * `tool.json` files are present.
   */
  tools: ToolRegistryEntry[]
  /**
   * Registry-health diagnostics collected during Tool discovery for the
   * current workspace. Studio renders a badge + panel listing severity, code,
   * message, path, hint. Skill-side diagnostics still flow through their own
   * `SkillRegistryEntry.errors` field — the tool layer is additive.
   */
  toolDiagnostics: RegistryDiagnostic[]
  /**
   * Rule-module files discovered under `agents/<id>/modules/` (and
   * `.tsian/local/<id>/modules/`). Studio renders a per-Agent "规则模块"
   * Switch section; toggling updates `agent.enabledModules` (the list the
   * `{{file:...?enabled}}` macro consults). Empty when no module files exist.
   */
  modules: PlatformStudioModuleInfo[]
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

export interface PlatformStudioAgentSkillDeleteInput {
  skillPath: string
}

/**
 * Toggle a Tool's visibility for a specific Agent. Mirrors the Skill toggle
 * flow: rewrites `agent.json.tools.enabled/disabled` such that the tool ends
 * up in the requested state under the same shadow/whitelist rules used at
 * runtime (`isToolEnabledForAgent`).
 *
 * `toolName` is the wire name declared in `tool.json` (`ToolRegistryEntry.name`).
 * Tools in the `.tsian/local/**` scope are not distributed but are still
 * gated by the same `enabled/disabled` fields.
 */
export interface PlatformStudioAgentToolToggleInput {
  agentId: string
  toolName: string
  enabled: boolean
}

export interface PlatformStudioAgentPlatformToolToggleInput {
  agentId: string
  tool: AgentPlatformToolName
  enabled: boolean
}

/**
 * Toggle a rule module's enabled state for a specific Agent. Mirrors the
 * Skill/Tool toggle flow: rewrites `agent.json.enabledModules` such that the
 * module stem ends up in (enabled=true) or out of (enabled=false) the list
 * that `{{file:modules/*.md?enabled}}` consults.
 *
 * `moduleStem` is the module file's name without extension (the same value
 * `macro-engine.ts` `fileStem` produces).
 */
export interface PlatformStudioAgentModuleToggleInput {
  agentId: string
  moduleStem: string
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

export interface PlatformStudioAgentContextPathsUpdateInput {
  agentId: string
  contextPaths: ContextPathEntry[]
  enabledModules?: string[]
  messageLayers?: MessageLayersConfig
}

const MESSAGE_LAYER_KEYS: Array<keyof MessageLayersConfig> = [
  "historySummary",
  "workspaceContextMeta",
  "toolMemory",
  "turnRuntime",
]

const CONTEXT_PATH_POSITIONS = new Set<ContextPathPosition>([
  "before-history",
  "workspace-context",
  "after-input",
  "tail",
])

function normalizeContextPathRole(value: unknown): ContextPathObject["role"] | undefined {
  return value === "system" || value === "user" || value === "assistant"
    ? value
    : undefined
}

function normalizeContextPathPosition(value: unknown): ContextPathPosition | undefined {
  return typeof value === "string" && CONTEXT_PATH_POSITIONS.has(value as ContextPathPosition)
    ? value as ContextPathPosition
    : undefined
}

function normalizeContextPathEntriesForWrite(entries: ContextPathEntry[]): ContextPathEntry[] {
  if (!Array.isArray(entries)) {
    throw new Error("contextPaths 必须是数组。")
  }

  const normalized: ContextPathEntry[] = []
  for (const entry of entries) {
    if (typeof entry === "string") {
      const path = normalizeWorkspaceFilePath(entry)
      if (path) {
        normalized.push(path)
      }
      continue
    }

    if (!isRecord(entry)) {
      continue
    }

    const path = typeof entry.path === "string"
      ? normalizeWorkspaceFilePath(entry.path)
      : ""
    const template = typeof entry.template === "string" && entry.template.trim()
      ? entry.template
      : ""
    if (!path === !template) {
      continue
    }

    const next: ContextPathObject = {}
    if (path) {
      next.path = path
    } else {
      next.template = template
    }

    const role = normalizeContextPathRole(entry.role)
    if (role) {
      next.role = role
    }
    const position = normalizeContextPathPosition(entry.position)
    if (position) {
      next.position = position
    }
    normalized.push(next)
  }

  return normalized
}

function normalizeEnabledModulesForWrite(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const item = value.trim()
    if (!item || seen.has(item)) {
      continue
    }
    seen.add(item)
    normalized.push(item)
  }
  return normalized
}

function normalizeMessageLayersForWrite(value: MessageLayersConfig): MessageLayersConfig {
  if (!isRecord(value)) {
    throw new Error("messageLayers 必须是对象。")
  }

  const normalized: MessageLayersConfig = {}
  for (const key of MESSAGE_LAYER_KEYS) {
    const layer = value[key]
    if (layer === undefined) {
      continue
    }
    if (!isRecord(layer)) {
      throw new Error(`messageLayers.${key} 必须是对象。`)
    }
    const role = layer.role
    if (role === undefined) {
      continue
    }
    if (role !== "system" && role !== "user" && role !== "assistant") {
      throw new Error(`messageLayers.${key}.role 必须是 system、user 或 assistant。`)
    }
    normalized[key] = { role }
  }
  return normalized
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

/**
 * Extract a display title from module file content: the first non-empty line,
 * stripped of a leading `# ` heading marker. Falls back to `stem` when the
 * file has no heading (or is empty), matching how skill titles fall back to
 * the file stem elsewhere.
 */
function extractModuleTitle(content: string, stem: string): string {
  const firstLine = content.split("\n").find((line) => line.trim())
  if (firstLine && firstLine.startsWith("# ")) {
    return firstLine.slice(2).trim()
  }
  return stem
}

/**
 * Discover rule-module files for every Agent in the workspace. Matches both
 * the distributed `agents/<id>/modules/` layout and the local-only
 * `.tsian/local/<id>/modules/` layout (the latter mirrors how local skills
 * and tools shadow their distributed counterparts). Returns a flat list keyed
 * by `agentId`; Studio filters per selected Agent.
 */
function discoverPlatformStudioModules(
  files: WorkspaceFile[],
): PlatformStudioModuleInfo[] {
  const modules: PlatformStudioModuleInfo[] = []
  // `agents/<id>/modules/.../<name>.md` and
  // `.tsian/local/<id>/modules/.../<name>.md` mirror macro resolution where
  // `{{file:modules/...}}` is relative to the Agent directory.
  for (const file of files) {
    const segments = file.path.split("/")
    const name = segments[segments.length - 1]
    if (!name?.endsWith(".md")) continue

    let agentId: string | null = null
    if (segments[0] === "agents" && segments[2] === "modules") {
      agentId = segments[1] ?? null
    } else if (
      segments[0] === ".tsian"
      && segments[1] === "local"
      && segments[3] === "modules"
    ) {
      agentId = segments[2] ?? null
    }
    if (!agentId) continue

    const stem = name.slice(0, -".md".length)
    modules.push({
      agentId,
      stem,
      title: extractModuleTitle(file.content, stem),
      path: file.path,
    })
  }
  modules.sort((a, b) => a.path.localeCompare(b.path))
  return modules
}

export async function getPlatformStudioSnapshot(): Promise<PlatformStudioSnapshot> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agents = buildAgentRegistry(context.files)
  const skills = buildSkillRegistry(context.files)
  const toolRegistry = buildToolRegistry(context.files)
  const modules = discoverPlatformStudioModules(context.files)

  return {
    card,
    ...(context.activeSaveId ? { activeSaveId: context.activeSaveId } : {}),
    usingSaveContext: context.usingSaveContext,
    agents,
    skills,
    tools: toolRegistry.tools,
    toolDiagnostics: toolRegistry.diagnostics,
    modules,
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

function skillDirectoryFromPath(skillPath: string): string {
  const path = normalizeWorkspaceFilePath(skillPath)
  return path.endsWith("/SKILL.md")
    ? path.slice(0, -"/SKILL.md".length)
    : path
}

async function removeSkillReferencesFromAgentConfig(
  cardId: string,
  files: WorkspaceFile[],
  agent: AgentRegistryEntry,
  skill: SkillRegistryEntry,
): Promise<boolean> {
  const enabledSkills = removeSkillReferences(agent.enabledSkills, skill)
  const disabledSkills = removeSkillReferences(agent.disabledSkills, skill)
  if (
    enabledSkills.length === agent.enabledSkills.length
    && disabledSkills.length === agent.disabledSkills.length
  ) {
    return false
  }

  const configFile = agentConfigFileForAgent(files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingSkills = isRecord(config.skills) ? config.skills : {}
  await writeAgentConfigRecord(cardId, agent, {
    ...config,
    skills: {
      ...existingSkills,
      enabled: enabledSkills,
      disabled: disabledSkills,
    },
  })
  return true
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

export async function deletePlatformStudioSkill(
  input: PlatformStudioAgentSkillDeleteInput,
): Promise<{ deletedPaths: string[]; updatedAgentCount: number }> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const skill = findStudioSkill(context.files, input.skillPath)
  const agents = buildAgentRegistry(context.files)
  let updatedAgentCount = 0
  for (const agent of agents) {
    if (await removeSkillReferencesFromAgentConfig(card.id, context.files, agent, skill)) {
      updatedAgentCount += 1
    }
  }

  const deletedPaths = await deleteLocalGameCardContentPathForCard(card.id, skillDirectoryFromPath(skill.path))
  await deleteSkillConfig(skill.path)
  return { deletedPaths, updatedAgentCount }
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

/**
 * Toggle a Tool's visibility for the given Agent. Follows the same explicit-
 * intent pattern as `updatePlatformStudioAgentPlatformToolEnabled`:
 *
 * 1. Remove any prior reference from both `tools.enabled` and `tools.disabled`.
 * 2. Append to whichever list matches the requested state.
 *
 * We don't try to be clever about no-op writes: writing the explicit choice
 * defends against the same silent-drift bug that hit platform tool toggles
 * (default-state derivation makes "enable an already-enabled tool" look
 * like a no-op and skip persistence).
 *
 * `tools.enabled` is a whitelist when non-empty (see `isToolEnabledForAgent`);
 * before Studio ever emits `enabled=true` for the *first* tool, that flip
 * would flip semantics from "declare = expose" to whitelist mode. Studio
 * callers should therefore avoid adding a whitelist entry unless the user
 * explicitly opted into whitelist mode — this handler stays neutral and just
 * writes what it was told to write.
 */
export async function updatePlatformStudioAgentToolEnabled(
  input: PlatformStudioAgentToolToggleInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const toolRegistry = buildToolRegistry(context.files)
  const tool = toolRegistry.tools.find((entry) => entry.name === input.toolName)
  if (!tool) {
    throw new Error(`Tool 未找到：${input.toolName}`)
  }
  if (tool.scope === "agent-local" && tool.agentId !== agent.id) {
    throw new Error("这个 Agent 不能开关其它 Agent 的私有 Tool。")
  }

  // Drop any existing references to this tool from both lists before appending
  // the explicit choice. This mirrors `removeSkillReferences` but for Tools.
  const stripReferences = (values: string[]): string[] =>
    values.filter((value) => !toolMatchesReference(tool, value))
  const appendReference = (values: string[]): string[] => {
    const cleaned = stripReferences(values)
    return cleaned.includes(tool.name) ? cleaned : [...cleaned, tool.name]
  }

  let enabled = stripReferences(agent.enabledTools)
  let disabled = stripReferences(agent.disabledTools)
  if (input.enabled) {
    enabled = appendReference(enabled)
  } else {
    disabled = appendReference(disabled)
  }

  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingTools = isRecord((config as Record<string, unknown>).tools)
    ? ((config as Record<string, unknown>).tools as Record<string, unknown>)
    : {}

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    tools: {
      ...existingTools,
      enabled,
      disabled,
    },
  })
}

/**
 * Whether a Tool is currently visible to the Agent, using the runtime rule.
 * Studio uses this to render the correct switch state before write-through.
 */
export function isPlatformStudioToolEnabledForAgent(
  tool: ToolRegistryEntry,
  agent: AgentRegistryEntry,
): boolean {
  return isToolEnabledForAgent(tool, agent)
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

export async function updatePlatformStudioAgentContextPaths(
  input: PlatformStudioAgentContextPathsUpdateInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const nextConfig: Record<string, unknown> = {
    ...config,
    contextPaths: normalizeContextPathEntriesForWrite(input.contextPaths),
  }
  if (input.enabledModules) {
    nextConfig.enabledModules = normalizeEnabledModulesForWrite(input.enabledModules)
  }
  if (input.messageLayers) {
    const messageLayers = normalizeMessageLayersForWrite(input.messageLayers)
    if (Object.keys(messageLayers).length > 0) {
      nextConfig.messageLayers = messageLayers
    } else {
      delete nextConfig.messageLayers
    }
  }

  return writeAgentConfigRecord(card.id, agent, nextConfig)
}

/**
 * Toggle a rule module's enabled state for an Agent by rewriting
 * `agent.json.enabledModules`. Follows the same explicit-intent pattern as
 * `updatePlatformStudioAgentPlatformToolEnabled`: unconditionally remove the
 * stem from the list first, then append it when `enabled=true`. This defends
 * against the same silent-drift bug that hit platform tool toggles (default-
 * state derivation makes "enable an already-enabled module" look like a no-op
 * and skip persistence).
 *
 * `enabledModules` is the list `{{file:modules/*.md?enabled}}` consults
 * (`macro-engine.ts` `isFileEnabled`); `undefined` in the raw config means
 * "all modules included" (backward compat), but once Studio writes an explicit
 * list the macro switches to whitelist semantics.
 */
export async function updatePlatformStudioAgentModuleEnabled(
  input: PlatformStudioAgentModuleToggleInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const stem = input.moduleStem.trim()
  if (!stem) {
    throw new Error("moduleStem 不能为空。")
  }

  // Drop any prior reference, then append when enabling — explicit intent.
  let enabledModules = agent.enabledModules.filter((value) => value !== stem)
  if (input.enabled) {
    enabledModules = [...enabledModules, stem]
  }

  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    enabledModules,
  })
}
