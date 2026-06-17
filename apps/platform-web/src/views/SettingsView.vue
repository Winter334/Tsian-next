<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Control Panel</p>
        <h1 class="truncate text-base font-bold text-text-main">控制面板</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs"
          :class="effectiveChatConfig ? 'border-neon/45 bg-neon/10 text-neon' : 'border-warning/45 bg-warning/10 text-warning'"
        >
          <CheckCircle2 v-if="effectiveChatConfig" class="h-3.5 w-3.5" aria-hidden="true" />
          <AlertTriangle v-else class="h-3.5 w-3.5" aria-hidden="true" />
          {{ effectiveChatConfig ? "模型已配置" : "模型未配置" }}
        </span>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="handleSaveSettings"
        >
          <Save class="h-3.5 w-3.5" aria-hidden="true" />
          保存
        </button>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          @click="handleResetSettings"
        >
          <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
          重置
        </button>
      </div>
    </header>

    <main class="min-h-0 overflow-auto p-3">
      <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section class="retro-inset grid content-start gap-4 p-4">
          <div class="border-b border-neon-deep/25 pb-4">
            <p class="font-mono text-xs uppercase tracking-wider text-neon">Agent Provider</p>
            <h2 class="mt-1 text-sm font-bold text-text-main">OpenAI 兼容服务商</h2>
          </div>

          <div class="grid gap-2">
            <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">服务商</Label>
            <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
              <Select v-if="providerCount > 0" v-model="selectedProviderId">
                <SelectTrigger class="retro-focus h-9 border-neon-deep/55 bg-elevated font-mono text-xs text-text-main">
                  <SelectValue placeholder="选择服务商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="provider in platformConfigDraft.providers"
                    :key="provider.id"
                    :value="provider.id"
                  >
                    {{ provider.name || "未命名服务商" }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <div
                v-else
                class="grid h-9 items-center border border-neon-deep/35 bg-panel/55 px-3 font-mono text-xs text-text-dim"
              >
                尚无本地预设
              </div>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-3 font-mono text-xs"
                @click="addProvider"
              >
                <Plus class="h-3.5 w-3.5" aria-hidden="true" />
                新增
              </button>
              <button
                type="button"
                class="retro-button retro-focus inline-flex h-9 items-center justify-center gap-2 px-3 font-mono text-xs disabled:opacity-45"
                :disabled="!activeProvider"
                @click="deleteActiveProvider"
              >
                <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
                删除
              </button>
            </div>
          </div>

          <div v-if="activeProvider" class="grid gap-4">
            <div class="grid gap-3 md:grid-cols-2">
              <div class="grid gap-2">
                <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">预设名称</Label>
                <Input
                  v-model="activeProvider.name"
                  type="text"
                  placeholder="OpenAI 兼容服务"
                  class="retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                />
              </div>
              <div class="grid gap-2">
                <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">接口地址</Label>
                <Input
                  v-model="activeProvider.baseUrl"
                  type="text"
                  placeholder="https://example.com/v1"
                  class="retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                />
              </div>
            </div>

            <div class="grid gap-2">
              <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">API 密钥</Label>
              <Input
                v-model="activeProvider.apiKey"
                type="password"
                placeholder="sk-..."
                class="retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </div>

            <div class="grid gap-3 border border-neon-deep/30 bg-panel/50 p-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0">
                  <Label class="font-mono text-xs uppercase tracking-wider text-text-dim">模型</Label>
                  <p class="mt-1 truncate font-mono text-[11px] text-text-dim">{{ modelFetchSummary }}</p>
                </div>
                <button
                  type="button"
                  class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs disabled:opacity-45"
                  :disabled="fetchingModels"
                  @click="handleFetchModels"
                >
                  <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': fetchingModels }" aria-hidden="true" />
                  拉取模型
                </button>
              </div>

              <div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div class="grid gap-2">
                  <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">模型列表</Label>
                  <Select v-model="selectedModel" :disabled="modelOptions.length === 0">
                    <SelectTrigger class="retro-focus h-9 border-neon-deep/55 bg-elevated font-mono text-xs text-text-main">
                      <SelectValue placeholder="暂无模型列表" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        v-for="model in modelOptions"
                        :key="model.id"
                        :value="model.id"
                      >
                        {{ model.label || model.id }}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div class="grid gap-2">
                  <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">手动输入</Label>
                  <Input
                    v-model="activeProvider.defaultModel"
                    type="text"
                    placeholder="模型名"
                    class="retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-else class="grid place-items-center border border-neon-deep/30 bg-panel/45 px-4 py-10 text-center">
            <div class="grid max-w-md gap-3">
              <div class="mx-auto grid h-12 w-12 place-items-center border border-neon-deep/45 bg-elevated/50 text-neon">
                <Server class="h-5 w-5" aria-hidden="true" />
              </div>
              <p class="font-mono text-sm font-bold text-text-main">没有本地服务商预设</p>
              <p class="text-sm leading-6 text-text-dim">当前会继续使用环境默认配置；新增预设后可拉取模型并保存为本地默认。</p>
            </div>
          </div>

          <div
            v-if="settingsFeedback || settingsError"
            class="border px-3 py-2 text-sm"
            :class="settingsError ? 'border-danger/45 bg-danger/10 text-danger' : 'border-neon/45 bg-neon/10 text-neon'"
          >
            {{ settingsError || settingsFeedback }}
          </div>
        </section>

        <aside class="retro-inset grid content-start gap-3 p-4">
          <div class="flex items-start gap-3">
            <div class="grid h-12 w-12 shrink-0 place-items-center border border-neon-deep/45 bg-elevated/50 text-neon">
              <SlidersHorizontal class="h-5 w-5" aria-hidden="true" />
            </div>
            <div class="min-w-0">
              <p class="font-mono text-xs uppercase tracking-wider text-neon">模型参数</p>
              <p class="mt-2 text-sm leading-6 text-text-dim">这些参数随当前服务商预设保存。</p>
            </div>
          </div>

          <div v-if="activeProvider" class="grid gap-3">
            <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <ModelNumberField
                label="上下文窗口"
                placeholder="例如 128000"
                :model-value="parameterValue('contextWindow')"
                @update:model-value="setNumberParameter('contextWindow', $event)"
              />
              <ModelNumberField
                label="最大输出 token"
                placeholder="例如 4096"
                :model-value="parameterValue('maxOutputTokens')"
                @update:model-value="setNumberParameter('maxOutputTokens', $event)"
              />
              <ModelNumberField
                label="温度"
                placeholder="0 - 2"
                step="0.1"
                :model-value="parameterValue('temperature')"
                @update:model-value="setNumberParameter('temperature', $event)"
              />
              <ModelNumberField
                label="top_p"
                placeholder="0 - 2"
                step="0.1"
                :model-value="parameterValue('topP')"
                @update:model-value="setNumberParameter('topP', $event)"
              />
              <ModelNumberField
                label="频率惩罚"
                placeholder="-2 - 2"
                step="0.1"
                :model-value="parameterValue('frequencyPenalty')"
                @update:model-value="setNumberParameter('frequencyPenalty', $event)"
              />
              <ModelNumberField
                label="存在惩罚"
                placeholder="-2 - 2"
                step="0.1"
                :model-value="parameterValue('presencePenalty')"
                @update:model-value="setNumberParameter('presencePenalty', $event)"
              />
            </div>

            <div class="grid gap-2">
              <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">推理程度</Label>
              <Select v-model="selectedReasoningEffort">
                <SelectTrigger class="retro-focus h-9 border-neon-deep/55 bg-elevated font-mono text-xs text-text-main">
                  <SelectValue placeholder="不发送" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in reasoningEffortOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="grid gap-2">
              <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">自定义请求参数</Label>
              <textarea
                v-model="activeProvider.parameters.customRequestParamsText"
                rows="6"
                spellcheck="false"
                placeholder="{&#10;  &quot;seed&quot;: 42&#10;}"
                class="retro-focus min-h-28 resize-y border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs leading-5 text-text-main placeholder:text-text-dim/60"
              />
            </div>
          </div>

          <div v-else class="border border-neon-deep/30 bg-panel/55 px-3 py-4 text-sm leading-6 text-text-dim">
            新增本地服务商预设后，可以在这里配置模型参数。
          </div>
        </aside>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
      <span class="font-mono text-[11px] text-text-dim">当前模型：{{ chatModelSummary }}</span>
      <span class="inline-flex items-center gap-1 font-mono text-[11px] text-text-dim">
        <KeyRound class="h-3 w-3" aria-hidden="true" />
        API key 不进入游戏卡或导出包
      </span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  SlidersHorizontal,
  Trash2,
} from "lucide-vue-next"
import { computed, defineComponent, h, onMounted, ref } from "vue"
import {
  type BrowserAiConfig,
  type BrowserAiModelEntry,
  type BrowserAiModelParameters,
  type BrowserAiProviderPreset,
  type BrowserAiReasoningEffort,
  type BrowserPlatformConfigDraft,
  createBrowserAiProviderPreset,
  fetchBrowserAiProviderModels,
  getBrowserAiConfig,
  getBrowserPlatformConfigDraft,
  resetBrowserPlatformConfigDraft,
  saveBrowserPlatformConfigDraft,
} from "../config/ai"

