<template>
  <section class="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)] overflow-hidden bg-[#24251f]">
    <!-- Session sidebar -->
    <aside class="flex min-h-0 flex-col border-r border-neon-deep/30 bg-[#2a271f]">
      <div class="flex items-center justify-between border-b border-neon-deep/25 px-3 py-2.5">
        <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">会话</p>
        <button
          type="button"
          class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-panel/50 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
          :disabled="sessionCreating"
          title="新建会话"
          @click="handleCreateSession"
        >
          <Plus v-if="!sessionCreating" class="h-3.5 w-3.5" aria-hidden="true" />
          <Loader2 v-else class="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto py-1">
        <div
          v-for="session in sessions"
          :key="session.id"
          class="group relative flex items-center transition-colors"
          :class="session.id === activeSessionId ? 'bg-neon/10' : 'hover:bg-panel/40'"
        >
          <button
            type="button"
            class="retro-focus min-w-0 flex-1 px-3 py-2 text-left"
            :class="session.id === activeSessionId ? 'text-neon' : 'text-text-dim group-hover:text-text-main'"
            @click="handleSelectSession(session.id)"
          >
            <span class="block truncate text-xs font-bold">{{ session.title }}</span>
            <span class="mt-0.5 block font-mono text-[10px] text-text-dim/80">{{ formatSessionTime(session.updatedAt) }}</span>
          </button>
          <div
            class="flex shrink-0 items-center gap-1 pr-2 transition-opacity"
            :class="session.id === activeSessionId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
          >
            <button
              type="button"
              class="retro-focus grid h-6 w-6 place-items-center border border-neon-deep/40 bg-panel/50 text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
              :disabled="sessionRenaming"
              title="重命名会话"
              @click.stop="handleStartRename(session.id)"
            >
              <Pencil class="h-3 w-3" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="retro-focus grid h-6 w-6 place-items-center border border-danger/40 bg-danger/8 text-danger/85 transition-colors hover:bg-danger/20 hover:text-danger"
              :disabled="sessionDeleting"
              title="删除会话"
              @click.stop="handleDeleteSessionById(session.id)"
            >
              <Trash2 class="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <span
            v-if="session.id === activeSessionId"
            class="absolute inset-y-1 left-0 w-0.5 bg-neon"
            aria-hidden="true"
          />
        </div>
        <p
          v-if="sessions.length === 0 && !sessionCreating"
          class="px-3 py-6 text-center text-xs text-text-dim/70"
        >
          暂无会话
        </p>
      </div>
    </aside>

    <!-- Chat panel -->
    <section class="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <header class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/30 bg-[#2d2a23] px-4 py-2.5">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="grid h-7 w-7 shrink-0 place-items-center border border-neon/45 bg-neon/10 text-neon">
            <Bot class="h-4 w-4" aria-hidden="true" />
          </span>
          <div class="min-w-0 leading-tight">
            <h1 class="truncate text-sm font-bold text-text-main">桌面助手</h1>
            <p class="truncate font-mono text-[10px] uppercase tracking-wider text-text-dim">
              {{ cardTitle }}
            </p>
          </div>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="retro-focus grid h-8 w-8 place-items-center border border-neon-deep/55 bg-elevated text-text-dim hover:text-neon"
            :title="configButtonTitle"
            aria-label="助手配置"
            @click="showAssistantConfig = true"
          >
            <Settings class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <main class="relative min-h-0 overflow-hidden">
        <!-- Error state -->
        <div v-if="errorMessage" class="grid h-full min-h-[200px] place-items-center p-6">
          <div class="max-w-md border border-danger/45 bg-danger/8 p-5 text-center">
            <p class="font-mono text-xs uppercase tracking-wider text-danger">助手不可用</p>
            <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
            <button
              type="button"
              class="retro-button retro-focus mt-4 inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
              @click="errorMessage = ''"
            >
              关闭
            </button>
          </div>
        </div>

        <!-- Empty state -->
        <div v-else-if="messages.length === 0" class="grid h-full min-h-[260px] place-items-center p-6">
          <div class="max-w-md text-center">
            <span class="mx-auto grid h-14 w-14 place-items-center border border-neon/40 bg-neon/8 text-neon">
              <Sparkles class="h-7 w-7" aria-hidden="true" />
            </span>
            <p class="mt-4 font-mono text-xs uppercase tracking-[0.22em] text-neon">桌面助手</p>
            <p class="mt-2 text-sm leading-6 text-text-dim">
              向助手询问当前游戏卡的内容、Agent、Skill 或编辑方式。
            </p>
            <div class="mt-5 flex flex-wrap justify-center gap-2">
              <button
                v-for="suggestion in suggestions"
                :key="suggestion.label"
                type="button"
                class="retro-focus border border-neon-deep/40 bg-panel/50 px-3 py-1.5 font-mono text-xs text-text-dim transition-colors hover:border-neon/55 hover:text-neon"
                @click="sendSuggestion(suggestion.message)"
              >
                {{ suggestion.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- Conversation -->
        <div
          v-else
          ref="messageListRef"
          class="h-full overflow-auto"
          @scroll="handleScroll"
        >
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
                <div
                  class="break-words px-3.5 py-2.5 text-sm leading-6"
                  :class="msg.role === 'user'
                    ? 'whitespace-pre-wrap border border-neon-deep/35 bg-panel/55 text-text-main'
                    : 'border border-neon/20 bg-neon/5 text-text-main'"
                >
                <template v-if="msg.role === 'assistant'">
                  <!-- 过程节点:思考/工具按发生顺序纵向平铺,各独立折叠(不含最终回复) -->
                  <template v-for="node in msg.timeline ?? []" :key="node.id">
                    <!-- 思考节点(tool_calls 轮的推理文本,回合结束折叠保留可回看) -->
                    <Collapsible
                      v-if="node.type === 'thought'"
                      v-model:open="node.collapsed"
                      class="border border-neon-deep/25 bg-panel/30"
                    >
                      <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                        <ChevronRight
                          class="h-3 w-3 transition-transform"
                          :class="node.collapsed ? 'rotate-0' : 'rotate-90'"
                          aria-hidden="true"
                        />
                        <Brain class="h-3 w-3" aria-hidden="true" />
                        <span>思考</span>
                      </CollapsibleTrigger>
                      <CollapsibleContent class="border-t border-neon-deep/20 px-2.5 py-2">
                        <div class="prose-chat text-xs leading-5 text-text-dim" v-html="renderMarkdown(node.text)" />
                      </CollapsibleContent>
                    </Collapsible>

                    <!-- 工具调用节点(按 callId 去重,loading→success/failed 更新同一节点) -->
                    <Collapsible
                      v-else-if="node.type === 'tool'"
                      v-model:open="node.collapsed"
                      class="border border-neon-deep/25 bg-panel/30"
                    >
                      <CollapsibleTrigger class="retro-focus flex w-full items-center gap-1.5 px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-wider text-text-dim transition-colors hover:text-neon">
                        <ChevronRight
                          class="h-3 w-3 transition-transform"
                          :class="node.collapsed ? 'rotate-0' : 'rotate-90'"
                          aria-hidden="true"
                        />
                        <Wrench class="h-3 w-3" aria-hidden="true" />
                        <span>{{ node.name }}</span>
                        <span
                          :class="{
                            'text-neon/60': node.status === 'loading' || node.status === 'running',
                            'text-neon': node.status === 'success',
                            'text-red-400': node.status === 'failed',
                          }"
                        >
                          <Loader2 v-if="node.status === 'loading' || node.status === 'running'" class="inline h-3 w-3 animate-spin" aria-hidden="true" />
                          <template v-else-if="node.status === 'success'">✓</template>
                          <template v-else-if="node.status === 'failed'">✗</template>
                        </span>
                      </CollapsibleTrigger>
                      <CollapsibleContent class="border-t border-neon-deep/20 px-2.5 py-2">
                        <div
                          v-if="node.output"
                          class="max-h-32 overflow-auto whitespace-pre-wrap border border-neon-deep/15 bg-panel/40 px-2 py-1 font-mono text-[10px] leading-4 text-text-dim"
                        >{{ node.output }}</div>
                      </CollapsibleContent>
                    </Collapsible>
                  </template>

                  <!-- 当前轮流式文本:尚未分类(tool_calls→归入 thought 折叠;stop→写入 content) -->
                  <div v-if="msg.streamingText" class="prose-chat" v-html="renderMarkdown(msg.streamingText)" />
                  <!-- 最终回复 / 历史 / text 模式:无流式时展示 content -->
                  <div v-else-if="msg.content" class="prose-chat" v-html="renderMarkdown(msg.content)" />
                  <!-- 等待首个 token:过程/流式/回复皆空时显示打字点(替代独立占位框) -->
                  <div v-else class="flex items-center gap-1.5">
                    <span class="typing-dot" />
                    <span class="typing-dot" />
                    <span class="typing-dot" />
                  </div>
                </template>
                <template v-else>{{ msg.content }}</template>
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
                    @click="handleCopyMessage(index)"
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
                    @click="handleEditUserMessage(index)"
                  >
                    <Pencil class="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <transition name="fade">
          <button
            v-if="showJumpToBottom"
            type="button"
            class="retro-focus absolute bottom-3 left-1/2 grid h-8 w-8 -translate-x-1/2 place-items-center border border-neon/50 bg-[#2d2a23] text-neon shadow-[0_4px_14px_rgba(0,0,0,0.4)]"
            aria-label="跳到最新消息"
            @click="scrollToBottom(true)"
          >
            <ChevronDown class="h-4 w-4" aria-hidden="true" />
          </button>
        </transition>
      </main>

      <footer class="border-t border-neon-deep/30 bg-[#2d2a23] px-4 py-3">
        <form class="mx-auto flex max-w-3xl items-end gap-2" @submit.prevent="send">
          <textarea
            ref="inputRef"
            v-model="inputText"
            class="retro-focus max-h-[160px] min-h-[44px] flex-1 resize-none overflow-y-auto border border-neon-deep/40 bg-panel/55 px-3.5 py-2.5 text-sm leading-6 text-text-main placeholder:text-text-dim focus:border-neon/55"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows="1"
            :disabled="sending"
            @keydown.enter.exact.prevent="send"
            @input="autoGrow"
          />
          <button
            type="submit"
            class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
            :disabled="sending || !inputText.trim()"
            title="发送"
          >
            <Send class="h-4 w-4" aria-hidden="true" />
            发送
          </button>
          <button
            v-if="sending"
            type="button"
            class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
            title="停止生成"
            @click="stopGenerating"
          >
            <Square class="h-4 w-4" aria-hidden="true" />
            停止
          </button>
        </form>
      </footer>
    </section>

    <!-- Rename modal -->
    <div
      v-if="renaming"
      class="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      @click.self="closeRename"
    >
      <div class="w-full max-w-sm border border-neon/40 bg-[#2d2a23] p-4 shadow-[0_18px_48px_rgba(0,0,0,0.5)]">
        <p class="font-mono text-xs uppercase tracking-wider text-neon">重命名会话</p>
        <input
          ref="renameInputRef"
          v-model="renaming"
          class="retro-focus mt-3 w-full border border-neon-deep/40 bg-panel/55 px-3 py-2 text-sm text-text-main"
          @keydown.enter.prevent="handleConfirmRename"
          @keydown.esc.prevent="closeRename"
        />
        <div class="mt-4 flex justify-end gap-2">
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
            @click="closeRename"
          >
            取消
          </button>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center px-3 font-mono text-xs"
            :disabled="sessionRenaming"
            @click="handleConfirmRename"
          >
            确认
          </button>
        </div>
      </div>
    </div>

    <!-- Assistant config floating window (slot mode, bypasses the dialog composable) -->
    <FloatingWindow
      v-if="showAssistantConfig"
      title="助手配置"
      width-class="max-w-lg"
      @close="showAssistantConfig = false"
    >
      <AssistantConfigPanel @change="handleAssistantConfigChange" @close="showAssistantConfig = false" />
    </FloatingWindow>
  </section>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, computed, onMounted } from "vue"
