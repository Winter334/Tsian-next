<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-5">
    <div
      v-for="(msg, index) in messages"
      :key="index"
      class="group flex gap-3"
      :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'"
    >
      <span
        class="grid h-7 w-7 shrink-0 place-items-center border"
        :class="msg.role === 'user'
          ? 'border-neon-deep/45 bg-elevated text-text-main'
          : 'border-neon/45 bg-neon/10 text-neon'"
      >
        <User v-if="msg.role === 'user'" class="h-3.5 w-3.5" aria-hidden="true" />
        <Bot v-else class="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div class="flex min-w-0 max-w-[calc(100%-2.75rem)] flex-col gap-1.5">
        <!-- 每条助手回复只有一个总过程折叠；内部严格保持 timeline 原始顺序。 -->
        <Collapsible
          v-if="msg.role === 'assistant' && msg.timeline && msg.timeline.length > 0"
          :open="msg.processCollapsed === false"
          class="assistant-process"
          @update:open="(open) => (msg.processCollapsed = !open)"
        >
          <CollapsibleTrigger class="assistant-process__trigger retro-focus">
            <ChevronRight
              class="assistant-process__chevron"
              :class="{ 'assistant-process__chevron--open': msg.processCollapsed === false }"
              aria-hidden="true"
            />
            <Wrench class="h-3 w-3 shrink-0" aria-hidden="true" />
            <span class="assistant-process__label">执行过程</span>
            <span
              v-if="summarizeAssistantProcess(msg.timeline).toolCount > 0"
              class="assistant-process__count"
            >
              {{ summarizeAssistantProcess(msg.timeline).toolCount }} 次工具调用
            </span>
            <span
              v-if="summarizeAssistantProcess(msg.timeline).status !== 'idle'"
              class="assistant-process__state"
              :class="`assistant-process__state--${summarizeAssistantProcess(msg.timeline).status}`"
              aria-live="polite"
            >
              <Loader2
                v-if="summarizeAssistantProcess(msg.timeline).status === 'running'"
                class="assistant-process__state-icon animate-spin"
                aria-hidden="true"
              />
              <Check
                v-else-if="summarizeAssistantProcess(msg.timeline).status === 'success'"
                class="assistant-process__state-icon"
                aria-hidden="true"
              />
              <CircleX v-else class="assistant-process__state-icon" aria-hidden="true" />
              {{ assistantProcessStatusLabel(summarizeAssistantProcess(msg.timeline).status) }}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent class="assistant-process__body">
            <div class="assistant-process__inner">
              <template v-for="node in msg.timeline" :key="node.id">
                <div
                  v-if="node.type === 'interim'"
                  class="assistant-process__interim prose-chat break-words text-sm leading-6"
                  v-html="renderMarkdown(node.text)"
                />

                <Collapsible
                  v-else-if="node.type === 'thought'"
                  :open="!node.collapsed"
                  class="assistant-process__thought"
                  @update:open="(open) => (node.collapsed = !open)"
                >
                  <CollapsibleTrigger class="assistant-process__thought-trigger retro-focus">
                    <ChevronRight
                      class="h-3 w-3 transition-transform"
                      :class="node.collapsed ? 'rotate-0' : 'rotate-90'"
                      aria-hidden="true"
                    />
                    <Brain class="h-3 w-3" aria-hidden="true" />
                    <span>思考</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent class="assistant-process__thought-body">
                    <div class="prose-chat text-xs leading-5 text-text-dim" v-html="renderMarkdown(node.text)" />
                  </CollapsibleContent>
                </Collapsible>

                <div v-else-if="node.type === 'ask'" class="assistant-process__ask">
                  <div class="assistant-process__ask-title">
                    <HelpCircle class="h-3 w-3" aria-hidden="true" />
                    <span>{{ node.cancelled ? "已取消提问" : "已回答" }}</span>
                  </div>
                  <p class="prose-chat text-sm leading-6 text-text-main" v-html="renderMarkdown(node.question)" />
                  <div class="assistant-process__ask-answer">
                    <p v-if="node.cancelled" class="text-xs italic text-text-dim">已取消</p>
                    <template v-else>
                      <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">你的回答</p>
                      <p class="mt-0.5 prose-chat text-sm leading-6 text-text-main">{{ node.answer }}</p>
                    </template>
                  </div>
                </div>

                <div
                  v-else
                  class="assistant-process__tool"
                  :class="`assistant-process__tool--${node.status}`"
                  role="status"
                  :aria-label="`${assistantToolLabel(node)}：${assistantToolStatusLabel(node.status)}`"
                >
                  <div class="assistant-process__tool-row">
                    <span class="assistant-process__tool-name">
                      <Wrench class="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{{ assistantToolLabel(node) }}</span>
                    </span>
                    <span
                      class="assistant-process__tool-state"
                      :class="`assistant-process__tool-state--${node.status}`"
                      aria-live="polite"
                  >
                      <Loader2
                        v-if="node.status === 'loading' || node.status === 'running'"
                        class="assistant-process__state-icon animate-spin"
                        aria-hidden="true"
                      />
                      <Check
                        v-else-if="node.status === 'success'"
                        class="assistant-process__state-icon"
                        aria-hidden="true"
                      />
                      <CircleX v-else class="assistant-process__state-icon" aria-hidden="true" />
                      {{ assistantToolStatusLabel(node.status) }}
                    </span>
                  </div>
                  <div v-if="agentCallDisplay(node.presentation)" class="assistant-process__agent-detail">
                    <strong>{{ agentCallDisplay(node.presentation)?.title }}</strong>
                    <p v-if="agentCallDisplay(node.presentation)?.response">
                      {{ agentCallDisplay(node.presentation)?.response }}
                    </p>
                  </div>
                </div>
            </template>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- 回复正文泡:user 恒渲染;assistant 仅在有正文/流式、等待首 token、或无过程节点时渲染。 -->
        <div
          v-if="msg.role === 'user' || msg.streamingText || msg.content || (sending && index === messages.length - 1 && !activeAsk) || !(msg.timeline && msg.timeline.length > 0)"
          class="break-words text-sm leading-6"
          :class="msg.role === 'user'
            ? 'whitespace-pre-wrap border border-neon-deep/35 bg-panel/55 px-3.5 py-2.5 text-text-main'
            : 'text-text-main'"
        >
          <template v-if="msg.role === 'assistant'">
            <!-- 当前轮流式文本:尚未分类(tool_calls→归入 thought 折叠;stop→写入 content) -->
            <div v-if="msg.streamingText" class="prose-chat" v-html="renderMarkdown(msg.streamingText)" />
            <!-- 最终回复 / 历史 / text 模式:无流式时展示 content -->
            <div v-else-if="msg.content" class="flex flex-col gap-2">
              <template v-for="(part, partIdx) in assistantContentSegments(msg.content)" :key="partIdx">
                <details v-if="part.kind === 'thought'" class="assistant-think rounded-sm border border-neon-deep/30 bg-panel/20 px-2 py-1">
                  <summary class="cursor-pointer select-none font-mono text-[11px] uppercase tracking-wider text-text-dim hover:text-neon">思考</summary>
                  <div class="prose-chat mt-1 text-xs leading-5 text-text-dim" v-html="renderMarkdown(part.text)" />
                </details>
                <div v-else class="prose-chat" v-html="renderMarkdown(part.text)" />
              </template>
            </div>
            <!-- 等待首个 token:过程/流式/回复皆空时显示打字点(替代独立占位框) -->
            <div v-else-if="sending && index === messages.length - 1" class="flex items-center gap-1.5">
              <span class="typing-dot" />
              <span class="typing-dot" />
              <span class="typing-dot" />
            </div>
          </template>
          <template v-else>
            <!-- 用户消息附件:图片缩略图 -->
            <div
              v-if="msg.attachments && msg.attachments.some((a) => a.kind === 'image')"
              class="mb-2 flex flex-wrap gap-2"
            >
              <AttachmentImage
                v-for="att in msg.attachments.filter((a) => a.kind === 'image')"
                :key="att.path"
                :path="att.path"
                :name="att.name"
              />
            </div>
            <!-- 用户消息附件:文本文件标识 -->
            <div
              v-if="msg.attachments && msg.attachments.some((a) => a.kind === 'text')"
              class="mb-2 flex flex-wrap gap-2"
            >
              <div
                v-for="att in msg.attachments.filter((a) => a.kind === 'text')"
                :key="att.path"
                class="flex items-center gap-1.5 border border-neon-deep/40 bg-panel/40 px-2 py-1"
              >
                <FileText class="h-3.5 w-3.5 text-text-dim" aria-hidden="true" />
                <span class="text-xs text-text-main">{{ att.name }}</span>
                <span class="text-[10px] text-text-dim">{{ formatFileSize(att.size) }}</span>
              </div>
            </div>
            <span v-if="msg.content">{{ msg.content }}</span>
          </template>
        </div>

        <!-- 消息工具条:hover 显示,复制(全部)+编辑重发(仅 user,发送中禁用) -->
        <div
          class="flex items-center gap-1 px-1 transition-opacity"
          :class="[
            msg.role === 'user' ? 'justify-end' : 'justify-start',
            copiedIndex === index || editingIndex === index ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100',
          ]"
        >
          <button
            type="button"
            class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/30 bg-panel/40 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
            :title="copiedIndex === index ? '已复制' : '复制消息'"
            @click="$emit('copyMessage', index)"
          >
            <Check v-if="copiedIndex === index" class="h-3 w-3 text-neon" aria-hidden="true" />
            <Copy v-else class="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            v-if="msg.role === 'user'"
            type="button"
            class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/30 bg-panel/40 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
            :disabled="sending"
            :title="sending ? '请等待当前回复完成' : '编辑并重新发送'"
            @click="$emit('editUserMessage', index)"
          >
            <Pencil class="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import "highlight.js/styles/atom-one-dark.min.css"
