<template>
  <section
    class="grid h-full min-h-0 overflow-hidden"
    :class="screen.kind === 'hub' ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'"
  >
    <!-- Header only on non-hub screens; hub is a full-bleed card grid. -->
    <header
      v-if="screen.kind !== 'hub'"
      class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          type="button"
          class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-elevated text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          title="返回"
          @click="goBack"
        >
          <ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <h1 class="truncate text-sm font-bold text-text-main">{{ headerTitle }}</h1>
      </div>
      <button
        v-if="screen.kind === 'models'"
        type="button"
        class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
        :disabled="!activePreset"
        @click="addModelOpen = true"
      >
        <Plus class="h-3.5 w-3.5" aria-hidden="true" />
        添加模型
      </button>
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
        :active-type-id="activeTypeId"
        @select-type="handleSelectType"
        @add-preset="handleAddPreset"
        @edit-preset="handleEditPreset"
        @delete-preset="handleDeletePreset"
        @enter-models="enterModels"
        @patch-preset="handlePatchPreset"
      />

      <ModelConfigScreen
        v-else-if="screen.kind === 'models' && activePreset"
        :preset="activePreset"
        :type-name="activeTypeName"
        @delete-model="handleDeleteModel"
        @move-model="handleMoveModel"
        @patch-model="handlePatchModel"
        @edit-model-params="handleEditModelParams"
        @set-strategy="handleSetStrategy"
      />

      <SemanticSearchScreen
        v-else-if="screen.kind === 'semantic-search'"
        :draft="platformConfigDraft"
        @save="handleSaveEmbeddingConfig"
      />

      <PlatformTunablesScreen
        v-else-if="screen.kind === 'tunables'"
        @save="handleSaveTunables"
      />

      <div
        v-else
        class="grid h-full place-items-center p-6"
      >
        <p class="text-sm text-text-dim">未选择服务商预设。</p>
      </div>
    </main>

    <AddModelDialog
      v-model:open="addModelOpen"
      :preset="activePreset"
      :kind="activeTypeKind"
      @confirm="handleAddModelConfirm"
    />

    <EditModelParamsDialog
      v-model:open="editParamsOpen"
      :model-id="editingModelId"
      :kind="activeTypeKind"
      :initial-parameters="editingModelParameters"
      :initial-tool-call-mode="editingModelToolCallMode"
      :initial-streaming="editingModelStreaming"
      @confirm="handleEditModelParamsConfirm"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue"
import { ArrowLeft, Plus } from "lucide-vue-next"
import SettingsHub from "@/components/settings/SettingsHub.vue"
import ProviderManagementScreen from "@/components/settings/ProviderManagementScreen.vue"
import ModelConfigScreen from "@/components/settings/ModelConfigScreen.vue"
import AddModelDialog from "@/components/settings/AddModelDialog.vue"
import EditModelParamsDialog from "@/components/settings/EditModelParamsDialog.vue"
import SemanticSearchScreen from "@/components/settings/SemanticSearchScreen.vue"
import PlatformTunablesScreen from "@/components/settings/PlatformTunablesScreen.vue"
import { confirm } from "@/composables/useConfirm"
import { openDialogForm } from "@/composables/useDialogForm"
import { toast } from "@/composables/useToast"
import {
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiProviderPreset,
  type BrowserAiToolCallMode,
  type BrowserEmbeddingConfig,
  type BrowserPlatformConfigDraft,
  createBrowserAiModelConfig,
  createBrowserAiProviderPreset,
  createDefaultBrowserAiModelParameters,
  fetchBrowserAiProviderModels,
  getBrowserPlatformConfigDraft,
  saveBrowserPlatformConfigDraftLenient,
  saveEmbeddingConfig,
} from "@/config/ai"
import {
  type PlatformConfigAssistant,
  type PlatformConfigCheckpointPrune,
  type PlatformConfigContextCompression,
  type PlatformConfigAi,
  getPlatformConfig,
  savePlatformConfig,
} from "@/config/platform-config"

type Screen =
  | { kind: "hub" }
  | { kind: "providers" }
  | { kind: "models"; typeId: string; presetId: string }
  | { kind: "semantic-search" }
  | { kind: "tunables" }

const platformConfigDraft = ref<BrowserPlatformConfigDraft>(clonePlatformConfigDraft(getBrowserPlatformConfigDraft()))
const addModelOpen = ref(false)
const editingModelId = ref("")
const editParamsOpen = ref(false)
const screen = ref<Screen>({ kind: "hub" })

const editingModel = computed(() =>
  activePreset.value?.models.find((model) => model.id === editingModelId.value) ?? null,
)

