<template>
  <div class="grid gap-1">
    <div
      v-for="entry in sortedEntries"
      :key="entry.index"
      class="border transition-colors"
      :class="entry.enabled
        ? 'border-neon-muted/30 bg-panel'
        : 'border-neon-muted/15 bg-panel/50 opacity-50'"
    >
      <!-- Entry header (clickable) -->
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-elevated/40"
        @click="toggle(entry.index)"
      >
        <!-- Expand/collapse indicator -->
        <span
          class="shrink-0 font-mono text-[10px] text-neon-muted transition-transform"
          :class="expanded.has(entry.index) ? 'rotate-90' : ''"
        >
          >
        </span>

        <!-- Name -->
        <span class="min-w-0 flex-1 truncate font-mono text-xs text-text-main">
          {{ entry.name || `#${entry.index}` }}
        </span>

        <!-- Activation mode badge -->
        <span
          class="shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase"
          :class="activationBadgeClass(entry.activationMode)"
        >
          {{ entry.activationMode }}
        </span>

        <!-- Position + depth (compact) -->
        <span class="shrink-0 font-mono text-[10px] text-text-dim">
          {{ entry.position }}{{ entry.depth > 0 ? ` d${entry.depth}` : '' }}
        </span>

        <!-- Enabled/disabled indicator -->
        <span
          class="shrink-0 font-mono text-[10px] uppercase"
          :class="entry.enabled ? 'text-neon' : 'text-danger/60'"
        >
          {{ entry.enabled ? 'ON' : 'OFF' }}
        </span>
      </button>

      <!-- Keywords row (shown below header for keyword mode, always visible) -->
      <div
        v-if="entry.activationMode === 'keyword' && entry.key.length > 0"
        class="flex flex-wrap gap-1 border-t border-neon-muted/10 px-3 py-1.5"
      >
        <span
          v-for="(kw, kwIdx) in entry.key"
          :key="kwIdx"
          class="border border-neon-deep/30 bg-void px-2 py-0.5 font-mono text-[10px] text-neon-muted"
        >
          {{ kw }}
        </span>
      </div>

      <!-- Expanded content -->
      <div
        v-if="expanded.has(entry.index)"
        class="border-t border-neon-muted/20 bg-void/40 px-3 py-2"
      >
        <!-- Metadata line -->
        <div class="mb-2 flex flex-wrap gap-2 font-mono text-[10px] text-text-dim">
          <span>index: {{ entry.index }}</span>
          <span>order: {{ entry.order }}</span>
        </div>
        <!-- Content body -->
        <pre class="max-h-60 overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-dim">{{ entry.content || '(empty)' }}</pre>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="sortedEntries.length === 0" class="grid min-h-40 place-items-center">
      <p class="font-mono text-xs uppercase tracking-[0.25em] text-neon-muted">NO ENTRIES</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive } from "vue"

import type { WorldBook, WorldBookEntry } from "@tsian/contracts"

const props = defineProps<{
  worldBook: WorldBook
}>()

const expanded = reactive(new Set<number>())

const sortedEntries = computed(() =>
  [...props.worldBook.entries].sort((a, b) => a.order - b.order)
)

function toggle(index: number) {
  if (expanded.has(index)) {
    expanded.delete(index)
  } else {
    expanded.add(index)
  }
}

function activationBadgeClass(mode: string): string {
  switch (mode) {
    case 'always':
      return 'border-neon/40 bg-neon/10 text-neon'
    case 'keyword':
      return 'border-warning/40 bg-warning/10 text-warning'
    case 'vector':
      return 'border-neon-deep/40 bg-neon-deep/10 text-neon-deep'
    default:
      return 'border-neon-muted/30 bg-void text-neon-muted'
  }
}
</script>
