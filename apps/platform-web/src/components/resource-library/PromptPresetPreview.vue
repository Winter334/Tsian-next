<template>
  <div class="grid gap-1">
    <div
      v-for="entry in sortedEntries"
      :key="entry.identifier"
      class="border transition-colors"
      :class="entry.enabled
        ? 'border-neon-muted/30 bg-panel'
        : 'border-neon-muted/15 bg-panel/50 opacity-50'"
    >
      <!-- Entry header (clickable) -->
      <button
        type="button"
        class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-elevated/40"
        @click="toggle(entry.identifier)"
      >
        <!-- Expand/collapse indicator -->
        <span
          class="shrink-0 font-mono text-[10px] text-neon-muted transition-transform"
          :class="expanded.has(entry.identifier) ? 'rotate-90' : ''"
        >
          >
        </span>

        <!-- Name -->
        <span class="min-w-0 flex-1 truncate font-mono text-xs text-text-main">
          {{ entry.name || entry.identifier }}
        </span>

        <!-- Role badge -->
        <span
          class="shrink-0 border border-neon-deep/30 bg-void px-2 py-0.5 font-mono text-[10px] uppercase text-neon-muted"
        >
          {{ entry.role }}
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

      <!-- Expanded content -->
      <div
        v-if="expanded.has(entry.identifier)"
        class="border-t border-neon-muted/20 bg-void/40 px-3 py-2"
      >
        <!-- Metadata line -->
        <div class="mb-2 flex flex-wrap gap-2 font-mono text-[10px] text-text-dim">
          <span v-if="entry.name && entry.name !== entry.identifier">
            id: {{ entry.identifier }}
          </span>
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

import type { PromptPreset, PromptPresetEntry } from "@tsian/contracts"

const props = defineProps<{
  preset: PromptPreset
}>()

const expanded = reactive(new Set<string>())

const sortedEntries = computed(() =>
  [...props.preset.prompts].sort((a, b) => a.order - b.order)
)

function toggle(identifier: string) {
  if (expanded.has(identifier)) {
    expanded.delete(identifier)
  } else {
    expanded.add(identifier)
  }
}
</script>
