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
            :tool-group-collapsed-map="toolGroupCollapsedMap"
            @copy-message="handleCopyMessage"
            @edit-user-message="handleEditUserMessage"
            @update-tool-group-collapsed="(key, collapsed) => (toolGroupCollapsedMap[key] = collapsed)"
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
import { ref, reactive, nextTick, computed, watch, onBeforeUnmount, onMounted } from "vue"
import { useRoute, useRouter } from "vue-router"
import { ChevronDown } from "lucide-vue-next"
import type { ConversationMessageRecord } from "@tsian/contracts"
import FloatingWindow from "@/components/feedback/FloatingWindow.vue"
import AssistantConfigPanel from "@/components/assistant/AssistantConfigPanel.vue"
import { ACTIVE_CARD_CHANGED_EVENT, isActiveCardChangedEvent } from "@/lib/platform-events"
import { useAssistantTimeline, type ChatMessage, type AssistantTimelineNode } from "@/composables/useAssistantTimeline"
import { confirm } from "@/composables/useConfirm"
import {
  subscribeInteractionRequest,
  resolveInteractionRequest,
} from "../interaction-events"
import {
  runAssistantChat,
  getPlatformActiveGameCard,
  waitForPlatformHostReady,
  getLocalAssistantProviderPreset,
  updateLocalAssistantProviderPreset,
  updateLocalAssistantModel,
} from "../platform-host"
import {
  createAssistantSession,
  deleteAssistantSession,
  ensureAssistantSession,
  getActiveAssistantSessionId,
  getAssistantSessionMessages,
  listAssistantSessions,
  loadContextUsed,
  loadScrollTop,
  renameAssistantSession,
  saveAssistantSessionMessages,
  saveContextUsed,
  setActiveAssistantSessionId,
  type AssistantSessionSummary,
} from "../storage"
import {
  mapStoredMessagesToChat,
  chatToStoredMessages,
} from "./assistant-message-mappers"
import AssistantChatHeader from "./assistant/AssistantChatHeader.vue"
import AssistantComposer from "./assistant/AssistantComposer.vue"
import AssistantEmptyState from "./assistant/AssistantEmptyState.vue"
import AssistantMessageList from "./assistant/AssistantMessageList.vue"
import AssistantSessionSidebar from "./assistant/AssistantSessionSidebar.vue"
import { ACCEPTED_FILE_TYPES, useAssistantComposer } from "./assistant/useAssistantComposer"
import { useAssistantScroll } from "./assistant/useAssistantScroll"
import type { ActiveAskState, AssistantSuggestion, RecordAskInput } from "./assistant/types"

const suggestions: AssistantSuggestion[] = [
  { label: "这张卡有哪些 Agent？", message: "这张游戏卡里有哪些 Agent？分别负责什么？" },
  { label: "怎么编辑游戏卡？", message: "我想编辑当前游戏卡，应该从哪里开始？" },
  { label: "介绍游戏卡结构", message: "介绍一下当前游戏卡的内容结构。" },
]

/**
 * 按会话隔离的进行中 turn 状态。桌面助手支持切走会话时让 turn 在后台继续
 * 跑完(不中断),切回时把流式消息重新挂回 messages。每个 turn 持有自己专属的
 * assistantMsg/userMsg(reactive,被 send() push 进当时的 messages.value;切走后
 * 不在 messages.value 但仍被本 state 闭包持有,回调继续 mutate 不影响新会话)。
 * 不含 activeAsk——活跃提问统一存响应式 activeAskBySession(见下),供 computed
 * 与会话列表指示器可靠追踪;本 state 只存非响应式的控制句柄/消息引用。
 */
interface AssistantTurnState {
  sessionId: string
  controller: AbortController
  userMsg: ChatMessage
  assistantMsg: ChatMessage
  flush: () => void
  recordAsk: (input: RecordAskInput) => void
  finalize: () => void
  timeline: AssistantTimelineNode[]
}

