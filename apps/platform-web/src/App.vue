<template>
  <main class="app-shell">
    <template v-if="view !== 'play'">
      <section class="panel">
        <header class="panel-header">
          <div class="panel-copy">
            <p class="eyebrow">Tsian</p>
            <h1>Platform Lobby</h1>
            <p class="summary">
              先在平台大厅选择模组，再进入对应模组页管理存档与查看平台设置；只有真正进入游戏时，才挂载游玩前端。
            </p>
          </div>
          <div class="status-grid">
            <article class="status-card">
              <span>Storage</span>
              <strong>{{ storageStatus }}</strong>
            </article>
            <article class="status-card">
              <span>AI</span>
              <strong>{{ aiStatus }}</strong>
            </article>
            <article class="status-card">
              <span>Frontend</span>
              <strong>{{ frontendName }}</strong>
            </article>
          </div>
        </header>

        <nav class="platform-nav">
          <button
            class="nav-button"
            :class="{ 'nav-button--active': view === 'lobby' }"
            type="button"
            @click="openLobby"
          >
            大厅
          </button>
          <button
            class="nav-button"
            :class="{ 'nav-button--active': view === 'mod' }"
            type="button"
            :disabled="!currentMod"
            @click="openCurrentModPage"
          >
            模组页
          </button>
          <button
            class="nav-button"
            :class="{ 'nav-button--active': view === 'settings' }"
            type="button"
            @click="openSettings"
          >
            设置
          </button>
        </nav>

        <section v-if="view === 'lobby'" class="page-section">
          <div class="section-copy">
            <p class="section-eyebrow">大厅</p>
            <h2>选择一个模组</h2>
            <p>
              模组页会只展示该模组自己的存档，不再把所有模组的存档混在一起。
            </p>
          </div>
          <div class="mod-grid">
            <article v-for="mod in builtinMods" :key="mod.id" class="mod-card">
              <div class="mod-card__head">
                <div>
                  <p class="mod-kicker">{{ mod.id }}</p>
                  <h3>{{ mod.name }}</h3>
                </div>
                <span class="mod-version">v{{ mod.version }}</span>
              </div>
              <p class="mod-description">
                {{ mod.description || "当前模组未提供描述。" }}
              </p>
              <div class="mod-meta">
                <span>作者：{{ mod.author || "未填写" }}</span>
                <span>存档：{{ countSavesForMod(mod.id) }}</span>
                <span>实体类型：{{ mod.entityTypeCount }}</span>
                <span>预设事件：{{ mod.eventCount }}</span>
              </div>
              <div class="mod-actions">
                <button class="primary-button" type="button" @click="openModPage(mod.id)">
                  进入模组页
                </button>
              </div>
            </article>
          </div>
        </section>

        <section v-else-if="view === 'mod'" class="page-section">
          <div v-if="currentMod" class="mod-page">
            <div class="section-copy">
              <p class="section-eyebrow">模组页</p>
              <h2>{{ currentMod.name }}</h2>
              <p>
                在这里管理当前模组的存档，也可以跳转到平台设置；真正进入游戏后，不再保留平台壳 UI。
              </p>
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
                  <button class="ghost-button" type="button" @click="openSettings">
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
              <p>点击“开始新游戏”后，平台会先创建一个绑定当前模组的新存档，再进入游戏页。</p>
            </article>
          </div>
        </section>

        <section v-else class="page-section">
          <div class="section-copy">
            <p class="section-eyebrow">设置</p>
            <h2>平台设置</h2>
            <p>
              当前阶段先提供最小可写入口：通用聊天 AI、检索 AI、Embedding 和检索参数都可以直接在浏览器本地保存。
            </p>
          </div>

          <div class="settings-actions">
            <div class="quick-list">
              <span>当前生效聊天模型：{{ chatModelSummary }}</span>
              <span>当前生效检索模型：{{ retrievalModelSummary }}</span>
              <span>当前生效嵌入模型：{{ embeddingModelSummary }}</span>
              <span>当前检索增强：{{ retrievalEnhancedSummary }}</span>
            </div>
            <div class="mod-actions">
              <button class="primary-button" type="button" @click="handleSaveSettings">
                保存本地配置
              </button>
              <button class="ghost-button" type="button" @click="handleResetSettings">
                重置为环境默认
              </button>
            </div>
            <p v-if="settingsFeedback" class="settings-message settings-message--ok">
              {{ settingsFeedback }}
            </p>
            <p v-if="settingsError" class="settings-message settings-message--error">
              {{ settingsError }}
            </p>
          </div>

          <div class="settings-grid">
            <article class="feature-card settings-panel">
              <div class="feature-card__head">
                <div>
                  <p class="mod-kicker">AI</p>
                  <h3>通用聊天 AI</h3>
                </div>
              </div>
              <div class="form-grid">
                <label class="field-group">
                  <span>Base URL</span>
                  <input
                    v-model="platformConfigDraft.chat.baseUrl"
                    class="field-input"
                    type="text"
                    :placeholder="effectiveChatConfig?.baseUrl || 'https://example.com/v1'"
                  />
                </label>
                <label class="field-group">
                  <span>Model</span>
                  <input
                    v-model="platformConfigDraft.chat.model"
                    class="field-input"
                    type="text"
                    :placeholder="effectiveChatConfig?.model || '模型名'"
                  />
                </label>
                <label class="field-group">
                  <span>API Key</span>
                  <input
                    v-model="platformConfigDraft.chat.apiKey"
                    class="field-input"
                    type="password"
                    :placeholder="effectiveChatConfig ? '已配置，可留空回退' : 'sk-...'"
                  />
                </label>
              </div>
              <p class="settings-note">这一组同时服务正文 AI 和维护 AI。留空表示回退到浏览器环境变量。</p>
            </article>

            <article class="feature-card settings-panel">
              <div class="feature-card__head">
                <div>
                  <p class="mod-kicker">AI</p>
                  <h3>检索 AI</h3>
                </div>
              </div>
              <div class="form-grid">
                <label class="field-group">
                  <span>Base URL</span>
                  <input
                    v-model="platformConfigDraft.retrieval.baseUrl"
                    class="field-input"
                    type="text"
                    :placeholder="effectiveRetrievalConfig?.baseUrl || '留空表示跟随通用聊天配置'"
                  />
                </label>
                <label class="field-group">
                  <span>Model</span>
                  <input
                    v-model="platformConfigDraft.retrieval.model"
                    class="field-input"
                    type="text"
                    :placeholder="effectiveRetrievalConfig?.model || '留空表示跟随通用聊天配置'"
                  />
                </label>
                <label class="field-group">
                  <span>API Key</span>
                  <input
                    v-model="platformConfigDraft.retrieval.apiKey"
                    class="field-input"
                    type="password"
                    :placeholder="effectiveRetrievalConfig ? '已配置，可留空回退' : '留空表示跟随通用聊天配置'"
                  />
                </label>
              </div>
              <p class="settings-note">留空时按当前代码口径回退到 `VITE_RETRIEVAL_*`，再回退到通用聊天配置。</p>
            </article>

            <article class="feature-card settings-panel">
              <div class="feature-card__head">
                <div>
                  <p class="mod-kicker">AI</p>
                  <h3>Embedding</h3>
                </div>
              </div>
              <div class="form-grid">
                <label class="field-group">
                  <span>Base URL</span>
                  <input
                    v-model="platformConfigDraft.embedding.baseUrl"
                    class="field-input"
                    type="text"
                    :placeholder="effectiveEmbeddingConfig?.baseUrl || '留空表示沿用通用聊天配置'"
                  />
                </label>
                <label class="field-group">
                  <span>Model</span>
                  <input
                    v-model="platformConfigDraft.embedding.model"
                    class="field-input"
                    type="text"
                    :placeholder="effectiveEmbeddingConfig?.model || 'Qwen/Qwen3-Embedding-8B'"
                  />
                </label>
                <label class="field-group">
                  <span>API Key</span>
                  <input
                    v-model="platformConfigDraft.embedding.apiKey"
                    class="field-input"
                    type="password"
                    :placeholder="effectiveEmbeddingConfig ? '已配置，可留空回退' : '留空表示沿用通用聊天配置'"
                  />
                </label>
              </div>
              <p class="settings-note">Embedding 的 `baseUrl / apiKey` 可沿用通用聊天配置，但 `model` 仍建议单独明确填写。</p>
            </article>

            <article class="feature-card settings-panel settings-panel--wide">
              <div class="feature-card__head">
                <div>
                  <p class="mod-kicker">检索</p>
                  <h3>检索参数</h3>
                </div>
              </div>
              <div class="toggle-row">
                <label class="checkbox-field">
                  <input v-model="platformConfigDraft.retrievalSettings.aiEnhanced" type="checkbox" />
                  <span>开启 AI 增强检索</span>
                </label>
                <span class="settings-note">关闭时只走结构检索；开启后会额外触发关键词提取与向量检索。</span>
              </div>
              <div class="number-grid">
                <label class="field-group">
                  <span>最近消息数</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.recentMessageLimit"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>候选事件上限</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.maxCandidates"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>预设事件注入上限</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.maxCatalogInjected"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>预设事件分数阈值</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.minCatalogEventScore"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>基础 seed 数量</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.baseSeedEventLimit"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>复杂剧情 seed 数量</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.complexSeedEventLimit"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>复杂实体阈值</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.complexEntityThreshold"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>相邻事件扩展数</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.maxChainNeighborsPerSeed"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>事件注入上限</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.maxInjectedEvents"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>seed 分数阈值</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.minSeedScore"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>桥接实体上限</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.bridgeEntityLimit"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>桥接实体分数阈值</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.minBridgeEntityScore"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>语义事件上限</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.semanticEventLimit"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>语义档案上限</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.semanticArchiveLimit"
                    class="field-input"
                    type="number"
                    min="0"
                  />
                </label>
                <label class="field-group">
                  <span>语义相似度阈值</span>
                  <input
                    v-model.number="platformConfigDraft.retrievalSettings.semanticScoreThreshold"
                    class="field-input"
                    type="number"
                    min="0"
                    step="0.01"
                  />
                </label>
              </div>
            </article>

            <article class="feature-card settings-panel">
              <div class="feature-card__head">
                <div>
                  <p class="mod-kicker">平台</p>
                  <h3>当前概况</h3>
                </div>
              </div>
              <div class="quick-list">
                <span>内置模组：{{ builtinMods.length }}</span>
                <span>本地存档：{{ saveOptions.length }}</span>
                <span>当前模组：{{ currentMod?.name || "未选择" }}</span>
                <span>当前激活存档：{{ activeSaveId || "无" }}</span>
                <span>当前 localStorage 覆盖：{{ aiStatus }}</span>
              </div>
            </article>
          </div>
        </section>
      </section>
    </template>

    <div v-else ref="frontendMount" class="frontend-stage"></div>
  </main>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue"