import "highlight.js/styles/atom-one-dark.min.css"
import { Bot, Check, ChevronDown, ChevronRight, Copy, Loader2, Pencil, Plus, Send, Settings, Sparkles, Square, Trash2, User, Wrench, Brain } from "lucide-vue-next"
import type { ConversationMessageRecord } from "@tsian/contracts"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import AssistantConfigPanel from "@/components/assistant/AssistantConfigPanel.vue"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  runAssistantChat,
  getPlatformActiveGameCard,
  waitForPlatformHostReady,
  getLocalAssistantProviderPreset,
} from "../platform-host"
import { renderMarkdown } from "../lib/markdown"
import {
  createAssistantSession,
  deleteAssistantSession,
  ensureAssistantSession,
  getActiveAssistantSessionId,
  getAssistantSessionMessages,
  listAssistantSessions,
  renameAssistantSession,
  saveAssistantSessionMessages,
  setActiveAssistantSessionId,
  type AssistantSessionSummary,
} from "../storage"

/**
 * 过程事件节点:assistant 回合内按发生顺序排列的思考/工具.
 * 每个节点独立折叠/展开,纵向平铺呈现 agent 的行为顺序(非分类堆叠).
 * 最终回复不入时间线——它是 content,渲染在过程节点之后.
 * 不持久化——刷新/切换会话后消失,只留 content(最终回复).
 */
