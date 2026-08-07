<template>
  <section class="spatial-provider-settings" :data-provider-level="level">
    <template v-if="level === 'presets'">
      <header class="spatial-provider-settings__heading">
        <div>
          <span class="spatial-app__eyebrow">AI 服务商</span>
          <h2>服务商预设</h2>
          <p>先选择协议，再进入一个预设管理它的模型。</p>
        </div>
        <SpatialActionButton
          variant="primary"
          :disabled="!activeType || !isTypeAvailable(activeType)"
          @click="activeType && settings.openAddPreset(activeType.id)"
        >
          <template #icon><Plus /></template>
          添加预设
        </SpatialActionButton>
      </header>

      <p v-if="settings.providerSaveError.value" class="spatial-app__banner spatial-app__banner--error" role="alert">
        {{ settings.providerSaveError.value }}
      </p>

      <div class="spatial-provider-settings__overview">
        <nav class="spatial-provider-settings__types" aria-label="提供商类型">
          <button
            v-for="type in settings.platformConfigDraft.value.providerTypes"
            :key="type.id"
            type="button"
            :aria-pressed="settings.activeTypeId.value === type.id"
            @click="settings.selectType(type.id)"
          >
            <strong>{{ type.name }}</strong>
            <small>{{ type.presets.length }} 个预设</small>
            <span v-if="!isTypeAvailable(type)">敬请期待</span>
          </button>
        </nav>

        <div class="spatial-provider-settings__presets">
          <template v-if="activeType">
            <div class="spatial-provider-settings__type-summary">
              <div>
                <span class="spatial-app__eyebrow">{{ spatialProviderKindLabel(activeType.kind) }}</span>
                <strong>{{ activeType.name }}</strong>
              </div>
              <span>{{ activeType.presets.length }} 个预设</span>
            </div>

            <div v-if="!isTypeAvailable(activeType)" class="spatial-app__empty">
              <strong>{{ activeType.name }} 即将支持</strong>
              <p>该协议暂不可添加预设，请先选择已开放的提供商类型。</p>
            </div>

            <div v-else-if="activeType.presets.length" class="spatial-provider-settings__preset-grid">
              <article v-for="preset in activeType.presets" :key="preset.id" class="spatial-provider-settings__preset-card">
                <header>
                  <div>
                    <strong>{{ preset.name || "未命名" }}</strong>
                    <small>{{ preset.baseUrl || "未设置接口地址" }}</small>
                  </div>
                  <span v-if="preset.id === settings.platformConfigDraft.value.activeProviderId" class="spatial-provider-settings__default">默认</span>
                </header>
                <dl>
                  <div><dt>主模型</dt><dd>{{ primaryModelId(preset) || "未配置" }}</dd></div>
                  <div><dt>模型</dt><dd>{{ preset.models.length }}</dd></div>
                  <div><dt>回退</dt><dd>{{ strategyLabel(preset.fallbackStrategy) }}</dd></div>
                </dl>
                <div class="spatial-app__actions">
                  <SpatialActionButton variant="primary" data-open-models @click="openModels(activeType.id, preset.id)">
                    <template #icon><Settings2 /></template>
                    模型配置
                  </SpatialActionButton>
                  <SpatialActionButton @click="settings.openEditPreset(activeType.id, preset.id)">编辑</SpatialActionButton>
                  <SpatialActionButton
                    v-if="preset.id !== settings.platformConfigDraft.value.activeProviderId"
                    @click="settings.setActivePreset(preset.id)"
                  >设为默认</SpatialActionButton>
                  <SpatialActionButton variant="danger" @click="settings.deletePreset(activeType.id, preset.id)">删除</SpatialActionButton>
                </div>
              </article>
            </div>

            <div v-else class="spatial-app__empty">
              <strong>该类型下尚无预设</strong>
              <p>使用“添加预设”配置接口地址和密钥。</p>
            </div>
          </template>
          <p v-else class="spatial-app__empty">请选择一个提供商类型。</p>
        </div>
      </div>
    </template>

    <template v-else-if="level === 'models' && selectedPreset">
      <header class="spatial-provider-settings__heading">
        <div>
          <button type="button" class="spatial-provider-settings__back" data-back-presets @click="backToPresets">← 服务商预设</button>
          <span class="spatial-app__eyebrow">{{ selectedTypeName }}</span>
          <h2>{{ selectedPreset.name || "未命名" }} · 模型配置</h2>
          <p>{{ selectedPreset.baseUrl || "未设置接口地址" }}</p>
        </div>
        <SpatialActionButton variant="primary" @click="openAddModelDialog">
          <template #icon><Plus /></template>
          添加模型
        </SpatialActionButton>
      </header>

      <section class="spatial-provider-settings__strategy">
        <div><strong>回退策略</strong><small>首个启用模型为主模型；按顺序回退时依次尝试后续模型。</small></div>
        <SpatialSelect
          :model-value="selectedPreset.fallbackStrategy"
          :options="fallbackOptions"
          aria-label="回退策略"
          @update:model-value="settings.setStrategy(selectedTypeId, selectedPresetId, $event as 'primary-only' | 'ordered')"
        />
      </section>

      <div class="spatial-provider-settings__model-list">
        <article v-for="(model, index) in selectedPreset.models" :key="model.id" class="spatial-provider-settings__model-row">
          <span class="spatial-provider-settings__model-index">{{ String(index + 1).padStart(2, "0") }}</span>
          <div class="spatial-provider-settings__model-name">
            <strong>{{ model.id || "(未命名模型)" }}</strong>
            <small>{{ roleLabel(index) }} · {{ toolCallModeLabel(model.toolCallMode) }} · {{ model.streaming ? "流式响应" : "非流式响应" }}</small>
          </div>
          <label class="spatial-provider-settings__enabled">
            <input
              :checked="model.enabled"
              type="checkbox"
              @change="settings.patchModel(selectedTypeId, selectedPresetId, model.id, { enabled: ($event.target as HTMLInputElement).checked })"
            >
            启用
          </label>
          <div class="spatial-app__actions">
            <SpatialActionButton data-edit-parameters @click="openParameters(model.id)">编辑参数</SpatialActionButton>
            <SpatialActionButton :disabled="index === 0" @click="settings.moveModel(selectedTypeId, selectedPresetId, model.id, 'up')">上移</SpatialActionButton>
            <SpatialActionButton :disabled="index === selectedPreset.models.length - 1" @click="settings.moveModel(selectedTypeId, selectedPresetId, model.id, 'down')">下移</SpatialActionButton>
            <SpatialActionButton variant="danger" :disabled="selectedPreset.models.length <= 1" @click="settings.deleteModel(selectedTypeId, selectedPresetId, model.id)">删除</SpatialActionButton>
          </div>
        </article>
      </div>
    </template>

    <template v-else-if="level === 'parameters' && selectedPreset && selectedModel && parameterDraft">
      <header class="spatial-provider-settings__heading">
        <div>
          <button type="button" class="spatial-provider-settings__back" data-back-models @click="backToModels">← 模型列表</button>
          <span class="spatial-app__eyebrow">{{ selectedPreset.name || "未命名" }}</span>
          <h2>{{ selectedModel.id }} · 参数</h2>
          <p>参数仅在保存后写回预设，并继续遵循 800 毫秒自动保存。</p>
        </div>
        <span class="spatial-app__status">{{ selectedTypeName }}</span>
      </header>

      <section class="spatial-provider-settings__parameter-basics">
        <label class="spatial-app__field">
          <span class="spatial-provider-settings__field-label">工具调用 <SpatialParamTip label="工具调用" :tip="MODEL_PARAMETER_TIPS.toolCallMode" /></span>
          <SpatialSelect v-model="toolCallModeDraft" :options="toolOptions" aria-label="工具调用模式" />
        </label>
        <label class="spatial-provider-settings__enabled">
          <input v-model="streamingDraft" type="checkbox">
          <span class="spatial-provider-settings__field-label">流式响应 <SpatialParamTip label="流式响应" :tip="MODEL_PARAMETER_TIPS.streaming" /></span>
        </label>
      </section>

      <SpatialModelParameters
        :parameters="parameterDraft"
        :kind="settings.findTypeKind(selectedTypeId)"
        @update:parameters="parameterDraft = $event"
      />

      <p v-if="feedbackMessage" class="spatial-app__banner" :class="{ 'spatial-app__banner--error': feedbackError }" role="status">
        {{ feedbackMessage }}
      </p>

      <footer class="spatial-provider-settings__parameter-actions">
        <div class="spatial-app__actions">
          <SpatialActionButton :disabled="testingAction !== ''" @click="testChat">{{ testingAction === 'chat' ? '测试中…' : '对话测试' }}</SpatialActionButton>
          <SpatialActionButton :disabled="testingAction !== ''" @click="testTools">{{ testingAction === 'tools' ? '测试中…' : '工具调用测试' }}</SpatialActionButton>
        </div>
        <div class="spatial-app__actions">
          <SpatialActionButton @click="backToModels">取消</SpatialActionButton>
          <SpatialActionButton variant="primary" data-save-parameters @click="saveParameters">保存参数</SpatialActionButton>
        </div>
      </footer>
    </template>

    <div v-else class="spatial-app__empty">
      <p>当前选择已不存在。</p>
      <SpatialActionButton @click="backToPresets">返回服务商预设</SpatialActionButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { Plus, Settings2 } from "lucide-vue-next"
