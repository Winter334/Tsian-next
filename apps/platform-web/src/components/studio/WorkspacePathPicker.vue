<template>
  <article
    v-if="open"
    class="grid max-h-[52vh] min-h-[320px] grid-rows-[auto_minmax(0,1fr)_auto] border border-neon-deep/35 bg-panel/55"
  >
    <header class="grid gap-2 border-b border-neon-deep/25 p-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-mono text-[11px] uppercase tracking-wider text-text-dim">{{ title || defaultTitle }}</p>
          <p class="mt-1 truncate font-mono text-xs font-bold text-text-main">{{ currentPath || "workspace 根目录" }}</p>
          <p class="mt-1 text-xs text-text-dim">单击选择，双击打开目录或确认文件。</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-45"
            :disabled="!currentPath || loading"
            @click="goParent"
          >
            <ChevronLeft class="h-3 w-3" aria-hidden="true" />
            上一级
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-45"
            :disabled="loading"
            @click="refresh"
          >
            <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': loading }" aria-hidden="true" />
            刷新
          </button>
        </div>
      </div>

      <p v-if="error" class="font-mono text-[11px] text-danger">{{ error }}</p>
    </header>

    <div class="min-h-0 overflow-auto">
      <div v-if="loading" class="grid min-h-48 place-items-center p-8 text-sm text-text-dim">
        正在读取目录…
      </div>

      <div v-else-if="entries.length > 0" class="grid divide-y divide-neon-deep/20">
        <button
          v-for="entry in entries"
          :key="entry.path"
          type="button"
          class="retro-focus grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-elevated/45"
          :class="selectedPath === entry.path ? 'bg-elevated/65 text-neon' : ''"
          @click="selectEntry(entry)"
          @dblclick="activateEntry(entry)"
          @keydown.enter.prevent="activateEntry(entry)"
        >
          <FolderOpen v-if="entry.kind === 'directory'" class="h-4 w-4 text-neon" aria-hidden="true" />
          <FileText v-else class="h-4 w-4 text-text-dim" aria-hidden="true" />
          <span class="min-w-0">
            <span class="block truncate text-sm font-bold text-text-main">{{ entry.name }}</span>
            <span class="mt-0.5 block truncate font-mono text-[11px] text-text-dim/80">{{ entry.path }}</span>
          </span>
          <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
            {{ entryHint(entry) }}
          </span>
        </button>
      </div>

      <p v-else class="p-8 text-center text-sm text-text-dim">
        当前目录没有可显示的文件或文件夹。
      </p>
    </div>

    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-neon-deep/25 p-3">
      <p class="min-w-0 truncate font-mono text-[11px] text-text-dim">
        已选：<span class="text-text-main">{{ selectedPath || "未选择" }}</span>
      </p>
      <div class="flex flex-wrap gap-2">
        <button
          v-if="selectedEntry?.kind === 'directory'"
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
          @click="enterDirectory(selectedEntry.path)"
        >
          打开目录
        </button>
        <button type="button" class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs" @click="close">
          取消
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs disabled:opacity-45"
          :disabled="!canConfirmSelection"
          @click="confirmSelection"
        >
          选择
        </button>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import type { WorkspaceEntry } from "@tsian/contracts"
import { computed, ref, watch } from "vue"
import { ChevronLeft, FileText, FolderOpen, RefreshCw } from "lucide-vue-next"
import { listPlatformWorkspaceDirectory } from "@/platform-host"

const props = defineProps<{
  open: boolean
  cardId: string
  mode: "file" | "directory"
  title?: string
  initialPath?: string
}>()

const emit = defineEmits<{
  (event: "update:open", value: boolean): void
  (event: "select", path: string): void
}>()

const currentPath = ref("")
const selectedPath = ref("")
const rawEntries = ref<WorkspaceEntry[]>([])
const loading = ref(false)
const error = ref("")
let requestId = 0

