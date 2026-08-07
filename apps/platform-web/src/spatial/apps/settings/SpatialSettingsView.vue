<template>
  <section class="spatial-app spatial-settings" data-spatial-source-animation aria-label="控制面板">
    <header class="spatial-app__header">
      <div class="spatial-app__identity">
        <span class="spatial-app__eyebrow">平台控制</span>
        <h1>控制面板</h1>
      </div>
      <span class="spatial-app__status">
        {{ settings.savingProviderDraft.value ? "保存中" : "自动保存 · 800 毫秒" }}
      </span>
    </header>

    <div class="spatial-settings__body">
      <nav class="spatial-settings__rail" aria-label="设置分区">
        <button
          v-for="item in sections"
          :key="item.id"
          type="button"
          :aria-pressed="section === item.id"
          @click="section = item.id"
        >
          <component :is="item.icon" aria-hidden="true" />
          <span>{{ item.label }}</span>
        </button>
      </nav>

      <main class="spatial-app__scroll spatial-settings__content">
        <SpatialProviderSettings
          v-show="section === 'providers'"
          :settings="settings"
        />

        <section v-if="section === 'semantic'" class="spatial-app__section">
          <div class="spatial-settings__heading">
            <div><span class="spatial-app__eyebrow">向量检索</span><h2>语义检索</h2></div>
            <SpatialActionButton variant="primary" @click="saveSemantic">保存</SpatialActionButton>
          </div>
          <label class="spatial-settings__switch">
            <input v-model="settings.platformConfigDraft.value.embeddingConfig.enabled" type="checkbox">
            启用向量嵌入
          </label>
          <div class="spatial-settings__form-grid">
            <label class="spatial-app__field"><span>向量接口地址</span><input v-model="settings.platformConfigDraft.value.embeddingConfig.baseUrl"></label>
            <label class="spatial-app__field"><span>API 密钥</span><input v-model="settings.platformConfigDraft.value.embeddingConfig.apiKey" type="password" autocomplete="off"></label>
            <label class="spatial-app__field"><span>模型</span><input v-model="settings.platformConfigDraft.value.embeddingConfig.model"></label>
            <label class="spatial-app__field"><span>向量维度</span><input v-model.number="settings.platformConfigDraft.value.embeddingConfig.dimensions" type="number" min="0"></label>
            <label class="spatial-app__field"><span>默认返回数</span><input v-model.number="settings.platformConfig.value.rag.defaultLimit" type="number" min="1"></label>
            <label class="spatial-app__field"><span>最大返回数</span><input v-model.number="settings.platformConfig.value.rag.maxLimit" type="number" min="1"></label>
          </div>
        </section>

        <section v-if="section === 'backup'" class="spatial-app__section">
          <div class="spatial-settings__heading">
            <div><span class="spatial-app__eyebrow">云端存档</span><h2>云备份</h2></div>
            <SpatialActionButton variant="primary" @click="saveBackup">保存</SpatialActionButton>
          </div>
          <label class="spatial-settings__switch">
            <input v-model="backup.form.value.autoBackupEnabled" type="checkbox">
            自动创建云端备份
          </label>
          <p class="spatial-settings__hint">
            {{ backup.loggedIn.value ? `已用 ${backup.usageLabel.value} / ${backup.quotaLabel.value}` : "登录后可查看和管理云端备份。" }}
          </p>
          <div class="spatial-app__actions">
            <SpatialActionButton :disabled="backup.loading.value || !backup.loggedIn.value" @click="backup.refresh">
              {{ backup.loading.value ? "刷新中…" : "刷新列表" }}
            </SpatialActionButton>
          </div>
          <p v-if="backup.errorMessage.value" class="spatial-app__banner spatial-app__banner--error" role="alert">
            {{ backup.errorMessage.value }}
          </p>
          <p v-else-if="backup.loggedIn.value && !backup.loading.value && !backup.backups.value.length" class="spatial-settings__hint">
            暂无云端备份。
          </p>
          <ul v-else class="spatial-settings__backup-list">
            <li v-for="item in backup.backups.value" :key="item.id">
              <div>
                <strong>{{ item.name }}</strong>
                <small>{{ item.cardId }} · {{ formatCloudBackupBytes(item.sizeBytes) }} · {{ formatDateTime(Date.parse(item.updatedAt)) }}</small>
              </div>
              <SpatialActionButton variant="danger" :disabled="backup.loading.value" @click="backup.requestDelete(item)">删除</SpatialActionButton>
            </li>
          </ul>
        </section>

        <section v-if="section === 'runtime'" class="spatial-app__section">
          <div class="spatial-settings__heading">
            <div><span class="spatial-app__eyebrow">平台行为</span><h2>运行参数</h2></div>
            <SpatialActionButton variant="primary" @click="saveRuntime">保存</SpatialActionButton>
          </div>
          <div class="spatial-settings__form-grid">
            <label class="spatial-app__field"><span>保留最近检查点</span><input v-model.number="settings.platformConfig.value.checkpointPrune.keepRecent" type="number" min="1"></label>
            <label class="spatial-app__field"><span>稀疏保留间隔</span><input v-model.number="settings.platformConfig.value.checkpointPrune.sparseEvery" type="number" min="1"></label>
            <SpatialRangeSlider
              :model-value="settings.platformConfig.value.contextCompression.narrativeTriggerRatio"
              label="剧情上下文压缩阈值（默认 0.85）"
              tip="阈值越高，越晚把较早剧情整理成摘要；越低，越早整理。"
              :min="0.05"
              :max="1"
              :step="0.05"
              @update:model-value="updateRuntimeRatio('narrativeTriggerRatio', $event)"
            />
            <SpatialRangeSlider
              :model-value="settings.platformConfig.value.contextCompression.taskTriggerRatio"
              label="助手上下文压缩阈值（默认 0.45）"
              tip="阈值越高，越晚整理助手对话；越低，越早为后续回复释放上下文空间。"
              :min="0.05"
              :max="1"
              :step="0.05"
              @update:model-value="updateRuntimeRatio('taskTriggerRatio', $event)"
            />
            <label class="spatial-app__field"><span>保留剧情轮数</span><input v-model.number="settings.platformConfig.value.contextCompression.keepRecentTurns" type="number" min="1"></label>
            <label class="spatial-app__field"><span>保留助手轮数</span><input v-model.number="settings.platformConfig.value.contextCompression.taskKeepRecentRounds" type="number" min="1"></label>
            <label class="spatial-app__field"><span>AI 回复超时（毫秒）</span><input v-model.number="settings.platformConfig.value.ai.chatTimeoutMs" type="number" min="1000"></label>
            <label class="spatial-app__field"><span>助手最大消息数</span><input v-model.number="settings.platformConfig.value.assistant.maxStoredMessages" type="number" min="1"></label>
          </div>
        </section>

        <section v-if="section === 'appearance'" class="spatial-app__section">
          <div class="spatial-settings__heading">
            <div><span class="spatial-app__eyebrow">运行环境</span><h2>桌面外观</h2></div>
          </div>
          <p class="spatial-settings__hint">
            {{ SPATIAL_ENVIRONMENT_GUIDANCE }}
          </p>
          <p class="spatial-settings__hint">
            切换会先完整保存配置、保留当前页面，然后重新加载；窗口会话不会迁移。
          </p>
          <div class="spatial-settings__appearance">
            <article>
              <strong>RetroOS</strong><span>稳定的平面多窗口桌面</span>
              <SpatialActionButton
                :aria-pressed="settings.platformConfig.value.appearance.uiMode === 'retro'"
                @click="settings.switchAppearance('retro')"
              >{{ settings.platformConfig.value.appearance.uiMode === "retro" ? "当前模式" : "切换并重新加载" }}</SpatialActionButton>
            </article>
            <article>
              <strong>Spatial Desktop</strong><span>空间多窗口桌面</span>
              <SpatialActionButton
                :disabled="!settings.appearanceSelectable.value"
                :aria-pressed="settings.platformConfig.value.appearance.uiMode === 'spatial'"
                variant="primary"
                @click="settings.switchAppearance('spatial')"
              >{{ settings.platformConfig.value.appearance.uiMode === "spatial" ? "当前模式" : "切换并重新加载" }}</SpatialActionButton>
            </article>
          </div>
        </section>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { Cloud, Cpu, Database, Palette, Settings2 } from "lucide-vue-next"
