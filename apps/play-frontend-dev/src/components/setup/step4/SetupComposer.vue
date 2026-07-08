<script setup lang="ts">
import { ref, nextTick } from "vue"

/**
 * SetupComposer — 向导内简化版输入区。
 *
 * 基于 Composer.vue 简化：720px 宽适配向导框架，无 stop/streaming 态。
 * textarea + ember 底线 + ember 发送按钮。Enter 发送，Shift+Enter 换行。
 */
const props = defineProps<{
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  send: [text: string]
}>()

const text = ref("")
const inputEl = ref<HTMLTextAreaElement | null>(null)
const focused = ref(false)
const hasContent = ref(false)

function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = el.scrollHeight <= 120 ? el.scrollHeight + "px" : "120px"
  hasContent.value = text.value.trim().length > 0
}

async function onSend() {
  const content = text.value.trim()
  if (!content || props.disabled) return
  emit("send", content)
  text.value = ""
  hasContent.value = false
  await nextTick()
  autoGrow()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    onSend()
  }
}
</script>

<template>
  <div class="setup-composer-wrap">
    <div
      class="setup-composer"
      :class="{ focused, 'has-content': hasContent }"
    >
      <textarea
        ref="inputEl"
        v-model="text"
        class="composer-input"
        :disabled="disabled"
        :placeholder="placeholder ?? '说出你的想法…'"
        rows="1"
        @keydown="onKeydown"
        @input="autoGrow"
        @focus="focused = true"
        @blur="focused = false"
      />

      <button
        class="send-btn"
        :disabled="disabled || !hasContent"
        @click="onSend"
      >
        <svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 12L19 5L13 19L11 13L5 12Z"
            fill="currentColor"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <span class="ink-line" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.setup-composer-wrap {
  position: relative;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 8px 24px 16px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.setup-composer {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 8px 8px 0 0;
  background:
    radial-gradient(ellipse 80% 100% at 50% 100%, rgba(43, 4, 4, 0.6) 0%, transparent 70%),
    rgba(10, 5, 6, 0.35);
  box-shadow:
    inset 0 1px 0 rgba(181, 137, 61, 0.08),
    0 0 30px rgba(232, 169, 72, 0.06);
  transition: background 0.4s, box-shadow 0.4s;
}
.setup-composer.focused {
  background:
    radial-gradient(ellipse 80% 100% at 50% 100%, rgba(43, 4, 4, 0.8) 0%, transparent 70%),
    rgba(10, 5, 6, 0.5);
  box-shadow:
    inset 0 1px 0 rgba(181, 137, 61, 0.18),
    0 0 40px rgba(232, 169, 72, 0.12);
}

.composer-input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 1rem;
  line-height: 1.65;
  resize: none;
  max-height: 120px;
  padding: 6px 0;
}
.composer-input:focus {
  outline: none;
}
.composer-input::placeholder {
  color: var(--prose-faint);
  font-style: italic;
}
.composer-input:disabled {
  opacity: 0.7;
}

.ink-line {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--line-strong) 12%,
    var(--ember) 50%,
    var(--line-strong) 88%,
    transparent 100%
  );
  opacity: 0.3;
  transition: opacity 0.35s ease, height 0.35s ease;
}
.setup-composer.focused .ink-line {
  opacity: 1;
  height: 2px;
  box-shadow: 0 0 6px rgba(232, 169, 72, 0.25);
}
.setup-composer.has-content .ink-line {
  opacity: 0.65;
}

.send-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--ember);
  background: radial-gradient(circle at 35% 35%, var(--ember-bright), var(--ember) 70%, rgba(181, 137, 61, 0.3));
  color: var(--void-deep);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s, filter 0.25s, opacity 0.25s;
}
.send-btn .btn-icon {
  width: 16px;
  height: 16px;
  z-index: 1;
}
.send-btn:hover:not(:disabled) {
  filter: brightness(1.15);
  box-shadow: 0 0 18px var(--ember-glow), 0 0 4px var(--ember);
}
.send-btn:active:not(:disabled) {
  transform: scale(0.88);
  box-shadow: 0 0 10px var(--ember-glow);
}
.send-btn:disabled {
  opacity: 0.15;
  cursor: not-allowed;
  border-color: var(--line);
  background: var(--void-deep);
  color: var(--prose-faint);
}
</style>
