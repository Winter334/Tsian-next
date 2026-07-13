<template>
  <section class="grid gap-2 border border-neon-deep/35 bg-panel/45 p-3">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="border border-neon-deep/35 bg-panel/45 px-1.5 py-0.5 font-mono text-[10px] text-text-dim">
          插入点
        </span>
        <h3 class="text-sm font-bold text-text-main">{{ positionLabel(position) }}</h3>
        <ParamTip :label="positionLabel(position)" :tip="positionDescription(position)" />
      </div>
      <div class="flex items-center gap-2">
        <span class="border border-neon-deep/35 bg-void/35 px-2 py-1 font-mono text-[10px] text-text-dim">
          {{ entries.length }} 条
        </span>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider"
          @click="$emit('add', position)"
        >
          <Plus class="h-3 w-3" aria-hidden="true" />
          添加
        </button>
      </div>
    </div>

    <VueDraggable
      :model-value="entries"
      :group="dragGroup"
      :animation="150"
      handle=".context-drag-handle"
      ghost-class="context-row-ghost"
      class="grid content-start gap-2"
      @update:model-value="(value) => $emit('update:entries', value)"
      @end="$emit('drag-end')"
    >
      <ContextPathRow
        v-for="entry in entries"
        :key="entry.id"
        :entry="entry"
        @edit="$emit('edit', $event)"
        @delete="$emit('delete', $event)"
      />
      <p v-if="entries.length === 0" class="border border-dashed border-neon-deep/35 bg-void/25 p-3 text-center text-xs leading-5 text-text-dim">
        拖拽条目到这里，或添加新条目。
      </p>
    </VueDraggable>
  </section>
</template>

<script setup lang="ts">
import type { ContextPathPosition } from "@tsian/contracts"
import { Plus } from "lucide-vue-next"
import { VueDraggable } from "vue-draggable-plus"
import { ParamTip } from "@/components/ui/tip"
import ContextPathRow from "./ContextPathRow.vue"
import type { EditableContextPathEntry } from "./message-sequence"
import { positionDescription, positionLabel } from "./message-sequence"

defineProps<{
  position: ContextPathPosition
  entries: EditableContextPathEntry[]
}>()

defineEmits<{
  (event: "update:entries", value: EditableContextPathEntry[]): void
  (event: "add", position: ContextPathPosition): void
  (event: "edit", entry: EditableContextPathEntry): void
  (event: "delete", entry: EditableContextPathEntry): void
  (event: "drag-end"): void
}>()

const dragGroup = { name: "contextPaths", pull: true, put: true }
</script>

<style scoped>
:deep(.context-row-ghost) {
  opacity: 0.55;
  outline: 1px dashed rgba(243, 197, 109, 0.8);
}
</style>