import { Bot, Brain, Check, ChevronRight, CircleX, Copy, FileText, HelpCircle, Loader2, Pencil, User, Wrench } from "lucide-vue-next"
import type { ChatMessage } from "@/composables/useAssistantTimeline"
import AttachmentImage from "@/components/assistant/AttachmentImage.vue"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { renderMarkdown } from "@/lib/markdown"
import { agentCallDisplay } from "../assistant-message-mappers"
import { formatFileSize } from "./format"
import {
  assistantContentSegments,
  assistantProcessStatusLabel,
  assistantToolLabel,
  assistantToolStatusLabel,
  summarizeAssistantProcess,
} from "./process-presentation"
import type { ActiveAskState } from "./types"

defineProps<{
  messages: ChatMessage[]
  sending: boolean
  activeAsk: ActiveAskState | null
  copiedIndex: number | null
  editingIndex: number | null
}>()

defineEmits<{
  copyMessage: [index: number]
  editUserMessage: [index: number]
}>()

</script>

<style scoped>
.assistant-process {
  overflow: hidden;
  border-left: 1px solid color-mix(in srgb, var(--color-neon) 30%, transparent);
  background: color-mix(in srgb, var(--color-panel) 18%, transparent);
}

.assistant-process__trigger {
  display: flex;
  width: 100%;
  min-height: 32px;
  padding: 5px 8px;
  align-items: center;
  gap: 7px;
  border: 0;
  color: var(--color-text-dim);
  background: transparent;
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  text-align: left;
  transition: color 160ms ease, background-color 160ms ease;
}

