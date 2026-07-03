<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <!-- Toolbar -->
    <div class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="screen.kind !== 'list'"
          type="button"
          class="retro-focus grid h-7 w-7 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          title="返回"
          @click="goBack"
        >
          <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="importing"
          @click="openPackagePicker"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          本地安装
        </button>
        <input
          ref="packageInput"
          type="file"
          class="hidden"
          accept=".tsian-card.zip,application/zip"
          @change="handlePackageSelected"
        />
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="openUploadScreen"
        >
          <Upload class="h-3.5 w-3.5" aria-hidden="true" />
          上传应用
        </button>
      </div>
      <div class="flex items-center gap-2">
        <select
          v-model="sortMode"
          class="retro-select-surface min-w-[100px] border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
          @change="refresh"
        >
          <option value="newest">最新</option>
          <option value="downloads">下载量</option>
        </select>
        <label class="flex min-w-[220px] items-center gap-2 border border-neon-deep/45 bg-elevated px-2 py-1">
          <Search class="h-3.5 w-3.5 text-neon-muted" aria-hidden="true" />
          <input
            v-model="searchQuery"
            type="search"
            placeholder="搜索市场"
            class="min-w-0 flex-1 bg-transparent font-mono text-xs text-text-main placeholder:text-text-dim/60"
            @input="onSearchInput"
          />
        </label>
      </div>
    </div>

    <main class="m-3 grid min-h-0 gap-3 overflow-auto lg:grid-cols-[220px_minmax(0,1fr)]">
      <!-- Category sidebar (placeholder, not active in MVP) -->
      <aside class="retro-inset grid content-start gap-1 p-2">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          class="retro-focus flex h-8 items-center justify-between border px-2 font-mono text-xs"
          :class="category === '全部游戏卡'
            ? 'border-neon bg-neon/10 text-neon'
            : 'border-transparent text-text-dim hover:border-neon-deep/40 hover:text-text-main'"
        >
          <span>{{ category }}</span>
          <span>{{ category === '全部游戏卡' ? packages.length : 0 }}</span>
        </button>
      </aside>

      <!-- Content area — state machine -->
      <section class="retro-inset min-h-0 overflow-auto p-3">
        <!-- LIST state -->
        <div v-if="screen.kind === 'list'" class="grid gap-3">
          <div v-if="loading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">加载中…</p>
          </div>
          <div v-else-if="packages.length === 0" class="grid place-items-center py-12">
            <Store class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">
              {{ searchQuery ? "没有匹配的卡包。" : "市场还没有卡包，成为第一个上传者吧。" }}
            </p>
          </div>
          <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <button
              v-for="pkg in packages"
              :key="pkg.id"
              type="button"
              class="retro-focus selection-tile grid gap-2 border p-3 text-left"
              @click="openDetail(pkg.id)"
            >
              <div class="flex gap-3">
                <div class="grid h-16 w-16 shrink-0 place-items-center overflow-hidden border border-neon-deep/30 bg-panel">
                  <img
                    v-if="pkg.coverUrl"
                    :src="pkg.coverUrl"
                    :alt="pkg.name"
                    class="h-full w-full object-cover"
                  />
                  <span v-else class="text-lg font-bold text-neon">{{ pkg.name.charAt(0).toUpperCase() }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <h3 class="truncate text-sm font-bold text-text-main">{{ pkg.name }}</h3>
                  <p class="mt-0.5 line-clamp-2 text-xs text-text-dim">{{ pkg.summary }}</p>
                </div>
              </div>
              <div class="flex items-center justify-between border-t border-neon-deep/20 pt-2 font-mono text-[10px] text-text-dim">
                <span class="truncate">{{ pkg.cardAuthor || "未知作者" }}</span>
                <span class="flex items-center gap-1">
                  <Download class="h-3 w-3" aria-hidden="true" />
                  {{ pkg.downloadCount }}
                </span>
              </div>
            </button>
          </div>
        </div>

        <!-- DETAIL state -->
        <div v-else-if="screen.kind === 'detail'" class="grid gap-4">
          <div v-if="detailLoading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">加载中…</p>
          </div>
          <div v-else-if="!detailPackage" class="grid place-items-center py-12">
            <p class="text-sm text-text-dim">卡包不存在或已被删除。</p>
          </div>
          <div v-else class="grid gap-4">
            <div class="flex gap-4">
              <div class="grid h-24 w-24 shrink-0 place-items-center overflow-hidden border border-neon-deep/30 bg-panel">
                <img
                  v-if="detailPackage.coverUrl"
                  :src="detailPackage.coverUrl"
                  :alt="detailPackage.name"
                  class="h-full w-full object-cover"
                />
                <span v-else class="text-2xl font-bold text-neon">{{ detailPackage.name.charAt(0).toUpperCase() }}</span>
              </div>
              <div class="min-w-0 flex-1">
                <h2 class="text-lg font-bold text-text-main">{{ detailPackage.name }}</h2>
                <p class="mt-1 text-sm text-text-dim">{{ detailPackage.summary }}</p>
                <div class="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11px] text-text-dim">
                  <span class="flex items-center gap-1">
                    <PenLine class="h-3.5 w-3.5" aria-hidden="true" />
                    {{ detailPackage.cardAuthor || "未知作者" }}
                  </span>
                  <span v-if="detailPackage.cardVersion" class="flex items-center gap-1">
                    <Tag class="h-3.5 w-3.5" aria-hidden="true" />
                    v{{ detailPackage.cardVersion }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Download class="h-3.5 w-3.5" aria-hidden="true" />
                    {{ detailPackage.downloadCount }} 次下载
                  </span>
                  <span>{{ formatDate(detailPackage.createdAt) }}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-4 font-mono text-xs"
              :disabled="installing"
              @click="handleDownloadInstall(detailPackage)"
            >
              <Download class="h-3.5 w-3.5" aria-hidden="true" />
              {{ installing ? "安装中…" : "下载并安装" }}
            </button>
          </div>
        </div>

        <!-- UPLOAD state -->
        <div v-else-if="screen.kind === 'upload'" class="grid gap-4">
          <div v-if="!loggedIn" class="grid place-items-center py-12">
            <UserRound class="h-10 w-10 text-neon-muted" aria-hidden="true" />
            <p class="mt-3 text-sm text-text-dim">上传应用需要先登录。</p>
            <button
              type="button"
              class="retro-button retro-focus mt-4 inline-flex h-9 items-center gap-2 px-4 font-mono text-xs"
              @click="openAccountCenter"
            >
              <UserRound class="h-3.5 w-3.5" aria-hidden="true" />
              打开账号中心
            </button>
          </div>
          <div v-else-if="localCardsLoading" class="grid place-items-center py-12">
            <p class="font-mono text-xs text-text-dim">读取本地卡包…</p>
          </div>
          <div v-else-if="localCards.length === 0" class="grid place-items-center py-12">
            <p class="text-sm text-text-dim">本地没有可上传的游戏卡。</p>
          </div>
          <div v-else class="grid gap-3">
            <p class="font-mono text-xs text-text-dim">选择要上传的本地卡包：</p>
            <button
              v-for="card in localCards"
              :key="card.id"
              type="button"
              class="retro-focus selection-tile grid gap-2 border p-3 text-left"
              :class="{ 'selection-tile--active': selectedCardId === card.id }"
              @click="selectCardForUpload(card.id)"
            >
              <div class="flex gap-3">
                <div class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden border border-neon-deep/30 bg-panel">
                  <img
                    v-if="getGameCardCoverUrl(card)"
                    :src="getGameCardCoverUrl(card) ?? ''"
                    :alt="card.manifest.name || ''"
                    class="h-full w-full object-cover"
                  />
                  <span v-else class="text-sm font-bold text-neon">{{ (card.manifest.name || "?").charAt(0).toUpperCase() }}</span>
                </div>
                <div class="min-w-0 flex-1">
                  <h3 class="truncate text-sm font-bold text-text-main">{{ card.manifest.name || "未命名" }}</h3>
                  <p class="mt-0.5 line-clamp-1 text-xs text-text-dim">{{ card.manifest.summary || "暂无简介" }}</p>
                  <p class="mt-0.5 font-mono text-[10px] text-text-dim">v{{ card.manifest.version }}</p>
                </div>
              </div>
            </button>
            <div v-if="selectedCardId" class="grid gap-3 border-t border-neon-deep/20 pt-3">
              <label class="grid gap-1">
                <span class="font-mono text-[10px] text-text-dim">标题（可选，默认用卡包名）</span>
                <input
                  v-model="uploadTitle"
                  type="text"
                  class="retro-select-surface border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
                  placeholder="卡包标题"
                />
              </label>
              <label class="grid gap-1">
                <span class="font-mono text-[10px] text-text-dim">简介（可选，默认用卡包简介）</span>
                <textarea
                  v-model="uploadSummary"
                  rows="2"
                  class="retro-select-surface border border-neon-deep/45 bg-elevated px-2 py-1 font-mono text-xs text-text-main"
                  placeholder="卡包简介"
                />
              </label>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-4 font-mono text-xs"
                :disabled="uploading"
                @click="handleUpload"
              >
                <Upload class="h-3.5 w-3.5" aria-hidden="true" />
                {{ uploading ? "上传中…" : "确认上传" }}
              </button>
            </div>
          </div>
        </div>

        <!-- Feedback / error -->
        <p v-if="feedback" class="mt-4 border border-neon-deep/40 bg-neon/10 px-3 py-2 text-sm text-neon">
          {{ feedback }}
        </p>
        <p v-if="errorMessage" class="mt-4 border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {{ errorMessage }}
        </p>
      </section>
    </main>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue"
import { useRouter } from "vue-router"
import { ArrowLeft, Download, PenLine, Search, Store, Tag, Upload, UserRound } from "lucide-vue-next"
import type { MarketPackage } from "@tsian/contracts"
import type { LocalGameCardView } from "@/storage/game-cards"
import { toast } from "@/composables/useToast"
import { confirmChoice } from "@/composables/useConfirm"
import { getGameCardCoverUrl, getGameCardTitle } from "@/lib/game-card-display"
import { marketApi } from "@/platform-host/api-client"
import {
  exportPlatformGameCardPackage,
  importPlatformGameCardPackage,
  listPlatformGameCards,
} from "../platform-host"
import { useAuth } from "@/composables/useAuth"
import { desktopWindowForLauncher } from "@/desktop-apps"
import { useDesktopWindows } from "@/composables/useDesktopWindows"

type Screen =
  | { kind: "list" }
  | { kind: "detail"; id: string }
  | { kind: "upload" }

const router = useRouter()
const { loggedIn } = useAuth()
const desktop = useDesktopWindows()

const categories = ["全部游戏卡", "已安装", "可游玩", "模板", "工具"]
const packageInput = ref<HTMLInputElement | null>(null)

const screen = ref<Screen>({ kind: "list" })
const packages = ref<MarketPackage[]>([])
const loading = ref(false)
const searchQuery = ref("")
const sortMode = ref<"newest" | "downloads">("newest")
let searchTimer: ReturnType<typeof setTimeout> | null = null

const detailPackage = ref<MarketPackage | null>(null)
const detailLoading = ref(false)

const localCards = ref<LocalGameCardView[]>([])
const localCardsLoading = ref(false)
const selectedCardId = ref("")
const uploadTitle = ref("")
const uploadSummary = ref("")

const importing = ref(false)
const installing = ref(false)
const uploading = ref(false)
const feedback = ref("")
const errorMessage = ref("")

onMounted(() => {
  refresh()
})

async function refresh(): Promise<void> {
  loading.value = true
  errorMessage.value = ""
  try {
    packages.value = await marketApi.list({
      q: searchQuery.value || undefined,
      sort: sortMode.value,
    })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载市场列表失败。"
  } finally {
    loading.value = false
  }
}

function onSearchInput(): void {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
  searchTimer = setTimeout(() => refresh(), 300)
}

function openDetail(id: string): void {
  screen.value = { kind: "detail", id }
  loadDetail(id)
}

async function loadDetail(id: string): Promise<void> {
  detailLoading.value = true
  detailPackage.value = null
  try {
    detailPackage.value = await marketApi.get(id)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "加载卡包详情失败。"
  } finally {
    detailLoading.value = false
  }
}

function openUploadScreen(): void {
  feedback.value = ""
  errorMessage.value = ""
  screen.value = { kind: "upload" }
  if (loggedIn.value) {
    loadLocalCards()
  }
}

async function loadLocalCards(): Promise<void> {
  localCardsLoading.value = true
  try {
    // Exclude builtin template cards — they are invisible internal templates
    // (see directory-structure / game-cards specs), not user-authored content
    // to share on the market.
    localCards.value = (await listPlatformGameCards()).filter(
      (card) => card.source !== "builtin",
    )
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "读取本地卡包失败。"
  } finally {
    localCardsLoading.value = false
  }
}

function selectCardForUpload(cardId: string): void {
  selectedCardId.value = cardId
  const card = localCards.value.find((c) => c.id === cardId)
  if (card) {
    uploadTitle.value = card.manifest.name || ""
    uploadSummary.value = card.manifest.summary || ""
  }
}

async function handleUpload(): Promise<void> {
  if (!selectedCardId.value) {
    return
  }
  uploading.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const blob = await exportPlatformGameCardPackage(selectedCardId.value)
    const pkg = await marketApi.upload(
      blob,
      uploadTitle.value || undefined,
      uploadSummary.value || undefined,
    )
    toast.success(`已上传：${pkg.name}`)
    screen.value = { kind: "list" }
    selectedCardId.value = ""
    uploadTitle.value = ""
    uploadSummary.value = ""
    await refresh()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "上传应用失败。"
  } finally {
    uploading.value = false
  }
}

async function handleDownloadInstall(pkg: MarketPackage): Promise<void> {
  installing.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    // Check for an existing local card with the same card_id before downloading.
    const localCards = await listPlatformGameCards()
    const existing = localCards.find((c) => c.manifest.id === pkg.cardId)
    if (existing) {
      const choice = await confirmChoice({
        title: "卡包已安装",
        message: `本地已有同名卡包「${existing.manifest.name || pkg.cardId}」。覆盖将替换本地内容，无法撤销。`,
        cancelText: "取消",
        options: [
          { label: "覆盖", value: "overwrite", severity: "danger" },
        ],
      })
      if (choice !== "overwrite") {
        return
      }
    }

    const blob = await marketApi.download(pkg.id)
    const imported = await importPlatformGameCardPackage(blob)
    feedback.value = `已安装：${getGameCardTitle(imported)}`
    toast.success(`已安装：${getGameCardTitle(imported)}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "下载安装失败。"
  } finally {
    installing.value = false
  }
}

function openPackagePicker(): void {
  packageInput.value?.click()
}

async function handlePackageSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ""
  if (!file) {
    return
  }
  importing.value = true
  feedback.value = ""
  errorMessage.value = ""
  try {
    const imported = await importPlatformGameCardPackage(file)
    feedback.value = `已安装：${getGameCardTitle(imported)}`
    toast.success(`已导入：${getGameCardTitle(imported)}`)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "安装游戏卡包失败。"
  } finally {
    importing.value = false
  }
}

function openAccountCenter(): void {
  const input = desktopWindowForLauncher("account")
  if (input) {
    desktop.openWindow(input, { width: 1280, height: 720 })
    void router.push(input.routePath)
  }
}

function goBack(): void {
  screen.value = { kind: "list" }
  detailPackage.value = null
  selectedCardId.value = ""
  uploadTitle.value = ""
  uploadSummary.value = ""
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}
</script>
