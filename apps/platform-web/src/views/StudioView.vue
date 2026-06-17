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

    <main class="min-h-0 overflow-auto p-3">
      <div v-if="loading" class="retro-inset grid min-h-[360px] place-items-center p-4">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取工作室</p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset grid min-h-[360px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">工作室不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
        </div>
      </div>

      <div v-else-if="snapshot" class="grid gap-3">
        <section class="retro-inset grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div class="min-w-0">
            <p class="text-sm leading-6 text-text-main">{{ cardIntro }}</p>
            <p class="mt-2 text-xs leading-5 text-text-dim">
              {{ snapshot.usingSaveContext ? "当前存档上下文已合并进角色详情。" : "未使用存档上下文，正在展示游戏卡自带内容。" }}
            </p>
          </div>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="min-w-20 border border-neon-deep/40 bg-elevated/50 px-3 py-2">
              <p class="font-mono text-lg font-bold text-neon">{{ snapshot.agents.length }}</p>
              <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">角色</p>
            </div>
            <div class="min-w-20 border border-neon-deep/40 bg-elevated/50 px-3 py-2">
              <p class="font-mono text-lg font-bold text-neon">{{ snapshot.skills.length }}</p>
              <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">能力</p>
            </div>
            <div class="min-w-20 border border-neon-deep/40 bg-elevated/50 px-3 py-2">
              <p class="font-mono text-lg font-bold" :class="snapshot.assistant ? 'text-neon' : 'text-text-dim'">
                {{ snapshot.assistant ? "ON" : "--" }}
              </p>
              <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">助手</p>
            </div>
          </div>
        </section>

        <section
          v-if="snapshot.assistant"
          class="grid gap-3 border border-neon-deep/35 bg-elevated/35 p-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center"
        >
          <span class="grid h-10 w-10 place-items-center border border-neon-deep/50 bg-panel text-neon">
            <Sparkles class="h-5 w-5" aria-hidden="true" />
          </span>
          <div class="min-w-0">
            <p class="font-mono text-xs uppercase tracking-wider text-neon">卡片助手</p>
            <p class="mt-1 text-sm leading-6 text-text-dim">
              {{ snapshot.assistant.summary }}
            </p>
          </div>
        </section>

        <section class="grid min-h-[460px] gap-3 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
          <div class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-neon-deep/35 bg-elevated/35">
            <div class="flex border-b border-neon-deep/35 p-2" role="tablist" aria-label="工作室栏目">
              <button
                type="button"
                class="retro-focus inline-flex h-8 flex-1 items-center justify-center gap-2 border px-3 font-mono text-xs"
                :class="activePanel === 'agents' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel text-text-dim hover:text-text-main'"
                @click="activePanel = 'agents'"
              >
                <Bot class="h-3.5 w-3.5" aria-hidden="true" />
                角色
              </button>
              <button
                type="button"
                class="retro-focus inline-flex h-8 flex-1 items-center justify-center gap-2 border px-3 font-mono text-xs"
                :class="activePanel === 'skills' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel text-text-dim hover:text-text-main'"
                @click="activePanel = 'skills'"
              >
                <Wrench class="h-3.5 w-3.5" aria-hidden="true" />
                能力
              </button>
            </div>

            <div class="min-h-0 overflow-auto p-2">
              <div v-if="activePanel === 'agents'" class="grid gap-2">
                <button
                  v-for="agent in snapshot.agents"
                  :key="agent.path"
                  type="button"
                  class="retro-focus grid gap-1 border p-3 text-left"
                  :class="selectedAgent?.id === agent.id ? 'border-neon bg-neon/10' : 'border-neon-deep/35 bg-panel/55 hover:bg-panel'"
                  @click="selectAgent(agent)"
                >
                  <span class="truncate text-sm font-bold text-text-main">{{ agent.title }}</span>
                  <span class="line-clamp-2 text-xs leading-5 text-text-dim">{{ entrySummary(agent.summary) }}</span>
                  <span class="font-mono text-[11px] text-neon-muted">{{ abilityCountForAgent(agent) }} 个关联能力</span>
                </button>
                <p v-if="snapshot.agents.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm text-text-dim">
                  这张游戏卡还没有定义角色。
                </p>
              </div>

              <div v-else class="grid gap-2">
                <button
                  v-for="skill in snapshot.skills"
                  :key="skill.path"
                  type="button"
                  class="retro-focus grid gap-1 border p-3 text-left"
                  :class="selectedSkill?.path === skill.path ? 'border-neon bg-neon/10' : 'border-neon-deep/35 bg-panel/55 hover:bg-panel'"
                  @click="selectSkill(skill)"
                >
                  <span class="truncate text-sm font-bold text-text-main">{{ skill.title }}</span>
                  <span class="line-clamp-2 text-xs leading-5 text-text-dim">{{ entrySummary(skill.summary || skill.description) }}</span>
                  <span class="font-mono text-[11px] text-neon-muted">{{ skillScopeLabel(skill) }}</span>
                </button>
                <p v-if="snapshot.skills.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm text-text-dim">
                  这张游戏卡还没有定义能力。
                </p>
              </div>
            </div>
          </div>

          <aside class="retro-inset min-h-[420px] overflow-auto p-4">
            <div v-if="activePanel === 'agents' && selectedAgent" class="grid gap-4">
              <div>
                <p class="font-mono text-xs uppercase tracking-wider text-neon">角色详情</p>
                <h2 class="mt-1 text-xl font-bold text-text-main">{{ selectedAgent.title }}</h2>
                <p class="mt-2 text-sm leading-6 text-text-dim">{{ entrySummary(selectedAgent.summary) }}</p>
              </div>

              <div class="grid gap-2 sm:grid-cols-3">
                <div class="border border-neon-deep/35 bg-elevated/45 p-3">
                  <p class="font-mono text-lg text-neon">{{ selectedAgent.contacts.length }}</p>
                  <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">联系人</p>
                </div>
                <div class="border border-neon-deep/35 bg-elevated/45 p-3">
                  <p class="font-mono text-lg text-neon">{{ selectedAgent.defaultSkills.length }}</p>
                  <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">默认能力</p>
                </div>
                <div class="border border-neon-deep/35 bg-elevated/45 p-3">
                  <p class="font-mono text-lg" :class="agentContext?.missingContextPaths.length ? 'text-warning' : 'text-neon'">
                    {{ agentContext?.missingContextPaths.length ?? 0 }}
                  </p>
                  <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">缺失上下文</p>
                </div>
              </div>

              <p v-if="detailLoading" class="font-mono text-xs uppercase tracking-wider text-neon">正在读取详情</p>

              <div v-if="agentContext?.skillIndex.length" class="grid gap-2">
                <p class="font-mono text-xs uppercase tracking-wider text-neon-muted">可用能力</p>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="skill in agentContext.skillIndex"
                    :key="skill.path"
                    type="button"
                    class="retro-focus border border-neon-deep/40 bg-panel px-2 py-1 font-mono text-[11px] text-text-dim hover:text-text-main"
                    @click="selectSkill(skill)"
                  >
                    {{ skill.title }}
                  </button>
                </div>
              </div>

              <details class="border border-neon-deep/35 bg-elevated/35 p-3">
                <summary class="cursor-pointer font-mono text-xs uppercase tracking-wider text-neon-muted">高级信息</summary>
                <dl class="mt-3 grid gap-2 text-xs text-text-dim">
                  <div>
                    <dt class="font-mono text-[10px] uppercase text-neon-muted">文件</dt>
                    <dd class="mt-1 break-all font-mono">{{ selectedAgent.path }}</dd>
                  </div>
                  <div v-if="agentContext?.missingContextPaths.length">
                    <dt class="font-mono text-[10px] uppercase text-warning">缺失路径</dt>
                    <dd class="mt-1 grid gap-1">
                      <span v-for="path in agentContext.missingContextPaths" :key="path" class="break-all font-mono">{{ path }}</span>
                    </dd>
                  </div>
                </dl>
              </details>

              <div class="flex flex-wrap gap-2">
                <button type="button" class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs" @click="editPath(selectedAgent.path)">
                  <FilePenLine class="h-3.5 w-3.5" aria-hidden="true" />
                  编辑定义
                </button>
                <button type="button" class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs" @click="openPathDirectory(selectedAgent.path)">
                  <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
                  打开目录
                </button>
              </div>
            </div>

            <div v-else-if="activePanel === 'skills' && selectedSkill" class="grid gap-4">
              <div>
                <p class="font-mono text-xs uppercase tracking-wider text-neon">能力详情</p>
                <h2 class="mt-1 text-xl font-bold text-text-main">{{ selectedSkill.title }}</h2>
                <p class="mt-2 text-sm leading-6 text-text-dim">{{ entrySummary(selectedSkill.summary || selectedSkill.description) }}</p>
              </div>

              <div class="grid gap-2 sm:grid-cols-3">
                <div class="border border-neon-deep/35 bg-elevated/45 p-3">
                  <p class="font-mono text-sm text-neon">{{ skillScopeLabel(selectedSkill) }}</p>
                  <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">范围</p>
                </div>
                <div class="border border-neon-deep/35 bg-elevated/45 p-3">
                  <p class="font-mono text-lg text-neon">{{ selectedSkill.triggers.length }}</p>
                  <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">触发提示</p>
                </div>
                <div class="border border-neon-deep/35 bg-elevated/45 p-3">
                  <p class="font-mono text-lg text-neon">{{ skillDetail?.resources.length ?? 0 }}</p>
                  <p class="mt-1 font-mono text-[10px] uppercase text-text-dim">资源</p>
                </div>
              </div>

              <p v-if="detailLoading" class="font-mono text-xs uppercase tracking-wider text-neon">正在读取详情</p>

              <div v-if="skillDetail?.resources.length" class="grid gap-2">
                <p class="font-mono text-xs uppercase tracking-wider text-neon-muted">资源索引</p>
                <div class="max-h-48 overflow-auto border border-neon-deep/35 bg-panel/55">
                  <button
                    v-for="resource in skillDetail.resources"
                    :key="resource.path"
                    type="button"
                    class="retro-focus grid w-full grid-cols-[1fr_auto] gap-3 border-b border-neon-deep/20 px-3 py-2 text-left last:border-b-0 hover:bg-elevated"
                    @click="openPathDirectory(resource.path)"
                  >
                    <span class="min-w-0">
                      <span class="block truncate font-mono text-xs text-text-main">{{ resource.name }}</span>
                      <span class="mt-1 block truncate font-mono text-[11px] text-text-dim">{{ resource.mediaType }}</span>
                    </span>
                    <span class="font-mono text-[11px] text-text-dim">{{ formatBytes(resource.size) }}</span>
                  </button>
                </div>
              </div>

              <details class="border border-neon-deep/35 bg-elevated/35 p-3">
                <summary class="cursor-pointer font-mono text-xs uppercase tracking-wider text-neon-muted">高级信息</summary>
                <dl class="mt-3 grid gap-2 text-xs text-text-dim">
                  <div>
                    <dt class="font-mono text-[10px] uppercase text-neon-muted">文件</dt>
                    <dd class="mt-1 break-all font-mono">{{ selectedSkill.path }}</dd>
                  </div>
                  <div v-if="selectedSkill.appliesTo.length">
                    <dt class="font-mono text-[10px] uppercase text-neon-muted">适用对象</dt>
                    <dd class="mt-1">{{ selectedSkill.appliesTo.join(", ") }}</dd>
                  </div>
                </dl>
              </details>

              <div class="flex flex-wrap gap-2">
                <button type="button" class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs" @click="editPath(selectedSkill.path)">
                  <FilePenLine class="h-3.5 w-3.5" aria-hidden="true" />
                  编辑定义
                </button>
                <button type="button" class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs" @click="openPathDirectory(selectedSkill.path)">
                  <FolderOpen class="h-3.5 w-3.5" aria-hidden="true" />
                  打开目录
                </button>
              </div>
            </div>

            <div v-else class="grid min-h-[300px] place-items-center text-center">
              <div class="max-w-sm">
                <PanelRight class="mx-auto h-10 w-10 text-neon-muted" aria-hidden="true" />
                <p class="mt-3 text-sm leading-6 text-text-dim">选择一个角色或能力查看详情。</p>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <p class="font-mono text-[11px] text-text-dim">{{ statusLabel }}</p>
      <p class="min-w-0 truncate font-mono text-[11px] text-text-dim">{{ contextLabel }}</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import type {
  AgentContextEntry,
  AgentRegistryEntry,
  SkillDetailEntry,
  SkillRegistryEntry,
} from "@tsian/contracts"
import { computed, onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import {
  Bot,
  FilePenLine,
  FolderOpen,
  PanelRight,
  RefreshCw,
  Sparkles,
  Wrench,
} from "lucide-vue-next"
import {
  getPlatformStudioAgentContext,
  getPlatformStudioSkillDetail,
  getPlatformStudioSnapshot,
  waitForPlatformHostReady,
  type PlatformStudioSnapshot,
} from "../platform-host"

type StudioPanel = "agents" | "skills"

const router = useRouter()
const snapshot = ref<PlatformStudioSnapshot | null>(null)
const loading = ref(false)
const detailLoading = ref(false)
const errorMessage = ref("")
const activePanel = ref<StudioPanel>("agents")
const selectedAgentId = ref("")
const selectedSkillPath = ref("")
const agentContext = ref<AgentContextEntry | null>(null)
const skillDetail = ref<SkillDetailEntry | null>(null)
let detailRequestId = 0

const selectedAgent = computed(() =>
  snapshot.value?.agents.find((agent) => agent.id === selectedAgentId.value) ?? null
)
const selectedSkill = computed(() =>
  snapshot.value?.skills.find((skill) => skill.path === selectedSkillPath.value) ?? null
)
const cardTitle = computed(() =>
  snapshot.value?.card.manifest.name?.trim() || "工作室"
)
const cardIntro = computed(() =>
  snapshot.value?.card.manifest.summary?.trim() || "这张游戏卡还没有简介。"
)
const statusLabel = computed(() => {
  if (!snapshot.value) {
    return "未加载游戏卡"
  }
  return `${snapshot.value.agents.length} 个角色 · ${snapshot.value.skills.length} 个能力`
})
const contextLabel = computed(() => {
  if (!snapshot.value) {
    return ""
  }
  return snapshot.value.usingSaveContext
    ? "使用当前存档上下文"
    : "仅使用游戏卡内容"
})

function entrySummary(value: string | undefined): string {
  return value?.trim() || "暂无简介。"
}

function skillScopeLabel(skill: SkillRegistryEntry): string {
  if (skill.scope === "agent-local") {
    return skill.agentId ? `角色能力：${skill.agentId}` : "角色能力"
  }
  return "共享能力"
}

function abilityCountForAgent(agent: AgentRegistryEntry): number {
  const skills = snapshot.value?.skills ?? []
  const defaultSkills = new Set(agent.defaultSkills)
  return skills.filter((skill) =>
    skill.agentId === agent.id
    || defaultSkills.has(skill.id)
    || defaultSkills.has(skill.name)
  ).length
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B"
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function directoryOf(path: string): string {
  const parts = path.split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
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
    if (!next.skills.some((skill) => skill.path === selectedSkillPath.value)) {
      selectedSkillPath.value = next.skills[0]?.path ?? ""
    }
    if (activePanel.value === "agents" && selectedAgentId.value) {
      await selectAgentById(selectedAgentId.value)
    } else if (activePanel.value === "skills" && selectedSkillPath.value) {
      await selectSkillByPath(selectedSkillPath.value)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法读取工作室。"
  } finally {
    loading.value = false
  }
}

async function selectAgentById(agentId: string) {
  const requestId = ++detailRequestId
  detailLoading.value = true
  agentContext.value = null
  try {
    const context = await getPlatformStudioAgentContext(agentId)
    if (requestId === detailRequestId) {
      agentContext.value = context
    }
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false
    }
  }
}

async function selectSkillByPath(path: string) {
  const requestId = ++detailRequestId
  detailLoading.value = true
  skillDetail.value = null
  try {
    const detail = await getPlatformStudioSkillDetail(path)
    if (requestId === detailRequestId) {
      skillDetail.value = detail
    }
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false
    }
  }
}

function selectAgent(agent: AgentRegistryEntry) {
  activePanel.value = "agents"
  selectedAgentId.value = agent.id
  void selectAgentById(agent.id)
}

function selectSkill(skill: SkillRegistryEntry) {
  activePanel.value = "skills"
  selectedSkillPath.value = skill.path
  void selectSkillByPath(skill.path)
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

function editPath(path: string) {
  if (!snapshot.value) {
    return
  }
  router.push({
    name: "workspace-editor",
    query: {
      cardId: snapshot.value.card.id,
      path,
      mode: "edit",
    },
  })
}

onMounted(() => {
  void refresh()
})
</script>
