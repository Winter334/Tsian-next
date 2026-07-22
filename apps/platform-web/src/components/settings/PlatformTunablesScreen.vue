<template>
  <div class="grid h-full min-h-0 items-start justify-items-center overflow-auto p-5">
    <div class="grid w-full max-w-2xl gap-4">
      <div class="border-b border-neon-deep/25 pb-3">
        <p class="font-mono text-[10px] uppercase tracking-wider text-neon">平台</p>
        <h2 class="mt-1 text-sm font-bold text-text-main">运行参数</h2>
        <p class="mt-1.5 text-xs leading-5 text-text-dim">
          调整 Tsian 怎样保留进度、整理长对话、等待 AI 回复和保存助手聊天。
          保存后会用于后续操作，并只保存在本设备；不会写入游戏卡，也不会随单个存档回滚。
        </p>
      </div>

      <form class="grid gap-3" @submit.prevent="handleSave">
        <!-- 进度回溯记录 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">进度回溯记录</p>
          <p class="text-[11px] leading-4 text-text-dim">
            Tsian 会自动整理旧进度记录：最近记录完整保留，较早记录按间隔留作回溯，你手动保存的记录不会被清理。
          </p>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="grid gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                保留最近记录数 <span class="text-neon/60">（默认 50）</span>
              </span>
              <input
                v-model.number="form.checkpointPrune.keepRecent"
                type="number"
                min="1"
                class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </label>
            <label class="grid gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                早期记录保留间隔 <span class="text-neon/60">（默认 20）</span>
              </span>
              <input
                v-model.number="form.checkpointPrune.sparseEvery"
                type="number"
                min="1"
                class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </label>
          </div>
        </section>

        <!-- 长对话整理 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">长对话整理</p>
          <p class="text-[11px] leading-4 text-text-dim">
            当剧情或助手聊天变长时，Tsian 会把较早内容整理成摘要，给后续回复留出空间。上下文压缩阈值越高，越晚整理；越低，越早整理。
          </p>
          <div class="grid gap-2 sm:grid-cols-2">
            <RangeSlider
              :model-value="form.contextCompression.narrativeTriggerRatio"
              label="剧情上下文压缩阈值（默认 0.85）"
              :min="0.05"
              :max="1"
              :step="0.05"
              @update:model-value="(value) => updateContextCompressionRatio('narrativeTriggerRatio', value)"
            />
            <RangeSlider
              :model-value="form.contextCompression.taskTriggerRatio"
              label="助手上下文压缩阈值（默认 0.45）"
              :min="0.05"
              :max="1"
              :step="0.05"
              @update:model-value="(value) => updateContextCompressionRatio('taskTriggerRatio', value)"
            />
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="grid gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                保留最近剧情轮数 <span class="text-neon/60">（默认 5）</span>
              </span>
              <input
                v-model.number="form.contextCompression.keepRecentTurns"
                type="number"
                min="1"
                class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </label>
            <label class="grid gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                保留最近助手轮数 <span class="text-neon/60">（默认 5）</span>
              </span>
              <input
                v-model.number="form.contextCompression.taskKeepRecentRounds"
                type="number"
                min="1"
                class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </label>
          </div>
        </section>

        <!-- AI 等待时间 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">AI 等待时间</p>
          <p class="text-[11px] leading-4 text-text-dim">
            单次 AI 回复最多等待多久。设得太短可能提前中断较慢模型；设得太长则错误会更晚出现。
          </p>
          <label class="grid gap-1">
            <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
              最长等待时间（毫秒） <span class="text-neon/60">（默认 600000 = 10 分钟）</span>
            </span>
            <input
              v-model.number="form.ai.chatTimeoutMs"
              type="number"
              min="1000"
              step="1000"
              class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            />
          </label>
        </section>

        <!-- 助手聊天记录 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">助手聊天记录</p>
          <p class="text-[11px] leading-4 text-text-dim">
            每个桌面助手聊天最多保存多少条消息。超过后会从最早的消息开始清理，避免本地记录无限增长。
          </p>
          <label class="grid gap-1">
            <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
              最多保存消息数 <span class="text-neon/60">（默认 200）</span>
            </span>
            <input
              v-model.number="form.assistant.maxStoredMessages"
              type="number"
              min="1"
              class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
            />
          </label>
        </section>

        <div class="flex items-center gap-2 border-t border-neon-deep/25 pt-3">
          <button
            type="submit"
            class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-4 font-mono text-xs"
            :disabled="!valid"
          >
            <Save class="h-3.5 w-3.5" aria-hidden="true" />
            保存
          </button>
          <span v-if="!valid" class="text-[11px] text-red-400">{{ validationError }}</span>
          <span v-if="savedFlash" class="text-[11px] text-neon">已保存</span>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue"
