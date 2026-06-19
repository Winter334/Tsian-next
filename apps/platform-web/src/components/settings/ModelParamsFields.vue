<template>
  <div class="grid gap-3">
    <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">模型参数（可选，留空用默认）</p>
    <div class="grid grid-cols-2 gap-2">
      <label class="grid gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim/80">上下文窗口</span>
        <input
          :value="numToText(parameters.contextWindow)"
          type="number"
          placeholder="128000"
          class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-2 py-1.5 font-mono text-xs text-text-main placeholder:text-text-dim/60"
          @input="emit('update:parameters', { ...parameters, contextWindow: textToNum(($event.target as HTMLInputElement).value) })"
        >
      </label>
      <label class="grid gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim/80">最大输出 token</span>
        <input
          :value="numToText(parameters.maxOutputTokens)"
          type="number"
          placeholder="4096"
          class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-2 py-1.5 font-mono text-xs text-text-main placeholder:text-text-dim/60"
          @input="emit('update:parameters', { ...parameters, maxOutputTokens: textToNum(($event.target as HTMLInputElement).value) })"
        >
      </label>
    </div>

    <div class="grid gap-2.5">
      <RangeSlider
        :model-value="parameters.temperature"
        label="温度"
        :min="0"
        :max="2"
        :step="0.05"
        nullable
        @update:model-value="(v) => emit('update:parameters', { ...parameters, temperature: v })"
      />
      <RangeSlider
        :model-value="parameters.topP"
        label="top_p"
        :min="0"
        :max="2"
        :step="0.05"
        nullable
        @update:model-value="(v) => emit('update:parameters', { ...parameters, topP: v })"
      />
      <RangeSlider
        :model-value="parameters.frequencyPenalty"
        label="频率惩罚"
        :min="-2"
        :max="2"
        :step="0.1"
        nullable
        @update:model-value="(v) => emit('update:parameters', { ...parameters, frequencyPenalty: v })"
      />
      <RangeSlider
        :model-value="parameters.presencePenalty"
        label="存在惩罚"
        :min="-2"
        :max="2"
        :step="0.1"
        nullable
        @update:model-value="(v) => emit('update:parameters', { ...parameters, presencePenalty: v })"
      />
    </div>

    <label class="grid gap-1">
      <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim/80">推理程度</span>
      <Select
        :model-value="parameters.reasoningEffort || NO_REASONING"
        @update:model-value="(value) => emit('update:parameters', { ...parameters, reasoningEffort: value === NO_REASONING ? '' : (value as BrowserAiModelParameters['reasoningEffort']) })"
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
      <p class="font-mono text-[10px] leading-4 text-text-dim/60">{{ reasoningHint }}</p>
    </label>

    <label class="grid gap-1">
      <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim/80">工具调用模式</span>
      <Select
        :model-value="toolCallMode"
        @update:model-value="(value) => emit('update:toolCallMode', value as BrowserAiToolCallMode)"
      >
        <SelectTrigger class="h-8 w-full">
          <SelectValue placeholder="文本" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="text">文本（兼容）</SelectItem>
          <SelectItem value="native">原生（function calling）</SelectItem>
        </SelectContent>
      </Select>
      <p class="font-mono text-[10px] leading-4 text-text-dim/60">{{ toolCallModeHint }}</p>
    </label>

    <label class="grid gap-1">
      <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim/80">自定义请求参数 (JSON)</span>
      <textarea
        :value="parameters.customRequestParamsText"
        :rows="3"
        spellcheck="false"
        placeholder='{ "seed": 42 }'
        class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-2 py-1.5 font-mono text-xs text-text-main placeholder:text-text-dim/60"
        @input="emit('update:parameters', { ...parameters, customRequestParamsText: ($event.target as HTMLTextAreaElement).value })"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { RangeSlider } from "@/components/ui/slider"
import {
  reasoningEffortHintForKind,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserAiToolCallMode,
} from "@/config/ai"

const props = defineProps<{
  parameters: BrowserAiModelParameters
  kind: BrowserAiProviderKind
  toolCallMode: BrowserAiToolCallMode
}>()

const emit = defineEmits<{
  (e: "update:parameters", value: BrowserAiModelParameters): void
  (e: "update:toolCallMode", value: BrowserAiToolCallMode): void
}>()

const NO_REASONING = "__none"

const reasoningHint = computed(() => reasoningEffortHintForKind(props.kind))

const toolCallModeHint = computed(() =>
  props.toolCallMode === "native"
    ? "使用 API 原生 function calling，结构化工具调用边界，支持流式。请确认你的接口支持原生工具调用。"
    : "使用 <tsian-tool-call> 文本协议，兼容所有接口，不支持流式。",
)

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
</script>
