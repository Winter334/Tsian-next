<template>
  <FloatingWindow
    title="选择安装目标"
    width-class="max-w-xl"
    overlay="dim"
    :close-on-overlay-click="true"
    @close="$emit('close')"
  >
    <div class="grid max-h-[min(72vh,34rem)] min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
      <header class="min-w-0 border-b border-neon-deep/30 pb-3">
        <h2 class="truncate text-base font-bold text-text-main">{{ state.pkg.name }}</h2>
        <p class="mt-1 truncate font-mono text-[11px] text-text-dim">{{ state.pkg.resourceId }}</p>
      </header>

      <div v-if="state.options.length === 0" class="py-8 text-center text-sm text-text-dim">
        没有可用的安装目标。
      </div>
      <div v-else class="min-h-0 overflow-y-auto pr-1">
        <div class="grid gap-2">
          <button
            v-for="option in state.options"
            :key="option.key"
            type="button"
            class="retro-focus grid min-w-0 gap-1 border p-3 text-left"
            :class="option.severity === 'danger'
              ? 'border-danger/50 bg-danger/10 text-danger hover:border-danger'
              : 'border-neon-deep/35 bg-elevated/60 text-text-main hover:border-neon-deep'"
            @click="$emit('select', option)"
          >
            <span class="min-w-0 truncate font-mono text-xs font-bold">{{ option.label }}</span>
            <span class="break-words text-xs leading-5 text-text-dim">{{ option.description }}</span>
          </button>
        </div>
      </div>
    </div>
  </FloatingWindow>
</template>

<script setup lang="ts">
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import type { MarketInstallDialogState, MarketInstallTargetOption } from "./types"

defineProps<{
  state: MarketInstallDialogState
}>()

defineEmits<{
  close: []
  select: [option: MarketInstallTargetOption]
}>()
</script>
