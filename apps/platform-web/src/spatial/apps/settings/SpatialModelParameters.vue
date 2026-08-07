<template>
  <fieldset class="spatial-model-parameters">
    <legend>模型参数 · {{ spatialProviderKindLabel(kind) }}</legend>

    <section class="spatial-model-parameters__section">
      <header>通用生成参数</header>
      <div class="spatial-model-parameters__grid">
        <NumberField
          v-for="field in commonFields"
          :key="field.key"
          :label="field.label"
          :tip="field.tip"
          :value="parameters.common[field.key]"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          @change="updateCommon({ [field.key]: $event })"
        />
      </div>
      <div class="spatial-model-parameters__slider-grid">
        <SpatialRangeSlider
          :model-value="parameters.common.temperature"
          label="温度"
          :min="0"
          :max="2"
          :step="0.05"
          :tip="MODEL_PARAMETER_TIPS.temperature"
          nullable
          @update:model-value="updateCommon({ temperature: $event })"
        />
        <SpatialRangeSlider
          :model-value="parameters.common.topP"
          label="核采样"
          :min="0"
          :max="1"
          :step="0.05"
          :tip="MODEL_PARAMETER_TIPS.topP"
          nullable
          @update:model-value="updateCommon({ topP: $event })"
        />
      </div>
    </section>

    <section class="spatial-model-parameters__section">
      <header>提供商参数</header>

      <template v-if="kind === 'openai-compatible'">
        <div class="spatial-model-parameters__slider-grid">
          <SpatialRangeSlider :model-value="openAiCompatible.frequencyPenalty" label="频率惩罚" :min="-2" :max="2" :step="0.1" :tip="MODEL_PARAMETER_TIPS.frequencyPenalty" nullable @update:model-value="updateOpenAiCompatible({ frequencyPenalty: $event })" />
          <SpatialRangeSlider :model-value="openAiCompatible.presencePenalty" label="存在惩罚" :min="-2" :max="2" :step="0.1" :tip="MODEL_PARAMETER_TIPS.presencePenalty" nullable @update:model-value="updateOpenAiCompatible({ presencePenalty: $event })" />
        </div>
        <label class="spatial-app__field">
          <span class="spatial-model-parameters__label">推理程度 <SpatialParamTip label="推理程度" :tip="MODEL_PARAMETER_TIPS.reasoningEffort" /></span>
          <SpatialSelect :model-value="openAiCompatible.reasoningEffort || NO_REASONING_OPTION" :options="reasoningOptions" aria-label="推理程度" @update:model-value="updateOpenAiCompatible({ reasoningEffort: normalizeReasoningValue($event) })" />
        </label>
      </template>

      <template v-else-if="kind === 'deepseek'">
        <div class="spatial-model-parameters__slider-grid">
          <SpatialRangeSlider :model-value="deepSeek.frequencyPenalty" label="频率惩罚" :min="-2" :max="2" :step="0.1" :tip="MODEL_PARAMETER_TIPS.frequencyPenalty" nullable @update:model-value="updateDeepSeek({ frequencyPenalty: $event })" />
          <SpatialRangeSlider :model-value="deepSeek.presencePenalty" label="存在惩罚" :min="-2" :max="2" :step="0.1" :tip="MODEL_PARAMETER_TIPS.presencePenalty" nullable @update:model-value="updateDeepSeek({ presencePenalty: $event })" />
        </div>
        <label class="spatial-app__field">
          <span class="spatial-model-parameters__label">推理程度 <SpatialParamTip label="推理程度" :tip="MODEL_PARAMETER_TIPS.reasoningEffort" /></span>
          <SpatialSelect :model-value="deepSeek.reasoningEffort || NO_REASONING_OPTION" :options="reasoningOptions" aria-label="推理程度" @update:model-value="updateDeepSeek({ reasoningEffort: normalizeReasoningValue($event) })" />
        </label>
      </template>

      <template v-else-if="kind === 'openai-responses'">
        <label class="spatial-app__field">
          <span class="spatial-model-parameters__label">推理程度 <SpatialParamTip label="推理程度" :tip="MODEL_PARAMETER_TIPS.reasoningEffort" /></span>
          <SpatialSelect :model-value="openAiResponses.reasoningEffort || NO_REASONING_OPTION" :options="reasoningOptions" aria-label="推理程度" @update:model-value="updateOpenAiResponses({ reasoningEffort: normalizeReasoningValue($event) })" />
        </label>
      </template>

      <template v-else-if="kind === 'gemini'">
        <div class="spatial-model-parameters__grid">
          <NumberField label="候选数量" :tip="MODEL_PARAMETER_TIPS.topK" :value="gemini.topK" @change="updateGemini({ topK: $event })" />
          <NumberField label="思考预算" :tip="MODEL_PARAMETER_TIPS.thinkingBudget" :value="gemini.thinkingBudget" @change="updateGemini({ thinkingBudget: $event })" />
          <label class="spatial-app__field">
            <span class="spatial-model-parameters__label">响应类型 <SpatialParamTip label="响应类型" :tip="MODEL_PARAMETER_TIPS.responseMimeType" /></span>
            <input :value="gemini.responseMimeType" placeholder="application/json" @input="updateGemini({ responseMimeType: ($event.target as HTMLInputElement).value })">
          </label>
          <label class="spatial-model-parameters__switch">
            <span class="spatial-model-parameters__label">包含思考 <SpatialParamTip label="包含思考" :tip="MODEL_PARAMETER_TIPS.includeThoughts" /></span>
            <input :checked="gemini.includeThoughts" type="checkbox" @change="updateGemini({ includeThoughts: ($event.target as HTMLInputElement).checked })">
          </label>
        </div>
        <div class="spatial-model-parameters__slider-grid">
          <SpatialRangeSlider :model-value="gemini.frequencyPenalty" label="频率惩罚" :min="-2" :max="2" :step="0.1" :tip="MODEL_PARAMETER_TIPS.frequencyPenalty" nullable @update:model-value="updateGemini({ frequencyPenalty: $event })" />
          <SpatialRangeSlider :model-value="gemini.presencePenalty" label="存在惩罚" :min="-2" :max="2" :step="0.1" :tip="MODEL_PARAMETER_TIPS.presencePenalty" nullable @update:model-value="updateGemini({ presencePenalty: $event })" />
        </div>
        <label class="spatial-app__field">
          <span class="spatial-model-parameters__label">停止序列（一行一个） <SpatialParamTip label="停止序列" :tip="MODEL_PARAMETER_TIPS.stopSequences" /></span>
          <textarea :value="linesToText(gemini.stopSequences)" rows="2" @input="updateGemini({ stopSequences: textToLines(($event.target as HTMLTextAreaElement).value) })" />
        </label>
        <label class="spatial-app__field">
          <span class="spatial-model-parameters__label">响应结构（JSON） <SpatialParamTip label="响应结构" :tip="MODEL_PARAMETER_TIPS.responseSchema" /></span>
          <textarea :value="gemini.responseSchemaText" rows="3" spellcheck="false" @input="updateGemini({ responseSchemaText: ($event.target as HTMLTextAreaElement).value })" />
        </label>
      </template>

      <template v-else>
        <div class="spatial-model-parameters__grid">
          <NumberField label="候选数量" :tip="MODEL_PARAMETER_TIPS.topK" :value="claude.topK" @change="updateClaude({ topK: $event })" />
          <NumberField label="思考预算" :tip="MODEL_PARAMETER_TIPS.thinkingBudget" :value="claude.thinkingBudgetTokens" @change="updateClaude({ thinkingBudgetTokens: $event })" />
          <label class="spatial-app__field">
            <span class="spatial-model-parameters__label">服务等级 <SpatialParamTip label="服务等级" :tip="MODEL_PARAMETER_TIPS.serviceTier" /></span>
            <SpatialSelect :model-value="claude.serviceTier || NO_SERVICE_TIER_OPTION" :options="serviceTierOptions" aria-label="服务等级" @update:model-value="updateClaude({ serviceTier: normalizeServiceTierValue($event) })" />
          </label>
          <label class="spatial-app__field">
            <span class="spatial-model-parameters__label">思考模式 <SpatialParamTip label="思考模式" :tip="MODEL_PARAMETER_TIPS.thinkingMode" /></span>
            <SpatialSelect :model-value="claude.thinkingMode" :options="thinkingModeOptions" aria-label="思考模式" @update:model-value="updateClaude({ thinkingMode: $event as BrowserClaudeThinkingMode })" />
          </label>
          <label class="spatial-app__field">
            <span class="spatial-model-parameters__label">思考展示 <SpatialParamTip label="思考展示" :tip="MODEL_PARAMETER_TIPS.thinkingDisplay" /></span>
            <SpatialSelect :model-value="claude.thinkingDisplay" :options="thinkingDisplayOptions" aria-label="思考展示" :disabled="claude.thinkingMode === 'disabled'" @update:model-value="updateClaude({ thinkingDisplay: $event as BrowserClaudeThinkingDisplay })" />
          </label>
        </div>
        <label class="spatial-app__field">
          <span class="spatial-model-parameters__label">停止序列（一行一个） <SpatialParamTip label="停止序列" :tip="MODEL_PARAMETER_TIPS.stopSequences" /></span>
          <textarea :value="linesToText(claude.stopSequences)" rows="2" @input="updateClaude({ stopSequences: textToLines(($event.target as HTMLTextAreaElement).value) })" />
        </label>
      </template>
    </section>

    <section class="spatial-model-parameters__section">
      <header>高级参数</header>
      <label class="spatial-app__field">
        <span class="spatial-model-parameters__label">自定义请求参数（JSON） <SpatialParamTip label="自定义请求参数" :tip="MODEL_PARAMETER_TIPS.customRequestParams" /></span>
        <textarea :value="activeCustomRequestParamsText(parameters, kind)" rows="3" spellcheck="false" placeholder='{ "seed": 42 }' @input="updateCustom(($event.target as HTMLTextAreaElement).value)" />
      </label>
    </section>
  </fieldset>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, type PropType } from "vue"
