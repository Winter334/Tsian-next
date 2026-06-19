<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="flex min-w-0 items-center gap-2">
        <button
          v-if="screen.kind !== 'hub'"
          type="button"
          class="retro-focus grid h-7 w-7 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          title="返回"
          @click="goBack"
        >
          <ArrowLeft class="h-4 w-4" aria-hidden="true" />
        </button>
        <div class="min-w-0">
          <p class="font-mono text-[11px] uppercase tracking-wider text-neon">{{ headerEyebrow }}</p>
          <h1 class="truncate text-base font-bold text-text-main">{{ headerTitle }}</h1>
        </div>
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
        <template v-if="screen.kind !== 'hub'">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            @click="handleResetSettings"
          >
            <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
            重置
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            @click="handleSaveSettings"
          >
            <Save class="h-3.5 w-3.5" aria-hidden="true" />
            保存
          </button>
        </template>
      </div>
    </header>

    <main class="min-h-0 overflow-hidden">
      <SettingsHub
        v-if="screen.kind === 'hub'"
        :draft="platformConfigDraft"
        @enter="enterHubEntry"
      />

      <ProviderManagementScreen
        v-else-if="screen.kind === 'providers'"
        :draft="platformConfigDraft"
        :active-provider-id="activeProviderId"
        @select-provider="handleSelectProvider"
        @add-provider="addProvider"
        @delete-provider="handleDeleteProvider"
        @enter-models="enterModels"
        @patch-provider="handlePatchProvider"
      />

      <ModelConfigScreen
        v-else-if="screen.kind === 'models' && activeProvider"
        :provider="activeProvider"
        :fetching-models="fetchingModels"
        @back="goBack"
        @fetch-models="handleFetchModels"
        @add-model="handleAddModel"
        @delete-model="handleDeleteModel"
        @move-model="handleMoveModel"
        @patch-model="handlePatchModel"
        @set-strategy="handleSetStrategy"
      />

      <div
        v-else
        class="grid h-full place-items-center p-6"
      >
        <p class="text-sm text-text-dim">未选择服务商预设。</p>
      </div>
    </main>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RotateCcw,
  Save,
} from "lucide-vue-next"
import SettingsHub from "@/components/settings/SettingsHub.vue"
import ProviderManagementScreen from "@/components/settings/ProviderManagementScreen.vue"
import ModelConfigScreen from "@/components/settings/ModelConfigScreen.vue"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import {
  type BrowserAiConfig,
  type BrowserAiModelParameters,
  type BrowserAiProviderPreset,
  type BrowserPlatformConfigDraft,
  createBrowserAiModelConfig,
  createBrowserAiProviderPreset,
  fetchBrowserAiProviderModels,
  getBrowserAiConfig,
  getBrowserPlatformConfigDraft,
  resetBrowserPlatformConfigDraft,
  saveBrowserPlatformConfigDraft,
} from "@/config/ai"

type Screen =
  | { kind: "hub" }
  | { kind: "providers" }
  | { kind: "models"; providerId: string }

const effectiveChatConfig = ref<BrowserAiConfig | null>(null)
const platformConfigDraft = ref<BrowserPlatformConfigDraft>(clonePlatformConfigDraft(getBrowserPlatformConfigDraft()))
const fetchingModels = ref(false)
const screen = ref<Screen>({ kind: "hub" })

const activeProviderId = computed(() => platformConfigDraft.value.activeProviderId)

const activeProvider = computed(
  () => platformConfigDraft.value.providers.find((provider) => provider.id === activeProviderId.value) ?? null,
)

const headerEyebrow = computed(() => {
  switch (screen.value.kind) {
    case "hub":
      return "Control Panel"
    case "providers":
      return "AI 提供商"
    case "models":
      return "模型配置"
  }
})

const headerTitle = computed(() => {
  switch (screen.value.kind) {
    case "hub":
      return "控制面板"
    case "providers":
      return "提供商管理"
    case "models":
      return activeProvider.value ? `${activeProvider.value.name || "未命名"} · 模型` : "模型配置"
  }
})

function cloneProvider(input: BrowserAiProviderPreset): BrowserAiProviderPreset {
  return {
    ...input,
    models: input.models.map((model) => ({ ...model, parameters: { ...model.parameters } })),
    fetchedModels: input.fetchedModels.map((model) => ({ ...model })),
  }
}

function clonePlatformConfigDraft(input: BrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  return {
    activeProviderId: input.activeProviderId,
    providers: input.providers.map(cloneProvider),
  }
}

function enterHubEntry(id: string): void {
  if (id === "ai-providers") {
    screen.value = { kind: "providers" }
  }
}

function goBack(): void {
  if (screen.value.kind === "models") {
    screen.value = { kind: "providers" }
  } else if (screen.value.kind === "providers") {
    screen.value = { kind: "hub" }
  }
}

function handleSelectProvider(id: string): void {
  platformConfigDraft.value.activeProviderId = id
}

function enterModels(providerId: string): void {
  platformConfigDraft.value.activeProviderId = providerId
  screen.value = { kind: "models", providerId }
}

