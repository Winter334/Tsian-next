<template>
  <div class="grid gap-3">
    <section class="model-param-section">
      <div class="model-param-section__header">
        <span>COMMON</span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            上下文窗口
            <ParamTip :tip="tips.contextWindow" label="上下文窗口" />
          </span>
          <input
            :value="numToText(parameters.common.contextWindow)"
            type="number"
            placeholder="128000"
            class="field-input"
            @input="updateCommon({ contextWindow: textToNum(($event.target as HTMLInputElement).value) })"
          >
        </label>
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            最大输出 token
            <ParamTip :tip="tips.maxOutputTokens" label="最大输出 token" />
          </span>
          <input
            :value="numToText(parameters.common.maxOutputTokens)"
            type="number"
            placeholder="4096"
            class="field-input"
            @input="updateCommon({ maxOutputTokens: textToNum(($event.target as HTMLInputElement).value) })"
          >
        </label>
      </div>

      <div class="grid gap-2.5">
        <RangeSlider
          :model-value="parameters.common.temperature"
          label="温度"
          :min="0"
          :max="2"
          :step="0.05"
          :tip="tips.temperature"
          nullable
          @update:model-value="(v) => updateCommon({ temperature: v })"
        />
        <RangeSlider
          :model-value="parameters.common.topP"
          label="核采样"
          :min="0"
          :max="2"
          :step="0.05"
          :tip="tips.topP"
          nullable
          @update:model-value="(v) => updateCommon({ topP: v })"
        />
      </div>
    </section>

    <section class="model-param-section">
      <div class="model-param-section__header">
        <span>CAPABILITY</span>
      </div>

      <label class="grid gap-1">
        <span class="field-label flex items-center gap-1.5">
          工具调用模式
          <ParamTip :tip="tips.toolCallMode" label="工具调用模式" />
        </span>
        <Select
          :model-value="toolCallMode"
          @update:model-value="(value) => onToolCallModeChange(value as BrowserAiToolCallMode)"
        >
          <SelectTrigger class="h-8 w-full">
            <SelectValue placeholder="文本" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">文本协议</SelectItem>
            <SelectItem value="native">原生（function calling）</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <div class="grid gap-1">
        <div class="flex items-center justify-between gap-3">
          <span class="field-label flex items-center gap-1.5">
            流式输出
            <ParamTip :tip="tips.streaming" label="流式输出" />
          </span>
          <Switch
            :model-value="streamingEffective"
            @update:model-value="(value) => onStreamingChange(Boolean(value))"
          />
        </div>
      </div>
    </section>

    <section class="model-param-section">
      <div class="model-param-section__header">
        <span>{{ activeProviderTitle }}</span>
      </div>

      <div v-if="kind === 'openai-compatible'" class="grid gap-2.5">
        <RangeSlider
          :model-value="openaiCompatible.frequencyPenalty"
          label="频率惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          :tip="tips.frequencyPenalty"
          nullable
          @update:model-value="(v) => updateOpenAiCompatible({ frequencyPenalty: v })"
        />
        <RangeSlider
          :model-value="openaiCompatible.presencePenalty"
          label="存在惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          :tip="tips.presencePenalty"
          nullable
          @update:model-value="(v) => updateOpenAiCompatible({ presencePenalty: v })"
        />
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            推理程度
            <ParamTip :tip="tips.reasoningEffort" label="推理程度" />
          </span>
          <Select
            :model-value="openaiCompatible.reasoningEffort || NO_REASONING"
            @update:model-value="(value) => updateOpenAiCompatible({ reasoningEffort: normalizeReasoningValue(value) })"
          >
            <SelectTrigger class="h-8 w-full">
              <SelectValue placeholder="不发送" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_REASONING">不发送</SelectItem>
              <SelectItem value="minimal">最低</SelectItem>
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="high">高</SelectItem>
              <SelectItem value="xhigh">最高</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div v-else-if="kind === 'openai-responses'" class="grid gap-2.5">
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            推理程度
            <ParamTip :tip="tips.reasoningEffort" label="推理程度" />
          </span>
          <Select
            :model-value="openaiResponses.reasoningEffort || NO_REASONING"
            @update:model-value="(value) => updateOpenAiResponses({ reasoningEffort: normalizeReasoningValue(value) })"
          >
            <SelectTrigger class="h-8 w-full">
              <SelectValue placeholder="不发送" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_REASONING">不发送</SelectItem>
              <SelectItem value="minimal">最低</SelectItem>
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="high">高</SelectItem>
              <SelectItem value="xhigh">最高</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div v-else-if="kind === 'deepseek'" class="grid gap-2.5">
        <RangeSlider
          :model-value="deepseek.frequencyPenalty"
          label="频率惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          :tip="tips.frequencyPenalty"
          nullable
          @update:model-value="(v) => updateDeepSeek({ frequencyPenalty: v })"
        />
        <RangeSlider
          :model-value="deepseek.presencePenalty"
          label="存在惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          :tip="tips.presencePenalty"
          nullable
          @update:model-value="(v) => updateDeepSeek({ presencePenalty: v })"
        />
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            推理程度
            <ParamTip :tip="tips.reasoningEffort" label="推理程度" />
          </span>
          <Select
            :model-value="deepseek.reasoningEffort || NO_REASONING"
            @update:model-value="(value) => updateDeepSeek({ reasoningEffort: normalizeReasoningValue(value) })"
          >
            <SelectTrigger class="h-8 w-full">
              <SelectValue placeholder="不发送" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="NO_REASONING">不发送</SelectItem>
              <SelectItem value="minimal">最低</SelectItem>
              <SelectItem value="low">低</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="high">高</SelectItem>
              <SelectItem value="xhigh">最高</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <div v-else-if="kind === 'gemini'" class="grid gap-3">
        <div class="grid grid-cols-2 gap-2">
          <label class="grid gap-1">
            <span class="field-label flex items-center gap-1.5">
              候选数量
              <ParamTip :tip="tips.topK" label="候选数量" />
            </span>
            <input
              :value="numToText(gemini.topK)"
              type="number"
              placeholder="40"
              class="field-input"
              @input="updateGemini({ topK: textToNum(($event.target as HTMLInputElement).value) })"
            >
          </label>
          <label class="grid gap-1">
            <span class="field-label flex items-center gap-1.5">
              响应类型
              <ParamTip :tip="tips.responseMimeType" label="响应类型" />
            </span>
            <input
              :value="gemini.responseMimeType"
              type="text"
              placeholder="application/json"
              class="field-input"
              @input="updateGemini({ responseMimeType: ($event.target as HTMLInputElement).value })"
            >
          </label>
        </div>
        <RangeSlider
          :model-value="gemini.frequencyPenalty"
          label="频率惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          :tip="tips.frequencyPenalty"
          nullable
          @update:model-value="(v) => updateGemini({ frequencyPenalty: v })"
        />
        <RangeSlider
          :model-value="gemini.presencePenalty"
          label="存在惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          :tip="tips.presencePenalty"
          nullable
          @update:model-value="(v) => updateGemini({ presencePenalty: v })"
        />
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            停止序列（一行一个）
            <ParamTip :tip="tips.stopSequences" label="停止序列" />
          </span>
          <textarea
            :value="linesToText(gemini.stopSequences)"
            :rows="2"
            spellcheck="false"
            placeholder="END"
            class="field-input"
            @input="updateGemini({ stopSequences: textToLines(($event.target as HTMLTextAreaElement).value) })"
          />
        </label>
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            响应结构 (JSON)
            <ParamTip :tip="tips.responseSchema" label="响应结构" />
          </span>
          <textarea
            :value="gemini.responseSchemaText"
            :rows="3"
            spellcheck="false"
            placeholder='{ "type": "object", "properties": {} }'
            class="field-input"
            @input="updateGemini({ responseSchemaText: ($event.target as HTMLTextAreaElement).value })"
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="grid gap-1">
            <span class="field-label flex items-center gap-1.5">
              思考预算
              <ParamTip :tip="tips.thinkingBudget" label="思考预算" />
            </span>
            <input
              :value="numToText(gemini.thinkingBudget)"
              type="number"
              placeholder="留空"
              class="field-input"
              @input="updateGemini({ thinkingBudget: textToNum(($event.target as HTMLInputElement).value) })"
            >
          </label>
          <div class="grid content-center gap-1">
            <div class="flex items-center justify-between gap-3">
              <span class="field-label flex items-center gap-1.5">
                包含思考
                <ParamTip :tip="tips.includeThoughts" label="包含思考" />
              </span>
              <Switch
                :model-value="gemini.includeThoughts"
                @update:model-value="(value) => updateGemini({ includeThoughts: Boolean(value) })"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="kind === 'claude'" class="grid gap-3">
        <div class="grid grid-cols-2 gap-2">
          <label class="grid gap-1">
            <span class="field-label flex items-center gap-1.5">
              候选数量
              <ParamTip :tip="tips.topK" label="候选数量" />
            </span>
            <input
              :value="numToText(claude.topK)"
              type="number"
              placeholder="留空"
              class="field-input"
              @input="updateClaude({ topK: textToNum(($event.target as HTMLInputElement).value) })"
            >
          </label>
          <label class="grid gap-1">
            <span class="field-label flex items-center gap-1.5">
              服务等级
              <ParamTip :tip="tips.serviceTier" label="服务等级" />
            </span>
            <Select
              :model-value="claude.serviceTier || NO_SERVICE_TIER"
              @update:model-value="(value) => updateClaude({ serviceTier: value === NO_SERVICE_TIER ? '' : (value as BrowserClaudeServiceTier) })"
            >
              <SelectTrigger class="h-8 w-full">
                <SelectValue placeholder="不发送" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="NO_SERVICE_TIER">不发送</SelectItem>
                <SelectItem value="auto">自动</SelectItem>
                <SelectItem value="standard_only">仅标准</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <div class="grid content-center gap-1">
          <div class="flex items-center justify-between gap-3">
            <span class="field-label flex items-center gap-1.5">
              提示词缓存
              <ParamTip :tip="tips.promptCaching" label="提示词缓存" />
            </span>
            <Switch
              :model-value="claude.promptCachingEnabled"
              @update:model-value="(value) => updateClaude({ promptCachingEnabled: Boolean(value) })"
            />
          </div>
        </div>
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            停止序列（一行一个）
            <ParamTip :tip="tips.stopSequences" label="停止序列" />
          </span>
          <textarea
            :value="linesToText(claude.stopSequences)"
            :rows="2"
            spellcheck="false"
            placeholder="END"
            class="field-input"
            @input="updateClaude({ stopSequences: textToLines(($event.target as HTMLTextAreaElement).value) })"
          />
        </label>
        <div class="grid grid-cols-2 gap-2">
          <label class="grid gap-1">
            <span class="field-label flex items-center gap-1.5">
              思考模式
              <ParamTip :tip="tips.thinkingMode" label="思考模式" />
            </span>
            <Select
              :model-value="claude.thinkingMode"
              @update:model-value="(value) => updateClaude({ thinkingMode: value as BrowserClaudeThinkingMode })"
            >
              <SelectTrigger class="h-8 w-full">
                <SelectValue placeholder="关闭" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">关闭</SelectItem>
                <SelectItem value="adaptive">自适应</SelectItem>
                <SelectItem value="enabled">启用</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="grid gap-1">
            <span class="field-label flex items-center gap-1.5">
              思考展示
              <ParamTip :tip="tips.thinkingDisplay" label="思考展示" />
            </span>
            <Select
              :model-value="claude.thinkingDisplay"
              :disabled="claude.thinkingMode === 'disabled'"
              @update:model-value="(value) => updateClaude({ thinkingDisplay: value as BrowserClaudeThinkingDisplay })"
            >
              <SelectTrigger class="h-8 w-full">
                <SelectValue placeholder="摘要" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="summarized">摘要</SelectItem>
                <SelectItem value="omitted">不返回</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <label class="grid gap-1">
          <span class="field-label flex items-center gap-1.5">
            思考预算
            <ParamTip :tip="tips.thinkingBudget" label="思考预算" />
          </span>
          <input
            :value="numToText(claude.thinkingBudgetTokens)"
            type="number"
            placeholder="至少 1024"
            class="field-input"
            @input="updateClaude({ thinkingBudgetTokens: textToNum(($event.target as HTMLInputElement).value) })"
          >
        </label>
      </div>
    </section>

    <section class="model-param-section">
      <div class="model-param-section__header">
        <span>ADVANCED JSON</span>
      </div>
      <label class="grid gap-1">
        <span class="field-label flex items-center gap-1.5">
          自定义请求参数
          <ParamTip :tip="tips.customRequestParams" label="自定义请求参数" />
        </span>
        <textarea
          :value="activeCustomRequestParamsText"
          :rows="3"
          spellcheck="false"
          placeholder='{ "seed": 42 }'
          class="field-input"
          @input="updateActiveCustomRequestParamsText(($event.target as HTMLTextAreaElement).value)"
        />
      </label>
    </section>

    <section v-if="testModel || testToolCalling" class="model-param-section">
      <div class="model-param-section__header">
        <span>TEST</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="testModel"
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-3 font-mono text-xs disabled:opacity-45"
          :disabled="isTesting || !modelId.trim()"
          @click="runModelPing"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': testingChat }" aria-hidden="true" />
          Chat 测试
        </button>
        <button
          v-if="testToolCalling"
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-3 font-mono text-xs disabled:opacity-45"
          :disabled="isTesting || !modelId.trim()"
          @click="runToolCallingProbe"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': testingToolCalling }" aria-hidden="true" />
          原生工具调用测试
        </button>
        <span v-if="!modelId.trim()" class="font-mono text-[10px] text-text-dim/70">请先填写模型 id。</span>
        <span
          v-else-if="testResult"
          class="font-mono text-[10px]"
          :class="testResult.ok ? 'text-neon' : 'text-danger'"
        >
          {{ testResult.ok ? '✓ ' : '✗ ' }}{{ testResult.message }}
        </span>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { RefreshCw } from "lucide-vue-next"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RangeSlider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ParamTip } from "@/components/ui/tip"
