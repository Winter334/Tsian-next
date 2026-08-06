import type {
  AgentContextEntry,
  AgentPlatformToolName,
  AgentRegistryEntry,
  RegistryDiagnostic,
  SkillRegistryEntry,
  ToolRegistryEntry,
} from "@tsian/contracts"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { isAgentPlatformToolEnabled } from "@/agent-runtime/permissions"
import {
  PLATFORM_TOOL_CONTROL_GROUPS,
  PLATFORM_TOOL_CONTROLS,
  type PlatformToolControl,
} from "@/agent-runtime/tool-controls"
import { isSkillEnabledForAgent } from "@/agent-runtime/registry"
import { confirm } from "@/composables/useConfirm"
import {
  ACTIVE_CARD_CHANGED_EVENT,
  isActiveCardChangedEvent,
} from "@/lib/platform-events"
import {
  deletePlatformStudioSkill,
  getPlatformStudioAgentContext,
  getPlatformStudioSnapshot,
  isPlatformStudioToolEnabledForAgent,
  updatePlatformStudioAgentPlatformToolEnabled,
  updatePlatformStudioAgentProviderPreset,
  updatePlatformStudioAgentSkillEnabled,
  updatePlatformStudioAgentToolEnabled,
  updatePlatformStudioAgentWorkspaceAccess,
  waitForPlatformHostReady,
  type PlatformStudioModuleInfo,
  type PlatformStudioSnapshot,
} from "@/platform-host"

export type StudioFeedbackKind = "idle" | "ok" | "error"

export type StudioRuntimeCapability =
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

export const STUDIO_WORKSPACE_ACCESS_OPTIONS = [
  { level: 0, label: "只读", description: "只能读取普通游戏卡和存档内容。" },
  { level: 1, label: "可维护存档", description: "可以维护当前存档的运行时文件。" },
  { level: 2, label: "可编辑游戏卡", description: "可以编辑游戏卡内容；当前运行时仍会优先限制普通写入到存档。" },
  { level: 4, label: "平台维护", description: "允许访问平台元数据能力，仅适合受信任的维护 Agent。" },
] as const

export interface StudioControllerOptions {
  openWorkspace(input: { cardId: string; path?: string }): void
  openLibrary(): void
  openMarket(): void
}