type AssistantTimelineNode =
  | { type: "thought"; id: string; round: number; text: string; collapsed: boolean }
  | { type: "tool"; id: string; round: number; name: string; status: "loading" | "running" | "success" | "failed"; output?: string; collapsed: boolean }

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  // 过程事件(native 模式按发生顺序;不持久化,刷新后消失).
  timeline?: AssistantTimelineNode[]
  // 当前轮 content 流式文本(可见回复 provisional;onRoundEnd stop→写入 content).
  // 不持久化——回合结束即清空,只作为流式期 UI 占位.
  streamingText?: string
  // 当前轮 reasoning 流式文本(思维链;累积不显示,onRoundEnd tool_calls→折叠 thought).
  // 不持久化——回合结束即清空.
  streamingReasoning?: string
}

const suggestions = [
  { label: "这张卡有哪些 Agent？", message: "这张游戏卡里有哪些 Agent？分别负责什么？" },
  { label: "怎么编辑游戏卡？", message: "我想编辑当前游戏卡，应该从哪里开始？" },
  { label: "介绍游戏卡结构", message: "介绍一下当前游戏卡的内容结构。" },
]

const sessions = ref<AssistantSessionSummary[]>([])
const activeSessionId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const inputText = ref("")
const sending = ref(false)
const errorMessage = ref("")
const cardName = ref("")
const messageListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const showJumpToBottom = ref(false)
// 复制反馈:记下刚复制的消息索引,显示「已复制」勾,短暂后自动清除.
const copiedIndex = ref<number | null>(null)
// 编辑中:正在通过工具条编辑的消息索引(仅用于工具条透明度保持).
const editingIndex = ref<number | null>(null)
// Smart scroll: auto-scroll only while the user is pinned near the bottom.
const userPinnedToBottom = ref(true)
// Abort controller for the in-flight chat turn (stop-generating button).
const abortController = ref<AbortController | null>(null)
const sessionCreating = ref(false)
const sessionRenaming = ref(false)
const sessionDeleting = ref(false)
const renaming = ref("")
const renamingSessionId = ref<string | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const providerPresets = ref<Array<{ id: string; name: string }>>([])
const assistantProviderPresetId = ref("")
const showAssistantConfig = ref(false)

