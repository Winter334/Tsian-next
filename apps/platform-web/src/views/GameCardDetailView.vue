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
                :disabled="isLoadedCard"
                @click="loadCurrentCard"
              >
                <CheckCircle2 class="h-3.5 w-3.5" aria-hidden="true" />
                {{ isLoadedCard ? '已加载' : '加载游戏卡' }}
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
                        :disabled="card.source === 'builtin'"
                        @click="openCoverPicker"
                      >
                        <ImageUp class="h-3.5 w-3.5" aria-hidden="true" />
                        {{ coverUrl ? '更换封面' : '上传封面' }}
                      </button>
                      <button
                        v-if="coverUrl"
                        type="button"
                        class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs text-danger"
                        :disabled="card.source === 'builtin'"
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
                          class="retro-focus h-8 min-w-0 flex-1 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                          placeholder="https://example.com/cover.png"
                        />
                        <button
                          type="button"
                          class="retro-button retro-focus inline-flex h-8 shrink-0 items-center gap-2 px-3 font-mono text-xs"
                          :disabled="!coverUrlDraft.trim() || card.source === 'builtin'"
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
                  class="retro-focus h-8 min-w-0 border border-neon-deep/55 bg-panel px-2 font-mono text-xs text-text-main"
                />
              </label>

              <label class="grid gap-1">
                <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">简介</span>
                <textarea
                  v-model="metadataIntro"
                  rows="3"
                  class="retro-focus min-h-20 resize-y border border-neon-deep/55 bg-panel px-2 py-2 text-xs leading-5 text-text-main"
                />
              </label>

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
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="font-mono text-xs uppercase tracking-wider text-neon">
                前端绑定
              </p>
              <p class="mt-1 text-sm leading-6 text-text-dim">
                {{ frontendStatusDescription }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="border border-neon-deep/50 bg-elevated px-2 py-1 font-mono text-[11px] text-text-dim">
                {{ frontendStatusLabel }}
              </span>
            </div>
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
                  :class="frontendMode === 'none' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="frontendMode = 'none'"
                >
                  <XCircle class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">未配置</span>
                  <span class="text-xs leading-5">保留为内容模板。</span>
                </button>
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :class="frontendMode === 'remote' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="frontendMode = 'remote'"
                >
                  <Link2 class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">Remote URL</span>
                  <span class="text-xs leading-5">通过 iframe 加载。</span>
                </button>
                <button
                  type="button"
                  class="retro-focus flex min-h-20 flex-col items-start gap-2 border p-3 text-left"
                  :class="frontendMode === 'packaged' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/40 bg-panel/55 text-text-dim hover:text-text-main'"
                  @click="frontendMode = 'packaged'"
                >
                  <PackageOpen class="h-4 w-4" aria-hidden="true" />
                  <span class="font-mono text-xs">Packaged</span>
                  <span class="text-xs leading-5">使用卡包内文件。</span>
                </button>
              </div>

              <label v-if="frontendMode === 'remote'" class="grid gap-2">
                <span class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">远程 URL</span>
                <input
                  v-model="remoteUrl"
                  type="url"
                  class="retro-focus h-9 border border-neon-deep/55 bg-panel px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                  placeholder="https://example.com/tsian-game/"
                  @keyup.enter="saveFrontendBinding"
                />
              </label>

              <div v-if="frontendMode === 'remote'" class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
                  :disabled="frontendSaving || !remoteUrl.trim() || card?.source === 'builtin'"
                  @click="saveFrontendBinding"
                >
                  <Save class="h-3.5 w-3.5" aria-hidden="true" />
                  保存前端绑定
                </button>
                <button
                  v-if="card?.manifest.frontend"
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs text-danger"
                  :disabled="frontendSaving || card?.source === 'builtin'"
                  @click="clearFrontendBinding"
                >
                  <XCircle class="h-3.5 w-3.5" aria-hidden="true" />
                  清除前端绑定
                </button>
              </div>

              <div v-if="frontendMode === 'packaged'" class="grid gap-3 border border-neon-deep/30 bg-panel/40 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-mono text-[10px] uppercase tracking-wider text-neon-muted">前端包</span>
                  <span v-if="packagedEntryDisplay" class="font-mono text-[10px] text-text-dim">入口 {{ packagedEntryDisplay }}</span>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
                    :disabled="frontendPackageSaving || card?.source === 'builtin'"
                    @click="openFrontendPackagePicker"
                  >
                    <Upload class="h-3.5 w-3.5" aria-hidden="true" />
                    上传前端包
                  </button>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs"
                    :disabled="frontendPackageSaving || frontendFiles.length === 0"
                    @click="handleExportFrontendPackage"
                  >
                    <Download class="h-3.5 w-3.5" aria-hidden="true" />
                    导出前端包
                  </button>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-9 items-center gap-2 px-3 font-mono text-xs text-danger"
                    :disabled="frontendPackageSaving || frontendFiles.length === 0 || card?.source === 'builtin'"
                    @click="handleClearFrontendPackage"
                  >
                    <XCircle class="h-3.5 w-3.5" aria-hidden="true" />
                    清除前端包
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
                当前游戏卡没有打包前端文件，上传一个 .tsian-frontend.zip 即可开始。
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
import type { GameCardFrontendBinding } from "@tsian/contracts"
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRouter } from "vue-router"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import { clearBeforeClose, setBeforeClose } from "@/composables/useDesktopWindows"
import {
  ACTIVE_CARD_CHANGED_EVENT,
  isActiveCardChangedEvent,
} from "@/lib/platform-events"
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
import type { LocalGameCardRecord } from "@/storage/db"
import {
  getFrontendStatusDescription,
  getFrontendStatusLabel,
  getGameCardAuthor,
  getGameCardCoverUrl,
  getGameCardDescription,
  getGameCardTitle,
} from "@/lib/game-card-display"
import { inferMediaTypeFromPath } from "@/lib/media-type"
import {
  deletePlatformGameCard,
  exportPlatformGameCardFrontendPackage,
  exportPlatformGameCardPackage,
  getPlatformActiveGameCardId,
  getPlatformGameCard,
  importPlatformGameCardFrontendPackage,
  importPlatformGameCardPackage,
  listPlatformGameCardFrontendFiles,
  setPlatformActiveGameCard,
  setPlatformGameCardCover,
  updatePlatformGameCardMetadata,
  updatePlatformGameCardFrontend,
  type PlatformGameCardFrontendFileSummary,
} from "../platform-host"
import { detailWindowIdFor } from "../desktop-apps"

