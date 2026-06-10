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
          输入
        </p>
        <div
          v-for="slot in inputSlots"
          :key="`in-${slot.name}`"
          class="workflow-port-row relative flex min-w-0 items-center"
        >
          <Handle
            type="target"
            :id="slot.name"
            :position="Position.Left"
            class="workflow-port-handle workflow-port-handle--input !border !bg-elevated"
            :style="{ borderColor: typeInfo.color }"
          />
          <p
            class="min-w-0 truncate font-mono text-[10px] text-text-dim"
            :title="portTitle(slot)"
          >
            ← {{ portLabel(slot) }}
          </p>
        </div>
        <div
          v-if="!inputSlots.length"
          class="workflow-port-row relative flex min-w-0 items-center"
        >
          <Handle
            type="target"
            id="input"
            :position="Position.Left"
            class="workflow-port-handle workflow-port-handle--input !border !bg-elevated"
            :style="{ borderColor: typeInfo.color }"
          />
          <p class="min-w-0 truncate font-mono text-[10px] text-text-dim">
            ← 任意
          </p>
        </div>
      </div>
      <div class="min-w-0 space-y-1 text-right">
        <p class="font-mono text-[9px] uppercase tracking-wider text-text-dim">
          输出
        </p>
        <div
          v-for="slot in outputSlots"
          :key="`out-${slot.name}`"
          class="workflow-port-row relative flex min-w-0 items-center justify-end"
        >
          <p
            class="min-w-0 truncate font-mono text-[10px] text-text-dim"
            :title="portTitle(slot)"
          >
            {{ portLabel(slot) }} →
          </p>
          <Handle
            type="source"
            :id="slot.name"
            :position="Position.Right"
            class="workflow-port-handle workflow-port-handle--output !border !bg-elevated"
            :style="{ borderColor: typeInfo.color }"
          />
        </div>
      </div>
    </div>

    <!-- 输入端口（左侧） -->
    <Handle
      v-if="!inputSlots.length && !outputSlots.length"
      type="target"
      id="input"
      :position="Position.Left"
      class="!h-2 !w-2 !rounded-none !border !bg-elevated"
      :style="{ borderColor: typeInfo.color }"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { nodeTypeMap } from './node-registry'
import {
  resolveWorkflowInputSlots,
  resolveWorkflowOutputSlots,
  type WorkflowPortDisplay,
} from './node-schema'
import {
  formatStateNodeTargetSummary,
  workflowStateModelContextKey,
} from './state-model-view'
import type {
  NodeInputDeclaration,
  NodeOutputDeclaration,
  WorkflowStateModel,
  WorkflowNodeType,
} from '@tsian/contracts'
import {
  Brain,
  Flag,
  GitBranch,
  FileEdit,
  Code,
  Database,
  Save,
  FileText,
  Filter,
  Combine,
  Rows3,
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
    stateModel?: WorkflowStateModel
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
  Database,
  Save,
  FileText,
  Filter,
  Combine,
  Rows3,
  HelpCircle,
}

const iconComponent = computed(() => {
  return iconMap[typeInfo.value.icon] ?? HelpCircle
})

const stateModelContext = inject(workflowStateModelContextKey, undefined)

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

function portLabel(port: WorkflowPortDisplay): string {
  return port.label || port.name
}

function portTitle(port: WorkflowPortDisplay): string {
  const parts = [port.name]
  if (port.valueType) parts.push(`类型: ${port.valueType}`)
  if (port.description) parts.push(port.description)
  return parts.join(' · ')
}

function sourceLabel(value: unknown): string {
  if (value === 'collection') return '集合'
  if (typeof value === 'string') return value
  return String(value)
}

// 配置摘要（取关键字段简要显示）
const configSummary = computed(() => {
  const config = props.data.config
  if (!config || Object.keys(config).length === 0) return ''
  const stateTargetSummary = formatStateNodeTargetSummary(
    props.data.stateModel ?? stateModelContext?.value,
    {
      id: props.id,
      type: props.data.nodeType,
      config,
    },
  )
  if (stateTargetSummary) return stateTargetSummary
  // ai-call: 显示 presetId
  if (config.presetId) return `提示词: ${config.presetId}`
  // result: 显示 name
  if (config.name) return `结果名: ${config.name}`
  // compute: 显示 script 前 30 字符
  if (typeof config.script === 'string') {
    return `脚本: ${config.script.slice(0, 30)}${config.script.length > 30 ? '...' : ''}`
  }
  if (config.source) return `来源: ${sourceLabel(config.source)}`
  if (config.collection) return `集合: ${config.collection}`
  if (config.outputName) return `输出: ${config.outputName}`
  // 其他：显示第一个字段
  const firstKey = Object.keys(config)[0]
  return `配置项 ${firstKey}: ${JSON.stringify(config[firstKey]).slice(0, 25)}`
})
</script>

<style scoped>
.workflow-node {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.workflow-port-row {
  min-height: 1rem;
}

.workflow-port-handle {
  position: absolute !important;
  height: 0.5rem !important;
  width: 0.5rem !important;
  border-radius: 0 !important;
  top: 50% !important;
}

.workflow-port-handle--input {
  left: -0.75rem !important;
  transform: translate(-50%, -50%) !important;
}

.workflow-port-handle--output {
  right: -0.75rem !important;
  transform: translate(50%, -50%) !important;
}
</style>