type NumericParameterKey = Exclude<
  keyof BrowserAiModelParameters,
  "reasoningEffort" | "customRequestParamsText"
>

const inputClass = "retro-focus h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"

const ModelNumberField = defineComponent({
  props: {
    label: { type: String, required: true },
    modelValue: { type: String, required: true },
    placeholder: { type: String, default: "" },
    step: { type: String, default: "1" },
  },
  emits: ["update:modelValue"],
  setup(props, { emit }) {
    return () => h("div", { class: "grid gap-2" }, [
      h(Label, { class: "font-mono text-[11px] uppercase tracking-wider text-text-dim" }, () => props.label),
      h(Input, {
        class: inputClass,
        modelValue: props.modelValue,
        type: "number",
        step: props.step,
        placeholder: props.placeholder,
        "onUpdate:modelValue": (value: string | number) => emit("update:modelValue", value),
      }),
    ])
  },
})

const effectiveChatConfig = ref<BrowserAiConfig | null>(null)
const platformConfigDraft = ref<BrowserPlatformConfigDraft>(clonePlatformConfigDraft(getBrowserPlatformConfigDraft()))
const chatModelSummary = ref("未配置")
const settingsFeedback = ref("")
const settingsError = ref("")
const fetchingModels = ref(false)

const NO_REASONING_EFFORT = "__none"

