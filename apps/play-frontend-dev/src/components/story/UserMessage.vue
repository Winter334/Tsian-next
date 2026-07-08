<script setup lang="ts">
/**
 * UserMessage — 用户消息（右对齐独白体）。
 *
 * 风格：无框，右对齐，顶部 ember 短横线 + 「你」标签，正文 Serif。
 * 像剧本里的一句动作宣告，与左对齐的叙述正文形成左右对话张力。
 * 进场自右淡入。
 *
 * editable：仅最近一条用户消息可编辑（停止后"重新编辑"入口），
 * hover 时显示编辑按钮，点击 emit edit 把内容回填输入框。
 */
defineProps<{
  content: string
  editable?: boolean
}>()

const emit = defineEmits<{
  edit: [content: string]
}>()
</script>

<template>
  <div class="user-msg" :class="{ editable }">
    <div class="msg-head">
      <span class="dash" aria-hidden="true" />
      <span class="msg-role">你</span>
      <span class="dash" aria-hidden="true" />
      <!-- 编辑按钮：仅 editable 且 hover 时出现 -->
      <button
        v-if="editable"
        class="edit-btn"
        title="重新编辑"
        @click="emit('edit', content)"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M14 4l6 6L10 20H4v-6L14 4z" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
    </div>
    <div class="msg-body">{{ content }}</div>
  </div>
</template>

<style scoped>
.user-msg {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin: 32px 0;
  animation: user-in 0.55s cubic-bezier(0.22, 1, 0.36, 1) both;
}

/* 顶部「─ 你 ─」：两段 ember 渐隐短横线夹住 mono 标签 */
.msg-head {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  margin-bottom: 7px;
}
.dash {
  width: 22px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ember), transparent);
  flex-shrink: 0;
}
.msg-role {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ember);
  letter-spacing: 0.35em;
  text-transform: uppercase;
  text-shadow: 0 0 8px var(--ember-glow);
}

.msg-body {
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--prose);
  line-height: 1.75;
  text-align: right;
  max-width: 85%;
}

/* 编辑按钮：默认隐藏，hover 时淡入 */
.edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  margin-left: 4px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--prose-faint);
  opacity: 0;
  transition: opacity 0.2s, color 0.2s, background 0.2s;
}
.edit-btn svg {
  width: 13px;
  height: 13px;
}
.user-msg.editable:hover .edit-btn {
  opacity: 0.6;
}
.edit-btn:hover {
  opacity: 1 !important;
  color: var(--ember);
  background: rgba(181, 137, 61, 0.1);
}

@keyframes user-in {
  from {
    opacity: 0;
    transform: translateX(22px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