import {
  type BrowserAiConfig,
  type BrowserEmbeddingConfig,
  type BrowserPlatformConfigDraft,
  type BrowserRetrievalSettings,
  getBrowserAiConfig,
  getBrowserEmbeddingConfig,
  getBrowserPlatformConfigDraft,
  getBrowserPlatformConfigStorageState,
  getBrowserRetrievalConfig,
  getBrowserRetrievalSettings,
  resetBrowserPlatformConfigDraft,
  saveBrowserPlatformConfigDraft,
} from "./config/ai"
import {
  createPlatformSave,
  deletePlatformSave,
  getPlatformActiveSaveId,
  initializePlatformHost,
  listPlatformSaves,
  playFrontendBridge,
  selectPlatformSave,
} from "./platform-host"
import { loadOfficialDefaultFrontend } from "./package-loader/official-default"
import { ensureLocalStorageReady } from "./storage"

type AppView = "lobby" | "mod" | "settings" | "play"

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

const storageStatus = ref("checking...")
const aiStatus = ref("checking...")
const frontendName = ref("idle")
const view = ref<AppView>("lobby")
const lastPlatformView = ref<"lobby" | "mod">("lobby")
const frontendMount = ref<HTMLElement | null>(null)
const builtinMods = ref<BuiltinModSummary[]>([])
const saveOptions = ref<SaveOption[]>([])
const activeSaveId = ref("")
const selectedBuiltinModId = ref("")
const selectedSaveId = ref("")
const currentMod = ref<BuiltinModSummary | null>(null)
const currentModSaves = ref<SaveOption[]>([])
const chatModelSummary = ref("未配置")
const retrievalModelSummary = ref("未配置")
const embeddingModelSummary = ref("未配置")
const retrievalEnhancedSummary = ref("关闭")
const effectiveChatConfig = ref<BrowserAiConfig | null>(null)
const effectiveRetrievalConfig = ref<BrowserAiConfig | null>(null)
const effectiveEmbeddingConfig = ref<BrowserEmbeddingConfig | null>(null)
const effectiveRetrievalSettings = ref<BrowserRetrievalSettings>(getBrowserRetrievalSettings())
const platformConfigDraft = ref<BrowserPlatformConfigDraft>(getBrowserPlatformConfigDraft())
const settingsFeedback = ref("")
const settingsError = ref("")
let disposeFrontend: (() => void) | null = null

