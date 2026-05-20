<template>
  <div
    class="inline-flex items-center gap-2 border px-3 py-1 font-mono text-[11px] backdrop-blur-sm"
    :class="errors.length > 0
      ? 'border-danger/60 bg-danger/10 text-danger'
      : 'border-[#00FF88]/40 bg-[#00FF88]/10 text-[#00FF88]'"
  >
    <!-- 状态图标 -->
    <span class="font-bold">
      {{ errors.length > 0 ? '✗' : '✓' }}
    </span>

    <!-- 统计 -->
    <span class="opacity-70">
      {{ nodeCount }} 节点 · {{ edgeCount }} 边
    </span>

    <!-- 错误信息 -->
    <template v-if="errors.length > 0">
      <span class="opacity-50">|</span>
      <span>
        {{ errors.length }} 错误：{{ errors[0] }}
      </span>
    </template>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  errors: string[]
  nodeCount: number
  edgeCount: number
}>()
</script>
