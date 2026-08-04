<template>
  <section class="grid min-h-full grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden">
      <nav class="retro-toolbar flex gap-1 overflow-x-auto border-b px-3 pt-2" aria-label="游戏卡栏目">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="retro-focus inline-flex h-9 shrink-0 items-center gap-2 border border-b-0 px-3 font-mono text-xs"
          :class="activeTab === tab.id
            ? 'border-neon-deep bg-void text-neon'
            : 'border-neon-deep/45 bg-elevated text-text-dim hover:text-text-main'"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="h-3.5 w-3.5" aria-hidden="true" />
          {{ tab.label }}
        </button>
        <button
          type="button"
          class="retro-button retro-focus ml-auto inline-flex h-8 shrink-0 items-center gap-2 px-3 font-mono text-xs"
          :disabled="!card || exporting"
          @click="exportCard"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          导出卡包
        </button>
      </nav>

      <div v-if="loading" class="retro-inset m-3 grid min-h-[480px] place-items-center p-4">
          <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
          正在加载游戏卡属性
        </p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset m-3 grid min-h-[480px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">
            游戏卡不可用
          </p>
          <p class="mt-2 text-sm leading-6 text-text-dim">
            {{ errorMessage }}
          </p>
        </div>
      </div>

      <div v-else-if="card" class="m-3 overflow-auto">
        <div v-if="activeTab === 'overview'" class="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section class="poster-pane retro-inset relative min-h-[560px] overflow-hidden">
            <img
              v-if="coverUrl"
              :src="coverUrl"
              :alt="card.manifest.cover?.alt || ''"
              class="absolute inset-0 h-full w-full object-cover"
            />
            <div v-else class="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(243,197,109,0.22),transparent_28%),linear-gradient(135deg,#3f4d3a,#1e2420)]">
              <Gamepad2 class="h-20 w-20 text-neon-muted" aria-hidden="true" />
            </div>
            <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/86 to-transparent p-5 md:p-7">
              <div class="max-w-3xl">
                <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
                  {{ frontendStatusLabel }}
                </p>
                <h1 class="mt-2 text-3xl font-black leading-tight text-text-main md:text-5xl">
                  {{ cardTitle }}
                </h1>
                <p class="mt-4 max-w-2xl text-sm leading-7 text-text-main md:text-base">
                  {{ cardDescription }}
                </p>
                <dl class="mt-5 grid gap-3 text-sm text-text-dim sm:grid-cols-2">
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">作者</dt>
                    <dd class="mt-1 truncate text-text-main">{{ cardAuthor }}</dd>
                  </div>
                  <div>
                    <dt class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">来源</dt>
                    <dd class="mt-1 truncate text-text-main">{{ card.source }}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section class="retro-inset grid content-start gap-4 p-4">
            <div class="grid gap-3 border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">
                    游戏卡加载
                  </p>
                  <p class="mt-1 text-xs leading-5 text-text-dim">
                    {{ isLoadedCard ? '桌面应用正在使用这张游戏卡。' : '加载后，开始游戏、工作室和后续助手会使用这张游戏卡。' }}
                  </p>
                </div>
                <span
                  class="border px-2 py-1 font-mono text-[10px] uppercase"
                  :class="isLoadedCard ? 'border-neon text-neon' : 'border-neon-deep/50 text-text-dim'"
                >
                  {{ isLoadedCard ? 'loaded' : 'not loaded' }}
                </span>
              </div>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-9 w-fit items-center gap-2 px-3 font-mono text-xs"
                :disabled="isLoadedCard || loadingCard"
                @click="loadCurrentCard"
              >
                <CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
                {{ isLoadedCard ? '已加载' : loadingCard ? '加载中…' : '加载游戏卡' }}
              </button>
            </div>

            <div class="grid gap-3 border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">
                    卡片属性
                  </p>
                  <p class="mt-1 text-xs leading-5 text-text-dim">
                    {{ card.source === 'builtin' ? '内置卡需要先另存为本地副本再分发。' : '这里只保留玩家需要看到的应用信息。' }}
                  </p>
                </div>
                <span class="border border-neon-deep/50 bg-panel px-2 py-1 font-mono text-[10px] uppercase text-text-dim">
                  {{ card.source }}
                </span>
              </div>

              <div class="grid gap-2 border border-neon-deep/30 bg-panel/40 p-3">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">封面</span>
                  <span v-if="coverUrl" class="font-mono text-[10px] text-text-dim">{{ coverSourceLabel }}</span>
                </div>
                <div class="flex flex-wrap items-start gap-3">
                  <div class="relative h-24 w-24 shrink-0 overflow-hidden border border-neon-deep/55 bg-elevated">
                    <img
                      v-if="coverUrl"
                      :src="coverUrl"
                      :alt="card.manifest.cover?.alt || ''"
                      class="h-full w-full object-cover"
                    />
                    <div v-else class="grid h-full place-items-center bg-[radial-gradient(circle_at_30%_20%,rgba(243,197,109,0.22),transparent_28%),linear-gradient(135deg,#3f4d3a,#1e2420)]">
                      <Gamepad2 class="h-8 w-8 text-neon-muted" aria-hidden="true" />
                    </div>
                  </div>
                  <div class="grid min-w-0 content-start gap-2">
                    <div class="flex flex-wrap gap-2">
                      <button
                        type="button"
                        class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                        :disabled="propertiesSaving || card.source === 'builtin'"
                        @click="openCoverPicker"
                      >
                        <ImageUp class="h-3.5 w-3.5" aria-hidden="true" />
                        {{ coverUrl ? '更换封面' : '上传封面' }}
                      </button>
                      <button
                        v-if="coverUrl"
                        type="button"
                        class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs text-danger"
                        :disabled="propertiesSaving || card.source === 'builtin'"
                        @click="applyCoverClearDraft"
                      >
                        <XCircle class="h-3.5 w-3.5" aria-hidden="true" />
                        移除
                      </button>
                    </div>
                    <label class="grid gap-1">
                      <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">或粘贴图片 URL</span>
                      <div class="flex gap-2">
                        <input
                          v-model="coverUrlDraft"
                          type="url"
                          :disabled="propertiesSaving || card.source === 'builtin'"
                          class="retro-focus h-8 min-w-0 flex-1 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                          placeholder="https://example.com/cover.png"
                        />
                        <button
                          type="button"
                          class="retro-button retro-focus inline-flex h-8 shrink-0 items-center gap-2 px-3 font-mono text-xs"
                          :disabled="propertiesSaving || !coverUrlDraft.trim() || card.source === 'builtin'"
                          @click="applyCoverUrlDraft"
                        >
                          <Link2 class="h-3.5 w-3.5" aria-hidden="true" />
                          应用
                        </button>
                      </div>
                    </label>
                    <input
                      ref="coverInput"
                      type="file"
                      accept="image/*"
                      class="hidden"
                      @change="handleCoverSelected"
                    />
                  </div>
                </div>
                <p v-if="coverError" class="text-xs leading-5 text-danger">{{ coverError }}</p>
              </div>

              <label class="grid gap-1">
                <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">名称</span>
                <input
                  v-model="metadataName"
                  type="text"
                  :disabled="propertiesSaving || card.source === 'builtin'"
                  class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main"
                />
              </label>

              <label class="grid gap-1">
                <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">简介</span>
                <textarea
                  v-model="metadataIntro"
                  rows="3"
                  :disabled="propertiesSaving || card.source === 'builtin'"
                  class="retro-focus min-h-20 resize-y border border-neon-deep/55 bg-panel px-2 py-2 text-xs leading-5 text-text-main"
                />
              </label>

              <div class="flex flex-wrap gap-3">
                <label class="grid min-w-[160px] flex-1 gap-1">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">作者</span>
                  <input
                    v-model="metadataAuthor"
                    type="text"
                    :disabled="propertiesSaving || card.source === 'builtin'"
                    class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                    placeholder="留空则不显示"
                  />
                </label>
                <label class="grid w-32 shrink-0 gap-1">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">版本</span>
                  <input
                    v-model="metadataVersion"
                    type="text"
                    :disabled="propertiesSaving || card.source === 'builtin'"
                    class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                    placeholder="0.1.0"
                  />
                </label>
              </div>

              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                  :disabled="!hasUnsavedChanges || propertiesSaving || card.source === 'builtin'"
                  @click="saveProperties"
                >
                  <Save class="h-3.5 w-3.5" aria-hidden="true" />
                  保存属性
                </button>
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs text-danger"
                  :disabled="propertiesSaving || card.source === 'builtin'"
                  @click="deleteCurrentCard"
                >
                  <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
                  删除应用
                </button>
              </div>
            </div>
          </section>
        </div>

        <div v-else-if="activeTab === 'frontend'" class="retro-inset grid gap-4 p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-mono text-xs uppercase tracking-wider text-neon">
                前端绑定
              </p>
              <p class="mt-1 font-mono text-[11px] text-text-dim">
                当前：{{ frontendStatusLabel }}
              </p>
            </div>
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
              :disabled="!canApplyFrontendDraft"
              @click="applyFrontendBindingDraft"
            >
              <Save class="h-3.5 w-3.5" aria-hidden="true" />
              {{ frontendApplyLabel }}
            </button>
          </div>

          <p v-if="feedback" class="border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
            {{ feedback }}
          </p>

          <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.65fr)]">
            <section class="grid content-start gap-4 border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="grid gap-2 sm:grid-cols-3" role="group" aria-label="前端类型">
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :disabled="frontendSaving || frontendPackageSaving || card.source === 'builtin'"
                  :class="frontendMode === 'none' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="setFrontendMode('none')"
                >
                  <XCircle class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">未配置</span>
                  <span class="text-xs leading-5">内容模板</span>
                </button>
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :disabled="frontendSaving || frontendPackageSaving || card.source === 'builtin'"
                  :class="frontendMode === 'remote' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="setFrontendMode('remote')"
                >
                  <Link2 class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">Remote URL</span>
                  <span class="text-xs leading-5">iframe</span>
                </button>
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :disabled="frontendSaving || frontendPackageSaving || card.source === 'builtin'"
                  :class="frontendMode === 'packaged' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="setFrontendMode('packaged')"
                >
                  <PackageOpen class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">Packaged</span>
                  <span class="text-xs leading-5">卡内文件</span>
                </button>
              </div>

              <label v-if="frontendMode === 'remote'" class="grid gap-2">
                <span class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">远程 URL</span>
                <input
                  v-model="remoteUrl"
                  type="url"
                  :disabled="frontendSaving || frontendPackageSaving || card.source === 'builtin'"
                  class="retro-focus h-9 border border-neon-deep/55 bg-panel px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                  placeholder="https://example.com/tsian-game/"
                  @keyup.enter="applyFrontendBindingDraft"
                />
              </label>

              <div v-if="frontendMode === 'packaged'" class="grid gap-3 border border-neon-deep/30 bg-panel/40 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">前端包</span>
                  <span v-if="packageDraftLabel" class="font-mono text-[10px] text-text-dim">{{ packageDraftLabel }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
                    :disabled="frontendPackageSaving || frontendSaving || card?.source === 'builtin'"
                    @click="openFrontendPackagePicker"
                  >
                    <Upload class="h-3.5 w-3.5" aria-hidden="true" />
                    选择前端包
                  </button>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
                    :disabled="frontendPackageSaving || frontendSaving || frontendFiles.length === 0"
                    @click="handleExportFrontendPackage"
                  >
                    <Download class="h-3.5 w-3.5" aria-hidden="true" />
                    导出前端包
                  </button>
                </div>
                <input
                  ref="frontendPackageInput"
                  type="file"
                  accept=".tsian-frontend.zip,application/zip"
                  class="hidden"
                  @change="handleFrontendPackageSelected"
                />
              </div>
            </section>

            <section class="grid content-start gap-3 border border-neon-deep/35 bg-elevated/35 p-3">
              <div class="flex items-center justify-between gap-2">
                <p class="font-mono text-xs uppercase tracking-wider text-neon">
                  Packaged 文件
                </p>
                <span class="font-mono text-[11px] text-text-dim">{{ frontendFiles.length }} 个</span>
              </div>
              <div v-if="frontendFiles.length === 0" class="border border-neon-deep/35 bg-panel/55 p-3 text-sm leading-6 text-text-dim">
                暂无文件
              </div>
              <div v-else class="max-h-[340px] overflow-auto border border-neon-deep/35 bg-panel/55">
                <div
                  v-for="file in frontendFiles"
                  :key="file.path"
                  class="grid w-full grid-cols-[1fr_auto] gap-3 border-b border-neon-deep/20 px-3 py-2 text-left last:border-b-0"
                >
                  <span class="min-w-0">
                    <span class="block truncate font-mono text-xs text-text-main">{{ file.path }}</span>
                    <span class="mt-1 block truncate font-mono text-[11px] text-text-dim">{{ inferMediaTypeFromPath(file.path) }}</span>
                  </span>
                  <span class="font-mono text-[11px] text-text-dim">{{ formatBytes(file.size) }}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
  </section>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import { useRouter } from "vue-router"
import {
  CheckCircle2,
  Disc3,
  Download,
  Gamepad2,
  ImageUp,
  Link2,
  MonitorCog,
  PackageOpen,
  Save,
  Trash2,
  Upload,
  XCircle,
} from "lucide-vue-next"
import type { Component } from "vue"
import {
  formatGameCardFileSize,
  useGameCardDetailController,
  type GameCardFrontendMode,
} from "@/controllers/game-cards/use-game-card-detail-controller"
import { inferMediaTypeFromPath } from "@/lib/media-type"

type TabId = "overview" | "frontend"

interface TabItem {
  id: TabId
  label: string
  icon: Component
}

const props = defineProps<{
  cardId: string
}>()

const router = useRouter()
const tabs: TabItem[] = [
  { id: "overview", label: "概览", icon: Disc3 },
  { id: "frontend", label: "前端", icon: MonitorCog },
]

const activeTab = ref<TabId>("overview")
const coverInput = ref<HTMLInputElement | null>(null)
const frontendPackageInput = ref<HTMLInputElement | null>(null)
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
  coverUrl,
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

const formatBytes = formatGameCardFileSize

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

async function handleExportFrontendPackage(): Promise<void> {
  await exportFrontendPackage()
}

watch(() => props.cardId, () => {
  activeTab.value = "overview"
})
</script>

<style scoped>
.poster-pane {
  box-shadow:
    inset 1px 1px 0 rgba(0, 0, 0, 0.72),
    inset -1px -1px 0 rgba(246, 236, 215, 0.1);
}

.slot-row {
  box-shadow:
    inset 1px 1px 0 rgba(246, 236, 215, 0.1),
    inset -1px -1px 0 rgba(0, 0, 0, 0.55);
}
</style>