// 按会话隔离的进行中 turn 注册表(普通 Map:含 AbortController,不可深 reactive)。
// 内容对象(userMsg/assistantMsg)是 reactive,但 Map 本身不响应式——运行态追踪
// 走下面的 runningSessionIds / activeAskBySession 两个响应式集合。
const assistantTurns = new Map<string, AssistantTurnState>()
// ask 请求路由:requestId → sessionId。host 的 onAskUserRequest 回调填充,
// 用于把全局 interaction-request 事件路由到正确的(可能是后台的)turn。
const askRequestSession = new Map<string, string>()
// 响应式:正在运行的会话 id 集合(含前台与后台 turn)。供 sending computed 与
// 会话列表"生成中"指示器可靠追踪——assistantTurns 是普通 Map 不响应式,UI 靠
// 本集合在 turn 起/止(add/delete)时触发更新。
const runningSessionIds = reactive(new Set<string>())
// 响应式:各会话的活跃 ask_user 提问(key=sessionId)。供 activeAsk computed
// 追踪——把提问状态从 turn state 抽出统一管理,避免普通 Map value 字段赋值
// 不触发更新的缺陷。answer/cancel 时 delete 本 Map,computed 自动反映。
const activeAskBySession = reactive(new Map<string, ActiveAskState>())

const sessions = ref<AssistantSessionSummary[]>([])
const activeSessionId = ref<string | null>(null)
const messages = ref<ChatMessage[]>([])
const {
  messageListRef,
  showJumpToBottom,
  handleScroll,
  scrollToBottom,
  maybeScrollToBottom,
  restoreScrollTop,
} = useAssistantScroll(activeSessionId)
const composerRef = ref<InstanceType<typeof AssistantComposer> | null>(null)
// sending 语义改为"当前显示会话是否有进行中 turn"(支持后台 turn:切走时当前会话
// 无 turn→sending false,footer 恢复可输入;切回有后台 turn 的会话→sending true)。
// 读响应式 runningSessionIds,turn 起/止时 add/delete 触发可靠更新。
const sending = computed(() =>
  activeSessionId.value ? runningSessionIds.has(activeSessionId.value) : false,
)
const errorMessage = ref("")
const cardName = ref("")
// 焦点切换滚动保持:窗口改用 CSS display:none(最小化)而非从 DOM 移除后,
// 切焦(非最小化)窗口常驻可见、scrollTop 天然保留,不再被浏览器异步重置.
// 仍把 scrollTop 持久化到会话(assistant-scroll-top:{id}),供硬刷新/重开
// 场景恢复;进入会话/获焦时单次兜底恢复(若极端情况下被重置为 0 则补回).
const route = useRoute()
const router = useRouter()
const ASSISTANT_ROUTE_PATH = "/assistant"
// 复制反馈:记下刚复制的消息索引,显示「已复制」勾,短暂后自动清除.
const copiedIndex = ref<number | null>(null)
// 编辑中:正在通过工具条编辑的消息索引(仅用于工具条透明度保持).
const editingIndex = ref<number | null>(null)
// ask_user 订阅的 unsubscribe 闭包（onMounted 注册、onBeforeUnmount 释放）。
let unsubscribeInteractionRequest: (() => void) | null = null
// 当前活跃提问:派生自当前显示会话(支持后台 turn 的 ask 路由)。
// read 响应式 activeAskBySession,answer/cancel 时 delete 本 Map 触发更新,
// footer 随之在提问态/普通输入态间切换。
const activeAsk = computed<ActiveAskState | null>(() =>
  activeSessionId.value
    ? activeAskBySession.get(activeSessionId.value) ?? null
    : null,
)
// 工具调用组的折叠状态（key = "msgIdx-segIdx", 每条消息的每个段独立）.
// tool 节点不再用自身 collapsed 字段（因为合并成组了），用这个 map 管理.
const toolGroupCollapsedMap = reactive<Record<string, boolean>>({})
const sessionCreating = ref(false)
const sessionRenaming = ref(false)
const sessionDeleting = ref(false)
const renaming = ref("")
const renamingSessionId = ref<string | null>(null)
const renameInputRef = ref<HTMLInputElement | null>(null)
const providerPresets = ref<Array<{ id: string; name: string }>>([])
const assistantProviderPresetId = ref("")
const assistantModelId = ref("")
const assistantModels = ref<Array<{ id: string; label: string; contextWindow: number | null }>>([])
// 上下文窗口可视化:used = 最后一轮 provider 返回的 input tokens;total = 当前模型 contextWindow.
// used 每轮回复后更新(不持久化,刷新归零);total 切模型时更新.
const contextUsed = ref(0)
const contextTotal = ref(0)
const showAssistantConfig = ref(false)
const sessionDrawerOpen = ref(false)

