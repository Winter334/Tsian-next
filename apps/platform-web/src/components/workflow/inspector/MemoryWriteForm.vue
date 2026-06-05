<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Operations Var
      </label>
      <input
        :value="config.operationsVarName ?? 'operations'"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="operations"
        @change="updateOptional('operationsVarName', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Default Namespace
      </label>
      <input
        :value="config.namespace ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="mod.example"
        @change="updateOptional('namespace', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Default Collection
      </label>
      <input
        :value="config.collection ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="fragments"
        @change="updateOptional('collection', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Checkpoint
      </label>
      <select
        :value="config.pushCheckpointReason ?? 'none'"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateOptional('pushCheckpointReason', ($event.target as HTMLSelectElement).value)"
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

function updateOptional(key: string, raw: string) {
  const value = raw.trim()
  props.onUpdate({ ...props.config, [key]: value || undefined })
}
</script>
