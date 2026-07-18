<script setup lang="ts">
/**
 * CheckpointMark — 对话流内的卷轴印记。
 *
 * 设计：不承载过多信息，是一个仪式性书签——ember 分隔线 + 中心旋转菱形 glyph，
 * 自带常驻微动效（慢转 + ember 呼吸），像烛火一直在静默跳动。点击触发恢复确认。
 *
 * 信息极简：仅 `第 N 回`，玩家能定位即可。
 * reason/label/messageCount/workspaceFileCount/时间对玩家无意义，不展示。
 */
defineProps<{
  turn: number
}>()

const emit = defineEmits<{
  restore: []
}>()
</script>

<template>
  <div class="ckpt-mark" @click="emit('restore')">
    <span class="line line-left" aria-hidden="true" />
    <span class="glyph-wrap">
      <span class="glyph" aria-hidden="true" />
    </span>
    <span class="line line-right" aria-hidden="true" />
    <span class="label">第 {{ turn }} 回</span>
  </div>
</template>

<style scoped>
.ckpt-mark {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 28px 0;
  padding: 4px 0;
  cursor: pointer;
  position: relative;
}

/* 左右 ember 渐隐线 */
.line {
  height: 1px;
  flex: 1;
  background: linear-gradient(90deg, transparent, var(--ember), transparent);
  opacity: 0.25;
  transition: opacity 0.3s;
}
.line-left {
  background: linear-gradient(90deg, transparent, var(--ember));
  opacity: 0.15;
}
.line-right {
  background: linear-gradient(90deg, var(--ember), transparent);
  opacity: 0.15;
}
.ckpt-mark:hover .line {
  opacity: 0.5;
}

/* 中心菱形 glyph：常驻慢转 + ember 呼吸微光 */
.glyph-wrap {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}
.glyph {
  width: 8px;
  height: 8px;
  background: var(--ember);
  transform: rotate(45deg);
  box-shadow: 0 0 6px var(--ember-glow);
  animation: glyph-spin 8s linear infinite, glyph-breathe 2.5s ease-in-out infinite;
}
@keyframes glyph-spin {
  from { transform: rotate(45deg); }
  to { transform: rotate(405deg); }
}
@keyframes glyph-breathe {
  0%, 100% {
    box-shadow: 0 0 4px var(--ember-glow);
    opacity: 0.7;
  }
  50% {
    box-shadow: 0 0 10px var(--ember-glow), 0 0 3px var(--ember);
    opacity: 1;
  }
}
.ckpt-mark:hover .glyph {
  animation-duration: 4s, 1.5s;
}

/* 标签：mono whisper 极小字，绝对定位在分隔线下方居中 */
.label {
  position: absolute;
  left: 50%;
  top: 100%;
  transform: translateX(-50%);
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--prose-faint);
  letter-spacing: 0.08em;
  margin-top: 4px;
  transition: color 0.3s;
}
.ckpt-mark:hover .label {
  color: var(--ember);
}
</style>
