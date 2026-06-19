<template>
  <div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <!-- Header -->
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="retro-focus grid h-7 w-7 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          title="返回提供商管理"
          @click="emit('back')"
        >
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
        </button>
        <div class="min-w-0">
          <p class="font-mono text-[10px] uppercase tracking-wider text-neon">模型配置</p>
          <h2 class="truncate text-sm font-bold text-text-main">{{ provider?.name || "未命名服务商" }} · 模型</h2>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs disabled:opacity-45"
          :disabled="fetchingModels || !provider?.baseUrl || !provider?.apiKey"
          @click="emit('fetchModels')"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': fetchingModels }" aria-hidden="true" />
          拉取模型
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="!provider"
          @click="emit('addModel')"
        >
          <Plus class="h-3.5 w-3.5" aria-hidden="true" />
          添加模型
        </button>
      </div>
    </header>

    <!-- Body: model table + param sidebar -->
    <div v-if="provider" class="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] overflow-hidden">
      <!-- Model table -->
      <section class="grid min-h-0 content-start overflow-auto p-3">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div class="grid gap-1">
            <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">回退策略</Label>
            <Select
              :model-value="provider.fallbackStrategy"
              @update:model-value="(value) => emit('setStrategy', value as 'primary-only' | 'ordered')"
            >
              <SelectTrigger class="h-8 w-[180px]">
                <SelectValue placeholder="选择回退策略" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary-only">仅主模型</SelectItem>
                <SelectItem value="ordered">按顺序回退</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="font-mono text-[10px] text-text-dim/80">
            {{ fetchedSummary }}
          </p>
        </div>

        <div class="border border-neon-deep/35 bg-panel/40">
          <div class="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-2 border-b border-neon-deep/25 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-text-dim">
            <span class="w-8 text-center">序</span>
            <span>模型</span>
            <span class="w-16 text-center">状态</span>
            <span class="w-24 text-right">操作</span>
          </div>

          <button
            v-for="(model, index) in provider.models"
            :key="model.id"
            type="button"
            class="retro-focus grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-neon-deep/15 px-3 py-2 text-left transition-colors last:border-b-0"
            :class="model.id === selectedModelId ? 'bg-neon/10' : 'hover:bg-panel/50'"
            @click="selectedModelId = model.id"
          >
            <span class="w-8 text-center font-mono text-[11px] text-text-dim">{{ index + 1 }}</span>
            <span class="min-w-0">
              <span class="block truncate font-mono text-xs text-text-main">{{ model.id }}</span>
              <span class="block font-mono text-[10px] text-text-dim/80">{{ roleLabel(index) }}</span>
            </span>
            <span class="flex w-16 items-center justify-center" @click.stop>
              <Switch
                :model-value="model.enabled"
                @update:model-value="(value) => emit('patchModel', { id: model.id, patch: { enabled: Boolean(value) } })"
              />
            </span>
            <span class="flex w-24 items-center justify-end gap-1">
              <button
                type="button"
                class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon disabled:opacity-30"
                :disabled="index === 0"
                title="上移"
                @click.stop="emit('moveModel', { id: model.id, direction: 'up' })"
              >
                <ChevronUp class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon disabled:opacity-30"
                :disabled="index === provider.models.length - 1"
                title="下移"
                @click.stop="emit('moveModel', { id: model.id, direction: 'down' })"
              >
                <ChevronDown class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="retro-focus grid h-6 w-6 place-items-center border border-danger/40 bg-danger/8 text-danger/85 transition-colors hover:bg-danger/20 hover:text-danger"
                :disabled="provider.models.length <= 1"
                title="删除模型"
                @click.stop="emit('deleteModel', model.id)"
              >
                <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          </button>

          <div
            v-if="provider.models.length === 0"
            class="grid place-items-center px-3 py-10 text-center"
          >
            <div class="grid max-w-xs gap-2">
              <p class="font-mono text-xs text-text-dim">尚未添加模型</p>
              <p class="text-xs leading-5 text-text-dim/80">先填写接口地址与 API 密钥，拉取模型后添加，或手动输入模型 id。</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Param sidebar -->
      <aside class="grid min-h-0 content-start overflow-auto border-l border-neon-deep/30 bg-[#2a271f] p-4">
        <div v-if="selectedModel" class="grid content-start gap-3">
          <div class="border-b border-neon-deep/25 pb-2">
            <p class="font-mono text-[10px] uppercase tracking-wider text-neon">参数</p>
            <p class="mt-1 truncate font-mono text-xs text-text-main">{{ selectedModel.id }}</p>
          </div>
          <ModelParamEditor
            :model-config="selectedModel"
            @update="applyParamUpdate"
          />
        </div>
        <div v-else class="grid h-full place-items-center">
          <p class="text-center text-xs text-text-dim/70">选择左侧模型以编辑参数</p>
        </div>
      </aside>
    </div>

    <div v-else class="grid h-full place-items-center p-6">
      <p class="text-sm text-text-dim">未选择服务商预设。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-vue-next"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import ModelParamEditor from "./ModelParamEditor.vue"
import type { BrowserAiProviderPreset, BrowserAiModelParameters } from "@/config/ai"

const props = defineProps<{
  provider: BrowserAiProviderPreset | null
  fetchingModels: boolean
}>()

const emit = defineEmits<{
  (e: "back"): void
  (e: "fetchModels"): void
  (e: "addModel"): void
  (e: "deleteModel", id: string): void
  (e: "moveModel", payload: { id: string; direction: "up" | "down" }): void
  (e: "patchModel", payload: { id: string; patch: Partial<{ enabled: boolean; parameters: BrowserAiModelParameters }> }): void
  (e: "setStrategy", strategy: "primary-only" | "ordered"): void
}>()

const selectedModelId = ref<string>("")

const selectedModel = computed(
  () => props.provider?.models.find((model) => model.id === selectedModelId.value) ?? null,
)

function applyParamUpdate(patch: Partial<BrowserAiModelParameters>): void {
  const model = selectedModel.value
  if (!model) {
    return
  }
  emit("patchModel", {
    id: model.id,
    patch: { parameters: { ...model.parameters, ...patch } },
  })
}

// Keep a valid selection: default to the first model, and reselect if the
// current one is removed.
watch(
  () => props.provider?.models,
  (models) => {
    if (!models || models.length === 0) {
      selectedModelId.value = ""
      return
    }
    if (!models.some((model) => model.id === selectedModelId.value)) {
      selectedModelId.value = models[0].id
    }
  },
  { immediate: true },
)

function roleLabel(index: number): string {
  if (index === 0) {
    return "主模型"
  }
  return props.provider?.fallbackStrategy === "ordered" ? `回退 #${index}` : "回退(未启用)"
}

const fetchedSummary = computed(() => {
  const provider = props.provider
  if (!provider) {
    return ""
  }
  if (props.fetchingModels) {
    return "正在拉取模型..."
  }
  if (provider.fetchedModels.length > 0) {
    return `${provider.fetchedModels.length} 个可选 · ${formatFetchedAt(provider.modelsFetchedAt)}`
  }
  return "尚未拉取模型"
})

function formatFetchedAt(value: string): string {
  if (!value) {
    return "刚刚"
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "刚刚" : date.toLocaleString()
}
</script>