import type {
  BrowserAiCommonModelParameters,
  BrowserAiModelParameters,
  BrowserAiProviderKind,
  BrowserClaudeThinkingDisplay,
  BrowserClaudeThinkingMode,
} from "@/config/ai"
import {
  MODEL_PARAMETER_TIPS,
  NO_REASONING_OPTION,
  NO_SERVICE_TIER_OPTION,
  activeCustomRequestParamsText,
  claudeParams,
  deepSeekParams,
  geminiParams,
  linesToText,
  normalizeReasoningValue,
  normalizeServiceTierValue,
  numToText,
  openAiCompatibleParams,
  openAiResponsesParams,
  textToLines,
  textToNum,
  updateActiveCustomRequestParamsText,
  updateClaudeParameters,
  updateCommonParameters,
  updateDeepSeekParameters,
  updateGeminiParameters,
  updateOpenAiCompatibleParameters,
  updateOpenAiResponsesParameters,
} from "@/controllers/settings/model-parameter-helpers"
import SpatialParamTip from "../primitives/SpatialParamTip.vue"
import SpatialRangeSlider from "../primitives/SpatialRangeSlider.vue"
import SpatialSelect from "../primitives/SpatialSelect.vue"
import { spatialProviderKindLabel } from "./spatial-settings-labels"

