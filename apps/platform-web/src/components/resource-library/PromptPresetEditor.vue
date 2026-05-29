<template>
  <div class="flex h-full font-mono">
    <!-- Left panel: entry list -->
    <div class="flex w-80 shrink-0 flex-col border-r border-neon-muted/30 bg-void/40">
      <!-- Header -->
      <div class="border-b border-neon-muted/30 px-4 py-3">
        <p class="font-mono text-xs uppercase tracking-[0.25em] text-neon-muted">
          ENTRIES // {{ localPreset.prompts.length }}
        </p>
      </div>

      <!-- Scrollable entry list -->
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          v-for="(entry, index) in sortedEntries"
          :key="entry.identifier"
          type="button"
          draggable="true"
          class="mb-2 flex w-full items-center gap-2 border px-3 py-2 text-left transition-colors"
          :class="selectedId === entry.identifier
            ? 'border-neon bg-neon/10 glow-box'
            : 'border-neon-muted/30 bg-panel hover:border-neon-muted/70'"
          @click="selectedId = entry.identifier"
          @dragstart="onDragStart($event, index)"
          @dragover.prevent
          @drop="onDrop($event, index)"
        >
          <!-- Drag handle -->
          <span class="shrink-0 cursor-grab text-sm text-neon-muted/50 select-none">
            &#9776;
          </span>

          <!-- Name -->
          <span class="min-w-0 flex-1 truncate text-xs text-text-main">
            {{ entry.name || entry.identifier }}
          </span>

          <!-- Role badge -->
          <span class="shrink-0 border border-neon-deep/30 bg-void px-2 py-0.5 text-[10px] uppercase text-neon-muted">
            {{ entry.role }}
          </span>

          <!-- ON/OFF indicator -->
          <span
            class="shrink-0 text-[10px] uppercase"
            :class="entry.enabled ? 'text-neon' : 'text-danger/60'"
          >
            {{ entry.enabled ? 'ON' : 'OFF' }}
          </span>
        </button>

        <!-- Empty list -->
        <div v-if="sortedEntries.length === 0" class="grid min-h-40 place-items-center">
          <p class="text-xs uppercase tracking-[0.25em] text-neon-muted">NO ENTRIES</p>
        </div>
      </div>

      <!-- Add entry button (sticky bottom) -->
      <div class="border-t border-neon-muted/30 p-3">
        <button
          type="button"
          class="w-full border border-neon bg-neon/10 px-4 py-2 text-xs uppercase tracking-wider text-neon transition-colors hover:bg-neon/20"
          @click="addEntry"
        >
          + 添加条目
        </button>
      </div>
    </div>

    <!-- Right panel: edit form -->
    <div class="flex min-w-0 flex-1 flex-col bg-void/40">
      <!-- Empty state -->
      <div v-if="!selectedEntry" class="grid h-full place-items-center text-center">
        <div class="grid gap-2">
          <p class="text-xs uppercase tracking-[0.3em] text-neon-muted">NO SELECTION</p>
          <p class="text-sm text-text-dim">选择左侧条目进行编辑</p>
        </div>
      </div>

      <!-- Edit form -->
      <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
        <!-- Row 1: identifier + name -->
        <div class="grid grid-cols-2 gap-4">
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            identifier
            <input
              :value="selectedEntry.identifier"
              type="text"
              readonly
              class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-dim outline-none opacity-60"
            />
          </label>
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            name
            <input
              :value="selectedEntry.name"
              type="text"
              class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @input="updateField('name', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </div>

        <!-- Row 2: role, position, depth, order -->
        <div class="mt-4 grid grid-cols-4 gap-4">
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            role
            <select
              :value="selectedEntry.role"
              class="appearance-none border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @change="updateField('role', ($event.target as HTMLSelectElement).value)"
            >
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="model">model</option>
            </select>
          </label>
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            position
            <select
              :value="selectedEntry.position"
              class="appearance-none border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @change="updateField('position', ($event.target as HTMLSelectElement).value)"
            >
              <option value="relative">relative</option>
              <option value="fixed">fixed</option>
            </select>
          </label>
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            depth
            <input
              :value="selectedEntry.depth"
              type="number"
              min="0"
              class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @input="updateField('depth', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            order
            <input
              :value="selectedEntry.order"
              type="number"
              min="0"
              class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @input="updateField('order', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </div>

        <!-- Row 3: enabled -->
        <div class="mt-4">
          <label class="inline-flex cursor-pointer items-center gap-3 text-xs uppercase tracking-wider text-text-dim">
            <input
              type="checkbox"
              :checked="selectedEntry.enabled"
              class="h-4 w-4 accent-[var(--color-neon)]"
              @change="updateField('enabled', ($event.target as HTMLInputElement).checked)"
            />
            enabled
          </label>
        </div>

        <!-- Content textarea -->
        <div class="mt-4 flex min-h-0 flex-1 flex-col gap-2">
          <label class="text-xs uppercase tracking-wider text-text-dim">
            content
          </label>
          <textarea
            :value="selectedEntry.content"
            class="min-h-[300px] flex-1 resize-y border border-neon-muted/40 bg-panel px-3 py-2 text-xs normal-case tracking-normal text-text-main outline-none focus:border-neon"
            spellcheck="false"
            @input="updateField('content', ($event.target as HTMLTextAreaElement).value)"
          />
        </div>

        <!-- Delete entry button -->
        <div class="mt-4 border-t border-neon-muted/30 pt-4">
          <button
            type="button"
            class="border border-danger/50 bg-danger/10 px-4 py-2 text-xs uppercase tracking-wider text-danger transition-colors hover:bg-danger/20"
            @click="deleteEntry(selectedEntry.identifier)"
          >
            删除此条目
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"

