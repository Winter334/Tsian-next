<template>
  <section
    class="grid h-full min-h-0 overflow-hidden"
    :class="screen.kind === 'hub' ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'"
  >
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
        :appearance-selectable="appearanceSelectable"
        @enter="enterHubEntry"
      />

      <AppearanceScreen
        v-else-if="screen.kind === 'appearance'"
        :current-mode="platformConfig.appearance.uiMode"
        @select="handleAppearanceSwitch"
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
        @set-active-preset="handleSetActivePreset"
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

      <CloudBackupScreen
        v-else-if="screen.kind === 'cloud-backup'"
        @save="handleSaveCloudBackupConfig"
      />

      <PlatformTunablesScreen
        v-else-if="screen.kind === 'tunables'"
        @save="handleSaveTunables"
      />

      <div v-else class="grid h-full place-items-center p-6">
        <p class="text-sm text-text-dim">未选择服务商预设。</p>
      </div>
    </main>

    <AddModelDialog
      v-model:open="addModelOpen"
      :preset="activePreset"
      :kind="activeTypeKind"
      :test-model="testActiveModel"
      :test-tool-calling="testActiveModelToolCalling"
      @confirm="handleAddModelConfirm"
    />

    <EditModelParamsDialog
      v-model:open="editParamsOpen"
      :model-id="editingModelId"
      :kind="activeTypeKind"
      :initial-parameters="editingModelParameters"
      :initial-tool-call-mode="editingModelToolCallMode"
      :initial-streaming="editingModelStreaming"
      :test-model="testActiveModel"
      :test-tool-calling="testActiveModelToolCalling"
      @confirm="handleEditModelParamsConfirm"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { ArrowLeft, Plus } from "lucide-vue-next"
import SettingsHub from "@/components/settings/SettingsHub.vue"
import ProviderManagementScreen from "@/components/settings/ProviderManagementScreen.vue"
import ModelConfigScreen from "@/components/settings/ModelConfigScreen.vue"
import AddModelDialog from "@/components/settings/AddModelDialog.vue"
import EditModelParamsDialog from "@/components/settings/EditModelParamsDialog.vue"
import SemanticSearchScreen from "@/components/settings/SemanticSearchScreen.vue"
import CloudBackupScreen from "@/components/settings/CloudBackupScreen.vue"
import PlatformTunablesScreen from "@/components/settings/PlatformTunablesScreen.vue"
import AppearanceScreen from "@/components/settings/AppearanceScreen.vue"
import { toast } from "@/composables/useToast"
import {
  DEFAULT_BROWSER_AI_STREAMING,
  DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
  cloneBrowserAiModelParameters,
  createDefaultBrowserAiModelParameters,
  type BrowserAiModelParameters,
  type BrowserAiToolCallMode,
  type BrowserEmbeddingConfig,
} from "@/config/ai"
import type {
  PlatformConfigAi,
  PlatformConfigAssistant,
  PlatformConfigCheckpointPrune,
  PlatformConfigCloudBackup,
  PlatformConfigContextCompression,
  PlatformConfigRag,
  PlatformUiMode,
} from "@/config/platform-config"
import {
  type SettingsModelTestPayload,
  useSettingsController,
} from "@/controllers/settings/use-settings-controller"

type Screen =
  | { kind: "hub" }
  | { kind: "providers" }
  | { kind: "models"; typeId: string; presetId: string }
  | { kind: "semantic-search" }
  | { kind: "cloud-backup" }
  | { kind: "tunables" }
  | { kind: "appearance" }

const screen = ref<Screen>({ kind: "hub" })
const addModelOpen = ref(false)
const editingModelId = ref("")
const editParamsOpen = ref(false)

const settings = useSettingsController({
  getActiveModelContext: () => screen.value.kind === "models"
    ? { typeId: screen.value.typeId, presetId: screen.value.presetId }
    : null,
})

const {
  platformConfigDraft,
  platformConfig,
  activeTypeId,
  activePreset,
  activeTypeName,
  activeTypeKind,
  appearanceSelectable,
} = settings

const editingModel = computed(
  () => activePreset.value?.models.find((model) => model.id === editingModelId.value) ?? null,
)

const editingModelParameters = computed<BrowserAiModelParameters>(
  () => editingModel.value?.parameters ?? createDefaultBrowserAiModelParameters(),
)

const editingModelToolCallMode = computed<BrowserAiToolCallMode>(
  () => editingModel.value?.toolCallMode ?? DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
)

const editingModelStreaming = computed<boolean>(() => editingModel.value?.streaming ?? DEFAULT_BROWSER_AI_STREAMING)