const editingModelParameters = computed<BrowserAiModelParameters>(
  () => editingModel.value?.parameters ?? createDefaultBrowserAiModelParameters(),
)

const editingModelToolCallMode = computed<BrowserAiToolCallMode>(
  () => editingModel.value?.toolCallMode ?? "text",
)

const editingModelStreaming = computed<boolean>(() => editingModel.value?.streaming ?? false)

const activeTypeId = ref("")

const activeType = computed(
  () => platformConfigDraft.value.providerTypes.find((type) => type.id === activeTypeId.value) ?? null,
)

const activePreset = computed<BrowserAiProviderPreset | null>(() => {
  const current = screen.value
  if (current.kind !== "models") {
    return null
  }
  const type = platformConfigDraft.value.providerTypes.find((item) => item.id === current.typeId)
  return type?.presets.find((preset) => preset.id === current.presetId) ?? null
})

const activeTypeName = computed(() => {
  const current = screen.value
  if (current.kind !== "models") {
    return ""
  }
  return platformConfigDraft.value.providerTypes.find((item) => item.id === current.typeId)?.name ?? ""
})

const activeTypeKind = computed<BrowserAiProviderKind>(() => {
  const current = screen.value
  if (current.kind !== "models") {
    return "openai-compatible"
  }
  return platformConfigDraft.value.providerTypes.find((item) => item.id === current.typeId)?.kind ?? "openai-compatible"
})

/** Default baseUrl placeholder per provider kind, shown in the add-preset form. */
function baseUrlPlaceholderForKind(kind: BrowserAiProviderKind): string {
  if (kind === "gemini") {
    return "https://generativelanguage.googleapis.com/v1beta"
  }
  if (kind === "claude") {
    return "https://api.anthropic.com/v1"
  }
  if (kind === "deepseek") {
    return "https://api.deepseek.com/v1"
  }
  return "https://api.openai.com/v1"
}

const headerTitle = computed(() => {
  switch (screen.value.kind) {
    case "providers":
      return "提供商管理"
    case "models":
      return activePreset.value ? `${activePreset.value.name || "未命名"} · 模型` : "模型配置"
    case "semantic-search":
      return "语义检索"
    case "tunables":
      return "运行参数"
    default:
      return ""
  }
})

function clonePreset(input: BrowserAiProviderPreset): BrowserAiProviderPreset {
  return {
    ...input,
    models: input.models.map((model) => ({ ...model, parameters: { ...model.parameters } })),
    fetchedModels: input.fetchedModels.map((model) => ({ ...model })),
  }
}

function clonePlatformConfigDraft(input: BrowserPlatformConfigDraft): BrowserPlatformConfigDraft {
  return {
    activeProviderId: input.activeProviderId,
    providerTypes: input.providerTypes.map((type) => ({
      ...type,
      presets: type.presets.map(clonePreset),
    })),
    embeddingConfig: { ...input.embeddingConfig },
  }
}

function enterHubEntry(id: string): void {
  if (id === "ai-providers") {
    screen.value = { kind: "providers" }
    // Default-select the first type, if any.
    activeTypeId.value = platformConfigDraft.value.providerTypes[0]?.id ?? ""
  } else if (id === "semantic-search") {
    screen.value = { kind: "semantic-search" }
  } else if (id === "platform-tunables") {
    screen.value = { kind: "tunables" }
  }
}

function goBack(): void {
  if (screen.value.kind === "models") {
    screen.value = { kind: "providers" }
  } else if (
    screen.value.kind === "providers"
    || screen.value.kind === "semantic-search"
    || screen.value.kind === "tunables"
  ) {
    screen.value = { kind: "hub" }
  }
}

async function handleSaveEmbeddingConfig(
  config: BrowserEmbeddingConfig,
  rag: { defaultLimit: number; maxLimit: number },
): Promise<void> {
  const current = getPlatformConfig()
  // embedding 与 rag 同属语义检索屏保存：merge 到 provider（embedding）+ rag 段。
  await savePlatformConfig({
    ...current,
    provider: {
      ...current.provider,
      embeddingConfig: config,
    },
    rag,
  })
  // 同步本地 draft(embeddingConfig 是 draft 的一部分),让 hub 状态提示保持一致.
  platformConfigDraft.value = clonePlatformConfigDraft(getBrowserPlatformConfigDraft())
}

