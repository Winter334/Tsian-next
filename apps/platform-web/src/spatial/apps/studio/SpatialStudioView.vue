<template>
  <section class="spatial-app spatial-studio" aria-label="工作室">
    <header class="spatial-app__header">
      <div class="spatial-app__identity">
        <span class="spatial-app__eyebrow">AGENT STUDIO · {{ snapshot?.agents.length ?? 0 }}</span>
        <h1>{{ cardTitle }}</h1>
      </div>
      <div class="spatial-app__commands">
        <SpatialActionButton :disabled="loading" @click="refresh">
          <template #icon><RefreshCw /></template>{{ loading ? "刷新中…" : "刷新" }}
        </SpatialActionButton>
        <SpatialActionButton :disabled="!snapshot" @click="openWorkspace">
          <template #icon><FolderOpen /></template>资源管理器
        </SpatialActionButton>
      </div>
    </header>

    <main v-if="loading" class="spatial-app__empty" role="status">正在读取工作室…</main>
    <main v-else-if="isNoCardError" class="spatial-app__empty spatial-studio__center">
      <Bot aria-hidden="true" />
      <strong>未加载游戏卡</strong>
      <span>请先创建、导入或加载一张游戏卡。</span>
      <div class="spatial-app__actions">
        <SpatialActionButton variant="primary" @click="goToLibrary">去我的应用</SpatialActionButton>
        <SpatialActionButton @click="goToMarket">去创意工坊</SpatialActionButton>
      </div>
    </main>
    <main v-else-if="errorMessage" class="spatial-app__banner spatial-app__banner--error" role="alert">
      {{ errorMessage }}
    </main>

    <main v-else-if="snapshot" class="spatial-studio__workspace">
      <aside class="spatial-studio__agents" aria-label="Agent 列表">
        <div class="spatial-studio__aside-title">
          <span class="spatial-app__eyebrow">AGENTS</span>
          <strong>{{ snapshot.agents.length }}</strong>
        </div>
        <button
          v-for="agent in snapshot.agents"
          :key="agent.path"
          type="button"
          class="spatial-studio__agent"
          :class="{ 'spatial-studio__agent--active': selectedAgent?.id === agent.id }"
          :aria-pressed="selectedAgent?.id === agent.id"
          @click="selectAgent(agent)"
        >
          <span><strong>{{ agent.title }}</strong><small v-if="agent.system">主入口</small></span>
          <p>{{ entrySummary(agent.summary) }}</p>
          <small>{{ enabledSkillCount(agent) }} 个已启用 Skill</small>
        </button>
      </aside>

      <section v-if="selectedAgent" class="spatial-studio__detail">
        <div class="spatial-studio__topline">
          <SpatialSelect
            :model-value="selectedAgentId"
            :options="agentOptions"
            aria-label="选择 Agent"
            @change="selectAgentById"
          />
          <SpatialActionButton icon-only :aria-label="`打开 ${selectedAgent.title} 目录`" @click="openPathDirectory(selectedAgent.path)">
            <template #icon><FolderOpen /></template>
          </SpatialActionButton>
        </div>

        <div class="spatial-app__segments" role="tablist" aria-label="Agent 管理">
          <button v-for="tab in tabs" :key="tab.id" type="button" class="spatial-app__segment" role="tab" :aria-selected="activeTab === tab.id" @click="activeTab = tab.id">
            {{ tab.label }}
          </button>
        </div>

        <div v-if="contextLoading" class="spatial-app__empty">正在读取 Agent…</div>
        <div v-else-if="!agentContext" class="spatial-app__banner spatial-app__banner--error">无法读取选中的 Agent。</div>

        <div v-else-if="activeTab === 'profile'" class="spatial-studio__profile">
          <section class="spatial-app__section">
            <div class="spatial-studio__section-title">
              <div><h2>Agent 指令</h2><span class="spatial-app__meta">{{ agentFilePath }}</span></div>
              <SpatialActionButton @click="openEditor(agentFilePath)"><template #icon><FilePenLine /></template>编辑</SpatialActionButton>
            </div>
            <pre>{{ agentDraft || "暂无内容" }}</pre>
          </section>
          <section class="spatial-app__section">
            <div class="spatial-studio__section-title">
              <div><h2>风格与人格</h2><span class="spatial-app__meta">{{ soulFilePath || "未配置" }}</span></div>
              <SpatialActionButton :disabled="!soulFilePath" @click="openEditor(soulFilePath)"><template #icon><FilePenLine /></template>编辑</SpatialActionButton>
            </div>
            <pre>{{ soulDraft || "未找到 SOUL.md" }}</pre>
          </section>
          <section class="spatial-app__section">
            <div class="spatial-studio__section-title">
              <div><h2>Agent 配置</h2><span class="spatial-app__meta">{{ selectedAgent.configPath || "未配置" }}</span></div>
              <SpatialActionButton :disabled="!selectedAgent.configPath" @click="openEditor(selectedAgent.configPath)"><template #icon><FilePenLine /></template>编辑</SpatialActionButton>
            </div>
            <p class="spatial-studio__config-summary">服务商：{{ providerPresetDescription }} · Workspace：{{ workspaceAccessDescription }}</p>
          </section>
          <section v-if="modulesForSelectedAgent.length" class="spatial-app__section">
            <h2>规则模块</h2>
            <button v-for="module in modulesForSelectedAgent" :key="module.path" type="button" class="spatial-studio__module" @click="openEditor(module.path)">
              <strong>{{ module.title || module.path }}</strong><small>{{ module.path }}</small>
            </button>
          </section>
        </div>

        <div v-else-if="activeTab === 'skills'" class="spatial-studio__list">
          <article v-for="skill in skillsForSelectedAgent" :key="skill.path" class="spatial-app__section spatial-studio__row">
            <div><h2>{{ skill.title }}</h2><p>{{ entrySummary(skill.description || skill.summary) }}</p><small>{{ skill.path }}</small></div>
            <div class="spatial-app__actions">
              <SpatialActionButton @click="openEditor(skill.path)">
                <template #icon><FilePenLine /></template>编辑
              </SpatialActionButton>
              <SpatialActionButton :disabled="togglingSkillPath === skill.path || deletingSkillPath === skill.path" :aria-pressed="skillEnabled(skill)" @click="toggleSkill(skill, !skillEnabled(skill))">
                {{ skillEnabled(skill) ? "已启用" : "已禁用" }}
              </SpatialActionButton>
              <SpatialActionButton variant="danger" :disabled="deletingSkillPath === skill.path" @click="deleteSkill(skill)">
                <template #icon><Trash2 /></template>删除
              </SpatialActionButton>
            </div>
          </article>
          <div v-if="skillsForSelectedAgent.length === 0" class="spatial-app__empty">这个 Agent 还没有可管理的 Skill。</div>
        </div>

        <div v-else class="spatial-studio__runtime">
          <section class="spatial-app__section spatial-studio__settings">
            <label class="spatial-app__field"><span>服务商预设</span>
              <SpatialSelect :model-value="selectedAgent.providerPresetId || '__platform_default__'" :options="providerOptions" :disabled="updatingProviderPreset" @change="(value) => updateProviderPreset(value === '__platform_default__' ? '' : value)" />
            </label>
            <p>{{ providerPresetDescription }}</p>
            <label class="spatial-app__field"><span>Workspace 权限</span>
              <SpatialSelect :model-value="String(selectedAgent.workspaceAccess.level ?? 1)" :options="workspaceOptions" :disabled="updatingWorkspaceAccess" @change="(value) => updateWorkspaceAccessLevel(Number(value))" />
            </label>
            <p>{{ workspaceAccessDescription }}</p>
          </section>
          <section class="spatial-app__section">
            <div class="spatial-studio__section-title"><h2>能力开关</h2><span class="spatial-app__meta">{{ enabledRuntimeCapabilityCount }} / {{ runtimeCapabilities.length }} 已启用</span></div>
            <div class="spatial-studio__capabilities">
              <button v-for="capability in runtimeCapabilities" :key="capability.key" type="button" class="spatial-studio__capability" :aria-pressed="capability.enabled" :disabled="capability.disabled" @click="toggleRuntimeCapability(capability, !capability.enabled)">
                <span><strong>{{ capability.title }}</strong><small>{{ capability.badge }}</small></span>
                <p>{{ capability.description }}</p>
                <b>{{ capability.enabled ? "ON" : "OFF" }}</b>
              </button>
            </div>
            <details v-if="toolDiagnostics.length" class="spatial-studio__diagnostics"><summary>{{ toolDiagnostics.length }} 条 Tool 注册诊断</summary><p v-for="diag in toolDiagnostics" :key="`${diag.code}:${diag.path}`">{{ diag.code }} · {{ diag.message }}</p></details>
          </section>
        </div>
      </section>
    </main>

    <footer class="spatial-app__status"><span>{{ feedbackMessage }}</span><span>{{ statusLabel }}</span></footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { useRouter } from "vue-router"
