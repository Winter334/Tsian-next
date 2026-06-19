<template>
  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
    <ModelNumberField
      label="上下文窗口"
      placeholder="例如 128000"
      :model-value="paramValue('contextWindow')"
      @update:model-value="setNumberParameter('contextWindow', $event)"
    />
    <ModelNumberField
      label="最大输出 token"
      placeholder="例如 4096"
      :model-value="paramValue('maxOutputTokens')"
      @update:model-value="setNumberParameter('maxOutputTokens', $event)"
    />
    <ModelNumberField
      label="温度"
      placeholder="0 - 2"
      step="0.1"
      :model-value="paramValue('temperature')"
      @update:model-value="setNumberParameter('temperature', $event)"
    />
    <ModelNumberField
      label="top_p"
      placeholder="0 - 2"
      step="0.1"
      :model-value="paramValue('topP')"
      @update:model-value="setNumberParameter('topP', $event)"
    />
    <ModelNumberField
      label="频率惩罚"
      placeholder="-2 - 2"
      step="0.1"
      :model-value="paramValue('frequencyPenalty')"
      @update:model-value="setNumberParameter('frequencyPenalty', $event)"
    />
    <ModelNumberField
      label="存在惩罚"
      placeholder="-2 - 2"
      step="0.1"
      :model-value="paramValue('presencePenalty')"
      @update:model-value="setNumberParameter('presencePenalty', $event)"
    />
  </div>

  <div class="mt-3 grid gap-2">
    <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">推理程度</Label>
    <Select
      :model-value="modelConfig.parameters.reasoningEffort || NO_REASONING_EFFORT"
      @update:model-value="(value) => setReasoningEffort(value as string)"
    >
      <SelectTrigger class="h-9 w-full">
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

  <div class="mt-3 grid gap-2">
    <Label class="font-mono text-[11px] uppercase tracking-wider text-text-dim">自定义请求参数</Label>
    <textarea
      :value="modelConfig.parameters.customRequestParamsText"
      rows="6"
      spellcheck="false"
      placeholder="{&#10;  &quot;seed&quot;: 42&#10;}"
      class="retro-focus retro-select-surface min-h-28 resize-y border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs leading-5 text-text-main placeholder:text-text-dim/60"
      @input="setCustomParamsText(($event.target as HTMLTextAreaElement).value)"
    />
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h } from "vue"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  BrowserAiModelConfig,
  BrowserAiModelParameters,
  BrowserAiReasoningEffort,
} from "@/config/ai"

const props = defineProps<{
  modelConfig: BrowserAiModelConfig
}>()

const emit = defineEmits<{
  (e: "update", patch: Partial<BrowserAiModelParameters>): void
}>()

const NO_REASONING_EFFORT = "__none"

const reasoningEffortOptions: Array<{ value: BrowserAiReasoningEffort | typeof NO_REASONING_EFFORT; label: string }> = [
  { value: NO_REASONING_EFFORT, label: "不发送" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
]

type NumericParameterKey = Exclude<
  keyof BrowserAiModelParameters,
  "reasoningEffort" | "customRequestParamsText"
>

function paramValue(key: NumericParameterKey): string {
  const value = props.modelConfig.parameters[key]
  return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
}

function setNumberParameter(key: NumericParameterKey, value: string | number): void {
  const normalized = String(value).trim()
  emit("update", { [key]: normalized ? Number(normalized) : null } as Partial<BrowserAiModelParameters>)
}

function setReasoningEffort(value: string): void {
  const effort = (value === NO_REASONING_EFFORT ? "" : value) as BrowserAiReasoningEffort
  emit("update", { reasoningEffort: effort })
}

function setCustomParamsText(value: string): void {
  emit("update", { customRequestParamsText: value })
}

const inputClass = "retro-focus retro-select-surface h-9 border border-neon-deep/55 bg-elevated px-3 font-mono text-xs text-text-main placeholder:text-text-dim/60"

// Inline number field matching the original SettingsView styling.
const ModelNumberField = defineComponent({
  props: {
    label: { type: String, required: true },
    modelValue: { type: String, required: true },
    placeholder: { type: String, default: "" },
    step: { type: String, default: "1" },
  },
  emits: ["update:modelValue"],
  setup(fieldProps, { emit: fieldEmit }) {
    return () => h("div", { class: "grid gap-2" }, [
      h(Label, { class: "font-mono text-[11px] uppercase tracking-wider text-text-dim" }, () => fieldProps.label),
      h(Input, {
        class: inputClass,
        modelValue: fieldProps.modelValue,
        type: "number",
        step: fieldProps.step,
        placeholder: fieldProps.placeholder,
        "onUpdate:modelValue": (value: string | number) => fieldEmit("update:modelValue", value),
      }),
    ])
  },
})
</script>
