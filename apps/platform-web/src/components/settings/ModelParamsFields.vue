<template>
  <div class="grid gap-3">
    <section class="model-param-section">
      <div class="model-param-section__header">
        <span>COMMON</span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <label class="grid gap-1">
          <span class="field-label">上下文窗口</span>
          <input
            :value="numToText(parameters.common.contextWindow)"
            type="number"
            placeholder="128000"
            class="field-input"
            @input="updateCommon({ contextWindow: textToNum(($event.target as HTMLInputElement).value) })"
          >
        </label>
        <label class="grid gap-1">
          <span class="field-label">最大输出 token</span>
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
          nullable
          @update:model-value="(v) => updateCommon({ temperature: v })"
        />
        <RangeSlider
          :model-value="parameters.common.topP"
          label="top_p"
          :min="0"
          :max="2"
          :step="0.05"
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
        <span class="field-label">工具调用模式</span>
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
          <span class="field-label">流式输出</span>
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
          nullable
          @update:model-value="(v) => updateOpenAiCompatible({ frequencyPenalty: v })"
        />
        <RangeSlider
          :model-value="openaiCompatible.presencePenalty"
          label="存在惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          nullable
          @update:model-value="(v) => updateOpenAiCompatible({ presencePenalty: v })"
        />
        <label class="grid gap-1">
          <span class="field-label">推理程度</span>
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
          <span class="field-label">推理程度</span>
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
          nullable
          @update:model-value="(v) => updateDeepSeek({ frequencyPenalty: v })"
        />
        <RangeSlider
          :model-value="deepseek.presencePenalty"
          label="存在惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          nullable
          @update:model-value="(v) => updateDeepSeek({ presencePenalty: v })"
        />
        <label class="grid gap-1">
          <span class="field-label">推理程度</span>
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
            <span class="field-label">topK</span>
            <input
              :value="numToText(gemini.topK)"
              type="number"
              placeholder="40"
              class="field-input"
              @input="updateGemini({ topK: textToNum(($event.target as HTMLInputElement).value) })"
            >
          </label>
          <label class="grid gap-1">
            <span class="field-label">responseMimeType</span>
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
          nullable
          @update:model-value="(v) => updateGemini({ frequencyPenalty: v })"
        />
        <RangeSlider
          :model-value="gemini.presencePenalty"
          label="存在惩罚"
          :min="-2"
          :max="2"
          :step="0.1"
          nullable
          @update:model-value="(v) => updateGemini({ presencePenalty: v })"
        />
        <label class="grid gap-1">
          <span class="field-label">停止序列（一行一个）</span>
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
          <span class="field-label">responseSchema (JSON)</span>
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
            <span class="field-label">thinkingBudget</span>
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
              <span class="field-label">includeThoughts</span>
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
            <span class="field-label">top_k</span>
            <input
              :value="numToText(claude.topK)"
              type="number"
              placeholder="留空"
              class="field-input"
              @input="updateClaude({ topK: textToNum(($event.target as HTMLInputElement).value) })"
            >
          </label>
          <label class="grid gap-1">
            <span class="field-label">service_tier</span>
            <Select
              :model-value="claude.serviceTier || NO_SERVICE_TIER"
              @update:model-value="(value) => updateClaude({ serviceTier: value === NO_SERVICE_TIER ? '' : (value as BrowserClaudeServiceTier) })"
            >
              <SelectTrigger class="h-8 w-full">
                <SelectValue placeholder="不发送" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="NO_SERVICE_TIER">不发送</SelectItem>
                <SelectItem value="auto">auto</SelectItem>
                <SelectItem value="standard_only">standard_only</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <label class="grid gap-1">
          <span class="field-label">stop_sequences（一行一个）</span>
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
            <span class="field-label">thinking.type</span>
            <Select
              :model-value="claude.thinkingMode"
              @update:model-value="(value) => updateClaude({ thinkingMode: value as BrowserClaudeThinkingMode })"
            >
              <SelectTrigger class="h-8 w-full">
                <SelectValue placeholder="disabled" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="disabled">disabled</SelectItem>
                <SelectItem value="adaptive">adaptive</SelectItem>
                <SelectItem value="enabled">enabled</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label class="grid gap-1">
            <span class="field-label">thinking.display</span>
            <Select
              :model-value="claude.thinkingDisplay"
              :disabled="claude.thinkingMode === 'disabled'"
              @update:model-value="(value) => updateClaude({ thinkingDisplay: value as BrowserClaudeThinkingDisplay })"
            >
              <SelectTrigger class="h-8 w-full">
                <SelectValue placeholder="summarized" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="summarized">summarized</SelectItem>
                <SelectItem value="omitted">omitted</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>
        <label class="grid gap-1">
          <span class="field-label">thinking.budget_tokens</span>
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
      <textarea
        :value="activeCustomRequestParamsText"
        :rows="3"
        spellcheck="false"
        placeholder='{ "seed": 42 }'
        class="field-input"
        @input="updateActiveCustomRequestParamsText(($event.target as HTMLTextAreaElement).value)"
      />
    </section>

    <section v-if="testModel" class="model-param-section">
      <div class="model-param-section__header">
        <span>TEST</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-1.5 px-3 font-mono text-xs disabled:opacity-45"
          :disabled="testing || !modelId.trim()"
          @click="runModelPing"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': testing }" aria-hidden="true" />
          测试当前模型
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
import { computed, ref } from "vue"
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

const testing = ref(false)
const testResult = ref<{ ok: boolean; message: string } | null>(null)

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
  if (!props.testModel || testing.value) {
    return
  }
  const modelId = props.modelId.trim()
  if (!modelId) {
    testResult.value = { ok: false, message: "请先填写模型 id。" }
    return
  }
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await props.testModel({
      modelId,
      parameters: cloneBrowserAiModelParameters(props.parameters),
      toolCallMode: props.toolCallMode,
      streaming: props.streaming,
    })
  } catch (error) {
    testResult.value = {
      ok: false,
      message: error instanceof Error ? error.message : "模型测试失败。",
    }
  } finally {
    testing.value = false
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
}

.field-input::placeholder {
  color: rgba(185, 173, 146, 0.6);
}
</style>
