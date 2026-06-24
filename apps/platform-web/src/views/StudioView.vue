<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Game Card Studio</p>
        <h1 class="truncate text-base font-bold text-text-main">{{ cardTitle }}</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="loading"
          @click="refresh"
        >
          <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="!snapshot"
          @click="openWorkspace"
        >
          <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
          资源管理器
        </button>
      </div>
    </header>

    <main class="min-h-0 overflow-hidden p-3">
      <div v-if="loading" class="retro-inset grid h-full min-h-[360px] place-items-center p-4">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取工作室</p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset grid h-full min-h-[360px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">工作室不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
        </div>
      </div>

      <div v-else-if="snapshot" class="grid h-full min-h-0 gap-3 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-neon-deep/35 bg-elevated/35">
          <div class="flex items-center justify-between gap-3 border-b border-neon-deep/35 px-3 py-2">
            <div class="min-w-0">
              <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Agents</p>
              <p class="mt-1 font-mono text-[11px] text-text-dim">{{ snapshot.agents.length }} 个 Agent</p>
            </div>
            <Bot class="h-4 w-4 shrink-0 text-neon-muted" aria-hidden="true" />
          </div>

          <div class="min-h-0 overflow-auto p-2">
            <div
              v-for="agent in snapshot.agents"
              :key="agent.path"
              class="mb-2 grid grid-cols-[minmax(0,1fr)_auto] border last:mb-0"
              :class="selectedAgent?.id === agent.id ? 'border-neon bg-neon/10' : 'border-neon-deep/35 bg-panel/55 hover:bg-panel'"
            >
              <button
                type="button"
                class="retro-focus grid min-w-0 gap-1 p-3 text-left"
                @click="selectAgent(agent)"
              >
                <span class="truncate text-sm font-bold text-text-main">{{ agent.title }}</span>
                <span class="line-clamp-2 text-xs leading-5 text-text-dim">{{ entrySummary(agent.summary) }}</span>
                <span class="font-mono text-[11px] text-neon-muted">{{ enabledSkillCount(agent) }} 个已启用 Skill</span>
              </button>
              <button
                type="button"
                class="retro-focus m-2 inline-flex h-8 w-8 items-center justify-center border border-neon-deep/40 bg-elevated text-text-dim hover:text-neon"
                :aria-label="`打开 ${agent.title} 目录`"
                title="打开目录"
                @click.stop="openPathDirectory(agent.path)"
              >
                <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <p v-if="snapshot.agents.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm text-text-dim">
              这张游戏卡还没有定义 Agent。
            </p>
          </div>
        </aside>

        <section v-if="selectedAgent" class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-neon-deep/35 bg-elevated/25">
          <div class="flex flex-wrap gap-2 border-b border-neon-deep/35 bg-void/45 p-2" role="tablist" aria-label="Agent 管理">
            <button
              v-for="section in sections"
              :key="section.id"
              type="button"
              class="retro-focus inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs"
              :class="activeSection === section.id ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel text-text-dim hover:text-text-main'"
              @click="activeSection = section.id"
            >
              <component :is="section.icon" class="h-3.5 w-3.5" aria-hidden="true" />
              {{ section.label }}
            </button>
          </div>

          <div class="min-h-0 overflow-hidden">
            <div v-if="contextLoading" class="grid h-full min-h-[320px] place-items-center">
              <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取 Agent</p>
            </div>

            <div v-else-if="!agentContext" class="grid h-full min-h-[320px] place-items-center p-4">
              <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
                <p class="font-mono text-xs uppercase tracking-wider text-danger">Agent 不可用</p>
                <p class="mt-2 text-sm leading-6 text-text-dim">无法读取选中的 Agent。</p>
              </div>
            </div>

            <div v-else-if="activeSection === 'agent'" class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/25 px-3 py-2">
                <p class="min-w-0 break-all font-mono text-[11px] text-neon-muted">{{ agentFilePath }}</p>
              </div>
              <WorkspaceCodeEditor
                v-model="agentDraft"
                :path="agentFilePath"
                media-type="text/markdown"
                readonly
              />
            </div>

            <div v-else-if="activeSection === 'soul'" class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/25 px-3 py-2">
                <p class="min-w-0 break-all font-mono text-[11px] text-neon-muted">{{ soulFilePath }}</p>
              </div>
              <WorkspaceCodeEditor
                v-if="agentContext.soulFile"
                v-model="soulDraft"
                :path="soulFilePath"
                media-type="text/markdown"
                readonly
              />
              <div v-else class="grid h-full place-items-center p-4">
                <p class="border border-neon-deep/35 bg-panel/55 p-3 text-sm text-text-dim">未找到 SOUL.md。</p>
              </div>
            </div>

            <div v-else-if="activeSection === 'skills'" class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/25 px-3 py-2">
                <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Skills</p>
                <p class="font-mono text-[11px] text-text-dim">{{ selectedEnabledSkillCount }} / {{ skillsForSelectedAgent.length }} 已启用</p>
              </div>

              <div class="min-h-0 overflow-auto p-3">
                <div class="grid gap-2">
                  <label
                    v-for="skill in skillsForSelectedAgent"
                    :key="skill.path"
                    class="retro-focus grid cursor-pointer gap-3 border border-neon-deep/35 bg-panel/55 p-3 hover:bg-panel sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
                  >
                    <input
                      class="mt-1 h-4 w-4 accent-[#f3c56d]"
                      type="checkbox"
                      :checked="skillEnabled(skill)"
                      :disabled="togglingSkillPath === skill.path"
                      @change="toggleSkill(skill, ($event.target as HTMLInputElement).checked)"
                    >
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-bold text-text-main">{{ skill.title }}</span>
                      <span class="mt-1 block line-clamp-2 text-xs leading-5 text-text-dim">{{ entrySummary(skill.description || skill.summary) }}</span>
                      <span class="mt-2 block break-all font-mono text-[11px] text-neon-muted">{{ skill.path }}</span>
                    </span>
                    <span class="font-mono text-[11px]" :class="skillEnabled(skill) ? 'text-neon' : 'text-text-dim'">
                      {{ skillEnabled(skill) ? "启用" : "禁用" }}
                    </span>
                  </label>

                  <p v-if="skillsForSelectedAgent.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm text-text-dim">
                    这个 Agent 还没有可管理的 Skill。
                  </p>
                </div>
              </div>
            </div>

            <div v-else class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/25 px-3 py-2">
                <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Tools</p>
                <p class="font-mono text-[11px] text-text-dim">平台工具与 Workspace 权限</p>
              </div>

              <div class="min-h-0 overflow-auto p-3">
                <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_280px]">
                  <section class="border border-neon-deep/35 bg-panel/55">
                    <div class="border-b border-neon-deep/25 px-3 py-2">
                      <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">平台工具</p>
                    </div>
                    <div class="grid gap-2 p-3">
                      <label
                        v-for="tool in platformToolControls"
                        :key="tool.id"
                        class="retro-focus grid cursor-pointer gap-3 border border-neon-deep/30 bg-elevated/45 p-3 hover:bg-elevated sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"
                      >
                        <input
                          class="mt-1 h-4 w-4 accent-[#f3c56d]"
                          type="checkbox"
                          :checked="platformToolEnabled(tool.id)"
                          :disabled="togglingPlatformTool === tool.id"
                          @change="togglePlatformTool(tool.id, ($event.target as HTMLInputElement).checked)"
                        >
                        <span class="min-w-0">
                          <span class="block text-sm font-bold text-text-main">{{ tool.label }}</span>
                          <span class="mt-1 block text-xs leading-5 text-text-dim">{{ tool.description }}</span>
                        </span>
                        <span class="font-mono text-[11px]" :class="platformToolEnabled(tool.id) ? 'text-neon' : 'text-text-dim'">
                          {{ platformToolEnabled(tool.id) ? "启用" : "禁用" }}
                        </span>
                      </label>
                    </div>
                  </section>

                  <section class="border border-neon-deep/35 bg-panel/55">
                    <div class="border-b border-neon-deep/25 px-3 py-2">
                      <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">Workspace 权限</p>
                    </div>
                    <div class="grid gap-3 p-3">
                      <label class="grid gap-2">
                        <span class="text-xs font-bold text-text-main">权限等级</span>
                        <Select
                          :model-value="String(selectedAgent?.workspaceAccess.level ?? 1)"
                          :disabled="updatingWorkspaceAccess"
                          @update:model-value="(value) => updateWorkspaceAccessLevel(Number(value))"
                        >
                          <SelectTrigger class="h-9 w-full">
                            <SelectValue placeholder="选择权限等级" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              v-for="option in workspaceAccessOptions"
                              :key="option.level"
                              :value="String(option.level)"
                            >
                              {{ option.label }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                      <p class="text-xs leading-5 text-text-dim">
                        {{ workspaceAccessDescription }}
                      </p>
                    </div>
                  </section>

                  <section class="border border-neon-deep/35 bg-panel/55 xl:col-span-2">
                    <div class="border-b border-neon-deep/25 px-3 py-2">
                      <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">API 服务商</p>
                    </div>
                    <div class="grid gap-3 p-3">
                      <label class="grid gap-2">
                        <span class="text-xs font-bold text-text-main">服务商预设</span>
                        <Select
                          :model-value="selectedAgent?.providerPresetId || '__platform_default__'"
                          :disabled="updatingProviderPreset"
                          @update:model-value="(value) => updateProviderPreset(value === '__platform_default__' ? '' : value as string)"
                        >
                          <SelectTrigger class="h-9 w-full">
                            <SelectValue placeholder="使用平台默认" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__platform_default__">使用平台默认</SelectItem>
                            <SelectItem
                              v-for="preset in providerPresetOptions"
                              :key="preset.id"
                              :value="preset.id"
                            >
                              {{ preset.name }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                      <p class="text-xs leading-5 text-text-dim">
                        {{ providerPresetDescription }}
                      </p>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-else class="retro-inset grid min-h-[360px] place-items-center p-4">
          <div class="max-w-sm text-center">
            <Bot class="mx-auto h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm leading-6 text-text-dim">选择一个 Agent。</p>
          </div>
        </section>
      </div>
    </main>

    <footer class="retro-statusbar grid min-h-9 gap-2 border-t px-3 py-2 lg:grid-cols-[1fr_auto] lg:items-center">
      <p class="min-w-0 truncate text-sm" :class="feedbackTone">{{ feedbackMessage }}</p>
      <p class="font-mono text-[11px] text-text-dim">{{ statusLabel }}</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import type {
  AgentPlatformToolName,
  AgentContextEntry,
  AgentRegistryEntry,
  SkillRegistryEntry,
} from "@tsian/contracts"
import { computed, onBeforeUnmount, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import {
  Bot,
  FileText,
  FolderOpen,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-vue-next"
import WorkspaceCodeEditor from "@/components/workspace/WorkspaceCodeEditor.vue"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ACTIVE_CARD_CHANGED_EVENT, isActiveCardChangedEvent } from "@/lib/platform-events"
import { isAgentPlatformToolEnabled } from "../agent-runtime/permissions"
import { isSkillEnabledForAgent } from "../agent-runtime/registry"
import {
  getPlatformStudioAgentContext,
  getPlatformStudioSnapshot,
  updatePlatformStudioAgentPlatformToolEnabled,
  updatePlatformStudioAgentSkillEnabled,
  updatePlatformStudioAgentWorkspaceAccess,
  updatePlatformStudioAgentProviderPreset,
  waitForPlatformHostReady,
  type PlatformStudioSnapshot,
} from "../platform-host"

type StudioSection = "agent" | "soul" | "skills" | "tools"

const sections: Array<{
  id: StudioSection
  label: string
  icon: typeof FileText
}> = [
  { id: "agent", label: "AGENT.md", icon: FileText },
  { id: "soul", label: "SOUL.md", icon: FileText },
  { id: "skills", label: "Skills", icon: Wrench },
  { id: "tools", label: "工具/权限", icon: ShieldCheck },
]

const platformToolControls: Array<{
  id: AgentPlatformToolName
  label: string
  description: string
}> = [
  {
    id: "agent_call",
    label: "Agent 协作",
    description: "允许向联系人 Agent 发起一次性咨询。",
  },
  {
    id: "workspace_read",
    label: "读取 Workspace",
    description: "允许读取、列出和搜索可见 Workspace 文件。",
  },
  {
    id: "workspace_semantic_search",
    label: "语义检索",
    description: "允许按含义在 save-runtime 记忆（远期剧情 turn、agent notes、memory summary）里召回，用于玩家措辞与正文无字面重叠时。需在控制面板配置 embedding API 才生效；未配置时工具返回空，agent 回退字面搜索。默认仅 retrieval agent 启用。",
  },
  {
    id: "workspace_write",
    label: "维护 Workspace",
    description: "允许通过平台工具或 Skill 动作写入、移动、删除或校验文件。",
  },
  {
    id: "inspect_frontend",
    label: "前端自检",
    description: "允许助手在隐藏 iframe 里加载当前卡的 packaged 前端，观测渲染、报错和桥状态，驱动一回合或模拟玩家交互，形成写前端→自检→改→复查闭环。",
  },
]

const workspaceAccessOptions = [
  {
    level: 0,
    label: "只读",
    description: "只能读取普通游戏卡和存档内容。",
  },
  {
    level: 1,
    label: "可维护存档",
    description: "可以维护当前存档的运行时文件。",
  },
  {
    level: 2,
    label: "可编辑游戏卡",
    description: "可以编辑游戏卡内容；当前运行时仍会优先限制普通写入到存档。",
  },
  {
    level: 4,
    label: "平台维护",
    description: "允许访问平台元数据能力，仅适合受信任的维护 Agent。",
  },
]

const router = useRouter()
const snapshot = ref<PlatformStudioSnapshot | null>(null)
const agentContext = ref<AgentContextEntry | null>(null)
const loading = ref(false)
const contextLoading = ref(false)
const errorMessage = ref("")
const feedbackMessage = ref("未加载游戏卡")
const feedbackKind = ref<"idle" | "ok" | "error">("idle")
const activeSection = ref<StudioSection>("agent")
const selectedAgentId = ref("")
const agentDraft = ref("")
const soulDraft = ref("")
const togglingSkillPath = ref("")
const togglingPlatformTool = ref<AgentPlatformToolName | "">("")
const updatingWorkspaceAccess = ref(false)
const updatingProviderPreset = ref(false)

const providerPresetOptions = computed(() => snapshot.value?.providerPresets ?? [])
const providerPresetDescription = computed(() => {
  const presetId = selectedAgent.value?.providerPresetId
  if (!presetId) {
    return "未选择时使用平台默认服务商。"
  }
  const preset = providerPresetOptions.value.find((item) => item.id === presetId)
  return preset ? `当前使用：${preset.name}` : "所选预设已失效，将回退到平台默认服务商。"
})

const selectedAgent = computed(() =>
  snapshot.value?.agents.find((agent) => agent.id === selectedAgentId.value) ?? null
)
const cardTitle = computed(() =>
  snapshot.value?.card.manifest.name?.trim() || "工作室"
)
const agentFilePath = computed(() =>
  agentContext.value?.agentFile.path ?? selectedAgent.value?.path ?? ""
)
const soulFilePath = computed(() => {
  if (agentContext.value?.soulFile?.path) {
    return agentContext.value.soulFile.path
  }

  const path = selectedAgent.value?.path ?? ""
  return path.endsWith("/AGENT.md")
    ? `${path.slice(0, -"/AGENT.md".length)}/SOUL.md`
    : ""
})
const skillsForSelectedAgent = computed(() => {
  if (!snapshot.value || !selectedAgent.value) {
    return []
  }

  return snapshot.value.skills.filter((skill) =>
    skill.scope === "shared" || skill.agentId === selectedAgent.value?.id
  )
})
const selectedEnabledSkillCount = computed(() =>
  skillsForSelectedAgent.value.filter(skillEnabled).length
)
const workspaceAccessDescription = computed(() => {
  const level = selectedAgent.value?.workspaceAccess.level ?? 1
  return workspaceAccessOptions.find((option) => option.level === level)?.description
    ?? "使用默认 Workspace 权限。"
})
const statusLabel = computed(() => {
  if (!snapshot.value) {
    return "未加载游戏卡"
  }
  return `${snapshot.value.agents.length} 个 Agent · ${snapshot.value.skills.length} 个 Skill`
})
const feedbackTone = computed(() => {
  if (feedbackKind.value === "ok") return "text-neon"
  if (feedbackKind.value === "error") return "text-danger"
  return "text-text-dim"
})

function entrySummary(value: string | undefined): string {
  return value?.trim() || "暂无简介。"
}

function directoryOf(path: string): string {
  const parts = path.split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function setFeedback(message: string, kind: "idle" | "ok" | "error" = "idle") {
  feedbackMessage.value = message
  feedbackKind.value = kind
}

function skillEnabled(skill: SkillRegistryEntry): boolean {
  return selectedAgent.value ? isSkillEnabledForAgent(skill, selectedAgent.value) : false
}

function platformToolEnabled(tool: AgentPlatformToolName): boolean {
  return selectedAgent.value ? isAgentPlatformToolEnabled(selectedAgent.value, tool) : false
}

function enabledSkillCount(agent: AgentRegistryEntry): number {
  const skills = snapshot.value?.skills ?? []
  return skills.filter((skill) => isSkillEnabledForAgent(skill, agent)).length
}

async function refresh() {
  loading.value = true
  errorMessage.value = ""
  try {
    await waitForPlatformHostReady()
    const next = await getPlatformStudioSnapshot()
    snapshot.value = next
    if (!next.agents.some((agent) => agent.id === selectedAgentId.value)) {
      selectedAgentId.value = next.agents[0]?.id ?? ""
    }
    await loadSelectedAgentContext()
    setFeedback("工作室已刷新。", "ok")
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法读取工作室。"
    setFeedback(errorMessage.value, "error")
  } finally {
    loading.value = false
  }
}

async function reloadSnapshotAndSelectedAgent() {
  const next = await getPlatformStudioSnapshot()
  snapshot.value = next
  if (!next.agents.some((agent) => agent.id === selectedAgentId.value)) {
    selectedAgentId.value = next.agents[0]?.id ?? ""
  }
  await loadSelectedAgentContext()
}

async function loadSelectedAgentContext() {
  const agentId = selectedAgentId.value
  agentContext.value = null
  agentDraft.value = ""
  soulDraft.value = ""
  if (!agentId) {
    return
  }

  contextLoading.value = true
  try {
    const context = await getPlatformStudioAgentContext(agentId)
    agentContext.value = context
    agentDraft.value = context?.agentFile.content ?? ""
    soulDraft.value = context?.soulFile?.content ?? ""
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "无法读取 Agent。", "error")
  } finally {
    contextLoading.value = false
  }
}

async function selectAgent(agent: AgentRegistryEntry) {
  selectedAgentId.value = agent.id
  setFeedback(`已选择：${agent.title}`, "idle")
  await loadSelectedAgentContext()
}

async function toggleSkill(skill: SkillRegistryEntry, enabled: boolean) {
  if (!selectedAgent.value) {
    return
  }

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

async function togglePlatformTool(tool: AgentPlatformToolName, enabled: boolean) {
  if (!selectedAgent.value) {
    return
  }

  togglingPlatformTool.value = tool
  try {
    await updatePlatformStudioAgentPlatformToolEnabled({
      agentId: selectedAgent.value.id,
      tool,
      enabled,
    })
    await reloadSnapshotAndSelectedAgent()
    const label = platformToolControls.find((control) => control.id === tool)?.label ?? tool
    setFeedback(`${enabled ? "已启用" : "已禁用"}：${label}`, "ok")
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "无法更新工具权限。", "error")
    await reloadSnapshotAndSelectedAgent()
  } finally {
    togglingPlatformTool.value = ""
  }
}

async function updateWorkspaceAccessLevel(level: number) {
  if (!selectedAgent.value) {
    return
  }

  updatingWorkspaceAccess.value = true
  try {
    await updatePlatformStudioAgentWorkspaceAccess({
      agentId: selectedAgent.value.id,
      level,
    })
    await reloadSnapshotAndSelectedAgent()
    setFeedback("Workspace 权限已更新。", "ok")
  } catch (error) {
    setFeedback(error instanceof Error ? error.message : "无法更新 Workspace 权限。", "error")
    await reloadSnapshotAndSelectedAgent()
  } finally {
    updatingWorkspaceAccess.value = false
  }
}

async function updateProviderPreset(presetId: string) {
  if (!selectedAgent.value) {
    return
  }

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

function openWorkspace() {
  if (!snapshot.value) {
    return
  }
  router.push({
    name: "workspace",
    query: { cardId: snapshot.value.card.id },
  })
}

function openPathDirectory(path: string) {
  if (!snapshot.value) {
    return
  }
  router.push({
    name: "workspace",
    query: {
      cardId: snapshot.value.card.id,
      path: directoryOf(path),
    },
  })
}

onMounted(() => {
  window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  void refresh()
})

onBeforeUnmount(() => {
  window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
})

function onActiveCardChanged(event: Event) {
  if (!isActiveCardChangedEvent(event)) {
    return
  }
  void refresh()
}
</script>
