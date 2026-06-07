<template>
  <div
    class="min-w-[190px] border border-[#00FF88]/60 bg-panel shadow-[0_0_14px_rgba(0,255,136,0.12)]"
  >
    <div class="h-1.5 w-full bg-[#00FF88]" />

    <div class="flex items-center gap-2 px-3 py-2">
      <Database class="h-4 w-4 shrink-0 text-[#00FF88]" />
      <div class="min-w-0 flex-1">
        <p class="truncate font-mono text-xs font-bold text-text-main">
          {{ data.label || '状态数据库' }}
        </p>
        <p class="truncate font-mono text-[10px] text-text-dim">
          stateModel · {{ anchorId }}
        </p>
      </div>
    </div>

    <div class="border-t border-neon-deep/20 px-3 py-2">
      <p class="mb-1 font-mono text-[9px] uppercase tracking-wider text-text-dim">
        collections
      </p>
      <div class="space-y-1">
        <p
          v-for="port in ports"
          :key="port.id"
          class="truncate font-mono text-[10px] text-text-dim"
          :title="portTitle(port)"
        >
          ← {{ portLabel(port) }} →
        </p>
      </div>
    </div>

    <template
      v-for="(port, index) in ports"
      :key="`handles-${port.id}`"
    >
      <Handle
        type="target"
        :id="toStateWriteHandleId(port.id)"
        :position="Position.Left"
        class="!h-2 !w-2 !rounded-none !border !border-[#00FF88] !bg-elevated"
        :style="{ top: handleTop(index, ports.length) }"
      />
      <Handle
        type="source"
        :id="toStateReadHandleId(port.id)"
        :position="Position.Right"
        class="!h-2 !w-2 !rounded-none !border !border-[#00FF88] !bg-elevated"
        :style="{ top: handleTop(index, ports.length) }"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Database } from 'lucide-vue-next'
import type { WorkflowStateModelAnchorPort } from '@tsian/contracts'
import {
  fromStateAnchorVueNodeId,
  toStateReadHandleId,
  toStateWriteHandleId,
} from '../../composables/useWorkflowEditor'

const props = defineProps<{
  id: string
  data: {
    label?: string
    ports?: WorkflowStateModelAnchorPort[]
  }
}>()

const anchorId = computed(() => fromStateAnchorVueNodeId(props.id))
const ports = computed(() => props.data.ports?.length
  ? props.data.ports
  : [{ id: 'port-1', label: '未绑定' }],
)

function handleTop(index: number, total: number): string {
  if (total <= 1) return '50%'
  const span = 60 / Math.max(total - 1, 1)
  return `${20 + index * span}%`
}

function portLabel(port: WorkflowStateModelAnchorPort): string {
  return port.label || port.collection || '未绑定'
}

function portTitle(port: WorkflowStateModelAnchorPort): string {
  return [
    `端口: ${port.id}`,
    port.collection ? `集合: ${port.collection}` : '未绑定 collection',
  ].join(' · ')
}
</script>
