<template>
  <div class="mx-auto max-w-3xl border border-neon/30 bg-neon/5 px-3.5 py-3">
    <div class="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neon">
      <HelpCircle class="h-3 w-3" aria-hidden="true" />
      <span>助手提问</span>
    </div>
    <p class="prose-chat mt-1.5 text-sm leading-6 text-text-main" v-html="renderMarkdown(activeAsk.question)" />

    <!-- 选项按钮 -->
    <div v-if="activeAsk.options && activeAsk.options.length > 0" class="mt-2.5 grid gap-1.5">
      <button
        v-for="opt in activeAsk.options"
        :key="opt"
        type="button"
        class="retro-focus border border-neon-deep/35 bg-panel/55 px-3 py-2 text-left text-sm text-text-main transition-colors hover:border-neon/55 hover:bg-neon/10"
        @click="$emit('answer', { requestId: activeAsk.requestId, answer: opt })"
      >{{ opt }}</button>
    </div>

    <!-- 自定义输入(allowCustom 为 true 时);ask 期间唯一的输入框 -->
    <div v-if="activeAsk.allowCustom" class="mt-2.5 flex items-center gap-2">
      <input
        ref="askCustomInputRef"
        type="text"
        class="retro-focus h-10 flex-1 border border-neon-deep/40 bg-panel/55 px-3 text-sm text-text-main placeholder:text-text-dim focus:border-neon/55"
        placeholder="自定义回答…"
        spellcheck="false"
        @keydown.enter.prevent="submitCustom"
      >
      <button
        type="button"
        class="retro-button retro-focus inline-flex h-10 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
        @click="submitCustom"
      >
        <Send class="h-4 w-4" aria-hidden="true" />
        提交
      </button>
    </div>

    <!-- 取消:resolve ask 为 cancelled,turn 继续(助手收尾);取消后回到普通输入态,若助手继续生成可再停止 -->
    <div class="mt-2.5 flex justify-end">
      <button
        type="button"
        class="retro-focus border border-neon-deep/30 bg-panel/40 px-3 py-1.5 text-xs text-text-dim transition-colors hover:border-red-400/50 hover:text-red-400"
        @click="$emit('cancel', activeAsk.requestId)"
      >取消</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue"
import { HelpCircle, Send } from "lucide-vue-next"
import { renderMarkdown } from "@/lib/markdown"
import type { ActiveAskState } from "./types"

const props = defineProps<{
  activeAsk: ActiveAskState
}>()

const emit = defineEmits<{
  answer: [payload: { requestId: string; answer: string }]
  submitCustom: [payload: { requestId: string; value: string }]
  cancel: [requestId: string]
}>()

const askCustomInputRef = ref<HTMLInputElement | null>(null)

function focusCustomInput() {
  askCustomInputRef.value?.focus()
}

function submitCustom() {
  emit("submitCustom", {
    requestId: props.activeAsk.requestId,
    value: askCustomInputRef.value?.value ?? "",
  })
}

watch(
  () => props.activeAsk.requestId,
  () => nextTick(focusCustomInput),
  { immediate: true },
)
</script>
