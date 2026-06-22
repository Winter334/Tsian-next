<template>
  <div
    v-if="hasActions || hasSlot"
    class="retro-toolbar flex min-h-9 flex-wrap items-center gap-2 border-b px-3 py-1.5"
  >
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="(action, index) in actions"
        :key="index"
        type="button"
        class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
        :class="action.variant === 'danger' ? 'text-danger hover:bg-danger/10' : ''"
        :disabled="action.disabled || action.loading"
        @click="action.onClick"
      >
        <component :is="action.icon" class="h-3.5 w-3.5" aria-hidden="true" />
        {{ action.label }}
      </button>
    </div>
    <div v-if="hasSlot" class="ml-auto min-w-0">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useSlots, type Component } from "vue"

export interface ViewActionBarAction {
  label: string
  icon: Component
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  variant?: "default" | "danger"
}

const props = defineProps<{
  actions: ViewActionBarAction[]
}>()

const slots = useSlots()
const hasSlot = computed(() => Boolean(slots.default))
const hasActions = computed(() => props.actions.length > 0)
</script>