import { openDialogForm } from "@/composables/useDialogForm"
import {
  DEFAULT_BROWSER_AI_STREAMING,
  DEFAULT_BROWSER_AI_TOOL_CALL_MODE,
  PROVIDER_TYPE_KINDS,
  cloneBrowserAiModelParameters,
  createDefaultBrowserAiModelParameters,
  type BrowserAiFallbackStrategy,
  type BrowserAiModelParameters,
  type BrowserAiProviderPreset,
  type BrowserAiProviderType,
  type BrowserAiToolCallMode,
} from "@/config/ai"
import type { useSettingsController } from "@/controllers/settings/use-settings-controller"
import { MODEL_PARAMETER_TIPS } from "@/controllers/settings/model-parameter-helpers"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialParamTip from "../primitives/SpatialParamTip.vue"
import SpatialSelect from "../primitives/SpatialSelect.vue"
import SpatialModelParameters from "./SpatialModelParameters.vue"
import { spatialProviderKindLabel } from "./spatial-settings-labels"

type SettingsController = ReturnType<typeof useSettingsController>
type ProviderLevel = "presets" | "models" | "parameters"

const props = defineProps<{ settings: SettingsController }>()
const level = ref<ProviderLevel>("presets")
const selectedTypeId = ref("")
const selectedPresetId = ref("")
const selectedModelId = ref("")
const parameterDraft = ref<BrowserAiModelParameters | null>(null)
const toolCallModeDraft = ref<BrowserAiToolCallMode>(DEFAULT_BROWSER_AI_TOOL_CALL_MODE)
const streamingDraft = ref(DEFAULT_BROWSER_AI_STREAMING)
const testingAction = ref<"" | "chat" | "tools">("")
const feedbackMessage = ref("")
const feedbackError = ref(false)

