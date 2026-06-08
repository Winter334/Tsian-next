<template>
  <BaseEdge
    :id="id"
    :path="edgePath"
    :marker-end="markerEnd"
    :style="edgeStyle"
    :class="['neon-edge', { 'neon-edge--selected': selected }]"
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

const edgeStyle = computed(() => ({
  stroke: props.selected ? '#00F0FF' : '#608996',
  strokeWidth: props.selected ? 2.5 : 1.5,
  strokeDasharray: '8 4',
  filter: props.selected ? 'drop-shadow(0 0 4px #00F0FF80)' : 'none',
}))
</script>

<style>
/* Neon edge dash-flow animation */
.neon-edge .vue-flow__edge-path {
  animation: neon-edge-flow 1.5s linear infinite;
}

@keyframes neon-edge-flow {
  from {
    stroke-dashoffset: 24;
  }
  to {
    stroke-dashoffset: 0;
  }
}

/* Respect reduced-motion preference */
@media (prefers-reduced-motion: reduce) {
  .neon-edge .vue-flow__edge-path {
    animation: none;
  }
}
</style>
