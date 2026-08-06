<template>
  <div class="spatial-assistant-messages">
    <article
      v-for="(message, index) in messages"
      :key="index"
      class="spatial-assistant-message"
      :class="`spatial-assistant-message--${message.role}`"
    >
      <div class="spatial-assistant-message__identity" aria-hidden="true">
        <User v-if="message.role === 'user'" />
        <Bot v-else />
      </div>
      <div class="spatial-assistant-message__body">
        <details
          v-if="message.role === 'assistant' && message.timeline?.length"
          class="spatial-assistant-process"
          :open="message.processCollapsed === false"
          @toggle="message.processCollapsed = !($event.target as HTMLDetailsElement).open"
        >
          <summary>
            <Wrench aria-hidden="true" />
            <span>执行过程</span>
            <small v-if="summary(message).toolCount">{{ summary(message).toolCount }} 次工具调用</small>
            <b v-if="summary(message).status !== 'idle'" :class="`is-${summary(message).status}`" aria-live="polite">
              <LoaderCircle v-if="summary(message).status === 'running'" class="spatial-assistant-spin" aria-hidden="true" />
              <Check v-else-if="summary(message).status === 'success'" aria-hidden="true" />
              <CircleX v-else aria-hidden="true" />
              {{ assistantProcessStatusLabel(summary(message).status) }}
            </b>
          </summary>
          <div class="spatial-assistant-process__body">
            <template v-for="node in message.timeline" :key="node.id">
              <div v-if="node.type === 'interim'" class="spatial-assistant-process__interim spatial-assistant-prose" v-html="renderMarkdown(node.text)" />
              <details v-else-if="node.type === 'thought'" class="spatial-assistant-process__thought" :open="!node.collapsed" @toggle="node.collapsed = !($event.target as HTMLDetailsElement).open">
                <summary><Brain aria-hidden="true" />思考</summary>
                <div class="spatial-assistant-prose" v-html="renderMarkdown(node.text)" />
              </details>
              <div v-else-if="node.type === 'ask'" class="spatial-assistant-process__ask">
                <strong><CircleHelp aria-hidden="true" />{{ node.cancelled ? "已取消提问" : "已回答" }}</strong>
                <div class="spatial-assistant-prose" v-html="renderMarkdown(node.question)" />
                <p>{{ node.cancelled ? "已取消" : node.answer }}</p>
              </div>
              <div v-else class="spatial-assistant-process__tool" role="status" :aria-label="`${assistantToolLabel(node)}：${assistantToolStatusLabel(node.status)}`">
                <div>
                  <span><Wrench aria-hidden="true" />{{ assistantToolLabel(node) }}</span>
                  <b :class="`is-${node.status}`" aria-live="polite">
                    <LoaderCircle v-if="node.status === 'loading' || node.status === 'running'" class="spatial-assistant-spin" aria-hidden="true" />
                    <Check v-else-if="node.status === 'success'" aria-hidden="true" />
                    <CircleX v-else aria-hidden="true" />
                    {{ assistantToolStatusLabel(node.status) }}
                  </b>
                </div>
                <section v-if="agentCallDisplay(node.presentation)" class="spatial-assistant-process__agent">
                  <strong>{{ agentCallDisplay(node.presentation)?.title }}</strong>
                  <p v-if="agentCallDisplay(node.presentation)?.response">{{ agentCallDisplay(node.presentation)?.response }}</p>
                </section>
              </div>
            </template>
          </div>
        </details>

        <div
          v-if="message.role === 'user' || message.streamingText || message.content || (sending && index === messages.length - 1 && !activeAsk) || !message.timeline?.length"
          class="spatial-assistant-message__content"
        >
          <template v-if="message.role === 'assistant'">
            <div v-if="message.streamingText" class="spatial-assistant-prose" v-html="renderMarkdown(message.streamingText)" />
            <template v-else-if="message.content">
              <template v-for="(part, partIndex) in assistantContentSegments(message.content)" :key="partIndex">
                <details v-if="part.kind === 'thought'" class="spatial-assistant-inline-thought">
                  <summary>思考</summary>
                  <div class="spatial-assistant-prose" v-html="renderMarkdown(part.text)" />
                </details>
                <div v-else class="spatial-assistant-prose" v-html="renderMarkdown(part.text)" />
              </template>
            </template>
            <div v-else-if="sending && index === messages.length - 1" class="spatial-assistant-typing" role="status" aria-label="助手正在回复">
              <i /><i /><i />
            </div>
          </template>
          <template v-else>
            <div v-if="message.attachments?.some((attachment) => attachment.kind === 'image')" class="spatial-assistant-message__attachments">
              <SpatialAssistantAttachmentImage
                v-for="attachment in message.attachments.filter((item) => item.kind === 'image')"
                :key="attachment.path"
                :path="attachment.path"
                :name="attachment.name"
              />
            </div>
            <div v-if="message.attachments?.some((attachment) => attachment.kind === 'text')" class="spatial-assistant-message__files">
              <span v-for="attachment in message.attachments.filter((item) => item.kind === 'text')" :key="attachment.path">
                <FileText aria-hidden="true" />{{ attachment.name }} · {{ formatFileSize(attachment.size) }}
              </span>
            </div>
            <p v-if="message.content">{{ message.content }}</p>
          </template>
        </div>

        <div class="spatial-assistant-message__actions">
          <SpatialActionButton icon-only :aria-label="copiedIndex === index ? '已复制' : '复制消息'" @click="$emit('copyMessage', index)">
            <template #icon><Check v-if="copiedIndex === index" /><Copy v-else /></template>
          </SpatialActionButton>
          <SpatialActionButton v-if="message.role === 'user'" icon-only aria-label="编辑并重新发送" :disabled="sending" @click="$emit('editUserMessage', index)">
            <template #icon><Pencil /></template>
          </SpatialActionButton>
        </div>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { Bot, Brain, Check, CircleHelp, CircleX, Copy, FileText, LoaderCircle, Pencil, User, Wrench } from "lucide-vue-next"
