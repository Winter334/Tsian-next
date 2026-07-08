<script setup lang="ts">
/**
 * UnderstandingFailed — 初始理解失败。
 *
 * 错误详情 + 重试按钮（--blood 边框）。不暴露 agent 名称。
 */
defineProps<{
  error: string
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<template>
  <div class="understanding-failed">
    <div class="failed-card">
      <div class="failed-mark" aria-hidden="true">✕</div>
      <h3 class="failed-title">理解未完成</h3>
      <div class="failed-detail-scroll">
        <p class="failed-detail">{{ error }}</p>
      </div>
      <button class="retry-btn" type="button" @click="emit('retry')">
        重试
      </button>
    </div>
  </div>
</template>

<style scoped>
.understanding-failed {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  min-height: 240px;
}

.failed-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 28px 32px;
  background: var(--void-deep);
  border: 1px solid var(--blood);
  border-radius: 6px;
  box-shadow: inset 0 0 16px rgba(155, 58, 46, 0.1);
  max-width: 480px;
  width: 100%;
}

.failed-mark {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1.5px solid var(--blood);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.9rem;
  color: var(--blood);
  font-weight: 600;
}

.failed-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--prose);
  text-align: center;
}

/* agent 回复可能很长，加滚动区 */
.failed-detail-scroll {
  max-height: 200px;
  overflow-y: auto;
  width: 100%;
  padding: 0 4px;
}
.failed-detail-scroll::-webkit-scrollbar {
  width: 3px;
}
.failed-detail-scroll::-webkit-scrollbar-thumb {
  background: var(--whisper);
  border-radius: 2px;
}

.failed-detail {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-muted);
  text-align: left;
  line-height: 1.7;
  word-break: break-word;
  white-space: pre-wrap;
}

.retry-btn {
  margin-top: 4px;
  background: transparent;
  border: 1px solid var(--blood);
  border-radius: 4px;
  padding: 8px 24px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: var(--blood);
  transition: background 0.2s, box-shadow 0.2s, color 0.2s;
}
.retry-btn:hover {
  background: rgba(155, 58, 46, 0.15);
  box-shadow: 0 0 12px rgba(155, 58, 46, 0.3);
  color: #c4524a;
}
.retry-btn:active {
  transform: scale(0.96);
}
</style>
