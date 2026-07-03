<template>
  <aside class="retro-inset grid content-start gap-1 p-2">
    <button
      v-for="option in options"
      :key="option.type"
      type="button"
      class="retro-focus grid gap-0.5 border px-2 py-2 text-left font-mono text-xs"
      :class="option.type === modelValue
        ? [option.accentClass, 'bg-neon/10']
        : 'border-transparent text-text-dim hover:border-neon-deep/40 hover:text-text-main'"
      @click="$emit('update:modelValue', option.type)"
    >
      <span class="flex items-center justify-between gap-2">
        <span class="flex items-center gap-1.5">
          <component :is="option.icon" class="h-3.5 w-3.5" aria-hidden="true" />
          {{ option.label }}
        </span>
        <span>{{ counts[option.type] ?? 0 }}</span>
      </span>
      <span class="text-[10px] opacity-75">{{ option.description }}</span>
    </button>
  </aside>
</template>

<script setup lang="ts">
import type { MarketResourceType } from "@tsian/contracts"
import type { MarketResourceTypeOption } from "./types"

defineProps<{
  modelValue: MarketResourceType
  options: MarketResourceTypeOption[]
  counts: Partial<Record<MarketResourceType, number>>
}>()

defineEmits<{
  "update:modelValue": [value: MarketResourceType]
}>()
</script>
