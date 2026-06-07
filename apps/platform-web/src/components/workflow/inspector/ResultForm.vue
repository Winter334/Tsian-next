<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        结果名称
      </label>
      <input
        :value="config.name ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="如 chatResult"
        @change="props.onUpdate({ ...props.config, name: ($event.target as HTMLInputElement).value })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()
</script>
