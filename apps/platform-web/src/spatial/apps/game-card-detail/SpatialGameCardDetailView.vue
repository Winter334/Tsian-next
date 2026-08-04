<template>
  <section class="spatial-app spatial-detail" data-spatial-source-animation aria-label="应用属性">
    <header class="spatial-app__header">
      <div class="spatial-app__identity">
        <span class="spatial-app__eyebrow">GAME CARD · {{ frontendStatusLabel }}</span>
        <h1>{{ cardTitle || "应用属性" }}</h1>
      </div>
      <div class="spatial-app__commands">
        <div class="spatial-app__segments" role="tablist" aria-label="应用属性栏目">
          <button class="spatial-app__segment" type="button" role="tab" :aria-selected="activeTab === 'overview'" :aria-pressed="activeTab === 'overview'" @click="activeTab = 'overview'">概览</button>
          <button class="spatial-app__segment" type="button" role="tab" :aria-selected="activeTab === 'frontend'" :aria-pressed="activeTab === 'frontend'" @click="activeTab = 'frontend'">前端</button>
        </div>
        <SpatialActionButton :disabled="!card || exporting" @click="exportCard">
          <template #icon><Download /></template>{{ exporting ? "导出中…" : "导出卡包" }}
        </SpatialActionButton>
      </div>
    </header>

    <main class="spatial-app__scroll spatial-detail__scroll">
      <div v-if="loading" class="spatial-app__empty" role="status">正在加载游戏卡属性…</div>
      <div v-else-if="errorMessage" class="spatial-app__banner spatial-app__banner--error" role="alert">{{ errorMessage }}</div>
      <template v-else-if="card">
        <div class="spatial-transition-stack">
          <div v-if="activeTab === 'overview'" key="overview" class="spatial-detail__overview" role="tabpanel">
          <section class="spatial-app__section spatial-detail__identity-card">
            <div class="spatial-detail__cover">
              <SpatialImage :source="coverSource" :alt="card.manifest.cover?.alt || ''" :icon="Gamepad2" fallback-label="封面不可用" />
              <div class="spatial-detail__summary">
                <span class="spatial-app__eyebrow">{{ card.source }} · {{ coverSourceLabel || "无封面" }}</span>
                <h2>{{ cardTitle }}</h2>
                <p>{{ cardDescription }}</p>
                <dl>
                  <div><dt>作者</dt><dd>{{ cardAuthor }}</dd></div>
                  <div><dt>版本</dt><dd>{{ card.manifest.version }}</dd></div>
                  <div><dt>状态</dt><dd>{{ isLoadedCard ? "已加载" : "未加载" }}</dd></div>
                </dl>
                <div class="spatial-app__actions">
                  <SpatialActionButton :disabled="isLoadedCard || loadingCard" @click="loadCurrentCard">
                    <template #icon><CheckCircle2 /></template>{{ isLoadedCard ? "已加载" : loadingCard ? "加载中…" : "加载游戏卡" }}
                  </SpatialActionButton>
                </div>
              </div>
            </div>
          </section>

          <section class="spatial-app__section spatial-detail__form">
            <div class="spatial-detail__section-heading">
              <div><h2>卡片属性</h2><p>名称、简介、作者、版本与封面会一起保存。</p></div>
              <span class="spatial-app__meta">{{ hasUnsavedChanges ? "有未保存改动" : "已同步" }}</span>
            </div>

            <div class="spatial-detail__cover-controls">
              <SpatialActionButton :disabled="propertiesSaving || card.source === 'builtin'" @click="openCoverPicker">
                <template #icon><ImageUp /></template>上传封面
              </SpatialActionButton>
              <label class="spatial-app__field spatial-detail__cover-url">
                <span>封面 URL</span>
                <span class="spatial-detail__inline-field">
                  <input v-model="coverUrlDraft" type="url" :disabled="propertiesSaving || card.source === 'builtin'" placeholder="https://example.com/cover.png" />
                  <SpatialActionButton :disabled="propertiesSaving || !coverUrlDraft.trim() || card.source === 'builtin'" @click="applyCoverUrlDraft">应用</SpatialActionButton>
                </span>
              </label>
              <SpatialActionButton variant="danger" :disabled="propertiesSaving || card.source === 'builtin'" @click="applyCoverClearDraft">清除封面</SpatialActionButton>
              <input ref="coverInput" class="spatial-detail__file" type="file" accept="image/*" @change="handleCoverSelected" />
            </div>
            <p v-if="coverError" class="spatial-app__banner spatial-app__banner--error">{{ coverError }}</p>

            <label class="spatial-app__field"><span>名称</span><input v-model="metadataName" type="text" :disabled="propertiesSaving || card.source === 'builtin'" /></label>
            <label class="spatial-app__field"><span>简介</span><textarea v-model="metadataIntro" rows="4" :disabled="propertiesSaving || card.source === 'builtin'" /></label>
            <div class="spatial-detail__field-row">
              <label class="spatial-app__field"><span>作者</span><input v-model="metadataAuthor" type="text" :disabled="propertiesSaving || card.source === 'builtin'" placeholder="留空则不显示" /></label>
              <label class="spatial-app__field"><span>版本</span><input v-model="metadataVersion" type="text" :disabled="propertiesSaving || card.source === 'builtin'" placeholder="0.1.0" /></label>
            </div>
            <div class="spatial-app__actions">
              <SpatialActionButton variant="primary" :disabled="!hasUnsavedChanges || propertiesSaving || card.source === 'builtin'" @click="saveProperties">
                <template #icon><Save /></template>{{ propertiesSaving ? "保存中…" : "保存属性" }}
              </SpatialActionButton>
              <SpatialActionButton variant="danger" :disabled="propertiesSaving || card.source === 'builtin'" @click="deleteCurrentCard">
                <template #icon><Trash2 /></template>删除应用
              </SpatialActionButton>
            </div>
          </section>
            </div>

          <div v-else key="frontend" class="spatial-detail__frontend" role="tabpanel">
          <section class="spatial-app__section spatial-detail__frontend-editor">
            <div class="spatial-detail__section-heading">
              <div><h2>前端绑定</h2><p>当前：{{ frontendStatusLabel }}</p></div>
              <SpatialActionButton variant="primary" :disabled="!canApplyFrontendDraft" @click="applyFrontendBindingDraft">
                <template #icon><Save /></template>{{ frontendApplyLabel }}
              </SpatialActionButton>
            </div>
            <div class="spatial-detail__mode-grid" role="group" aria-label="前端类型">
              <SpatialActionButton v-for="mode in frontendModes" :key="mode.id" class="spatial-detail__mode" :disabled="frontendSaving || frontendPackageSaving || card.source === 'builtin'" :aria-pressed="frontendMode === mode.id" @click="setFrontendMode(mode.id)">
                <template #icon><component :is="mode.icon" /></template><strong>{{ mode.label }}</strong><span>{{ mode.help }}</span>
              </SpatialActionButton>
            </div>
            <label v-if="frontendMode === 'remote'" class="spatial-app__field">
              <span>远程 URL</span>
              <input v-model="remoteUrl" type="url" :disabled="frontendSaving || frontendPackageSaving || card.source === 'builtin'" placeholder="https://example.com/tsian-game/" @keyup.enter="applyFrontendBindingDraft" />
            </label>
            <div v-if="frontendMode === 'packaged'" class="spatial-detail__package-controls">
              <div><strong>前端包</strong><span class="spatial-app__meta">{{ packageDraftLabel || "尚未选择" }}</span></div>
              <div class="spatial-app__actions">
                <SpatialActionButton :disabled="frontendPackageSaving || frontendSaving || card.source === 'builtin'" @click="openFrontendPackagePicker">
                  <template #icon><Upload /></template>选择前端包
                </SpatialActionButton>
                <SpatialActionButton :disabled="frontendPackageSaving || frontendSaving || frontendFiles.length === 0" @click="exportFrontendPackage">
                  <template #icon><Download /></template>导出前端包
                </SpatialActionButton>
              </div>
              <input ref="frontendPackageInput" class="spatial-detail__file" type="file" accept=".tsian-frontend.zip,application/zip" @change="handleFrontendPackageSelected" />
            </div>
          </section>

          <section class="spatial-app__section spatial-detail__files">
            <div class="spatial-detail__section-heading"><h2>Packaged 文件</h2><span class="spatial-app__meta">{{ frontendFiles.length }} 个</span></div>
            <div v-if="frontendFiles.length === 0" class="spatial-app__empty">暂无文件</div>
            <ul v-else>
              <li v-for="file in frontendFiles" :key="file.path">
                <span><strong>{{ file.path }}</strong><small>{{ inferMediaTypeFromPath(file.path) }}</small></span>
                <span class="spatial-app__meta">{{ formatGameCardFileSize(file.size) }}</span>
              </li>
            </ul>
          </section>
          </div>
        </div>
      </template>
      <p v-if="feedback" class="spatial-app__banner" role="status">{{ feedback }}</p>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue"
