<template>
  <div class="flex h-full font-mono">
    <!-- Left panel: entry list -->
    <div class="flex w-80 shrink-0 flex-col border-r border-neon-muted/30 bg-void/40">
      <!-- Header -->
      <div class="border-b border-neon-muted/30 px-4 py-3">
        <p class="font-mono text-xs uppercase tracking-[0.25em] text-neon-muted">
          ENTRIES // {{ localBook.entries.length }}
        </p>
      </div>

      <!-- Scrollable entry list -->
      <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <button
          v-for="(entry, idx) in sortedEntries"
          :key="entry.index"
          type="button"
          draggable="true"
          class="mb-2 flex w-full items-center gap-2 border px-3 py-2 text-left transition-colors"
          :class="selectedIndex === entry.index
            ? 'border-neon bg-neon/10 glow-box'
            : 'border-neon-muted/30 bg-panel hover:border-neon-muted/70'"
          @click="selectedIndex = entry.index"
          @dragstart="onDragStart($event, idx)"
          @dragover.prevent
          @drop="onDrop($event, idx)"
        >
          <!-- Drag handle -->
          <span class="shrink-0 cursor-grab text-sm text-neon-muted/50 select-none">
            &#9776;
          </span>

          <!-- Name -->
          <span class="min-w-0 flex-1 truncate text-xs text-text-main">
            {{ entry.name || `#${entry.index}` }}
          </span>

          <!-- Activation mode badge -->
          <span
            class="shrink-0 border px-2 py-0.5 text-[10px] uppercase"
            :class="activationBadgeClass(entry.activationMode)"
          >
            {{ entry.activationMode }}
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

      <!-- Add entry button -->
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
        <!-- Section 1: Basic info -->
        <p class="mb-3 border-b border-neon-muted/30 pb-2 text-xs uppercase tracking-[0.2em] text-neon-muted">
          基本信息
        </p>
        <div class="grid grid-cols-[1fr_80px_auto] gap-4">
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            name
            <input
              :value="selectedEntry.name"
              type="text"
              class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @input="updateField('name', ($event.target as HTMLInputElement).value)"
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
          <label class="flex items-end gap-2 pb-2 text-xs uppercase tracking-wider text-text-dim">
            <input
              type="checkbox"
              :checked="selectedEntry.enabled"
              class="h-4 w-4 accent-[var(--color-neon)]"
              @change="updateField('enabled', ($event.target as HTMLInputElement).checked)"
            />
            enabled
          </label>
        </div>

        <!-- Section 2: Activation -->
        <p class="mb-3 mt-5 border-b border-neon-muted/30 pb-2 text-xs uppercase tracking-[0.2em] text-neon-muted">
          激活条件
        </p>
        <div class="grid grid-cols-2 gap-4">
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            activation mode
            <select
              :value="selectedEntry.activationMode"
              class="appearance-none border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @change="updateField('activationMode', ($event.target as HTMLSelectElement).value)"
            >
              <option value="always">always</option>
              <option value="keyword">keyword</option>
              <option value="vector">vector</option>
            </select>
          </label>
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            probability %
            <input
              :value="selectedEntry.probability"
              type="number"
              min="0"
              max="100"
              class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @input="updateField('probability', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
        </div>

        <div class="mt-3 grid gap-4">
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            keys (comma-separated)
            <input
              :value="selectedEntry.key.join(', ')"
              type="text"
              class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              placeholder="dragon, fire, breath"
              @input="updateField('key', parseCommaSeparated(($event.target as HTMLInputElement).value))"
            />
          </label>
        </div>

        <!-- Keyword-only fields -->
        <template v-if="selectedEntry.activationMode === 'keyword'">
          <div class="mt-3 grid gap-4">
            <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
              secondary keys (comma-separated)
              <input
                :value="selectedEntry.secondaryKey.join(', ')"
                type="text"
                class="border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
                @input="updateField('secondaryKey', parseCommaSeparated(($event.target as HTMLInputElement).value))"
              />
            </label>
          </div>
          <div class="mt-3 grid grid-cols-2 gap-4">
            <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
              selective logic
              <select
                :value="selectedEntry.selectiveLogic"
                class="appearance-none border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
                @change="updateField('selectiveLogic', ($event.target as HTMLSelectElement).value)"
              >
                <option value="andAny">andAny</option>
                <option value="andAll">andAll</option>
                <option value="notAll">notAll</option>
                <option value="notAny">notAny</option>
              </select>
            </label>
            <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
              case sensitive
              <select
                :value="caseSensitiveToString(selectedEntry.caseSensitive)"
                class="appearance-none border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
                @change="updateField('caseSensitive', stringToCaseSensitive(($event.target as HTMLSelectElement).value))"
              >
                <option value="default">default</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </label>
          </div>
        </template>

        <!-- Section 3: Position -->
        <p class="mb-3 mt-5 border-b border-neon-muted/30 pb-2 text-xs uppercase tracking-[0.2em] text-neon-muted">
          插入位置
        </p>
        <div class="grid grid-cols-3 gap-4">
          <label class="grid gap-2 text-xs uppercase tracking-wider text-text-dim">
            position
            <select
              :value="selectedEntry.position"
              class="appearance-none border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @change="updateField('position', ($event.target as HTMLSelectElement).value)"
            >
              <option value="beforeChar">beforeChar</option>
              <option value="afterChar">afterChar</option>
              <option value="beforeEm">beforeEm</option>
              <option value="afterEm">afterEm</option>
              <option value="beforeAn">beforeAn</option>
              <option value="afterAn">afterAn</option>
              <option value="fixed">fixed</option>
              <option value="outlet">outlet</option>
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
          <!-- Role: only meaningful for fixed position -->
          <label
            v-if="selectedEntry.position === 'fixed'"
            class="grid gap-2 text-xs uppercase tracking-wider text-text-dim"
          >
            role
            <select
              :value="roleToString(selectedEntry.role)"
              class="appearance-none border border-neon-muted/40 bg-panel px-3 py-2 text-sm normal-case tracking-normal text-text-main outline-none focus:border-neon"
              @change="updateField('role', stringToRole(($event.target as HTMLSelectElement).value))"
            >
              <option value="none">none</option>
              <option value="system">system</option>
              <option value="user">user</option>
              <option value="model">model</option>
            </select>
          </label>
        </div>

        <!-- Section 4: Recursion -->
        <p class="mb-3 mt-5 border-b border-neon-muted/30 pb-2 text-xs uppercase tracking-[0.2em] text-neon-muted">
          递归控制
        </p>
        <div class="flex flex-wrap gap-6">
          <label class="inline-flex cursor-pointer items-center gap-3 text-xs uppercase tracking-wider text-text-dim">
            <input
              type="checkbox"
              :checked="selectedEntry.excludeRecursion"
              class="h-4 w-4 accent-[var(--color-neon)]"
              @change="updateField('excludeRecursion', ($event.target as HTMLInputElement).checked)"
            />
            exclude recursion
          </label>
          <label class="inline-flex cursor-pointer items-center gap-3 text-xs uppercase tracking-wider text-text-dim">
            <input
              type="checkbox"
              :checked="selectedEntry.preventRecursion"
              class="h-4 w-4 accent-[var(--color-neon)]"
              @change="updateField('preventRecursion', ($event.target as HTMLInputElement).checked)"
            />
            prevent recursion
          </label>
        </div>

        <!-- Section 5: Content -->
        <p class="mb-3 mt-5 border-b border-neon-muted/30 pb-2 text-xs uppercase tracking-[0.2em] text-neon-muted">
          内容
        </p>
        <div class="flex min-h-0 flex-1 flex-col">
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
            @click="deleteEntry(selectedEntry.index)"
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

