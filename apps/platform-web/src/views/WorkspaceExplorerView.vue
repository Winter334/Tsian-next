<template>
  <section
    ref="explorerRef"
    class="relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden"
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

        <section class="workspace-directory-list retro-inset min-h-[420px] min-w-0 overflow-hidden">
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
          <div v-else-if="visibleEntries.length === 0" class="grid min-h-[360px] place-items-center">
            <p class="font-mono text-sm text-text-dim">这个目录是空的。</p>
          </div>
          <div v-else class="workspace-directory-table">
            <div class="workspace-directory-row workspace-directory-header border-b border-neon-deep/35 bg-void/65 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-text-dim">
              <span>名称</span>
              <span class="workspace-directory-detail">类型</span>
              <span class="workspace-directory-detail">大小</span>
              <span class="workspace-directory-detail">更新时间</span>
            </div>
            <div
              v-for="entry in visibleEntries"
              :key="entry.path"
              role="button"
              tabindex="0"
              class="workspace-directory-row retro-focus w-full items-center border-b border-neon-deep/20 px-3 py-2 text-left hover:bg-elevated/45"
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
              <span class="workspace-directory-detail truncate font-mono text-[11px] text-text-dim">{{ entryTypeLabel(entry) }}</span>
              <span class="workspace-directory-detail font-mono text-[11px] text-text-dim">{{ entrySizeLabel(entry) }}</span>
              <span class="workspace-directory-detail font-mono text-[11px] text-text-dim">{{ entry.updatedAt ? formatDateTime(entry.updatedAt) : "--" }}</span>
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
        v-if="contextMenu.entry?.kind === 'directory'"
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
        v-if="contextMenu.entry && canCopyEntry(contextMenu.entry)"
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
        v-if="!contextMenu.entry && canCreateHere()"
        type="button"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs text-text-main hover:bg-neon/10 hover:text-neon"
        @click="createNewFileFromContextMenu"
      >
        <FilePlus2 class="h-3.5 w-3.5" aria-hidden="true" />
        新建文件
      </button>
      <button
        v-if="!contextMenu.entry && canCreateHere()"
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
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import type { Component } from "vue"
import type { WorkspaceEntry } from "@tsian/contracts"
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
import { useWorkspaceExplorerController } from "@/controllers/workspace/use-workspace-explorer-controller"
import {
  clampWorkspaceMenuCoordinate,
  splitWorkspaceNameExtension,
} from "@/controllers/workspace/workspace-explorer-helpers"
import { inferWorkspaceMediaType } from "@/lib/workspace-file-types"

const props = defineProps<{ minimized?: boolean }>()

interface ContextMenuState {
  x: number
  y: number
  entry: WorkspaceEntry | null
}

const explorerRef = ref<HTMLElement | null>(null)
const contextMenu = ref<ContextMenuState | null>(null)

const {
  workspaceRoots,
  selectedRootCardId,
  selectedRootKind,
  selectedCardId,
  currentPath,
  directoryEntries,
  selectedEntryPath,
  searchInput,
  activeSearchQuery,
  searchResults,
  renamingEntryPath,
  renameDraft,
  renameSelection,
  rootsLoading,
  directoryLoading,
  searchLoading,
  errorMessage,
  feedback,
  clipboard,
  selectedCard,
  selectedLocalRoot,
  localBreadcrumbs,
  isBrowsing,
  workspaceBreadcrumbs,
  selectedEntry,
  visibleEntries,
  statusLabel,
  canDeleteEntry,
  canRenameEntry,
  canModifyEntry,
  canCopyEntry,
  canCreateHere,
  canPasteHere,
  refreshCurrentView,
  selectRoot,
  openRoot,
  returnToRoot,
  openPath,
  activateEntry: activateEntryAction,
  startRenameEntry: startRenameEntryAction,
  cancelRename,
  commitRename: commitRenameAction,
  createNewFile: createNewFileAction,
  createNewFolder: createNewFolderAction,
  runSearch,
  clearSearch,
  openFile: openFileAction,
  deleteEntry: deleteEntryAction,
  copyEntry: copyEntryAction,
  cutEntry: cutEntryAction,
  pasteFromClipboard: pasteFromClipboardAction,
  handleGlobalKeydown,
} = useWorkspaceExplorerController()

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function entryIcon(entry: WorkspaceEntry): Component {
  if (entry.kind === "directory") return FolderOpen
  const path = entry.path.toLowerCase()
  if (path.endsWith(".json") || path.endsWith(".jsonl")) return FileJson2
  if (path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".js") || path.endsWith(".jsx")) return Code2
  if (path.endsWith(".md") || path.endsWith(".txt")) return FileText
  return File
}