function formatModelSummary(
  config:
    | {
        baseUrl: string
        model: string
      }
    | null,
): string {
  if (!config) {
    return "未配置"
  }

  return `${config.model} · ${config.baseUrl}`
}

function clonePlatformConfigDraft(input: BrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  return {
    chat: { ...input.chat },
    retrieval: { ...input.retrieval },
    embedding: { ...input.embedding },
    retrievalSettings: { ...input.retrievalSettings },
  }
}

function platformStatusText(): string {
  return [
    `chat=${getBrowserAiConfig() ? "configured" : "missing"}`,
    `retrieval=${getBrowserRetrievalConfig() ? "configured" : "missing"}`,
    `embed=${getBrowserEmbeddingConfig() ? "configured" : "missing"}`,
    `local=${getBrowserPlatformConfigStorageState()}`,
  ].join(" | ")
}

// 设置页既要展示当前生效配置，也要单独维护一份可编辑草稿。
function refreshPlatformConfigState(options: { reloadDraft?: boolean } = {}) {
  effectiveChatConfig.value = getBrowserAiConfig()
  effectiveRetrievalConfig.value = getBrowserRetrievalConfig()
  effectiveEmbeddingConfig.value = getBrowserEmbeddingConfig()
  effectiveRetrievalSettings.value = getBrowserRetrievalSettings()
  chatModelSummary.value = formatModelSummary(effectiveChatConfig.value)
  retrievalModelSummary.value = formatModelSummary(effectiveRetrievalConfig.value)
  embeddingModelSummary.value = formatModelSummary(effectiveEmbeddingConfig.value)
  retrievalEnhancedSummary.value = effectiveRetrievalSettings.value.aiEnhanced ? "开启" : "关闭"
  aiStatus.value = platformStatusText()

  if (options.reloadDraft) {
    platformConfigDraft.value = clonePlatformConfigDraft(getBrowserPlatformConfigDraft())
  }
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

function countSavesForMod(modId: string): number {
  return saveOptions.value.filter((save) => save.modId === modId).length
}

function findBuiltinModById(modId: string): BuiltinModSummary | null {
  for (const mod of builtinMods.value) {
    if (mod.id === modId) {
      return mod
    }
  }

  return null
}

function syncCurrentModContext() {
  currentMod.value = findBuiltinModById(selectedBuiltinModId.value)
  currentModSaves.value = saveOptions.value.filter((save) => save.modId === selectedBuiltinModId.value)
}

function unmountFrontend() {
  disposeFrontend?.()
  disposeFrontend = null
  frontendName.value = "idle"
}

function mountFrontend() {
  unmountFrontend()

  const frontend = loadOfficialDefaultFrontend()
  frontendName.value = `${frontend.manifest.name} (${frontend.manifest.version})`

  if (frontendMount.value) {
    disposeFrontend = frontend.mount(frontendMount.value, playFrontendBridge)
  }
}

// 平台页和游戏页分离后，需要始终把“当前模组下的已选存档”单独同步。
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

function syncSelectedMod() {
  if (!builtinMods.value.some((mod) => mod.id === selectedBuiltinModId.value)) {
    selectedBuiltinModId.value = builtinMods.value[0]?.id ?? ""
  }
  syncCurrentModContext()
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
  syncSelectedMod()
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
  syncCurrentModContext()
  syncSelectedSaveForCurrentMod()
}

function openLobby() {
  unmountFrontend()
  view.value = "lobby"
}

function openModPage(modId: string) {
  unmountFrontend()
  selectedBuiltinModId.value = modId
  syncCurrentModContext()
  syncSelectedSaveForCurrentMod()
  view.value = "mod"
}

function openCurrentModPage() {
  if (!currentMod.value) {
    return
  }

  openModPage(currentMod.value.id)
}

function openSettings() {
  if (view.value === "lobby" || view.value === "mod") {
    lastPlatformView.value = view.value
  }
  unmountFrontend()
  view.value = "settings"
}

async function enterPlay(saveId: string) {
  await selectPlatformSave(saveId)
  await refreshSaves()
  view.value = "play"
  await nextTick()
  mountFrontend()
}

async function handleCreateSave() {
  if (!selectedBuiltinModId.value) {
    return
  }

  const created = await createPlatformSave({
    modId: selectedBuiltinModId.value,
  })
  await refreshSaves()
  selectedSaveId.value = created.id
  view.value = "play"
  await nextTick()
  mountFrontend()
}

async function handleContinueSave(saveId: string) {
  await enterPlay(saveId)
}

async function handleDeleteSave(saveId: string) {
  await deletePlatformSave(saveId)
  await refreshSaves()
}

function handleSaveSettings() {
  try {
    saveBrowserPlatformConfigDraft(platformConfigDraft.value)
    refreshPlatformConfigState({ reloadDraft: true })
    settingsError.value = ""
    settingsFeedback.value = "平台本地配置已保存，新一轮 AI 请求将直接读取这份配置。"
  } catch (error) {
    settingsFeedback.value = ""
    settingsError.value =
      error instanceof Error ? error.message : "保存平台配置时发生未知错误。"
  }
}

function handleResetSettings() {
  resetBrowserPlatformConfigDraft()
  refreshPlatformConfigState({ reloadDraft: true })
  settingsError.value = ""
  settingsFeedback.value = "本地覆盖已清空，当前已回退到环境变量和默认检索参数。"
}

onMounted(async () => {
  storageStatus.value = await ensureLocalStorageReady()
  refreshPlatformConfigState({ reloadDraft: true })
  await initializePlatformHost()
  await refreshBuiltinMods()
  await refreshSaves()
  view.value = lastPlatformView.value
})

onBeforeUnmount(() => {
  unmountFrontend()
})
</script>

<style scoped>
.app-shell {
  width: 100%;
  min-height: 100vh;
  padding: 24px;
}

.panel {
  width: min(1440px, 100%);
  min-width: 0;
  margin: 0 auto;
  padding: 28px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 28px;
  background:
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.12), transparent 24%),
    linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(10, 15, 25, 0.96));
  box-shadow: 0 28px 70px rgba(2, 6, 23, 0.24);
}