import { useRouter } from "vue-router"
import {
  CheckCircle2,
  Download,
  Gamepad2,
  ImageUp,
  Link2,
  PackageOpen,
  Save,
  Trash2,
  Upload,
  XCircle,
} from "lucide-vue-next"
import {
  formatGameCardFileSize,
  useGameCardDetailController,
  type GameCardFrontendMode,
} from "@/controllers/game-cards/use-game-card-detail-controller"
import { inferMediaTypeFromPath } from "@/lib/media-type"
import SpatialImage from "../media/SpatialImage.vue"
import { spatialImageInputForGameCard, type SpatialImageInput } from "../media/spatial-image"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"

const props = defineProps<{ cardId: string }>()
const router = useRouter()
const activeTab = ref<"overview" | "frontend">("overview")
const coverInput = ref<HTMLInputElement | null>(null)
const frontendPackageInput = ref<HTMLInputElement | null>(null)

const frontendModes: readonly { id: GameCardFrontendMode; label: string; help: string; icon: Component }[] = [
  { id: "none", label: "未配置", help: "内容模板", icon: XCircle },
  { id: "remote", label: "Remote URL", help: "外部 iframe", icon: Link2 },
  { id: "packaged", label: "Packaged", help: "卡内文件", icon: PackageOpen },
]

