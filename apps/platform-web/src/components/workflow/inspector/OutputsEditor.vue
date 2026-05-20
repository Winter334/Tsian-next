<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        输出端口
      </label>
      <button
        class="font-mono text-[10px] text-neon hover:text-neon/80"
        @click="addOutput"
      >
        + 添加
      </button>
    </div>
    <div
      v-for="(output, idx) in outputs"
      :key="idx"
      class="flex items-center gap-1"
    >
      <input
        :value="output.name"
        class="flex-1 border border-neon-deep/40 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
        placeholder="输出名"
        @change="updateOutput(idx, 'name', ($event.target as HTMLInputElement).value)"
      />
      <select
        :value="output.extract?.type ?? ''"
        class="w-16 border border-neon-deep/40 bg-void px-1 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
        @change="updateExtractType(idx, ($event.target as HTMLSelectElement).value)"
      >
        <option value="">raw</option>
        <option value="tag">tag</option>
        <option value="regex">regex</option>
      </select>
      <button
        class="px-1 font-mono text-xs text-danger hover:text-danger/80"
        @click="removeOutput(idx)"
      >
        ×
      </button>
    </div>
    <!-- tag/regex 参数（简化版：只在有 extract 时显示 tag/pattern 输入） -->
    <div
      v-for="(output, idx) in outputs"
      :key="'detail-' + idx"
    >
      <div v-if="output.extract?.type === 'tag'" class="ml-4 mt-1">
        <input
          :value="output.extract.tag ?? ''"
          class="w-full border border-neon-deep/20 bg-void px-2 py-0.5 font-mono text-[10px] text-text-dim outline-none focus:border-neon"
          placeholder="标签名 e.g. result"
          @change="updateExtractParam(idx, 'tag', ($event.target as HTMLInputElement).value)"
        />
      </div>
      <div v-else-if="output.extract?.type === 'regex'" class="ml-4 mt-1">
        <input
          :value="output.extract.pattern ?? ''"
          class="w-full border border-neon-deep/20 bg-void px-2 py-0.5 font-mono text-[10px] text-text-dim outline-none focus:border-neon"
          placeholder="正则表达式"
          @change="updateExtractParam(idx, 'pattern', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  outputs: Array<{ name: string; extract?: any }>
  onUpdate: (outputs: Array<{ name: string; extract?: any }>) => void
}>()

/** 添加一个空输出端口 */
function addOutput() {
  props.onUpdate([...props.outputs, { name: '' }])
}

/** 删除指定索引的输出端口 */
function removeOutput(idx: number) {
  props.onUpdate(props.outputs.filter((_, i) => i !== idx))
}

/** 更新输出端口的某个字段 */
function updateOutput(idx: number, field: string, value: string) {
  const newOutputs = props.outputs.map((o, i) =>
    i === idx ? { ...o, [field]: value } : o
  )
  props.onUpdate(newOutputs)
}

/** 更新提取类型（tag/regex/raw） */
function updateExtractType(idx: number, type: string) {
  const newOutputs = props.outputs.map((o, i) => {
    if (i !== idx) return o
    if (!type) {
      const { extract, ...rest } = o
      return rest
    }
    return { ...o, extract: { type } }
  })
  props.onUpdate(newOutputs)
}

/** 更新提取规则参数（tag / pattern） */
function updateExtractParam(idx: number, param: string, value: string) {
  const newOutputs = props.outputs.map((o, i) => {
    if (i !== idx) return o
    return { ...o, extract: { ...o.extract, [param]: value } }
  })
  props.onUpdate(newOutputs)
}
</script>
