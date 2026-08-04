<template>
  <section
    ref="root"
    class="spatial-app spatial-workspace-explorer"
    aria-label="资源管理器"
    @click="closeMenu(false)"
    @contextmenu.prevent="openBlankMenu"
  >
    <header class="spatial-app__header">
      <div class="spatial-app__identity">
        <span class="spatial-app__eyebrow">WORKSPACE EXPLORER</span>
        <h1>{{ selectedCard?.title || selectedLocalRoot?.title || "工作区" }}</h1>
      </div>
      <form class="spatial-app__commands" @submit.prevent.stop="runSearch">
        <input
          v-model="searchInput"
          class="spatial-app__input spatial-workspace-explorer__search"
          type="search"
          placeholder="搜索路径或内容"
          :disabled="!isBrowsing"
        />
        <SpatialActionButton type="submit" :disabled="!isBrowsing">
          <template #icon><Search /></template>搜索
        </SpatialActionButton>
        <SpatialActionButton v-if="activeSearchQuery" @click.stop="clearSearch">
          <template #icon><X /></template>清除
        </SpatialActionButton>
      </form>
    </header>

    <div class="spatial-workspace-explorer__body">
      <aside class="spatial-workspace-explorer__roots" aria-label="工作区根">
        <button
          v-for="item in workspaceRoots"
          :key="`${item.kind}:${item.cardId}`"
          type="button"
          :aria-pressed="selectedRootCardId === item.cardId && selectedRootKind === item.kind"
          @click="openRoot(item)"
        >
          <component :is="item.kind === 'local' ? HardDrive : Gamepad2" aria-hidden="true" />
          <span><strong>{{ item.title }}</strong><small>{{ item.kind === "local" ? "平台本地" : item.source }}</small></span>
        </button>
      </aside>

      <main class="spatial-app__scroll spatial-workspace-explorer__content">
        <nav v-if="isBrowsing" class="spatial-workspace-explorer__crumbs" aria-label="工作区路径">
          <button type="button" @click="returnToRoot"><HardDrive aria-hidden="true" />根目录</button>
          <button type="button" @click="openPath(selectedCardId ? '' : '.tsian')">
            {{ selectedCard?.title || selectedLocalRoot?.title }}
          </button>
          <button v-for="crumb in breadcrumbs" :key="crumb.path" type="button" @click="openPath(crumb.path)">
            {{ crumb.name }}
          </button>
        </nav>

        <div v-if="isBrowsing" class="spatial-workspace-explorer__commands">
          <SpatialActionButton :disabled="!canCreateHere()" @click.stop="createFile">
            <template #icon><FilePlus2 /></template>新建文件
          </SpatialActionButton>
          <SpatialActionButton :disabled="!canCreateHere()" @click.stop="createFolder">
            <template #icon><FolderPlus /></template>新建文件夹
          </SpatialActionButton>
          <SpatialActionButton :disabled="!canPasteHere()" @click.stop="paste">
            <template #icon><ClipboardPaste /></template>粘贴
          </SpatialActionButton>
          <SpatialActionButton @click.stop="refreshCurrentView">
            <template #icon><RefreshCw /></template>刷新
          </SpatialActionButton>
        </div>

        <p v-if="rootsLoading || directoryLoading || searchLoading" class="spatial-app__empty" role="status">
          正在读取工作区…
        </p>
        <div v-else-if="errorMessage" class="spatial-app__banner spatial-app__banner--error" role="alert">
          {{ errorMessage }}
        </div>
        <template v-else>
          <div v-if="feedback" class="spatial-app__banner" role="status">{{ feedback }}</div>
          <section v-if="activeSearchQuery" class="spatial-workspace-explorer__search-results">
            <header><strong>搜索：{{ activeSearchQuery }}</strong><small>{{ searchResults.length }} 项</small></header>
            <button
              v-for="entry in searchResults"
              :key="entry.path"
              type="button"
              @click="selectedEntryPath = entry.path"
              @dblclick="openFile(entry.path)"
            >
              <strong>{{ entry.path }}</strong><small>{{ entry.preview || "搜索结果" }}</small>
            </button>
            <p v-if="searchResults.length === 0" class="spatial-app__empty">没有匹配项。</p>
          </section>
          <section v-else-if="isBrowsing" class="spatial-workspace-explorer__list" role="list">
            <div
              v-for="entry in visibleEntries"
              :key="entry.path"
              class="spatial-workspace-explorer__row"
              :class="{
                'spatial-workspace-explorer__row--selected': selectedEntryPath === entry.path,
                'spatial-workspace-explorer__row--cut': clipboard?.kind === 'cut' && clipboard.sourcePath === entry.path,
              }"
              role="listitem"
              tabindex="0"
              @click.stop="selectedEntryPath = entry.path"
              @dblclick.stop="activateEntry(entry)"
              @keydown.enter.prevent="activateEntry(entry)"
              @keydown.space.prevent="activateEntry(entry)"
              @keydown="openKeyboardMenu(entry, $event)"
              @contextmenu.prevent.stop="openEntryMenu(entry, $event)"
            >
              <component :is="entry.kind === 'directory' ? FolderOpen : FileText" aria-hidden="true" />
              <input
                v-if="renamingEntryPath === entry.path"
                v-model="renameDraft"
                data-rename-input="true"
                type="text"
                @click.stop
                @dblclick.stop
                @keydown.enter.prevent.stop="commitRename(entry)"
                @keydown.esc.prevent.stop="cancelRename"
                @blur="commitRename(entry)"
              />
              <span v-else><strong>{{ entry.name }}</strong><small>{{ entry.kind === "directory" ? `${entry.childCount ?? 0} 项` : entry.path }}</small></span>
            </div>
            <p v-if="visibleEntries.length === 0" class="spatial-app__empty">此目录为空。</p>
          </section>
          <p v-else class="spatial-app__empty">选择一个工作区根目录开始浏览。</p>
        </template>
      </main>
    </div>

    <footer class="spatial-workspace-explorer__status spatial-app__status">
      <span>{{ statusLabel }}</span><span>{{ currentPath || "ROOT" }}</span>
    </footer>

    <Transition name="spatial-pop">
      <div
        v-if="menu"
        ref="menuRef"
        class="spatial-app__menu spatial-workspace-explorer__menu"
        role="menu"
        :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
        @click.stop
        @keydown.esc.prevent.stop="closeMenu(true)"
      >
        <template v-if="menu.entry">
          <button type="button" role="menuitem" @click="activateFromMenu(menu.entry)">打开</button>
          <button v-if="canCopyEntry(menu.entry)" type="button" role="menuitem" @click="copyFromMenu(menu.entry)">复制</button>
          <button v-if="canModifyEntry(menu.entry)" type="button" role="menuitem" @click="cutFromMenu(menu.entry)">剪切</button>
          <button v-if="canRenameEntry(menu.entry)" type="button" role="menuitem" @click="renameFromMenu(menu.entry)">重命名</button>
          <button v-if="canDeleteEntry(menu.entry)" type="button" role="menuitem" class="spatial-workspace-explorer__danger" @click="deleteFromMenu(menu.entry)">删除</button>
        </template>
        <template v-else>
          <button v-if="canCreateHere()" type="button" role="menuitem" @click="createFile">新建文件</button>
          <button v-if="canCreateHere()" type="button" role="menuitem" @click="createFolder">新建文件夹</button>
          <button v-if="canPasteHere()" type="button" role="menuitem" @click="paste">粘贴</button>
          <button type="button" role="menuitem" @click="refreshFromMenu">刷新</button>
        </template>
      </div>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import type { WorkspaceEntry } from "@tsian/contracts"
