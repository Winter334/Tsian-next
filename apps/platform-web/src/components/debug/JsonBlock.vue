<template>
  <section class="grid min-w-0 gap-1">
    <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">{{ label }}</p>
    <pre v-if="value !== undefined" class="max-h-80 overflow-auto whitespace-pre-wrap break-all border border-neon-deep/25 bg-black/20 p-2 font-mono text-[10px] leading-4 text-text-main">{{ formatted }}</pre>
    <p v-else class="text-xs text-text-dim">{{ emptyText }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(defineProps<{
  label: string
  value?: unknown
  emptyText?: string
}>(), {
  value: undefined,
  emptyText: "无",
})

const formatted = computed(() => JSON.stringify(props.value, null, 2))
</script>
