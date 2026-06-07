<template>
  <div class="space-y-3">
    <!-- cases 列表 -->
    <div>
      <div class="flex items-center justify-between">
        <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
          条件分支
        </label>
        <button
          class="font-mono text-[10px] text-neon hover:text-neon/80"
          @click="addCase"
        >
          + 添加
        </button>
      </div>
      <div class="mt-1 space-y-1">
        <div
          v-for="(c, idx) in cases"
          :key="idx"
          class="flex items-center gap-1"
        >
          <input
            :value="c.when"
            class="flex-1 border border-neon-deep/40 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
            placeholder="匹配值"
            @change="updateCase(idx, 'when', ($event.target as HTMLInputElement).value)"
          />
          <input
            :value="c.outputName"
            class="w-24 border border-neon-deep/40 bg-void px-2 py-1 font-mono text-[10px] text-text-main outline-none focus:border-neon"
            placeholder="输出名"
            @change="updateCase(idx, 'outputName', ($event.target as HTMLInputElement).value)"
          />
          <button
            class="px-1 font-mono text-xs text-danger hover:text-danger/80"
            @click="removeCase(idx)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <!-- defaultOutputName -->
    <div>
      <label class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
        默认输出
      </label>
      <input
        :value="config.defaultOutputName ?? ''"
        class="mt-1 w-full border border-neon-deep/40 bg-void px-2 py-1 font-mono text-xs text-text-main outline-none focus:border-neon"
        placeholder="未命中时的输出名"
        @change="props.onUpdate({ ...props.config, defaultOutputName: ($event.target as HTMLInputElement).value })"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  config: Record<string, unknown>
  onUpdate: (config: Record<string, unknown>) => void
}>()

const cases = computed(() => {
  return (props.config.cases as Array<{ when: string; outputName: string }>) ?? []
})

function addCase() {
  const newCases = [...cases.value, { when: '', outputName: '' }]
  props.onUpdate({ ...props.config, cases: newCases })
}

function removeCase(idx: number) {
  const newCases = cases.value.filter((_, i) => i !== idx)
  props.onUpdate({ ...props.config, cases: newCases })
}

function updateCase(idx: number, field: 'when' | 'outputName', value: string) {
  const newCases = cases.value.map((c, i) =>
    i === idx ? { ...c, [field]: value } : c
  )
  props.onUpdate({ ...props.config, cases: newCases })
}
</script>