import {
  ClipboardPaste,
  FilePlus2,
  FileText,
  FolderOpen,
  FolderPlus,
  Gamepad2,
  HardDrive,
  RefreshCw,
  Search,
  X,
} from "lucide-vue-next"
import { useWorkspaceExplorerController } from "@/controllers/workspace/use-workspace-explorer-controller"
import {
  clampWorkspaceMenuCoordinate,
  splitWorkspaceNameExtension,
} from "@/controllers/workspace/workspace-explorer-helpers"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import "../spatial-apps.css"

interface ContextMenuState {
  readonly x: number
  readonly y: number
  readonly entry: WorkspaceEntry | null
}

const root = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menu = ref<ContextMenuState | null>(null)
let keyboardMenuInvoker: HTMLElement | null = null

const controller = useWorkspaceExplorerController()
const {
  workspaceRoots,
  selectedRootCardId,
  selectedRootKind,
  selectedCardId,
  currentPath,
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
  visibleEntries,
  statusLabel,
  canDeleteEntry,
  canRenameEntry,
  canModifyEntry,
  canCopyEntry,
  canCreateHere,
  canPasteHere,
  refreshCurrentView,
  openRoot,
  returnToRoot,
  openPath,
  activateEntry,
  startRenameEntry,
  cancelRename,
  commitRename: commitRenameAction,
  createNewFile,
  createNewFolder,
  runSearch,
  clearSearch,
  openFile,
  deleteEntry,
  copyEntry,
  cutEntry,
  pasteFromClipboard,
  handleGlobalKeydown,
} = controller

