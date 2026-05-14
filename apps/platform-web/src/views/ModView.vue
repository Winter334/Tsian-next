<template>
  <!-- 模组页：当前模组的存档管理与设置入口 -->
  <section class="page-section">
    <div v-if="currentMod" class="mod-page">
      <div class="section-copy">
        <p class="section-eyebrow">模组页</p>
        <h2>{{ currentMod.name }}</h2>
        <p>在这里管理当前模组的存档，也可以跳转到平台设置；真正进入游戏后，不再保留平台壳 UI。</p>
      </div>

      <div class="mod-page-grid">
        <article class="feature-card feature-card--hero">
          <div class="feature-card__head">
            <div>
              <p class="mod-kicker">{{ currentMod.id }}</p>
              <h3>{{ currentMod.name }}</h3>
            </div>
            <span class="mod-version">v{{ currentMod.version }}</span>
          </div>
          <p class="feature-card__body">
            {{ currentMod.description || "当前模组未提供描述。" }}
          </p>
          <div class="feature-metrics">
            <span>该模组存档：{{ currentModSaves.length }}</span>
            <span>实体类型：{{ currentMod.entityTypeCount }}</span>
            <span>预设档案：{{ currentMod.archiveCount }}</span>
            <span>预设事件：{{ currentMod.eventCount }}</span>
          </div>
        </article>

        <article class="feature-card">
          <div class="feature-card__head">
            <div>
              <p class="mod-kicker">平台配置</p>
              <h3>当前状态</h3>
            </div>
          </div>
          <div class="quick-list">
            <span>聊天模型：{{ chatModelSummary }}</span>
            <span>检索模型：{{ retrievalModelSummary }}</span>
            <span>嵌入模型：{{ embeddingModelSummary }}</span>
            <span>检索增强：{{ retrievalEnhancedSummary }}</span>
          </div>
          <div class="mod-actions">
            <button class="ghost-button" type="button" @click="goSettings">
              打开平台设置
            </button>
          </div>
        </article>
      </div>

      <div class="section-head">
        <div>
          <p class="section-eyebrow">存档</p>
          <h3>当前模组存档</h3>
        </div>
        <button class="primary-button" type="button" @click="handleCreateSave">
          开始新游戏
        </button>
      </div>

      <div v-if="currentModSaves.length > 0" class="save-list">
        <article
          v-for="save in currentModSaves"
          :key="save.id"
          class="save-card"
          :class="{ 'save-card--selected': save.id === selectedSaveId }"
          @click="selectedSaveId = save.id"
        >
          <div class="save-card__head">
            <div>
              <h4>{{ save.name }}</h4>
              <p class="save-card__meta">
                {{ formatDateTime(save.updatedAt) }}
              </p>
            </div>
            <span v-if="save.id === activeSaveId" class="save-badge">当前激活</span>
          </div>
          <p class="save-card__meta">创建时间：{{ formatDateTime(save.createdAt) }}</p>
          <div class="save-card__actions">
            <button
              class="primary-button"
              type="button"
              @click.stop="handleContinueSave(save.id)"
            >
              继续游戏
            </button>
            <button
              class="ghost-button"
              type="button"
              @click.stop="handleDeleteSave(save.id)"
            >
              删除存档
            </button>
          </div>
        </article>
      </div>
      <article v-else class="empty-card">
        <h4>当前模组还没有存档</h4>
        <p>点击"开始新游戏"后，平台会先创建一个绑定当前模组的新存档，再进入游戏页。</p>
      </article>
    </div>
    <article v-else class="empty-card">
      <h4>未选择模组</h4>
      <p>请先返回大厅选择一个模组。</p>
    </article>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  type BrowserAiConfig,
  type BrowserEmbeddingConfig,
  getBrowserAiConfig,
  getBrowserEmbeddingConfig,
  getBrowserRetrievalConfig,
  getBrowserRetrievalSettings,
} from "../config/ai"
import {
  createPlatformSave,
  deletePlatformSave,
  getPlatformActiveSaveId,
  listPlatformSaves,
  playFrontendBridge,
  selectPlatformSave,
} from "../platform-host"