import {
  cloneBrowserAiModelParameters,
  type BrowserAiCommonModelParameters,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiToolCallMode,
  type BrowserClaudeModelParameters,
  type BrowserClaudeServiceTier,
  type BrowserClaudeThinkingDisplay,
  type BrowserClaudeThinkingMode,
  type BrowserDeepSeekModelParameters,
  type BrowserGeminiModelParameters,
  type BrowserOpenAiCompatibleModelParameters,
  type BrowserOpenAiResponsesModelParameters,
} from "@/config/ai"
import {
  MODEL_PARAMETER_TIPS,
  NO_REASONING_OPTION,
  NO_SERVICE_TIER_OPTION,
  activeCustomRequestParamsText as activeCustomRequestParamsTextForKind,
  activeProviderTitleForKind,
  claudeParams,
  deepSeekParams,
  geminiParams,
  linesToText,
  normalizeReasoningValue,
  numToText,
  openAiCompatibleParams,
  openAiResponsesParams,
  textToLines,
  textToNum,
  updateActiveCustomRequestParamsText as updateActiveCustomRequestParamsTextForKind,
  updateClaudeParameters,
  updateCommonParameters,
  updateDeepSeekParameters,
  updateGeminiParameters,
  updateOpenAiCompatibleParameters,
  updateOpenAiResponsesParameters,
} from "@/controllers/settings/model-parameter-helpers"

