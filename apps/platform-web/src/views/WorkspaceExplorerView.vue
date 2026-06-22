<template>
  <section
    ref="explorerRef"
    class="relative grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden"
    @click="contextMenu = null"
    @contextmenu.prevent.stop="openBlankContextMenu"
  >
    <div class="retro-toolbar flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <nav class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="工作区路径">
        <button
          type="button"
          class="retro-focus inline-flex h-7 shrink-0 items-center gap-1.5 border px-2 font-mono text-[11px]"
          :class="!isBrowsing ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/35 bg-elevated/45 text-text-main hover:text-neon'"
          @click.stop="returnToRoot"
        >
          <HardDrive class="h-3.5 w-3.5" aria-hidden="true" />
          游戏卡
        </button>
        <template v-if="selectedCard">
          <ChevronRight class="h-3.5 w-3.5 shrink-0 text-text-dim/70" aria-hidden="true" />
          <button
            type="button"
            class="retro-focus h-7 max-w-[14rem] shrink-0 truncate border px-2 font-mono text-[11px]"
            :class="!currentPath ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/35 bg-elevated/45 text-text-main hover:text-neon'"
            @click.stop="openPath('')"
          >
            {{ selectedCard.title }}
          </button>
          <template
            v-for="crumb in workspaceBreadcrumbs"
            :key="crumb.path"
          >
            <ChevronRight class="h-3.5 w-3.5 shrink-0 text-text-dim/70" aria-hidden="true" />
            <button
              type="button"
              class="retro-focus h-7 max-w-[12rem] shrink-0 truncate border px-2 font-mono text-[11px]"
              :class="currentPath === crumb.path
                ? 'border-neon bg-neon/10 text-neon'
                : 'border-neon-deep/35 bg-elevated/45 text-text-main hover:text-neon'"
              @click.stop="openPath(crumb.path)"
            >
              {{ crumb.name }}
            </button>
          </template>
        </template>
        <template v-else-if="selectedLocalRoot && (currentPath === '.tsian' || currentPath.startsWith('.tsian/'))">
          <ChevronRight class="h-3.5 w-3.5 shrink-0 text-text-dim/70" aria-hidden="true" />
          <button
            type="button"
            class="retro-focus h-7 max-w-[14rem] shrink-0 truncate border px-2 font-mono text-[11px]"
            :class="currentPath === '.tsian' ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/35 bg-elevated/45 text-text-main hover:text-neon'"
            @click.stop="openPath('.tsian')"
          >
            {{ selectedLocalRoot.title }}
          </button>
          <template
            v-for="crumb in localBreadcrumbs"
            :key="crumb.path"
          >
            <ChevronRight class="h-3.5 w-3.5 shrink-0 text-text-dim/70" aria-hidden="true" />
            <button
              type="button"
              class="retro-focus h-7 max-w-[12rem] shrink-0 truncate border px-2 font-mono text-[11px]"
              :class="currentPath === crumb.path
                ? 'border-neon bg-neon/10 text-neon'
                : 'border-neon-deep/35 bg-elevated/45 text-text-main hover:text-neon'"
              @click.stop="openPath(crumb.path)"
            >
              {{ crumb.name }}
            </button>
          </template>
        </template>
      </nav>

      <form
        class="flex w-full min-w-0 shrink-0 gap-2 sm:w-auto"
        @submit.prevent.stop="runSearch"
      >
        <label class="min-w-0 flex-1 sm:w-64 sm:flex-none lg:w-72">
          <span class="sr-only">搜索工作区</span>
          <input
            v-model="searchInput"
            type="search"
            class="retro-focus h-8 w-full border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            placeholder="搜索路径或内容"
            :disabled="!isBrowsing"
          />
        </label>
        <button
          type="submit"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="!isBrowsing"
        >
          <Search class="h-3.5 w-3.5" aria-hidden="true" />
          搜索
        </button>
        <button
          v-if="activeSearchQuery"
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click.stop="clearSearch"
        >
          <X class="h-3.5 w-3.5" aria-hidden="true" />
          清除
        </button>
      </form>
    </div>

    <main class="min-h-0 overflow-auto p-3">
      <div v-if="!isBrowsing" class="retro-inset min-h-[420px] p-3">
        <div v-if="rootsLoading" class="grid min-h-[360px] place-items-center">
          <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
            正在加载工作区根目录
          </p>
        </div>
        <div v-else-if="errorMessage" class="grid min-h-[360px] place-items-center px-4">
          <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
            <p class="font-mono text-xs uppercase tracking-wider text-danger">
              工作区不可用
            </p>
            <p class="mt-2 text-sm leading-6 text-text-dim">
              {{ errorMessage }}
            </p>
          </div>
        </div>
        <div v-else-if="workspaceRoots.length === 0" class="grid min-h-[360px] place-items-center">
          <p class="font-mono text-sm text-text-dim">没有可用的工作区。</p>
        </div>
        <div
          v-else
          class="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] content-start gap-3"
          role="list"
          aria-label="工作区根"
        >
          <button
            v-for="root in workspaceRoots"
            :key="root.kind + root.cardId"
            type="button"
            class="retro-focus grid min-h-36 min-w-0 content-between gap-3 border p-3 text-left"
            :class="selectedRootCardId === root.cardId && selectedRootKind === root.kind ? 'border-neon bg-neon/10 shadow-neon-glow-active' : 'border-neon-deep/40 bg-elevated/45 hover:border-neon-deep hover:bg-elevated/70'"
            role="listitem"
            @click.stop="selectRoot(root)"
            @dblclick.stop="openRoot(root)"
            @keydown.enter.prevent="openRoot(root)"
            @keydown.space.prevent="openRoot(root)"
          >
            <span class="flex min-w-0 items-start gap-3">
              <span class="grid h-12 w-12 shrink-0 place-items-center border border-neon-deep/55 bg-void text-neon">
                <component :is="root.kind === 'local' ? HardDrive : Gamepad2" class="h-7 w-7" aria-hidden="true" />
              </span>
              <span class="min-w-0">
                <span class="line-clamp-2 text-sm font-bold leading-5 text-text-main">
                  {{ root.title }}
                </span>
                <span class="mt-1 block truncate font-mono text-[11px] text-text-dim">
                  {{ root.kind === 'local' ? '平台本地' : root.source }}
                </span>
              </span>
            </span>
            <span class="grid gap-1 font-mono text-[11px] leading-5 text-text-dim">
              <template v-if="root.kind === 'card'">
                <span>{{ root.contentFileCount }} 个内容文件</span>
                <span>{{ root.saveCount }} 个存档槽</span>
              </template>
              <template v-else>
                <span>不随游戏卡分发</span>
              </template>
              <span>{{ formatDateTime(root.updatedAt) }}</span>
            </span>
          </button>
        </div>
      </div>

      <div v-else class="grid min-h-full gap-3">
        <section
          v-if="activeSearchQuery"
          class="retro-inset grid max-h-64 min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
        >
          <header class="flex items-center justify-between gap-3 border-b border-neon-deep/35 px-3 py-2">
            <p class="font-mono text-xs uppercase tracking-wider text-neon">
              搜索：{{ activeSearchQuery }}
            </p>
            <span class="font-mono text-[11px] text-text-dim">{{ searchResults.length }} 项</span>
          </header>
          <div class="min-h-0 overflow-auto">
            <p v-if="searchLoading" class="p-3 font-mono text-xs uppercase tracking-[0.22em] text-neon">
              正在搜索
            </p>
            <p v-else-if="searchResults.length === 0" class="p-3 text-sm text-text-dim">
              没有匹配项。
            </p>
            <template v-else>
              <button
                v-for="result in searchResults"
                :key="result.path"
                type="button"
                class="retro-focus grid w-full min-w-0 grid-cols-[1fr_auto] gap-3 border-b border-neon-deep/25 px-3 py-2 text-left hover:bg-elevated/45"
                @click.stop="openFile(result.path)"
              >
                <span class="min-w-0">
                  <span class="block truncate font-mono text-xs text-text-main">{{ result.path }}</span>
                  <span class="mt-1 line-clamp-1 text-xs text-text-dim">{{ result.preview }}</span>
                </span>
                <span class="font-mono text-[11px] text-text-dim">匹配度 {{ result.score }}</span>
              </button>
            </template>
          </div>
        </section>

        <section class="retro-inset min-h-[420px] overflow-hidden">
          <div v-if="directoryLoading" class="grid min-h-[360px] place-items-center">
            <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">
              正在读取目录
            </p>
          </div>
          <div v-else-if="errorMessage" class="grid min-h-[360px] place-items-center px-4">
            <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
              <p class="font-mono text-xs uppercase tracking-wider text-danger">
                目录不可用
              </p>
              <p class="mt-2 text-sm leading-6 text-text-dim">
                {{ errorMessage }}
              </p>
            </div>
          </div>
          <div v-else-if="directoryEntries.length === 0" class="grid min-h-[360px] place-items-center">
            <p class="font-mono text-sm text-text-dim">这个目录是空的。</p>
          </div>
          <div v-else class="min-w-[720px]">
            <div class="grid grid-cols-[minmax(260px,1fr)_150px_130px_170px] border-b border-neon-deep/35 bg-void/65 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              <span>名称</span>
              <span>类型</span>
              <span>大小</span>
              <span>更新时间</span>
            </div>
            <div
              v-for="entry in visibleEntries"
              :key="entry.path"
              role="button"
              tabindex="0"
              class="retro-focus grid w-full grid-cols-[minmax(260px,1fr)_150px_130px_170px] items-center gap-0 border-b border-neon-deep/20 px-3 py-2 text-left hover:bg-elevated/45"
              :class="[
                selectedEntryPath === entry.path ? 'bg-neon/10 text-neon' : 'text-text-main',
                clipboard?.kind === 'cut' && clipboard.sourcePath === entry.path ? 'opacity-50' : '',
              ]"
              @click.stop="selectedEntryPath = entry.path"
              @dblclick.stop="activateEntry(entry)"
              @keydown.enter.prevent="activateEntry(entry)"
              @keydown.space.prevent="activateEntry(entry)"
              @contextmenu.prevent.stop="openEntryContextMenu(entry, $event)"
            >
              <span class="flex min-w-0 items-center gap-2">
                <component :is="entryIcon(entry)" class="h-4 w-4 shrink-0 text-neon" aria-hidden="true" />
                <input
                  v-if="renamingEntryPath === entry.path"
                  v-model="renameDraft"
                  type="text"
                  class="retro-focus h-7 min-w-0 flex-1 border border-neon bg-void px-2 font-mono text-xs text-text-main"
                  data-rename-input="true"
                  @click.stop
                  @dblclick.stop
                  @keydown.enter.prevent.stop="commitRename(entry)"
                  @keydown.esc.prevent.stop="cancelRename"
                  @blur="commitRename(entry)"
                />
                <span v-else class="truncate font-mono text-xs">{{ entry.name }}</span>
              </span>
              <span class="truncate font-mono text-[11px] text-text-dim">{{ entryTypeLabel(entry) }}</span>
              <span class="font-mono text-[11px] text-text-dim">{{ entrySizeLabel(entry) }}</span>
              <span class="font-mono text-[11px] text-text-dim">{{ entry.updatedAt ? formatDateTime(entry.updatedAt) : "--" }}</span>
            </div>
          </div>
        </section>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <p class="font-mono text-[11px] uppercase tracking-wider text-text-dim">
        {{ statusLabel }}
      </p>
      <p v-if="feedback" class="min-w-0 truncate font-mono text-[11px] text-text-dim">{{ feedback }}</p>
    </footer>

    <div
      v-if="contextMenu"
      class="absolute z-50 min-w-36 border border-neon-deep/70 bg-elevated p-1 shadow-neon-glow-active"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <button
        v-if="contextMenu.entry"
        type="button"
        class="block w-full px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="activateEntry(contextMenu.entry)"
      >
        打开
      </button>
      <button
        v-if="contextMenu.entry?.kind === 'file'"
        type="button"
        class="block w-full px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="openFile(contextMenu.entry.path)"
      >
        打开
      </button>
      <button
        v-if="contextMenu.entry && canModifyEntry(contextMenu.entry)"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="copyEntry(contextMenu.entry)"
      >
        <Copy class="h-3.5 w-3.5" aria-hidden="true" />
        复制
      </button>
      <button
        v-if="contextMenu.entry && canModifyEntry(contextMenu.entry)"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="cutEntry(contextMenu.entry)"
      >
        <Scissors class="h-3.5 w-3.5" aria-hidden="true" />
        剪切
      </button>
      <button
        v-if="contextMenu.entry && canRenameEntry(contextMenu.entry)"
        type="button"
        class="block w-full px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="startRenameEntry(contextMenu.entry)"
      >
        重命名
      </button>
      <button
        v-if="contextMenu.entry && canDeleteEntry(contextMenu.entry)"
        type="button"
        class="block w-full px-3 py-1.5 text-left font-mono text-xs text-danger hover:bg-danger/10"
        @click="deleteEntry(contextMenu.entry)"
      >
        删除
      </button>
      <button
        v-if="!contextMenu.entry && isBrowsing"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="createNewFileFromContextMenu"
      >
        <FilePlus2 class="h-3.5 w-3.5" aria-hidden="true" />
        新建文件
      </button>
      <button
        v-if="!contextMenu.entry && isBrowsing"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="createNewFolderFromContextMenu"
      >
        <FolderPlus class="h-3.5 w-3.5" aria-hidden="true" />
        新建文件夹
      </button>
      <button
        v-if="!contextMenu.entry && canPasteHere()"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="pasteFromContextMenu"
      >
        <ClipboardPaste class="h-3.5 w-3.5" aria-hidden="true" />
        粘贴
      </button>
      <button
        v-if="!contextMenu.entry"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="refreshFromContextMenu"
      >
        <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
        刷新
      </button>
    </div>

  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  ChevronRight,
  ClipboardPaste,
  Code2,
  Copy,
  File,
  FileJson2,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  Gamepad2,
  HardDrive,
  RefreshCw,
  Scissors,
  Search,
  X,
} from "lucide-vue-next"
import type { Component } from "vue"
import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceSearchResult,
} from "@tsian/contracts"
import { inferWorkspaceMediaType } from "@/lib/workspace-file-types"
import {
  inferMediaTypeFromPath,
  isImageMediaType,
  isAudioMediaType,
  isVideoMediaType,
} from "@/lib/media-type"
import { confirm } from "@/composables/useConfirm"
import {
  WORKSPACE_CONTENT_CHANGED_EVENT,
  emitWorkspaceContentChanged,
  isWorkspaceContentChangedEvent,
} from "@/lib/workspace-events"
import {
  deletePlatformWorkspacePath,
  listPlatformWorkspaceDirectory,
  listPlatformWorkspaceRoots,
  movePlatformWorkspacePath,
  readPlatformWorkspaceFile,
  searchPlatformWorkspace,
  writePlatformWorkspaceFile,
  type PlatformWorkspaceRootEntry,
} from "../platform-host"

