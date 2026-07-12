<template>
  <div class="grid gap-4">
    <div class="retro-inset relative aspect-[16/9] overflow-hidden">
      <img
        v-if="pkg.coverUrl && !coverFailed"
        :src="pkg.coverUrl"
        :alt="pkg.name"
        class="absolute inset-0 h-full w-full object-cover"
        decoding="async"
        @error="coverFailed = true"
      />
      <div v-else :class="visual.coverClass" class="absolute inset-0 grid place-items-center">
        <component :is="visual.icon" class="h-20 w-20 text-text-main/60" aria-hidden="true" />
      </div>
      <div class="pointer-events-none absolute inset-0 bg-noise opacity-30 mix-blend-overlay" aria-hidden="true" />

      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-void via-void/86 to-transparent p-5">
        <div class="max-w-3xl">
          <span
            :class="visual.accentClass"
            class="inline-flex items-center gap-1 border bg-void/60 px-2 py-1 font-mono text-[10px] uppercase tracking-wider"
          >
            <component :is="visual.icon" class="h-3 w-3" aria-hidden="true" />
            {{ visual.label }}
          </span>
          <h1 class="mt-2 text-2xl font-black leading-tight text-text-main md:text-3xl">{{ pkg.name }}</h1>
          <p class="mt-2 max-w-2xl text-sm leading-6 text-text-main/90">{{ pkg.summary }}</p>
        </div>
      </div>
    </div>

    <template v-if="!editing">
      <div class="flex flex-wrap items-center gap-3 font-mono text-[11px] text-text-dim">
        <span class="flex items-center gap-1">
          <PenLine class="h-3.5 w-3.5" aria-hidden="true" />
          {{ pkg.resourceAuthor || "未知作者" }}
        </span>
        <span v-if="pkg.resourceVersion" class="flex items-center gap-1">
          <Tag class="h-3.5 w-3.5" aria-hidden="true" />
          v{{ pkg.resourceVersion }}
        </span>
        <span class="flex items-center gap-1">
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          {{ pkg.downloadCount }} 次下载
        </span>
        <span>{{ formatDate(pkg.createdAt) }}</span>
        <span v-if="pkg.updatedAt && pkg.updatedAt !== pkg.createdAt">更新 {{ formatDate(pkg.updatedAt) }}</span>
      </div>

      <div v-if="pkg.tags.length > 0" class="flex flex-wrap gap-1">
        <span
          v-for="tag in pkg.tags"
          :key="tag"
          class="border border-neon-deep/30 bg-neon/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-muted transition-colors hover:text-neon"
        >
          #{{ tag }}
        </span>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-4 font-mono text-xs"
          :disabled="installing"
          @click="$emit('install', pkg)"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          {{ installing ? "安装中…" : "下载并安装" }}
        </button>
      </div>

      <section v-if="canManage" class="border border-neon-deep/35 bg-elevated/45 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">你的发布物</p>
            <p class="mt-1 text-xs text-text-dim">管理这个创意工坊资源。</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
              @click="startEditing"
            >
              <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
              编辑发布
            </button>
            <button
              type="button"
              class="retro-focus inline-flex h-8 items-center gap-2 border border-danger/50 bg-danger/10 px-3 font-mono text-xs text-danger transition-colors hover:border-danger disabled:opacity-50"
              :disabled="deleting"
              @click="$emit('delete', pkg)"
            >
              <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
              {{ deleting ? "删除中…" : "删除" }}
            </button>
          </div>
        </div>
      </section>
    </template>

    <form v-else class="grid gap-4 border border-neon-deep/35 bg-elevated/45 p-3" @submit.prevent="submitEdit">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon-muted">编辑发布</p>
          <p class="mt-1 text-xs text-text-dim">{{ pkg.resourceId }}</p>
        </div>
        <button
          type="button"
          class="retro-focus inline-flex h-7 items-center gap-1.5 border border-neon-deep/40 px-2 font-mono text-[11px] text-text-dim hover:border-neon/50 hover:text-neon"
          :disabled="updating"
          @click="cancelEditing"
        >
          <X class="h-3 w-3" aria-hidden="true" />
          取消
        </button>
      </div>

      <div class="grid gap-3 md:grid-cols-2">
        <label class="grid gap-1 text-xs text-text-dim">
          标题
          <input
            v-model="draft.title"
            required
            type="text"
            class="retro-focus retro-select-surface h-8 border border-neon-deep/45 bg-elevated px-2 text-sm text-text-main"
            @input="markDirty('title')"
          />
        </label>
        <label class="grid gap-1 text-xs text-text-dim">
          版本
          <input
            v-if="hasReplacement"
            v-model="draft.version"
            required
            type="text"
            class="retro-focus retro-select-surface h-8 border border-neon-deep/45 bg-elevated px-2 font-mono text-sm text-text-main"
            @input="markDirty('version')"
          />
          <span v-else class="flex h-8 items-center border border-neon-deep/30 bg-void/30 px-2 font-mono text-sm text-text-main">
            v{{ pkg.resourceVersion || "未标记" }}
          </span>
        </label>
        <label class="grid gap-1 text-xs text-text-dim">
          作者
          <input
            v-model="draft.author"
            type="text"
            class="retro-focus retro-select-surface h-8 border border-neon-deep/45 bg-elevated px-2 text-sm text-text-main"
            @input="markDirty('author')"
          />
        </label>
        <label class="grid gap-1 text-xs text-text-dim">
          Tags
          <input
            v-model="draft.tags"
            type="text"
            class="retro-focus retro-select-surface h-8 border border-neon-deep/45 bg-elevated px-2 font-mono text-sm text-text-main"
            placeholder="tool, narrative"
          />
        </label>
        <label class="grid gap-1 text-xs text-text-dim md:col-span-2">
          简介
          <textarea
            v-model="draft.summary"
            required
            rows="4"
            class="retro-focus retro-select-surface resize-none border border-neon-deep/45 bg-elevated px-2 py-2 text-sm leading-6 text-text-main"
            @input="markDirty('summary')"
          />
        </label>
      </div>

      <div class="grid gap-2 border border-neon-deep/30 bg-void/30 p-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p class="font-mono text-[11px] uppercase tracking-wider text-text-dim">资源包</p>
            <p class="mt-1 text-xs text-text-dim">当前资源：{{ visual.label }} · {{ pkg.resourceId }}</p>
          </div>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            :disabled="updating"
            @click="$emit('select-replacement', pkg)"
          >
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            {{ replacementLabel ? "重新选择" : "选择资源以替换" }}
          </button>
        </div>
        <div v-if="replacementLabel" class="flex flex-wrap items-center justify-between gap-2 border border-neon/30 bg-neon/10 px-3 py-2">
          <span class="min-w-0 truncate text-xs text-neon">将替换为：{{ replacementLabel }}</span>
          <button
            type="button"
            class="retro-focus font-mono text-[11px] text-text-dim hover:text-neon"
            :disabled="updating"
            @click="$emit('clear-replacement')"
          >
            清除选择
          </button>
        </div>
      </div>

      <p v-if="editError" class="border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{{ editError }}</p>

      <div class="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          class="retro-focus inline-flex h-8 items-center gap-2 border border-neon-deep/40 px-3 font-mono text-xs text-text-dim hover:border-neon/50 hover:text-neon"
          :disabled="updating"
          @click="cancelEditing"
        >
          取消
        </button>
        <button
          type="submit"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="updating"
        >
          <Save class="h-3.5 w-3.5" aria-hidden="true" />
          {{ updating ? "保存中…" : "保存发布" }}
        </button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import type { MarketPackage } from "@tsian/contracts"