type TabId = "overview" | "frontend"
type FrontendMode = "none" | "remote" | "packaged"

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
const card = ref<LocalGameCardRecord | null>(null)
const activeGameCardId = ref("")
const frontendFiles = ref<PlatformGameCardFrontendFileSummary[]>([])
const frontendMode = ref<FrontendMode>("none")
const remoteUrl = ref("")
const packagedEntry = ref("")
const metadataName = ref("")
const metadataIntro = ref("")
const coverUrlDraft = ref("")
const coverInput = ref<HTMLInputElement | null>(null)
const coverError = ref("")
const loading = ref(false)
const exporting = ref(false)
const frontendSaving = ref(false)
const frontendPackageInput = ref<HTMLInputElement | null>(null)
const frontendPackageSaving = ref(false)
const propertiesSaving = ref(false)
const errorMessage = ref("")
const feedback = ref("")

type CoverDraft =
  | { kind: "none" }
  | { kind: "upload"; file: File; previewUrl: string }
  | { kind: "url"; url: string }
  | { kind: "clear" }

const coverDraft = ref<CoverDraft>({ kind: "none" })

const cardTitle = computed(() => getGameCardTitle(card.value))
const cardDescription = computed(() => getGameCardDescription(card.value))
const cardAuthor = computed(() => getGameCardAuthor(card.value))
const coverUrl = computed(() => {
  const draft = coverDraft.value
  if (draft.kind === "upload") return draft.previewUrl
  if (draft.kind === "url") return draft.url
  if (draft.kind === "clear") return ""
  return getGameCardCoverUrl(card.value)
})
const coverSourceLabel = computed(() => {
  const draft = coverDraft.value
  if (draft.kind === "upload") return "预览"
  if (draft.kind === "url") return "URL*"
  if (draft.kind === "clear") return "已移除*"
  const cover = card.value?.manifest.cover
  if (!cover) return ""
  if (cover.url?.trim()) return "URL"
  if (cover.workspacePath?.trim()) return "本地"
  return ""
})
const frontendStatusLabel = computed(() => getFrontendStatusLabel(card.value))
const frontendStatusDescription = computed(() => getFrontendStatusDescription(card.value))
const packagedEntryDisplay = computed(() => {
  const frontend = card.value?.manifest.frontend
  if (frontend?.kind === "packaged") {
    return frontend.entry
  }
  return ""
})
const isLoadedCard = computed(() => Boolean(card.value && activeGameCardId.value === card.value.id))

const hasUnsavedChanges = computed(() => {
  if (!card.value) return false
  if (metadataName.value.trim() !== card.value.manifest.name) return true
  if (metadataIntro.value.trim() !== card.value.manifest.summary) return true
  if (coverDraft.value.kind !== "none") return true
  return false
})

