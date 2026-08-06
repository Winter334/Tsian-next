import type {
  AgentPlatformToolName,
  AgentRegistryEntry,
  RegistryDiagnostic,
  SkillConfigItem,
  SkillRegistryEntry,
  ToolRegistryEntry,
} from "@tsian/contracts"
import { computed, onMounted, ref } from "vue"
import { isAgentPlatformToolEnabled } from "@/agent-runtime/permissions"
import {
  PLATFORM_TOOL_CONTROL_GROUPS,
  type PlatformToolControl,
} from "@/agent-runtime/tool-controls"
import { isSkillEnabledForAgent, isToolEnabledForAgent } from "@/agent-runtime/registry"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import {
  getLocalAssistantConfig,
  refreshLocalAssistantKnowledge,
  updateLocalAssistantPlatformToolEnabled,
  updateLocalAssistantSkillConfig,
  updateLocalAssistantSkillEnabled,
  updateLocalAssistantToolEnabled,
  updateLocalAssistantWorkspaceAccess,
  type LocalAssistantConfig,
} from "@/platform-host"

export type AssistantCapability =
  | {
      kind: "platform"
      key: string
      title: string
      description: string
      badge: string
      path?: string
      enabled: boolean
      disabled: boolean
      tool: PlatformToolControl
    }
  | {
      kind: "tool"
      key: string
      title: string
      description: string
      badge: string
      path: string
      enabled: boolean
      disabled: boolean
      tool: ToolRegistryEntry
    }

export const ASSISTANT_WORKSPACE_ACCESS_OPTIONS = Object.freeze([
  { level: 0, label: "只读", description: "只能读取普通游戏卡和存档内容。" },
  { level: 1, label: "可维护存档", description: "可以维护当前存档的运行时文件。" },
  { level: 2, label: "可编辑游戏卡", description: "可以编辑游戏卡内容；当前运行时仍会优先限制普通写入到存档。" },
  { level: 4, label: "平台维护", description: "允许访问平台元数据能力，仅适合受信任的维护 Agent。" },
])

export interface AssistantConfigControllerOptions {
  onChange?(): void
  onClose?(): void
}