import { computed, reactive, ref, watch } from "vue"
import { Download, Pencil, PenLine, RefreshCw, Save, Tag, Trash2, X } from "lucide-vue-next"
import { getResourceTypeVisual } from "./resource-type-visual"
import type { MarketUploadMetadata } from "./types"

const props = defineProps<{
  pkg: MarketPackage
  installing: boolean
  canManage: boolean
  updating: boolean
  deleting: boolean
  replacementLabel: string
  replacementDefaults: MarketUploadMetadata | null
  saveToken: number
}>()

const emit = defineEmits<{
  install: [pkg: MarketPackage]
  "start-edit": [pkg: MarketPackage]
  "cancel-edit": []
  "select-replacement": [pkg: MarketPackage]
  "clear-replacement": []
  "save-edit": [metadata: Required<MarketUploadMetadata>]
  delete: [pkg: MarketPackage]
}>()

interface EditDraft {
  title: string
  version: string
  author: string
  summary: string
  tags: string
}

type DirtyField = "title" | "version" | "author" | "summary"

const visual = computed(() => getResourceTypeVisual(props.pkg.resourceType))
const hasReplacement = computed(() => Boolean(props.replacementLabel))
const coverFailed = ref(false)
const editing = ref(false)
const editError = ref("")
const draft = reactive<EditDraft>({ title: "", version: "", author: "", summary: "", tags: "" })
const dirty = reactive<Record<DirtyField, boolean>>({ title: false, version: false, author: false, summary: false })

watch(() => props.pkg.id, () => {
  coverFailed.value = false
  editing.value = false
  resetDraft()
})

watch(() => props.saveToken, () => {
  if (editing.value) {
    editing.value = false
    resetDraft()
  }
})

watch(() => props.replacementDefaults, (defaults) => {
  if (!editing.value) {
    return
  }
  if (!defaults) {
    draft.version = props.pkg.resourceVersion
    dirty.version = false
    return
  }
  applyDefaults(defaults)
})

function startEditing(): void {
  resetDraft()
  editing.value = true
  emit("start-edit", props.pkg)
}

function cancelEditing(): void {
  editing.value = false
  editError.value = ""
  emit("cancel-edit")
}

function resetDraft(): void {
  draft.title = props.pkg.name
  draft.version = props.pkg.resourceVersion
  draft.author = props.pkg.resourceAuthor
  draft.summary = props.pkg.summary
  draft.tags = props.pkg.tags.join(", ")
  for (const field of Object.keys(dirty) as DirtyField[]) {
    dirty[field] = false
  }
  editError.value = ""
}

function markDirty(field: DirtyField): void {
  dirty[field] = true
}

function applyDefaults(defaults: MarketUploadMetadata): void {
  if (!dirty.title && defaults.title !== undefined) {
    draft.title = defaults.title
  }
  if (!dirty.version && defaults.version !== undefined) {
    draft.version = defaults.version
  }
  if (!dirty.author && defaults.author !== undefined) {
    draft.author = defaults.author
  }
  if (!dirty.summary && defaults.summary !== undefined) {
    draft.summary = defaults.summary
  }
}

function submitEdit(): void {
  const metadata = {
    title: draft.title.trim(),
    version: draft.version.trim(),
    author: draft.author.trim(),
    summary: draft.summary.trim(),
    tags: draft.tags.trim(),
  }
  if (!metadata.title) {
    editError.value = "标题不能为空。"
    return
  }
  if (hasReplacement.value && !metadata.version) {
    editError.value = "版本不能为空。"
    return
  }
  if (!metadata.summary) {
    editError.value = "简介不能为空。"
    return
  }
  editError.value = ""
  emit("save-edit", metadata)
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso))
}
</script>