function entryTypeLabel(entry: WorkspaceEntry): string {
  return entry.kind === "directory" ? "文件夹" : inferWorkspaceMediaType(entry.path)
}

function entrySizeLabel(entry: WorkspaceEntry): string {
  return entry.kind === "directory" ? `${entry.childCount ?? 0} 项` : formatFileSize(entry.size ?? 0)
}

function menuState(event: MouseEvent, entry: WorkspaceEntry | null): ContextMenuState {
  const menuWidth = 176
  const menuHeight = entry ? 176 : 128
  const rect = explorerRef.value?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
  return {
    x: clampWorkspaceMenuCoordinate(event.clientX - rect.left, rect.width, menuWidth),
    y: clampWorkspaceMenuCoordinate(event.clientY - rect.top, rect.height, menuHeight),
    entry,
  }
}

function openEntryContextMenu(entry: WorkspaceEntry, event: MouseEvent): void {
  selectedEntryPath.value = entry.path
  contextMenu.value = menuState(event, entry)
}

function openBlankContextMenu(event: MouseEvent): void {
  selectedEntryPath.value = ""
  cancelRename()
  contextMenu.value = menuState(event, null)
}

function activateEntry(entry: WorkspaceEntry): void {
  contextMenu.value = null
  activateEntryAction(entry)
}

function openFile(path: string): void {
  contextMenu.value = null
  openFileAction(path)
}

function startRenameEntry(entry: WorkspaceEntry): void {
  contextMenu.value = null
  startRenameEntryAction(entry)
}

async function commitRename(entry: WorkspaceEntry): Promise<void> {
  const result = await commitRenameAction(entry)
  if (result === "refocus") focusRenameInput()
}

function focusRenameInput(): void {
  void nextTick(() => explorerRef.value
    ?.querySelector<HTMLInputElement>('[data-rename-input="true"]')
    ?.focus())
}

async function createNewFileFromContextMenu(): Promise<void> {
  contextMenu.value = null
  await createNewFileAction()
}

async function createNewFolderFromContextMenu(): Promise<void> {
  contextMenu.value = null
  await createNewFolderAction()
}

function refreshFromContextMenu(): void {
  contextMenu.value = null
  refreshCurrentView()
}

async function pasteFromContextMenu(): Promise<void> {
  contextMenu.value = null
  await pasteFromClipboardAction()
}

async function deleteEntry(entry: WorkspaceEntry): Promise<void> {
  contextMenu.value = null
  await deleteEntryAction(entry)
}

function copyEntry(entry: WorkspaceEntry): void {
  contextMenu.value = null
  copyEntryAction(entry)
}

function cutEntry(entry: WorkspaceEntry): void {
  contextMenu.value = null
  cutEntryAction(entry)
}

function onGlobalKeydown(event: KeyboardEvent): void {
  if (props.minimized) return
  if (event.key === "Escape") contextMenu.value = null
  handleGlobalKeydown(event)
}

watch(renamingEntryPath, (path) => {
  if (!path) return
  void nextTick(() => {
    const input = explorerRef.value?.querySelector<HTMLInputElement>('[data-rename-input="true"]')
    if (!input) return
    input.focus()
    if (renameSelection.value === "stem") {
      const { base } = splitWorkspaceNameExtension(input.value)
      input.setSelectionRange(0, base.length)
    } else {
      input.select()
    }
  })
})

onMounted(() => window.addEventListener("keydown", onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown))
</script>

<style scoped>
.workspace-directory-list {
  container-type: inline-size;
}

.workspace-directory-table {
  min-width: 720px;
}

.workspace-directory-row {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 150px 130px 170px;
}

@container (max-width: 719px) {
  .workspace-directory-table {
    min-width: 0;
  }

  .workspace-directory-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .workspace-directory-detail {
    display: none;
  }
}
</style>
