<script setup lang="ts">
/**
 * SceneImage — 场景插画位。
 *
 * prd 屏3：占位 lachisa render，暗色滤镜 + --line 边 + 括号；
 * 进场 GSAP scale+clipPath 卷轴展开感，宽度受限不抢叙述。
 *
 * Step 4 占位：纯容器 + 样式，实际插画源待接入。
 */
defineProps<{
  src?: string
  alt?: string
}>()
</script>

<template>
  <figure class="scene-image">
    <img v-if="src" :src="src" :alt="alt ?? ''" />
    <div v-else class="scene-placeholder">
      <span class="placeholder-glyph">⌗</span>
    </div>
  </figure>
</template>

<style scoped>
.scene-image {
  position: relative;
  width: 100%;
  max-width: 420px;
  margin: 24px auto;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
}
.scene-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: brightness(0.7) saturate(0.8) sepia(0.2);
}

.scene-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--void-deep);
}
.placeholder-glyph {
  font-size: 2rem;
  color: var(--whisper);
  opacity: 0.5;
}

/* 角落括号 */
.scene-image::before,
.scene-image::after {
  content: "";
  position: absolute;
  width: 12px;
  height: 12px;
  border: 1px solid var(--ember);
  opacity: 0.5;
}
.scene-image::before {
  top: 6px;
  left: 6px;
  border-right: none;
  border-bottom: none;
}
.scene-image::after {
  bottom: 6px;
  right: 6px;
  border-left: none;
  border-top: none;
}
</style>