const headerTitle = computed(() => {
  switch (screen.value.kind) {
    case "providers":
      return "提供商管理"
    case "models":
      return activePreset.value ? `${activePreset.value.name || "未命名"} · 模型` : "模型配置"
    case "semantic-search":
      return "语义检索"
    case "cloud-backup":
      return "云备份"
    case "tunables":
      return "运行参数"
    case "appearance":
      return "桌面外观"
    default:
      return ""
  }
})

function enterHubEntry(id: string): void {
  if (id === "ai-providers") {
    screen.value = { kind: "providers" }
    activeTypeId.value = platformConfigDraft.value.providerTypes[0]?.id ?? ""
  } else if (id === "semantic-search") {
    screen.value = { kind: "semantic-search" }
  } else if (id === "cloud-backup") {
    screen.value = { kind: "cloud-backup" }
  } else if (id === "platform-tunables") {
    screen.value = { kind: "tunables" }
  } else if (id === "appearance" && appearanceSelectable.value) {
    screen.value = { kind: "appearance" }
  }
}

function goBack(): void {
  if (screen.value.kind === "models") {
    screen.value = { kind: "providers" }
  } else if (
    screen.value.kind === "providers"
    || screen.value.kind === "semantic-search"
    || screen.value.kind === "cloud-backup"
    || screen.value.kind === "tunables"
    || screen.value.kind === "appearance"
  ) {
    screen.value = { kind: "hub" }
  }
}

function enterModels(typeId: string, presetId: string): void {
  screen.value = { kind: "models", typeId, presetId }
}

function handleSelectType(typeId: string): void {
  settings.selectType(typeId)
}

function handleAddPreset(typeId: string): Promise<void> {
  return settings.openAddPreset(typeId)
}

function handleEditPreset(typeId: string, presetId: string): Promise<void> {
  return settings.openEditPreset(typeId, presetId)
}

function handleDeletePreset(typeId: string, presetId: string): Promise<void> {
  return settings.deletePreset(typeId, presetId)
}

function handlePatchPreset(payload: Parameters<typeof settings.patchPreset>[0]): void {
  settings.patchPreset(payload)
}

function handleSetActivePreset(presetId: string): void {
  settings.setActivePreset(presetId)
}

async function handleAddModelConfirm(payload: {
  id: string
  parameters: BrowserAiModelParameters
  toolCallMode: BrowserAiToolCallMode
  streaming: boolean
}): Promise<void> {
  await settings.addModelToActivePreset({
    modelId: payload.id,
    parameters: payload.parameters,
    toolCallMode: payload.toolCallMode,
    streaming: payload.streaming,
  })
}

function handleDeleteModel(modelId: string): Promise<void> {
  return settings.deleteActiveModel(modelId)
}

function handleMoveModel(payload: { id: string; direction: "up" | "down" }): void {
  settings.moveActiveModel(payload)
}

function handlePatchModel(payload: { id: string; patch: Partial<{ enabled: boolean }> }): void {
  settings.patchActiveModel(payload)
}

function handleEditModelParams(modelId: string): void {
  const model = activePreset.value?.models.find((item) => item.id === modelId)
  if (!model) return
  editingModelId.value = modelId
  editParamsOpen.value = true
}

function handleEditModelParamsConfirm(payload: {
  parameters: BrowserAiModelParameters
  toolCallMode: BrowserAiToolCallMode
  streaming: boolean
}): void {
  const updated = settings.setActiveModelParameters({
    modelId: editingModelId.value,
    parameters: cloneBrowserAiModelParameters(payload.parameters),
    toolCallMode: payload.toolCallMode,
    streaming: payload.streaming,
  })
  if (updated) toast.success("模型参数已更新。")
}

function handleSetStrategy(strategy: "primary-only" | "ordered"): void {
  settings.setActiveStrategy(strategy)
}

function testActiveModel(payload: SettingsModelTestPayload): Promise<{ ok: boolean; message: string }> {
  return settings.testActiveModel(payload)
}

function testActiveModelToolCalling(payload: SettingsModelTestPayload): Promise<{ ok: boolean; message: string }> {
  return settings.testActiveModelToolCalling(payload)
}

function handleSaveEmbeddingConfig(config: BrowserEmbeddingConfig, rag: PlatformConfigRag): Promise<void> {
  return settings.saveEmbeddingConfig(config, rag)
}

function handleSaveCloudBackupConfig(config: PlatformConfigCloudBackup): Promise<void> {
  return settings.saveCloudBackupConfig(config)
}

function handleSaveTunables(input: {
  checkpointPrune: PlatformConfigCheckpointPrune
  contextCompression: PlatformConfigContextCompression
  ai: PlatformConfigAi
  assistant: PlatformConfigAssistant
}): Promise<void> {
  return settings.saveTunables(input)
}

function handleAppearanceSwitch(mode: PlatformUiMode): Promise<void> {
  return settings.switchAppearance(mode)
}
</script>