const activeType = computed(() => props.settings.activeType.value)
const selectedPreset = computed(() => props.settings.findPreset(selectedTypeId.value, selectedPresetId.value) ?? null)
const selectedModel = computed(() => selectedPreset.value?.models.find((model) => model.id === selectedModelId.value) ?? null)
const selectedTypeName = computed(() => props.settings.platformConfigDraft.value.providerTypes.find((type) => type.id === selectedTypeId.value)?.name ?? "")

const fallbackOptions = [
  { value: "primary-only", label: "仅主模型" },
  { value: "ordered", label: "按排序回退" },
]
const toolOptions = [
  { value: "native", label: "原生工具调用" },
  { value: "text", label: "文本工具协议" },
]

function isTypeAvailable(type: BrowserAiProviderType): boolean {
  return PROVIDER_TYPE_KINDS.find((entry) => entry.kind === type.kind)?.available ?? false
}

function primaryModelId(preset: BrowserAiProviderPreset): string {
  return preset.models.find((model) => model.enabled)?.id ?? preset.models[0]?.id ?? ""
}

function strategyLabel(strategy: BrowserAiFallbackStrategy): string {
  return strategy === "ordered" ? "按顺序回退" : "仅主模型"
}

function toolCallModeLabel(mode: BrowserAiToolCallMode): string {
  return mode === "native" ? "原生工具调用" : "文本工具协议"
}

function roleLabel(index: number): string {
  if (index === 0) return "主模型"
  return selectedPreset.value?.fallbackStrategy === "ordered" ? `回退 #${index}` : "备用（未参与回退）"
}

function openModels(typeId: string, presetId: string): void {
  props.settings.selectType(typeId)
  selectedTypeId.value = typeId
  selectedPresetId.value = presetId
  selectedModelId.value = ""
  level.value = "models"
}

function backToPresets(): void {
  level.value = "presets"
  parameterDraft.value = null
  feedbackMessage.value = ""
}

function backToModels(): void {
  level.value = "models"
  parameterDraft.value = null
  feedbackMessage.value = ""
}

