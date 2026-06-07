<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        模板内容
      </label>
      <textarea
        :value="(config.template as string) ?? ''"
        rows="8"
        class="mt-1 w-full resize-y border border-neon-deep/40 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
        placeholder="记录：{{records.json}}"
        @change="update('template', ($event.target as HTMLTextAreaElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        输出名称
      </label>
      <input
        :value="config.outputName ?? 'text'"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="text"
        @change="updateOptional('outputName', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        解析方式
      </label>
      <select
        :value="config.parse ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateOptional('parse', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">文本</option>
        <option value="json">JSON</option>
      </select>
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

function updateOptional(key: string, raw: string) {
  const value = raw.trim()
  props.onUpdate({ ...props.config, [key]: value || undefined })
}
</script>