function syncFrontendDraft(loadedCard: LocalGameCardRecord) {
  const frontend = loadedCard.manifest.frontend
  if (!frontend) {
    frontendMode.value = "none"
    remoteUrl.value = ""
    packagedEntry.value = frontendFiles.value.find((file) => file.path.endsWith(".html"))?.path
      ?? frontendFiles.value[0]?.path
      ?? ""
    return
  }

  if (frontend.kind === "remote") {
    frontendMode.value = "remote"
    remoteUrl.value = frontend.url
    return
  }

  frontendMode.value = "packaged"
  packagedEntry.value = frontend.entry
}

function syncMetadataDraft(loadedCard: LocalGameCardRecord) {
  metadataName.value = loadedCard.manifest.name
  metadataIntro.value = loadedCard.manifest.summary
  coverUrlDraft.value = loadedCard.manifest.cover?.url ?? ""
  resetCoverDraft()
}

/** Replace the current cover draft, revoking any pending upload preview URL. */
function setCoverDraft(next: CoverDraft) {
  if (coverDraft.value.kind === "upload") {
    URL.revokeObjectURL(coverDraft.value.previewUrl)
  }
  coverDraft.value = next
}

function resetCoverDraft() {
  setCoverDraft({ kind: "none" })
}

function openCoverPicker() {
  coverError.value = ""
  coverInput.value?.click()
}

async function handleCoverSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file || !card.value) {
    return
  }
  if (card.value.source === "builtin") {
    coverError.value = "内置游戏卡不能直接修改封面，请先另存为本地副本。"
    return
  }
  coverError.value = ""
  setCoverDraft({ kind: "upload", file, previewUrl: URL.createObjectURL(file) })
}

async function applyCoverUrlDraft() {
  const url = coverUrlDraft.value.trim()
  if (!url || !card.value) {
    return
  }
  if (card.value.source === "builtin") {
    coverError.value = "内置游戏卡不能直接修改封面，请先另存为本地副本。"
    return
  }
  coverError.value = ""
  setCoverDraft({ kind: "url", url })
}

async function applyCoverClearDraft() {
  if (!card.value) {
    return
  }
  if (card.value.source === "builtin") {
    coverError.value = "内置游戏卡不能直接修改封面，请先另存为本地副本。"
    return
  }
  coverError.value = ""
  setCoverDraft({ kind: "clear" })
}

async function refreshData() {
  loading.value = true
  errorMessage.value = ""

  try {
    const [loadedCard, loadedActiveGameCardId, loadedFrontendFiles] = await Promise.all([
      getPlatformGameCard(props.cardId),
      getPlatformActiveGameCardId(),
      listPlatformGameCardFrontendFiles(props.cardId),
    ])

    if (!loadedCard) {
      throw new Error(`未找到游戏卡「${props.cardId}」。`)
    }

    card.value = loadedCard
    activeGameCardId.value = loadedActiveGameCardId
    frontendFiles.value = loadedFrontendFiles
    syncFrontendDraft(loadedCard)
    syncMetadataDraft(loadedCard)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法加载游戏卡详情。"
  } finally {
    loading.value = false
  }
}

async function saveProperties() {
  if (!card.value) {
    return
  }

  propertiesSaving.value = true
  feedback.value = ""
  try {
    const trimmedName = metadataName.value.trim()
    const trimmedIntro = metadataIntro.value.trim()
    if (!trimmedName || !trimmedIntro) {
      throw new Error("名称和简介不能为空。")
    }

    await updatePlatformGameCardMetadata(card.value.id, {
      name: trimmedName,
      summary: trimmedIntro,
    })

    const draft = coverDraft.value
    if (draft.kind === "upload") {
      const updated = await setPlatformGameCardCover(card.value.id, { kind: "upload", file: draft.file })
      card.value = updated
    } else if (draft.kind === "url") {
      const updated = await setPlatformGameCardCover(card.value.id, { kind: "url", url: draft.url })
      card.value = updated
    } else if (draft.kind === "clear") {
      const updated = await setPlatformGameCardCover(card.value.id, { kind: "clear" })
      card.value = updated
    }

    resetCoverDraft()
    toast.success("已保存属性")
    feedback.value = "已保存属性。"
    await refreshData()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "保存属性失败。"
  } finally {
    propertiesSaving.value = false
  }
}