function openParameters(modelId: string): void {
  const model = selectedPreset.value?.models.find((item) => item.id === modelId)
  if (!model) return
  selectedModelId.value = model.id
  parameterDraft.value = cloneBrowserAiModelParameters(model.parameters)
  toolCallModeDraft.value = model.toolCallMode
  streamingDraft.value = model.streaming
  feedbackMessage.value = ""
  feedbackError.value = false
  level.value = "parameters"
}

async function openAddModelDialog(): Promise<void> {
  const preset = selectedPreset.value
  if (!preset) return
  const values = await openDialogForm({
    title: `添加模型 · ${preset.name || "未命名"}`,
    widthClass: "max-w-md",
    confirmText: "添加并编辑参数",
    testLabel: "对话测试",
    fields: [
      { name: "modelId", label: "模型标识", type: "text", placeholder: "例如 gpt-4o", mono: true },
      { name: "toolCallMode", label: "工具调用", type: "select", defaultValue: DEFAULT_BROWSER_AI_TOOL_CALL_MODE, options: toolOptions },
      { name: "streaming", label: "流式响应", type: "select", defaultValue: String(DEFAULT_BROWSER_AI_STREAMING), options: [{ value: "true", label: "开启" }, { value: "false", label: "关闭" }] },
    ],
    validate: (input) => {
      const id = input.modelId.trim()
      if (!id) return "请填写模型标识。"
      return preset.models.some((model) => model.id === id) ? "该模型已存在。" : null
    },
    test: (input) => props.settings.testModelForPreset(selectedTypeId.value, selectedPresetId.value, {
      modelId: input.modelId,
      parameters: createDefaultBrowserAiModelParameters(),
      toolCallMode: input.toolCallMode === "text" ? "text" : "native",
      streaming: input.streaming !== "false",
    }, "spatial-settings-add-model"),
  })
  if (!values) return
  const modelId = values.modelId.trim()
  const added = await props.settings.addModelToPreset(selectedTypeId.value, selectedPresetId.value, {
    modelId,
    parameters: createDefaultBrowserAiModelParameters(),
    toolCallMode: values.toolCallMode === "text" ? "text" : "native",
    streaming: values.streaming !== "false",
  })
  if (added) openParameters(modelId)
}

function saveParameters(): void {
  if (!selectedModel.value || !parameterDraft.value) return
  props.settings.setModelParameters(
    selectedTypeId.value,
    selectedPresetId.value,
    selectedModel.value.id,
    parameterDraft.value,
    toolCallModeDraft.value,
    streamingDraft.value,
  )
  feedbackMessage.value = "模型参数已保存。"
  feedbackError.value = false
  backToModels()
}

async function testChat(): Promise<void> {
  if (!selectedModel.value || !parameterDraft.value) return
  testingAction.value = "chat"
  try {
    const result = await props.settings.testModelForPreset(selectedTypeId.value, selectedPresetId.value, {
      modelId: selectedModel.value.id,
      parameters: parameterDraft.value,
      toolCallMode: toolCallModeDraft.value,
      streaming: streamingDraft.value,
    }, "spatial-settings-model-ping")
    feedbackMessage.value = result.message
    feedbackError.value = !result.ok
  } finally {
    testingAction.value = ""
  }
}

async function testTools(): Promise<void> {
  if (!selectedModel.value || !parameterDraft.value) return
  testingAction.value = "tools"
  try {
    const result = await props.settings.testModelToolCallingForPreset(selectedTypeId.value, selectedPresetId.value, {
      modelId: selectedModel.value.id,
      parameters: parameterDraft.value,
      toolCallMode: toolCallModeDraft.value,
      streaming: streamingDraft.value,
    })
    feedbackMessage.value = result.message
    feedbackError.value = !result.ok
  } finally {
    testingAction.value = ""
  }
}
</script>

