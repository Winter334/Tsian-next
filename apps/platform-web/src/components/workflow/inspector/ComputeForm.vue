<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        脚本
      </label>
      <textarea
        :value="(config.script as string) ?? ''"
        rows="8"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon resize-y"
        placeholder="// JavaScript code..."
        @change="props.onUpdate({ ...props.config, script: ($event.target as HTMLTextAreaElement).value })"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        超时 (ms)
      </label>
      <input
        type="number"
        :value="config.timeout ?? 5000"
        min="100"
        max="60000"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="props.onUpdate({ ...props.config, timeout: parseInt(($event.target as HTMLInputElement).value, 10) })"
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
