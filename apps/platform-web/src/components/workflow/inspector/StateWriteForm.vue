<template>
  <div class="space-y-3">
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        操作输入变量
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
        默认命名空间
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
        默认集合
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
        检查点策略
      </label>
      <select
        :value="config.pushCheckpointReason ?? 'none'"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        @change="updateOptional('pushCheckpointReason', ($event.target as HTMLSelectElement).value)"
      >
        <option value="none">不创建</option>
        <option value="manual">手动检查点</option>
        <option value="after-turn">回合后检查点</option>
      </select>
    </div>

    <StateSchemaEditor
      :schema="config.schema"
      :on-update="updateSchema"
    />
  </div>
</template>

<script setup lang="ts">
import type { MemorySchemaDefinition } from '@tsian/contracts'
import StateSchemaEditor from './StateSchemaEditor.vue'

const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

function updateOptional(key: string, raw: string) {
  const value = raw.trim()
  props.onUpdate({ ...props.config, [key]: value || undefined })
}

function updateSchema(schema: MemorySchemaDefinition | undefined) {
  const next = { ...props.config }
  if (schema) {
    next.schema = schema
  } else {
    delete next.schema
  }
  props.onUpdate(next)
}
</script>
