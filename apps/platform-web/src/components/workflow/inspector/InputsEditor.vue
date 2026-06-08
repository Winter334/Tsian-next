<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        输入端口
      </label>
      <button
        class="font-mono text-[10px] text-neon hover:text-neon/80"
        @click="addInput"
      >
        + 添加
      </button>
    </div>
    <div
      v-for="(input, idx) in inputs"
      :key="idx"
      class="grid gap-1 border border-neon-deep/20 bg-void/40 p-2"
    >
      <div class="grid grid-cols-[1fr_auto] gap-1">
        <input
          :value="input.name"
          class="min-w-0 border border-neon-deep/40 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          placeholder="输入变量名"
          @change="updateInputName(idx, ($event.target as HTMLInputElement).value)"
        />
        <button
          class="px-1 font-mono text-xs text-danger hover:text-danger/80"
          @click="removeInput(idx)"
        >
          ×
        </button>
      </div>

      <div class="grid grid-cols-2 gap-1">
        <input
          :value="input.label ?? ''"
          class="border border-neon-deep/30 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          placeholder="显示名"
          @change="updateInputMetadata(idx, { label: ($event.target as HTMLInputElement).value })"
        />
        <select
          :value="input.valueType ?? ''"
          class="border border-neon-deep/30 bg-void px-1 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          @change="updateValueType(idx, ($event.target as HTMLSelectElement).value as PortValueTypeOption)"
        >
          <option value="">值类型</option>
          <option value="string">文本</option>
          <option value="number">数字</option>
          <option value="boolean">开关</option>
          <option value="object">对象</option>
          <option value="array">数组</option>
          <option value="unknown">未知</option>
        </select>
      </div>

      <div class="grid grid-cols-[auto_1fr] gap-2">
        <label class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
          <input
            type="checkbox"
            :checked="input.required === true"
            class="accent-cyan-400"
            @change="updateInputMetadata(idx, { required: ($event.target as HTMLInputElement).checked || undefined })"
          />
          必需
        </label>
        <input
          :value="input.description ?? ''"
          class="min-w-0 border border-neon-deep/30 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
          placeholder="说明"
          @change="updateInputMetadata(idx, { description: ($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type {
  NodeInputDeclaration,
  WorkflowPortValueType,
} from '@tsian/contracts'

type PortValueTypeOption = '' | WorkflowPortValueType

const props = defineProps<{
  inputs: NodeInputDeclaration[]
  onUpdate: (inputs: NodeInputDeclaration[]) => void
}>()

function updateInput(idx: number, next: NodeInputDeclaration) {
  props.onUpdate(props.inputs.map((input, i) => (i === idx ? next : input)))
}

function addInput() {
  props.onUpdate([...props.inputs, { name: '' }])
}

function removeInput(idx: number) {
  props.onUpdate(props.inputs.filter((_, i) => i !== idx))
}

function updateInputName(idx: number, value: string) {
  const current = props.inputs[idx]
  if (!current) return
  updateInput(idx, { ...current, name: value.trim() })
}

function updateInputMetadata(
  idx: number,
  patch: Partial<Pick<NodeInputDeclaration, 'label' | 'description' | 'valueType' | 'required'>>,
) {
  const current = props.inputs[idx]
  if (!current) return
  const next: NodeInputDeclaration = { ...current, ...patch }
  if (typeof next.label === 'string') next.label = next.label.trim() || undefined
  if (typeof next.description === 'string') next.description = next.description.trim() || undefined
  if (!next.valueType) delete next.valueType
  if (next.required !== true) delete next.required
  updateInput(idx, next)
}

function updateValueType(idx: number, valueType: PortValueTypeOption) {
  updateInputMetadata(idx, { valueType: valueType || undefined })
}
</script>
