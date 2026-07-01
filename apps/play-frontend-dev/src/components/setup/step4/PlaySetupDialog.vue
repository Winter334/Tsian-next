<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import NarrativeMessage from "../../story/NarrativeMessage.vue"
import UserMessage from "../../story/UserMessage.vue"
import StoryOptions from "../../story/StoryOptions.vue"
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
  playSetupHeartbeat: heartbeat,
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
            v-if="msg.options && msg.options.length > 0"
            :options="[...msg.options]"
            :disabled="status === 'running' || status === 'complete'"
            @select="onSelectOption"
          />
        </template>

        <!-- 等待态：invokeAgent await 期间 -->
        <div v-if="status === 'running'" class="thinking-indicator">
          <div class="heartbeat-orb">
            <div class="orb-center" />
            <div :key="heartbeat" class="orb-ring" />
          </div>
          <div class="loading-bar">
            <div class="bar-track" />
            <div class="bar-sweep" />
          </div>
        </div>

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

/* ── 等待态：心跳 orb + sweep bar ── */
.thinking-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 32px 20px;
  margin: 16px 0;
}

.heartbeat-orb {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.orb-center {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(circle, var(--ember-bright) 0%, var(--ember) 60%, transparent 100%);
  box-shadow: 0 0 16px rgba(232, 169, 72, 0.4);
  animation: orb-idle 3s ease-in-out infinite;
}
@keyframes orb-idle {
  0%, 100% { box-shadow: 0 0 10px rgba(232, 169, 72, 0.3); transform: scale(1); }
  50% { box-shadow: 0 0 20px rgba(232, 169, 72, 0.5); transform: scale(1.1); }
}

.orb-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--ember-bright);
  transform: translate(-50%, -50%);
  animation: ring-pulse 1.2s ease-out;
}
@keyframes ring-pulse {
  0% { width: 14px; height: 14px; opacity: 0.7; }
  100% { width: 56px; height: 56px; opacity: 0; }
}

.loading-bar {
  position: relative;
  width: 200px;
  height: 2px;
  overflow: hidden;
  border-radius: 1px;
}
.bar-track {
  position: absolute;
  inset: 0;
  background: rgba(181, 137, 61, 0.12);
  border-radius: 1px;
}
.bar-sweep {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(90deg, transparent 0%, var(--ember) 30%, var(--ember-bright) 50%, var(--ember) 70%, transparent 100%);
  border-radius: 1px;
  animation: bar-sweep 1.8s ease-in-out infinite;
}
@keyframes bar-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
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
</style>
