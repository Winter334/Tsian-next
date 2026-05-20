<template>
  <div class="space-y-3">
    <!-- presetId -->
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Preset ID
      </label>
      <input
        :value="config.presetId ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="e.g. builtin.chat"
        @change="update('presetId', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <!-- worldBookKeys（逗号分隔） -->
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        World Book Keys
      </label>
      <input
        :value="(config.worldBookKeys as string[] ?? []).join(', ')"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="key1, key2, ..."
        @change="updateWorldBookKeys(($event.target as HTMLInputElement).value)"
      />
      <p class="mt-0.5 text-[9px] text-text-dim">逗号分隔</p>
    </div>

    <!-- appendUserInput -->
    <div class="flex items-center gap-2">
      <input
        type="checkbox"
        :checked="!!config.appendUserInput"
        class="accent-neon"
        @change="update('appendUserInput', ($event.target as HTMLInputElement).checked)"
      />
      <label class="font-mono text-xs text-text-main">
        追加用户输入
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

function update(key: string, value: unknown) {
  props.onUpdate({ ...props.config, [key]: value })
}

function updateWorldBookKeys(value: string) {
  const keys = value.split(',').map((s) => s.trim()).filter(Boolean)
  props.onUpdate({ ...props.config, worldBookKeys: keys.length > 0 ? keys : undefined })
}
</script>