const defaultTitle = computed(() => props.mode === "file" ? "选择 workspace 文件" : "选择 workspace 目录")
const entries = computed(() => rawEntries.value
  .filter((entry) => entry.name !== ".keep")
  .sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1
    }
    return a.path.localeCompare(b.path)
  }))
const selectedEntry = computed(() => entries.value.find((entry) => entry.path === selectedPath.value) ?? null)
const canConfirmSelection = computed(() => {
  if (props.mode === "file") {
    return selectedEntry.value?.kind === "file"
  }
  return Boolean(selectedPath.value) && (selectedEntry.value?.kind === "directory" || selectedPath.value === currentPath.value)
})

watch(
  () => [props.open, props.cardId, props.initialPath, props.mode] as const,
  ([open]) => {
    if (!open) {
      rawEntries.value = []
      selectedPath.value = ""
      loading.value = false
      error.value = ""
      requestId += 1
      return
    }
    currentPath.value = normalizeDirectoryPath(props.initialPath ?? "")
    selectedPath.value = props.mode === "directory" ? currentPath.value : ""
    void refresh()
  },
  { immediate: true },
)

function normalizeDirectoryPath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")
}

function close(): void {
  emit("update:open", false)
}

function parentDirectory(path: string): string {
  const parts = normalizeDirectoryPath(path).split("/").filter(Boolean)
  parts.pop()
  return parts.join("/")
}

function goParent(): void {
  if (!currentPath.value) {
    return
  }
  currentPath.value = parentDirectory(currentPath.value)
  selectedPath.value = props.mode === "directory" ? currentPath.value : ""
  void refresh()
}

function enterDirectory(path: string): void {
  currentPath.value = normalizeDirectoryPath(path)
  selectedPath.value = props.mode === "directory" ? currentPath.value : ""
  void refresh()
}

function selectEntry(entry: WorkspaceEntry): void {
  selectedPath.value = entry.path
}

function activateEntry(entry: WorkspaceEntry): void {
  if (entry.kind === "directory") {
    enterDirectory(entry.path)
    return
  }
  if (props.mode === "file") {
    selectPath(entry.path)
  }
}

function entryHint(entry: WorkspaceEntry): string {
  if (entry.kind === "directory") {
    return props.mode === "directory" ? "可选 / 打开" : "打开"
  }
  return props.mode === "file" ? "可选" : "文件"
}

function confirmSelection(): void {
  if (!canConfirmSelection.value) {
    return
  }
  selectPath(selectedPath.value)
}

function selectPath(path: string): void {
  emit("select", normalizeDirectoryPath(path))
  emit("update:open", false)
}

function syncSelectionAfterRefresh(nextEntries: WorkspaceEntry[]): void {
  if (props.mode === "directory") {
    const selectedStillVisible = nextEntries.some((entry) => entry.kind === "directory" && entry.path === selectedPath.value)
    if (!selectedPath.value || (!selectedStillVisible && selectedPath.value !== currentPath.value)) {
      selectedPath.value = currentPath.value
    }
    return
  }

  const selectedFileStillVisible = nextEntries.some((entry) => entry.kind === "file" && entry.path === selectedPath.value)
  if (!selectedFileStillVisible) {
    selectedPath.value = ""
  }
}

async function refresh(): Promise<void> {
  if (!props.open || !props.cardId) {
    return
  }
  const currentRequestId = ++requestId
  loading.value = true
  error.value = ""
  try {
    const result = await listPlatformWorkspaceDirectory({
      cardId: props.cardId,
      path: currentPath.value,
    })
    if (currentRequestId !== requestId) {
      return
    }
    currentPath.value = normalizeDirectoryPath(result.path)
    rawEntries.value = result.entries
    syncSelectionAfterRefresh(result.entries)
  } catch (e) {
    if (currentRequestId !== requestId) {
      return
    }
    rawEntries.value = []
    error.value = e instanceof Error ? e.message : "无法读取目录。"
  } finally {
    if (currentRequestId === requestId) {
      loading.value = false
    }
  }
}
</script>