const breadcrumbs = computed(() => selectedCardId.value ? workspaceBreadcrumbs.value : localBreadcrumbs.value)

function menuPoint(clientX: number, clientY: number, entry: WorkspaceEntry | null): ContextMenuState {
  const rect = root.value?.getBoundingClientRect() ?? { left: 0, top: 0, width: 640, height: 480 }
  return {
    x: clampWorkspaceMenuCoordinate(clientX - rect.left, rect.width, 184),
    y: clampWorkspaceMenuCoordinate(clientY - rect.top, rect.height, entry ? 172 : 132),
    entry,
  }
}

function openBlankMenu(event: MouseEvent): void {
  if ((event.target as Element).closest("button, input")) return
  keyboardMenuInvoker = null
  menu.value = menuPoint(event.clientX, event.clientY, null)
}

function openEntryMenu(entry: WorkspaceEntry, event: MouseEvent): void {
  selectedEntryPath.value = entry.path
  keyboardMenuInvoker = null
  menu.value = menuPoint(event.clientX, event.clientY, entry)
}

function openKeyboardMenu(entry: WorkspaceEntry, event: KeyboardEvent): void {
  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
  event.preventDefault()
  selectedEntryPath.value = entry.path
  const invoker = event.currentTarget as HTMLElement
  const rect = invoker.getBoundingClientRect()
  keyboardMenuInvoker = invoker
  menu.value = menuPoint(rect.left + 24, rect.top + 28, entry)
  void nextTick(() => menuRef.value?.querySelector<HTMLButtonElement>("button")?.focus())
}

function closeMenu(restoreFocus: boolean): void {
  menu.value = null
  if (restoreFocus) keyboardMenuInvoker?.focus()
  keyboardMenuInvoker = null
}

function activateFromMenu(entry: WorkspaceEntry): void {
  closeMenu(false)
  activateEntry(entry)
}
function copyFromMenu(entry: WorkspaceEntry): void {
  closeMenu(true)
  copyEntry(entry)
}
function cutFromMenu(entry: WorkspaceEntry): void {
  closeMenu(true)
  cutEntry(entry)
}
function renameFromMenu(entry: WorkspaceEntry): void {
  closeMenu(false)
  startRenameEntry(entry)
}
async function deleteFromMenu(entry: WorkspaceEntry): Promise<void> {
  closeMenu(true)
  await deleteEntry(entry)
}
async function createFile(): Promise<void> {
  closeMenu(false)
  await createNewFile()
}
async function createFolder(): Promise<void> {
  closeMenu(false)
  await createNewFolder()
}
async function paste(): Promise<void> {
  closeMenu(false)
  await pasteFromClipboard()
}
function refreshFromMenu(): void {
  closeMenu(false)
  refreshCurrentView()
}
async function commitRename(entry: WorkspaceEntry): Promise<void> {
  const result = await commitRenameAction(entry)
  if (result === "refocus") {
    void nextTick(() => root.value?.querySelector<HTMLInputElement>('[data-rename-input="true"]')?.focus())
  }
}
function onGlobalKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeMenu(false)
  handleGlobalKeydown(event)
}

watch(renamingEntryPath, (path) => {
  if (!path) return
  void nextTick(() => {
    const input = root.value?.querySelector<HTMLInputElement>('[data-rename-input="true"]')
    if (!input) return
    input.focus()
    if (renameSelection.value === "stem") {
      const { base } = splitWorkspaceNameExtension(input.value)
      input.setSelectionRange(0, base.length)
    } else input.select()
  })
})