export function useAssistantConfigController(options: AssistantConfigControllerOptions = {}) {
  const agent = ref<AgentRegistryEntry | null>(null)
  const skills = ref<SkillRegistryEntry[]>([])
  const tools = ref<ToolRegistryEntry[]>([])
  const toolDiagnostics = ref<RegistryDiagnostic[]>([])
  const skillOverrides = ref(new Map<string, boolean>())
  const platformToolOverrides = ref(new Map<AgentPlatformToolName, boolean>())
  const toolOverrides = ref(new Map<string, boolean>())
  const workspaceLevelOverride = ref<number | null>(null)
  const applying = ref(false)
  const updatingKnowledge = ref(false)
  const skillConfigInitial = ref(new Map<string, Record<string, string>>())
  const skillConfigDraft = ref(new Map<string, Record<string, string>>())

  function skillEnabled(skill: SkillRegistryEntry): boolean {
    if (skillOverrides.value.has(skill.path)) return skillOverrides.value.get(skill.path) ?? false
    return agent.value ? isSkillEnabledForAgent(skill, agent.value) : false
  }

  function platformToolEnabled(tool: AgentPlatformToolName): boolean {
    if (platformToolOverrides.value.has(tool)) return platformToolOverrides.value.get(tool) ?? false
    return agent.value ? isAgentPlatformToolEnabled(agent.value, tool) : false
  }

  function toolEnabled(tool: ToolRegistryEntry): boolean {
    if (toolOverrides.value.has(tool.name)) return toolOverrides.value.get(tool.name) ?? false
    return agent.value ? isToolEnabledForAgent(tool, agent.value) : false
  }

  const assistantCapabilities = computed<AssistantCapability[]>(() => [
    ...PLATFORM_TOOL_CONTROL_GROUPS.flatMap((group) => group.tools.map<AssistantCapability>((tool) => ({
      kind: "platform",
      key: `platform:${tool.id}`,
      title: tool.label,
      description: tool.description,
      badge: `平台能力 · ${group.title}`,
      enabled: platformToolEnabled(tool.id),
      disabled: applying.value || updatingKnowledge.value || !agent.value,
      tool,
    }))),
    ...tools.value.map<AssistantCapability>((tool) => ({
      kind: "tool",
      key: `tool:${tool.path}`,
      title: tool.name,
      description: tool.description,
      badge: "助手本地 Tool",
      path: tool.path,
      enabled: toolEnabled(tool),
      disabled: applying.value || updatingKnowledge.value || !agent.value,
      tool,
    })),
  ])

  const enabledAssistantCapabilityCount = computed(() =>
    assistantCapabilities.value.filter((capability) => capability.enabled).length,
  )
  const workspaceLevel = computed(() =>
    workspaceLevelOverride.value ?? agent.value?.workspaceAccess.level ?? 1,
  )
  const enabledSkillCount = computed(() => skills.value.filter(skillEnabled).length)
  const workspaceAccessDescription = computed(() =>
    ASSISTANT_WORKSPACE_ACCESS_OPTIONS.find((option) => option.level === workspaceLevel.value)?.description ?? "",
  )
  const hasChanges = computed(() =>
    skillOverrides.value.size > 0
    || platformToolOverrides.value.size > 0
    || toolOverrides.value.size > 0
    || workspaceLevelOverride.value !== null
    || skillConfigDraft.value.size > 0,
  )

  function isSecretKey(key: string): boolean {
    const upper = key.toUpperCase()
    return ["KEY", "SECRET", "TOKEN", "PASSWORD"].some((part) => upper.includes(part))
  }

  function configValue(skillPath: string, item: SkillConfigItem): string {
    const draft = skillConfigDraft.value.get(skillPath)
    if (draft && item.key in draft) return draft[item.key]
    const initial = skillConfigInitial.value.get(skillPath)
    if (initial && item.key in initial) return initial[item.key]
    return item.defaultValue
  }

  function setConfigValue(skillPath: string, item: SkillConfigItem, value: string): void {
    if (applying.value) return
    const initial = skillConfigInitial.value.get(skillPath) ?? {}
    const next = { ...(skillConfigDraft.value.get(skillPath) ?? {}) }
    if (value === (initial[item.key] ?? item.defaultValue)) delete next[item.key]
    else next[item.key] = value
    const nextDraft = new Map(skillConfigDraft.value)
    if (Object.keys(next).length === 0) nextDraft.delete(skillPath)
    else nextDraft.set(skillPath, next)
    skillConfigDraft.value = nextDraft
  }

  function skillConfigChanged(skillPath: string): boolean {
    return skillConfigDraft.value.has(skillPath)
  }

  function entrySummary(value: string | undefined): string {
    return value?.trim() || "暂无简介。"
  }

  function toggleSkill(skill: SkillRegistryEntry, enabled: boolean): void {
    if (applying.value) return
    const original = agent.value ? isSkillEnabledForAgent(skill, agent.value) : false
    const next = new Map(skillOverrides.value)
    if (enabled === original) next.delete(skill.path)
    else next.set(skill.path, enabled)
    skillOverrides.value = next
  }

  function togglePlatformTool(tool: AgentPlatformToolName, enabled: boolean): void {
    if (applying.value) return
    const original = agent.value ? isAgentPlatformToolEnabled(agent.value, tool) : false
    const next = new Map(platformToolOverrides.value)
    if (enabled === original) next.delete(tool)
    else next.set(tool, enabled)
    platformToolOverrides.value = next
  }

  function toggleTool(tool: ToolRegistryEntry, enabled: boolean): void {
    if (applying.value) return
    const original = agent.value ? isToolEnabledForAgent(tool, agent.value) : false
    const next = new Map(toolOverrides.value)
    if (enabled === original) next.delete(tool.name)
    else next.set(tool.name, enabled)
    toolOverrides.value = next
  }

  function toggleAssistantCapability(capability: AssistantCapability, enabled: boolean): void {
    if (capability.kind === "platform") togglePlatformTool(capability.tool.id, enabled)
    else toggleTool(capability.tool, enabled)
  }

  function updateWorkspaceAccessLevel(level: number): void {
    if (!applying.value) workspaceLevelOverride.value = level
  }

  async function reload(): Promise<void> {
    const result: LocalAssistantConfig = await getLocalAssistantConfig()
    agent.value = result.agent
    skills.value = result.skills
    tools.value = result.tools
    toolDiagnostics.value = result.toolDiagnostics
    const initial = new Map<string, Record<string, string>>()
    for (const skill of result.skills) {
      if (!skill.configItems?.length) continue
      const saved = result.skillConfigValues[skill.path] ?? {}
      const values: Record<string, string> = {}
      for (const item of skill.configItems) {
        values[item.key] = item.key in saved ? saved[item.key] : item.defaultValue
      }
      initial.set(skill.path, values)
    }
    skillConfigInitial.value = initial
  }

  async function refreshKnowledge(): Promise<void> {
    if (applying.value || updatingKnowledge.value || hasChanges.value) return
    const confirmed = await confirm({
      title: "更新助手知识",
      message: "将更新桌面助手理解 Tsian 所需的基础说明。此操作不会改变你的助手设定、风格、个人笔记、模型与权限设置、自定义能力，也不会修改当前游戏卡内容。是否继续？",
      confirmText: "更新",
      cancelText: "取消",
    })
    if (!confirmed) return
    updatingKnowledge.value = true
    try {
      const result = await refreshLocalAssistantKnowledge()
      await reload()
      options.onChange?.()
      toast.success(`助手知识已更新（${result.updatedPaths.length} 个文件）。`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新助手知识失败。")
    } finally {
      updatingKnowledge.value = false
    }
  }

  function resetOverrides(): void {
    skillOverrides.value = new Map()
    platformToolOverrides.value = new Map()
    toolOverrides.value = new Map()
    workspaceLevelOverride.value = null
    skillConfigDraft.value = new Map()
  }

  async function applyChanges(): Promise<boolean> {
    if (!agent.value || !hasChanges.value || applying.value) return true
    applying.value = true
    try {
      for (const [skillPath, enabled] of skillOverrides.value) {
        await updateLocalAssistantSkillEnabled({ skillPath, enabled })
      }
      for (const [tool, enabled] of platformToolOverrides.value) {
        await updateLocalAssistantPlatformToolEnabled({ tool, enabled })
      }
      for (const [toolName, enabled] of toolOverrides.value) {
        await updateLocalAssistantToolEnabled({ toolName, enabled })
      }
      if (workspaceLevelOverride.value !== null) {
        await updateLocalAssistantWorkspaceAccess(workspaceLevelOverride.value)
      }
      for (const [skillPath, draftValues] of skillConfigDraft.value) {
        await updateLocalAssistantSkillConfig(skillPath, {
          ...(skillConfigInitial.value.get(skillPath) ?? {}),
          ...draftValues,
        })
      }
      await reload()
      resetOverrides()
      options.onChange?.()
      toast.success("助手配置已应用")
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "应用配置失败。")
      await reload()
      resetOverrides()
      return false
    } finally {
      applying.value = false
    }
  }

  async function confirmChanges(): Promise<void> {
    if (await applyChanges()) options.onClose?.()
  }

  function cancelChanges(): void {
    if (applying.value) return
    resetOverrides()
    options.onClose?.()
  }

  onMounted(() => {
    reload().catch((error) => {
      toast.error(error instanceof Error ? error.message : "无法加载助手配置。")
    })
  })

  return {
    agent,
    skills,
    tools,
    toolDiagnostics,
    applying,
    updatingKnowledge,
    workspaceAccessOptions: ASSISTANT_WORKSPACE_ACCESS_OPTIONS,
    assistantCapabilities,
    enabledAssistantCapabilityCount,
    workspaceLevel,
    enabledSkillCount,
    workspaceAccessDescription,
    hasChanges,
    isSecretKey,
    configValue,
    setConfigValue,
    skillConfigChanged,
    entrySummary,
    skillEnabled,
    toggleSkill,
    toggleAssistantCapability,
    updateWorkspaceAccessLevel,
    reload,
    refreshKnowledge,
    resetOverrides,
    applyChanges,
    confirmChanges,
    cancelChanges,
  }
}
