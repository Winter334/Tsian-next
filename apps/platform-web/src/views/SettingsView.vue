<template>
  <!-- 设置页：AI 配置与检索参数 -->
  <section class="page-section">
    <div class="section-copy">
      <p class="section-eyebrow">设置</p>
      <h2>平台设置</h2>
      <p>当前阶段先提供最小可写入口：通用聊天 AI、检索 AI、Embedding 和检索参数都可以直接在浏览器本地保存。</p>
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
            <input v-model.number="platformConfigDraft.retrievalSettings.recentMessageLimit" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>候选事件上限</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.maxCandidates" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>预设事件注入上限</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.maxCatalogInjected" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>预设事件分数阈值</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.minCatalogEventScore" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>基础 seed 数量</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.baseSeedEventLimit" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>复杂剧情 seed 数量</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.complexSeedEventLimit" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>复杂实体阈值</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.complexEntityThreshold" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>相邻事件扩展数</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.maxChainNeighborsPerSeed" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>事件注入上限</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.maxInjectedEvents" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>seed 分数阈值</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.minSeedScore" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>桥接实体上限</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.bridgeEntityLimit" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>桥接实体分数阈值</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.minBridgeEntityScore" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>语义事件上限</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.semanticEventLimit" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>语义档案上限</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.semanticArchiveLimit" class="field-input" type="number" min="0" />
          </label>
          <label class="field-group">
            <span>语义相似度阈值</span>
            <input v-model.number="platformConfigDraft.retrievalSettings.semanticScoreThreshold" class="field-input" type="number" min="0" step="0.01" />
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
          <span>内置模组：{{ builtinModCount }}</span>
          <span>本地存档：{{ saveOptionCount }}</span>
          <span>当前激活存档：{{ activeSaveId || "无" }}</span>
          <span>当前 localStorage 覆盖：{{ aiStatus }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { ModStaticContent } from "@tsian/contracts"
import { onMounted, ref } from "vue"
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
} from "../config/ai"
import {
  getPlatformActiveSaveId,
  listPlatformSaves,
  playFrontendBridge,
} from "../platform-host"

const effectiveChatConfig = ref<BrowserAiConfig | null>(null)
const effectiveRetrievalConfig = ref<BrowserAiConfig | null>(null)
const effectiveEmbeddingConfig = ref<BrowserEmbeddingConfig | null>(null)
const effectiveRetrievalSettings = ref<BrowserRetrievalSettings>(getBrowserRetrievalSettings())
const platformConfigDraft = ref<BrowserPlatformConfigDraft>(getBrowserPlatformConfigDraft())
const chatModelSummary = ref("未配置")
const retrievalModelSummary = ref("未配置")
const embeddingModelSummary = ref("未配置")
const retrievalEnhancedSummary = ref("关闭")
const aiStatus = ref("checking...")
const settingsFeedback = ref("")
const settingsError = ref("")
const builtinModCount = ref(0)
const saveOptionCount = ref(0)
const activeSaveId = ref("")

function formatModelSummary(config: { baseUrl: string; model: string } | null): string {
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

async function refreshOverview() {
  const result = await playFrontendBridge.query.query<ModStaticContent>({
    resource: "builtin-mods",
  })
  builtinModCount.value = result.items.length
  const saves = await listPlatformSaves()
  saveOptionCount.value = saves.length
  activeSaveId.value = (await getPlatformActiveSaveId()) ?? ""
}

onMounted(async () => {
  refreshPlatformConfigState({ reloadDraft: true })
  await refreshOverview()
})
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

.section-copy p {
  margin: 0;
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-base);
  line-height: var(--ts-leading-normal);
}

.settings-actions {
  display: grid;
  gap: var(--ts-space-3);
  padding: var(--ts-space-4);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-xl);
  background: var(--ts-color-surface-raised);
  box-shadow: var(--ts-shadow-1);
}

.settings-message {
  margin: 0;
  font-size: var(--ts-text-sm);
  line-height: 1.7;
  padding: var(--ts-space-2) var(--ts-space-3);
  border-radius: var(--ts-radius-md);
}

.settings-message--ok {
  color: var(--ts-color-state-success-fg);
  background: var(--ts-color-state-success-bg);
}

.settings-message--error {
  color: var(--ts-color-state-error-fg);
  background: var(--ts-color-state-error-bg);
}

.mod-actions {
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

.settings-grid {
  display: grid;
  gap: var(--ts-space-4);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.feature-card {
  display: grid;
  gap: var(--ts-space-3);
  padding: var(--ts-space-4);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-xl);
  background: var(--ts-color-surface-raised);
  box-shadow: var(--ts-shadow-2);
}

.feature-card__head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: var(--ts-space-3);
}

.settings-panel {
  align-content: start;
}

.settings-panel--wide {
  grid-column: 1 / -1;
}

.quick-list {
  display: grid;
  gap: var(--ts-space-2);
}

.quick-list span,
.settings-note {
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-sm);
  line-height: 1.7;
}

.form-grid,
.number-grid {
  display: grid;
  gap: var(--ts-space-3);
}

.form-grid {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.number-grid {
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.field-group {
  display: grid;
  gap: var(--ts-space-2);
}

.field-group span,
.checkbox-field span {
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-sm);
  line-height: 1.6;
}

.field-input {
  width: 100%;
  min-width: 0;
  padding: var(--ts-space-3) var(--ts-space-3);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-lg);
  background: var(--ts-color-surface-overlay);
  color: var(--ts-color-text-primary);
  font: inherit;
}

.field-input:focus {
  outline: none;
  border-color: var(--ts-color-accent-default);
  box-shadow: 0 0 0 4px var(--ts-color-accent-subtle);
}

.toggle-row {
  display: grid;
  gap: var(--ts-space-3);
}

.checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: var(--ts-space-2);
}

@media (max-width: 1080px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .feature-card__head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
