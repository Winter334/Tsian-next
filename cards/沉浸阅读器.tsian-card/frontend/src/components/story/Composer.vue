<script setup lang="ts">
import { ref, nextTick } from "vue"

/**
 * Composer — 输入区（无框 + ember 底线 + 交互动效）。
 *
 * 设计：无边框束缚，textarea 透明嵌入，底部 ember 渐变线替代边框。
 * 重心在交互动效：
 * - 聚焦：底线从两端向中间亮起 + 微光晕
 * - 输入：底线 ember 脉动（有内容时比空内容更亮）
 * - 送出按钮 hover：图标旋转 + 辉光扩散；active：涟漪收敛
 * - streaming：底线光带扫过 + 按钮 morph 为停止
 */
const props = defineProps<{
  ready: boolean
  streaming: boolean
  /** 回合后同步进行中/失败时禁用输入（不显示停止按钮，与 streaming 区分）。 */
  syncing?: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
  stop: []
}>()

const text = ref("")
const inputEl = ref<HTMLTextAreaElement | null>(null)
const focused = ref(false)
const hasContent = ref(false)

function autoGrow() {
  const el = inputEl.value
  if (!el) return
  el.style.height = "auto"
  el.style.height = el.scrollHeight <= 140 ? el.scrollHeight + "px" : "140px"
  hasContent.value = text.value.trim().length > 0
}

async function onSend() {
  const content = text.value.trim()
  if (!content || !props.ready || props.streaming || props.syncing) return
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

/** 外部回填文本并聚焦（供"重新编辑"功能调用）。 */
async function setText(content: string) {
  text.value = content
  hasContent.value = content.trim().length > 0
  await nextTick()
  autoGrow()
  inputEl.value?.focus()
}

defineExpose({ setText })
</script>

<template>
  <div class="composer-wrap">
    <div
      class="composer"
      :class="{ streaming, 'sync-disabled': syncing, focused, 'has-content': hasContent }"
    >
      <textarea
        ref="inputEl"
        v-model="text"
        class="composer-input"
        :disabled="!ready || streaming || syncing"
        :placeholder="streaming ? '故事正在书写…' : syncing ? '整理本回合中…' : '在下方写下你的行动…'"
        rows="1"
        @keydown="onKeydown"
        @input="autoGrow"
        @focus="focused = true"
        @blur="focused = false"
      />

      <!-- 送出按钮 -->
      <button
        v-if="!streaming"
        class="send-btn"
        :disabled="!ready || !hasContent"
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
        <span class="btn-ring" aria-hidden="true" />
      </button>

      <!-- 停止按钮 -->
      <button
        v-else
        class="stop-btn"
        @click="emit('stop')"
      >
        <svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="8" height="8" rx="1" fill="currentColor" />
        </svg>
      </button>

      <!-- 底线：ember 渐变线，替代边框 -->
      <span class="ink-line" aria-hidden="true">
        <span v-if="streaming" class="ink-sweep" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.composer-wrap {
  position: relative;
  width: 100%;
  max-width: 52em;
  margin: 0 auto;
  padding: 8px 24px 20px;
  background: linear-gradient(to bottom, transparent 0%, var(--void) 50%, var(--void) 100%);
  flex-shrink: 0;
  box-sizing: border-box;
}

.composer {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 10px 14px 10px 14px;
  border-radius: 8px 8px 0 0;
  /* 烛火辉光：柔和的 ember 径向光从底部向上晕染，
     让输入区像被烛火照亮——有存在感但不做矩形框 */
  background:
    radial-gradient(ellipse 80% 100% at 50% 100%, rgba(43, 4, 4, 0.6) 0%, transparent 70%),
    rgba(10, 5, 6, 0.35);
  box-shadow:
    inset 0 1px 0 rgba(181, 137, 61, 0.08),
    0 0 30px rgba(232, 169, 72, 0.06);
  transition: background 0.4s, box-shadow 0.4s;
}
/* 聚焦：辉光增强——烛火被拨亮 */
.composer.focused {
  background:
    radial-gradient(ellipse 80% 100% at 50% 100%, rgba(43, 4, 4, 0.8) 0%, transparent 70%),
    rgba(10, 5, 6, 0.5);
  box-shadow:
    inset 0 1px 0 rgba(181, 137, 61, 0.18),
    0 0 40px rgba(232, 169, 72, 0.12);
}
/* streaming：辉光呼吸——烛火跳动 */
.composer.streaming {
  background:
    radial-gradient(ellipse 80% 100% at 50% 100%, rgba(43, 4, 4, 0.8) 0%, transparent 70%),
    rgba(10, 5, 6, 0.5);
  box-shadow:
    inset 0 1px 0 rgba(232, 169, 72, 0.2),
    0 0 40px rgba(232, 169, 72, 0.12);
  animation: ember-breathe 2.5s ease-in-out infinite;
}
@keyframes ember-breathe {
  0%, 100% { box-shadow: inset 0 1px 0 rgba(232, 169, 72, 0.2), 0 0 30px rgba(232, 169, 72, 0.08); }
  50% { box-shadow: inset 0 1px 0 rgba(232, 169, 72, 0.3), 0 0 50px rgba(232, 169, 72, 0.18); }
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
  max-height: 140px;
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

/* ── 底线：ember 渐变线 ── */
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
  overflow: hidden;
}
/* 聚焦：底线变粗 + 全亮，从两端向中间汇聚感 */
.composer.focused .ink-line {
  opacity: 1;
  height: 2px;
  box-shadow: 0 0 6px rgba(232, 169, 72, 0.25);
}
/* 有内容但未聚焦：比空状态亮一点，提示"有东西可以送出" */
.composer.has-content .ink-line {
  opacity: 0.65;
}
.composer.streaming .ink-line {
  opacity: 1;
  height: 2px;
}

/* streaming 光带扫过 */
.ink-sweep {
  display: block;
  height: 100%;
  width: 35%;
  background: linear-gradient(90deg, transparent, var(--ember-bright), transparent);
  animation: ink-sweep 1.8s ease-in-out infinite;
}
@keyframes ink-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(380%); }
}

