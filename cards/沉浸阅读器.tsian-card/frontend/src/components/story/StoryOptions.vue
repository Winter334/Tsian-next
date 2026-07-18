<script setup lang="ts">
/**
 * StoryOptions — 故事选项卡。
 *
 * prd 屏3：卡片 --void-deep + --line 边 + 角落括号 + 可选数字编号；
 * hover/active translateY(-2px) + --ember 描边 + inset 0 0 24px ember-glow 内发光；
 * 进场 auto-layout stagger from random；选中 --ember 实心边 + scale，其余淡出。
 *
 * Step 4 简化版：基础卡片样式 + hover 效果。auto-layout 进场留优化期。
 */
const emit = defineEmits<{
  select: [option: string]
}>()

defineProps<{
  options: string[]
  disabled?: boolean
}>()
</script>

<template>
  <div class="story-options">
    <button
      v-for="(opt, i) in options"
      :key="i"
      class="story-option"
      :disabled="disabled"
      @click="emit('select', opt)"
    >
      <span class="opt-num">{{ i + 1 }}</span>
      <span class="opt-text">{{ opt }}</span>
    </button>
  </div>
</template>

<style scoped>
.story-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 24px 0;
}

.story-option {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 0.95rem;
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
}
.story-option:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: var(--ember);
  box-shadow: inset 0 0 24px var(--ember-glow);
}
.story-option:disabled {
  opacity: 0.62;
  cursor: not-allowed;
}

/* 角落括号装饰 */
.story-option::before,
.story-option::after {
  content: "";
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--ember);
  opacity: 0.4;
}
.story-option::before {
  top: 4px;
  left: 4px;
  border-right: none;
  border-bottom: none;
}
.story-option::after {
  bottom: 4px;
  right: 4px;
  border-left: none;
  border-top: none;
}

.opt-num {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--ember);
  flex-shrink: 0;
}
.opt-text {
  line-height: 1.5;
}
</style>