const props = withDefaults(defineProps<{
  parameters: BrowserAiModelParameters
  kind: BrowserAiProviderKind
  toolCallMode: BrowserAiToolCallMode
  streaming: boolean
  modelId?: string
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
}>(), {
  modelId: "",
})

const emit = defineEmits<{
  (e: "update:parameters", value: BrowserAiModelParameters): void
  (e: "update:toolCallMode", value: BrowserAiToolCallMode): void
  (e: "update:streaming", value: boolean): void
}>()

const NO_REASONING = NO_REASONING_OPTION
const NO_SERVICE_TIER = NO_SERVICE_TIER_OPTION

const tips = MODEL_PARAMETER_TIPS

const testingChat = ref(false)
const testingToolCalling = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

const isTesting = computed(() => testingChat.value || testingToolCalling.value)

watch(
  () => props.modelId,
  () => {
    testResult.value = null
  },
)

const openaiCompatible = computed(
  () => openAiCompatibleParams(props.parameters),
)
const openaiResponses = computed(
  () => openAiResponsesParams(props.parameters),
)
const deepseek = computed(
  () => deepSeekParams(props.parameters),
)
const gemini = computed(
  () => geminiParams(props.parameters),
)
const claude = computed(
  () => claudeParams(props.parameters),
)

const activeProviderTitle = computed(() => activeProviderTitleForKind(props.kind))