const {
  card,
  frontendFiles,
  frontendMode,
  remoteUrl,
  metadataName,
  metadataIntro,
  metadataAuthor,
  metadataVersion,
  coverUrlDraft,
  coverError,
  coverDraft,
  loading,
  exporting,
  frontendSaving,
  frontendPackageSaving,
  propertiesSaving,
  loadingCard,
  errorMessage,
  feedback,
  cardTitle,
  cardDescription,
  cardAuthor,
  coverSourceLabel,
  frontendStatusLabel,
  isLoadedCard,
  canApplyFrontendDraft,
  frontendApplyLabel,
  packageDraftLabel,
  hasUnsavedChanges,
  setFrontendMode,
  stageCoverUpload,
  applyCoverUrlDraft,
  applyCoverClearDraft,
  saveProperties,
  deleteCurrentCard,
  exportCard,
  applyFrontendBindingDraft,
  stageFrontendPackage,
  exportFrontendPackage,
  loadCurrentCard,
} = useGameCardDetailController({
  cardId: () => props.cardId,
  onDeleted: () => void router.push("/library"),
})

const coverSource = computed<SpatialImageInput>(() => {
  const draft = coverDraft.value
  if (draft.kind === "upload") return { kind: "url", url: draft.previewUrl }
  if (draft.kind === "url") return { kind: "url", url: draft.url }
  if (draft.kind === "clear") return { kind: "none" }
  return spatialImageInputForGameCard(card.value)
})

function openCoverPicker(): void {
  coverError.value = ""
  coverInput.value?.click()
}

function handleCoverSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (file) stageCoverUpload(file)
}

function openFrontendPackagePicker(): void {
  feedback.value = ""
  frontendPackageInput.value?.click()
}

function handleFrontendPackageSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (file) stageFrontendPackage(file)
}

watch(() => props.cardId, () => {
  activeTab.value = "overview"
})
</script>

<style scoped>
.spatial-detail {
  grid-template-rows: auto minmax(0, 1fr);
}

.spatial-detail__scroll {
  padding: 14px;
}

.spatial-detail__overview,
.spatial-detail__frontend {
  display: grid;
  min-width: 0;
  align-items: start;
  gap: 12px;
}

.spatial-detail__overview {
  grid-template-columns: minmax(360px, 1.08fr) minmax(340px, 1fr);
}

.spatial-detail__identity-card {
  display: block;
}

.spatial-detail__cover {
  position: relative;
  aspect-ratio: 1 / 1;
  min-height: 220px;
  overflow: hidden;
  border: 1px solid var(--spatial-app-border);
}

.spatial-detail__summary {
  position: absolute;
  z-index: 1;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "eyebrow eyebrow"
    "title stats"
    "description action";
  max-height: 100%;
  padding: 10px 12px;
  align-items: end;
  column-gap: 12px;
  row-gap: 5px;
  box-sizing: border-box;
  color: var(--spatial-window-frame);
  background: color-mix(in srgb, var(--spatial-window-tab) 90%, transparent);
}

