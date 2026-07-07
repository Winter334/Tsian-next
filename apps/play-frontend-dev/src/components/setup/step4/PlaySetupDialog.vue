<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import NarrativeMessage from "../../story/NarrativeMessage.vue"
import UserMessage from "../../story/UserMessage.vue"
import StoryOptions from "../../story/StoryOptions.vue"
import EmberForge from "../../EmberForge.vue"
import SetupComposer from "./SetupComposer.vue"

/**
 * PlaySetupDialog — 游玩设定对话（Step 4）。
 *
 * 向导内的轻量 Agent 对话界面。多轮 invokeAgent 驱动，
 * parseStoryOptions 解析 [[选项]] 块，复用 StoryView 的消息组件语言。
 * 布局适配向导 720px 框架。
 */
const {
  playSetupStatus: status,
  playSetupMessages: messages,
  playSetupError: error,
  playSetupStreamingText: streamingText,
  sendPlaySetupMessage,
  retryPlaySetupDialog,
} = useSetupState()

const scrollRef = ref<HTMLDivElement | null>(null)

// 消息列表变化时自动滚动到底部
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
  { flush: "post" },
)

// 等待态出现时也滚动
watch(
  () => status.value,
  async () => {
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
  { flush: "post" },
)

// 流式文本增长时滚动到底部（逐字追加期间保持贴底）
watch(
  () => streamingText.value.length,
  async () => {
    await nextTick()
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  },
  { flush: "post" },
)

function onSelectOption(option: string) {
  void sendPlaySetupMessage(option)
}

function onSend(text: string) {
  void sendPlaySetupMessage(text)
}

onUnmounted(() => {
  // 组件卸载时不重置对话状态——goToStep 可能只是切走查看，回来时恢复
})
</script>

<template>
  <div class="play-setup-dialog">
    <!-- 消息列表滚动区 -->
    <div ref="scrollRef" class="dialog-scroll">
      <div class="dialog-inner">
        <template v-for="msg in messages" :key="msg.id">
          <NarrativeMessage v-if="msg.role === 'agent'" :content="msg.content" />
          <UserMessage v-else :content="msg.content" />
          <StoryOptions
            v-if="msg.options && msg.options.length > 0 && status !== 'complete'"
            :options="[...msg.options]"
            :disabled="status === 'running'"
            @select="onSelectOption"
          />
        </template>

        <!-- 等待态：流式文本未到达时用余烬凝笔做过渡；文本到达后展示轻量流式块 -->
        <template v-if="status === 'running'">
          <div v-if="streamingText" class="streaming-block">
            <p class="streaming-text">{{ streamingText }}</p>
            <span class="streaming-caret" aria-hidden="true" />
          </div>
          <EmberForge v-else variant="standalone" />
        </template>

        <!-- 错误态 -->
        <div v-if="status === 'failed'" class="error-card">
          <div class="failed-mark">✕</div>
          <div class="failed-detail-scroll">{{ error }}</div>
          <button class="retry-btn" @click="retryPlaySetupDialog">重试</button>
        </div>
      </div>
    </div>

    <!-- Composer -->
    <SetupComposer
      :disabled="status === 'running' || status === 'complete'"
      placeholder="说出你的想法…"
      @send="onSend"
    />
  </div>
</template>

<style scoped>
.play-setup-dialog {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.dialog-scroll {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--whisper) transparent;
}
.dialog-scroll::-webkit-scrollbar {
  width: 8px;
}
.dialog-scroll::-webkit-scrollbar-thumb {
  background: var(--whisper);
  border-radius: 4px;
}

.dialog-inner {
  max-width: 720px;
  margin: 0 auto;
  padding: 20px 24px 24px;
}

/* ── 错误态：blood-bordered 卡片 ── */
.error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 28px 24px;
  margin: 16px auto;
  max-width: 480px;
  background: var(--void-deep);
  border: 1px solid var(--blood);
  border-radius: 6px;
  box-shadow: inset 0 0 16px rgba(155, 58, 46, 0.1);
}

.failed-mark {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--blood);
  border-radius: 50%;
  color: var(--blood);
  font-size: 1rem;
}

.failed-detail-scroll {
  max-height: 200px;
  overflow-y: auto;
  font-family: var(--font-serif);
  font-size: 0.9rem;
  color: var(--prose-dim);
  line-height: 1.6;
  text-align: center;
  scrollbar-width: thin;
  scrollbar-color: var(--whisper) transparent;
}
.failed-detail-scroll::-webkit-scrollbar {
  width: 3px;
}
.failed-detail-scroll::-webkit-scrollbar-thumb {
  background: var(--whisper);
  border-radius: 2px;
}

.retry-btn {
  background: transparent;
  border: 1px solid var(--blood);
  border-radius: 4px;
  padding: 8px 20px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  color: var(--blood);
  cursor: pointer;
  transition: background 0.25s, box-shadow 0.3s;
}
.retry-btn:hover {
  background: rgba(155, 58, 46, 0.15);
  box-shadow: 0 0 14px rgba(155, 58, 46, 0.3);
}

/* ── 流式文本块：轻量渲染，不复用 NarrativeMessage ──
   NarrativeMessage 为落定消息设计（含选项块清洗、完整排版），
   半截 [[选项]] 未闭合时排版会异常；流式用独立的轻量块。 */
.streaming-block {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  padding: 14px 18px;
  margin: 10px 0;
  background: rgba(20, 12, 8, 0.4);
  border-left: 2px solid var(--ember);
  border-radius: 0 6px 6px 0;
  animation: streaming-fade-in 0.3s ease both;
}

.streaming-text {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.95rem;
  line-height: 1.75;
  color: var(--prose-dim);
  white-space: pre-wrap;
  word-break: break-word;
}

.streaming-caret {
  flex-shrink: 0;
  width: 7px;
  height: 1.1em;
  margin-top: 0.4em;
  background: var(--ember);
  animation: streaming-caret-blink 1s steps(2) infinite;
}

@keyframes streaming-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes streaming-caret-blink {
  0%, 50% { opacity: 1; }
  50.01%, 100% { opacity: 0; }
}
</style>