function addProvider(): void {
  const seed = effectiveChatConfig.value
  const provider = createBrowserAiProviderPreset({
    name: seed?.providerName && seed.providerName !== "环境默认" ? seed.providerName : "OpenAI 兼容服务",
    baseUrl: seed?.baseUrl ?? "",
    apiKey: "",
    models: seed?.model
      ? [createBrowserAiModelConfig({ id: seed.model, parameters: seed?.parameters })]
      : [],
    parameters: seed?.parameters,
  })
  platformConfigDraft.value.providers.push(provider)
  platformConfigDraft.value.activeProviderId = provider.id
  toast.info("已新增本地服务商预设，保存后生效。")
}

async function handleDeleteProvider(id: string): Promise<void> {
  const provider = platformConfigDraft.value.providers.find((item) => item.id === id)
  if (!provider) {
    return
  }
  const confirmed = await confirm({
    message: `删除预设「${provider.name || "未命名服务商"}」？\n\n这会移除其全部模型配置，无法撤销。`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }
  platformConfigDraft.value.providers = platformConfigDraft.value.providers.filter((item) => item.id !== id)
  platformConfigDraft.value.activeProviderId = platformConfigDraft.value.providers[0]?.id ?? ""
  toast.success(`已移除预设：${provider.name || "未命名服务商"}`)
}

function handlePatchProvider(patch: Partial<BrowserAiProviderPreset> & { id: string }): void {
  const provider = platformConfigDraft.value.providers.find((item) => item.id === patch.id)
  if (!provider) {
    return
  }
  const { id: _id, ...rest } = patch
  void _id
  Object.assign(provider, rest)
}

async function handleFetchModels(): Promise<void> {
  const provider = activeProvider.value
  if (!provider || fetchingModels.value) {
    return
  }
  if (!provider.baseUrl.trim()) {
    toast.error("请先填写接口地址。")
    return
  }
  if (!provider.apiKey.trim()) {
    toast.error("请先填写 API 密钥。")
    return
  }
  fetchingModels.value = true
  try {
    const models = await fetchBrowserAiProviderModels(provider)
    provider.fetchedModels = models
    provider.modelsFetchedAt = new Date().toISOString()
    toast.success(`已拉取 ${models.length} 个模型，保存后作为本地预设缓存。`)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "拉取模型时发生未知错误。")
  } finally {
    fetchingModels.value = false
  }
}

function handleAddModel(): void {
  const provider = activeProvider.value
  if (!provider) {
    return
  }
  // Prefer the first fetched model not already configured; else a blank entry.
  const existing = new Set(provider.models.map((model) => model.id))
  const next = provider.fetchedModels.find((model) => !existing.has(model.id))
  const config = createBrowserAiModelConfig({ id: next?.id ?? "", parameters: undefined })
  provider.models.push(config)
}

async function handleDeleteModel(id: string): Promise<void> {
  const provider = activeProvider.value
  if (!provider) {
    return
  }
  if (provider.models.length <= 1) {
    toast.error("每个预设至少保留一个模型。")
    return
  }
  const confirmed = await confirm({
    message: `删除模型「${id}」？`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }
  provider.models = provider.models.filter((model) => model.id !== id)
}

function handleMoveModel(payload: { id: string; direction: "up" | "down" }): void {
  const provider = activeProvider.value
  if (!provider) {
    return
  }
  const index = provider.models.findIndex((model) => model.id === payload.id)
  if (index < 0) {
    return
  }
  const target = payload.direction === "up" ? index - 1 : index + 1
  if (target < 0 || target >= provider.models.length) {
    return
  }
  const [moved] = provider.models.splice(index, 1)
  provider.models.splice(target, 0, moved)
}

function handlePatchModel(payload: { id: string; patch: Partial<{ enabled: boolean; parameters: BrowserAiModelParameters }> }): void {
  const provider = activeProvider.value
  if (!provider) {
    return
  }
  const model = provider.models.find((item) => item.id === payload.id)
  if (!model) {
    return
  }
  if (payload.patch.enabled !== undefined) {
    model.enabled = payload.patch.enabled
  }
  if (payload.patch.parameters) {
    model.parameters = payload.patch.parameters
  }
}

function handleSetStrategy(strategy: "primary-only" | "ordered"): void {
  const provider = activeProvider.value
  if (!provider) {
    return
  }
  provider.fallbackStrategy = strategy
}

function handleSaveSettings(): void {
  try {
    saveBrowserPlatformConfigDraft(platformConfigDraft.value)
    refreshPlatformConfigState({ reloadDraft: true })
    toast.success("服务商预设已保存，新一轮 Agent Runtime 调用将使用当前设置。")
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "保存平台配置时发生未知错误。")
  }
}

function handleResetSettings(): void {
  resetBrowserPlatformConfigDraft()
  refreshPlatformConfigState({ reloadDraft: true })
  screen.value = { kind: "hub" }
  toast.info("本地服务商预设已清空，当前已回到环境默认配置。")
}

function refreshPlatformConfigState(options: { reloadDraft?: boolean } = {}): void {
  effectiveChatConfig.value = getBrowserAiConfig()
  if (options.reloadDraft) {
    platformConfigDraft.value = clonePlatformConfigDraft(getBrowserPlatformConfigDraft())
  }
}

onMounted(() => {
  refreshPlatformConfigState({ reloadDraft: true })
})
</script>
