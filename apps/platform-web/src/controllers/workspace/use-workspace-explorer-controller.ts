import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import type { WorkspaceEntry, WorkspaceSearchResult } from "@tsian/contracts"
import { confirm } from "@/composables/useConfirm"
import {
  inferMediaTypeFromPath,
  isAudioMediaType,
  isImageMediaType,
  isVideoMediaType,
} from "@/lib/media-type"
import {
  canCopyWorkspaceEntry,
  canCreateWorkspaceEntry,
  canMutateWorkspaceEntry,
} from "@/lib/workspace-readonly"
import {
  WORKSPACE_CONTENT_CHANGED_EVENT,
  emitWorkspaceContentChanged,
  isWorkspaceContentChangedEvent,
} from "@/lib/workspace-events"
import {
  copyPlatformWorkspacePath,
  deletePlatformWorkspacePath,
  listPlatformWorkspaceDirectory,
  listPlatformWorkspaceRoots,
  movePlatformWorkspacePath,
  searchPlatformWorkspace,
  writePlatformWorkspaceFile,
  type PlatformWorkspaceRootEntry,
} from "@/platform-host"
import {
  createWorkspaceEditorSessionId,
  isEditableWorkspaceKeyboardTarget,
  siblingWorkspacePath,
  splitWorkspaceNameExtension,
  uniqueWorkspaceName,
} from "./workspace-explorer-helpers"
import { normalizeWorkspaceDisplayPath } from "./workspace-controller-helpers"

export interface WorkspaceExplorerClipboardEntry {
  readonly kind: "copy" | "cut"
  readonly sourcePath: string
  readonly sourceName: string
  readonly sourceCardId?: string
  readonly isDirectory: boolean
}

export type WorkspaceRenameSelection = "all" | "stem"