const cardTitle = computed(() => cardName.value || "未加载游戏卡")
const configButtonTitle = computed(() => {
  if (assistantProviderPresetId.value) {
    const name = providerPresets.value.find((p) => p.id === assistantProviderPresetId.value)?.name ?? "所选预设已失效"
    return `助手配置（服务商：${name}）`
  }
  return "助手配置（使用平台默认服务商）"
})
function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  if (isToday) {
    return `${hh}:${mm}`
  }
  const mo = String(date.getMonth() + 1).padStart(2, "0")
  const dd = String(date.getDate()).padStart(2, "0")
  return `${mo}-${dd} ${hh}:${mm}`
}

async function refresh() {
  errorMessage.value = ""
  try {
    await waitForPlatformHostReady()
    const card = await getPlatformActiveGameCard()
    if (card) {
      cardName.value = card.manifest.name
    } else {
      cardName.value = ""
    }
    await loadProviderPreset()
  } finally {
    // nothing to reset; refresh is a silent context load
  }
}

async function refreshSessions() {
  sessions.value = await listAssistantSessions("local")
}

async function loadActiveSession() {
  const session = await ensureAssistantSession("local")
  activeSessionId.value = session.id
  const stored = await getAssistantSessionMessages(session.id)
  messages.value = stored.map((msg) => ({
    role: msg.role === "user" ? "user" : "assistant",
    content: msg.content,
  }))
  await refreshSessions()
  await scrollToBottom()
}

async function handleSelectSession(id: string) {
  if (id === activeSessionId.value) {
    return
  }
  // Optimistic UI update first: switch highlight immediately, then load the
  // target session's messages (one fast read). Persist the previous session in
  // the background so the click feels instant.
  const previousId = activeSessionId.value
  const previousMessages = messages.value.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }))

  activeSessionId.value = id
  const stored = await getAssistantSessionMessages(id)
  messages.value = stored.map((msg) => ({
    role: msg.role === "user" ? "user" : "assistant",
    content: msg.content,
  }))
  await scrollToBottom()

  // Background persistence of the session we just left. Silent (touch=false):
  // merely selecting another session must not bump this one's sort order.
  void setActiveAssistantSessionId("local", id)
  if (previousId) {
    void saveAssistantSessionMessages("local", previousId, previousMessages, {
      touch: false,
    })
  }
}

async function handleCreateSession() {
  sessionCreating.value = true
  try {
    // Persist the current session in the background so creation feels instant.
    const previousId = activeSessionId.value
    const previousMessages = messages.value.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }))
    if (previousId) {
      void saveAssistantSessionMessages("local", previousId, previousMessages, {
        touch: false,
      })
    }
    const session = await createAssistantSession("local")
    activeSessionId.value = session.id
    messages.value = []
    await refreshSessions()
    nextTick(() => inputRef.value?.focus())
  } finally {
    sessionCreating.value = false
  }
}