import type { PromptPreset, PromptPresetEntry } from "@tsian/contracts"

const props = defineProps<{ preset: PromptPreset }>()
const emit = defineEmits<{ change: [preset: PromptPreset] }>()

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

const localPreset = ref<PromptPreset>(deepClone(props.preset))
const selectedId = ref<string | null>(null)

// Drag state
let dragSourceIndex: number | null = null

watch(
  () => props.preset,
  (newVal) => {
    localPreset.value = deepClone(newVal)
    // Reset selection if the selected entry no longer exists
    if (selectedId.value && !localPreset.value.prompts.some(e => e.identifier === selectedId.value)) {
      selectedId.value = null
    }
  },
  { deep: true }
)

const sortedEntries = computed(() =>
  [...localPreset.value.prompts].sort((a, b) => a.order - b.order)
)

const selectedEntry = computed(() => {
  if (!selectedId.value) return null
  return localPreset.value.prompts.find(e => e.identifier === selectedId.value) ?? null
})

function emitChange() {
  emit("change", deepClone(localPreset.value))
}

function updateField(field: string, value: any) {
  if (!selectedId.value) return
  const entry = localPreset.value.prompts.find(e => e.identifier === selectedId.value)
  if (!entry) return
  ;(entry as any)[field] = value
  emitChange()
}

function addEntry() {
  const maxOrder = localPreset.value.prompts.reduce((max, e) => Math.max(max, e.order), -1)
  const newEntry: PromptPresetEntry = {
    identifier: `entry-${Date.now()}`,
    name: "新条目",
    role: "system",
    content: "",
    enabled: true,
    depth: 0,
    order: maxOrder + 1,
    position: "relative",
    trigger: [],
  }
  localPreset.value.prompts.push(newEntry)
  selectedId.value = newEntry.identifier
  emitChange()
}

function deleteEntry(identifier: string) {
  const index = localPreset.value.prompts.findIndex(e => e.identifier === identifier)
  if (index < 0) return
  localPreset.value.prompts.splice(index, 1)
  if (selectedId.value === identifier) {
    selectedId.value = localPreset.value.prompts.length > 0
      ? localPreset.value.prompts[0].identifier
      : null
  }
  emitChange()
}

// HTML5 native drag-and-drop for reorder
function onDragStart(event: DragEvent, index: number) {
  dragSourceIndex = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", String(index))
  }
}

function onDrop(_event: DragEvent, targetIndex: number) {
  if (dragSourceIndex === null || dragSourceIndex === targetIndex) return

  // Work on sortedEntries order: swap the two entries' order values
  const sorted = [...localPreset.value.prompts].sort((a, b) => a.order - b.order)
  const sourceEntry = sorted[dragSourceIndex]
  const targetEntry = sorted[targetIndex]
  if (!sourceEntry || !targetEntry) return

  // Find them in the actual array and swap order values
  const srcInPrompts = localPreset.value.prompts.find(e => e.identifier === sourceEntry.identifier)
  const tgtInPrompts = localPreset.value.prompts.find(e => e.identifier === targetEntry.identifier)
  if (!srcInPrompts || !tgtInPrompts) return

  const tmpOrder = srcInPrompts.order
  srcInPrompts.order = tgtInPrompts.order
  tgtInPrompts.order = tmpOrder

  dragSourceIndex = null
  emitChange()
}
</script>