import type { WorldBook, WorldBookEntry, WorldBookEntryRole } from "@tsian/contracts"

const props = defineProps<{ worldBook: WorldBook }>()
const emit = defineEmits<{ change: [worldBook: WorldBook] }>()

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

const localBook = ref<WorldBook>(deepClone(props.worldBook))
const selectedIndex = ref<number | null>(null)

// Drag state
let dragSourceIdx: number | null = null

watch(
  () => props.worldBook,
  (newVal) => {
    localBook.value = deepClone(newVal)
    if (selectedIndex.value !== null && !localBook.value.entries.some(e => e.index === selectedIndex.value)) {
      selectedIndex.value = null
    }
  },
  { deep: true }
)

const sortedEntries = computed(() =>
  [...localBook.value.entries].sort((a, b) => a.order - b.order)
)

const selectedEntry = computed(() => {
  if (selectedIndex.value === null) return null
  return localBook.value.entries.find(e => e.index === selectedIndex.value) ?? null
})

function emitChange() {
  emit("change", deepClone(localBook.value))
}

function updateField(field: string, value: any) {
  if (selectedIndex.value === null) return
  const entry = localBook.value.entries.find(e => e.index === selectedIndex.value)
  if (!entry) return
  ;(entry as any)[field] = value
  emitChange()
}

