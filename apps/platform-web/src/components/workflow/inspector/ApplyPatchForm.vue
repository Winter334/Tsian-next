<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Patch 变量名
      </label>
      <input
        :value="config.patchVarName ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="e.g. maintenanceOutput"
        @change="props.onUpdate({ ...props.config, patchVarName: ($event.target as HTMLInputElement).value })"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        检查点原因
      </label>
      <select
        :value="config.pushCheckpointReason ?? 'none'"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updatePushCheckpointReason(($event.target as HTMLSelectElement).value)"
      >
        <option value="none">none</option>
        <option value="manual">manual</option>
        <option value="after-turn">after-turn</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

function updatePushCheckpointReason(raw: string) {
  props.onUpdate({
    ...props.config,
    pushCheckpointReason: raw === "none" ? undefined : raw,
  })
}
</script>