.panel-header {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.9fr);
  gap: 18px;
  align-items: start;
}

.panel-copy {
  min-width: 0;
}

.eyebrow,
.section-eyebrow,
.mod-kicker {
  margin: 0 0 12px;
  color: #f59e0b;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

h1,
h2,
h3,
h4 {
  margin: 0;
  font-family: "Iowan Old Style", "Noto Serif SC", "Source Han Serif SC", serif;
}

h1 {
  margin-bottom: 12px;
  font-size: clamp(38px, 4.2vw, 56px);
  line-height: 1.05;
}

h2 {
  font-size: clamp(28px, 3vw, 38px);
  line-height: 1.15;
}

h3 {
  font-size: 24px;
  line-height: 1.3;
}

h4 {
  font-size: 18px;
  line-height: 1.35;
}

.summary,
.section-copy p,
.feature-card__body,
.empty-card p {
  margin: 0;
  color: #c7d3e2;
  font-size: 15px;
  line-height: 1.8;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.status-card,
.feature-card,
.empty-card,
.mod-card,
.save-card {
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 20px;
  background: rgba(8, 15, 26, 0.46);
}

.status-card span,
.save-card__meta,
.settings-note,
.quick-list span,
.mod-meta span,
.feature-metrics span {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.7;
}

.status-card strong {
  display: block;
  margin-top: 8px;
  color: #f8fafc;
  font-size: 14px;
  line-height: 1.6;
}

.platform-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 24px;
}

.nav-button,
.primary-button,
.ghost-button {
  padding: 12px 16px;
  border-radius: 14px;
  font: inherit;
  cursor: pointer;
  transition:
    transform 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.nav-button {
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.72);
  color: #d6e0ec;
}

.nav-button--active {
  border-color: rgba(245, 158, 11, 0.22);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.08)),
    rgba(15, 23, 42, 0.88);
  color: #fff7ea;
}

