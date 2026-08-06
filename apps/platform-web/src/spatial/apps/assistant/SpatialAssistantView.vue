<template>
  <section class="spatial-app spatial-assistant" aria-label="桌面助手">
    <aside class="spatial-assistant__sessions" :class="{ 'spatial-assistant__sessions--open': sessionDrawerOpen }" aria-label="会话列表">
      <header>
        <div><span class="spatial-app__eyebrow">SESSIONS</span><strong>{{ sessions.length }}</strong></div>
        <SpatialActionButton icon-only aria-label="新建会话" :disabled="sessionCreating" @click="createAndCloseDrawer">
          <template #icon><LoaderCircle v-if="sessionCreating" class="spatial-assistant-spin" /><Plus v-else /></template>
        </SpatialActionButton>
      </header>
      <div class="spatial-app__scroll spatial-assistant__session-list">
        <article v-for="session in sessions" :key="session.id" :class="{ 'is-active': session.id === activeSessionId }">
          <button type="button" class="spatial-assistant__session-main" @click="selectAndCloseDrawer(session.id)">
            <span>
              <LoaderCircle v-if="runningSessionIds.has(session.id)" class="spatial-assistant-spin" aria-label="生成中" />
              <strong>{{ session.title }}</strong>
            </span>
            <small>{{ formatSessionTime(session.updatedAt) }}<em v-if="runningSessionIds.has(session.id) && session.id !== activeSessionId"> · 后台生成中</em></small>
          </button>
          <div class="spatial-assistant__session-actions">
            <SpatialActionButton icon-only aria-label="重命名会话" :disabled="sessionRenaming" @click="startRename(session.id)"><template #icon><Pencil /></template></SpatialActionButton>
            <SpatialActionButton icon-only variant="danger" aria-label="删除会话" :disabled="sessionDeleting" @click="deleteSession(session.id)"><template #icon><Trash2 /></template></SpatialActionButton>
          </div>
        </article>
        <div v-if="sessions.length === 0 && !sessionCreating" class="spatial-app__empty">暂无会话</div>
      </div>
    </aside>

    <button v-if="sessionDrawerOpen" type="button" class="spatial-assistant__drawer-shield" aria-label="关闭会话列表" @click="sessionDrawerOpen = false" />

    <section class="spatial-assistant__chat">
      <header class="spatial-app__header spatial-assistant__header">
        <SpatialActionButton icon-only class="spatial-assistant__session-trigger" aria-label="打开会话列表" @click="sessionDrawerOpen = true"><template #icon><PanelLeft /></template></SpatialActionButton>
        <div class="spatial-app__identity">
          <span class="spatial-app__eyebrow">DESKTOP ASSISTANT · {{ runningSessionIds.size ? `${runningSessionIds.size} RUNNING` : "READY" }}</span>
          <h1>{{ cardTitle }}</h1>
        </div>
        <div class="spatial-assistant__model-controls">
          <SpatialSelect :model-value="assistantProviderPresetId || '__platform_default__'" :options="providerOptions" aria-label="助手服务商" :disabled="runningSessionIds.size > 0" @change="changeProviderPreset" />
          <SpatialSelect :model-value="assistantModelId || '__preset_default__'" :options="modelOptions" aria-label="助手模型" :disabled="runningSessionIds.size > 0 || assistantModels.length === 0" @change="changeModel" />
          <div class="spatial-assistant__context" :title="contextLabel">
            <span :style="{ width: `${contextPercent}%` }" />
            <small>{{ contextLabel }}</small>
          </div>
          <SpatialActionButton icon-only :aria-label="configButtonTitle" @click="openConfig"><template #icon><Settings2 /></template></SpatialActionButton>
        </div>
      </header>

      <main
        class="spatial-assistant__conversation"
        :class="{ 'is-dragging': dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop="handleDrop"
      >
        <div v-if="errorMessage" class="spatial-assistant__center">
          <div class="spatial-app__banner spatial-app__banner--error" role="alert">
            <strong>助手不可用</strong><span>{{ errorMessage }}</span>
            <SpatialActionButton @click="errorMessage = ''">关闭</SpatialActionButton>
          </div>
        </div>
        <div v-else-if="messages.length === 0" class="spatial-assistant__empty-state">
          <Bot aria-hidden="true" />
          <div><span class="spatial-app__eyebrow">START A CONVERSATION</span><h2>{{ hasActiveCard ? "需要我做什么？" : "请先加载游戏卡" }}</h2></div>
          <p>{{ hasActiveCard ? "询问游戏卡结构、Agent 能力，或让我协助维护 Workspace。" : "桌面助手需要当前游戏卡作为工作上下文。" }}</p>
          <div v-if="hasActiveCard" class="spatial-assistant__suggestions">
            <button v-for="suggestion in suggestions" :key="suggestion.label" type="button" @click="sendSuggestion(suggestion.message)">{{ suggestion.label }}</button>
          </div>
          <div v-else class="spatial-app__actions">
            <SpatialActionButton variant="primary" @click="goToLibrary">去我的应用</SpatialActionButton>
            <SpatialActionButton @click="goToMarket">去创意工坊</SpatialActionButton>
          </div>
        </div>
        <div v-else ref="messageListRef" class="spatial-app__scroll spatial-assistant__message-scroll" @scroll="handleScroll">
          <SpatialAssistantMessageList
            :messages="messages"
            :sending="sending"
            :active-ask="activeAsk"
            :copied-index="copiedIndex"
            @copy-message="copyMessage"
            @edit-user-message="editUserMessage"
          />
        </div>
        <SpatialActionButton v-if="showJumpToBottom" icon-only class="spatial-assistant__jump" aria-label="跳到最新消息" @click="scrollToBottom(true)"><template #icon><ArrowDown /></template></SpatialActionButton>
      </main>

      <footer class="spatial-assistant__composer">
        <section v-if="activeAsk" class="spatial-assistant__ask" aria-live="polite">
          <div><span class="spatial-app__eyebrow">ASSISTANT QUESTION</span><p>{{ activeAsk.question }}</p></div>
          <div v-if="activeAsk.options?.length" class="spatial-assistant__ask-options">
            <button v-for="option in activeAsk.options" :key="option" type="button" @click="answerAsk(activeAsk.requestId, option)">{{ option }}</button>
          </div>
          <form v-if="activeAsk.allowCustom" class="spatial-assistant__ask-custom" @submit.prevent="submitAsk">
            <input ref="askInputRef" v-model="askDraft" class="spatial-app__input" aria-label="自定义回答" placeholder="输入自定义回答…">
            <SpatialActionButton type="submit" variant="primary" :disabled="!askDraft.trim()"><template #icon><Send /></template>回答</SpatialActionButton>
          </form>
          <SpatialActionButton variant="danger" @click="cancelAsk(activeAsk.requestId)">取消提问</SpatialActionButton>
        </section>
        <template v-else>
          <div v-if="pendingAttachments.length" class="spatial-assistant__pending">
            <article v-for="(pending, index) in pendingAttachments" :key="pending.ref.path">
              <img v-if="pending.previewUrl" :src="pending.previewUrl" :alt="pending.ref.name">
              <FileText v-else aria-hidden="true" />
              <span><strong>{{ pending.ref.name }}</strong><small>{{ formatFileSize(pending.ref.size) }}</small></span>
              <SpatialActionButton icon-only :aria-label="`移除 ${pending.ref.name}`" @click="removePendingAttachment(index)"><template #icon><X /></template></SpatialActionButton>
            </article>
          </div>
          <div class="spatial-assistant__input-row">
            <input ref="fileInputRef" class="spatial-assistant__file-input" type="file" multiple :accept="acceptedFileTypes" :disabled="inputLocked" @change="handleFilesSelected">
            <SpatialActionButton icon-only aria-label="添加附件" :disabled="inputLocked || sending" @click="fileInputRef?.click()"><template #icon><Paperclip /></template></SpatialActionButton>
            <textarea
              ref="inputRef"
              v-model="inputText"
              rows="1"
              :placeholder="inputPlaceholder"
              :disabled="inputLocked"
              @input="autoGrowInput"
              @keydown="handleComposerKeydown"
              @paste="handlePaste"
            />
            <SpatialActionButton v-if="sending" variant="danger" aria-label="停止生成" @click="stopGenerating"><template #icon><Square /></template>停止</SpatialActionButton>
            <SpatialActionButton v-else variant="primary" aria-label="发送消息" :disabled="inputLocked || (!inputText.trim() && pendingAttachments.length === 0)" @click="send"><template #icon><Send /></template>发送</SpatialActionButton>
          </div>
        </template>
      </footer>
    </section>

    <div v-if="renaming" class="spatial-assistant__modal-backdrop" @click.self="closeRename">
      <section class="spatial-assistant__rename" role="dialog" aria-modal="true" aria-label="重命名会话">
        <span class="spatial-app__eyebrow">RENAME SESSION</span>
        <input ref="renameInputRef" v-model="renaming" class="spatial-app__input" @keydown.enter.prevent="confirmRename" @keydown.esc.prevent="closeRename">
        <div class="spatial-app__actions"><SpatialActionButton @click="closeRename">取消</SpatialActionButton><SpatialActionButton variant="primary" :disabled="sessionRenaming" @click="confirmRename">确认</SpatialActionButton></div>
      </section>
    </div>

  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import { ArrowDown, Bot, FileText, LoaderCircle, PanelLeft, Paperclip, Pencil, Plus, Send, Settings2, Square, Trash2, X } from "lucide-vue-next"
