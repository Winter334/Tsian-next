<template>
  <BaseEdge
    :id="id"
    :path="edgePath"
    :marker-end="markerEnd"
    :style="edgeStyle"
    :class="['state-link-edge', { 'state-link-edge--selected': selected }]"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { BaseEdge, getBezierPath, type Position } from '@vue-flow/core'

const props = defineProps<{
  id: string
  source: string
  target: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  selected?: boolean
  markerEnd?: string
  data?: {
    stateLinkKind?: 'read' | 'write'
  }
}>()

const edgePath = computed(() => {
  const [path] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  })
  return path
})

const edgeStyle = computed(() => {
  const color = props.data?.stateLinkKind === 'write' ? '#F472B6' : '#00FF88'
  return {
    stroke: props.selected ? '#00F0FF' : color,
    strokeWidth: props.selected ? 2.5 : 1.75,
    strokeDasharray: props.data?.stateLinkKind === 'write' ? '2 5' : '10 4',
    filter: props.selected ? 'drop-shadow(0 0 4px #00F0FF80)' : 'none',
  }
})
</script>

<style>
.state-link-edge .vue-flow__edge-path {
  animation: state-link-flow 1.8s linear infinite;
}

@keyframes state-link-flow {
  from {
    stroke-dashoffset: 28;
  }
  to {
    stroke-dashoffset: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-link-edge .vue-flow__edge-path {
    animation: none;
  }
}
</style>