import { SPATIAL_ENVIRONMENT_GUIDANCE } from "@/config/platform-ui-mode"
import { formatCloudBackupBytes, useCloudBackupController } from "@/controllers/settings/use-cloud-backup-controller"
import { useSettingsController } from "@/controllers/settings/use-settings-controller"
import { formatDateTime } from "@/lib/game-card-display"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialRangeSlider from "../primitives/SpatialRangeSlider.vue"
import SpatialProviderSettings from "./SpatialProviderSettings.vue"
import "../spatial-apps.css"

type Section = "providers" | "semantic" | "backup" | "runtime" | "appearance"

const sections = [
  { id: "providers", label: "AI 提供商", icon: Settings2 },
  { id: "semantic", label: "语义检索", icon: Database },
  { id: "backup", label: "云备份", icon: Cloud },
  { id: "runtime", label: "运行参数", icon: Cpu },
  { id: "appearance", label: "桌面外观", icon: Palette },
] as const

const section = ref<Section>("providers")
const settings = useSettingsController()
const backup = useCloudBackupController()

type ContextCompressionRatioKey = "narrativeTriggerRatio" | "taskTriggerRatio"

function updateRuntimeRatio(key: ContextCompressionRatioKey, value: number | null): void {
  settings.platformConfig.value.contextCompression[key] = value ?? 0.05
}