.assistant-process__trigger:hover {
  color: var(--color-neon);
  background: color-mix(in srgb, var(--color-neon) 4%, transparent);
}

.assistant-process__chevron,
.assistant-process__state-icon {
  width: 12px;
  height: 12px;
  flex: 0 0 12px;
}

.assistant-process__chevron {
  transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.assistant-process__chevron--open {
  transform: rotate(90deg);
}

.assistant-process__label {
  color: var(--color-neon);
  text-transform: uppercase;
}

.assistant-process__count {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-dim);
  font-family: var(--font-sans);
  font-size: 11px;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-process__state,
.assistant-process__tool-state {
  display: inline-flex;
  width: 4.8rem;
  margin-left: auto;
  align-items: center;
  justify-content: flex-end;
  gap: 5px;
  flex-shrink: 0;
  color: var(--color-text-dim);
  font-size: 10px;
  letter-spacing: 0;
  white-space: nowrap;
}

.assistant-process__state--running,
.assistant-process__tool-state--loading,
.assistant-process__tool-state--running {
  color: color-mix(in srgb, var(--color-neon) 68%, transparent);
}

.assistant-process__state--success,
.assistant-process__tool-state--success {
  color: var(--color-neon);
  animation: assistant-process-success 300ms ease-out both;
}

.assistant-process__state--failed,
.assistant-process__tool-state--failed {
  color: var(--color-danger);
  animation: assistant-process-failed 260ms ease-out both;
}

.assistant-process__body {
  overflow: hidden;
}

.assistant-process__body[data-state="open"] {
  animation: assistant-process-open 280ms cubic-bezier(0.22, 1, 0.36, 1);
}

.assistant-process__body[data-state="closed"] {
  animation: assistant-process-close 210ms cubic-bezier(0.4, 0, 1, 1);
}

.assistant-process__inner {
  display: grid;
  margin-left: 6px;
  padding: 5px 8px 9px 12px;
  gap: 5px;
  border-left: 1px solid color-mix(in srgb, var(--color-neon) 14%, transparent);
}

.assistant-process__interim {
  padding: 3px 1px 6px;
  color: var(--color-text-dim);
}

.assistant-process__thought {
  border-left: 1px solid color-mix(in srgb, var(--color-neon) 20%, transparent);
  background: color-mix(in srgb, var(--color-panel) 14%, transparent);
}

.assistant-process__thought-trigger,
.assistant-process__ask-title {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-dim);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.assistant-process__thought-trigger {
  width: 100%;
  padding: 5px 7px;
  border: 0;
  background: transparent;
  text-align: left;
}

.assistant-process__thought-trigger:hover {
  color: var(--color-neon);
}

.assistant-process__thought-body {
  overflow: hidden;
  padding: 5px 9px 8px;
  border-top: 1px solid color-mix(in srgb, var(--color-neon) 10%, transparent);
}

.assistant-process__ask {
  display: grid;
  padding: 8px 9px;
  gap: 7px;
  border: 1px solid color-mix(in srgb, var(--color-neon) 24%, transparent);
  background: color-mix(in srgb, var(--color-neon) 3.5%, transparent);
}

.assistant-process__ask-answer {
  padding: 6px 8px;
  border-left: 1px solid color-mix(in srgb, var(--color-neon) 24%, transparent);
  background: color-mix(in srgb, var(--color-panel) 20%, transparent);
}

.assistant-process__tool {
  min-width: 0;
  padding: 5px 1px 5px 9px;
  border-left: 1px solid color-mix(in srgb, var(--color-neon) 22%, transparent);
  animation: assistant-process-row-enter 190ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

.assistant-process__tool-row {
  display: flex;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-family: var(--font-mono);
  font-size: 10px;
}

.assistant-process__tool-name {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: var(--color-text-dim);
}

.assistant-process__tool-name > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.assistant-process__agent-detail {
  display: grid;
  margin: 4px 0 2px 18px;
  padding: 7px 9px;
  gap: 4px;
  border-left: 1px solid color-mix(in srgb, var(--color-neon) 20%, transparent);
  color: color-mix(in srgb, var(--color-text-main) 82%, transparent);
  background: color-mix(in srgb, var(--color-panel) 20%, transparent);
  font-size: 11px;
}

.assistant-process__agent-detail strong {
  color: var(--color-neon);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
}

.assistant-process__agent-detail p {
  margin: 0;
  white-space: pre-wrap;
}

@keyframes assistant-process-open {
  from { height: 0; opacity: 0; }
  to { height: var(--reka-collapsible-content-height); opacity: 1; }
}

@keyframes assistant-process-close {
  from { height: var(--reka-collapsible-content-height); opacity: 1; }
  to { height: 0; opacity: 0; }
}

@keyframes assistant-process-row-enter {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes assistant-process-success {
  0% { filter: drop-shadow(0 0 0 transparent); }
  45% { filter: drop-shadow(0 0 5px color-mix(in srgb, var(--color-neon) 50%, transparent)); }
  100% { filter: drop-shadow(0 0 0 transparent); }
}

@keyframes assistant-process-failed {
  0%, 100% { transform: translateX(0); }
  35% { transform: translateX(-2px); }
  65% { transform: translateX(2px); }
}

.typing-dot {
  width: 6px;
  height: 6px;
  background: var(--color-neon);
  opacity: 0.5;
  animation: typing-blink 1.2s infinite ease-in-out;
}
.typing-dot:nth-child(2) {
  animation-delay: 0.2s;
}
.typing-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing-blink {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .assistant-process__body[data-state="open"],
  .assistant-process__body[data-state="closed"],
  .assistant-process__tool,
  .assistant-process__state--success,
  .assistant-process__state--failed,
  .assistant-process__tool-state--success,
  .assistant-process__tool-state--failed,
  .assistant-process .animate-spin,
  .typing-dot {
    animation: none !important;
  }

  .assistant-process__trigger,
  .assistant-process__chevron,
  .assistant-process__thought-trigger svg {
    transition-duration: 0.01ms !important;
  }
}
</style>