import { Bot, FilePenLine, FolderOpen, RefreshCw, Trash2 } from "lucide-vue-next"
import { STUDIO_WORKSPACE_ACCESS_OPTIONS, useStudioController } from "@/controllers/studio/use-studio-controller"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialSelect from "../primitives/SpatialSelect.vue"
import "../spatial-apps.css"

const router = useRouter()
const activeTab = ref<"profile" | "skills" | "runtime">("profile")
const tabs = [
  { id: "profile" as const, label: "指令与规则" },
  { id: "skills" as const, label: "Skills" },
  { id: "runtime" as const, label: "运行配置" },
]

const controller = useStudioController({
  openWorkspace(input) { void router.push({ name: "workspace", query: { cardId: input.cardId, ...(input.path ? { path: input.path } : {}) } }) },
  openLibrary() { void router.push("/library") },
  openMarket() { void router.push("/market") },
})
const {
  snapshot, agentContext, loading, contextLoading, errorMessage, feedbackMessage,
  selectedAgentId, selectedAgent, agentDraft, soulDraft, togglingSkillPath,
  deletingSkillPath, updatingWorkspaceAccess, updatingProviderPreset,
  providerPresetOptions, providerPresetDescription, cardTitle, agentFilePath,
  soulFilePath, skillsForSelectedAgent, modulesForSelectedAgent, toolDiagnostics,
  runtimeCapabilities, enabledRuntimeCapabilityCount, workspaceAccessDescription,
  statusLabel, isNoCardError, entrySummary, skillEnabled, enabledSkillCount,
  refresh, selectAgent, selectAgentById, toggleSkill, deleteSkill,
  toggleRuntimeCapability, updateWorkspaceAccessLevel, updateProviderPreset,
  openWorkspace, openPathDirectory, goToLibrary, goToMarket,
} = controller

