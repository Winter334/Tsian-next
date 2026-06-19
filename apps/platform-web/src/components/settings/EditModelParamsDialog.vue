<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[60] grid place-items-center bg-black/55 p-4"
      @click.self="cancel"
    >
      <div
        class="flex max-h-[85vh] w-full max-w-lg flex-col border border-neon/40 bg-[#2d2a23] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.5)]"
        role="dialog"
        aria-modal="true"
        aria-label="编辑模型参数"
      >
        <p class="font-mono text-xs uppercase tracking-wider text-neon">模型参数 · {{ modelId }}</p>

        <div class="mt-3 grid min-h-0 flex-1 overflow-auto p-1.5">
          <ModelParamsFields
            :parameters="params"
            :kind="kind"
            @update:parameters="params = $event"
          />
        </div>

        <p v-if="error" class="mt-2 font-mono text-[11px] text-danger">{{ error }}</p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
            @click="cancel"
          >
            取消
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
            @click="confirm"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import ModelParamsFields from "./ModelParamsFields.vue"
import {
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
} from "@/config/ai"

const props = defineProps<{
  open: boolean
  modelId: string
  kind: BrowserAiProviderKind
  initialParameters: BrowserAiModelParameters
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "confirm", parameters: BrowserAiModelParameters): void
}>()

const params = ref<BrowserAiModelParameters>({ ...props.initialParameters })
const error = ref("")

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      // Fresh copy so cancel discards edits.
      params.value = { ...props.initialParameters }
      error.value = ""
    }
  },
)

function cancel(): void {
  emit("update:open", false)
}

function confirm(): void {
  emit("confirm", params.value)
  emit("update:open", false)
}
</script>