export function useStudioController(options: StudioControllerOptions) {
  const snapshot = ref<PlatformStudioSnapshot | null>(null)
  const agentContext = ref<AgentContextEntry | null>(null)
  const loading = ref(false)
  const contextLoading = ref(false)
  const errorMessage = ref("")
  const feedbackMessage = ref("未加载游戏卡")
  const feedbackKind = ref<StudioFeedbackKind>("idle")
  const selectedAgentId = ref("")
  const agentDraft = ref("")
  const soulDraft = ref("")
  const togglingSkillPath = ref("")
  const deletingSkillPath = ref("")
  const togglingPlatformTool = ref<AgentPlatformToolName | "">("")
  const togglingToolName = ref<string | null>(null)
  const updatingWorkspaceAccess = ref(false)
  const updatingProviderPreset = ref(false)
  let contextRequestGeneration = 0
  let refreshRequestGeneration = 0
  let disposed = false

  const selectedAgent = computed(() =>
    snapshot.value?.agents.find((agent) => agent.id === selectedAgentId.value) ?? null,
  )
  const providerPresetOptions = computed(() => snapshot.value?.providerPresets ?? [])
  const providerPresetDescription = computed(() => {
    const presetId = selectedAgent.value?.providerPresetId
    if (!presetId) return "未选择时使用平台默认服务商。"
    const preset = providerPresetOptions.value.find((item) => item.id === presetId)
    return preset ? `当前使用：${preset.name}` : "所选预设已失效，将回退到平台默认服务商。"
  })
  const cardTitle = computed(() => snapshot.value?.card.manifest.name?.trim() || "工作室")
  const agentFilePath = computed(() =>
    agentContext.value?.agentFile.path ?? selectedAgent.value?.path ?? "",
  )
  const soulFilePath = computed(() => {
    if (agentContext.value?.soulFile?.path) return agentContext.value.soulFile.path
    const path = selectedAgent.value?.path ?? ""
    return path.endsWith("/AGENT.md")
      ? `${path.slice(0, -"/AGENT.md".length)}/SOUL.md`
      : ""
  })
  const skillsForSelectedAgent = computed(() => {
    if (!snapshot.value || !selectedAgent.value) return []
    return snapshot.value.skills.filter((skill) =>
      skill.scope === "shared" || skill.agentId === selectedAgent.value?.id,
    )
  })
  const toolsForSelectedAgent = computed<ToolRegistryEntry[]>(() => {
    if (!snapshot.value || !selectedAgent.value) return []
    return (snapshot.value.tools ?? []).filter((tool) =>
      tool.scope === "shared" || tool.agentId === selectedAgent.value?.id,
    )
  })
  const modulesForSelectedAgent = computed<PlatformStudioModuleInfo[]>(() => {
    if (!snapshot.value || !selectedAgent.value) return []
    return snapshot.value.modules.filter((module) => module.agentId === selectedAgent.value?.id)
  })
  const toolDiagnostics = computed<RegistryDiagnostic[]>(() => snapshot.value?.toolDiagnostics ?? [])
  const isNoCardError = computed(() => errorMessage.value === "当前没有加载游戏卡。")

  function skillEnabled(skill: SkillRegistryEntry): boolean {
    return selectedAgent.value ? isSkillEnabledForAgent(skill, selectedAgent.value) : false
  }

  function platformToolEnabled(tool: AgentPlatformToolName): boolean {
    return selectedAgent.value ? isAgentPlatformToolEnabled(selectedAgent.value, tool) : false
  }

  function toolEnabledForAgent(tool: ToolRegistryEntry): boolean {
    return selectedAgent.value
      ? isPlatformStudioToolEnabledForAgent(tool, selectedAgent.value)
      : false
  }

  const selectedEnabledSkillCount = computed(() =>
    skillsForSelectedAgent.value.filter(skillEnabled).length,
  )
  const runtimeCapabilities = computed<StudioRuntimeCapability[]>(() => {
    const platformCapabilities = PLATFORM_TOOL_CONTROL_GROUPS.flatMap((group) =>
      group.tools.map<StudioRuntimeCapability>((tool) => ({
        kind: "platform",
        key: `platform:${tool.id}`,
        title: tool.label,
        description: tool.description,
        badge: `平台能力 · ${group.title}`,
        enabled: platformToolEnabled(tool.id),
        disabled: togglingPlatformTool.value === tool.id,
        tool,
      })),
    )
    const userCapabilities = toolsForSelectedAgent.value.map<StudioRuntimeCapability>((tool) => ({
      kind: "tool",
      key: `tool:${tool.path}`,
      title: tool.name,
      description: tool.description,
      badge: `自定义 Tool · ${tool.scope === "agent-local" ? "私有" : "共享"}`,
      path: tool.path,
      enabled: toolEnabledForAgent(tool),
      disabled: togglingToolName.value === tool.name,
      tool,
    }))
    return [...platformCapabilities, ...userCapabilities]
  })
  const enabledRuntimeCapabilityCount = computed(() =>
    runtimeCapabilities.value.filter((capability) => capability.enabled).length,
  )
  const workspaceAccessDescription = computed(() => {
    const level = selectedAgent.value?.workspaceAccess.level ?? 1
    return STUDIO_WORKSPACE_ACCESS_OPTIONS.find((option) => option.level === level)?.description
      ?? "使用默认 Workspace 权限。"
  })
  const statusLabel = computed(() => {
    if (!snapshot.value) return "未加载游戏卡"
    const toolCount = snapshot.value.tools?.length ?? 0
    const diagnostics = snapshot.value.toolDiagnostics?.length ?? 0
    const base = `${snapshot.value.agents.length} 个 Agent · ${snapshot.value.skills.length} 个 Skill · ${toolCount} 个 Tool`
    return diagnostics > 0 ? `${base} · ⚠ ${diagnostics} 条注册诊断` : base
  })

  function entrySummary(value: string | undefined): string {
    return value?.trim() || "暂无简介。"
  }

  function directoryOf(path: string): string {
    const parts = path.split("/").filter(Boolean)
    parts.pop()
    return parts.join("/")
  }

  function setFeedback(message: string, kind: StudioFeedbackKind = "idle"): void {
    feedbackMessage.value = message
    feedbackKind.value = kind
  }

  function enabledSkillCount(agent: AgentRegistryEntry): number {
    return (snapshot.value?.skills ?? []).filter((skill) => isSkillEnabledForAgent(skill, agent)).length
  }

  async function loadSelectedAgentContext(): Promise<void> {
    const agentId = selectedAgentId.value
    const generation = ++contextRequestGeneration
    agentContext.value = null
    agentDraft.value = ""
    soulDraft.value = ""
    if (!agentId) return
    contextLoading.value = true
    try {
      const context = await getPlatformStudioAgentContext(agentId)
      if (disposed
        || generation !== contextRequestGeneration
        || selectedAgentId.value !== agentId) return
      agentContext.value = context
      agentDraft.value = context?.agentFile.content ?? ""
      soulDraft.value = context?.soulFile?.content ?? ""
    } catch (error) {
      if (disposed || generation !== contextRequestGeneration) return
      setFeedback(error instanceof Error ? error.message : "无法读取 Agent。", "error")
    } finally {
      if (generation === contextRequestGeneration) contextLoading.value = false
    }
  }

  function reconcileSelectedAgent(next: PlatformStudioSnapshot): void {
    snapshot.value = next
    if (!next.agents.some((agent) => agent.id === selectedAgentId.value)) {
      selectedAgentId.value = next.agents[0]?.id ?? ""
    }
  }

  async function refresh(): Promise<void> {
    const generation = ++refreshRequestGeneration
    loading.value = true
    errorMessage.value = ""
    try {
      await waitForPlatformHostReady()
      const next = await getPlatformStudioSnapshot()
      if (disposed || generation !== refreshRequestGeneration) return
      reconcileSelectedAgent(next)
      await loadSelectedAgentContext()
      if (disposed || generation !== refreshRequestGeneration) return
      setFeedback("工作室已刷新。", "ok")
    } catch (error) {
      if (disposed || generation !== refreshRequestGeneration) return
      errorMessage.value = error instanceof Error ? error.message : "无法读取工作室。"
      setFeedback(errorMessage.value, "error")
    } finally {
      if (generation === refreshRequestGeneration) loading.value = false
    }
  }

  async function reloadSnapshotAndSelectedAgent(): Promise<void> {
    reconcileSelectedAgent(await getPlatformStudioSnapshot())
    await loadSelectedAgentContext()
  }

  async function refreshSnapshotAfterSequenceSave(message: string): Promise<void> {
    reconcileSelectedAgent(await getPlatformStudioSnapshot())
    setFeedback(message, "ok")
  }

  function handleSequenceSaved(message: string): void {
    void refreshSnapshotAfterSequenceSave(message)
  }

  function handleSequenceError(message: string): void {
    setFeedback(message, "error")
  }

  async function selectAgent(agent: AgentRegistryEntry): Promise<void> {
    selectedAgentId.value = agent.id
    setFeedback(`已选择：${agent.title}`)
    await loadSelectedAgentContext()
  }

  function selectAgentById(agentId: string): void {
    const agent = snapshot.value?.agents.find((candidate) => candidate.id === agentId)
    if (agent) void selectAgent(agent)
  }

  async function toggleSkill(skill: SkillRegistryEntry, enabled: boolean): Promise<void> {
    if (!selectedAgent.value) return
    togglingSkillPath.value = skill.path
    try {
      await updatePlatformStudioAgentSkillEnabled({
        agentId: selectedAgent.value.id,
        skillPath: skill.path,
        enabled,
      })
      await reloadSnapshotAndSelectedAgent()
      setFeedback(`${enabled ? "已启用" : "已禁用"}：${skill.title}`, "ok")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "无法更新 Skill。", "error")
      await reloadSnapshotAndSelectedAgent()
    } finally {
      togglingSkillPath.value = ""
    }
  }

  async function deleteSkill(skill: SkillRegistryEntry): Promise<void> {
    if (deletingSkillPath.value) return
    const accepted = await confirm({
      title: "删除 Skill",
      message: `删除 Skill「${skill.title}」？\n\n这会删除 ${skill.path} 所在目录，并从当前游戏卡的 Agent 配置中移除引用，无法撤销。`,
      severity: "danger",
      confirmText: "删除",
    })
    if (!accepted) return
    deletingSkillPath.value = skill.path
    try {
      await deletePlatformStudioSkill({ skillPath: skill.path })
      await reloadSnapshotAndSelectedAgent()
      setFeedback(`已删除 Skill：${skill.title}`, "ok")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "无法删除 Skill。", "error")
      await reloadSnapshotAndSelectedAgent()
    } finally {
      deletingSkillPath.value = ""
    }
  }

  async function toggleUserTool(tool: ToolRegistryEntry, enabled: boolean): Promise<void> {
    if (!selectedAgent.value || togglingToolName.value) return
    togglingToolName.value = tool.name
    try {
      await updatePlatformStudioAgentToolEnabled({
        agentId: selectedAgent.value.id,
        toolName: tool.name,
        enabled,
      })
      await reloadSnapshotAndSelectedAgent()
      setFeedback(enabled ? `已启用 Tool：${tool.name}` : `已禁用 Tool：${tool.name}`, "ok")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "更新 Tool 状态失败。", "error")
    } finally {
      togglingToolName.value = null
    }
  }

  function toggleRuntimeCapability(capability: StudioRuntimeCapability, enabled: boolean): void {
    if (capability.kind === "platform") void togglePlatformTool(capability.tool.id, enabled)
    else void toggleUserTool(capability.tool, enabled)
  }

  async function togglePlatformTool(tool: AgentPlatformToolName, enabled: boolean): Promise<void> {
    if (!selectedAgent.value) return
    togglingPlatformTool.value = tool
    try {
      await updatePlatformStudioAgentPlatformToolEnabled({
        agentId: selectedAgent.value.id,
        tool,
        enabled,
      })
      await reloadSnapshotAndSelectedAgent()
      const label = PLATFORM_TOOL_CONTROLS.find((control) => control.id === tool)?.label ?? tool
      setFeedback(`${enabled ? "已启用" : "已禁用"}：${label}`, "ok")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "无法更新工具权限。", "error")
      await reloadSnapshotAndSelectedAgent()
    } finally {
      togglingPlatformTool.value = ""
    }
  }

  async function updateWorkspaceAccessLevel(level: number): Promise<void> {
    if (!selectedAgent.value) return
    updatingWorkspaceAccess.value = true
    try {
      await updatePlatformStudioAgentWorkspaceAccess({ agentId: selectedAgent.value.id, level })
      await reloadSnapshotAndSelectedAgent()
      setFeedback("Workspace 权限已更新。", "ok")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "无法更新 Workspace 权限。", "error")
      await reloadSnapshotAndSelectedAgent()
    } finally {
      updatingWorkspaceAccess.value = false
    }
  }

  async function updateProviderPreset(presetId: string): Promise<void> {
    if (!selectedAgent.value) return
    updatingProviderPreset.value = true
    try {
      await updatePlatformStudioAgentProviderPreset({
        agentId: selectedAgent.value.id,
        providerPresetId: presetId || null,
      })
      await reloadSnapshotAndSelectedAgent()
      setFeedback(presetId ? "API 服务商已更新。" : "已清除服务商选择，使用平台默认。", "ok")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "无法更新 API 服务商。", "error")
      await reloadSnapshotAndSelectedAgent()
    } finally {
      updatingProviderPreset.value = false
    }
  }

  function openWorkspace(): void {
    if (snapshot.value) options.openWorkspace({ cardId: snapshot.value.card.id })
  }

  function openPathDirectory(path: string): void {
    if (snapshot.value) {
      options.openWorkspace({ cardId: snapshot.value.card.id, path: directoryOf(path) })
    }
  }

  function onActiveCardChanged(event: Event): void {
    if (isActiveCardChangedEvent(event)) void refresh()
  }

  onMounted(() => {
    window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
    void refresh()
  })

  onBeforeUnmount(() => {
    disposed = true
    refreshRequestGeneration += 1
    contextRequestGeneration += 1
    window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  })

  return {
    snapshot,
    agentContext,
    loading,
    contextLoading,
    errorMessage,
    feedbackMessage,
    feedbackKind,
    selectedAgentId,
    selectedAgent,
    agentDraft,
    soulDraft,
    togglingSkillPath,
    deletingSkillPath,
    togglingPlatformTool,
    togglingToolName,
    updatingWorkspaceAccess,
    updatingProviderPreset,
    providerPresetOptions,
    providerPresetDescription,
    cardTitle,
    agentFilePath,
    soulFilePath,
    skillsForSelectedAgent,
    selectedEnabledSkillCount,
    toolsForSelectedAgent,
    modulesForSelectedAgent,
    toolDiagnostics,
    runtimeCapabilities,
    enabledRuntimeCapabilityCount,
    workspaceAccessDescription,
    statusLabel,
    isNoCardError,
    entrySummary,
    skillEnabled,
    enabledSkillCount,
    toolEnabledForAgent,
    platformToolEnabled,
    refresh,
    reloadSnapshotAndSelectedAgent,
    handleSequenceSaved,
    handleSequenceError,
    loadSelectedAgentContext,
    selectAgent,
    selectAgentById,
    toggleSkill,
    deleteSkill,
    toggleRuntimeCapability,
    toggleUserTool,
    togglePlatformTool,
    updateWorkspaceAccessLevel,
    updateProviderPreset,
    openWorkspace,
    openPathDirectory,
    goToLibrary: options.openLibrary,
    goToMarket: options.openMarket,
  }
}