import { Save } from "lucide-vue-next"
import { RangeSlider } from "@/components/ui/slider"
import {
  type PlatformConfigAssistant,
  type PlatformConfigCheckpointPrune,
  type PlatformConfigContextCompression,
  type PlatformConfigAi,
  getPlatformConfig,
} from "@/config/platform-config"

const emit = defineEmits<{
  (e: "save", input: {
    checkpointPrune: PlatformConfigCheckpointPrune
    contextCompression: PlatformConfigContextCompression
    ai: PlatformConfigAi
    assistant: PlatformConfigAssistant
  }): void
}>()

// 本地表单状态，从平台配置 cache 初始化（不并入 platformConfigDraft，避免 provider
// deep watch 误触发 tunables 自动保存）。tunables 是离散数值，改一半不该落盘，显式保存。
const cfg = getPlatformConfig()
const form = ref({
  checkpointPrune: { ...cfg.checkpointPrune },
  contextCompression: { ...cfg.contextCompression },
  ai: { ...cfg.ai },
  assistant: { ...cfg.assistant },
})
const savedFlash = ref(false)

type ContextCompressionRatioKey = "narrativeTriggerRatio" | "taskTriggerRatio"

function updateContextCompressionRatio(key: ContextCompressionRatioKey, value: number | null): void {
  form.value.contextCompression[key] = value ?? 0.05
}

const validationError = computed(() => {
  const { checkpointPrune, contextCompression, ai, assistant } = form.value
  if (checkpointPrune.keepRecent < 1 || !Number.isInteger(checkpointPrune.keepRecent)) {
    return "保留最近记录数需为 ≥1 的整数。"
  }
  if (checkpointPrune.sparseEvery < 1 || !Number.isInteger(checkpointPrune.sparseEvery)) {
    return "早期记录保留间隔需为 ≥1 的整数。"
  }
  if (contextCompression.narrativeTriggerRatio <= 0 || contextCompression.narrativeTriggerRatio > 1) {
    return "剧情上下文压缩阈值需大于 0 且不超过 1。"
  }
  if (contextCompression.taskTriggerRatio <= 0 || contextCompression.taskTriggerRatio > 1) {
    return "助手上下文压缩阈值需大于 0 且不超过 1。"
  }
  if (contextCompression.keepRecentTurns < 1 || !Number.isInteger(contextCompression.keepRecentTurns)) {
    return "保留最近剧情轮数需为 ≥1 的整数。"
  }
  if (contextCompression.taskKeepRecentRounds < 1 || !Number.isInteger(contextCompression.taskKeepRecentRounds)) {
    return "保留最近助手轮数需为 ≥1 的整数。"
  }
  if (ai.chatTimeoutMs < 1000) {
    return "最长等待时间需至少 1000 毫秒。"
  }
  if (assistant.maxStoredMessages < 1 || !Number.isInteger(assistant.maxStoredMessages)) {
    return "最多保存消息数需为 ≥1 的整数。"
  }
  return ""
})

const valid = computed(() => validationError.value === "")

function handleSave(): void {
  if (!valid.value) {
    return
  }
  emit("save", {
    checkpointPrune: { ...form.value.checkpointPrune },
    contextCompression: { ...form.value.contextCompression },
    ai: { ...form.value.ai },
    assistant: { ...form.value.assistant },
  })
  savedFlash.value = true
  window.setTimeout(() => {
    savedFlash.value = false
  }, 1500)
}
</script>