function handleStartRename(id: string) {
  const current = sessions.value.find((entry) => entry.id === id)
  renamingSessionId.value = id
  renaming.value = current?.title ?? ""
  nextTick(() => renameInputRef.value?.focus())
}

function closeRename() {
  renaming.value = ""
  renamingSessionId.value = null
}

async function handleConfirmRename() {
  const id = renamingSessionId.value
  if (!id || !renaming.value.trim()) {
    closeRename()
    return
  }
  sessionRenaming.value = true
  try {
    await renameAssistantSession("local", id, renaming.value.trim())
    await refreshSessions()
  } finally {
    sessionRenaming.value = false
    closeRename()
  }
}

async function handleDeleteSessionById(id: string) {
  if (!id) {
    return
  }
  const wasActive = id === activeSessionId.value
  sessionDeleting.value = true
  try {
    await deleteAssistantSession("local", id)
    await refreshSessions()
    if (wasActive) {
      // The deleted session was active; pick the next one or create a fresh session.
      const nextId = await getActiveAssistantSessionId("local")
      if (nextId) {
        activeSessionId.value = nextId
        const stored = await getAssistantSessionMessages(nextId)
        messages.value = stored.map((msg) => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        }))
      } else {
        const session = await createAssistantSession("local")
        activeSessionId.value = session.id
        messages.value = []
        await refreshSessions()
      }
      await scrollToBottom()
    }
  } finally {
    sessionDeleting.value = false
  }
}

async function persistCurrentSession() {
  if (!activeSessionId.value) {
    return
  }
  const toStore: ConversationMessageRecord[] = messages.value.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }))
  await saveAssistantSessionMessages("local", activeSessionId.value, toStore)
  await refreshSessions()
}

function sendSuggestion(message: string) {
  inputText.value = message
  send()
}

