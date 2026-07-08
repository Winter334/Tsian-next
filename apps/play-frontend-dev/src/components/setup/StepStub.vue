<script setup lang="ts">
/**
 * StepStub — 未实现步骤的占位屏。
 *
 * step3-5 尚未开发，向导推进到这些步骤时显示"即将开放"占位 +
 * 返回按钮引导回到已完成的最后一步。
 */
defineProps<{
  /** 步骤序号（1-5），用于显示"第 N 步" */
  step: number
  /** 步骤名称（如"角色设定"） */
  title: string
}>()

const emit = defineEmits<{
  back: []
}>()
</script>

<template>
  <div class="step-stub">
    <div class="stub-card">
      <div class="stub-glyph" aria-hidden="true">⚿</div>
      <h3 class="stub-title">{{ title }}</h3>
      <p class="stub-desc">第 {{ step }} 步 · 即将开放</p>
      <p class="stub-hint">此步骤正在开发中，暂未接入。</p>
      <button class="stub-back" type="button" @click="emit('back')">
        返回
      </button>
    </div>
  </div>
</template>

<style scoped>
.step-stub {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  min-height: 240px;
}

.stub-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 36px;
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 6px;
  max-width: 420px;
  width: 100%;
}

.stub-glyph {
  font-size: 2rem;
  color: var(--prose-faint);
  opacity: 0.5;
  line-height: 1;
}

.stub-title {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.1rem;
  color: var(--prose);
  text-align: center;
}

.stub-desc {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ember);
  letter-spacing: 0.06em;
}

.stub-hint {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-muted);
  text-align: center;
}

.stub-back {
  margin-top: 8px;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 8px 24px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.06em;
  color: var(--prose-muted);
  transition: border-color 0.2s, color 0.2s;
}
.stub-back:hover {
  border-color: var(--ember);
  color: var(--prose);
}
.stub-back:active {
  transform: scale(0.96);
}
</style>
