<script setup lang="ts">
import { ref } from "vue"

/**
 * FileInput — 文件导入（真实拖放 + 选择文件）。
 *
 * prd 向导 Step 1 file：标题输入框 + 真实拖放区（dragover/drop）或选择文件按钮；
 * 拖放区虚线 --whisper 边，拖入 --ember 高亮；通过 defineExpose 暴露 getInput()
 * 供 SetupWizard 读取。拖放文件时自动触发导入。
 */
const emit = defineEmits<{
  /** 拖放文件后自动触发导入 */
  autoImport: []
}>()

const title = ref("")
const fileInput = ref<HTMLInputElement | null>(null)
const dropZone = ref<HTMLElement | null>(null)
const dragging = ref(false)
const selectedFileName = ref("")

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    selectedFileName.value = input.files[0].name
  }
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}

function onDragLeave() {
  dragging.value = false
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const dropped = e.dataTransfer?.files?.[0]
  if (dropped && fileInput.value) {
    const transfer = new DataTransfer()
    transfer.items.add(dropped)
    fileInput.value.files = transfer.files
    selectedFileName.value = dropped.name
    emit("autoImport")
  }
}

/** 供父组件读取输入数据。 */
function getInput(): { text: string; title: string; fileName?: string } {
  const file = fileInput.value?.files?.[0]
  if (!file) {
    return { text: "", title: title.value.trim() }
  }
  // 文件读取是异步的，但 legacy 代码在 startImport 里 await file.text()。
  // 这里返回标记，让父组件知道需要异步读取。
  return {
    text: "", // 占位，父组件通过 readFile() 异步获取
    title: title.value.trim(),
    fileName: file.name,
  }
}

/** 异步读取文件内容（供父组件调用）。 */
async function readFile(): Promise<{ text: string; title: string; fileName?: string } | null> {
  const file = fileInput.value?.files?.[0]
  if (!file) return null
  return {
    text: await file.text(),
    title: title.value.trim(),
    fileName: file.name,
  }
}

defineExpose({ getInput, readFile })
</script>

<template>
  <div class="input-panel">
    <input
      v-model="title"
      class="title-input"
      type="text"
      placeholder="书名（可选，留空则自动推断）"
    />
    <label
      ref="dropZone"
      class="file-drop"
      :class="{ dragging }"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <input
        ref="fileInput"
        class="file-hidden"
        type="file"
        accept=".txt,.md,text/plain,text/markdown"
        @change="onFileChange"
      />
      <span class="drop-title">拖入或选择 .txt / .md 文件</span>
      <span class="drop-copy">{{ selectedFileName || "支持拖放，或点击选择。" }}</span>
      <!-- 四角括号 -->
      <span class="bracket tl" aria-hidden="true" />
      <span class="bracket tr" aria-hidden="true" />
      <span class="bracket bl" aria-hidden="true" />
      <span class="bracket br" aria-hidden="true" />
    </label>
  </div>
</template>

<style scoped>
.input-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.title-input {
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 12px 16px;
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 0.95rem;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.title-input:focus {
  outline: none;
  border-color: var(--ember);
  box-shadow: inset 0 0 12px var(--ember-glow);
}
.title-input::placeholder {
  color: var(--whisper);
}

.file-drop {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px 24px;
  min-height: 160px;
  background: var(--void-deep);
  border: 2px dashed var(--whisper);
  border-radius: 6px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.25s, box-shadow 0.25s, background 0.25s;
}
.file-drop:hover,
.file-drop.dragging {
  border-color: var(--ember);
  box-shadow: inset 0 0 24px var(--ember-glow);
  background: rgba(181, 137, 61, 0.03);
}

.file-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.drop-title {
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--prose);
}

.drop-copy {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--prose-dim);
  letter-spacing: 0.05em;
}

/* 四角括号 */
.bracket {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--ember);
  opacity: 0.3;
  transition: opacity 0.25s;
}
.file-drop:hover .bracket,
.file-drop.dragging .bracket {
  opacity: 0.6;
}
.bracket.tl { top: 5px; left: 5px; border-right: none; border-bottom: none; }
.bracket.tr { top: 5px; right: 5px; border-left: none; border-bottom: none; }
.bracket.bl { bottom: 5px; left: 5px; border-right: none; border-top: none; }
.bracket.br { bottom: 5px; right: 5px; border-left: none; border-top: none; }
</style>