import {
  ASSISTANT_ACCEPTED_FILE_TYPES,
  useAssistantController,
} from "@/controllers/assistant/use-assistant-controller"
import { formatFileSize, formatSessionTime } from "@/views/assistant/format"
import { useAssistantScroll } from "@/views/assistant/useAssistantScroll"
import type { AssistantSuggestion } from "@/views/assistant/types"
import SpatialActionButton from "../primitives/SpatialActionButton.vue"
import SpatialSelect from "../primitives/SpatialSelect.vue"
import "../spatial-apps.css"
import SpatialAssistantMessageList from "./SpatialAssistantMessageList.vue"
import { openSpatialAssistantConfig } from "./spatial-assistant-config-surface"

const suggestions: AssistantSuggestion[] = [
  { label: "这张卡有哪些 Agent？", message: "这张游戏卡里有哪些 Agent？分别负责什么？" },
  { label: "怎么编辑游戏卡？", message: "我想编辑当前游戏卡，应该从哪里开始？" },
  { label: "介绍游戏卡结构", message: "介绍一下当前游戏卡的内容结构。" },
]
const route = useRoute()
const router = useRouter()
const inputRef = ref<HTMLTextAreaElement | null>(null)
const askInputRef = ref<HTMLInputElement | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const sessionDrawerOpen = ref(false)
const dragOver = ref(false)
const askDraft = ref("")

