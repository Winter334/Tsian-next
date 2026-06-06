<template>
  <div
    v-if="open && edge"
    class="fixed inset-0 z-[70] flex items-center justify-center bg-void/75 p-4 backdrop-blur"
    role="dialog"
    aria-modal="true"
    aria-label="边配置"
    @click.self="handleClose"
  >
    <section class="w-[min(560px,calc(100vw-2rem))] overflow-hidden border border-neon-muted/50 bg-panel shadow-2xl">
      <header class="flex items-center justify-between gap-3 border-b border-neon-muted/30 px-4 py-3">
        <div class="min-w-0">
          <p class="font-mono text-[10px] uppercase tracking-[0.3em] text-neon-muted">
            EDGE // CONFIG
          </p>
          <p class="mt-1 break-all font-mono text-xs text-text-main">
            {{ edge.source }} → {{ edge.target }}
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

      <div class="grid gap-4 p-4">
        <label class="grid gap-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
          输入变量名 varName
          <input
            v-model="varName"
            type="text"
            class="border border-neon-deep/40 bg-void px-3 py-2 font-mono text-xs normal-case tracking-normal text-text-main outline-none focus:border-neon"
          />
        </label>

        <label class="grid gap-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
          条件 condition
          <input
            v-model="condition"
            type="text"
            class="border border-neon-deep/40 bg-void px-3 py-2 font-mono text-xs normal-case tracking-normal text-text-main outline-none focus:border-neon"
            placeholder="可选"
          />
        </label>
      </div>

      <footer class="flex justify-between gap-2 border-t border-neon-muted/20 bg-void/40 px-4 py-3">
        <button
          type="button"
          class="border border-danger/50 bg-danger/10 px-3 py-1.5 font-mono text-xs text-danger transition-colors hover:bg-danger/20"
          @click="handleDelete"
        >
          删除边
        </button>
        <button
          type="button"
          class="border border-neon bg-neon/10 px-3 py-1.5 font-mono text-xs text-neon transition-colors hover:bg-neon/20"
          @click="handleSave"
        >
          应用
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Edge } from '@vue-flow/core'

const props = defineProps<{
  open: boolean
  edge: Edge | null
  onUpdate: (edgeId: string, data: { varName?: string; condition?: string }) => void
  onDelete: (edgeId: string) => void
  onClose: () => void
}>()

const varName = ref('value')
const condition = ref('')

function resetDraft() {
  varName.value = typeof props.edge?.data?.varName === 'string'
    ? props.edge.data.varName
    : 'value'
  condition.value = typeof props.edge?.data?.condition === 'string'
    ? props.edge.data.condition
    : ''
}

function handleSave() {
  if (!props.edge) return
  props.onUpdate(props.edge.id, {
    varName: varName.value.trim() || 'value',
    condition: condition.value.trim(),
  })
  props.onClose()
}

function handleDelete() {
  if (!props.edge) return
  props.onDelete(props.edge.id)
  props.onClose()
}

function handleClose() {
  props.onClose()
}

watch(
  () => [props.open, props.edge?.id],
  () => {
    if (props.open) resetDraft()
  },
  { immediate: true },
)
</script>
