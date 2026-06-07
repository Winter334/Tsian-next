<template>
  <div class="space-y-3">
    <div class="grid gap-2 md:grid-cols-2">
      <label class="grid gap-1">
        <span class="form-label">输入变量</span>
        <input
          :value="config.inputVarName ?? 'records'"
          class="form-input"
          placeholder="records"
          @change="updateOptional('inputVarName', ($event.target as HTMLInputElement).value)"
        />
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
        <span class="form-label">匹配方式</span>
        <select
          :value="config.match ?? 'all'"
          class="form-input"
          @change="updateMatch(($event.target as HTMLSelectElement).value)"
        >
          <option value="all">全部条件</option>
          <option value="any">任一条件</option>
        </select>
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

    <div class="space-y-2">
      <div class="flex items-center justify-between">
        <span class="form-label">筛选条件</span>
        <button
          type="button"
          class="font-mono text-[10px] text-neon transition-colors hover:text-neon/80"
          @click="addPredicate"
        >
          + 添加
        </button>
      </div>

      <div
        v-for="(predicate, index) in predicates"
        :key="index"
        class="grid gap-2 border border-neon-deep/20 bg-void/40 p-2 md:grid-cols-[1fr_140px_1fr_auto]"
      >
        <input
          :value="predicate.path"
          class="form-input"
          placeholder="data.status"
          @change="updatePredicate(index, { path: ($event.target as HTMLInputElement).value.trim() })"
        />
        <select
          :value="predicate.op"
          class="form-input"
          @change="updatePredicate(index, { op: ($event.target as HTMLSelectElement).value as PredicateOperator })"
        >
          <option value="exists">存在</option>
          <option value="equals">等于</option>
          <option value="not-equals">不等于</option>
          <option value="contains">包含</option>
          <option value="in">属于列表</option>
        </select>
        <input
          :value="formatPredicateValue(predicate.value)"
          class="form-input"
          placeholder="value"
          @change="updatePredicateValue(index, ($event.target as HTMLInputElement).value)"
        />
        <button
          type="button"
          class="font-mono text-xs text-danger transition-colors hover:text-danger/80"
          @click="removePredicate(index)"
        >
          ×
        </button>
        <label class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-dim md:col-span-4">
          <input
            type="checkbox"
            :checked="!!predicate.caseSensitive"
            class="accent-cyan-400"
            @change="updatePredicate(index, { caseSensitive: ($event.target as HTMLInputElement).checked || undefined })"
          />
          区分大小写
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { JsonValue, RecordFilterPredicate, RecordFilterPredicateOperator } from '@tsian/contracts'

type PredicateOperator = RecordFilterPredicateOperator

const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

const predicates = computed<RecordFilterPredicate[]>(() => {
  return Array.isArray(props.config.predicates)
    ? props.config.predicates.filter((item): item is RecordFilterPredicate =>
      typeof item === 'object' && item !== null,
    )
    : []
})

function updateConfig(patch: Record<string, unknown>) {
  props.onUpdate({ ...props.config, ...patch })
}

function updateOptional(key: string, raw: string) {
  updateConfig({ [key]: raw.trim() || undefined })
}

function updateMatch(value: string) {
  updateConfig({ match: value === 'any' ? 'any' : 'all' })
}

function updateLimit(raw: string) {
  const value = parseInt(raw, 10)
  updateConfig({ limit: Number.isFinite(value) && value > 0 ? value : undefined })
}

function formatPredicateValue(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function parsePredicateValue(raw: string): JsonValue | undefined {
  const value = raw.trim()
  if (!value) return undefined
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return value
  }
}

function replacePredicates(next: RecordFilterPredicate[]) {
  updateConfig({ predicates: next })
}

function addPredicate() {
  replacePredicates([
    ...predicates.value,
    { path: 'data.status', op: 'equals', value: 'ongoing' },
  ])
}

function updatePredicate(index: number, patch: Partial<RecordFilterPredicate>) {
  replacePredicates(predicates.value.map((predicate, position) =>
    position === index
      ? { ...predicate, ...patch }
      : predicate,
  ))
}

function updatePredicateValue(index: number, raw: string) {
  updatePredicate(index, { value: parsePredicateValue(raw) })
}

function removePredicate(index: number) {
  replacePredicates(predicates.value.filter((_, position) => position !== index))
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
