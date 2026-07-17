<template>
  <FloatingWindow
    v-if="open"
    :title="`模型参数 · ${modelId}`"
    width-class="max-w-2xl"
    @close="cancel"
  >
    <div class="flex max-h-[78vh] min-h-0 flex-col">
      <div class="grid min-h-0 flex-1 overflow-auto p-1.5">
        <ModelParamsFields
          :parameters="params"
          :kind="kind"
          :tool-call-mode="toolCallMode"
          :streaming="streaming"
          :model-id="modelId"
          :test-model="testModel"
          :test-tool-calling="testToolCalling"
          @update:parameters="params = $event"
          @update:tool-call-mode="toolCallMode = $event"
          @update:streaming="streaming = $event"
        />
      </div>

      <p v-if="error" class="mt-2 font-mono text-[11px] text-danger">{{ error }}</p>

      <div class="mt-4 flex justify-end gap-2 border-t border-neon-deep/30 pt-3">
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
  </FloatingWindow>
</template>

<script setup lang="ts">
import { ref, watch } from "vue"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import ModelParamsFields from "./ModelParamsFields.vue"
import {
  cloneBrowserAiModelParameters,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiToolCallMode,
} from "@/config/ai"

const props = defineProps<{
  open: boolean
  modelId: string
  kind: BrowserAiProviderKind
  initialParameters: BrowserAiModelParameters
  initialToolCallMode: BrowserAiToolCallMode
  initialStreaming: boolean
  testModel?: (payload: {
    modelId: string
    parameters: BrowserAiModelParameters
    toolCallMode: BrowserAiToolCallMode
    streaming: boolean
  }) => Promise<{ ok: boolean; message: string }>
  testToolCalling?: (payload: {
    modelId: string
    parameters: BrowserAiModelParameters
    toolCallMode: BrowserAiToolCallMode
    streaming: boolean
  }) => Promise<{ ok: boolean; message: string }>
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "confirm", payload: { parameters: BrowserAiModelParameters; toolCallMode: BrowserAiToolCallMode; streaming: boolean }): void
}>()

const params = ref<BrowserAiModelParameters>(cloneBrowserAiModelParameters(props.initialParameters))
const toolCallMode = ref<BrowserAiToolCallMode>(props.initialToolCallMode)
const streaming = ref<boolean>(props.initialStreaming)
const error = ref("")

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      params.value = cloneBrowserAiModelParameters(props.initialParameters)
      toolCallMode.value = props.initialToolCallMode
      streaming.value = props.initialStreaming
      error.value = ""
    }
  },
)

function cancel(): void {
  emit("update:open", false)
}

function confirm(): void {
  emit("confirm", {
    parameters: cloneBrowserAiModelParameters(params.value),
    toolCallMode: toolCallMode.value,
    streaming: streaming.value,
  })
  emit("update:open", false)
}
</script>
