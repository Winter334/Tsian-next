<template>
  <label class="relative min-w-[160px]">
    <Tag class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neon-muted" aria-hidden="true" />
    <span class="sr-only">筛选 tag</span>
    <input
      :value="modelValue"
      type="search"
      placeholder="tag"
      class="retro-focus retro-select-surface h-7 w-full border border-neon-deep/55 bg-elevated pl-7 pr-12 font-mono text-xs text-text-main placeholder:text-text-dim/60"
      @input="onInput"
    />
    <button
      v-if="modelValue"
      type="button"
      class="retro-focus absolute right-1 top-1/2 -translate-y-1/2 px-1 text-[10px] text-text-dim hover:text-neon"
      @click="$emit('update:modelValue', '')"
    >
      清除
    </button>
  </label>
</template>

<script setup lang="ts">
import { Tag } from "lucide-vue-next"

defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  "update:modelValue": [value: string]
}>()

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).value)
}
</script>