const controller = useAssistantController({
  scrollToBottom: (force) => scrollToBottom(force),
  restoreScrollTop: (target) => restoreScrollTop(target),
  applySessionScrollTop: (target) => applySessionScrollTop(target),
  focusInput: () => inputRef.value?.focus(),
  focusRenameInput: () => renameInputRef.value?.focus(),
  resetInputHeight: () => resetInputHeight(),
  autoGrowInput: () => autoGrowInput(),
  onTimelineUpdate: () => maybeScrollToBottom(),
})
const {
  sessions, activeSessionId, messages, runningSessionIds, activeAsk, sending,
  errorMessage, cardTitle, hasActiveCard, inputLocked, inputPlaceholder,
  copiedIndex, sessionCreating, sessionRenaming, sessionDeleting, renaming,
  providerPresets, assistantProviderPresetId, assistantModelId, assistantModels,
  contextUsed, contextTotal, configButtonTitle, inputText, pendingAttachments,
  selectSession, createSession, startRename, closeRename, confirmRename, deleteSession,
  addFilesAsAttachments, removePendingAttachment, send, stopGenerating, answerAsk,
  submitCustomAsk, cancelAsk, copyMessage, editUserMessage, restoreSessionScrollTop,
  loadProviderPreset, changeProviderPreset, changeModel,
} = controller
const {
  messageListRef, showJumpToBottom, handleScroll, scrollToBottom,
  maybeScrollToBottom, restoreScrollTop, applySessionScrollTop,
} = useAssistantScroll(activeSessionId)

const acceptedFileTypes = ASSISTANT_ACCEPTED_FILE_TYPES
const providerOptions = computed(() => [
  { value: "__platform_default__", label: "平台默认服务商" },
  ...providerPresets.value.map((preset) => ({ value: preset.id, label: preset.name })),
])
const modelOptions = computed(() => [
  { value: "__preset_default__", label: "预设默认模型" },
  ...assistantModels.value.map((model) => ({ value: model.id, label: model.label })),
])
const contextPercent = computed(() => contextTotal.value > 0
  ? Math.min(100, Math.round(contextUsed.value / contextTotal.value * 100))
  : 0)
const contextLabel = computed(() => contextTotal.value > 0
  ? `${contextPercent.value}% context`
  : "context --")

