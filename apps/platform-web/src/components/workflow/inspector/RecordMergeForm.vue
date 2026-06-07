<template>
  <div class="space-y-3">
    <label class="grid gap-1">
      <span class="form-label">输入变量列表</span>
      <input
        :value="inputNamesText"
        class="form-input"
        placeholder="directArchives, foregroundArchives"
        @change="updateInputNames(($event.target as HTMLInputElement).value)"
      />
    </label>

    <div class="grid gap-2 md:grid-cols-2">
      <label class="grid gap-1">
        <span class="form-label">去重字段路径</span>
        <input
          :value="config.keyPath ?? 'id'"
          class="form-input"
          placeholder="id"
          @change="updateOptional('keyPath', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="grid gap-1">
        <span class="form-label">重复记录策略</span>
        <select
          :value="config.strategy ?? 'first'"
          class="form-input"
          @change="updateStrategy(($event.target as HTMLSelectElement).value)"
        >
          <option value="first">保留先出现</option>
          <option value="last">保留后出现</option>
        </select>
      </label>
      <label class="grid gap-1">
        <span class="form-label">输出名称</span>
        <input
          :value="config.outputName ?? 'records'"
          class="form-input"
          placeholder="records"
          @change="updateOptional('outputName', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="grid gap-1">
        <span class="form-label">数量上限</span>
        <input
          type="number"
          min="1"
          :value="config.limit ?? ''"
          class="form-input"
          @change="updateLimit(($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

const inputNamesText = computed(() => {
  return Array.isArray(props.config.inputVarNames)
    ? props.config.inputVarNames.filter((item) => typeof item === 'string').join(', ')
    : 'records'
})

function updateConfig(patch: Record<string, unknown>) {
  props.onUpdate({ ...props.config, ...patch })
}

function updateOptional(key: string, raw: string) {
  updateConfig({ [key]: raw.trim() || undefined })
}

function updateInputNames(raw: string) {
  const inputVarNames = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  updateConfig({ inputVarNames: inputVarNames.length ? inputVarNames : ['records'] })
}

function updateStrategy(raw: string) {
  updateConfig({ strategy: raw === 'last' ? 'last' : 'first' })
}

function updateLimit(raw: string) {
  const value = parseInt(raw, 10)
  updateConfig({ limit: Number.isFinite(value) && value > 0 ? value : undefined })
}
</script>

<style scoped>
.form-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 10px;
  line-height: 1rem;
  letter-spacing: 0;
  text-transform: uppercase;
  color: #608996;
}

.form-input {
  width: 100%;
  border: 1px solid rgba(0, 139, 139, 0.4);
  background: #080c11;
  padding: 0.25rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  color: #e0f7fa;
  outline: none;
}
</style>
