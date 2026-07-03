<template>
  <aside class="retro-inset grid min-h-full grid-rows-[auto_minmax(0,1fr)_auto] gap-2 p-2">
    <div class="grid content-start gap-1">
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
    </div>

    <div aria-hidden="true" />

    <div class="border-t border-neon-deep/30 pt-2">
      <button
        type="button"
        class="retro-focus flex w-full items-center justify-between gap-2 border border-neon-deep/35 bg-elevated/60 px-2 py-2 text-left font-mono text-xs text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
        @click="$emit('toggleScope')"
      >
        <span>{{ scope === 'mine' ? '全部资源' : '我的上传' }}</span>
        <span class="text-[10px] opacity-70">↗</span>
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { MarketResourceType } from "@tsian/contracts"
import type { MarketResourceTypeOption } from "./types"

defineProps<{
  modelValue: MarketResourceType
  options: MarketResourceTypeOption[]
  counts: Partial<Record<MarketResourceType, number>>
  scope: "all" | "mine"
}>()

defineEmits<{
  "update:modelValue": [value: MarketResourceType]
  toggleScope: []
}>()
</script>