interface SaveOption {
  id: string
  name: string
  modId: string
  createdAt: number
  updatedAt: number
}

interface BuiltinModSummary {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  entityTypeCount: number
  archiveCount: number
  eventCount: number
}

const route = useRoute()
const router = useRouter()
const builtinMods = ref<BuiltinModSummary[]>([])
const saveOptions = ref<SaveOption[]>([])
const activeSaveId = ref("")
const selectedSaveId = ref("")
const currentMod = ref<BuiltinModSummary | null>(null)
const currentModSaves = ref<SaveOption[]>([])
const chatModelSummary = ref("未配置")
const retrievalModelSummary = ref("未配置")
const embeddingModelSummary = ref("未配置")
const retrievalEnhancedSummary = ref("关闭")

function formatModelSummary(
  config: { baseUrl: string; model: string } | null,
): string {
  if (!config) {
    return "未配置"
  }
  return `${config.model} · ${config.baseUrl}`
}

function refreshConfigSummary() {
  const chat = getBrowserAiConfig() as BrowserAiConfig | null
  const retrieval = getBrowserRetrievalConfig() as BrowserAiConfig | null
  const embedding = getBrowserEmbeddingConfig() as BrowserEmbeddingConfig | null
  chatModelSummary.value = formatModelSummary(chat)
  retrievalModelSummary.value = formatModelSummary(retrieval)
  embeddingModelSummary.value = formatModelSummary(embedding)
  retrievalEnhancedSummary.value = getBrowserRetrievalSettings().aiEnhanced ? "开启" : "关闭"
}

function formatDateTime(input: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(input)
}

function findBuiltinModById(modId: string): BuiltinModSummary | null {
  return builtinMods.value.find((mod) => mod.id === modId) ?? null
}

function syncCurrentModContext(modId: string) {
  currentMod.value = findBuiltinModById(modId)
  currentModSaves.value = saveOptions.value.filter((save) => save.modId === modId)
}

function syncSelectedSaveForCurrentMod() {
  const saves = currentModSaves.value
  if (saves.some((save) => save.id === selectedSaveId.value)) {
    return
  }
  if (activeSaveId.value && saves.some((save) => save.id === activeSaveId.value)) {
    selectedSaveId.value = activeSaveId.value
    return
  }
  selectedSaveId.value = saves[0]?.id ?? ""
}

async function refreshBuiltinMods() {
  const result = await playFrontendBridge.query.query<ModStaticContent>({
    resource: "builtin-mods",
  })
  builtinMods.value = result.items.map((mod) => ({
    id: mod.manifest.id,
    name: mod.manifest.name,
    version: mod.manifest.version,
    author: mod.manifest.author,
    description: mod.manifest.description,
    entityTypeCount: mod.entityTypeDefinitions.length,
    archiveCount: mod.archiveCatalog.length,
    eventCount: mod.eventCatalog.length,
  }))
}

async function refreshSaves() {
  saveOptions.value = (await listPlatformSaves()).map((save) => ({
    id: save.id,
    name: save.name,
    modId: save.modId,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
  }))
  activeSaveId.value = (await getPlatformActiveSaveId()) ?? ""
}

function currentModIdFromRoute(): string {
  const raw = route.query.id
  if (typeof raw === "string" && raw.length > 0) {
    return raw
  }
  return builtinMods.value[0]?.id ?? ""
}

async function handleCreateSave() {
  if (!currentMod.value) {
    return
  }
  const created = await createPlatformSave({ modId: currentMod.value.id })
  await refreshSaves()
  syncCurrentModContext(currentMod.value.id)
  selectedSaveId.value = created.id
  router.push("/play")
}

async function handleContinueSave(saveId: string) {
  await selectPlatformSave(saveId)
  await refreshSaves()
  router.push("/play")
}