<style scoped>
.spatial-provider-settings { display: grid; align-content: start; gap: 12px; min-height: 100%; }
.spatial-provider-settings__heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--spatial-app-border); padding-bottom: 10px; }
.spatial-provider-settings__heading h2 { margin: 3px 0; font-size: 17px; }
.spatial-provider-settings__heading p { margin: 0; color: var(--spatial-app-muted); font-size: 10px; overflow-wrap: anywhere; }
.spatial-provider-settings__back { display: block; margin-bottom: 7px; border: 0; padding: 0; color: var(--spatial-window-tab); background: transparent; font: 10px "JetBrains Mono", monospace; }
.spatial-provider-settings__overview { display: grid; min-height: 330px; grid-template-columns: 145px minmax(0, 1fr); border: 1px solid var(--spatial-app-border); }
.spatial-provider-settings__types { display: grid; align-content: start; border-right: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface-muted); }
.spatial-provider-settings__types button { display: grid; gap: 3px; border: 0; border-bottom: 1px solid var(--spatial-app-border); padding: 9px; text-align: left; background: transparent; }
.spatial-provider-settings__types button[aria-pressed="true"] { box-shadow: inset 3px 0 var(--spatial-window-tab); background: var(--spatial-app-surface-strong); }
.spatial-provider-settings__types strong { font-size: 11px; }.spatial-provider-settings__types small,.spatial-provider-settings__types span { color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-provider-settings__presets { min-width: 0; padding: 10px; }
.spatial-provider-settings__type-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
.spatial-provider-settings__type-summary strong { display: block; margin-top: 2px; font-size: 13px; }.spatial-provider-settings__type-summary > span { color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-provider-settings__preset-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.spatial-provider-settings__preset-card { display: grid; align-content: start; gap: 9px; min-width: 0; border: 1px solid var(--spatial-app-border); padding: 9px; background: var(--spatial-app-surface-muted); }
.spatial-provider-settings__preset-card header { display: flex; align-items: flex-start; justify-content: space-between; gap: 7px; }.spatial-provider-settings__preset-card header div { min-width: 0; }.spatial-provider-settings__preset-card header strong,.spatial-provider-settings__preset-card header small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.spatial-provider-settings__preset-card header strong { font-size: 12px; }.spatial-provider-settings__preset-card header small { margin-top: 3px; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-provider-settings__default { border: 1px solid var(--spatial-app-border-strong); padding: 2px 4px; color: var(--spatial-window-tab); font: 8px "JetBrains Mono", monospace; }
.spatial-provider-settings__preset-card dl { display: grid; grid-template-columns: minmax(0, 1fr) repeat(2, auto); gap: 7px; margin: 0; }.spatial-provider-settings__preset-card dl div { min-width: 0; }.spatial-provider-settings__preset-card dt { color: var(--spatial-app-muted); font: 8px "JetBrains Mono", monospace; }.spatial-provider-settings__preset-card dd { margin: 2px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.spatial-provider-settings__strategy,.spatial-provider-settings__parameter-basics { display: flex; align-items: end; justify-content: space-between; gap: 10px; border: 1px solid var(--spatial-app-border); padding: 9px; background: var(--spatial-app-surface-muted); }.spatial-provider-settings__strategy strong,.spatial-provider-settings__strategy small { display: block; }.spatial-provider-settings__strategy small { margin-top: 3px; color: var(--spatial-app-muted); font-size: 9px; }
.spatial-provider-settings__model-list { display: grid; gap: 5px; }.spatial-provider-settings__model-row { display: grid; grid-template-columns: 28px minmax(120px, 1fr) auto minmax(210px, auto); align-items: center; gap: 8px; border: 1px solid var(--spatial-app-border); padding: 8px; }.spatial-provider-settings__model-index { color: var(--spatial-app-muted); font: 10px "JetBrains Mono", monospace; }.spatial-provider-settings__model-name { min-width: 0; }.spatial-provider-settings__model-name strong,.spatial-provider-settings__model-name small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.spatial-provider-settings__model-name strong { font: 11px "JetBrains Mono", monospace; }.spatial-provider-settings__model-name small { margin-top: 3px; color: var(--spatial-app-muted); font-size: 9px; }
.spatial-provider-settings__enabled { display: flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 10px; }.spatial-provider-settings__parameter-basics { justify-content: flex-start; align-items: center; }.spatial-provider-settings__parameter-basics .spatial-app__field { min-width: 190px; }.spatial-provider-settings__parameter-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--spatial-app-border); padding-top: 10px; }
.spatial-provider-settings__field-label { display: inline-flex; align-items: center; gap: 3px; }
@container (max-width: 680px) { .spatial-provider-settings__overview { grid-template-columns: 1fr; }.spatial-provider-settings__types { grid-template-columns: repeat(2, minmax(0, 1fr)); border-right: 0; border-bottom: 1px solid var(--spatial-app-border); }.spatial-provider-settings__preset-grid { grid-template-columns: 1fr; }.spatial-provider-settings__model-row { grid-template-columns: 24px minmax(0, 1fr) auto; }.spatial-provider-settings__model-row > .spatial-app__actions { grid-column: 1 / -1; }.spatial-provider-settings__heading,.spatial-provider-settings__parameter-actions { align-items: stretch; flex-direction: column; } }
</style>