const activeCustomRequestParamsText = computed(() => activeCustomRequestParamsTextForKind(props.parameters, props.kind))

const streamingEffective = computed(() => props.streaming)

function emitParameters(value: BrowserAiModelParameters): void {
  testResult.value = null
  emit("update:parameters", value)
}

function updateCommon(patch: Partial<BrowserAiCommonModelParameters>): void {
  emitParameters(updateCommonParameters(props.parameters, patch))
}

function updateOpenAiCompatible(patch: Partial<BrowserOpenAiCompatibleModelParameters>): void {
  emitParameters(updateOpenAiCompatibleParameters(props.parameters, patch))
}

function updateOpenAiResponses(patch: Partial<BrowserOpenAiResponsesModelParameters>): void {
  emitParameters(updateOpenAiResponsesParameters(props.parameters, patch))
}

function updateDeepSeek(patch: Partial<BrowserDeepSeekModelParameters>): void {
  emitParameters(updateDeepSeekParameters(props.parameters, patch))
}

function updateGemini(patch: Partial<BrowserGeminiModelParameters>): void {
  emitParameters(updateGeminiParameters(props.parameters, patch))
}

function updateClaude(patch: Partial<BrowserClaudeModelParameters>): void {
  emitParameters(updateClaudeParameters(props.parameters, patch))
}

