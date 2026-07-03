<script setup lang="ts">
import { ref } from "vue"
import { useAtmosphere } from "../composables/useAtmosphere"

const props = withDefaults(
  defineProps<{
    /** 粒子密度：主游玩态稀疏，开屏/向导密集 */
    density?: number
    /** 视差强度 */
    parallax?: number
    /** 巨字背景文字（极淡漂移） */
    ghostText?: string
  }>(),
  { density: 40, parallax: 10, ghostText: "STORY" },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
useAtmosphere(canvasRef, { density: props.density, parallax: props.parallax })
</script>

<template>
  <div class="atmosphere" aria-hidden="true">
    <!-- 径向暗血氛围光 -->
    <div class="atm-radial" />
    <!-- 点阵网格 overlay -->
    <div class="atm-dots" />
    <!-- 巨字背景漂移 -->
    <div class="atm-ghost">{{ ghostText }} {{ ghostText }} {{ ghostText }}</div>
    <!-- 余烬粒子 Canvas -->
    <canvas ref="canvasRef" class="atm-canvas" />
    <!-- 径向 vignette 边缘融化 -->
    <div class="atm-vignette" />
  </div>
</template>

<style scoped>
.atmosphere {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
}

.atm-radial {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, var(--ember-glow) 0%, var(--void) 70%);
  opacity: 0.6;
}

.atm-dots {
  position: absolute;
  inset: 0;
  background-image: var(--dot-grid);
  background-size: 6px 6px;
  opacity: 0.5;
}

.atm-ghost {
  position: absolute;
  top: 45%;
  left: 0;
  width: 200%;
  transform: translateY(-50%);
  font-family: var(--font-display);
  font-size: 14rem;
  font-weight: 700;
  color: rgba(181, 137, 61, 0.03);
  letter-spacing: 30px;
  white-space: nowrap;
  user-select: none;
  animation: atm-ghost-drift 40s linear infinite;
}

.atm-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  will-change: transform;
}

.atm-vignette {
  position: absolute;
  inset: 0;
  background: var(--vignette);
}

@keyframes atm-ghost-drift {
  0% {
    transform: translate(0, -50%);
  }
  100% {
    transform: translate(-50%, -50%);
  }
}
</style>