async function send() {
  const content = inputText.value.trim()
  if (!content || sending.value) {
    return
  }

  errorMessage.value = ""
  messages.value.push({ role: "user", content })
  inputText.value = ""
  resetInputHeight()
  sending.value = true

  // Placeholder assistant message:过程节点(thought/tool)按发生顺序纵向平铺,
  // streamingText 承载当前轮 content 流式文本,onRoundEnd 写入 content;
  // streamingReasoning 承载当前轮思维链,onRoundEnd 折叠为 thought 节点(不流式显示).
  const assistantMsg = reactive<ChatMessage>({
    role: "assistant",
    content: "",
    timeline: [],
    streamingText: "",
    streamingReasoning: "",
  })
  messages.value.push(assistantMsg)
  await scrollToBottom()

  const history: ConversationMessageRecord[] = messages.value
    .slice(0, -2)
    .map((msg) => ({ role: msg.role, content: msg.content }))

  // ① 时间线式流式:native 模式按 round 顺序把过程事件(thought/tool)作为独立节点
  // 纵向平铺.onDelta 带 kind 区分——reasoning(思维链,DeepSeek reasoning_content /
  // Claude thinking_delta)累积进 streamingReasoning,不流式显示(保持安静),回合结束
  // tool_calls 时折叠为 thought 节点(空则不建,避免空思考块);content(可见回复)累积
  // 进 streamingText 流式显示,回合结束 stop 时写入 content.这样:
  //   - 普通问答(单 round stop):看到正文流式,思考(若有 reasoning)折叠成「思考」可展开.
  //   - 工具调用轮:思考折叠,正文一般为空(工具调用的 content delta 是噪声,丢弃).
  // tool 节点按 callId 去重更新 status/output.
  // text 模式无回调,content 在 reconcile 一次性赋值,timeline 为空——降级为现状.
  const timeline = assistantMsg.timeline!

  const onDelta = (agentId: string, delta: string, round: number, kind: "reasoning" | "content") => {
    if (kind === "reasoning") {
      // 思维链累积,不流式显示(默认折叠);onRoundEnd tool_calls 时落为 thought 节点.
      assistantMsg.streamingReasoning = (assistantMsg.streamingReasoning ?? "") + delta
    } else {
      // 可见回复流式累积;onRoundEnd stop 时写入 content.
      assistantMsg.streamingText = (assistantMsg.streamingText ?? "") + delta
      maybeScrollToBottom()
    }
  }

  const onRoundEnd = (agentId: string, round: number, finishReason: "stop" | "tool_calls") => {
    const reasoning = assistantMsg.streamingReasoning ?? ""
    if (finishReason === "tool_calls") {
      // 思考轮:把累积的思维链折叠为 thought 节点(空白则跳过,不渲染空思考块).
      // tool_calls 轮的 content delta 是工具调用前后的噪声(不是最终回复),丢弃.
      if (reasoning.trim()) {
        timeline.push({ type: "thought", id: `thought-r${round}`, round, text: reasoning, collapsed: true })
      }
    } else {
      // 最终轮:streamingText 即最终回复,写入 content(渲染层在过程节点之后展示).
      // 若该轮有 reasoning(部分模型在 stop 轮也吐思维链),也折叠为 thought 节点.
      if (reasoning.trim()) {
        timeline.push({ type: "thought", id: `thought-r${round}`, round, text: reasoning, collapsed: true })
      }
      assistantMsg.content = assistantMsg.streamingText ?? ""
    }
    // 清空两个缓冲:下一轮 onDelta 重新累积(或回合已结束).
    assistantMsg.streamingReasoning = ""
    assistantMsg.streamingText = ""
    maybeScrollToBottom()
  }

  const onTool = (
    agentId: string,
    round: number,
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: string,
  ) => {
    // 按 callId 去重:同一工具调用的 loading→success/failed 更新同一节点.
    const existing = timeline.find(
      (n): n is AssistantTimelineNode & { type: "tool" } => n.type === "tool" && n.id === callId,
    )
    if (existing) {
      existing.status = status
      if (output !== undefined) {
        existing.output = output
      }
    } else {
      timeline.push({
        type: "tool",
        id: callId,
        round,
        name,
        status,
        collapsed: false,
        ...(output !== undefined ? { output } : {}),
      })
    }
    maybeScrollToBottom()
  }

  // ③ Stop-generating: an AbortController for this turn, abortable from the UI.
  const controller = new AbortController()
  abortController.value = controller

  // activeSessionId 由 loadActiveSession/ensureAssistantSession 保证非空;
  // guard 兜底边缘时序(组件未初始化完成就发消息),类型上收窄 string|null -> string.
  const sessionId = activeSessionId.value
  if (!sessionId) {
    sending.value = false
    return
  }

  try {
    const result = await runAssistantChat({
      message: content,
      history,
      sessionId,
      onDelta,
      onRoundEnd,
      onTool,
      signal: controller.signal,
    })
    // reconcile:replyText 是最后一轮(final)的文本,以它为准(strip 工具块等).
    // native 模式 onRoundEnd(stop)已写入 content;text 模式无回调,这里首次赋值.
    assistantMsg.content = result.replyText
    assistantMsg.streamingText = ""
    assistantMsg.streamingReasoning = ""
    await persistCurrentSession()
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError"
    const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
    const taskTimeout = error instanceof Error && error.name === "TaskTimeoutError"
    const taskStalled = error instanceof Error && error.name === "TaskCompressionStalledError"
    // 把仍在流式的 provisional 文本落盘,避免中止/出错时丢失用户已见进度:
    //   - streamingReasoning → 折叠为 thought 节点(若非空,保留已产出的思维链)
    //   - streamingText → content(已见的回复正文)
    const flushStreaming = () => {
      const reasoning = assistantMsg.streamingReasoning ?? ""
      if (reasoning.trim()) {
        timeline.push({
          type: "thought",
          id: `thought-flush-${timeline.length}`,
          round: -1,
          text: reasoning,
          collapsed: true,
        })
      }
      assistantMsg.streamingReasoning = ""
      if (assistantMsg.streamingText) {
        assistantMsg.content = assistantMsg.streamingText
        assistantMsg.streamingText = ""
      }
    }
    if (aborted) {
      // Keep the partial text; mark it so the user knows it was cut short.
      flushStreaming()
      if (assistantMsg.content) {
        assistantMsg.content = `${assistantMsg.content}\n\n_（已停止）_`
        await persistCurrentSession()
      } else if (timeline.length === 0) {
        // Nothing was produced at all: drop the empty placeholder.
        messages.value.pop()
      } else {
        // Only process nodes (no reply text) — keep them, persist.
        await persistCurrentSession()
      }
    } else if (budgetExhausted || taskTimeout || taskStalled) {
      // 三类温和中止同路径(非失败的中止,与 abort 对称):
      // - budgetExhausted:turn 内第二次达预算(narrative)/压无可压(task).
      // - taskTimeout:任务型 agent 超时(task 模式时长兜底).
      // - taskStalled:任务压缩无效早退(下降 <10%,不傻等超时烧钱).
      // 保留已流式 thought,用 content 承载温和提示,不设 errorMessage、不 pop 占位.
      const hint = taskTimeout
        ? "任务超时，已中止"
        : taskStalled
          ? "上下文持续膨胀且压缩无效，已中止"
          : "上下文已满，请开始新会话或精简对话"
      flushStreaming()
      if (assistantMsg.content) {
        assistantMsg.content = `${assistantMsg.content}\n\n_（${hint}）_`
      } else {
        assistantMsg.content = `${hint}。`
      }
      await persistCurrentSession()
    } else {
      const message = error instanceof Error ? error.message : String(error)
      errorMessage.value = message
      flushStreaming()
      if (!assistantMsg.content && timeline.length === 0) {
        messages.value.pop()
      }
      await persistCurrentSession()
    }
  } finally {
    // 回合结束:折叠所有仍展开的 thought/tool 节点(过程完成,保留可展开回看).
    for (const node of timeline) {
      if (node.type === "thought" || node.type === "tool") {
        node.collapsed = true
      }
    }
    assistantMsg.streamingText = ""
    assistantMsg.streamingReasoning = ""
    abortController.value = null
    sending.value = false
    await scrollToBottom()
    nextTick(() => inputRef.value?.focus())
  }
}