const agentOptions = computed(() => (snapshot.value?.agents ?? []).map((agent) => ({ value: agent.id, label: `${agent.title}${agent.system ? " · 主入口" : ""}` })))
const providerOptions = computed(() => [
  { value: "__platform_default__", label: "使用平台默认" },
  ...providerPresetOptions.value.map((preset) => ({ value: preset.id, label: preset.name })),
])
const workspaceOptions = STUDIO_WORKSPACE_ACCESS_OPTIONS.map((option) => ({ value: String(option.level), label: option.label }))

function openEditor(path: string): void {
  if (!snapshot.value || !path) return
  void router.push({ name: "workspace-editor", query: { cardId: snapshot.value.card.id, path, mode: "edit" } })
}
</script>

<style scoped>
.spatial-studio { grid-template-rows: auto minmax(0, 1fr) auto; }
.spatial-studio__center { place-content: center; justify-items: center; text-align: center; }
.spatial-studio__center > svg { width: 40px; height: 40px; color: var(--spatial-window-accent); }
.spatial-studio__workspace { display: grid; min-width: 0; min-height: 0; grid-template-columns: minmax(170px, 0.28fr) minmax(0, 1fr); overflow: hidden; }
.spatial-studio__agents { min-width: 0; min-height: 0; padding: 9px; overflow: auto; border-right: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface-muted); }
.spatial-studio__aside-title, .spatial-studio__topline, .spatial-studio__section-title { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 9px; }
.spatial-studio__aside-title { padding: 5px 5px 10px; }
.spatial-studio__agent { display: grid; width: 100%; min-width: 0; margin-bottom: 6px; padding: 10px; gap: 5px; border: 1px solid var(--spatial-app-border); color: var(--spatial-window-ink); background: var(--spatial-app-surface); text-align: left; }
.spatial-studio__agent:hover, .spatial-studio__agent[data-spatial-hover], .spatial-studio__agent--active { background: var(--spatial-app-surface-strong); }
.spatial-studio__agent--active { border-left: 3px solid var(--spatial-window-accent); }
.spatial-studio__agent span { display: flex; justify-content: space-between; gap: 6px; }
.spatial-studio__agent p, .spatial-studio__agent small, .spatial-studio__row p, .spatial-studio__row small, .spatial-studio__settings p { margin: 0; color: var(--spatial-app-muted); font-size: 9px; line-height: 1.5; }
.spatial-studio__detail { display: grid; min-width: 0; min-height: 0; padding: 10px; grid-template-rows: auto auto minmax(0, 1fr); gap: 9px; overflow: hidden; }
.spatial-studio__topline .spatial-select { min-width: min(320px, calc(100% - 48px)); }
.spatial-studio__profile, .spatial-studio__list, .spatial-studio__runtime { min-width: 0; min-height: 0; overflow: auto; }
.spatial-studio__profile, .spatial-studio__list, .spatial-studio__runtime { display: grid; align-content: start; gap: 9px; }
.spatial-studio__section-title > div { min-width: 0; }
.spatial-studio__section-title .spatial-app__meta { display: block; max-width: 420px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spatial-studio pre { max-height: 220px; margin: 10px 0 0; padding: 10px; overflow: auto; white-space: pre-wrap; color: var(--spatial-app-muted); background: var(--spatial-app-surface); font: 9px/1.65 "JetBrains Mono", monospace; }
.spatial-studio__config-summary { margin: 10px 0 0; color: var(--spatial-app-muted); font-size: 9px; line-height: 1.6; }
.spatial-studio__module { display: grid; width: 100%; padding: 8px 0; gap: 3px; border: 0; border-bottom: 1px solid var(--spatial-app-border); color: inherit; background: transparent; text-align: left; }
.spatial-studio__module small { color: var(--spatial-app-muted); }
.spatial-studio__row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.spatial-studio__settings { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.spatial-studio__settings p { align-self: end; }
.spatial-studio__capabilities { display: grid; margin-top: 10px; gap: 7px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.spatial-studio__capability { position: relative; display: grid; min-width: 0; padding: 10px 42px 10px 10px; gap: 5px; border: 1px solid var(--spatial-app-border); color: inherit; background: var(--spatial-app-surface); text-align: left; }
.spatial-studio__capability[aria-pressed="true"] { border-left: 3px solid var(--spatial-window-accent); background: var(--spatial-app-accent-soft); }
.spatial-studio__capability span { display: grid; gap: 2px; }
.spatial-studio__capability small, .spatial-studio__capability p { margin: 0; color: var(--spatial-app-muted); font-size: 8px; }
.spatial-studio__capability b { position: absolute; top: 10px; right: 9px; color: var(--spatial-window-accent); font: 8px "JetBrains Mono", monospace; }
.spatial-studio__diagnostics { margin-top: 10px; color: var(--spatial-app-muted); font-size: 9px; }
@container (max-width: 700px) { .spatial-studio__workspace { grid-template-columns: 1fr; overflow: auto; } .spatial-studio__agents { display: none; } .spatial-studio__detail { min-height: 440px; } .spatial-studio__capabilities, .spatial-studio__settings { grid-template-columns: 1fr; } }
</style>