export function useWorkspaceExplorerController() {
  const route = useRoute()
  const router = useRouter()

  const workspaceRoots = ref<PlatformWorkspaceRootEntry[]>([])
  const selectedRootCardId = ref("")
  const selectedRootKind = ref<"local" | "card">("card")
  const selectedCardId = ref("")
  const currentPath = ref("")
  const directoryEntries = ref<WorkspaceEntry[]>([])
  const currentDirectoryReadOnly = ref(false)
  const selectedEntryPath = ref("")
  const searchInput = ref("")
  const activeSearchQuery = ref("")
  const searchResults = ref<WorkspaceSearchResult[]>([])
  const renamingEntryPath = ref("")
  const renameDraft = ref("")
  const renameSelection = ref<WorkspaceRenameSelection>("all")
  const rootsLoading = ref(false)
  const directoryLoading = ref(false)
  const searchLoading = ref(false)
  const errorMessage = ref("")
  const feedback = ref("")
  const clipboard = ref<WorkspaceExplorerClipboardEntry | null>(null)
  let rootsRequestId = 0
  let directoryRequestId = 0
  let searchRequestId = 0

  const selectedCard = computed(() => workspaceRoots.value.find(
    (root) => root.kind === "card" && root.cardId === selectedCardId.value,
  ) ?? null)
  const selectedLocalRoot = computed(() => workspaceRoots.value.find(
    (root) => root.kind === "local",
  ) ?? null)
  const localBreadcrumbs = computed(() => {
    if (!currentPath.value.startsWith(".tsian/")) return []
    const segments = currentPath.value.split("/").filter(Boolean).slice(1)
    return segments.map((name, index) => ({
      name,
      path: [".tsian", ...segments.slice(0, index + 1)].join("/"),
    }))
  })
  const isBrowsing = computed(() => Boolean(selectedCardId.value)
    || currentPath.value === ".tsian"
    || currentPath.value.startsWith(".tsian/"))
  const workspaceBreadcrumbs = computed(() => {
    const segments = currentPath.value.split("/").filter(Boolean)
    return segments.map((name, index) => ({
      name,
      path: segments.slice(0, index + 1).join("/"),
    }))
  })
  const selectedEntry = computed(() => directoryEntries.value.find(
    (entry) => entry.path === selectedEntryPath.value,
  ) ?? null)
  const visibleEntries = computed(() => directoryEntries.value.filter(
    (entry) => entry.name !== ".keep",
  ))
  const statusLabel = computed(() => {
    if (!isBrowsing.value) return `${workspaceRoots.value.length} 个根`
    if (activeSearchQuery.value) return `${searchResults.value.length} 个结果`
    return `${visibleEntries.value.length} 项`
  })

  function routeQueryString(value: unknown): string {
    return typeof value === "string" ? value : ""
  }

  function syncStateFromRoute(): void {
    const nextCardId = routeQueryString(route.query.cardId)
    const nextPath = normalizeWorkspaceDisplayPath(routeQueryString(route.query.path))
    selectedCardId.value = nextCardId
    currentPath.value = nextCardId
      ? nextPath
      : nextPath === ".tsian" || nextPath.startsWith(".tsian/") ? nextPath : ""
    syncSelectedRootFromBrowsingState()
  }

  function syncSelectedRootFromBrowsingState(): void {
    if (selectedCardId.value) {
      selectedRootCardId.value = selectedCardId.value
      selectedRootKind.value = "card"
      return
    }
    if (currentPath.value === ".tsian" || currentPath.value.startsWith(".tsian/")) {
      selectedRootCardId.value = selectedLocalRoot.value?.cardId ?? ""
      selectedRootKind.value = "local"
      return
    }
    selectedRootCardId.value = ""
    selectedRootKind.value = "card"
  }

  function syncRouteState(): void {
    const query: Record<string, string> = {}
    if (selectedCardId.value) query.cardId = selectedCardId.value
    if (currentPath.value && (selectedCardId.value
      || currentPath.value === ".tsian"
      || currentPath.value.startsWith(".tsian/"))) {
      query.path = currentPath.value
    }
    void router.replace({ name: "workspace", query })
  }

  function canDeleteEntry(entry: WorkspaceEntry): boolean {
    return canMutateWorkspaceEntry({
      entry,
      currentDirectoryReadOnly: currentDirectoryReadOnly.value,
      directoryLoading: directoryLoading.value,
    })
  }
  const canRenameEntry = canDeleteEntry
  const canModifyEntry = canDeleteEntry
  function canCopyEntry(entry: WorkspaceEntry): boolean {
    return !directoryLoading.value && canCopyWorkspaceEntry(entry)
  }
  function canCreateHere(): boolean {
    return canCreateWorkspaceEntry({
      isBrowsing: isBrowsing.value,
      currentDirectoryReadOnly: currentDirectoryReadOnly.value,
      directoryLoading: directoryLoading.value,
      currentPath: currentPath.value,
    })
  }
  function canPasteHere(): boolean {
    return clipboard.value !== null && canCreateHere()
  }
  function currentEntryNames(): Set<string> {
    return new Set(visibleEntries.value.map((entry) => entry.name))
  }

  function resetDirectoryState(): void {
    directoryRequestId += 1
    directoryLoading.value = false
    directoryEntries.value = []
    currentDirectoryReadOnly.value = false
    selectedEntryPath.value = ""
    cancelRename()
    clearSearch()
  }

  async function refreshRoots(): Promise<void> {
    const requestId = ++rootsRequestId
    rootsLoading.value = true
    errorMessage.value = ""
    try {
      const roots = await listPlatformWorkspaceRoots()
      if (requestId !== rootsRequestId) return
      workspaceRoots.value = roots
      if (selectedCardId.value && !roots.some((root) => root.cardId === selectedCardId.value)) {
        returnToRoot()
      } else {
        syncSelectedRootFromBrowsingState()
      }
    } catch (error) {
      if (requestId === rootsRequestId) {
        errorMessage.value = error instanceof Error ? error.message : "无法加载工作区根目录。"
      }
    } finally {
      if (requestId === rootsRequestId) rootsLoading.value = false
    }
  }

  async function refreshDirectory(): Promise<void> {
    if (!selectedCardId.value
      && currentPath.value !== ".tsian"
      && !currentPath.value.startsWith(".tsian/")) {
      resetDirectoryState()
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
      if (requestId !== directoryRequestId) return
      currentPath.value = result.path
      directoryEntries.value = result.entries
      currentDirectoryReadOnly.value = result.readOnly === true
      if (!result.entries.some((entry) => entry.path === selectedEntryPath.value)) {
        selectedEntryPath.value = ""
      }
      if (!result.entries.some((entry) => entry.path === renamingEntryPath.value)) cancelRename()
      syncRouteState()
    } catch (error) {
      if (requestId === directoryRequestId) {
        directoryEntries.value = []
        currentDirectoryReadOnly.value = false
        errorMessage.value = error instanceof Error ? error.message : "无法读取工作区目录。"
      }
    } finally {
      if (requestId === directoryRequestId) directoryLoading.value = false
    }
  }

  function refreshCurrentView(): void {
    if (isBrowsing.value) {
      void refreshDirectory()
      if (activeSearchQuery.value) void runSearch()
    } else {
      void refreshRoots()
    }
  }

  function selectRoot(root: PlatformWorkspaceRootEntry): void {
    selectedRootCardId.value = root.cardId
    selectedRootKind.value = root.kind
  }
  function openRoot(root: PlatformWorkspaceRootEntry): void {
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
  function openCard(cardId: string): void {
    selectedCardId.value = cardId
    selectedRootCardId.value = cardId
    selectedRootKind.value = "card"
    currentPath.value = ""
    selectedEntryPath.value = ""
    clearSearch()
    syncRouteState()
    void refreshDirectory()
  }
  function returnToRoot(): void {
    selectedCardId.value = ""
    currentPath.value = ""
    syncSelectedRootFromBrowsingState()
    resetDirectoryState()
    syncRouteState()
  }
  function openPath(path: string): void {
    currentPath.value = path
    selectedEntryPath.value = ""
    cancelRename()
    syncRouteState()
    void refreshDirectory()
  }
  function activateEntry(entry: WorkspaceEntry): void {
    selectedEntryPath.value = entry.path
    if (entry.kind === "directory") openPath(entry.path)
    else openFile(entry.path)
  }

  function enterRename(entry: WorkspaceEntry, selection: WorkspaceRenameSelection): void {
    selectedEntryPath.value = entry.path
    renamingEntryPath.value = entry.path
    renameDraft.value = entry.name
    renameSelection.value = selection
  }
  function startRenameEntry(entry: WorkspaceEntry): void {
    if (!isBrowsing.value || !canRenameEntry(entry)) return
    enterRename(entry, "all")
  }
  function cancelRename(): void {
    renamingEntryPath.value = ""
    renameDraft.value = ""
    renameSelection.value = "all"
  }
  async function commitRename(entry: WorkspaceEntry): Promise<"done" | "refocus"> {
    if (!isBrowsing.value || renamingEntryPath.value !== entry.path || !canRenameEntry(entry)) {
      return "done"
    }
    const nextName = renameDraft.value.trim()
    if (nextName === entry.name) {
      cancelRename()
      return "done"
    }
    if (!nextName) {
      feedback.value = "名称不能为空。"
      return "refocus"
    }
    if (/[\\/]/.test(nextName)) {
      feedback.value = "重命名时只输入名称，不要输入路径。"
      return "refocus"
    }
    const oldExt = splitWorkspaceNameExtension(entry.name).ext
    const newExt = splitWorkspaceNameExtension(nextName).ext
    if (oldExt !== newExt) {
      const accepted = await confirm({
        message: `改变扩展名「${oldExt || "无"} → ${newExt || "无"}」可能导致文件无法正确解析,确定吗?`,
        confirmText: "确定",
        severity: "danger",
      })
      if (!accepted) return "refocus"
    }
    const targetPath = siblingWorkspacePath(entry.path, nextName)
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
      if (activeSearchQuery.value) await runSearch()
      return "done"
    } catch (error) {
      feedback.value = error instanceof Error ? error.message : "无法重命名工作区路径。"
      return "refocus"
    }
  }

  async function createNewFile(): Promise<WorkspaceEntry | null> {
    if (!canCreateHere()) return null
    const name = uniqueWorkspaceName("新建文件", ".txt", currentEntryNames())
    const path = currentPath.value ? `${currentPath.value}/${name}` : name
    try {
      await writePlatformWorkspaceFile({
        ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
        path,
        content: "",
      })
      emitWorkspaceContentChanged({ cardId: selectedCardId.value, path })
      await refreshDirectory()
      const created = directoryEntries.value.find((entry) => entry.path === path) ?? null
      if (created) enterRename(created, "stem")
      return created
    } catch (error) {
      feedback.value = error instanceof Error ? error.message : "无法新建文件。"
      return null
    }
  }
  async function createNewFolder(): Promise<WorkspaceEntry | null> {
    if (!canCreateHere()) return null
    const name = uniqueWorkspaceName("新文件夹", "", currentEntryNames())
    const dirPath = currentPath.value ? `${currentPath.value}/${name}` : name
    const keepPath = `${dirPath}/.keep`
    try {
      await writePlatformWorkspaceFile({
        ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
        path: keepPath,
        content: "",
      })
      emitWorkspaceContentChanged({ cardId: selectedCardId.value, path: keepPath })
      await refreshDirectory()
      const created = directoryEntries.value.find((entry) => entry.path === dirPath) ?? null
      if (created) enterRename(created, "stem")
      return created
    } catch (error) {
      feedback.value = error instanceof Error ? error.message : "无法新建文件夹。"
      return null
    }
  }

  async function runSearch(): Promise<void> {
    if (!isBrowsing.value) return
    const query = searchInput.value.trim()
    if (!query) {
      clearSearch()
      return
    }
    const requestId = ++searchRequestId
    activeSearchQuery.value = query
    searchLoading.value = true
    errorMessage.value = ""
    try {
      const results = await searchPlatformWorkspace({
        ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
        query,
        path: currentPath.value || undefined,
        limit: 100,
      })
      if (requestId === searchRequestId) searchResults.value = results
    } catch (error) {
      if (requestId === searchRequestId) {
        searchResults.value = []
        errorMessage.value = error instanceof Error ? error.message : "无法搜索工作区。"
      }
    } finally {
      if (requestId === searchRequestId) searchLoading.value = false
    }
  }
  function clearSearch(): void {
    activeSearchQuery.value = ""
    searchResults.value = []
    searchLoading.value = false
    errorMessage.value = ""
    searchRequestId += 1
  }

  function openFile(path: string): void {
    if (!isBrowsing.value) return
    const mediaType = inferMediaTypeFromPath(path)
    const media = mediaType !== "image/svg+xml"
      && (isImageMediaType(mediaType) || isAudioMediaType(mediaType) || isVideoMediaType(mediaType))
    void router.push({
      name: media ? "workspace-media" : "workspace-editor",
      query: {
        ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
        path,
        ...(!media ? { mode: "edit", editorId: createWorkspaceEditorSessionId() } : {}),
      },
    })
  }

  async function deleteEntry(entry: WorkspaceEntry): Promise<void> {
    if (!isBrowsing.value || !canDeleteEntry(entry)) return
    cancelRename()
    const accepted = await confirm({
      message: `删除「${entry.path}」？`,
      severity: "danger",
      confirmText: "删除",
    })
    if (!accepted) return
    try {
      const result = await deletePlatformWorkspacePath({
        ...(selectedCardId.value ? { cardId: selectedCardId.value } : {}),
        path: entry.path,
      })
      feedback.value = `已删除 ${result.deletedPaths.length} 项。`
      selectedEntryPath.value = ""
      await refreshDirectory()
      if (activeSearchQuery.value) await runSearch()
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "无法删除工作区路径。"
    }
  }
  function copyEntry(entry: WorkspaceEntry): void {
    if (!isBrowsing.value || !canCopyEntry(entry)) return
    clipboard.value = {
      kind: "copy",
      sourcePath: entry.path,
      sourceName: entry.name,
      ...(selectedCardId.value ? { sourceCardId: selectedCardId.value } : {}),
      isDirectory: entry.kind === "directory",
    }
    feedback.value = `已复制：${entry.name}`
  }
  function cutEntry(entry: WorkspaceEntry): void {
    if (!isBrowsing.value || !canModifyEntry(entry)) return
    clipboard.value = {
      kind: "cut",
      sourcePath: entry.path,
      sourceName: entry.name,
      ...(selectedCardId.value ? { sourceCardId: selectedCardId.value } : {}),
      isDirectory: entry.kind === "directory",
    }
    feedback.value = `已剪切：${entry.name}`
  }
  async function pasteFromClipboard(): Promise<void> {
    const entry = clipboard.value
    if (!entry || !canPasteHere()) return
    const { base, ext } = splitWorkspaceNameExtension(entry.sourceName)
    const currentDirTarget = currentPath.value
      ? `${currentPath.value}/${entry.sourceName}`
      : entry.sourceName
    if (entry.kind === "cut"
      && siblingWorkspacePath(entry.sourcePath, entry.sourceName) === currentDirTarget) {
      clipboard.value = null
      return
    }
    const targetBase = entry.kind === "copy" ? `${base} - 副本` : base
    const targetName = uniqueWorkspaceName(targetBase, ext, currentEntryNames())
    const targetPath = currentPath.value ? `${currentPath.value}/${targetName}` : targetName
    try {
      if (entry.kind === "cut") {
        await movePlatformWorkspacePath({
          ...(entry.sourceCardId ? { cardId: entry.sourceCardId } : {}),
          ...(selectedCardId.value ? { targetCardId: selectedCardId.value } : {}),
          path: entry.sourcePath,
          targetPath,
        })
        clipboard.value = null
        feedback.value = `已移动：${entry.sourceName} → ${targetName}`
      } else {
        await copyPlatformWorkspacePath({
          ...(entry.sourceCardId ? { cardId: entry.sourceCardId } : {}),
          ...(selectedCardId.value ? { targetCardId: selectedCardId.value } : {}),
          path: entry.sourcePath,
          targetPath,
        })
        feedback.value = `已粘贴：${targetName}`
      }
      emitWorkspaceContentChanged({ cardId: selectedCardId.value, path: targetPath })
      await refreshDirectory()
      if (activeSearchQuery.value) await runSearch()
    } catch (error) {
      feedback.value = error instanceof Error ? error.message : "无法粘贴。"
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (route.name !== "workspace") return
    if (event.key === "Escape") {
      cancelRename()
      return
    }
    if (isEditableWorkspaceKeyboardTarget(event.target)) return
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
    if (!event.ctrlKey && !event.metaKey) return
    const key = event.key.toLowerCase()
    if (key === "c" && selectedEntry.value) {
      event.preventDefault()
      copyEntry(selectedEntry.value)
    } else if (key === "x" && selectedEntry.value) {
      event.preventDefault()
      cutEntry(selectedEntry.value)
    } else if (key === "v" && canPasteHere()) {
      event.preventDefault()
      void pasteFromClipboard()
    }
  }

  function onWorkspaceContentChanged(event: Event): void {
    if (!isWorkspaceContentChangedEvent(event) || event.detail.cardId !== selectedCardId.value) return
    feedback.value = `已更新：${event.detail.path}`
    void refreshDirectory()
    if (activeSearchQuery.value) void runSearch()
  }

  watch(() => route.fullPath, () => {
    if (route.name !== "workspace") return
    syncStateFromRoute()
    if (isBrowsing.value) void refreshDirectory()
    else resetDirectoryState()
  }, { immediate: true })

  onMounted(() => {
    window.addEventListener(WORKSPACE_CONTENT_CHANGED_EVENT, onWorkspaceContentChanged)
    void refreshRoots()
  })
  onBeforeUnmount(() => {
    rootsRequestId += 1
    directoryRequestId += 1
    searchRequestId += 1
    window.removeEventListener(WORKSPACE_CONTENT_CHANGED_EVENT, onWorkspaceContentChanged)
  })

  return {
    workspaceRoots,
    selectedRootCardId,
    selectedRootKind,
    selectedCardId,
    currentPath,
    directoryEntries,
    currentDirectoryReadOnly,
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
    refreshRoots,
    refreshDirectory,
    refreshCurrentView,
    selectRoot,
    openRoot,
    returnToRoot,
    openPath,
    activateEntry,
    startRenameEntry,
    cancelRename,
    commitRename,
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
  }
}