function stopGenerating() {
  abortController.value?.abort()
}

/**
 * 复制消息正文到剪贴板,并在该消息工具条短暂显示「已复制」勾.
 * assistant 消息复制 content(最终回复,不含过程节点);user 消息复制 content.
 */
async function handleCopyMessage(index: number) {
  const msg = messages.value[index]
  if (!msg || !msg.content) {
    return
  }
  try {
    await navigator.clipboard.writeText(msg.content)
    copiedIndex.value = index
    // 短暂显示后清除,让同一消息可再次复制并恢复复制图标.
    setTimeout(() => {
      if (copiedIndex.value === index) {
        copiedIndex.value = null
      }
    }, 1500)
  } catch {
    // 剪贴板写入失败(权限/非安全上下文)静默忽略,不打断对话.
  }
}

/**
 * 编辑并重新发送某条用户消息:截断到该条之前、把它的文本回填输入框、聚焦.
 * 回复中(sending)禁用,避免与正在进行的 turn 冲突.截断后未发送的消息及其
 * 回复一并删除(平铺列表模型,重做这一轮而非分支).用户改完正常点发送即可.
 */
function handleEditUserMessage(index: number) {
  if (sending.value) {
    return
  }
  const msg = messages.value[index]
  if (!msg || msg.role !== "user") {
    return
  }
  editingIndex.value = index
  inputText.value = msg.content
  // 截断:保留 index 之前的消息,丢弃该条及其后所有消息(含其回复).
  messages.value = messages.value.slice(0, index)
  resetInputHeight()
  nextTick(() => {
    inputRef.value?.focus()
    autoGrow()
    editingIndex.value = null
  })
  // 乐观更新已持久化的会话(后台,不阻塞 UI).
  if (activeSessionId.value) {
    const toStore: ConversationMessageRecord[] = messages.value.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    void saveAssistantSessionMessages("local", activeSessionId.value, toStore, { touch: false })
  }
}

function handleScroll(event: Event) {
  const el = event.target as HTMLElement
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  userPinnedToBottom.value = distanceFromBottom < 80
  showJumpToBottom.value = distanceFromBottom > 120
}

function autoGrow() {
  const el = inputRef.value
  if (!el) {
    return
  }
  // Reset to content-height first so scrollHeight reflects the actual content,
  // not the previous (possibly capped) height. Then cap at maxH.
  el.style.height = "auto"
  const maxH = 160
  const contentH = el.scrollHeight
  if (contentH <= maxH) {
    // Content fits: pin height to content and hide overflow so no scrollbar
    // flickers from sub-pixel scrollHeight/line-height rounding.
    el.style.height = `${contentH}px`
    el.style.overflowY = "hidden"
  } else {
    // Content exceeds cap: fix at maxH and allow scrolling.
    el.style.height = `${maxH}px`
    el.style.overflowY = "auto"
  }
}

function resetInputHeight() {
  const el = inputRef.value
  if (el) {
    el.style.height = "auto"
    el.style.overflowY = "hidden"
  }
}

async function scrollToBottom(force = false) {
  await nextTick()
  if (messageListRef.value) {
    if (force) {
      showJumpToBottom.value = false
      userPinnedToBottom.value = true
    }
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
  }
}

// Auto-scroll during streaming only when the user is already near the bottom;
// never yank the view away from someone scrolling up through history.
function maybeScrollToBottom() {
  if (userPinnedToBottom.value) {
    void scrollToBottom()
  }
}

async function loadProviderPreset() {
  try {
    const result = await getLocalAssistantProviderPreset()
    providerPresets.value = result.presets
    assistantProviderPresetId.value = result.providerPresetId
  } catch {
    // Non-fatal: provider selection just won't show.
  }
}

/**
 * Called when the AssistantConfigPanel persists a config change. Re-reads the
 * provider preset state so the gear button's title reflects the active preset.
 */
async function handleAssistantConfigChange() {
  await loadProviderPreset()
}

onMounted(async () => {
  await refresh()
  await loadActiveSession()
  await loadProviderPreset()
  nextTick(() => inputRef.value?.focus())
})
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

