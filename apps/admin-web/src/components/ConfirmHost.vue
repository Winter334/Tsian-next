<template>
  <div v-if="state" class="confirm-layer" role="presentation" @click.self="cancel">
    <section
      class="confirm-dialog"
      :class="{ 'confirm-dialog--danger': state.severity === 'danger' }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-confirm-title"
      aria-describedby="admin-confirm-message"
      @keydown.esc.prevent="cancel"
    >
      <div class="confirm-dialog__icon" aria-hidden="true">
        <TriangleAlert v-if="state.severity === 'danger'" :size="22" />
        <HelpCircle v-else :size="22" />
      </div>
      <div class="confirm-dialog__body">
        <p class="eyebrow">Confirm</p>
        <h2 id="admin-confirm-title">{{ state.title }}</h2>
        <p id="admin-confirm-message">{{ state.message }}</p>
      </div>
      <footer class="confirm-dialog__actions">
        <button ref="cancelButtonRef" type="button" class="button" @click="cancel">
          {{ state.cancelText }}
        </button>
        <button
          type="button"
          class="button"
          :class="state.severity === 'danger' ? 'button--danger' : ''"
          @click="resolveConfirm(true)"
        >
          {{ state.confirmText }}
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue"
import { HelpCircle, TriangleAlert } from "lucide-vue-next"
import { resolveConfirm, useConfirmState } from "@/composables/useConfirm"

const state = useConfirmState()
const cancelButtonRef = ref<HTMLButtonElement | null>(null)

watch(
  () => state.value,
  (current) => {
    if (current) {
      nextTick(() => cancelButtonRef.value?.focus())
    }
  },
)

function cancel(): void {
  resolveConfirm(false)
}
</script>
