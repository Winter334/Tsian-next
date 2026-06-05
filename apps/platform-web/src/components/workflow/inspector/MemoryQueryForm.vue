<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Namespace
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
        Collection
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
        Query Var
      </label>
      <input
        :value="config.queryVarName ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="query"
        @change="updateOptional('queryVarName', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Fallback Query
      </label>
      <input
        :value="config.query ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="optional static query"
        @change="updateOptional('query', ($event.target as HTMLInputElement).value)"
      />
    </div>

    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        Limit
      </label>
      <input
        type="number"
        :value="config.limit ?? ''"
        min="1"
        max="200"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateLimit(($event.target as HTMLInputElement).value)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

function updateConfig(patch: Record<string, unknown>) {
  props.onUpdate({ ...props.config, ...patch, source: 'collection' })
}

function updateOptional(key: string, raw: string) {
  const value = raw.trim()
  updateConfig({ [key]: value || undefined })
}

function updateLimit(raw: string) {
  const value = parseInt(raw, 10)
  updateConfig({ limit: Number.isFinite(value) && value > 0 ? value : undefined })
}
</script>
