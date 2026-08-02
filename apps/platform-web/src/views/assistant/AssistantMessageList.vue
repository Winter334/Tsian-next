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
        <!-- 过程节点(assistant):思考/工具按发生顺序纵向平铺,各独立折叠. -->
        <template v-if="msg.role === 'assistant' && msg.timeline && msg.timeline.length > 0">
          <div class="flex flex-col gap-1">
            <template v-for="(seg, segIdx) in groupTimelineForRender(msg.timeline)" :key="segIdx">
              <!-- 单个节点:interim / thought / ask -->
              <template v-if="seg.kind === 'node'">
                <!-- 过渡文本节点(tool_calls 轮模型在调用工具前输出的可见文本). -->
                <div
                  v-if="seg.node.type === 'interim'"
                  class="prose-chat break-words text-sm leading-6"
                  v-html="renderMarkdown(seg.node.text)"
                />
                <!-- 思考节点(tool_calls 轮的推理文本,默认折叠,可展开回看) -->
                <Collapsible
                  v-else-if="seg.node.type === 'thought'"
                  :open="!seg.node.collapsed"
                  @update:open="(v) => (seg.node.collapsed = !v)"
                  class="border-l border-neon-deep/30 bg-panel/15"
                >
                  <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                    <ChevronRight
                      class="h-3 w-3 transition-transform"
                      :class="seg.node.collapsed ? 'rotate-0' : 'rotate-90'"
                      aria-hidden="true"
                    />
                    <Brain class="h-3 w-3" aria-hidden="true" />
                    <span>思考</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent class="ml-0.5 border-l border-neon-deep/15 pl-2.5 py-1.5">
                    <div class="prose-chat text-xs leading-5 text-text-dim" v-html="renderMarkdown(seg.node.text)" />
                  </CollapsibleContent>
                </Collapsible>

                <!-- ask_user 节点：只读 Q&A 记录。 -->
                <Collapsible
                  v-else-if="seg.node.type === 'ask'"
                  :open="!seg.node.collapsed"
                  @update:open="(v) => (seg.node.collapsed = !v)"
                  class="border border-neon-deep/40 bg-neon/5"
                >
                  <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                    <ChevronRight
                      class="h-3 w-3 transition-transform"
                      :class="seg.node.collapsed ? 'rotate-0' : 'rotate-90'"
                      aria-hidden="true"
                    />
                    <HelpCircle class="h-3 w-3" aria-hidden="true" />
                    <span>{{ seg.node.cancelled ? "已取消提问" : "已回答" }}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent class="px-2.5 py-2">
                    <p class="prose-chat text-sm leading-6 text-text-main" v-html="renderMarkdown(seg.node.question)" />
                    <div class="mt-2 border-l border-neon-deep/30 bg-panel/30 px-2.5 py-1.5">
                      <p v-if="seg.node.cancelled" class="text-xs italic text-text-dim">已取消</p>
                      <template v-else>
                        <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">你的回答</p>
                        <p class="mt-0.5 prose-chat text-sm leading-6 text-text-main">{{ seg.node.answer }}</p>
                      </template>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </template>

              <!-- 工具调用组:相邻 tool 节点合并成一行自然语言摘要. -->
              <Collapsible
                v-else
                :open="!toolGroupCollapsed(`${index}-${segIdx}`)"
                @update:open="(v) => setToolGroupOpen(`${index}-${segIdx}`, v)"
                class="border-l border-neon-deep/30 bg-panel/15"
              >
                <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                  <ChevronRight
                    class="h-3 w-3 transition-transform"
                    :class="toolGroupCollapsed(`${index}-${segIdx}`) ? 'rotate-0' : 'rotate-90'"
                    aria-hidden="true"
                  />
                  <Wrench class="h-3 w-3" aria-hidden="true" />
                  <span>{{ seg.summary }}</span>
                  <span
                    :class="{
                      'text-neon/60': seg.tools.some((t) => t.status === 'loading' || t.status === 'running'),
                      'text-neon': seg.tools.every((t) => t.status === 'success'),
                      'text-red-400': seg.tools.some((t) => t.status === 'failed'),
                    }"
                  >
                    <Loader2 v-if="seg.tools.some((t) => t.status === 'loading' || t.status === 'running')" class="inline h-3 w-3 animate-spin" aria-hidden="true" />
                    <template v-else-if="seg.tools.every((t) => t.status === 'success')">✓</template>
                    <template v-else-if="seg.tools.some((t) => t.status === 'failed')">✗</template>
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent class="ml-0.5 border-l border-neon-deep/15 pl-2.5 py-1.5">
                  <div v-for="t in seg.tools" :key="t.id" class="py-0.5">
                    <div class="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-text-dim">
                      <Wrench class="h-2.5 w-2.5" aria-hidden="true" />
                      <span>{{ agentCallDisplay(t.presentation)?.title ?? t.name }}</span>
                      <span
                        :class="{
                          'text-neon/60': t.status === 'loading' || t.status === 'running',
                          'text-neon': t.status === 'success',
                          'text-red-400': t.status === 'failed',
                        }"
                      >
                        <Loader2 v-if="t.status === 'loading' || t.status === 'running'" class="inline h-3 w-3 animate-spin" aria-hidden="true" />
                        <template v-else-if="t.status === 'success'">✓</template>
                        <template v-else-if="t.status === 'failed'">✗</template>
                      </span>
                    </div>
                    <p
                      v-if="agentCallDisplay(t.presentation)?.response"
                      class="mt-1 whitespace-pre-wrap text-xs normal-case tracking-normal text-text-main/80"
                    >
                      {{ agentCallDisplay(t.presentation)?.response }}
                    </p>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </template>
          </div>
        </template>

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
              <template v-for="(part, partIdx) in renderAssistantContentSegments(msg.content)" :key="partIdx">
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
import { Bot, Brain, Check, ChevronRight, Copy, FileText, HelpCircle, Loader2, Pencil, User, Wrench } from "lucide-vue-next"
import type { AssistantTimelineNode, ChatMessage } from "@/composables/useAssistantTimeline"
import AttachmentImage from "@/components/assistant/AttachmentImage.vue"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { renderMarkdown } from "@/lib/markdown"
import { agentCallDisplay } from "../assistant-message-mappers"
import { formatFileSize } from "./format"
import type { ActiveAskState } from "./types"