onMounted(() => window.addEventListener("keydown", onGlobalKeydown))
onBeforeUnmount(() => window.removeEventListener("keydown", onGlobalKeydown))
</script>

<style scoped>
.spatial-workspace-explorer { position: relative; grid-template-rows: auto minmax(0, 1fr) auto; }
.spatial-workspace-explorer__body { display: grid; min-width: 0; min-height: 0; grid-template-columns: 160px minmax(0, 1fr); }
.spatial-workspace-explorer__search { width: min(250px, 34cqw); }
.spatial-workspace-explorer__roots { display: grid; min-height: 0; padding: 9px; align-content: start; gap: 5px; overflow: auto; border-right: 1px solid var(--spatial-app-border); }
.spatial-workspace-explorer__roots button { display: grid; min-width: 0; min-height: 48px; padding: 8px; grid-template-columns: 20px minmax(0, 1fr); align-items: center; gap: 7px; border: 1px solid var(--spatial-app-border); color: var(--spatial-window-ink); background: var(--spatial-app-surface-muted); text-align: left; }
.spatial-workspace-explorer__roots button > svg { width: 16px; height: 16px; }
.spatial-workspace-explorer__roots span, .spatial-workspace-explorer__row span { display: grid; min-width: 0; gap: 2px; }
.spatial-workspace-explorer__roots small, .spatial-workspace-explorer__row small, .spatial-workspace-explorer__search-results small { overflow: hidden; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; text-overflow: ellipsis; white-space: nowrap; }
.spatial-workspace-explorer__roots button[aria-pressed="true"] { border-color: var(--spatial-window-tab); background: var(--spatial-app-surface-strong); }
.spatial-workspace-explorer__content { padding: 10px; }
.spatial-workspace-explorer__crumbs, .spatial-workspace-explorer__commands { display: flex; min-width: 0; margin-bottom: 9px; flex-wrap: wrap; gap: 6px; }
.spatial-workspace-explorer__crumbs button { display: inline-flex; min-height: 28px; padding: 0 8px; align-items: center; gap: 4px; border: 1px solid var(--spatial-app-border-strong); color: var(--spatial-window-ink); background: var(--spatial-app-surface-muted); font-size: 10px; }
.spatial-workspace-explorer__crumbs svg { width: 12px; height: 12px; }
.spatial-workspace-explorer__list, .spatial-workspace-explorer__search-results { display: grid; align-content: start; gap: 4px; }
.spatial-workspace-explorer__search-results > header { display: flex; min-height: 30px; align-items: center; justify-content: space-between; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-workspace-explorer__search-results > button { display: grid; padding: 8px; gap: 3px; border: 1px solid var(--spatial-app-border); color: var(--spatial-window-ink); background: var(--spatial-app-surface-muted); text-align: left; }
.spatial-workspace-explorer__row { display: grid; min-width: 0; min-height: 42px; padding: 7px 9px; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 7px; border: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface-muted); cursor: pointer; }
.spatial-workspace-explorer__row > svg { width: 15px; height: 15px; color: var(--spatial-window-accent); }
.spatial-workspace-explorer__row input { min-width: 0; height: 27px; border: 0; border-bottom: 1px solid var(--spatial-window-accent); color: var(--spatial-window-ink); background: var(--spatial-app-surface); }
.spatial-workspace-explorer__row--selected { border-color: var(--spatial-window-tab); background: var(--spatial-app-surface-strong); }
.spatial-workspace-explorer__row--cut { opacity: 0.5; }
.spatial-workspace-explorer__status { display: flex; min-height: 30px; padding: 7px 12px; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--spatial-app-border); }
.spatial-workspace-explorer__menu { position: absolute; z-index: 5; }
.spatial-workspace-explorer__danger { color: var(--spatial-window-accent) !important; }
@container (max-width: 520px) {
  .spatial-app__header { align-items: flex-start; flex-direction: column; }
  .spatial-workspace-explorer__search { width: min(100%, 260px); }
  .spatial-workspace-explorer__body { grid-template-columns: minmax(0, 1fr); }
  .spatial-workspace-explorer__roots { max-height: 110px; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); border-right: 0; border-bottom: 1px solid var(--spatial-app-border); }
}
</style>