const cardTitle = computed(() => cardName.value || "未加载游戏卡")
const hasActiveCard = computed(() => Boolean(cardName.value))
const inputLocked = computed(() => !hasActiveCard.value)
const inputPlaceholder = computed(() =>
  inputLocked.value
    ? "请先加载游戏卡后再使用助手"
    : "输入消息，Enter 发送，Shift+Enter 换行",
)
const configButtonTitle = computed(() => {
  if (assistantProviderPresetId.value) {
    const name = providerPresets.value.find((p) => p.id === assistantProviderPresetId.value)?.name ?? "所选预设已失效"
    return `助手配置（服务商：${name}）`
  }
  return "助手配置（使用平台默认服务商）"
})
const {
  inputText,
  pendingAttachments,
  dragOver,
  addFilesAsAttachments,
  clearPendingAttachmentPreviews,
  removePendingAttachment,
} = useAssistantComposer({
  activeSessionId,
  inputLocked,
  setErrorMessage: (message) => {
    errorMessage.value = message
  },
})

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
  messages.value = mapStoredMessagesToChat(stored)
  await refreshSessions()

  // 恢复上下文环已用值(按会话持久化),避免刷新/重载归零.
  contextUsed.value = await loadContextUsed(session.id)

  // 刷新/关页面恢复:检测上次未完成回复的恢复点(localStorage),提示用户是否保留.
  // 恢复点只在有流式正文时写,且读后即清(一次性).确认则追加一条标记"已中断"的
  // assistant 消息并持久化;取消则丢弃.轻量兜底,不保证 100% 救回.
  const recovery = readRecoveryPoint(session.id)
  if (recovery) {
    clearRecoveryPoint(session.id)
    const keep = await confirm({
      title: "发现未完成的回复",
      message: `上次会话有未完成的回复（${new Date(recovery.ts).toLocaleString()}），是否保留到历史？`,
      confirmText: "保留",
      cancelText: "丢弃",
    })
    if (keep) {
      messages.value.push({
        role: "assistant",
        content: `${recovery.text}\n\n_（回复中断，已自动保留）_`,
      })
      await persistCurrentSession()
    }
  }

  await scrollToBottom()
}

async function handleSelectSessionFromSidebar(id: string) {
  await handleSelectSession(id)
  sessionDrawerOpen.value = false
}

async function handleCreateSessionFromSidebar() {
  await handleCreateSession()
  sessionDrawerOpen.value = false
}

async function handleSelectSession(id: string) {
  if (id === activeSessionId.value) {
    return
  }
  // 后台继续策略:切走会话时**不 abort** 当前 turn。它带着锁定的 sessionId
  // 继续在后台跑完,host 用该 sessionId 持久化;切回时重新挂回流式消息即可看到
  // 完整回复。这消除了旧设计"切走即 abort→回复被截断"的中断,也消除了
  // send() catch/finally 操作被切走的 messages.value 引发的竞态(误删新会话
  // 消息、持久化写错会话)。
  //
  // Optimistic UI update first: switch highlight immediately, then load the
  // target session's messages (one fast read). Persist the previous session in
  // the background so the click feels instant.
  const previousId = activeSessionId.value
  const previousMessages = chatToStoredMessages(messages.value)

  activeSessionId.value = id
  const stored = await getAssistantSessionMessages(id)
  let targetMessages = mapStoredMessagesToChat(stored)
  // 若目标会话有后台进行中 turn:存储里还没有本轮(turn 未结束,host 未写),
  // 把 turn 持有的 userMsg + assistantMsg 追加到 messages,让流式继续可见。
  // turn 的回调继续 mutate 同一对象引用,UI 自动更新(前台可见)。
  const targetTurn = assistantTurns.get(id)
  if (targetTurn) {
    targetMessages = [...targetMessages, targetTurn.userMsg, targetTurn.assistantMsg]
  }
  messages.value = targetMessages
  // 恢复目标会话的上下文环已用值.
  contextUsed.value = await loadContextUsed(id)
  await scrollToBottom()

  // Background persistence of the session we just left. Silent (touch=false):
  // merely selecting another session must not bump this one's sort order.
  // 若离开的会话有进行中 turn:跳过此处持久化——后台 turn 结束时 host 会用
  // 该 sessionId 写完整消息;这里写的是切走时刻的半截快照,会与 host 写入竞态
  // 且可能留下空 content 的 assistant 占位。无 turn 的会话才保存(用户可能编辑过)。
  void setActiveAssistantSessionId("local", id)
  if (previousId && previousId !== id && !assistantTurns.has(previousId)) {
    void saveAssistantSessionMessages("local", previousId, previousMessages, {
      touch: false,
    })
  }
}