function parseCommaSeparated(text: string): string[] {
  return text.split(/[，,]/).map(s => s.trim()).filter(Boolean)
}

function caseSensitiveToString(val: boolean | null): string {
  if (val === null) return 'default'
  return String(val)
}

function stringToCaseSensitive(val: string): boolean | null {
  if (val === 'default') return null
  return val === 'true'
}

function roleToString(val: WorldBookEntryRole | null): string {
  return val ?? 'none'
}

function stringToRole(val: string): WorldBookEntryRole | null {
  if (val === 'none') return null
  return val as WorldBookEntryRole
}

function activationBadgeClass(mode: string): string {
  switch (mode) {
    case 'always': return 'border-neon/40 bg-neon/10 text-neon'
    case 'keyword': return 'border-warning/40 bg-warning/10 text-warning'
    case 'vector': return 'border-neon-deep/40 bg-neon-deep/10 text-neon-deep'
    default: return 'border-neon-muted/30 bg-void text-neon-muted'
  }
}

function addEntry() {
  const maxIndex = localBook.value.entries.reduce((max, e) => Math.max(max, e.index), -1)
  const maxOrder = localBook.value.entries.reduce((max, e) => Math.max(max, e.order), -1)
  const newEntry: WorldBookEntry = {
    index: maxIndex + 1,
    name: "新条目",
    content: "",
    enabled: true,
    activationMode: "keyword",
    key: [],
    secondaryKey: [],
    selectiveLogic: "andAny",
    order: maxOrder + 1,
    depth: 0,
    position: "beforeChar",
    role: null,
    caseSensitive: null,
    excludeRecursion: false,
    preventRecursion: false,
    probability: 100,
    other: {},
  }
  localBook.value.entries.push(newEntry)
  selectedIndex.value = newEntry.index
  emitChange()
}

function deleteEntry(entryIndex: number) {
  const idx = localBook.value.entries.findIndex(e => e.index === entryIndex)
  if (idx < 0) return
  localBook.value.entries.splice(idx, 1)
  if (selectedIndex.value === entryIndex) {
    selectedIndex.value = localBook.value.entries.length > 0
      ? localBook.value.entries[0].index
      : null
  }
  emitChange()
}

// HTML5 native drag-and-drop for reorder
function onDragStart(event: DragEvent, index: number) {
  dragSourceIdx = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", String(index))
  }
}

function onDrop(_event: DragEvent, targetIdx: number) {
  if (dragSourceIdx === null || dragSourceIdx === targetIdx) return

  const sorted = [...localBook.value.entries].sort((a, b) => a.order - b.order)
  const sourceEntry = sorted[dragSourceIdx]
  const targetEntry = sorted[targetIdx]
  if (!sourceEntry || !targetEntry) return

  const srcInEntries = localBook.value.entries.find(e => e.index === sourceEntry.index)
  const tgtInEntries = localBook.value.entries.find(e => e.index === targetEntry.index)
  if (!srcInEntries || !tgtInEntries) return

  const tmpOrder = srcInEntries.order
  srcInEntries.order = tgtInEntries.order
  tgtInEntries.order = tmpOrder

  dragSourceIdx = null
  emitChange()
}
</script>
