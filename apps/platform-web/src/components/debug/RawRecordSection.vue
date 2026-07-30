<template>
  <details class="min-w-0 border border-neon-deep/35 bg-panel/55">
    <summary class="flex cursor-pointer items-center justify-between gap-2 border-b border-neon-deep/20 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-neon">
      <span>原始 JSON</span>
      <button type="button" class="retro-button retro-focus inline-flex h-7 items-center gap-1 px-2 font-mono text-[10px]" @click.prevent.stop="$emit('copy')">
        <Copy class="h-3 w-3" aria-hidden="true" /> 复制
      </button>
    </summary>
    <pre class="max-h-[34rem] overflow-auto whitespace-pre-wrap break-all bg-black/20 p-3 font-mono text-[10px] leading-4 text-text-main">{{ json }}</pre>
  </details>
</template>

<script setup lang="ts">
import { Copy } from "lucide-vue-next"

defineProps<{ json: string }>()
defineEmits<{ (event: "copy"): void }>()
</script>
