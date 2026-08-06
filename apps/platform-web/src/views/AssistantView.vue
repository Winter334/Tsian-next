<template>
  <section class="assistant-view relative h-full min-h-0 overflow-hidden bg-[#24251f]">
    <div class="assistant-layout">
      <AssistantSessionSidebar
        class="assistant-session-sidebar"
        :class="{ 'assistant-session-sidebar--open': sessionDrawerOpen }"
        :sessions="sessions"
        :active-session-id="activeSessionId"
        :running-session-ids="runningSessionIds"
        :session-creating="sessionCreating"
        :session-renaming="sessionRenaming"
        :session-deleting="sessionDeleting"
        @create="handleCreateSessionFromSidebar"
        @select="handleSelectSessionFromSidebar"
        @start-rename="handleStartRename"
        @delete="handleDeleteSessionById"
        @close="sessionDrawerOpen = false"
      />

    <button
      v-if="sessionDrawerOpen"
      type="button"
      class="assistant-session-backdrop"
      aria-label="关闭会话列表"
      @click="sessionDrawerOpen = false"
    />

    <!-- Chat panel -->
    <section class="assistant-chat-panel grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <AssistantChatHeader
        :card-title="cardTitle"
        :provider-presets="providerPresets"
        :assistant-provider-preset-id="assistantProviderPresetId"
        :assistant-model-id="assistantModelId"
        :assistant-models="assistantModels"
        :context-used="contextUsed"
        :context-total="contextTotal"
        :running-session-count="runningSessionIds.size"
        :config-button-title="configButtonTitle"
        @open-sessions="sessionDrawerOpen = true"
        @preset-change="handlePresetChange"
        @model-change="handleModelChange"
        @open-config="showAssistantConfig = true"
      />

      <main
        class="relative min-h-0 overflow-hidden"
        :class="{ 'ring-2 ring-neon/40': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop="handleDrop"
      >
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
        <AssistantEmptyState
          v-else-if="messages.length === 0"
          :has-active-card="hasActiveCard"
          :suggestions="suggestions"
          @suggest="sendSuggestion"
          @open-library="goToLibrary"
          @open-market="goToMarket"
        />

        <!-- Conversation -->
        <div
          v-else
          ref="messageListRef"
          class="h-full overflow-auto"
          @scroll="handleScroll"
        >
          <AssistantMessageList
            :messages="messages"
            :sending="sending"
            :active-ask="activeAsk"
            :copied-index="copiedIndex"
            :editing-index="editingIndex"
            @copy-message="handleCopyMessage"
            @edit-user-message="handleEditUserMessage"
          />
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

      <AssistantComposer
        ref="composerRef"
        v-model:input-text="inputText"
        :active-ask="activeAsk"
        :pending-attachments="pendingAttachments"
        :sending="sending"
        :input-locked="inputLocked"
        :input-placeholder="inputPlaceholder"
        :accepted-file-types="ACCEPTED_FILE_TYPES"
        @send="send"
        @stop-generating="stopGenerating"
        @remove-attachment="removePendingAttachment"
        @files-selected="addFilesAsAttachments"
        @image-pasted="(file) => addFilesAsAttachments([file])"
        @answer-ask="answerAsk"
        @submit-custom-ask="submitCustomAsk"
        @cancel-ask="cancelAsk"
      />
    </section>
    </div>

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
import { ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { ChevronDown } from "lucide-vue-next"
import AssistantConfigPanel from "@/components/assistant/AssistantConfigPanel.vue"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import {
  ASSISTANT_ACCEPTED_FILE_TYPES,
  useAssistantController,
} from "@/controllers/assistant/use-assistant-controller"
import AssistantChatHeader from "./assistant/AssistantChatHeader.vue"
import AssistantComposer from "./assistant/AssistantComposer.vue"
import AssistantEmptyState from "./assistant/AssistantEmptyState.vue"
import AssistantMessageList from "./assistant/AssistantMessageList.vue"
import AssistantSessionSidebar from "./assistant/AssistantSessionSidebar.vue"
import { useAssistantScroll } from "./assistant/useAssistantScroll"
import type { AssistantSuggestion } from "./assistant/types"

const suggestions: AssistantSuggestion[] = [
  { label: "这张卡有哪些 Agent？", message: "这张游戏卡里有哪些 Agent？分别负责什么？" },
  { label: "怎么编辑游戏卡？", message: "我想编辑当前游戏卡，应该从哪里开始？" },
  { label: "介绍游戏卡结构", message: "介绍一下当前游戏卡的内容结构。" },
]

const route = useRoute()
const router = useRouter()
const composerRef = ref<InstanceType<typeof AssistantComposer> | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const showAssistantConfig = ref(false)
const sessionDrawerOpen = ref(false)
const dragOver = ref(false)

const controller = useAssistantController({
  scrollToBottom(force) {
    return scrollToBottom(force)
  },
  restoreScrollTop(target) {
    restoreScrollTop(target)
  },
  applySessionScrollTop(target) {
    return applySessionScrollTop(target)
  },
  focusInput() {
    composerRef.value?.focusInput()
  },
  focusRenameInput() {
    renameInputRef.value?.focus()
  },
  resetInputHeight() {
    composerRef.value?.resetInputHeight()
  },
  autoGrowInput() {
    composerRef.value?.autoGrow()
  },
  onTimelineUpdate() {
    maybeScrollToBottom()
  },
})

const {
  sessions,
  activeSessionId,
  messages,
  runningSessionIds,
  activeAsk,
  sending,
  errorMessage,
  cardTitle,
  hasActiveCard,
  inputLocked,
  inputPlaceholder,
  copiedIndex,
  editingIndex,
  sessionCreating,
  sessionRenaming,
  sessionDeleting,
  renaming,
  providerPresets,
  assistantProviderPresetId,
  assistantModelId,
  assistantModels,
  contextUsed,
  contextTotal,
  configButtonTitle,
  inputText,
  pendingAttachments,
  selectSession,
  createSession,
  startRename: handleStartRename,
  closeRename,
  confirmRename: handleConfirmRename,
  deleteSession: handleDeleteSessionById,
  addFilesAsAttachments,
  removePendingAttachment,
  send,
  stopGenerating,
  answerAsk,
  submitCustomAsk,
  cancelAsk,
  copyMessage: handleCopyMessage,
  editUserMessage: handleEditUserMessage,
  restoreSessionScrollTop,
  loadProviderPreset,
  changeProviderPreset: handlePresetChange,
  changeModel: handleModelChange,
} = controller

const {
  messageListRef,
  showJumpToBottom,
  handleScroll,
  scrollToBottom,
  maybeScrollToBottom,
  restoreScrollTop,
  applySessionScrollTop,
} = useAssistantScroll(activeSessionId)

const ACCEPTED_FILE_TYPES = ASSISTANT_ACCEPTED_FILE_TYPES

async function handleSelectSessionFromSidebar(id: string): Promise<void> {
  await selectSession(id)
  sessionDrawerOpen.value = false
}

async function handleCreateSessionFromSidebar(): Promise<void> {
  await createSession()
  sessionDrawerOpen.value = false
}

function handleDrop(event: DragEvent): void {
  event.preventDefault()
  dragOver.value = false
  if (event.dataTransfer?.files) addFilesAsAttachments(Array.from(event.dataTransfer.files))
}

function sendSuggestion(message: string): void {
  if (inputLocked.value) return
  inputText.value = message
  void send()
}

function goToLibrary(): void {
  void router.push("/library")
}

function goToMarket(): void {
  void router.push("/market")
}

async function handleAssistantConfigChange(): Promise<void> {
  await loadProviderPreset()
}

const ASSISTANT_ROUTE_PATH = "/assistant"
watch(
  () => route.path,
  (to, from) => {
    const isAssistant = (routePath: string) =>
      routePath === ASSISTANT_ROUTE_PATH || routePath.startsWith(`${ASSISTANT_ROUTE_PATH}/`)
    if (isAssistant(to) && !isAssistant(from)) void restoreSessionScrollTop()
  },
)
</script>

<style scoped>
.assistant-view {
  container-type: inline-size;
}

.assistant-layout {
  position: relative;
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-columns: minmax(0, 1fr);
  overflow: hidden;
}

.assistant-session-sidebar {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 20;
  width: min(280px, calc(100% - 2.5rem));
  pointer-events: none;
  visibility: hidden;
  transform: translateX(-100%);
  transition: transform 0.16s ease-out, visibility 0s linear 0.16s;
}

.assistant-session-sidebar--open {
  pointer-events: auto;
  visibility: visible;
  transform: translateX(0);
  transition-delay: 0s;
}

.assistant-session-backdrop {
  position: absolute;
  inset: 0;
  z-index: 10;
  background: rgba(0, 0, 0, 0.5);
}

.assistant-chat-panel {
  min-width: 0;
}

@container (min-width: 720px) {
  .assistant-layout {
    grid-template-columns: 220px minmax(0, 1fr);
  }

  .assistant-session-sidebar {
    position: relative;
    z-index: auto;
    width: auto;
    pointer-events: auto;
    visibility: visible;
    transform: none;
    transition: none;
  }

  .assistant-session-backdrop {
    display: none;
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
