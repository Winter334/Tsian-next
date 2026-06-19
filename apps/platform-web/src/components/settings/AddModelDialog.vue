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
      aria-label="添加模型"
    >
      <p class="font-mono text-xs uppercase tracking-wider text-neon">添加模型</p>

      <div class="mt-3 grid min-h-0 flex-1 gap-3 overflow-auto p-1.5">
        <!-- Model id + fetch -->
        <div class="grid gap-2">
          <label class="grid gap-1.5">
            <span class="font-mono text-[11px] uppercase tracking-wider text-text-dim">模型 id</span>
            <input
              ref="inputRef"
              v-model="modelId"
              type="text"
              placeholder="例如 glm-5.2、gpt-4o"
              class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              @keydown.enter.prevent="confirm"
              @keydown.esc.prevent="cancel"
            />
          </label>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="retro-button retro-focus inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider disabled:opacity-45"
              :disabled="fetching || !canFetch"
              @click="fetchModels"
            >
              <RefreshCw class="h-3 w-3" :class="{ 'animate-spin': fetching }" aria-hidden="true" />
              拉取模型列表
            </button>
            <span v-if="fetchError" class="font-mono text-[10px] text-danger">{{ fetchError }}</span>
            <span v-else-if="fetched.length > 0" class="font-mono text-[10px] text-text-dim/80">{{ fetched.length }} 个可选</span>
          </div>

          <div v-if="fetched.length > 0" class="max-h-44 overflow-auto border border-neon-deep/30 bg-panel/40">
            <button
              v-for="entry in fetched"
              :key="entry.id"
              type="button"
              class="retro-focus block w-full px-3 py-1.5 text-left font-mono text-[11px] text-text-dim transition-colors hover:bg-neon/10 hover:text-neon"
              @click="modelId = entry.id"
            >
              {{ entry.id }}
            </button>
          </div>
        </div>

        <!-- Inline parameter form (config-on-add, saves a step) -->
        <div class="grid min-h-0 flex-1 overflow-auto p-1.5">
          <ModelParamsFields
            :parameters="params"
            :kind="kind"
            :tool-call-mode="toolCallMode"
            @update:parameters="params = $event"
            @update:tool-call-mode="toolCallMode = $event"
          />
        </div>
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
          添加
        </button>
      </div>
    </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { RefreshCw } from "lucide-vue-next"
import ModelParamsFields from "./ModelParamsFields.vue"
import {
  createDefaultBrowserAiModelParameters,
  fetchBrowserAiProviderModels,
  type BrowserAiModelEntry,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiProviderPreset,
  type BrowserAiToolCallMode,
} from "@/config/ai"

const props = defineProps<{
  open: boolean
  preset: BrowserAiProviderPreset | null
  kind: BrowserAiProviderKind
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "confirm", payload: { id: string; parameters: BrowserAiModelParameters; toolCallMode: BrowserAiToolCallMode }): void
}>()

const modelId = ref("")
const fetched = ref<BrowserAiModelEntry[]>([])
const fetching = ref(false)
const fetchError = ref("")
const error = ref("")
const inputRef = ref<HTMLInputElement | null>(null)
const params = ref<BrowserAiModelParameters>(createDefaultBrowserAiModelParameters())
const toolCallMode = ref<BrowserAiToolCallMode>("text")

const canFetch = computed(
  () => Boolean(props.preset?.baseUrl.trim() && props.preset?.apiKey.trim()),
)

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      modelId.value = ""
      fetched.value = []
      fetchError.value = ""
      error.value = ""
      params.value = createDefaultBrowserAiModelParameters()
      toolCallMode.value = "text"
      nextTick(() => inputRef.value?.focus())
    }
  },
)

async function fetchModels(): Promise<void> {
  const preset = props.preset
  if (!preset || fetching.value) {
    return
  }
  fetching.value = true
  fetchError.value = ""
  try {
    const models = await fetchBrowserAiProviderModels({ ...preset, kind: props.kind })
    fetched.value = models
  } catch (e) {
    fetchError.value = e instanceof Error ? e.message : "拉取模型失败。"
    fetched.value = []
  } finally {
    fetching.value = false
  }
}

function cancel(): void {
  emit("update:open", false)
}

function toNumberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === "") {
    return null
  }
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

function confirm(): void {
  const id = modelId.value.trim()
  if (!id) {
    error.value = "请填写或选择模型 id。"
    return
  }
  // Normalize numeric strings from the number inputs back to numbers/null.
  const normalized: BrowserAiModelParameters = {
    contextWindow: toNumberOrNull(String(params.value.contextWindow ?? "")),
    maxOutputTokens: toNumberOrNull(String(params.value.maxOutputTokens ?? "")),
    temperature: toNumberOrNull(String(params.value.temperature ?? "")),
    topP: toNumberOrNull(String(params.value.topP ?? "")),
    frequencyPenalty: toNumberOrNull(String(params.value.frequencyPenalty ?? "")),
    presencePenalty: toNumberOrNull(String(params.value.presencePenalty ?? "")),
    reasoningEffort: params.value.reasoningEffort,
    customRequestParamsText: params.value.customRequestParamsText,
  }
  emit("confirm", { id, parameters: normalized, toolCallMode: toolCallMode.value })
  emit("update:open", false)
}
</script>