.nav-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.page-section {
  display: grid;
  gap: 22px;
  margin-top: 26px;
}

.section-copy {
  display: grid;
  gap: 10px;
}

.mod-grid,
.save-list,
.settings-grid {
  display: grid;
  gap: 18px;
}

.mod-grid {
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}

.settings-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mod-card,
.save-card {
  display: grid;
  gap: 14px;
}

.mod-card__head,
.feature-card__head,
.save-card__head,
.section-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 14px;
}

.mod-version,
.save-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.14);
  color: #f8d48d;
  font-size: 12px;
  line-height: 1;
}

.mod-description {
  margin: 0;
  color: #d8e3ef;
  line-height: 1.75;
}

.mod-meta,
.feature-metrics,
.quick-list {
  display: grid;
  gap: 8px;
}

.settings-actions {
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 20px;
  background: rgba(8, 15, 26, 0.38);
}

.settings-message {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
}

.settings-message--ok {
  color: #9fd5b3;
}

.settings-message--error {
  color: #f6b0b0;
}

.mod-actions,
.save-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.primary-button {
  border: 1px solid rgba(245, 158, 11, 0.22);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.08)),
    rgba(15, 23, 42, 0.88);
  color: #fff7ea;
}

.ghost-button {
  border: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(15, 23, 42, 0.72);
  color: #d6e0ec;
}