async function handleSaveTunables(input: {
  checkpointPrune: PlatformConfigCheckpointPrune
  contextCompression: PlatformConfigContextCompression
  ai: PlatformConfigAi
  assistant: PlatformConfigAssistant
}): Promise<void> {
  const current = getPlatformConfig()
  await savePlatformConfig({
    ...current,
    checkpointPrune: input.checkpointPrune,
    contextCompression: input.contextCompression,
    ai: input.ai,
    assistant: input.assistant,
  })
  toast.success("运行参数已保存。")
}

function handleSelectType(typeId: string): void {
  activeTypeId.value = typeId
}

async function handleAddPreset(typeId: string): Promise<void> {
  const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
  const kind: BrowserAiProviderKind = type?.kind ?? "openai-compatible"
  const baseUrlPlaceholder = baseUrlPlaceholderForKind(kind)
  const values = await openDialogForm({
    title: "添加提供商预设",
    widthClass: "max-w-md",
    confirmText: "添加",
    testLabel: "测试连通性",
    test: async (vals) => {
      const baseUrl = vals.baseUrl.trim()
      const apiKey = vals.apiKey.trim()
      if (!baseUrl) {
        return { ok: false, message: "请先填写接口地址。" }
      }
      if (!apiKey) {
        return { ok: false, message: "请先填写 API 密钥。" }
      }
      try {
        // Model list fetch doubles as a connectivity + auth probe.
        const models = await fetchBrowserAiProviderModels({ baseUrl, apiKey, kind })
        return { ok: true, message: `已连通，发现 ${models.length} 个模型。` }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "连通性测试失败。" }
      }
    },
    fields: [
      { name: "name", label: "预设名称", type: "text", placeholder: "例如 我的 OpenAI", defaultValue: "" },
      { name: "baseUrl", label: "接口地址", type: "text", placeholder: baseUrlPlaceholder, mono: true, defaultValue: "" },
      { name: "apiKey", label: "API 密钥", type: "password", placeholder: "sk-...", mono: true, defaultValue: "" },
    ],
    validate: (vals) => {
      if (!vals.name.trim()) {
        return "请填写预设名称。"
      }
      return null
    },
  })
  if (!values) {
    return
  }
  if (!type) {
    return
  }
  const preset = createBrowserAiProviderPreset({
    name: values.name.trim(),
    baseUrl: values.baseUrl.trim(),
    apiKey: values.apiKey.trim(),
  })
  type.presets.push(preset)
  if (!platformConfigDraft.value.activeProviderId) {
    platformConfigDraft.value.activeProviderId = preset.id
  }
  toast.success(`已添加预设：${preset.name}`)
}

async function handleEditPreset(typeId: string, presetId: string): Promise<void> {
  const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
  const preset = type?.presets.find((item) => item.id === presetId)
  if (!type || !preset) {
    return
  }
  const kind: BrowserAiProviderKind = type.kind
  const baseUrlPlaceholder = baseUrlPlaceholderForKind(kind)
  const values = await openDialogForm({
    title: `编辑预设：${preset.name || "未命名"}`,
    widthClass: "max-w-md",
    confirmText: "保存",
    testLabel: "测试连通性",
    test: async (vals) => {
      const baseUrl = vals.baseUrl.trim()
      const apiKey = vals.apiKey.trim()
      if (!baseUrl) {
        return { ok: false, message: "请先填写接口地址。" }
      }
      if (!apiKey) {
        return { ok: false, message: "请先填写 API 密钥。" }
      }
      try {
        const models = await fetchBrowserAiProviderModels({ baseUrl, apiKey, kind })
        return { ok: true, message: `已连通，发现 ${models.length} 个模型。` }
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : "连通性测试失败。" }
      }
    },
    fields: [
      { name: "name", label: "预设名称", type: "text", placeholder: "例如 我的 OpenAI", defaultValue: preset.name },
      { name: "baseUrl", label: "接口地址", type: "text", placeholder: baseUrlPlaceholder, mono: true, defaultValue: preset.baseUrl },
      { name: "apiKey", label: "API 密钥", type: "password", placeholder: "sk-...", mono: true, defaultValue: preset.apiKey },
    ],
    validate: (vals) => {
      if (!vals.name.trim()) {
        return "请填写预设名称。"
      }
      return null
    },
  })
  if (!values) {
    return
  }
  handlePatchPreset({
    typeId,
    presetId,
    patch: {
      name: values.name.trim(),
      baseUrl: values.baseUrl.trim(),
      apiKey: values.apiKey.trim(),
    },
  })
  toast.success(`已更新预设：${values.name.trim()}`)
}