.spatial-detail__summary h2,
.spatial-detail__summary p,
.spatial-detail__summary dl {
  margin: 0;
}

.spatial-detail__summary h2 {
  grid-area: title;
  overflow: hidden;
  font-size: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spatial-detail__summary p {
  grid-area: description;
  display: -webkit-box;
  overflow: hidden;
  color: color-mix(in srgb, var(--spatial-window-frame) 80%, transparent);
  font-size: 11px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.spatial-detail__summary .spatial-app__eyebrow,
.spatial-detail__summary dt {
  color: color-mix(in srgb, var(--spatial-window-frame) 68%, transparent);
}

.spatial-detail__summary .spatial-app__eyebrow {
  grid-area: eyebrow;
}

.spatial-detail__summary dl {
  grid-area: stats;
  display: grid;
  width: 170px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.spatial-detail__summary .spatial-app__actions {
  grid-area: action;
  justify-self: end;
}

.spatial-detail__summary dt,
.spatial-detail__summary dd {
  margin: 0;
}

.spatial-detail__summary dt {
  font-family: "JetBrains Mono", monospace;
  font-size: 8px;
}

.spatial-detail__summary dd {
  overflow: hidden;
  color: var(--spatial-window-frame);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spatial-detail__form,
.spatial-detail__frontend-editor,
.spatial-detail__files {
  display: grid;
  align-content: start;
  gap: 12px;
}

.spatial-detail__section-heading,
.spatial-detail__package-controls {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.spatial-detail__section-heading p {
  margin: 4px 0 0;
  color: var(--spatial-app-muted);
  font-size: 10px;
}

.spatial-detail__cover-controls {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px;
}

.spatial-detail__cover-url {
  min-width: 210px;
  flex: 1;
}

.spatial-detail__inline-field {
  display: flex;
  min-width: 0;
  gap: 6px;
}

.spatial-detail__inline-field input {
  flex: 1;
}

.spatial-detail__field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(120px, 0.45fr);
  gap: 10px;
}

.spatial-detail__frontend {
  grid-template-columns: minmax(300px, 1fr) minmax(230px, 0.65fr);
}

.spatial-detail__mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.spatial-detail__mode {
  display: grid;
  min-width: 0;
  min-height: 72px;
  padding: 10px;
  align-items: start;
  grid-template-columns: 14px minmax(0, 1fr);
  gap: 8px;
  border: 1px solid var(--spatial-app-border);
  color: var(--spatial-app-muted);
  background: var(--spatial-app-surface);
  text-align: left;
}

.spatial-detail__mode[aria-pressed="true"] {
  border-color: var(--spatial-window-tab);
  color: var(--spatial-window-ink);
  background: var(--spatial-app-surface-strong);
}

.spatial-detail__mode :deep(.spatial-action-button__icon) {
  margin-top: 1px;
  color: var(--spatial-window-accent);
}

.spatial-detail__mode :deep(.spatial-action-button__label) {
  display: grid;
  gap: 4px;
}

.spatial-detail__mode strong {
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
}

.spatial-detail__mode span {
  font-size: 9px;
}

.spatial-detail__package-controls > div:first-child {
  display: grid;
  gap: 4px;
  font-size: 10px;
}

.spatial-detail__files ul {
  display: grid;
  max-height: 410px;
  margin: 0;
  padding: 0;
  overflow: auto;
  border: 1px solid var(--spatial-app-border);
  list-style: none;
}

.spatial-detail__files li {
  display: flex;
  min-width: 0;
  padding: 8px 9px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid var(--spatial-app-border);
}

.spatial-detail__files li:last-child {
  border-bottom: 0;
}

.spatial-detail__files li > span:first-child {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.spatial-detail__files strong,
.spatial-detail__files small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spatial-detail__files strong {
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
}

.spatial-detail__files small {
  color: var(--spatial-app-muted);
  font-size: 8px;
}

.spatial-detail__file {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

@container (max-width: 760px) {
  .spatial-detail__overview,
  .spatial-detail__frontend {
    grid-template-columns: minmax(0, 1fr);
  }

  .spatial-app__header {
    align-items: flex-start;
    flex-direction: column;
  }
}

@container (max-width: 480px) {
  .spatial-detail__mode-grid,
  .spatial-detail__field-row {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
