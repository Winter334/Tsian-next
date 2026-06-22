<template>
  <div
    v-if="state"
    class="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4"
    @click.self="cancel"
  >
    <div
      class="w-full max-w-sm border bg-[#2d2a23] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
      :class="isDanger ? 'border-danger/55' : 'border-neon/40'"
      role="dialog"
      aria-modal="true"
      :aria-label="state.options.title"
    >
      <div class="flex items-start gap-2.5">
        <span
          class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center"
          :class="isDanger ? 'text-danger' : 'text-neon'"
          aria-hidden="true"
        >
          <TriangleAlert v-if="isDanger" class="h-5 w-5" />
          <HelpCircle v-else class="h-5 w-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p
            class="font-mono text-xs uppercase tracking-wider"
            :class="isDanger ? 'text-danger' : 'text-neon'"
          >
            {{ state.options.title }}
          </p>
          <p v-if="state.kind === 'confirm' || state.options.message" class="mt-2 whitespace-pre-line text-sm leading-6 text-text-main">
            {{ state.options.message }}
          </p>
        </div>
      </div>

      <!-- Prompt input -->
      <div v-if="state.kind === 'prompt'" class="mt-3">
        <input
          ref="promptInputRef"
          v-model="promptValue"
          class="retro-focus w-full border bg-panel/55 px-3 py-2 text-sm text-text-main placeholder:text-text-dim"
          :class="promptError ? 'border-danger/55' : 'border-neon-deep/40 focus:border-neon/55'"
          :placeholder="state.options.placeholder"
          @keydown.enter.prevent="confirmAction"
          @keydown.esc.prevent="cancel"
        />
        <p v-if="promptError" class="mt-1.5 font-mono text-[11px] text-danger">{{ promptError }}</p>
      </div>

      <div class="mt-4 flex justify-end gap-2">
        <button
          ref="cancelButtonRef"
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
          @click="cancel"
        >
          {{ state.options.cancelText }}
        </button>
        <template v-if="state.kind === 'choice'">
          <button
            v-for="option in state.options.options"
            :key="option.value"
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
            :class="option.severity === 'danger' ? 'border-danger/70 text-danger hover:!border-danger hover:!text-danger' : ''"
            @click="resolveConfirm(option.value)"
          >
            {{ option.label }}
          </button>
        </template>
        <button
          v-else
          ref="confirmButtonRef"
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
          :class="isDanger ? 'border-danger/70 text-danger hover:!border-danger hover:!text-danger' : ''"
          @click="confirmAction"
        >
          {{ state.options.confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { HelpCircle, TriangleAlert } from "lucide-vue-next"
import { resolveConfirm, useConfirmState } from "@/composables/useConfirm"

const state = useConfirmState()

const promptInputRef = ref<HTMLInputElement | null>(null)
const cancelButtonRef = ref<HTMLButtonElement | null>(null)
const confirmButtonRef = ref<HTMLButtonElement | null>(null)
const promptValue = ref("")
const promptError = ref("")

const isDanger = computed(
  () => state.value?.kind === "confirm" && state.value.options.severity === "danger",
)

watch(
  () => state.value,
  (current) => {
    promptError.value = ""
    if (current?.kind === "prompt") {
      promptValue.value = current.options.defaultValue
      nextTick(() => promptInputRef.value?.focus())
    } else if (current?.kind === "confirm" || current?.kind === "choice") {
      // Focus the cancel button by default so accidental Enter does not confirm
      // a destructive action; the user must tab/click to confirm.
      nextTick(() => cancelButtonRef.value?.focus())
    }
  },
)

function cancel(): void {
  promptError.value = ""
  if (state.value?.kind === "prompt" || state.value?.kind === "choice") {
    resolveConfirm(null)
  } else {
    resolveConfirm(false)
  }
}

function confirmAction(): void {
  const current = state.value
  if (!current) {
    return
  }
  if (current.kind === "prompt") {
    const error = current.options.validate(promptValue.value)
    if (error) {
      promptError.value = error
      return
    }
    resolveConfirm(promptValue.value)
  } else {
    resolveConfirm(true)
  }
}
</script>