async function handleDeletePreset(typeId: string, presetId: string): Promise<void> {
  const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
  const preset = type?.presets.find((item) => item.id === presetId)
  if (!type || !preset) {
    return
  }
  const confirmed = await confirm({
    message: `删除预设「${preset.name || "未命名"}」？\n\n这会移除其全部模型配置，无法撤销。`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }
  type.presets = type.presets.filter((item) => item.id !== presetId)
  if (platformConfigDraft.value.activeProviderId === presetId) {
    platformConfigDraft.value.activeProviderId = ""
  }
  toast.success(`已移除预设：${preset.name || "未命名"}`)
}

function enterModels(typeId: string, presetId: string): void {
  screen.value = { kind: "models", typeId, presetId }
}

function handlePatchPreset(payload: { typeId: string; presetId: string; patch: Partial<BrowserAiProviderPreset> }): void {
  const preset = findPreset(payload.typeId, payload.presetId)
  if (!preset) {
    return
  }
  Object.assign(preset, payload.patch)
}

function handleAddModelConfirm(payload: { id: string; parameters: BrowserAiModelParameters; toolCallMode: BrowserAiToolCallMode; streaming: boolean }): void {
  const preset = activePreset.value
  if (!preset) {
    return
  }
  const id = payload.id.trim()
  if (!id) {
    return
  }
  if (preset.models.some((model) => model.id === id)) {
    toast.error("该模型已存在。")
    return
  }
  preset.models.push(createBrowserAiModelConfig({ id, parameters: payload.parameters, toolCallMode: payload.toolCallMode, streaming: payload.streaming }))
}

async function handleDeleteModel(modelId: string): Promise<void> {
  const preset = activePreset.value
  if (!preset) {
    return
  }
  if (preset.models.length <= 1) {
    toast.error("每个预设至少保留一个模型。")
    return
  }
  const confirmed = await confirm({
    message: `删除模型「${modelId}」？`,
    severity: "danger",
    confirmText: "删除",
  })
  if (!confirmed) {
    return
  }
  preset.models = preset.models.filter((model) => model.id !== modelId)
}

function handleMoveModel(payload: { id: string; direction: "up" | "down" }): void {
  const preset = activePreset.value
  if (!preset) {
    return
  }
  const index = preset.models.findIndex((model) => model.id === payload.id)
  if (index < 0) {
    return
  }
  const target = payload.direction === "up" ? index - 1 : index + 1
  if (target < 0 || target >= preset.models.length) {
    return
  }
  const [moved] = preset.models.splice(index, 1)
  preset.models.splice(target, 0, moved)
}

function handlePatchModel(payload: { id: string; patch: Partial<{ enabled: boolean }> }): void {
  const preset = activePreset.value
  if (!preset) {
    return
  }
  const model = preset.models.find((item) => item.id === payload.id)
  if (!model) {
    return
  }
  if (payload.patch.enabled !== undefined) {
    model.enabled = payload.patch.enabled
  }
}

function handleEditModelParams(modelId: string): void {
  const preset = activePreset.value
  const model = preset?.models.find((item) => item.id === modelId)
  if (!preset || !model) {
    return
  }
  editingModelId.value = modelId
  editParamsOpen.value = true
}

function handleEditModelParamsConfirm(payload: { parameters: BrowserAiModelParameters; toolCallMode: BrowserAiToolCallMode; streaming: boolean }): void {
  const model = editingModel.value
  if (!model) {
    return
  }
  model.parameters = payload.parameters
  model.toolCallMode = payload.toolCallMode
  // Text-protocol models can never stream; clamp to false regardless of the
  // switch value (the switch is disabled in that mode, this is a safety net).
  model.streaming = payload.toolCallMode === "native" ? payload.streaming : false
  toast.success("模型参数已更新。")
}

function handleSetStrategy(strategy: "primary-only" | "ordered"): void {
  const preset = activePreset.value
  if (!preset) {
    return
  }
  preset.fallbackStrategy = strategy
}

function findPreset(typeId: string, presetId: string): BrowserAiProviderPreset | undefined {
  const type = platformConfigDraft.value.providerTypes.find((item) => item.id === typeId)
  return type?.presets.find((preset) => preset.id === presetId)
}

// Auto-save: persist the draft debounced after any deep change.
let saveTimer: ReturnType<typeof setTimeout> | null = null
watch(
  platformConfigDraft,
  () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
      void saveBrowserPlatformConfigDraftLenient(platformConfigDraft.value).catch((error) => {
        toast.error(error instanceof Error ? error.message : "自动保存失败。")
      })
    }, 800)
  },
  { deep: true },
)

onMounted(() => {
  platformConfigDraft.value = clonePlatformConfigDraft(getBrowserPlatformConfigDraft())
})
</script>
