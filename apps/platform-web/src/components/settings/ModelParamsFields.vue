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
            <SelectItem value="text">文本（兼容）</SelectItem>
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
  createDefaultBrowserClaudeModelParameters,
  createDefaultBrowserDeepSeekModelParameters,
  createDefaultBrowserGeminiModelParameters,
  createDefaultBrowserOpenAiCompatibleModelParameters,
  createDefaultBrowserOpenAiResponsesModelParameters,
  type BrowserAiCommonModelParameters,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiReasoningEffort,
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

const NO_REASONING = "__none"
const NO_SERVICE_TIER = "__none"

// Parameter descriptions shown via the ⓘ tip buttons. Kept here so the
// template stays compact; the original API field name is included for users
// who need to map a label back to the request payload.
const tips = {
  contextWindow: "模型能处理的最大上下文长度（token 数）。用于在发送前截断过长的历史消息。",
  maxOutputTokens: "模型单次回复的最大 token 数。值越大回复越长，但消耗更多额度。对应 max_tokens / max_output_tokens。",
  temperature: "采样温度，控制输出随机性。0 更确定/聚焦，2 更发散/有创意，常见值 0.7。对应 temperature。",
  topP: "核采样阈值：只从累计概率达到 top_p 的候选词中采样。与温度二选一调节即可。对应 top_p。",
  toolCallMode: "模型调用工具的方式。原生 = 使用 function calling，结构化工具边界更清晰；文本（兼容）= 把工具调用嵌在回复文本里，适合不支持原生工具的接口。",
  streaming: "开启后逐 token 流式返回回复，首字更快；关闭则一次性返回完整结果。",
  frequencyPenalty: "对已出现的高频词施加惩罚以降低重复。正值减少重复，负值增加重复，范围 -2~2。对应 frequency_penalty。",
  presencePenalty: "鼓励引入新话题。正值提升模型谈论新内容的概率，负值相反，范围 -2~2。对应 presence_penalty。",
  reasoningEffort: "推理模型的思考强度，越高推理越深但更慢更贵。不发送 = 不向接口传该参数。对应 reasoning_effort。",
  topK: "采样候选数量：每个位置只从概率最高的 K 个候选词中采样。越大越多样，越小越确定。对应 topK / top_k。",
  responseMimeType: "强制指定响应的 MIME 类型，如 application/json 让模型直接返回 JSON。对应 responseMimeType。",
  responseSchema: "用 JSON Schema 约束结构化输出的字段与类型，需配合响应类型 application/json。对应 responseSchema。",
  stopSequences: "遇到这些字符串时立即停止生成，每行一个。对应 stop_sequences / stopSequences。",
  thinkingBudget: "思考模式的最大思考 token 预算。留空 = 不限制/不发送。对应 thinkingBudget / budget_tokens。",
  includeThoughts: "是否在响应中返回模型的思考过程内容。对应 includeThoughts。",
  serviceTier: "服务等级，影响延迟与可用性。auto = 自动选择，standard_only = 仅标准。对应 service_tier。",
  thinkingMode: "Claude 扩展思考开关。disabled = 关闭，adaptive = 自适应，enabled = 启用。对应 thinking.type。",
  thinkingDisplay: "思考内容的展示方式。summarized = 摘要展示，omitted = 不返回思考内容。对应 thinking.display。",
  customRequestParams: "以 JSON 形式追加任意请求参数，会合并到发送给接口的请求体中。适合配置未被面板覆盖的字段，如 { \"seed\": 42 }。",
} as const

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
  () => props.parameters.provider.openaiCompatible ?? createDefaultBrowserOpenAiCompatibleModelParameters(),
)
const openaiResponses = computed(
  () => props.parameters.provider.openaiResponses ?? createDefaultBrowserOpenAiResponsesModelParameters(),
)
const deepseek = computed(
  () => props.parameters.provider.deepseek ?? createDefaultBrowserDeepSeekModelParameters(),
)
const gemini = computed(
  () => props.parameters.provider.gemini ?? createDefaultBrowserGeminiModelParameters(),
)
const claude = computed(
  () => props.parameters.provider.claude ?? createDefaultBrowserClaudeModelParameters(),
)

const activeProviderTitle = computed(() => {
  switch (props.kind) {
    case "openai-responses":
      return "OPENAI RESPONSES"
    case "deepseek":
      return "DEEPSEEK"
    case "gemini":
      return "GEMINI"
    case "claude":
      return "CLAUDE"
    case "openai-compatible":
    default:
      return "OPENAI CHAT"
  }
})

const activeCustomRequestParamsText = computed(() => {
  switch (props.kind) {
    case "openai-responses":
      return openaiResponses.value.customRequestParamsText
    case "deepseek":
      return deepseek.value.customRequestParamsText
    case "gemini":
      return gemini.value.customRequestParamsText
    case "claude":
      return claude.value.customRequestParamsText
    case "openai-compatible":
    default:
      return openaiCompatible.value.customRequestParamsText
  }
})

const streamingEffective = computed(() => props.streaming)

function emitParameters(value: BrowserAiModelParameters): void {
  testResult.value = null
  emit("update:parameters", value)
}

function updateCommon(patch: Partial<BrowserAiCommonModelParameters>): void {
  emitParameters({
    ...props.parameters,
    common: { ...props.parameters.common, ...patch },
    provider: { ...props.parameters.provider },
  })
}

function updateOpenAiCompatible(patch: Partial<BrowserOpenAiCompatibleModelParameters>): void {
  emitParameters({
    ...props.parameters,
    provider: {
      ...props.parameters.provider,
      openaiCompatible: { ...openaiCompatible.value, ...patch },
    },
  })
}

function updateOpenAiResponses(patch: Partial<BrowserOpenAiResponsesModelParameters>): void {
  emitParameters({
    ...props.parameters,
    provider: {
      ...props.parameters.provider,
      openaiResponses: { ...openaiResponses.value, ...patch },
    },
  })
}

function updateDeepSeek(patch: Partial<BrowserDeepSeekModelParameters>): void {
  emitParameters({
    ...props.parameters,
    provider: {
      ...props.parameters.provider,
      deepseek: { ...deepseek.value, ...patch },
    },
  })
}

function updateGemini(patch: Partial<BrowserGeminiModelParameters>): void {
  emitParameters({
    ...props.parameters,
    provider: {
      ...props.parameters.provider,
      gemini: { ...gemini.value, ...patch },
    },
  })
}

function updateClaude(patch: Partial<BrowserClaudeModelParameters>): void {
  emitParameters({
    ...props.parameters,
    provider: {
      ...props.parameters.provider,
      claude: { ...claude.value, ...patch },
    },
  })
}

function normalizeReasoningValue(value: unknown): BrowserAiReasoningEffort {
  return typeof value === "string" && value !== NO_REASONING
    ? value as BrowserAiReasoningEffort
    : ""
}

function updateActiveCustomRequestParamsText(value: string): void {
  switch (props.kind) {
    case "openai-responses":
      updateOpenAiResponses({ customRequestParamsText: value })
      return
    case "deepseek":
      updateDeepSeek({ customRequestParamsText: value })
      return
    case "gemini":
      updateGemini({ customRequestParamsText: value })
      return
    case "claude":
      updateClaude({ customRequestParamsText: value })
      return
    case "openai-compatible":
    default:
      updateOpenAiCompatible({ customRequestParamsText: value })
  }
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

function numToText(value: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
}

function textToNum(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === "") {
    return null
  }
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

function linesToText(value: string[]): string {
  return value.join("\n")
}

function textToLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
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