function updateActiveCustomRequestParamsText(value: string): void {
  emitParameters(updateActiveCustomRequestParamsTextForKind(props.parameters, props.kind, value))
}

function onToolCallModeChange(mode: BrowserAiToolCallMode): void {
  testResult.value = null
  emit("update:toolCallMode", mode)
}

function onStreamingChange(value: boolean): void {
  testResult.value = null
  emit("update:streaming", value)
}

async function runModelPing(): Promise<void> {
  if (!props.testModel || isTesting.value) {
    return
  }
  const modelId = props.modelId.trim()
  if (!modelId) {
    testResult.value = { ok: false, message: "请先填写模型 id。" }
    return
  }
  testingChat.value = true
  testResult.value = null
  try {
    const result = await props.testModel({
      modelId,
      parameters: cloneBrowserAiModelParameters(props.parameters),
      toolCallMode: props.toolCallMode,
      streaming: props.streaming,
    })
    testResult.value = { ...result, message: `Chat：${result.message}` }
  } catch (error) {
    testResult.value = {
      ok: false,
      message: error instanceof Error ? `Chat：${error.message}` : "Chat：模型测试失败。",
    }
  } finally {
    testingChat.value = false
  }
}

async function runToolCallingProbe(): Promise<void> {
  if (!props.testToolCalling || isTesting.value) {
    return
  }
  const modelId = props.modelId.trim()
  if (!modelId) {
    testResult.value = { ok: false, message: "请先填写模型 id。" }
    return
  }
  testingToolCalling.value = true
  testResult.value = null
  try {
    const result = await props.testToolCalling({
      modelId,
      parameters: cloneBrowserAiModelParameters(props.parameters),
      toolCallMode: props.toolCallMode,
      streaming: props.streaming,
    })
    testResult.value = { ...result, message: `工具调用：${result.message}` }
  } catch (error) {
    testResult.value = {
      ok: false,
      message: error instanceof Error ? `工具调用：${error.message}` : "工具调用：测试失败。",
    }
  } finally {
    testingToolCalling.value = false
  }
}

</script>

<style scoped>
.model-param-section {
  display: grid;
  gap: 0.625rem;
  border: 1px solid rgba(159, 119, 64, 0.35);
  background: rgba(44, 42, 36, 0.42);
  padding: 0.75rem;
}

.model-param-section__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid rgba(159, 119, 64, 0.25);
  padding-bottom: 0.375rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.model-param-section__header span {
  font-size: 0.625rem;
  letter-spacing: 0.14em;
  color: #f3c56d;
}

.field-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.625rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(185, 173, 146, 0.82);
}

.field-input {
  width: 100%;
  border: 1px solid rgba(159, 119, 64, 0.55);
  background: #3a352b;
  padding: 0.375rem 0.5rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.75rem;
  color: #f6ecd7;
  transition: border-color 0.12s ease;
}

.field-input:focus {
  outline: none;
  border-color: var(--color-neon);
}

.field-input::placeholder {
  color: rgba(185, 173, 146, 0.6);
}
</style>
