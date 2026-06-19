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
          <Select
            :model-value="assistantProviderPresetId || '__platform_default__'"
            :disabled="updatingProviderPreset || providerPresets.length === 0"
            @update:model-value="(value) => handleProviderPresetChange(value === '__platform_default__' ? '' : value as string)"
          >
            <SelectTrigger class="h-8 max-w-[160px]" aria-label="API 服务商" :title="`API 服务商：${assistantProviderPresetId ? (providerPresets.find(p => p.id === assistantProviderPresetId)?.name ?? '所选预设已失效，回退到平台默认') : '使用平台默认服务商'}`">
              <SelectValue placeholder="默认服务商" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__platform_default__">默认服务商</SelectItem>
              <SelectItem
                v-for="preset in providerPresets"
                :key="preset.id"
                :value="preset.id"
              >
                {{ preset.name }}
              </SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            class="retro-button retro-focus inline-flex h-8 items-center justify-center gap-2 px-3 font-mono text-xs"
            :disabled="sending"
            @click="refresh"
            title="刷新游戏卡上下文"
          >
            <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': refreshing }" aria-hidden="true" />
            刷新
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
              class="flex gap-3"
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
              <div
                class="min-w-0 max-w-[calc(100%-2.75rem)] break-words px-3.5 py-2.5 text-sm leading-6"
                :class="msg.role === 'user'
                  ? 'whitespace-pre-wrap border border-neon-deep/35 bg-panel/55 text-text-main'
                  : 'border border-neon/20 bg-neon/5 text-text-main'"
              >
                <div v-if="msg.role === 'assistant'" class="prose-chat" v-html="renderMarkdown(msg.content)" />
                <template v-else>{{ msg.content }}</template>
              </div>
            </div>

            <div v-if="sending" class="flex flex-row gap-3">
              <span class="grid h-7 w-7 shrink-0 place-items-center border border-neon/45 bg-neon/10 text-neon">
                <Bot class="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div class="flex items-center gap-1.5 border border-neon/20 bg-neon/5 px-3.5 py-2.5">
                <span class="typing-dot" />
                <span class="typing-dot" />
                <span class="typing-dot" />
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
            class="retro-focus max-h-[160px] min-h-[44px] flex-1 resize-none border border-neon-deep/40 bg-panel/55 px-3.5 py-2.5 text-sm leading-6 text-text-main placeholder:text-text-dim focus:border-neon/55"
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
  </section>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted } from "vue"
import "highlight.js/styles/atom-one-dark.min.css"
import { Bot, ChevronDown, Loader2, Pencil, Plus, RefreshCw, Send, Sparkles, Trash2, User } from "lucide-vue-next"
import type { ConversationMessageRecord } from "@tsian/contracts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  runAssistantChat,
  getPlatformActiveGameCard,
  waitForPlatformHostReady,
  getLocalAssistantProviderPreset,
  updateLocalAssistantProviderPreset,
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

interface ChatMessage {
  role: "user" | "assistant"
  content: string
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
const refreshing = ref(false)
const errorMessage = ref("")
const cardName = ref("")
const messageListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const showJumpToBottom = ref(false)
const sessionCreating = ref(false)
const sessionRenaming = ref(false)
const sessionDeleting = ref(false)
const renaming = ref("")
const renamingSessionId = ref<string | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const providerPresets = ref<Array<{ id: string; name: string }>>([])
const assistantProviderPresetId = ref("")
const updatingProviderPreset = ref(false)

const cardTitle = computed(() => cardName.value || "未加载游戏卡")
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
  refreshing.value = true
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
    refreshing.value = false
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

  await scrollToBottom()

  const history: ConversationMessageRecord[] = messages.value
    .slice(0, -1)
    .map((msg) => ({ role: msg.role, content: msg.content }))

  try {
    const result = await runAssistantChat({
      message: content,
      history,
    })
    messages.value.push({ role: "assistant", content: result.replyText })
    await persistCurrentSession()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errorMessage.value = message
    await persistCurrentSession()
  } finally {
    sending.value = false
    await scrollToBottom()
    nextTick(() => inputRef.value?.focus())
  }
}

function handleScroll(event: Event) {
  const el = event.target as HTMLElement
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  showJumpToBottom.value = distanceFromBottom > 120
}

function autoGrow() {
  const el = inputRef.value
  if (!el) {
    return
  }
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`
}

function resetInputHeight() {
  const el = inputRef.value
  if (el) {
    el.style.height = "auto"
  }
}

async function scrollToBottom(force = false) {
  await nextTick()
  if (messageListRef.value) {
    if (force) {
      showJumpToBottom.value = false
    }
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
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

async function handleProviderPresetChange(presetId: string) {
  updatingProviderPreset.value = true
  try {
    await updateLocalAssistantProviderPreset(presetId || null)
    assistantProviderPresetId.value = presetId
  } catch {
    await loadProviderPreset()
  } finally {
    updatingProviderPreset.value = false
  }
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