async function saveSemantic(): Promise<void> {
  await settings.saveEmbeddingConfig(
    settings.platformConfigDraft.value.embeddingConfig,
    settings.platformConfig.value.rag,
  )
}

async function saveBackup(): Promise<void> {
  await settings.saveCloudBackupConfig(backup.form.value)
}

async function saveRuntime(): Promise<void> {
  await settings.saveTunables({
    checkpointPrune: settings.platformConfig.value.checkpointPrune,
    contextCompression: settings.platformConfig.value.contextCompression,
    ai: settings.platformConfig.value.ai,
    assistant: settings.platformConfig.value.assistant,
  })
}
</script>

<style scoped>
.spatial-settings { grid-template-rows: auto minmax(0, 1fr); }
.spatial-settings__body { display: grid; min-height: 0; grid-template-columns: 154px minmax(0, 1fr); }
.spatial-settings__rail { display: grid; align-content: start; gap: 3px; border-right: 1px solid var(--spatial-app-border); padding: 8px; background: var(--spatial-app-surface-muted); }
.spatial-settings__rail button { display: grid; grid-template-columns: 15px minmax(0, 1fr); align-items: center; gap: 7px; border: 1px solid transparent; padding: 8px; text-align: left; font-size: 11px; background: transparent; }
.spatial-settings__rail button[aria-pressed="true"] { border-color: var(--spatial-app-border-strong); background: var(--spatial-app-surface-strong); }
.spatial-settings__rail svg { width: 14px; }
.spatial-settings__content { padding: 14px; }
.spatial-settings__heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.spatial-settings__heading h2 { margin: 3px 0; font-size: 17px; }
.spatial-settings__hint { margin: 8px 0; color: var(--spatial-app-muted); font-size: 11px; }
.spatial-settings__form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.spatial-settings__switch { display: flex; align-items: center; gap: 7px; font-size: 12px; }
.spatial-settings__backup-list { display: grid; gap: 6px; margin-top: 10px; }
.spatial-settings__backup-list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px; background: var(--spatial-app-surface-muted); }
.spatial-settings__backup-list strong,.spatial-settings__backup-list small { display: block; }.spatial-settings__backup-list small { color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-settings__appearance { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.spatial-settings__appearance article { display: grid; gap: 7px; border: 1px solid var(--spatial-app-border); padding: 10px; }.spatial-settings__appearance span { color: var(--spatial-app-muted); font-size: 10px; }
@container (max-width: 620px) { .spatial-settings__body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }.spatial-settings__rail { grid-template-columns: repeat(5, minmax(0, 1fr)); border-right: 0; border-bottom: 1px solid var(--spatial-app-border); }.spatial-settings__rail button { grid-template-columns: 1fr; justify-items: center; text-align: center; font-size: 9px; }.spatial-settings__form-grid,.spatial-settings__appearance { grid-template-columns: 1fr; } }
</style>
