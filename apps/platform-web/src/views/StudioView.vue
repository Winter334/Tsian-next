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

            <div v-else class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
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
  AgentContextEntry,
  AgentRegistryEntry,
  SkillRegistryEntry,
} from "@tsian/contracts"
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import {
  Bot,
  FileText,
  FolderOpen,
  RefreshCw,
  Wrench,
} from "lucide-vue-next"
import WorkspaceCodeEditor from "@/components/workspace/WorkspaceCodeEditor.vue"
import { isSkillEnabledForAgent } from "../agent-runtime/registry"
import {
  getPlatformStudioAgentContext,
  getPlatformStudioSnapshot,
  updatePlatformStudioAgentSkillEnabled,
  waitForPlatformHostReady,
  type PlatformStudioSnapshot,
} from "../platform-host"

type StudioSection = "agent" | "soul" | "skills"

const sections: Array<{
  id: StudioSection
  label: string
  icon: typeof FileText
}> = [
  { id: "agent", label: "AGENT.md", icon: FileText },
  { id: "soul", label: "SOUL.md", icon: FileText },
  { id: "skills", label: "Skills", icon: Wrench },
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
      selectedAgentId.value = next.assistant?.agent?.id ?? next.agents[0]?.id ?? ""
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
    selectedAgentId.value = next.assistant?.agent?.id ?? next.agents[0]?.id ?? ""
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
  void refresh()
})
</script>