interface ContextMenuState {
  x: number
  y: number
  entry: WorkspaceEntry | null
}

interface ClipboardEntry {
  kind: "copy" | "cut"
  sourcePath: string
  sourceName: string
  isDirectory: boolean
}

const route = useRoute()
const router = useRouter()

const workspaceRoots = ref<PlatformWorkspaceRootEntry[]>([])
const selectedRootCardId = ref("")
const selectedRootKind = ref<"local" | "card">("card")
const selectedCardId = ref("")
const currentPath = ref("")
const directoryEntries = ref<WorkspaceEntry[]>([])
const selectedEntryPath = ref("")
const searchInput = ref("")
const activeSearchQuery = ref("")
const searchResults = ref<WorkspaceSearchResult[]>([])
const renamingEntryPath = ref("")
const renameDraft = ref("")
const rootsLoading = ref(false)
const directoryLoading = ref(false)
const searchLoading = ref(false)
const errorMessage = ref("")
const feedback = ref("")
const contextMenu = ref<ContextMenuState | null>(null)
const clipboard = ref<ClipboardEntry | null>(null)
const explorerRef = ref<HTMLElement | null>(null)
let rootsRequestId = 0
let directoryRequestId = 0
let searchRequestId = 0

const selectedCard = computed(() =>
  workspaceRoots.value.find((root) => root.cardId === selectedCardId.value && root.kind === "card") ?? null
)