const props = defineProps<{ parameters: BrowserAiModelParameters; kind: BrowserAiProviderKind }>()
const emit = defineEmits<{ "update:parameters": [value: BrowserAiModelParameters] }>()

const commonFields: Array<{ key: "contextWindow" | "maxOutputTokens"; label: string; tip: string; min: number; max?: number; step?: number }> = [
  { key: "contextWindow", label: "上下文窗口", tip: MODEL_PARAMETER_TIPS.contextWindow, min: 1 },
  { key: "maxOutputTokens", label: "最大输出令牌数", tip: MODEL_PARAMETER_TIPS.maxOutputTokens, min: 1 },
]
const reasoningOptions = [
  { value: NO_REASONING_OPTION, label: "不发送" },
  { value: "minimal", label: "极低" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
]
const serviceTierOptions = [{ value: NO_SERVICE_TIER_OPTION, label: "不发送" }, { value: "auto", label: "自动" }, { value: "standard_only", label: "仅标准" }]
const thinkingModeOptions = [{ value: "disabled", label: "关闭" }, { value: "adaptive", label: "自适应" }, { value: "enabled", label: "启用" }]
const thinkingDisplayOptions = [{ value: "summarized", label: "摘要" }, { value: "omitted", label: "不返回" }]

const openAiCompatible = computed(() => openAiCompatibleParams(props.parameters))
const openAiResponses = computed(() => openAiResponsesParams(props.parameters))
const deepSeek = computed(() => deepSeekParams(props.parameters))
const gemini = computed(() => geminiParams(props.parameters))
const claude = computed(() => claudeParams(props.parameters))

function updateCommon(patch: Partial<BrowserAiCommonModelParameters>): void { emit("update:parameters", updateCommonParameters(props.parameters, patch)) }
function updateOpenAiCompatible(patch: Parameters<typeof updateOpenAiCompatibleParameters>[1]): void { emit("update:parameters", updateOpenAiCompatibleParameters(props.parameters, patch)) }
function updateOpenAiResponses(patch: Parameters<typeof updateOpenAiResponsesParameters>[1]): void { emit("update:parameters", updateOpenAiResponsesParameters(props.parameters, patch)) }
function updateDeepSeek(patch: Parameters<typeof updateDeepSeekParameters>[1]): void { emit("update:parameters", updateDeepSeekParameters(props.parameters, patch)) }
function updateGemini(patch: Parameters<typeof updateGeminiParameters>[1]): void { emit("update:parameters", updateGeminiParameters(props.parameters, patch)) }
function updateClaude(patch: Parameters<typeof updateClaudeParameters>[1]): void { emit("update:parameters", updateClaudeParameters(props.parameters, patch)) }
function updateCustom(value: string): void { emit("update:parameters", updateActiveCustomRequestParamsText(props.parameters, props.kind, value)) }

const NumberField = defineComponent({
  props: {
    label: { type: String, required: true },
    tip: { type: String, default: "" },
    value: { type: Number as PropType<number | null>, default: null },
    min: { type: Number, default: undefined },
    max: { type: Number, default: undefined },
    step: { type: Number, default: undefined },
  },
  emits: { change: (value: number | null) => value === null || Number.isFinite(value) },
  setup(numberProps, { emit: emitNumber }) {
    return () => h("label", { class: "spatial-app__field" }, [
      h("span", { class: "spatial-model-parameters__label" }, [
        numberProps.label,
        numberProps.tip ? h(SpatialParamTip, { label: numberProps.label, tip: numberProps.tip }) : null,
      ]),
      h("input", {
        value: numToText(numberProps.value),
        type: "number",
        min: numberProps.min,
        max: numberProps.max,
        step: numberProps.step,
        onInput: (event: Event) => emitNumber("change", textToNum((event.target as HTMLInputElement).value)),
      }),
    ])
  },
})
</script>

<style scoped>
.spatial-model-parameters { display: grid; gap: 10px; border: 0; padding: 0; }
.spatial-model-parameters legend { padding: 0 4px; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-model-parameters__section { display: grid; gap: 9px; border: 1px solid var(--spatial-app-border); padding: 10px; background: color-mix(in srgb, var(--spatial-app-surface) 78%, transparent); }
.spatial-model-parameters__section > header { color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; letter-spacing: .08em; }
.spatial-model-parameters__grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.spatial-model-parameters__slider-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; border-top: 1px dashed var(--spatial-app-border); padding-top: 9px; }
.spatial-model-parameters__label { display: inline-flex; align-items: center; gap: 3px; }
.spatial-model-parameters__switch { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid var(--spatial-app-border); padding: 7px; font-size: 10px; }
@container (max-width: 620px) { .spatial-model-parameters__grid,.spatial-model-parameters__slider-grid { grid-template-columns: 1fr; } }
</style>
