<template>
  <footer class="border-t border-neon-deep/30 bg-[#2d2a23] px-4 py-3">
    <!-- ask 模式:输入框变形为提问区。问题常驻 footer 焦点位(底部固定,滚动不影响),
         普通输入框/发送/停止整体隐藏,避免两个输入框并存。回答/取消后回到普通输入态。 -->
    <AssistantAskPanel
      v-if="activeAsk"
      :active-ask="activeAsk"
      @answer="$emit('answerAsk', $event.requestId, $event.answer)"
      @submit-custom="$emit('submitCustomAsk', $event.requestId, $event.value)"
      @cancel="$emit('cancelAsk', $event)"
    />

    <form v-else class="mx-auto max-w-3xl" @submit.prevent="$emit('send')">
      <!-- 附件预览区 -->
      <div
        v-if="pendingAttachments.length > 0"
        class="mb-2 flex flex-wrap gap-2"
      >
        <div
          v-for="(att, index) in pendingAttachments"
          :key="att.ref.path"
          class="group relative flex items-center gap-2 border border-neon-deep/40 bg-panel/55 px-2 py-1.5"
        >
          <img
            v-if="att.previewUrl"
            :src="att.previewUrl"
            :alt="att.ref.name"
            class="h-10 w-10 object-cover"
          />
          <FileText
            v-else
            class="h-5 w-5 text-text-dim"
            aria-hidden="true"
          />
          <div class="flex flex-col">
            <span class="max-w-[140px] truncate text-xs text-text-main">{{ att.ref.name }}</span>
            <span class="text-[10px] text-text-dim">{{ formatFileSize(att.ref.size) }}</span>
          </div>
          <button
            type="button"
            class="ml-1 text-text-dim hover:text-neon"
            title="移除附件"
            @click="$emit('removeAttachment', index)"
          >
            <X class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="flex items-end gap-2">
        <!-- 附件按钮 -->
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center px-3 font-mono text-xs"
          :disabled="sending || inputLocked"
          :title="inputLocked ? '请先加载游戏卡后再添加附件' : '添加附件'"
          @click="fileInputRef?.click()"
        >
          <Paperclip class="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          ref="fileInputRef"
          type="file"
          class="hidden"
          :accept="acceptedFileTypes"
          multiple
          @change="handleFilePick"
        />
        <textarea
          ref="inputRef"
          :value="inputText"
          class="retro-focus max-h-[160px] min-h-[44px] min-w-0 flex-1 resize-none overflow-y-auto border border-neon-deep/40 bg-panel/55 px-3.5 py-2.5 text-sm leading-6 text-text-main placeholder:text-text-dim focus:border-neon/55"
          :placeholder="inputPlaceholder"
          rows="1"
          :disabled="sending || inputLocked"
          @input="handleInput"
          @keydown.enter.exact.prevent="$emit('send')"
          @paste="handlePaste"
        />
        <button
          type="submit"
          class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
          :disabled="sending || inputLocked || (!inputText.trim() && pendingAttachments.length === 0)"
          :title="inputLocked ? '请先加载游戏卡后再发送' : '发送'"
        >
          <Send class="h-4 w-4" aria-hidden="true" />
          发送
        </button>
        <button
          v-if="sending"
          type="button"
          class="retro-button retro-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 px-4 font-mono text-xs"
          title="停止生成"
          @click="$emit('stopGenerating')"
        >
          <Square class="h-4 w-4" aria-hidden="true" />
          停止
        </button>
      </div>
    </form>
  </footer>
</template>

<script setup lang="ts">
import { ref } from "vue"
import { FileText, Paperclip, Send, Square, X } from "lucide-vue-next"
import AssistantAskPanel from "./AssistantAskPanel.vue"
import { formatFileSize } from "./format"
import type { ActiveAskState, PendingAttachment } from "./types"

defineProps<{
  activeAsk: ActiveAskState | null
  inputText: string
  pendingAttachments: PendingAttachment[]
  sending: boolean
  inputLocked: boolean
  inputPlaceholder: string
  acceptedFileTypes: string
}>()

const emit = defineEmits<{
  "update:inputText": [value: string]
  send: []
  stopGenerating: []
  removeAttachment: [index: number]
  filesSelected: [files: File[]]
  imagePasted: [file: File]
  answerAsk: [requestId: string, answer: string]
  submitCustomAsk: [requestId: string, value: string]
  cancelAsk: [requestId: string]
}>()

const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

function focusInput() {
  inputRef.value?.focus()
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

function handleInput(event: Event) {
  emit("update:inputText", (event.target as HTMLTextAreaElement).value)
  autoGrow()
}

/** textarea paste 处理:检测剪贴板图片. */
function handlePaste(event: ClipboardEvent) {
  const clipboardData = event.clipboardData
  if (!clipboardData) return
  for (const item of clipboardData.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile()
      if (file) {
        event.preventDefault()
        emit("imagePasted", file)
      }
    }
  }
}

/** 隐藏 file input 的 change 处理. */
function handleFilePick(event: Event) {
  const target = event.target as HTMLInputElement
  if (!target.files) return
  emit("filesSelected", Array.from(target.files))
  target.value = ""  // 重置,允许重复选同一文件
}

defineExpose({
  focusInput,
  autoGrow,
  resetInputHeight,
})
</script>