async function handleDeleteSave(saveId: string) {
  await deletePlatformSave(saveId)
  await refreshSaves()
  if (currentMod.value) {
    syncCurrentModContext(currentMod.value.id)
    syncSelectedSaveForCurrentMod()
  }
}

function goSettings() {
  router.push("/settings")
}

onMounted(async () => {
  refreshConfigSummary()
  await refreshBuiltinMods()
  await refreshSaves()
  syncCurrentModContext(currentModIdFromRoute())
  syncSelectedSaveForCurrentMod()
})

watch(
  () => route.query.id,
  () => {
    syncCurrentModContext(currentModIdFromRoute())
    syncSelectedSaveForCurrentMod()
  },
)
</script>

<style scoped>
.page-section {
  display: grid;
  gap: var(--ts-space-6);
  margin-top: var(--ts-space-6);
}

.section-copy {
  display: grid;
  gap: var(--ts-space-2);
}

.section-eyebrow,
.mod-kicker {
  margin: 0 0 var(--ts-space-3);
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-xs);
  letter-spacing: var(--ts-tracking-wide);
  text-transform: uppercase;
}

h2 {
  margin: 0;
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-2xl);
  line-height: var(--ts-leading-tight);
  color: var(--ts-color-text-primary);
}

h3 {
  margin: 0;
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-xl);
  line-height: 1.3;
  color: var(--ts-color-text-primary);
}

h4 {
  margin: 0;
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-lg);
  line-height: 1.35;
  color: var(--ts-color-text-primary);
}

.section-copy p,
.feature-card__body,
.empty-card p {
  margin: 0;
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-base);
  line-height: var(--ts-leading-normal);
}

.mod-page {
  display: grid;
  gap: var(--ts-space-6);
}

.mod-page-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: var(--ts-space-4);
}

.feature-card,
.empty-card,
.save-card {
  padding: var(--ts-space-4);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-xl);
  background: var(--ts-color-surface-raised);
  box-shadow: var(--ts-shadow-2);
}

.feature-card {
  display: grid;
  gap: var(--ts-space-3);
}

.feature-card--hero {
  background: var(--ts-bg-parchment);
}

.feature-card__head,
.save-card__head,
.section-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--ts-space-3);
}

.section-head {
  align-items: end;
}

.mod-version,
.save-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--ts-space-1) var(--ts-space-2);
  border-radius: var(--ts-radius-full);
  background: var(--ts-color-accent-subtle);
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-xs);
  line-height: 1;
}

.feature-metrics,
.quick-list {
  display: grid;
  gap: var(--ts-space-2);
}

.feature-metrics span,
.quick-list span,
.save-card__meta {
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-sm);
  line-height: 1.7;
}

.save-list {
  display: grid;
  gap: var(--ts-space-4);
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}

.save-card {
  display: grid;
  gap: var(--ts-space-3);
  cursor: pointer;
}

.save-card--selected {
  border-color: var(--ts-color-accent-default);
  box-shadow: 0 0 0 1px var(--ts-color-accent-subtle) inset, var(--ts-shadow-2);
}

.mod-actions,
.save-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ts-space-3);
}

.primary-button,
.ghost-button {
  padding: var(--ts-space-3) var(--ts-space-4);
  border-radius: var(--ts-radius-lg);
  font: inherit;
  font-weight: var(--ts-weight-medium);
  cursor: pointer;
  transition:
    transform var(--ts-duration-default) var(--ts-ease-out),
    background var(--ts-duration-default) var(--ts-ease-out);
}

.primary-button {
  border: 1px solid var(--ts-color-accent-default);
  background: var(--ts-color-accent-default);
  color: var(--ts-color-accent-fg);
}

.ghost-button {
  border: 1px solid var(--ts-color-border-strong);
  background: var(--ts-color-surface-overlay);
  color: var(--ts-color-text-primary);
}

.primary-button:hover,
.ghost-button:hover {
  transform: translateY(-1px);
}

@media (max-width: 1080px) {
  .mod-page-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .save-list {
    grid-template-columns: 1fr;
  }

  .feature-card__head,
  .save-card__head,
  .section-head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