import type { ChatMessage } from "@/composables/useAssistantTimeline"
import { renderMarkdown } from "@/lib/markdown"
import { agentCallDisplay } from "@/views/assistant-message-mappers"
import { formatFileSize } from "@/views/assistant/format"
import {
  assistantContentSegments,
  assistantProcessStatusLabel,
  assistantToolLabel,
  assistantToolStatusLabel,
  summarizeAssistantProcess,
} from "@/views/assistant/process-presentation"
import type { ActiveAskState } from "@/views/assistant/types"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialAssistantAttachmentImage from "./SpatialAssistantAttachmentImage.vue"

const props = defineProps<{
  messages: ChatMessage[]
  sending: boolean
  activeAsk: ActiveAskState | null
  copiedIndex: number | null
}>()
defineEmits<{ copyMessage: [index: number]; editUserMessage: [index: number] }>()

function summary(message: ChatMessage) {
  return summarizeAssistantProcess(message.timeline ?? [])
}
</script>

<style scoped>
.spatial-assistant-messages { display: flex; width: min(760px, 100%); margin: 0 auto; padding: 14px; flex-direction: column; gap: 14px; }
.spatial-assistant-message { display: flex; min-width: 0; align-items: flex-start; gap: 8px; }
.spatial-assistant-message--user { flex-direction: row-reverse; }
.spatial-assistant-message__identity { display: grid; width: 27px; height: 27px; flex: 0 0 27px; place-items: center; border: 1px solid var(--spatial-app-border-strong); background: var(--spatial-app-surface-muted); }
.spatial-assistant-message__identity svg { width: 13px; height: 13px; }
.spatial-assistant-message--assistant .spatial-assistant-message__identity { color: var(--spatial-window-accent); }
.spatial-assistant-message__body { display: grid; min-width: 0; max-width: calc(100% - 36px); gap: 6px; }
.spatial-assistant-message--user .spatial-assistant-message__body { justify-items: end; }
.spatial-assistant-message__content { min-width: 0; color: var(--spatial-window-ink); font-size: 11px; line-height: 1.65; }
.spatial-assistant-message--user .spatial-assistant-message__content { max-width: 620px; padding: 9px 11px; border: 1px solid var(--spatial-app-border-strong); background: var(--spatial-app-surface-muted); white-space: pre-wrap; }
.spatial-assistant-message__content p { margin: 0; }
.spatial-assistant-message__actions { display: flex; gap: 4px; opacity: 0; }
.spatial-assistant-message:hover .spatial-assistant-message__actions, .spatial-assistant-message__actions:focus-within { opacity: 1; }
.spatial-assistant-message--user .spatial-assistant-message__actions { justify-content: flex-end; }
.spatial-assistant-message__attachments, .spatial-assistant-message__files { display: flex; margin-bottom: 7px; flex-wrap: wrap; gap: 6px; }
.spatial-assistant-message__files span { display: inline-flex; padding: 4px 7px; align-items: center; gap: 5px; border: 1px solid var(--spatial-app-border); color: var(--spatial-app-muted); font-size: 9px; }
.spatial-assistant-message__files svg { width: 12px; height: 12px; }
.spatial-assistant-process { min-width: min(540px, 100%); border-left: 2px solid var(--spatial-app-border-strong); background: var(--spatial-app-surface-muted); }
.spatial-assistant-process > summary { display: grid; min-height: 32px; padding: 5px 8px; align-items: center; grid-template-columns: 13px max-content minmax(0, 1fr) 72px; gap: 7px; cursor: pointer; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; list-style: none; }
.spatial-assistant-process > summary::-webkit-details-marker { display: none; }
.spatial-assistant-process summary svg { width: 12px; height: 12px; }
.spatial-assistant-process summary small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spatial-assistant-process summary b, .spatial-assistant-process__tool b { display: inline-flex; min-width: 68px; margin-left: auto; justify-content: flex-end; align-items: center; gap: 4px; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-assistant-process .is-running, .spatial-assistant-process .is-loading { color: var(--spatial-window-tab); }
.spatial-assistant-process .is-success { color: var(--spatial-window-accent); }
.spatial-assistant-process .is-failed { color: var(--spatial-window-accent); }
.spatial-assistant-process__body { display: grid; margin-left: 7px; padding: 5px 8px 9px 11px; gap: 6px; border-left: 1px solid var(--spatial-app-border); }
.spatial-assistant-process__interim { padding: 3px 0 6px; color: var(--spatial-app-muted); }
.spatial-assistant-process__thought, .spatial-assistant-inline-thought { border-left: 1px solid var(--spatial-app-border-strong); background: var(--spatial-app-surface); }
.spatial-assistant-process__thought summary, .spatial-assistant-inline-thought summary { display: flex; padding: 6px 8px; align-items: center; gap: 5px; cursor: pointer; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-assistant-process__thought > div, .spatial-assistant-inline-thought > div { padding: 6px 9px 9px; color: var(--spatial-app-muted); }
.spatial-assistant-process__ask { display: grid; padding: 8px; gap: 6px; border: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface); }
.spatial-assistant-process__ask strong { display: flex; align-items: center; gap: 5px; color: var(--spatial-window-accent); font: 9px "JetBrains Mono", monospace; }
.spatial-assistant-process__ask svg { width: 12px; height: 12px; }
.spatial-assistant-process__ask p { margin: 0; padding: 5px 7px; border-left: 1px solid var(--spatial-app-border-strong); color: var(--spatial-app-muted); font-size: 10px; }
.spatial-assistant-process__tool { padding: 5px 1px 5px 8px; border-left: 1px solid var(--spatial-app-border-strong); }
.spatial-assistant-process__tool > div { display: flex; min-height: 24px; align-items: center; justify-content: space-between; gap: 10px; }
.spatial-assistant-process__tool span { display: inline-flex; min-width: 0; align-items: center; gap: 5px; color: var(--spatial-app-muted); font: 9px "JetBrains Mono", monospace; }
.spatial-assistant-process__tool span svg, .spatial-assistant-process__tool b svg { width: 11px; height: 11px; flex: 0 0 11px; }
.spatial-assistant-process__agent { display: grid; margin: 3px 0 1px 16px; padding: 6px 8px; gap: 3px; border-left: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface); font-size: 9px; }
.spatial-assistant-process__agent p { margin: 0; white-space: pre-wrap; }
.spatial-assistant-prose :deep(p) { margin: 0 0 6px; }
.spatial-assistant-prose :deep(p:last-child) { margin-bottom: 0; }
.spatial-assistant-prose :deep(pre) { max-width: 100%; overflow: auto; }
.spatial-assistant-typing { display: flex; padding: 8px 0; gap: 5px; }
.spatial-assistant-typing i { width: 5px; height: 5px; background: var(--spatial-window-accent); animation: spatial-assistant-blink 1.1s infinite ease-in-out; }
.spatial-assistant-typing i:nth-child(2) { animation-delay: 160ms; }
.spatial-assistant-typing i:nth-child(3) { animation-delay: 320ms; }
.spatial-assistant-spin { animation: spatial-assistant-spin 900ms linear infinite; }
@keyframes spatial-assistant-spin { to { rotate: 360deg; } }
@keyframes spatial-assistant-blink { 0%, 80%, 100% { opacity: .3; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .spatial-assistant-spin, .spatial-assistant-typing i { animation: none; } }
</style>