const selectedLocalRoot = computed(() =>
  workspaceRoots.value.find((root) => root.kind === "local") ?? null
)

const localBreadcrumbs = computed(() => {
  if (!currentPath.value.startsWith(".tsian/")) return []
  const segments = currentPath.value.split("/").filter(Boolean).slice(1)
  return segments.map((name, index) => ({
    name,
    path: [".tsian", ...segments.slice(0, index + 1)].join("/"),
  }))
})

const isBrowsing = computed(() =>
  Boolean(selectedCardId.value) || currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/"),
)

const workspaceBreadcrumbs = computed(() => {
  const segments = currentPath.value.split("/").filter(Boolean)
  return segments.map((name, index) => ({
    name,
    path: segments.slice(0, index + 1).join("/"),
  }))
})

const selectedEntry = computed(() =>
  directoryEntries.value.find((entry) => entry.path === selectedEntryPath.value) ?? null
)

const visibleEntries = computed(() =>
  directoryEntries.value.filter((entry) => entry.name !== ".keep"),
)

const clipboardContextKey = computed(() => {
  if (selectedCardId.value) return `card:${selectedCardId.value}`
  if (currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/")) return "local"
  return ""
})

const statusLabel = computed(() => {
  if (!isBrowsing.value) {
    return `${workspaceRoots.value.length} 个根`
  }
  if (activeSearchQuery.value) {
    return `${searchResults.value.length} 个结果`
  }
  return `${directoryEntries.value.length} 项`
})

function routeQueryString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function normalizeDisplayPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
}

