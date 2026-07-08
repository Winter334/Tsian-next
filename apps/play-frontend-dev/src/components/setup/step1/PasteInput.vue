<script setup lang="ts">
import { ref } from "vue"

/**
 * PasteInput — 粘贴文本输入。
 *
 * prd 向导 Step 1 paste：标题输入框 + 大 textarea（--void-deep + --line，
 * --prose Serif）；通过 defineExpose 暴露 getInput() 供 SetupWizard 读取。
 */
const title = ref("")
const text = ref("")

/** 供父组件读取输入数据。 */
function getInput(): { text: string; title: string } {
  return {
    text: text.value,
    title: title.value.trim(),
  }
}

defineExpose({ getInput })
</script>

<template>
  <div class="input-panel">
    <input
      v-model="title"
      class="title-input"
      type="text"
      placeholder="书名（可选，留空则自动推断）"
    />
    <textarea
      v-model="text"
      class="paste-textarea"
      placeholder="在这里粘贴小说文本……"
    />
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
  color: var(--prose-faint);
}

.paste-textarea {
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 14px 16px;
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 0.9rem;
  line-height: 1.7;
  resize: vertical;
  min-height: 240px;
  transition: border-color 0.25s, box-shadow 0.25s;
}
.paste-textarea:focus {
  outline: none;
  border-color: var(--ember);
  box-shadow: inset 0 0 12px var(--ember-glow);
}
.paste-textarea::placeholder {
  color: var(--prose-faint);
}
</style>
