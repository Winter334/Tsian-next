<template>
  <FloatingWindow
    v-if="open"
    title="添加模型"
    width-class="max-w-2xl"
    @close="cancel"
  >
    <div class="flex max-h-[78vh] min-h-0 flex-col">
      <div class="grid min-h-0 flex-1 gap-3 overflow-auto p-1.5">
        <div class="grid gap-2 border border-neon-deep/30 bg-panel/35 p-3">
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

          <div class="flex flex-wrap items-center gap-2">
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
            <span v-else-if="fetched.length > 0" class="font-mono text-[10px] text-text-dim/80">
              {{ searchQuery ? `${filteredFetched.length} / ${fetched.length}` : `${fetched.length}` }} 个可选
            </span>
          </div>

          <div v-if="fetched.length > 0" class="grid gap-2">
            <label class="relative grid">
              <Search
                class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-dim/60"
                aria-hidden="true"
              />
              <input
                v-model="searchQuery"
                type="text"
                placeholder="搜索模型 id…"
                class="retro-focus retro-select-surface w-full border border-neon-deep/45 bg-elevated py-1.5 pl-8 pr-3 font-mono text-[11px] text-text-main placeholder:text-text-dim/60"
              />
            </label>

            <div class="max-h-44 overflow-auto border border-neon-deep/30 bg-panel/40">
              <button
                v-for="entry in filteredFetched"
                :key="entry.id"
                type="button"
                class="retro-focus block w-full px-3 py-1.5 text-left font-mono text-[11px] text-text-dim transition-colors hover:bg-neon/10 hover:text-neon"
                @click="modelId = entry.id"
              >
                {{ entry.id }}
              </button>
              <p v-if="filteredFetched.length === 0" class="px-3 py-2 font-mono text-[11px] text-text-dim/60">
                没有匹配的模型。
              </p>
            </div>
          </div>
        </div>

        <ModelParamsFields
          :parameters="params"
          :kind="kind"
          :tool-call-mode="toolCallMode"
          :streaming="streaming"
          :model-id="modelId"
          :test-model="testModel"
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
          添加
        </button>
      </div>
    </div>
  </FloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { RefreshCw, Search } from "lucide-vue-next"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import ModelParamsFields from "./ModelParamsFields.vue"
import {
  cloneBrowserAiModelParameters,
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
  testModel?: (payload: {
    modelId: string
    parameters: BrowserAiModelParameters
    toolCallMode: BrowserAiToolCallMode
    streaming: boolean
  }) => Promise<{ ok: boolean; message: string }>
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "confirm", payload: { id: string; parameters: BrowserAiModelParameters; toolCallMode: BrowserAiToolCallMode; streaming: boolean }): void
}>()

const modelId = ref("")
const fetched = ref<BrowserAiModelEntry[]>([])
const searchQuery = ref("")
const fetching = ref(false)
const fetchError = ref("")
const error = ref("")
const inputRef = ref<HTMLInputElement | null>(null)
const params = ref<BrowserAiModelParameters>(createDefaultBrowserAiModelParameters())
const toolCallMode = ref<BrowserAiToolCallMode>("text")
const streaming = ref(false)

const canFetch = computed(
  () => Boolean(props.preset?.baseUrl.trim() && props.preset?.apiKey.trim()),
)

const filteredFetched = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) {
    return fetched.value
  }
  return fetched.value.filter((entry) => entry.id.toLowerCase().includes(q))
})

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      modelId.value = ""
      fetched.value = []
      searchQuery.value = ""
      fetchError.value = ""
      error.value = ""
      params.value = createDefaultBrowserAiModelParameters()
      toolCallMode.value = "text"
      streaming.value = false
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
  searchQuery.value = ""
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

function confirm(): void {
  const id = modelId.value.trim()
  if (!id) {
    error.value = "请填写或选择模型 id。"
    return
  }
  emit("confirm", {
    id,
    parameters: cloneBrowserAiModelParameters(params.value),
    toolCallMode: toolCallMode.value,
    streaming: streaming.value,
  })
  emit("update:open", false)
}
</script>
