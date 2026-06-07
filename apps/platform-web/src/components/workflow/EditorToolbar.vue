<template>
  <div
    class="flex flex-wrap items-center gap-2 border-b border-neon-deep/40 bg-panel px-3 py-1.5"
    @click.stop
  >
    <!-- 标题区 -->
    <span class="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-neon-muted">
      系统工作流
    </span>
    <span class="shrink-0 text-xs font-bold uppercase tracking-widest text-text-main">
      工作流编辑器
    </span>
    <span class="max-w-[min(22rem,100%)] truncate border border-neon-deep/30 bg-void px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-dim">
      来源：{{ sourceLabel }}
    </span>
    <span
      class="mr-auto shrink-0 border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      :class="statusClass"
    >
      {{ statusLabel }}
    </span>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-neon-deep/40 bg-elevated px-3 py-1 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
      @click="$emit('addNode')"
    >
      添加节点
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-neon-deep/40 bg-elevated px-3 py-1 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
      @click="$emit('autoLayout')"
    >
      自动布局
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-neon-deep/40 bg-elevated px-3 py-1 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
      @click="$emit('exportJson')"
    >
      导出 JSON
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-neon-deep/40 bg-elevated px-3 py-1 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
      @click="$emit('importJson')"
    >
      导入 JSON
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-neon-deep/40 bg-elevated px-3 py-1 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
      :disabled="!hasSelection"
      :class="{ 'opacity-40 cursor-not-allowed': !hasSelection }"
      @click="$emit('deleteSelected')"
    >
      删除选中
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-neon-deep/40 bg-elevated px-3 py-1 font-mono text-xs text-text-main transition-colors hover:border-neon-deep/60 hover:text-neon"
      :disabled="saveStatus === 'saving'"
      :class="{ 'opacity-40 cursor-not-allowed': saveStatus === 'saving' }"
      @click="$emit('resetWorkflow')"
    >
      重置更改
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-neon bg-neon/5 px-3 py-1 font-mono text-xs text-neon transition-colors hover:bg-neon/15"
      :disabled="saveStatus === 'saving' || saveStatus === 'saved'"
      :class="{ 'opacity-40 cursor-not-allowed': saveStatus === 'saving' || saveStatus === 'saved' }"
      @click="$emit('saveWorkflow')"
    >
      保存工作流
    </button>
    <button
      type="button"
      class="shrink-0 whitespace-nowrap border border-danger/40 bg-elevated px-3 py-1 font-mono text-xs text-danger transition-colors hover:border-danger/60 hover:bg-danger/10"
      @click="$emit('clearCanvas')"
    >
      清空画布
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export type WorkflowSaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

const props = defineProps<{
  hasSelection: boolean
  saveStatus: WorkflowSaveStatus
  sourceLabel: string
}>()

defineEmits<{
  addNode: []
  autoLayout: []
  clearCanvas: []
  deleteSelected: []
  exportJson: []
  importJson: []
  resetWorkflow: []
  saveWorkflow: []
}>()

const statusLabel = computed(() => {
  if (props.saveStatus === 'dirty') return '有未保存更改'
  if (props.saveStatus === 'saving') return '保存中'
  if (props.saveStatus === 'error') return '保存失败'
  return '已保存'
})

const statusClass = computed(() => {
  if (props.saveStatus === 'dirty') return 'border-warning/50 bg-warning/10 text-warning'
  if (props.saveStatus === 'saving') return 'border-neon-deep/50 bg-neon/10 text-neon'
  if (props.saveStatus === 'error') return 'border-danger/50 bg-danger/10 text-danger'
  return 'border-neon-deep/30 bg-void text-text-dim'
})
</script>