.primary-button:hover,
.ghost-button:hover,
.nav-button:hover {
  transform: translateY(-1px);
}

.mod-page,
.settings-grid {
  display: grid;
  gap: 22px;
}

.mod-page-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(320px, 0.85fr);
  gap: 18px;
}

.feature-card {
  display: grid;
  gap: 14px;
}

.settings-panel {
  align-content: start;
}

.settings-panel--wide {
  grid-column: 1 / -1;
}

.form-grid,
.number-grid {
  display: grid;
  gap: 12px;
}

.form-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.number-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.field-group {
  display: grid;
  gap: 8px;
}

.field-group span,
.checkbox-field span {
  color: #dbe5f1;
  font-size: 13px;
  line-height: 1.6;
}

.field-input {
  width: 100%;
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.88);
  color: #f8fafc;
  font: inherit;
}

.field-input:focus {
  outline: none;
  border-color: rgba(245, 158, 11, 0.26);
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.08);
}

.toggle-row {
  display: grid;
  gap: 12px;
}

.checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.feature-card--hero {
  background:
    radial-gradient(circle at top right, rgba(245, 158, 11, 0.1), transparent 28%),
    rgba(8, 15, 26, 0.52);
}

.section-head {
  align-items: end;
}

.save-list {
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
}

.save-card {
  cursor: pointer;
}

.save-card--selected {
  border-color: rgba(245, 158, 11, 0.28);
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.12) inset;
}

.frontend-stage {
  width: 100%;
  min-height: 100vh;
}

@media (max-width: 1080px) {
  .panel-header,
  .mod-page-grid {
    grid-template-columns: 1fr;
  }

  .status-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .app-shell {
    padding: 14px;
  }

  .panel {
    padding: 18px;
  }

  .status-grid,
  .mod-grid,
  .save-list,
  .settings-grid {
    grid-template-columns: 1fr;
  }

  .mod-card__head,
  .feature-card__head,
  .save-card__head,
  .section-head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