const props = defineProps<{
  messages: ChatMessage[]
  sending: boolean
  activeAsk: ActiveAskState | null
  copiedIndex: number | null
  editingIndex: number | null
  toolGroupCollapsedMap: Record<string, boolean>
}>()

const emit = defineEmits<{
  copyMessage: [index: number]
  editUserMessage: [index: number]
  updateToolGroupCollapsed: [key: string, collapsed: boolean]
}>()

const TOOL_LABEL: Record<string, { verb: string; noun: string; unit: string | null }> = {
  read: { verb: "读取", noun: "文件", unit: "个" },
  list: { verb: "列出", noun: "条目", unit: "项" },
  search: { verb: "搜索", noun: "匹配", unit: "处" },
  glob: { verb: "匹配", noun: "文件", unit: "个" },
  diff: { verb: "比对", noun: "差异", unit: null },
  write: { verb: "写入", noun: "文件", unit: null },
  edit: { verb: "编辑", noun: "文件", unit: null },
  copy: { verb: "复制", noun: "文件", unit: null },
  move: { verb: "移动", noun: "文件", unit: null },
  delete: { verb: "删除", noun: "文件", unit: null },
  semantic_search: { verb: "语义检索", noun: "记忆", unit: null },
  use_skill: { verb: "激活", noun: "技能", unit: null },
  run_script: { verb: "执行", noun: "脚本", unit: null },
  inspect_frontend: { verb: "自检", noun: "前端", unit: null },
  test_skill_script: { verb: "测试", noun: "脚本", unit: null },
  ask_user: { verb: "向玩家", noun: "提问", unit: null },
}

type ToolNode = Extract<AssistantTimelineNode, { type: "tool" }>
type TimelineSegment =
  | { kind: "node"; node: AssistantTimelineNode }
  | { kind: "tool-group"; tools: ToolNode[]; summary: string }

type AssistantContentSegment =
  | { kind: "text"; text: string }
  | { kind: "thought"; text: string }

/** 一组相邻 tool 节点 → 自然语言摘要句（按工具名分组，合并同名工具计数）. */
function toolGroupSummary(tools: ToolNode[]): string {
  const byName = new Map<string, { count: number; status: string }>()
  for (const t of tools) {
    const key = t.name
    const entry = byName.get(key)
    if (entry) {
      entry.count += 1
      // 任一失败则整组标失败
      if (t.status === "failed") entry.status = "failed"
    } else {
      byName.set(key, { count: 1, status: t.status })
    }
  }
  const sentences: string[] = []
  for (const [name, { count, status }] of byName) {
    const label = TOOL_LABEL[name]
    const verb = label?.verb ?? name
    const noun = label?.noun ?? "操作"
    if (status === "failed") {
      sentences.push(`${verb}${noun}失败`)
      continue
    }
    const unit = label?.unit ?? null
    if (unit && count > 1) {
      sentences.push(`${verb}了 ${count} ${unit}${noun}`)
    } else {
      sentences.push(`${verb}了${noun}`)
    }
  }
  return sentences.join("、")
}

/** 把 timeline 分成渲染段：相邻 tool 合并，其余独立. */
function groupTimelineForRender(timeline: AssistantTimelineNode[]): TimelineSegment[] {
  const segments: TimelineSegment[] = []
  let i = 0
  while (i < timeline.length) {
    const node = timeline[i]
    if (node.type === "tool") {
      // 收集连续的 tool 节点
      const group: ToolNode[] = [node]
      let j = i + 1
      while (j < timeline.length && timeline[j].type === "tool") {
        group.push(timeline[j] as ToolNode)
        j += 1
      }
      segments.push({ kind: "tool-group", tools: group, summary: toolGroupSummary(group) })
      i = j
    } else {
      segments.push({ kind: "node", node })
      i += 1
    }
  }
  return segments
}

function renderAssistantContentSegments(content: string): AssistantContentSegment[] {
  const segments: AssistantContentSegment[] = []
  const pattern = /<think>([\s\S]*?)(?:<\/think>|$)/gi
  let cursor = 0
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) {
      const text = content.slice(cursor, index).trim()
      if (text) segments.push({ kind: "text", text })
    }
    const thought = (match[1] ?? "").trim()
    if (thought) segments.push({ kind: "thought", text: thought })
    cursor = index + match[0].length
  }
  if (cursor < content.length) {
    const text = content.slice(cursor).trim()
    if (text) segments.push({ kind: "text", text })
  }
  return segments.length > 0 ? segments : [{ kind: "text", text: content }]
}

function toolGroupCollapsed(key: string): boolean {
  // 默认折叠（true），只有显式设为 false 时展开
  return props.toolGroupCollapsedMap[key] !== false
}

function setToolGroupOpen(key: string, open: boolean) {
  emit("updateToolGroupCollapsed", key, !open)
}
</script>

<style scoped>
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
</style>
