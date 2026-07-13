<template>
  <article class="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border border-neon-deep/30 bg-elevated/45 p-2 transition-colors hover:border-neon/45 hover:bg-elevated/70">
    <GripVertical class="context-drag-handle h-4 w-4 cursor-grab text-text-dim/70 active:cursor-grabbing" aria-hidden="true" />
    <div class="min-w-0">
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <span class="border px-1.5 py-0.5 font-mono text-[10px] uppercase" :class="roleBadgeClass(entry.role)">
          {{ roleLabel(entry.role) }}
        </span>
        <span class="border border-neon-deep/35 bg-void/35 px-1.5 py-0.5 font-mono text-[10px] text-neon-muted">
          {{ entry.kind === "path" ? "引用文件" : "内联文本" }}
        </span>
        <span v-if="entry.originalWasString && !entry.modified" class="font-mono text-[10px] text-text-dim/70">
          兼容
        </span>
      </div>
      <p class="mt-1 truncate font-mono text-[11px] text-text-main">{{ editableEntrySummary(entry) }}</p>
    </div>
    <div class="flex items-center gap-1">
      <button
        type="button"
        class="retro-focus grid h-8 w-8 place-items-center border border-neon-deep/40 bg-panel text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
        title="编辑条目"
        :aria-label="`编辑 ${editableEntrySummary(entry)}`"
        @click="$emit('edit', entry)"
      >
        <Pencil class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="retro-focus grid h-8 w-8 place-items-center border border-neon-deep/40 bg-panel text-text-dim transition-colors hover:border-danger/55 hover:text-danger"
        title="删除条目"
        :aria-label="`删除 ${editableEntrySummary(entry)}`"
        @click="$emit('delete', entry)"
      >
        <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  </article>
</template>

<script setup lang="ts">
import { GripVertical, Pencil, Trash2 } from "lucide-vue-next"
import type { EditableContextPathEntry } from "./message-sequence"
import {
  editableEntrySummary,
  roleBadgeClass,
  roleLabel,
} from "./message-sequence"

defineProps<{
  entry: EditableContextPathEntry
}>()

defineEmits<{
  (event: "edit", entry: EditableContextPathEntry): void
  (event: "delete", entry: EditableContextPathEntry): void
}>()
</script>