/* ── 送出按钮：ember 圆形图标 ── */
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
  position: relative;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.35s, filter 0.25s, opacity 0.25s;
  box-shadow: 0 0 0 0 var(--ember-glow);
}
.send-btn .btn-icon {
  width: 16px;
  height: 16px;
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
  z-index: 1;
}
/* 涟漪环：hover 时从按钮边缘扩散 */
.send-btn .btn-ring {
  position: absolute;
  inset: -1px;
  border-radius: 50%;
  border: 1px solid var(--ember);
  opacity: 0;
  transition: opacity 0.3s, transform 0.5s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.send-btn:hover:not(:disabled) {
  filter: brightness(1.15);
  box-shadow: 0 0 18px var(--ember-glow), 0 0 4px var(--ember);
}
.send-btn:hover:not(:disabled) .btn-icon {
  transform: rotate(-20deg) translateX(1px) translateY(-1px);
}
.send-btn:hover:not(:disabled) .btn-ring {
  opacity: 0.5;
  transform: scale(1.35);
}
.send-btn:active:not(:disabled) {
  transform: scale(0.88);
  box-shadow: 0 0 10px var(--ember-glow);
}
.send-btn:active:not(:disabled) .btn-ring {
  opacity: 0;
  transform: scale(1.6);
}
.send-btn:disabled {
  opacity: 0.15;
  cursor: not-allowed;
  border-color: var(--line);
  background: var(--void-deep);
  color: var(--prose-faint);
}

/* ── 停止按钮：blood 圆形 ── */
.stop-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1px solid var(--blood);
  background: transparent;
  color: var(--blood);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.25s, box-shadow 0.3s, color 0.2s, transform 0.2s;
}
.stop-btn .btn-icon {
  width: 13px;
  height: 13px;
}
.stop-btn:hover {
  background: rgba(155, 58, 46, 0.18);
  box-shadow: 0 0 14px rgba(155, 58, 46, 0.4);
  color: #c4524a;
}
.stop-btn:active {
  transform: scale(0.9);
}

/* ── sync-disabled：回合后同步期间，烛火低伏静态（不跳动）──
   与 streaming 的 ember-breathe 区分：streaming 是烛火明亮跳动（正文讲述中），
   sync-disabled 是烛火静燃低伏（幕后整理中）。 */
.composer.sync-disabled {
  background:
    radial-gradient(ellipse 80% 100% at 50% 100%, rgba(43, 4, 4, 0.55) 0%, transparent 70%),
    rgba(10, 5, 6, 0.35);
  box-shadow:
    inset 0 1px 0 rgba(181, 137, 61, 0.06),
    0 0 20px rgba(232, 169, 72, 0.04);
}
.composer.sync-disabled .ink-line {
  opacity: 0.25;
  height: 1px;
}
</style>
