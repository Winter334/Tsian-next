<template>
  <div
    class="workflow-node min-w-[180px] border bg-panel"
    :class="[
      selected ? 'border-2' : 'border',
    ]"
    :style="{
      borderColor: selected ? typeInfo.color : 'rgba(0, 139, 139, 0.4)',
      boxShadow: selected ? `0 0 12px ${typeInfo.color}40` : 'none',
    }"
  >
    <!-- 顶部色条 -->
    <div
      class="h-1.5 w-full"
      :style="{ backgroundColor: typeInfo.color }"
    />

    <!-- 标题行 -->
    <div class="flex items-center gap-2 px-3 py-2">
      <component
        :is="iconComponent"
        class="h-4 w-4 shrink-0"
        :style="{ color: typeInfo.color }"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate font-mono text-xs font-bold text-text-main">
          {{ data.label || typeInfo.label }}
        </p>
        <p class="truncate font-mono text-[10px] text-text-dim">
          {{ data.nodeType }} · {{ id }}
        </p>
      </div>
    </div>

    <!-- 配置摘要（简单显示 1-2 个关键字段） -->
    <div
      v-if="configSummary"
      class="border-t border-neon-deep/20 px-3 py-1.5"
    >
      <p class="truncate font-mono text-[10px] text-text-dim">
        {{ configSummary }}
      </p>
    </div>

    <div
      v-if="inputSlots.length || outputSlots.length"
      class="grid grid-cols-2 gap-3 border-t border-neon-deep/20 px-3 py-2"
    >
      <div class="min-w-0 space-y-1">
        <p class="font-mono text-[9px] uppercase tracking-wider text-text-dim">
          IN
        </p>
        <p
          v-for="slot in inputSlots"
          :key="`in-${slot.name}`"
          class="truncate font-mono text-[10px] text-text-dim"
          :title="portTitle(slot)"
        >
          ← {{ portLabel(slot) }}
        </p>
        <p
          v-if="!inputSlots.length"
          class="truncate font-mono text-[10px] text-text-dim"
        >
          ← any
        </p>
      </div>
      <div class="min-w-0 space-y-1 text-right">
        <p class="font-mono text-[9px] uppercase tracking-wider text-text-dim">
          OUT
        </p>
        <p
          v-for="slot in outputSlots"
          :key="`out-${slot.name}`"
          class="truncate font-mono text-[10px] text-text-dim"
          :title="portTitle(slot)"
        >
          {{ portLabel(slot) }} →
        </p>
      </div>
    </div>

    <!-- 输入端口（左侧） -->
    <Handle
      v-if="!inputSlots.length"
      type="target"
      id="input"
      :position="Position.Left"
      class="!h-2 !w-2 !rounded-none !border !bg-elevated"
      :style="{ borderColor: typeInfo.color }"
    />
    <Handle
      v-for="(input, idx) in inputSlots"
      :key="`input-handle-${input.name}`"
      type="target"
      :id="input.name"
      :position="Position.Left"
      class="!h-2 !w-2 !rounded-none !border !bg-elevated"
      :style="{
        borderColor: typeInfo.color,
        top: handleTop(idx, inputSlots.length),
      }"
    />

    <!-- 输出端口（右侧） -->
    <Handle
      v-for="(output, idx) in outputSlots"
      :key="output.name"
      type="source"
      :id="output.name"
      :position="Position.Right"
      class="!h-2 !w-2 !rounded-none !border !bg-elevated"
      :style="{
        borderColor: typeInfo.color,
        top: handleTop(idx, outputSlots.length),
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { nodeTypeMap } from './node-registry'
import {
  resolveWorkflowInputSlots,
  resolveWorkflowOutputSlots,
  type WorkflowPortDisplay,
} from './node-schema'
import type {
  NodeInputDeclaration,
  NodeOutputDeclaration,
  WorkflowNodeType,
} from '@tsian/contracts'
import {
  Brain,
  Flag,
  GitBranch,
  FileEdit,
  Code,
  HelpCircle,
} from 'lucide-vue-next'

// Vue Flow 自定义节点 props
const props = defineProps<{
  id: string
  data: {
    nodeType: WorkflowNodeType
    label?: string
    config: Record<string, unknown>
    inputs: NodeInputDeclaration[]
    outputs: NodeOutputDeclaration[]
    retry?: { maxRetries: number }
  }
  selected: boolean
}>()

// 节点类型信息
const typeInfo = computed(() => {
  return nodeTypeMap.get(props.data.nodeType) ?? {
    type: props.data.nodeType,
    label: props.data.nodeType,
    description: '',
    icon: 'HelpCircle',
    color: '#608996',
    colorClass: 'text-dim',
  }
})

// 图标组件映射
const iconMap: Record<string, any> = {
  Brain,
  Flag,
  GitBranch,
  FileEdit,
  Code,
  HelpCircle,
}

const iconComponent = computed(() => {
  return iconMap[typeInfo.value.icon] ?? HelpCircle
})

const inputSlots = computed(() => {
  return resolveWorkflowInputSlots(
    props.data.nodeType,
    props.data.config,
    props.data.inputs ?? [],
  )
})

const outputSlots = computed(() => {
  return resolveWorkflowOutputSlots(
    props.data.nodeType,
    props.data.config,
    props.data.outputs ?? [],
  )
})

function handleTop(index: number, total: number): string {
  if (total <= 1) return '50%'
  const span = 60 / Math.max(total - 1, 1)
  return `${20 + index * span}%`
}

function portLabel(port: WorkflowPortDisplay): string {
  return port.label || port.name
}

function portTitle(port: WorkflowPortDisplay): string {
  const parts = [port.name]
  if (port.valueType) parts.push(`type: ${port.valueType}`)
  if (port.semanticSlot) parts.push(`slot: ${port.semanticSlot}`)
  if (port.description) parts.push(port.description)
  return parts.join(' · ')
}

// 配置摘要（取关键字段简要显示）
const configSummary = computed(() => {
  const config = props.data.config
  if (!config || Object.keys(config).length === 0) return ''
  // ai-call: 显示 presetId
  if (config.presetId) return `preset: ${config.presetId}`
  // result: 显示 name
  if (config.name) return `name: ${config.name}`
  // compute: 显示 script 前 30 字符
  if (typeof config.script === 'string') {
    return `script: ${config.script.slice(0, 30)}${config.script.length > 30 ? '...' : ''}`
  }
  // apply-patch: 显示 patchVarName
  if (config.patchVarName) return `var: ${config.patchVarName}`
  // 其他：显示第一个字段
  const firstKey = Object.keys(config)[0]
  return `${firstKey}: ${JSON.stringify(config[firstKey]).slice(0, 25)}`
})
</script>

<style scoped>
.workflow-node {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}
</style>
