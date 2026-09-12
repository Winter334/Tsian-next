<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import NarrativeMessage from "../../story/NarrativeMessage.vue"
import UserMessage from "../../story/UserMessage.vue"
import StoryOptions from "../../story/StoryOptions.vue"
import SetupComposer from "./SetupComposer.vue"

/**
 * PlaySetupDialog — 单一开局访谈。
 *
 * 向导内的轻量 Agent 对话界面。多轮 invokeAgent 驱动，
 * 助手回复通过开局协议提取问题与选项，复用 StoryView 的消息组件语言。
 * 布局适配向导 720px 框架。
 */
const {
  playSetupStatus: status,
  playSetupMessages: messages,
  playSetupError: error,
  playSetupStreamingText: streamingText,
  sendPlaySetupMessage,
  retryPlaySetupDialog,
  playSetupProposal: proposal,
  confirmOpeningPlan,
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
            :disabled="status !== 'ready'"
            @select="onSelectOption"
          />
        </template>

        <NarrativeMessage
          v-if="status === 'running'"
          :content="streamingText || '正在整理…'"
          streaming
          streaming-variant="quiet"
        />

        <section v-if="proposal && status === 'ready'" class="proposal-card">
          <h3>确认开局方案</h3>
          <p><strong>玩家角色：</strong>{{ proposal.protagonist }}</p>
          <p><strong>切入点：</strong>{{ proposal.startingPoint }}</p>
          <p><strong>开局情境：</strong>{{ proposal.openingFocus }}</p>
          <ul v-if="proposal.constraints.length"><li v-for="item in proposal.constraints" :key="item">{{ item }}</li></ul>
          <button class="retry-btn" @click="confirmOpeningPlan">确认方案并生成开局</button>
          <p class="proposal-hint">仍想调整？可以继续在下方说明。</p>
        </section>

        <!-- 错误态 -->
        <div v-if="status === 'failed' || status === 'recovering'" class="error-card">
          <div class="failed-mark">✕</div>
          <div class="failed-detail-scroll">{{ error }}</div>
          <button class="retry-btn" @click="retryPlaySetupDialog">
            {{ status === "recovering" ? "重新检查" : "重试" }}
          </button>
        </div>
      </div>
    </div>

    <!-- Composer -->
    <SetupComposer
      :disabled="status !== 'ready'"
      placeholder="说出你的想法…"
      @send="onSend"
    />
  </div>
</template>

<style scoped>
.proposal-card { padding: 20px; margin: 20px 0; border: 1px solid var(--gold-dim); border-radius: 6px; }
.proposal-card p { margin: 10px 0; line-height: 1.7; }
.proposal-hint { opacity: .65; font-size: .85em; }
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
  color: var(--prose-muted);
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
