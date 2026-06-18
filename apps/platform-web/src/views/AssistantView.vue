<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-[11px] uppercase tracking-wider text-neon">Desktop Assistant</p>
        <h1 class="truncate text-base font-bold text-text-main">{{ cardTitle }}</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div v-if="hasCardAssistant" class="flex items-center gap-1 border border-neon-deep/35 bg-elevated/35 px-1 py-0.5">
          <button
            type="button"
            class="retro-focus px-2 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors"
            :class="mode === 'local' ? 'bg-neon/15 text-neon' : 'text-text-dim hover:text-text-main'"
            @click="mode = 'local'"
          >
            本地
          </button>
          <button
            type="button"
            class="retro-focus px-2 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors"
            :class="mode === 'card' ? 'bg-neon/15 text-neon' : 'text-text-dim hover:text-text-main'"
            @click="mode = 'card'"
          >
            卡片
          </button>
        </div>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="sending"
          @click="refresh"
        >
          <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
      </div>
    </header>

    <main class="min-h-0 overflow-hidden">
      <div v-if="errorMessage" class="retro-inset grid h-full min-h-[200px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">助手不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
        </div>
      </div>

      <div v-else-if="messages.length === 0" class="retro-inset grid h-full min-h-[200px] place-items-center p-4">
        <div class="max-w-md text-center">
          <Bot class="mx-auto h-10 w-10 text-neon-muted" aria-hidden="true" />
          <p class="mt-3 font-mono text-xs uppercase tracking-[0.22em] text-neon">桌面助手</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">
            向助手询问当前游戏卡的内容、Agent、Skill 或编辑方式。
          </p>
        </div>
      </div>

      <div v-else ref="messageListRef" class="h-full overflow-auto px-4 py-3">
        <div
          v-for="(msg, index) in messages"
          :key="index"
          class="mb-4 last:mb-0"
        >
          <div class="mb-1 flex items-center gap-2">
            <span
              class="font-mono text-[10px] uppercase tracking-wider"
              :class="msg.role === 'user' ? 'text-text-dim' : 'text-neon'"
            >
              {{ msg.role === "user" ? "你" : "助手" }}
            </span>
          </div>
          <div
            class="whitespace-pre-wrap break-words border px-3 py-2 text-sm leading-6"
            :class="msg.role === 'user'
              ? 'border-neon-deep/35 bg-panel/55 text-text-main'
              : 'border-neon/25 bg-neon/5 text-text-main'"
          >
            {{ msg.content }}
          </div>
        </div>
        <div v-if="sending" class="mb-4">
          <div class="mb-1 flex items-center gap-2">
            <span class="font-mono text-[10px] uppercase tracking-wider text-neon">助手</span>
          </div>
          <div class="border border-neon/25 bg-neon/5 px-3 py-2 text-sm leading-6 text-text-dim">
            正在思考...
          </div>
        </div>
      </div>
    </main>

    <footer class="retro-statusbar border-t p-3">
      <form class="flex items-end gap-2" @submit.prevent="send">
        <textarea
          ref="inputRef"
          v-model="inputText"
          class="retro-focus min-h-[40px] flex-1 resize-none border border-neon-deep/35 bg-panel/55 px-3 py-2 text-sm leading-6 text-text-main placeholder:text-text-dim"
          placeholder="输入消息..."
          rows="1"
          :disabled="sending"
          @keydown.enter.exact.prevent="send"
          @keydown.enter.shift.exact="inputText += '\n'"
        />
        <button
          type="submit"
          class="retro-button retro-focus inline-flex h-10 items-center gap-2 px-4 font-mono text-xs"
          :disabled="sending || !inputText.trim()"
        >
          <Send class="h-3.5 w-3.5" aria-hidden="true" />
          发送
        </button>
      </form>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref, nextTick, computed, onMounted } from "vue"
import { Bot, RefreshCw, Send } from "lucide-vue-next"
import type { ConversationMessageRecord } from "@tsian/contracts"
import {
  runAssistantChat,
  getPlatformActiveGameCard,
  waitForPlatformHostReady,
} from "../platform-host"

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

const messages = ref<ChatMessage[]>([])
const inputText = ref("")
const sending = ref(false)
const errorMessage = ref("")
const mode = ref<"local" | "card">("local")
const cardName = ref("")
const cardAssistantAgentId = ref<string | null>(null)
const messageListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)

const cardTitle = computed(() => cardName.value || "未加载游戏卡")
const hasCardAssistant = computed(() => Boolean(cardAssistantAgentId.value))

async function refresh() {
  errorMessage.value = ""
  await waitForPlatformHostReady()
  const card = await getPlatformActiveGameCard()
  if (card) {
    cardName.value = card.manifest.name
    cardAssistantAgentId.value = card.manifest.assistant?.agentId ?? null
  } else {
    cardName.value = ""
    cardAssistantAgentId.value = null
  }
}

async function send() {
  const content = inputText.value.trim()
  if (!content || sending.value) {
    return
  }

  errorMessage.value = ""
  messages.value.push({ role: "user", content })
  inputText.value = ""
  sending.value = true

  await scrollToBottom()

  const history: ConversationMessageRecord[] = messages.value
    .slice(0, -1)
    .map((msg) => ({ role: msg.role, content: msg.content }))

  try {
    const result = await runAssistantChat({
      message: content,
      history,
      mode: mode.value,
    })
    messages.value.push({ role: "assistant", content: result.replyText })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errorMessage.value = message
  } finally {
    sending.value = false
    await scrollToBottom()
    nextTick(() => inputRef.value?.focus())
  }
}

async function scrollToBottom() {
  await nextTick()
  if (messageListRef.value) {
    messageListRef.value.scrollTop = messageListRef.value.scrollHeight
  }
}

onMounted(async () => {
  await refresh()
  nextTick(() => inputRef.value?.focus())
})
</script>