function syncStateFromRoute() {
  const nextCardId = routeQueryString(route.query.cardId)
  const nextPath = normalizeDisplayPath(routeQueryString(route.query.path))
  selectedCardId.value = nextCardId
  // Support .tsian/ browsing with no cardId.
  currentPath.value = nextCardId ? nextPath : (nextPath === ".tsian" || nextPath.startsWith(".tsian/") ? nextPath : "")
}

function syncRouteState() {
  const query: Record<string, string> = {}
  if (selectedCardId.value) {
    query.cardId = selectedCardId.value
  }
  if (currentPath.value && (selectedCardId.value || currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/"))) {
    query.path = currentPath.value
  }

  void router.replace({ name: "workspace", query })
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function entryIcon(entry: WorkspaceEntry): Component {
  if (entry.kind === "directory") {
    return FolderOpen
  }
  const path = entry.path.toLowerCase()
  if (path.endsWith(".json") || path.endsWith(".jsonl")) return FileJson2
  if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js") || path.endsWith(".jsx")) return Code2
  if (path.endsWith(".md") || path.endsWith(".txt")) return FileText
  return File
}

function entryTypeLabel(entry: WorkspaceEntry): string {
  if (entry.kind === "directory") {
    return "文件夹"
  }
  return inferWorkspaceMediaType(entry.path)
}

function entrySizeLabel(entry: WorkspaceEntry): string {
  if (entry.kind === "directory") {
    return `${entry.childCount ?? 0} 项`
  }
  return formatFileSize(entry.size ?? 0)
}

function canDeleteEntry(entry: WorkspaceEntry): boolean {
  if (entry.path === "save") {
    return false
  }
  if (/^save\/save-\d+$/.test(entry.path)) {
    return false
  }
  return true
}

function canRenameEntry(entry: WorkspaceEntry): boolean {
  return canDeleteEntry(entry)
}

function canModifyEntry(entry: WorkspaceEntry): boolean {
  return canDeleteEntry(entry)
}

function splitNameExt(name: string): { base: string; ext: string } {
  const dotIndex = name.lastIndexOf(".")
  if (dotIndex <= 0) {
    // 无扩展名, 或以 . 开头的隐藏文件 (.keep / .gitignore) 视为无扩展名
    return { base: name, ext: "" }
  }
  return { base: name.slice(0, dotIndex), ext: name.slice(dotIndex) }
}

function uniqueName(base: string, ext: string, existing: Set<string>): string {
  const candidate = `${base}${ext}`
  if (!existing.has(candidate)) {
    return candidate
  }
  let index = 1
  while (existing.has(`${base}(${index})${ext}`)) {
    index += 1
  }
  return `${base}(${index})${ext}`
}

function currentEntryNames(): Set<string> {
  return new Set(visibleEntries.value.map((entry) => entry.name))
}

function canPasteHere(): boolean {
  return Boolean(clipboard.value)
    && isBrowsing.value
    && currentPath.value !== "save"
}

async function refreshRoots() {
  const requestId = ++rootsRequestId
  rootsLoading.value = true
  errorMessage.value = ""

  try {
    workspaceRoots.value = await listPlatformWorkspaceRoots()
    if (
      selectedCardId.value
      && !workspaceRoots.value.some((root) => root.cardId === selectedCardId.value)
    ) {
      selectedCardId.value = ""
      currentPath.value = ""
      directoryEntries.value = []
      syncRouteState()
    }
  } catch (error) {
    if (requestId === rootsRequestId) {
      errorMessage.value = error instanceof Error ? error.message : "无法加载工作区根目录。"
    }
  } finally {
    if (requestId === rootsRequestId) {
      rootsLoading.value = false
    }
  }
}

async function refreshDirectory() {
  if (!selectedCardId.value && currentPath.value !== ".tsian" && !currentPath.value.startsWith(".tsian/")) {
    directoryEntries.value = []
    return
  }

  const requestId = ++directoryRequestId
  directoryLoading.value = true
  errorMessage.value = ""

  try {
    const result = await listPlatformWorkspaceDirectory({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path: currentPath.value,
    })
    if (requestId !== directoryRequestId) {
      return
    }

    currentPath.value = result.path
    directoryEntries.value = result.entries
    if (!result.entries.some((entry) => entry.path === selectedEntryPath.value)) {
      selectedEntryPath.value = ""
    }
    if (!result.entries.some((entry) => entry.path === renamingEntryPath.value)) {
      cancelRename()
    }
    syncRouteState()
  } catch (error) {
    if (requestId === directoryRequestId) {
      directoryEntries.value = []
      errorMessage.value = error instanceof Error ? error.message : "无法读取工作区目录。"
    }
  } finally {
    if (requestId === directoryRequestId) {
      directoryLoading.value = false
    }
  }
}

function refreshCurrentView() {
  if (selectedCardId.value || currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/")) {
    void refreshDirectory()
    if (activeSearchQuery.value) {
      void runSearch()
    }
    return
  }

  void refreshRoots()
}

function selectRoot(root: PlatformWorkspaceRootEntry) {
  selectedRootCardId.value = root.cardId
  selectedRootKind.value = root.kind
}

function openRoot(root: PlatformWorkspaceRootEntry) {
  if (root.kind === "local") {
    selectedCardId.value = ""
    selectedRootCardId.value = root.cardId
    selectedRootKind.value = "local"
    currentPath.value = ".tsian"
    selectedEntryPath.value = ""
    clearSearch()
    syncRouteState()
    void refreshDirectory()
    return
  }
  openCard(root.cardId)
}

function openCard(cardId: string) {
  selectedCardId.value = cardId
  selectedRootCardId.value = cardId
  selectedRootKind.value = "card"
  currentPath.value = ""
  selectedEntryPath.value = ""
  clearSearch()
  syncRouteState()
  void refreshDirectory()
}

function returnToRoot() {
  selectedCardId.value = ""
  currentPath.value = ""
  directoryEntries.value = []
  selectedEntryPath.value = ""
  clearSearch()
  syncRouteState()
}

function openPath(path: string) {
  currentPath.value = path
  selectedEntryPath.value = ""
  cancelRename()
  syncRouteState()
  void refreshDirectory()
}

function activateEntry(entry: WorkspaceEntry) {
  contextMenu.value = null
  selectedEntryPath.value = entry.path
  if (entry.kind === "directory") {
    openPath(entry.path)
    return
  }

  void openFile(entry.path)
}

function openEntryContextMenu(entry: WorkspaceEntry, event: MouseEvent) {
  selectedEntryPath.value = entry.path
  contextMenu.value = contextMenuStateFromMouse(event, entry)
}

function openBlankContextMenu(event: MouseEvent) {
  selectedEntryPath.value = ""
  cancelRename()
  contextMenu.value = contextMenuStateFromMouse(event, null)
}

function contextMenuStateFromMouse(event: MouseEvent, entry: WorkspaceEntry | null): ContextMenuState {
  const menuWidth = 176
  // 条目菜单: 打开/编辑/复制/剪切/重命名/删除 最多 6 项; 空白菜单: 新建文件/新建文件夹/粘贴/刷新 最多 4 项
  const menuHeight = entry ? 176 : 128
  const rect = explorerRef.value?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
  const rawX = event.clientX - rect.left
  const rawY = event.clientY - rect.top
  return {
    x: clampMenuCoordinate(rawX, rect.width, menuWidth),
    y: clampMenuCoordinate(rawY, rect.height, menuHeight),
    entry,
  }
}

function clampMenuCoordinate(value: number, containerSize: number, menuSize: number): number {
  return Math.min(Math.max(value, 8), Math.max(8, containerSize - menuSize - 8))
}

function refreshFromContextMenu() {
  contextMenu.value = null
  refreshCurrentView()
}

function createNewFileFromContextMenu() {
  contextMenu.value = null
  void createNewFile()
}

function createNewFolderFromContextMenu() {
  contextMenu.value = null
  void createNewFolder()
}

function pasteFromContextMenu() {
  contextMenu.value = null
  void pasteFromClipboard()
}

function enterRenameForNewEntry(entry: WorkspaceEntry) {
  contextMenu.value = null
  selectedEntryPath.value = entry.path
  renamingEntryPath.value = entry.path
  renameDraft.value = entry.name
  void nextTick(() => {
    const input = explorerRef.value?.querySelector<HTMLInputElement>('[data-rename-input="true"]')
    if (!input) {
      return
    }
    input.focus()
    // 选中文件名主干(不含扩展名),对齐 Windows 新建后重命名体验
    const { base } = splitNameExt(entry.name)
    input.setSelectionRange(0, base.length)
  })
}

async function createNewFile() {
  if (!isBrowsing.value) {
    return
  }
  if (currentPath.value === "save") {
    feedback.value = "请先进入具体存档槽，再新建文件。"
    return
  }

  const name = uniqueName("新建文件", ".txt", currentEntryNames())
  const path = currentPath.value ? `${currentPath.value}/${name}` : name
  try {
    await writePlatformWorkspaceFile({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path,
      content: "",
    })
    emitWorkspaceContentChanged({ cardId: selectedCardId.value, path })
    await refreshDirectory()
    const created = directoryEntries.value.find((entry) => entry.path === path)
    if (created) {
      enterRenameForNewEntry(created)
    }
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "无法新建文件。"
  }
}

async function createNewFolder() {
  if (!isBrowsing.value) {
    return
  }
  if (currentPath.value === "save") {
    feedback.value = "请先进入具体存档槽，再新建文件夹。"
    return
  }

  const name = uniqueName("新文件夹", "", currentEntryNames())
  const dirPath = currentPath.value ? `${currentPath.value}/${name}` : name
  // 工作区是文件式存储,空文件夹无法持久化。写入 .keep 锚点文件让目录出现,
  // 列表渲染时隐藏 .keep,使文件夹显示为空。.keep 是持久锚点:单文件删移不影响它,
  // 只随删/移整个目录消失。
  const keepPath = `${dirPath}/.keep`
  try {
    await writePlatformWorkspaceFile({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path: keepPath,
      content: "",
    })
    emitWorkspaceContentChanged({ cardId: selectedCardId.value, path: keepPath })
    await refreshDirectory()
    const created = directoryEntries.value.find((entry) => entry.path === dirPath)
    if (created) {
      enterRenameForNewEntry(created)
    }
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "无法新建文件夹。"
  }
}

function startRenameEntry(entry: WorkspaceEntry) {
  if (!isBrowsing.value || !canRenameEntry(entry)) {
    return
  }

  contextMenu.value = null
  selectedEntryPath.value = entry.path
  renamingEntryPath.value = entry.path
  renameDraft.value = entry.name
  void nextTick(() => {
    const input = explorerRef.value?.querySelector<HTMLInputElement>('[data-rename-input="true"]')
    input?.focus()
    input?.select()
  })
}

function cancelRename() {
  renamingEntryPath.value = ""
  renameDraft.value = ""
}

async function commitRename(entry: WorkspaceEntry) {
  if (!isBrowsing.value || renamingEntryPath.value !== entry.path || !canRenameEntry(entry)) {
    return
  }

  const nextName = renameDraft.value.trim()
  if (nextName === entry.name) {
    cancelRename()
    return
  }
  if (!nextName) {
    feedback.value = "名称不能为空。"
    focusRenameInput()
    return
  }
  if (/[\\/]/.test(nextName)) {
    feedback.value = "重命名时只输入名称，不要输入路径。"
    focusRenameInput()
    return
  }

  // 扩展名变更风险提示(类似 Windows: 改后缀可能导致文件无法正确解析)
  const oldExt = splitNameExt(entry.name).ext
  const newExt = splitNameExt(nextName).ext
  if (oldExt !== newExt) {
    const confirmed = await confirm({
      message: `改变扩展名「${oldExt || "无"} → ${newExt || "无"}」可能导致文件无法正确解析,确定吗?`,
      confirmText: "确定",
      severity: "danger",
    })
    if (!confirmed) {
      focusRenameInput()
      return
    }
  }

  const targetPath = siblingPath(entry.path, nextName)
  try {
    const result = await movePlatformWorkspacePath({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path: entry.path,
      targetPath,
    })
    cancelRename()
    selectedEntryPath.value = result.toPath
    feedback.value = `已重命名：${result.toPath}`
    emitWorkspaceContentChanged({ cardId: selectedCardId.value, path: result.toPath })
    await refreshDirectory()
    if (activeSearchQuery.value) {
      await runSearch()
    }
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "无法重命名工作区路径。"
    focusRenameInput()
  }
}

function focusRenameInput() {
  void nextTick(() => {
    explorerRef.value?.querySelector<HTMLInputElement>('[data-rename-input="true"]')?.focus()
  })
}

function siblingPath(path: string, nextName: string): string {
  const segments = path.split("/").filter(Boolean)
  segments.pop()
  return [...segments, nextName].join("/")
}

async function runSearch() {
  if (!isBrowsing.value) {
    return
  }

  const query = searchInput.value.trim()
  if (!query) {
    clearSearch()
    return
  }

  const requestId = ++searchRequestId
  activeSearchQuery.value = query
  searchLoading.value = true

  try {
    const results = await searchPlatformWorkspace({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      query,
      path: currentPath.value || undefined,
      limit: 100,
    })
    if (requestId === searchRequestId) {
      searchResults.value = results
    }
  } catch (error) {
    if (requestId === searchRequestId) {
      searchResults.value = []
      errorMessage.value = error instanceof Error ? error.message : "无法搜索工作区。"
    }
  } finally {
    if (requestId === searchRequestId) {
      searchLoading.value = false
    }
  }
}

function clearSearch() {
  activeSearchQuery.value = ""
  searchResults.value = []
  searchLoading.value = false
  searchRequestId += 1
}

function openFile(path: string) {
  if (!isBrowsing.value) {
    return
  }

  contextMenu.value = null
  const mediaType = inferMediaTypeFromPath(path)
  if (isImageMediaType(mediaType) || isAudioMediaType(mediaType) || isVideoMediaType(mediaType)) {
    openMediaRoute(path)
  } else {
    openEditorRoute(path)
  }
}

function openMediaRoute(path: string) {
  void router.push({
    name: "workspace-media",
    query: {
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path,
    },
  })
}

function openEditorRoute(path: string) {
  void router.push({
    name: "workspace-editor",
    query: {
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path,
      mode: "edit",
      editorId: createEditorSessionId(),
    },
  })
}

function createEditorSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

async function deleteEntry(entry: WorkspaceEntry) {
  if (!isBrowsing.value || !canDeleteEntry(entry)) {
    return
  }

  contextMenu.value = null
  cancelRename()
  const confirmed = await confirm({
    message: `删除「${entry.path}」？`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }

  try {
    const result = await deletePlatformWorkspacePath({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path: entry.path,
    })
    feedback.value = `已删除 ${result.deletedPaths.length} 项。`
    selectedEntryPath.value = ""
    await refreshDirectory()
    if (activeSearchQuery.value) {
      await runSearch()
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "无法删除工作区路径。"
  }
}

function copyEntry(entry: WorkspaceEntry) {
  if (!isBrowsing.value || !canModifyEntry(entry)) {
    return
  }
  contextMenu.value = null
  clipboard.value = {
    kind: "copy",
    sourcePath: entry.path,
    sourceName: entry.name,
    isDirectory: entry.kind === "directory",
  }
  feedback.value = `已复制：${entry.name}`
}

function cutEntry(entry: WorkspaceEntry) {
  if (!isBrowsing.value || !canModifyEntry(entry)) {
    return
  }
  contextMenu.value = null
  clipboard.value = {
    kind: "cut",
    sourcePath: entry.path,
    sourceName: entry.name,
    isDirectory: entry.kind === "directory",
  }
  feedback.value = `已剪切：${entry.name}`
}

async function pasteFromClipboard() {
  const cb = clipboard.value
  if (!cb || !isBrowsing.value || currentPath.value === "save") {
    return
  }
  contextMenu.value = null

  const { base, ext } = splitNameExt(cb.sourceName)
  // 剪切到同目录同名 = no-op
  const sameDirSibling = siblingPath(cb.sourcePath, cb.sourceName)
  const currentDirTarget = currentPath.value
    ? `${currentPath.value}/${cb.sourceName}`
    : cb.sourceName
  if (cb.kind === "cut" && sameDirSibling === currentDirTarget) {
    clipboard.value = null
    return
  }

  // 复制: 基础名加 " - 副本"; 剪切: 保持原名, 冲突时递增
  const targetBase = cb.kind === "copy" ? `${base} - 副本` : base
  const targetName = uniqueName(targetBase, ext, currentEntryNames())
  const targetPath = currentPath.value ? `${currentPath.value}/${targetName}` : targetName

  try {
    if (cb.kind === "cut") {
      await movePlatformWorkspacePath({
        ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
        path: cb.sourcePath,
        targetPath,
      })
      clipboard.value = null
      feedback.value = `已移动：${cb.sourceName} → ${targetName}`
    } else {
      if (cb.isDirectory) {
        await copyDirectory(cb.sourcePath, targetPath)
      } else {
        const file = await readPlatformWorkspaceFile({
          ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
          path: cb.sourcePath,
        })
        await writePlatformWorkspaceFile({
          ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
          path: targetPath,
          content: file.content,
          ...(file.binary ? { data: file.binary } : {}),
        })
      }
      // 复制保留 clipboard, 允许重复粘贴
      feedback.value = `已粘贴：${targetName}`
    }
    emitWorkspaceContentChanged({ cardId: selectedCardId.value, path: targetPath })
    await refreshDirectory()
    if (activeSearchQuery.value) {
      await runSearch()
    }
  } catch (error) {
    feedback.value = error instanceof Error ? error.message : "无法粘贴。"
  }
}

async function collectFilesUnder(dirPath: string): Promise<WorkspaceFile[]> {
  // 先递归 list 收集所有文件 path, 再并发 read.
  // read 是只读, 并发安全; list 阶段需顺序发现子目录, 仍串行.
  const filePaths: string[] = []
  async function walk(subPath: string): Promise<void> {
    const result = await listPlatformWorkspaceDirectory({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path: subPath,
    })
    for (const entry of result.entries) {
      if (entry.kind === "file") {
        filePaths.push(entry.path)
      } else {
        await walk(entry.path)
      }
    }
  }
  await walk(dirPath)

  const cardIdInput = selectedCardId.value ? { cardId: selectedCardId.value } : {}
  return Promise.all(
    filePaths.map((path) => readPlatformWorkspaceFile({ ...cardIdInput, path })),
  )
}

async function copyDirectory(srcPath: string, targetPath: string): Promise<void> {
  const files = await collectFilesUnder(srcPath)
  const prefix = `${srcPath}/`
  for (const file of files) {
    const relPath = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path
    const targetFilePath = `${targetPath}/${relPath}`
    await writePlatformWorkspaceFile({
      ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
      path: targetFilePath,
      content: file.content,
      ...(file.binary ? { data: file.binary } : {}),
    })
  }
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    contextMenu.value = null
    cancelRename()
    return
  }

  // 在可编辑元素内不触发资源管理器快捷键(保留浏览器原生文本操作)
  if (isEditableKeyboardTarget(event.target)) {
    return
  }

  if (event.key === "F2" && selectedEntry.value) {
    event.preventDefault()
    startRenameEntry(selectedEntry.value)
    return
  }

  if (event.key === "Delete" && selectedEntry.value) {
    event.preventDefault()
    void deleteEntry(selectedEntry.value)
    return
  }

  const ctrl = event.ctrlKey || event.metaKey
  if (!ctrl) {
    return
  }

  if (event.key === "c" || event.key === "C") {
    if (selectedEntry.value) {
      event.preventDefault()
      copyEntry(selectedEntry.value)
    }
    return
  }

  if (event.key === "x" || event.key === "X") {
    if (selectedEntry.value) {
      event.preventDefault()
      cutEntry(selectedEntry.value)
    }
    return
  }

  if (event.key === "v" || event.key === "V") {
    if (clipboard.value) {
      event.preventDefault()
      void pasteFromClipboard()
    }
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return target.isContentEditable
    || target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT"
}

function onWorkspaceContentChanged(event: Event) {
  if (!isWorkspaceContentChangedEvent(event) || event.detail.cardId !== selectedCardId.value) {
    return
  }

  feedback.value = `已更新：${event.detail.path}`
  void refreshDirectory()
  if (activeSearchQuery.value) {
    void runSearch()
  }
}

watch(() => route.fullPath, () => {
  if (route.name !== "workspace") {
    return
  }
  syncStateFromRoute()
  if (selectedCardId.value || currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/")) {
    void refreshDirectory()
  }
}, { immediate: true })

// 跨游戏卡/跨本地根/回根选择界面时清空剪贴板; 同卡内跨目录导航保留(跨目录移动是剪切核心用途)
watch(clipboardContextKey, () => {
  clipboard.value = null
})

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown)
  window.addEventListener(WORKSPACE_CONTENT_CHANGED_EVENT, onWorkspaceContentChanged)
  void refreshRoots()
})

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown)
  window.removeEventListener(WORKSPACE_CONTENT_CHANGED_EVENT, onWorkspaceContentChanged)
})
</script>