async function deleteCurrentCard() {
  if (!card.value || card.value.source === "builtin") {
    return
  }

  const confirmed = await confirm({
    message: `删除应用「${cardTitle.value}」？\n\n这会同时删除所有关联存档，无法撤销。`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }

  propertiesSaving.value = true
  feedback.value = ""
  try {
    await deletePlatformGameCard(card.value.id)
    toast.success(`已删除应用：${cardTitle.value}`)
    router.push("/library")
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "删除应用失败。"
  } finally {
    propertiesSaving.value = false
  }
}

function packageFilename(): string {
  const name = cardTitle.value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "game-card"
  return `${name}.tsian-card.zip`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function exportCard() {
  if (!card.value) {
    return
  }

  exporting.value = true
  feedback.value = ""
  try {
    const blob = await exportPlatformGameCardPackage(card.value.id)
    downloadBlob(blob, packageFilename())
    feedback.value = `已导出卡包：${packageFilename()}`
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "导出游戏卡包失败。"
  } finally {
    exporting.value = false
  }
}

function frontendBindingDraft(): GameCardFrontendBinding | undefined {
  if (frontendMode.value === "none") {
    return undefined
  }

  if (frontendMode.value === "remote") {
    return {
      kind: "remote",
      url: remoteUrl.value,
      bridgeVersion: "tsian.play-bridge.v1",
    }
  }

  return {
    kind: "packaged",
    entry: packagedEntry.value,
    bridgeVersion: "tsian.play-bridge.v1",
  }
}

async function saveFrontendBinding() {
  if (!card.value) {
    return
  }

  frontendSaving.value = true
  feedback.value = ""
  try {
    const updated = await updatePlatformGameCardFrontend(card.value.id, frontendBindingDraft())
    feedback.value = updated.manifest.frontend
      ? "已保存前端绑定。"
      : "已清除前端绑定。"
    await refreshData()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "保存前端绑定失败。"
  } finally {
    frontendSaving.value = false
  }
}

async function clearFrontendBinding() {
  if (!card.value?.manifest.frontend) {
    return
  }
  const confirmed = await confirm({
    message: "清除这张游戏卡的前端绑定？这会移除全部打包前端文件，游戏卡内容和存档保留。",
    severity: "danger",
    confirmText: "清除",
  })
  if (!confirmed) {
    return
  }

  frontendMode.value = "none"
  await saveFrontendBinding()
}

function openFrontendPackagePicker() {
  feedback.value = ""
  frontendPackageInput.value?.click()
}

async function handleFrontendPackageSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file || !card.value) {
    return
  }
  if (card.value.source === "builtin") {
    feedback.value = "内置游戏卡不能直接替换前端，请先另存为本地副本。"
    return
  }

  frontendPackageSaving.value = true
  feedback.value = ""
  try {
    await importPlatformGameCardFrontendPackage(card.value.id, file)
    frontendMode.value = "packaged"
    feedback.value = "已上传并替换前端包。"
    await refreshData()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "上传前端包失败。"
  } finally {
    frontendPackageSaving.value = false
  }
}

async function handleExportFrontendPackage() {
  if (!card.value || frontendFiles.value.length === 0) {
    return
  }
  frontendPackageSaving.value = true
  feedback.value = ""
  try {
    const blob = await exportPlatformGameCardFrontendPackage(card.value.id)
    const filename = `${card.value.manifest.id}.tsian-frontend.zip`
    downloadBlob(blob, filename)
    feedback.value = `已导出前端包：${filename}`
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "导出前端包失败。"
  } finally {
    frontendPackageSaving.value = false
  }
}

async function handleClearFrontendPackage() {
  if (!card.value || frontendFiles.value.length === 0) {
    return
  }
  if (card.value.source === "builtin") {
    feedback.value = "内置游戏卡不能直接替换前端，请先另存为本地副本。"
    return
  }
  const confirmed = await confirm({
    message: "清除这张游戏卡的打包前端包？这会移除全部打包前端文件和入口绑定。",
    severity: "danger",
    confirmText: "清除",
  })
  if (!confirmed) {
    return
  }

  frontendPackageSaving.value = true
  feedback.value = ""
  try {
    await updatePlatformGameCardFrontend(card.value.id, null)
    frontendMode.value = "none"
    feedback.value = "已清除前端包。"
    await refreshData()
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "清除前端包失败。"
  } finally {
    frontendPackageSaving.value = false
  }
}

async function loadCurrentCard() {
  if (!card.value || isLoadedCard.value) {
    return
  }

  const loaded = await setPlatformActiveGameCard(card.value.id)
  activeGameCardId.value = loaded.id
  feedback.value = `已加载游戏卡：${loaded.manifest.name}`
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
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

watch(() => props.cardId, () => {
  activeTab.value = "overview"
  resetCoverDraft()
  void refreshData()
})

let registeredWindowId = ""

onMounted(() => {
  registeredWindowId = detailWindowIdFor(props.cardId)
  setBeforeClose(registeredWindowId, onBeforeClose)
  window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  void refreshData()
})

onBeforeUnmount(() => {
  clearBeforeClose(registeredWindowId)
  registeredWindowId = ""
  window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  resetCoverDraft()
})

function onActiveCardChanged(event: Event) {
  if (!isActiveCardChangedEvent(event)) {
    return
  }
  void refreshData()
}

async function onBeforeClose(): Promise<boolean> {
  if (!hasUnsavedChanges.value) {
    return true
  }
  return confirm({
    message: "有未保存的改动，放弃并关闭？",
    severity: "danger",
    confirmText: "放弃",
  })
}
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
