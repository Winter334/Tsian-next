<template>
  <div
    v-if="open && edge"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-void/75 p-4 backdrop-blur"
    role="dialog"
    aria-modal="true"
    aria-label="连线"
    @click.self="handleClose"
  >
    <section class="w-[min(520px,calc(100vw-2rem))] overflow-hidden border border-neon-muted/50 bg-panel shadow-2xl">
      <header class="flex items-center justify-between gap-3 border-b border-neon-muted/30 px-4 py-3">
        <div class="min-w-0">
          <p class="font-mono text-[10px] uppercase tracking-[0.3em] text-neon-muted">
            连线
          </p>
          <p class="mt-1 break-all font-mono text-xs text-text-main">
            {{ edge.source }}.{{ sourcePort }} → {{ edge.target }}.{{ targetPort }}
          </p>
        </div>
        <button
          type="button"
          class="border border-neon-muted/40 bg-elevated px-3 py-1.5 font-mono text-xs text-text-main transition-colors hover:border-neon hover:text-neon"
          @click="handleClose"
        >
          关闭
        </button>
      </header>

      <div class="grid gap-3 p-4 font-mono text-xs">
        <div class="grid gap-1 border border-neon-deep/20 bg-void/40 p-3">
          <span class="text-[10px] uppercase tracking-wider text-text-dim">来源输出端口</span>
          <span class="break-all text-text-main">{{ sourcePort }}</span>
        </div>
        <div class="grid gap-1 border border-neon-deep/20 bg-void/40 p-3">
          <span class="text-[10px] uppercase tracking-wider text-text-dim">目标输入端口</span>
          <span class="break-all text-text-main">{{ targetPort }}</span>
        </div>
      </div>

      <footer class="flex justify-between gap-2 border-t border-neon-muted/20 bg-void/40 px-4 py-3">
        <button
          type="button"
          class="border border-danger/50 bg-danger/10 px-3 py-1.5 font-mono text-xs text-danger transition-colors hover:bg-danger/20"
          @click="handleDelete"
        >
          删除连线
        </button>
        <button
          type="button"
          class="border border-neon bg-neon/10 px-3 py-1.5 font-mono text-xs text-neon transition-colors hover:bg-neon/20"
          @click="handleClose"
        >
          完成
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Edge } from '@vue-flow/core'

const props = defineProps<{
  open: boolean
  edge: Edge | null
  onDelete: (edgeId: string) => void
  onClose: () => void
}>()

const sourcePort = computed(() => props.edge?.sourceHandle ?? 'raw')
const targetPort = computed(() => {
  const dataInputName = props.edge?.data?.inputName
  if (typeof dataInputName === 'string' && dataInputName.trim()) return dataInputName.trim()
  return props.edge?.targetHandle && props.edge.targetHandle !== 'input'
    ? props.edge.targetHandle
    : 'value'
})

function handleDelete() {
  if (!props.edge) return
  props.onDelete(props.edge.id)
  props.onClose()
}

function handleClose() {
  props.onClose()
}
</script>