function resetInputHeight(): void {
  if (inputRef.value) inputRef.value.style.height = "auto"
}
function autoGrowInput(): void {
  const input = inputRef.value
  if (!input) return
  input.style.height = "auto"
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`
}
function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
  event.preventDefault()
  void send()
}
function handleDrop(event: DragEvent): void {
  event.preventDefault()
  dragOver.value = false
  if (event.dataTransfer?.files) addFilesAsAttachments(Array.from(event.dataTransfer.files))
}
function handleFilesSelected(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.files) addFilesAsAttachments(Array.from(target.files))
  target.value = ""
}
function handlePaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"))
  if (files.length) addFilesAsAttachments(files)
}
function sendSuggestion(message: string): void {
  if (inputLocked.value) return
  inputText.value = message
  void send()
}
function submitAsk(): void {
  if (!activeAsk.value) return
  submitCustomAsk(activeAsk.value.requestId, askDraft.value)
  askDraft.value = ""
}
async function selectAndCloseDrawer(id: string): Promise<void> {
  await selectSession(id)
  sessionDrawerOpen.value = false
}
async function createAndCloseDrawer(): Promise<void> {
  await createSession()
  sessionDrawerOpen.value = false
}
function goToLibrary(): void { void router.push("/library") }
function goToMarket(): void { void router.push("/market") }
function openConfig(): void {
  openSpatialAssistantConfig({ onChange: () => void loadProviderPreset() })
}

watch(() => activeAsk.value?.requestId, () => {
  askDraft.value = ""
  if (activeAsk.value?.allowCustom) nextTick(() => askInputRef.value?.focus())
})
watch(() => route.path, (to, from) => {
  const isAssistant = (path: string) => path === "/assistant" || path.startsWith("/assistant/")
  if (isAssistant(to) && !isAssistant(from)) void restoreSessionScrollTop()
})
</script>

<style scoped>
.spatial-assistant { position: relative; grid-template-columns: 188px minmax(0, 1fr); }
.spatial-assistant__sessions { display: grid; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr); border-right: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface-muted); }
.spatial-assistant__sessions > header { display: flex; min-height: 54px; padding: 9px; align-items: center; justify-content: space-between; gap: 8px; border-bottom: 1px solid var(--spatial-app-border); }
.spatial-assistant__sessions > header > div { display: flex; align-items: center; gap: 7px; }
.spatial-assistant__session-list { padding: 5px; }
.spatial-assistant__session-list article { display: grid; margin-bottom: 4px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border-left: 2px solid transparent; }
.spatial-assistant__session-list article:hover, .spatial-assistant__session-list article.is-active { background: var(--spatial-app-surface-strong); }
.spatial-assistant__session-list article.is-active { border-left-color: var(--spatial-window-accent); }
.spatial-assistant__session-main { display: grid; min-width: 0; padding: 8px 7px; gap: 3px; border: 0; color: inherit; background: transparent; text-align: left; }
.spatial-assistant__session-main span { display: flex; min-width: 0; align-items: center; gap: 5px; }
.spatial-assistant__session-main span svg { width: 11px; height: 11px; flex: 0 0 11px; }
.spatial-assistant__session-main strong { overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.spatial-assistant__session-main small { color: var(--spatial-app-muted); font: 8px "JetBrains Mono", monospace; }
.spatial-assistant__session-main em { color: var(--spatial-window-accent); font-style: normal; }
.spatial-assistant__session-actions { display: flex; padding-right: 4px; gap: 3px; opacity: 0; }
.spatial-assistant__session-list article:hover .spatial-assistant__session-actions, .spatial-assistant__session-actions:focus-within, .spatial-assistant__session-list article.is-active .spatial-assistant__session-actions { opacity: 1; }
.spatial-assistant__session-actions :deep(.spatial-action-button) { width: 26px; min-height: 26px; }
.spatial-assistant__chat { display: grid; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; }
.spatial-assistant__header { gap: 9px; }
.spatial-assistant__session-trigger { display: none; }
.spatial-assistant__model-controls { display: flex; min-width: 0; align-items: center; justify-content: flex-end; gap: 6px; }
.spatial-assistant__model-controls .spatial-select { width: 142px; }
.spatial-assistant__context { position: relative; display: grid; width: 82px; height: 30px; padding: 0 6px; align-items: center; overflow: hidden; border: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface); }
.spatial-assistant__context > span { position: absolute; inset: 0 auto 0 0; background: var(--spatial-app-accent-soft); }
.spatial-assistant__context small { position: relative; overflow: hidden; color: var(--spatial-app-muted); font: 8px "JetBrains Mono", monospace; text-overflow: ellipsis; white-space: nowrap; }
.spatial-assistant__conversation { position: relative; min-width: 0; min-height: 0; overflow: hidden; }
.spatial-assistant__conversation.is-dragging { box-shadow: inset 0 0 0 2px var(--spatial-window-accent); }
.spatial-assistant__message-scroll { height: 100%; }
.spatial-assistant__center, .spatial-assistant__empty-state { display: grid; height: 100%; padding: 20px; place-content: center; justify-items: center; text-align: center; }
.spatial-assistant__center > div { max-width: 430px; }
.spatial-assistant__empty-state { gap: 10px; }
.spatial-assistant__empty-state > svg { width: 36px; height: 36px; color: var(--spatial-window-accent); }
.spatial-assistant__empty-state h2 { margin: 3px 0 0; font-size: 18px; }
.spatial-assistant__empty-state p { max-width: 460px; margin: 0; color: var(--spatial-app-muted); font-size: 10px; line-height: 1.6; }
.spatial-assistant__suggestions { display: flex; max-width: 520px; flex-wrap: wrap; justify-content: center; gap: 6px; }
.spatial-assistant__suggestions button, .spatial-assistant__ask-options button { min-height: 31px; padding: 6px 9px; border: 1px solid var(--spatial-app-border-strong); color: var(--spatial-window-ink); background: var(--spatial-app-surface-muted); font-size: 9px; }
.spatial-assistant__jump { position: absolute; z-index: 4; bottom: 10px; left: 50%; translate: -50% 0; }
.spatial-assistant__composer { display: grid; padding: 9px 11px; gap: 7px; border-top: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface-muted); }
.spatial-assistant__input-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: end; gap: 7px; }
.spatial-assistant__input-row textarea { width: 100%; min-height: 34px; max-height: 150px; padding: 8px 9px; overflow-y: auto; resize: none; scrollbar-width: none; border: 1px solid var(--spatial-app-border-strong); border-radius: 0; outline: 0; color: var(--spatial-window-ink); background: var(--spatial-app-surface); font-size: 11px; line-height: 1.55; }
.spatial-assistant__input-row textarea::-webkit-scrollbar { display: none; width: 0; height: 0; }
.spatial-assistant__file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); }
.spatial-assistant__pending { display: flex; flex-wrap: wrap; gap: 6px; }
.spatial-assistant__pending article { display: grid; min-width: 150px; max-width: 240px; padding: 5px; align-items: center; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 6px; border: 1px solid var(--spatial-app-border); background: var(--spatial-app-surface); }
.spatial-assistant__pending article > img, .spatial-assistant__pending article > svg { width: 30px; height: 30px; object-fit: cover; }
.spatial-assistant__pending article > span { display: grid; min-width: 0; }
.spatial-assistant__pending strong, .spatial-assistant__pending small { overflow: hidden; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.spatial-assistant__pending small { color: var(--spatial-app-muted); }
.spatial-assistant__ask { display: grid; gap: 8px; }
.spatial-assistant__ask > div:first-child { display: grid; gap: 3px; }
.spatial-assistant__ask p { margin: 0; font-size: 11px; line-height: 1.55; }
.spatial-assistant__ask-options { display: flex; flex-wrap: wrap; gap: 6px; }
.spatial-assistant__ask-custom { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; }
.spatial-assistant__modal-backdrop, .spatial-assistant__drawer-shield { position: absolute; z-index: 50; inset: 0; background: rgb(15 16 14 / 62%); }
.spatial-assistant__modal-backdrop { display: grid; padding: 14px; place-items: center; }
.spatial-assistant__rename { display: grid; width: min(360px, 100%); padding: 13px; gap: 10px; border: 1px solid var(--spatial-app-border-strong); background: var(--spatial-window-frame); }
.spatial-assistant__rename .spatial-app__actions { justify-content: flex-end; }
.spatial-assistant__drawer-shield { display: none; z-index: 28; border: 0; }
.spatial-assistant-spin { animation: spatial-assistant-view-spin 900ms linear infinite; }
@keyframes spatial-assistant-view-spin { to { rotate: 360deg; } }
@container (max-width: 760px) {
  .spatial-assistant { grid-template-columns: 1fr; }
  .spatial-assistant__sessions { position: absolute; z-index: 30; inset: 0 auto 0 0; width: min(260px, 78%); display: none; border-right-color: var(--spatial-app-border-strong); }
  .spatial-assistant__sessions--open, .spatial-assistant__drawer-shield { display: grid; }
  .spatial-assistant__session-trigger { display: inline-grid; }
  .spatial-assistant__model-controls .spatial-select { width: 112px; }
  .spatial-assistant__context { display: none; }
}
@container (max-width: 560px) { .spatial-assistant__model-controls .spatial-select:first-of-type { display: none; } .spatial-assistant__header .spatial-app__eyebrow { display: none; } }
@media (prefers-reduced-motion: reduce) { .spatial-assistant-spin { animation: none; } }
</style>