<!-- Unscoped so .prose-chat can style rendered markdown HTML and hljs tokens. -->
<style>
.prose-chat {
  font-size: 0.875rem;
  line-height: 1.7;
  color: var(--color-text-main);
}
.prose-chat p {
  margin: 0 0 0.6em;
}
.prose-chat p:last-child {
  margin-bottom: 0;
}
.prose-chat h1,
.prose-chat h2,
.prose-chat h3,
.prose-chat h4 {
  margin: 1.1em 0 0.5em;
  font-weight: 700;
  line-height: 1.3;
  color: var(--color-text-main);
}
.prose-chat h1 { font-size: 1.15rem; }
.prose-chat h2 { font-size: 1.05rem; }
.prose-chat h3 { font-size: 0.98rem; }
.prose-chat h4 { font-size: 0.92rem; color: var(--color-neon); }
.prose-chat h1:first-child,
.prose-chat h2:first-child,
.prose-chat h3:first-child,
.prose-chat h4:first-child {
  margin-top: 0;
}
.prose-chat ul,
.prose-chat ol {
  margin: 0.4em 0 0.7em;
  padding-left: 1.4em;
}
.prose-chat li {
  margin: 0.2em 0;
}
.prose-chat ul { list-style: disc; }
.prose-chat ol { list-style: decimal; }
.prose-chat a {
  color: var(--color-neon);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.prose-chat a:hover {
  filter: brightness(1.15);
}
.prose-chat strong {
  color: var(--color-neon);
  font-weight: 700;
}
.prose-chat em {
  font-style: italic;
  color: var(--color-text-main);
}
.prose-chat blockquote {
  margin: 0.6em 0;
  padding: 0.2em 0.85em;
  border-left: 2px solid var(--color-neon-deep);
  color: var(--color-text-dim);
}
.prose-chat blockquote p {
  margin: 0.25em 0;
}
.prose-chat hr {
  margin: 1em 0;
  border: 0;
  border-top: 1px solid rgba(246, 236, 215, 0.16);
}
.prose-chat code {
  font-family: var(--font-mono);
  font-size: 0.82em;
  padding: 0.1em 0.35em;
  background: rgba(246, 236, 215, 0.1);
  color: var(--color-text-main);
  border: 1px solid rgba(246, 236, 215, 0.14);
}
.prose-chat pre {
  margin: 0.6em 0;
  padding: 0.7em 0.85em;
  overflow-x: auto;
  background: #1a1c18;
  border: 1px solid rgba(246, 236, 215, 0.16);
  box-shadow: inset 1px 1px 0 rgba(0, 0, 0, 0.75), inset -1px -1px 0 rgba(246, 236, 215, 0.08);
}
.prose-chat pre code {
  padding: 0;
  background: transparent;
  border: 0;
  font-size: 0.8rem;
  line-height: 1.6;
  color: inherit;
}
.prose-chat table {
  width: 100%;
  margin: 0.6em 0;
  border-collapse: collapse;
  font-size: 0.82rem;
}
.prose-chat th,
.prose-chat td {
  padding: 0.35em 0.6em;
  border: 1px solid rgba(246, 236, 215, 0.18);
  text-align: left;
}
.prose-chat th {
  background: rgba(243, 197, 109, 0.1);
  color: var(--color-neon);
  font-weight: 700;
}

/* Warm-tune the highlight.js atom-one-dark palette toward the CRT theme. */
.prose-chat .hljs {
  color: #e8dcc4;
  background: transparent;
}
.prose-chat .hljs-comment,
.prose-chat .hljs-quote {
  color: #6f6757;
  font-style: italic;
}
.prose-chat .hljs-keyword,
.prose-chat .hljs-selector-tag,
.prose-chat .hljs-built_in,
.prose-chat .hljs-name,
.prose-chat .hljs-tag {
  color: #f3c56d;
}
.prose-chat .hljs-string,
.prose-chat .hljs-title,
.prose-chat .hljs-section,
.prose-chat .hljs-attribute,
.prose-chat .hljs-literal,
.prose-chat .hljs-template-tag,
.prose-chat .hljs-template-variable,
.prose-chat .hljs-type,
.prose-chat .hljs-addition {
  color: #b8c98a;
}
.prose-chat .hljs-number,
.prose-chat .hljs-symbol,
.prose-chat .hljs-bullet,
.prose-chat .hljs-meta .hljs-string,
.prose-chat .hljs-subst {
  color: #e0b577;
}
.prose-chat .hljs-attr,
.prose-chat .hljs-variable,
.prose-chat .hljs-link {
  color: #d9b07a;
}
.prose-chat .hljs-deletion {
  color: #c84f5c;
}
</style>
