<template>
  <div class="grid h-full min-h-0 place-items-start overflow-auto p-5">
    <div class="grid w-full max-w-2xl gap-4">
      <div class="border-b border-neon-deep/25 pb-3">
        <p class="font-mono text-[10px] uppercase tracking-wider text-neon">平台</p>
        <h2 class="mt-1 text-sm font-bold text-text-main">运行参数</h2>
        <p class="mt-1.5 text-xs leading-5 text-text-dim">
          平台级运行行为参数。改后保存即生效（读内存 cache），重启后从
          <code class="font-mono text-neon/80">.tsian/local/platform-config.json</code>
          恢复。配置随本地 workspace 走，不进存档回滚、不进游戏卡导出包。
        </p>
      </div>

      <form class="grid gap-3" @submit.prevent="handleSave">
        <!-- 检查点裁剪 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">检查点裁剪</p>
          <p class="text-[11px] leading-4 text-text-dim">
            每回合末裁剪存档检查点：保留最近 N 个 + 每 M 回一个稀疏点 + 所有初始/手动点。
          </p>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="grid gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                keepRecent <span class="text-neon/60">（默认 50）</span>
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
                sparseEvery <span class="text-neon/60">（默认 20）</span>
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

        <!-- 上下文压缩 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">上下文压缩</p>
          <p class="text-[11px] leading-4 text-text-dim">
            上下文 token 达预算的触发比例时压缩。narrative 模式（master/剧情 agent）保留最近 N 轮正文不压缩；task 模式（助手/子代理）保留最近 N 轮工具交互不压缩。
          </p>
          <div class="grid gap-2 sm:grid-cols-3">
            <label class="grid gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                triggerRatio <span class="text-neon/60">（默认 0.85）</span>
              </span>
              <input
                v-model.number="form.contextCompression.triggerRatio"
                type="number"
                min="0"
                max="1"
                step="0.05"
                class="retro-focus retro-select-surface w-full border border-neon-deep/55 bg-elevated px-3 py-2 font-mono text-xs text-text-main placeholder:text-text-dim/60"
              />
            </label>
            <label class="grid gap-1">
              <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
                keepRecentTurns <span class="text-neon/60">（默认 5）</span>
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
                taskKeepRecentRounds <span class="text-neon/60">（默认 5）</span>
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

        <!-- AI 超时 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">AI 超时</p>
          <p class="text-[11px] leading-4 text-text-dim">
            单次 AI 请求超时毫秒数。全局参数（非 per-preset），所有 provider 共用。
          </p>
          <label class="grid gap-1">
            <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
              chatTimeoutMs <span class="text-neon/60">（默认 600000 = 10 分钟）</span>
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

        <!-- 助手历史 -->
        <section class="retro-inset grid gap-2 p-3">
          <p class="text-xs font-bold text-text-main">助手历史</p>
          <p class="text-[11px] leading-4 text-text-dim">
            每个助手会话最多保留的消息条数，超出从最早截断。
          </p>
          <label class="grid gap-1">
            <span class="font-mono text-[10px] uppercase tracking-wider text-text-dim">
              maxStoredMessages <span class="text-neon/60">（默认 200）</span>
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

const validationError = computed(() => {
  const { checkpointPrune, contextCompression, ai, assistant } = form.value
  if (checkpointPrune.keepRecent < 1 || !Number.isInteger(checkpointPrune.keepRecent)) {
    return "keepRecent 需为 ≥1 的整数。"
  }
  if (checkpointPrune.sparseEvery < 1 || !Number.isInteger(checkpointPrune.sparseEvery)) {
    return "sparseEvery 需为 ≥1 的整数。"
  }
  if (contextCompression.triggerRatio <= 0 || contextCompression.triggerRatio > 1) {
    return "triggerRatio 需在 (0, 1] 范围。"
  }
  if (contextCompression.keepRecentTurns < 1 || !Number.isInteger(contextCompression.keepRecentTurns)) {
    return "keepRecentTurns 需为 ≥1 的整数。"
  }
  if (contextCompression.taskKeepRecentRounds < 1 || !Number.isInteger(contextCompression.taskKeepRecentRounds)) {
    return "taskKeepRecentRounds 需为 ≥1 的整数。"
  }
  if (ai.chatTimeoutMs < 1000) {
    return "chatTimeoutMs 需 ≥1000。"
  }
  if (assistant.maxStoredMessages < 1 || !Number.isInteger(assistant.maxStoredMessages)) {
    return "maxStoredMessages 需为 ≥1 的整数。"
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