const reasoningEffortOptions: Array<{ value: BrowserAiReasoningEffort | typeof NO_REASONING_EFFORT; label: string }> = [
  { value: NO_REASONING_EFFORT, label: "不发送" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
]

const providerCount = computed(() => platformConfigDraft.value.providers.length)

const selectedProviderId = computed({
  get: () => platformConfigDraft.value.activeProviderId,
  set: (value: string) => {
    platformConfigDraft.value.activeProviderId = value
    clearFeedback()
  },
})

const activeProvider = computed(() => {
  return platformConfigDraft.value.providers.find((provider) => provider.id === selectedProviderId.value) ?? null
})

const selectedModel = computed({
  get: () => activeProvider.value?.defaultModel ?? "",
  set: (value: string) => {
    if (!activeProvider.value) {
      return
    }
    activeProvider.value.defaultModel = value
    clearFeedback()
  },
})

const selectedReasoningEffort = computed({
  get: () => activeProvider.value?.parameters.reasoningEffort || NO_REASONING_EFFORT,
  set: (value: string) => {
    if (!activeProvider.value) {
      return
    }
    activeProvider.value.parameters.reasoningEffort = value === NO_REASONING_EFFORT
      ? ""
      : value as BrowserAiReasoningEffort
    clearFeedback()
  },
})

const modelOptions = computed<BrowserAiModelEntry[]>(() => {
  const provider = activeProvider.value
  if (!provider) {
    return []
  }

  const seen = new Set<string>()
  const options: BrowserAiModelEntry[] = []
  const addModel = (model: BrowserAiModelEntry) => {
    const id = model.id.trim()
    if (!id || seen.has(id)) {
      return
    }
    seen.add(id)
    options.push({ id, label: model.label })
  }

  if (provider.defaultModel.trim()) {
    addModel({ id: provider.defaultModel.trim() })
  }
  provider.fetchedModels.forEach(addModel)
  return options
})

const modelFetchSummary = computed(() => {
  const provider = activeProvider.value
  if (!provider) {
    return "未选择服务商"
  }
  if (fetchingModels.value) {
    return "正在拉取模型..."
  }
  if (provider.fetchedModels.length > 0) {
    return `${provider.fetchedModels.length} 个模型 · ${formatFetchedAt(provider.modelsFetchedAt)}`
  }
  return "尚未拉取模型"
})

function formatModelSummary(config: BrowserAiConfig | null): string {
  if (!config) {
    return "未配置"
  }
  return `${config.model} · ${config.providerName ?? config.baseUrl}`
}

function cloneProvider(input: BrowserAiProviderPreset): BrowserAiProviderPreset {
  return {
    ...input,
    parameters: { ...input.parameters },
    fetchedModels: input.fetchedModels.map((model) => ({ ...model })),
  }
}

function clonePlatformConfigDraft(input: BrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  return {
    activeProviderId: input.activeProviderId,
    providers: input.providers.map(cloneProvider),
  }
}

function parameterValue(key: NumericParameterKey): string {
  const value = activeProvider.value?.parameters[key]
  return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
}

function setNumberParameter(key: NumericParameterKey, value: string | number) {
  if (!activeProvider.value) {
    return
  }

  const normalized = String(value).trim()
  activeProvider.value.parameters[key] = normalized ? Number(normalized) : null
  clearFeedback()
}

function formatFetchedAt(value: string): string {
  if (!value) {
    return "刚刚"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "刚刚"
  }

  return date.toLocaleString()
}

function clearFeedback() {
  settingsFeedback.value = ""
  settingsError.value = ""
}

function refreshPlatformConfigState(options: { reloadDraft?: boolean } = {}) {
  effectiveChatConfig.value = getBrowserAiConfig()
  chatModelSummary.value = formatModelSummary(effectiveChatConfig.value)

  if (options.reloadDraft) {
    platformConfigDraft.value = clonePlatformConfigDraft(getBrowserPlatformConfigDraft())
  }
}

function addProvider() {
  const seed = effectiveChatConfig.value
  const provider = createBrowserAiProviderPreset({
    name: seed?.providerName && seed.providerName !== "环境默认" ? seed.providerName : "OpenAI 兼容服务",
    baseUrl: seed?.baseUrl ?? "",
    apiKey: "",
    defaultModel: seed?.model ?? "",
    parameters: seed?.parameters,
  })
  platformConfigDraft.value.providers.push(provider)
  platformConfigDraft.value.activeProviderId = provider.id
  settingsError.value = ""
  settingsFeedback.value = "已新增本地服务商预设，保存后生效。"
}

function deleteActiveProvider() {
  const provider = activeProvider.value
  if (!provider) {
    return
  }

  platformConfigDraft.value.providers = platformConfigDraft.value.providers.filter((item) => item.id !== provider.id)
  platformConfigDraft.value.activeProviderId = platformConfigDraft.value.providers[0]?.id ?? ""
  settingsError.value = ""
  settingsFeedback.value = "已移除本地服务商预设，保存后生效。"
}

async function handleFetchModels() {
  const provider = activeProvider.value
  if (!provider || fetchingModels.value) {
    return
  }

  fetchingModels.value = true
  settingsFeedback.value = ""
  settingsError.value = ""

  try {
    const models = await fetchBrowserAiProviderModels(provider)
    provider.fetchedModels = models
    provider.modelsFetchedAt = new Date().toISOString()
    if (!provider.defaultModel.trim()) {
      provider.defaultModel = models[0]?.id ?? ""
    }
    settingsFeedback.value = `已拉取 ${models.length} 个模型，保存后作为本地预设缓存。`
  } catch (error) {
    settingsError.value = error instanceof Error ? error.message : "拉取模型时发生未知错误。"
  } finally {
    fetchingModels.value = false
  }
}

function handleSaveSettings() {
  try {
    saveBrowserPlatformConfigDraft(platformConfigDraft.value)
    refreshPlatformConfigState({ reloadDraft: true })
    settingsError.value = ""
    settingsFeedback.value = "服务商预设已保存，新一轮 Agent Runtime 调用将使用当前设置。"
  } catch (error) {
    settingsFeedback.value = ""
    settingsError.value =
      error instanceof Error ? error.message : "保存平台配置时发生未知错误。"
  }
}

function handleResetSettings() {
  resetBrowserPlatformConfigDraft()
  refreshPlatformConfigState({ reloadDraft: true })
  settingsError.value = ""
  settingsFeedback.value = "本地服务商预设已清空，当前已回到环境默认配置。"
}

onMounted(() => {
  refreshPlatformConfigState({ reloadDraft: true })
})
</script>