async function handleCreateSession() {
  sessionCreating.value = true
  try {
    // Persist the current session in the background so creation feels instant.
    // 与 handleSelectSession 同理:前一会话若有后台 turn,跳过此处持久化——
    // 后台 turn 结束时 host 会写完整消息,这里写半截快照会与之竞态。
    const previousId = activeSessionId.value
    const previousMessages = chatToStoredMessages(messages.value)
    if (previousId && !assistantTurns.has(previousId)) {
      void saveAssistantSessionMessages("local", previousId, previousMessages, {
        touch: false,
      })
    }
    const session = await createAssistantSession("local")
    activeSessionId.value = session.id
    messages.value = []
    contextUsed.value = 0
    await refreshSessions()
    nextTick(() => composerRef.value?.focusInput())
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
    // 删除有后台 turn 的会话:先 abort 该 turn 并清注册表(防止后台 turn 结束时
    // 回写已删除的 sessionId)。host catch 路径 persistTurnFallback 会尝试写该
    // sessionId,但会话已删,saveAssistantSessionMessages 对不存在的 id 是 no-op
    // (或静默失败),不致脏数据。
    const turn = assistantTurns.get(id)
    if (turn) {
      const pendingAsk = activeAskBySession.get(id)
      if (pendingAsk) {
        askRequestSession.delete(pendingAsk.requestId)
        activeAskBySession.delete(id)
      }
      turn.controller.abort()
      assistantTurns.delete(id)
      runningSessionIds.delete(id)
    }
    await deleteAssistantSession("local", id)
    await refreshSessions()
    if (wasActive) {
      // The deleted session was active; pick the next one or create a fresh session.
      const nextId = await getActiveAssistantSessionId("local")
      if (nextId) {
        activeSessionId.value = nextId
        const stored = await getAssistantSessionMessages(nextId)
        let nextMessages = mapStoredMessagesToChat(stored)
        // 切到的会话若有后台 turn:挂回流式消息(与 handleSelectSession 同逻辑)。
        const nextTurn = assistantTurns.get(nextId)
        if (nextTurn) {
          nextMessages = [...nextMessages, nextTurn.userMsg, nextTurn.assistantMsg]
        }
        messages.value = nextMessages
        contextUsed.value = await loadContextUsed(nextId)
      } else {
        const session = await createAssistantSession("local")
        activeSessionId.value = session.id
        messages.value = []
        contextUsed.value = 0
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
  const toStore: ConversationMessageRecord[] = chatToStoredMessages(messages.value)
  await saveAssistantSessionMessages("local", activeSessionId.value, toStore)
  await refreshSessions()
}

// ── 附件处理 ──

/** 聊天面板 drop 处理. */
function handleDrop(event: DragEvent) {
  event.preventDefault()
  dragOver.value = false
  if (!event.dataTransfer?.files) return
  addFilesAsAttachments(Array.from(event.dataTransfer.files))
}

function sendSuggestion(message: string) {
  if (inputLocked.value) {
    return
  }
  inputText.value = message
  send()
}

function goToLibrary() {
  void router.push("/library")
}

function goToMarket() {
  void router.push("/market")
}

async function send() {
  const content = inputText.value.trim()
  const attachments = pendingAttachments.value.map((p) => p.ref)
  if ((!content && attachments.length === 0) || sending.value) {
    return
  }

  if (inputLocked.value) {
    errorMessage.value = "当前没有加载游戏卡。请先在我的应用中创建、导入或加载一张游戏卡。"
    return
  }

  errorMessage.value = ""
  // 释放待发附件的 previewUrl(已发送,不再需要缩略图)
  clearPendingAttachmentPreviews()

  // activeSessionId 由 loadActiveSession/ensureAssistantSession 保证非空;
  // guard 兜底边缘时序(组件未初始化完成就发消息),类型上收窄 string|null -> string.
  const sessionId = activeSessionId.value
  if (!sessionId) {
    return
  }

  // 本轮 user/assistant 消息存为独立 reactive 对象(非内联字面量),turn state
  // 持有它们的引用。切走会话后 messages.value 被换成新会话,但 turn 回调继续
  // mutate 这两个对象——它们已不在 messages.value,故不影响新会话;切回时
  // handleSelectSession 把同一对象引用重新挂回 messages.value,流式继续可见。
  const userMsg = reactive<ChatMessage>({
    role: "user",
    content,
    ...(attachments.length > 0 ? { attachments } : {}),
  })
  messages.value.push(userMsg)
  inputText.value = ""
  composerRef.value?.resetInputHeight()

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

  // 时间线式流式:native 模式按 round 顺序把过程事件(thought/tool)作为独立节点纵向平铺.
  // onDelta/onRoundEnd/onTool 的解析逻辑抽到 useAssistantTimeline composable(纯流式状态,
  // 不碰 DOM/持久化);onUpdate 只在 turn 属于当前显示会话时滚动(后台 turn 不扰动新会话视图).
  // text 模式无回调,content 在 reconcile 一次性赋值,timeline 为空——降级为现状.
  const { timeline, onDelta, onRoundEnd, onTool, recordAskNode, flushStreaming, finalize } = useAssistantTimeline(
    assistantMsg,
    () => {
      if (sessionId === activeSessionId.value) {
        maybeScrollToBottom()
      }
    },
  )

  // ③ Stop-generating: an AbortController for this turn, abortable from the UI.
  const controller = new AbortController()

  // 注册按会话隔离的 turn state:sending 由 computed 从 runningSessionIds 派生。
  const state: AssistantTurnState = {
    sessionId,
    controller,
    userMsg,
    assistantMsg,
    flush: flushStreaming,
    recordAsk: recordAskNode,
    finalize,
    timeline,
  }
  assistantTurns.set(sessionId, state)
  runningSessionIds.add(sessionId)

  let shouldPersistAfterFinalize = false

  try {
    const result = await runAssistantChat({
      message: content,
      ...(attachments.length > 0 ? { attachments } : {}),
      history,
      sessionId,
      onDelta,
      onRoundEnd,
      onTool,
      signal: controller.signal,
      // ask_user 路由:host emit 前回调,把 requestId 关联到本会话,
      // 供全局 interaction-request 订阅路由到正确的(可能后台的)turn。
      onAskUserRequest: (requestId) => {
        askRequestSession.set(requestId, sessionId)
      },
    })
    // reconcile:replyText 是最后一轮(final)的文本,以它为准(strip 工具块等).
    // native 模式 onRoundEnd(stop)已写入 content;text 模式无回调,这里首次赋值.
    // 对 state.assistantMsg 赋值:前台时它就是 messages.value 里的对象(UI 更新);
    // 后台时不在 messages.value,赋值无副作用,切回时从存储读 host 写入的完整结果。
    assistantMsg.content = result.replyText
    assistantMsg.streamingText = ""
    assistantMsg.streamingReasoning = ""
    // 更新上下文环:used = 最后一轮 provider 返回的 input tokens(当前上下文大小).
    // 仅在前台(本会话是当前显示会话)时更新环显示,避免后台 turn 窜改新会话的环。
    // 按会话持久化 used 始终执行,刷新/切走再切回恢复。
    if (result.usage?.input !== undefined) {
      void saveContextUsed(sessionId, result.usage.input)
      if (sessionId === activeSessionId.value) {
        contextUsed.value = result.usage.input
      }
    }
    // 消息 + context + timeline 已由 host(runAssistantChat)同步写入(含 toolCalls +
    // timeline).前端不再补写——runtime 层采集 thought/interim/tool 供 host 写入,
    // 消除双写竞态.catch 路径仍保留前端持久化作兜底(host catch 不写消息).
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError"
    const budgetExhausted = error instanceof Error && error.name === "ContextBudgetExhaustedError"
    const taskTimeout = error instanceof Error && error.name === "TaskTimeoutError"
    const taskStalled = error instanceof Error && error.name === "TaskCompressionStalledError"
    const isFront = sessionId === activeSessionId.value
    // flushStreaming 由 useAssistantTimeline 提供:把流式缓冲落盘(防中止/出错丢进度).
    if (aborted) {
      // Keep the partial text; mark it so the user knows it was cut short.
      flushStreaming()
      if (assistantMsg.content) {
        assistantMsg.content = `${assistantMsg.content}\n\n_（已停止）_`
      } else if (timeline.length === 0 && isFront) {
        // 前台且啥都没产出:弹出空占位(后台时 assistantMsg 不在 messages.value,无需 pop)。
        messages.value.pop()
      }
      shouldPersistAfterFinalize = true
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
      shouldPersistAfterFinalize = true
    } else {
      const message = error instanceof Error ? error.message : String(error)
      // 错误提示只在前台显示(用户在当前会话);后台 turn 失败不窜改新会话的错误栏,
      // 半截结果由持久化兜底,用户切回原会话可见。
      if (isFront) {
        errorMessage.value = message
      } else {
        console.error("[assistant] 后台 turn 失败", message)
      }
      flushStreaming()
      if (!assistantMsg.content && timeline.length === 0 && isFront) {
        messages.value.pop()
      }
      shouldPersistAfterFinalize = true
    }
  } finally {
    // 回合结束:折叠所有仍展开的 thought/tool 节点 + 清空流式缓冲(composable 负责).
    finalize()
    // 清理 ask 路由 + turn 注册表 + 响应式集合:sending/activeAsk computed 随之更新。
    const pendingAsk = activeAskBySession.get(sessionId)
    if (pendingAsk) {
      askRequestSession.delete(pendingAsk.requestId)
      activeAskBySession.delete(sessionId)
    }
    assistantTurns.delete(sessionId)
    runningSessionIds.delete(sessionId)
    // 持久化兜底(host catch 不写消息):前台用 persistCurrentSession(保留完整
    // attachments/toolCalls/timeline),后台用 history 快照兜底(保住本轮半截正文)。
    if (shouldPersistAfterFinalize) {
      if (sessionId === activeSessionId.value) {
        await persistCurrentSession()
      } else {
        await persistTurnFallback(state, history)
      }
    }
    // 滚动/聚焦只在前台(后台 turn 结束不扰动当前显示会话的视图)。
    if (sessionId === activeSessionId.value) {
      await scrollToBottom()
      nextTick(() => composerRef.value?.focusInput())
    }
  }
}

/**
 * 后台 turn 结束(abort/超时/错误)时的持久化兜底:用 send() 时刻的 history 快照 +
 * 本轮 user/assistant 构造完整消息写回 turn 的 sessionId。前台 turn 用
 * persistCurrentSession(更完整),本函数仅服务后台场景——host catch 不写消息,
 * 否则切回原会话会丢失本轮半截回复。history 快照不含历史 toolCalls/timeline,
 * 但保住本轮正文已足够(中止/错误的半截回复本就是临时保留)。
 */
async function persistTurnFallback(
  state: AssistantTurnState,
  history: ConversationMessageRecord[],
): Promise<void> {
  const fullMessages: ConversationMessageRecord[] = [
    ...history,
    {
      role: "user",
      content: state.userMsg.content,
      ...(state.userMsg.attachments && state.userMsg.attachments.length > 0
        ? { attachments: state.userMsg.attachments }
        : {}),
    },
  ]
  if (state.assistantMsg.content || state.timeline.length > 0) {
    fullMessages.push({ role: "assistant", content: state.assistantMsg.content })
  }
  await saveAssistantSessionMessages("local", state.sessionId, fullMessages, { touch: true })
  await refreshSessions()
}

function stopGenerating() {
  const sid = activeSessionId.value
  if (sid) {
    assistantTurns.get(sid)?.controller.abort()
  }
}

/**
 * ask_user 玩家回答处理：resolve 事件等待表（让助手 turn 拿到答案继续）+
 * 把 Q&A 作为只读记录写入 timeline（保留对话历史）+ 清该会话的活跃提问。
 * 活跃提问期间不在 timeline 渲染交互卡片（由 footer 承载），仅回答后落库。
 * UI 只渲染前台会话的 activeAsk（computed），故本组函数总针对前台 turn；
 * 但 requestId 可能来自后台 turn（路由表会指回后台 sessionId）——此时 resolve
 * 让后台 turn 继续，recordAsk 作用于后台 turn 的 timeline（切回时可见），前台
 * activeAsk 为 null 不受影响。断言兜底:requestId 路由不到 turn 说明已被清理,跳过。
 */
function answerAsk(requestId: string, answer: string): void {
  resolveInteractionRequest(requestId, answer)
  const ask = activeAsk.value
  const state = resolveAskTurn(requestId)
  if (ask && ask.requestId === requestId && state) {
    state.recordAsk({ ...ask, answer })
    activeAskBySession.delete(state.sessionId)
    askRequestSession.delete(requestId)
  }
}

function submitCustomAsk(requestId: string, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) return
  resolveInteractionRequest(requestId, trimmed)
  const ask = activeAsk.value
  const state = resolveAskTurn(requestId)
  if (ask && ask.requestId === requestId && state) {
    state.recordAsk({ ...ask, answer: trimmed })
    activeAskBySession.delete(state.sessionId)
    askRequestSession.delete(requestId)
  }
}

function cancelAsk(requestId: string): void {
  // cancelled=true 时 answer 传空串（AskUserResult.answer 必填），助手侧据此识别取消。
  resolveInteractionRequest(requestId, "", true)
  const ask = activeAsk.value
  const state = resolveAskTurn(requestId)
  if (ask && ask.requestId === requestId && state) {
    state.recordAsk({ ...ask, cancelled: true })
    activeAskBySession.delete(state.sessionId)
    askRequestSession.delete(requestId)
  }
}

/** 按 requestId 路由到对应 turn state（前台优先,后台兜底）。 */
function resolveAskTurn(requestId: string): AssistantTurnState | null {
  const sid = askRequestSession.get(requestId)
  if (!sid) return null
  return assistantTurns.get(sid) ?? null
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
  composerRef.value?.resetInputHeight()
  nextTick(() => {
    composerRef.value?.focusInput()
    composerRef.value?.autoGrow()
    editingIndex.value = null
  })
  // 乐观更新已持久化的会话(后台,不阻塞 UI).
  if (activeSessionId.value) {
    const toStore: ConversationMessageRecord[] = chatToStoredMessages(messages.value)
    void saveAssistantSessionMessages("local", activeSessionId.value, toStore, { touch: false })
  }
}

/** 进入一个会话后恢复其滚动位置(从存储读取目标值). */
async function restoreSessionScrollTop() {
  const sid = activeSessionId.value
  if (!sid) {
    return
  }
  const target = await loadScrollTop(sid)
  nextTick(() => restoreScrollTop(target))
}

// 路由变化反映焦点切换(focusWindow → navigateTo(routePath)).进入助手路由时
// 从会话存储恢复滚动位置(单次兜底,正常情况下 scrollTop 已被窗口常驻保留).
watch(
  () => route.path,
  (to, from) => {
    const isAssistant = (p: string) => p === ASSISTANT_ROUTE_PATH || p.startsWith(`${ASSISTANT_ROUTE_PATH}/`)
    const wasAssistant = isAssistant(from)
    const nowAssistant = isAssistant(to)
    if (nowAssistant && !wasAssistant) {
      void restoreSessionScrollTop()
    }
  },
)

async function loadProviderPreset() {
  try {
    const result = await getLocalAssistantProviderPreset()
    providerPresets.value = result.presets
    assistantProviderPresetId.value = result.providerPresetId
    assistantModelId.value = result.modelId
    assistantModels.value = result.models
    // 更新环总量:有 modelId 取对应模型的 contextWindow,否则取第一个模型的(预设默认 primary).
    const activeModel = result.modelId
      ? result.models.find((m) => m.id === result.modelId)
      : result.models[0]
    contextTotal.value = activeModel?.contextWindow ?? 0
  } catch {
    // Non-fatal: provider selection just won't show.
  }
}

/** 切换预设:立即持久化 + 重新加载该预设的模型列表 + 清空 modelId(新预设的模型 id 不同).
 *  防御 guard:有任意会话(含后台)生成中时拒绝——正在跑的 turn 已锁定 config,
 *  但改全局 agent.json 会影响下次发送,禁用期让用户等当前回合结束。 */
async function handlePresetChange(presetId: string) {
  if (runningSessionIds.size > 0) return
  const id = presetId === "__platform_default__" ? "" : presetId
  assistantProviderPresetId.value = id
  assistantModelId.value = ""
  assistantModels.value = []
  await updateLocalAssistantProviderPreset(id || null)
  if (id) {
    await updateLocalAssistantModel(null)
  }
  await loadProviderPreset()
}

/** 切换预设内模型:立即持久化 + 更新环总量. 同 handlePresetChange 的运行中 guard。 */
async function handleModelChange(modelId: string) {
  if (runningSessionIds.size > 0) return
  const id = modelId === "__preset_default__" ? "" : modelId
  assistantModelId.value = id
  await updateLocalAssistantModel(id || null)
  // 更新环总量:选了具体模型取其 contextWindow,没选取第一个(预设默认).
  const activeModel = id
    ? assistantModels.value.find((m) => m.id === id)
    : assistantModels.value[0]
  contextTotal.value = activeModel?.contextWindow ?? 0
}

/**
 * Called when the AssistantConfigPanel persists a config change. Re-reads the
 * provider preset state so the gear button's title reflects the active preset.
 */
async function handleAssistantConfigChange() {
  await loadProviderPreset()
}

// ── 刷新/关页面恢复点 ──
// streaming 期间 beforeunload/visibilitychange(hidden) 同步写 localStorage,
// 下次进会话检测到恢复点则提示用户是否保留.轻量兜底:不保证 100% 救回
// (卸载时 JS 执行窗口极短),但大多数刷新场景能保住已见正文.
const RECOVER_KEY_PREFIX = "assistant:recover:"

function recoverKey(sessionId: string): string {
  return `${RECOVER_KEY_PREFIX}${sessionId}`
}

/** 写恢复点(同步 localStorage,不阻塞卸载).只在有流式正文时写.
 *  修复:改为从 turn 注册表取本会话的 turn state,而非读单例 messages.value——
 *  切走后流式消息不在 messages.value,旧逻辑会漏写后台 turn 的恢复点。 */
function writeRecoveryPoint(sessionId: string): void {
  const state = assistantTurns.get(sessionId)
  if (!state) return
  const text = state.assistantMsg.streamingText ?? state.assistantMsg.content
  if (!text) return
  try {
    localStorage.setItem(
      recoverKey(sessionId),
      JSON.stringify({ text, ts: Date.now() }),
    )
  } catch {
    // localStorage 写失败(配额满/隐私模式)静默忽略,不阻断.
  }
}

/** 读恢复点.有则返回 {text, ts},无则 null.读后不清除(由调用方决定). */
function readRecoveryPoint(sessionId: string): { text: string; ts: number } | null {
  try {
    const raw = localStorage.getItem(recoverKey(sessionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { text?: string; ts?: number }
    if (typeof parsed.text === "string" && typeof parsed.ts === "number") {
      return { text: parsed.text, ts: parsed.ts }
    }
  } catch {
    // 损坏的恢复点静默忽略.
  }
  return null
}

/** 清除恢复点. */
function clearRecoveryPoint(sessionId: string): void {
  try {
    localStorage.removeItem(recoverKey(sessionId))
  } catch {
    // 静默忽略.
  }
}

function onBeforeUnloadRecovery() {
  if (activeSessionId.value) {
    writeRecoveryPoint(activeSessionId.value)
  }
}

function onVisibilityChangeRecovery() {
  if (document.visibilityState === "hidden" && activeSessionId.value) {
    writeRecoveryPoint(activeSessionId.value)
  }
}

onMounted(async () => {
  window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  window.addEventListener("beforeunload", onBeforeUnloadRecovery)
  document.addEventListener("visibilitychange", onVisibilityChangeRecovery)
  // 订阅 ask_user 交互请求：助手 runtime 调 ask_user 时 emitInteractionRequest
  // 推给本订阅。host 的 onAskUserRequest 已把 requestId 关联到会话,这里路由到
  // 对应 turn state 并写入响应式 activeAskBySession——前台 turn 的 ask 通过
  // computed 反映到 footer 提问区;后台 turn 的 ask 存于本 Map(切回时若仍未答
  // 则恢复显示)。活跃期间不在 timeline 渲染交互卡片；玩家回答/取消后落只读记录。
  unsubscribeInteractionRequest = subscribeInteractionRequest(
    (requestId, question, options, allowCustom) => {
      const state = resolveAskTurn(requestId)
      if (!state) return // 无对应 turn（已结束/被清理），忽略（保守兜底）
      activeAskBySession.set(state.sessionId, {
        requestId,
        question,
        ...(options ? { options } : {}),
        ...(allowCustom !== undefined ? { allowCustom } : {}),
      })
      // 前台 turn 的提问区由 AssistantAskPanel 自行聚焦自定义输入框。
    },
  )
  await refresh()
  await loadActiveSession()
  await loadProviderPreset()
  nextTick(() => composerRef.value?.focusInput())
})

onBeforeUnmount(() => {
  window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  window.removeEventListener("beforeunload", onBeforeUnloadRecovery)
  document.removeEventListener("visibilitychange", onVisibilityChangeRecovery)
  unsubscribeInteractionRequest?.()
  // 组件卸载:abort 所有进行中 turn(含后台),清注册表。host catch 路径会
  // rejectAllInteractionRequests + 走 persistTurnFallback 兜底落盘半截回复。
  for (const [, state] of assistantTurns) {
    state.controller.abort()
  }
  assistantTurns.clear()
  askRequestSession.clear()
  runningSessionIds.clear()
  activeAskBySession.clear()
})

function onActiveCardChanged(event: Event) {
  if (!isActiveCardChangedEvent(event)) {
    return
  }
  void refresh()
}
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
