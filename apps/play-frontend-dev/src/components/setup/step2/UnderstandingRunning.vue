<script setup lang="ts">
import { useSetupState } from "../../../composables/useSetupState"
import { generateMagicCircle } from "./magicCircleGenerator"

/**
 * UnderstandingRunning — 初始理解进行中。
 *
 * 随机 SVG 魔法阵：每次进入理解阶段生成一张新的术式图案。
 * 图案结构随机，配色固定使用 Tsian token；多层低频反向旋转，表达"术式解析中"。
 *
 * 阶段文案由 useSetupState 的 understandingStage 驱动（onAgentInvocation tool 事件映射，
 * 单调推进），替代旧的 STAGE_INTERVAL 时间硬切。组件本身不持有计时逻辑。
 */
const { understandingStage } = useSetupState()
const magicCircle = generateMagicCircle()

const STAGES = [
  "正在观察导入结构…",
  "正在阅读开头剧情…",
  "正在整理开局资料…",
  "正在写入…",
  "导演正在校准剧情方向…",
]
</script>

<template>
  <div class="understanding-running">
    <div class="loading-core">
      <div class="magic-circle" aria-hidden="true">
        <svg class="magic-circle-svg" :viewBox="magicCircle.viewBox">
          <!-- Safe v-html: generated locally from fixed functions and fixed symbol sets; no user input. -->
          <g v-html="magicCircle.layers" />
        </svg>
      </div>

      <!-- 分阶段文案（事件驱动，单调推进） -->
      <Transition name="stage-fade" mode="out-in">
        <p :key="understandingStage" class="stage-text">{{ STAGES[understandingStage] }}</p>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.understanding-running {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 34px 20px 42px;
  min-height: 360px;
}

.loading-core {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
}

/* ═══ 随机魔法阵 ═══ */
.magic-circle {
  width: 260px;
  height: 260px;
  animation: circle-appear 0.9s cubic-bezier(.16, 1, .3, 1) both;
}

.magic-circle-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  filter:
    drop-shadow(0 0 3px rgba(232, 169, 72, 0.55))
    drop-shadow(0 0 13px rgba(181, 137, 61, 0.24))
    drop-shadow(0 0 28px rgba(155, 58, 46, 0.10));
}

.magic-circle-svg :deep(*) {
  vector-effect: non-scaling-stroke;
}

.magic-circle-svg :deep(.magic-layer) {
  transform-box: view-box;
  transform-origin: 256px 256px;
}

.magic-circle-svg :deep(.magic-layer--outer) {
  animation: rotate-cw 46s linear infinite;
}

.magic-circle-svg :deep(.magic-layer--text) {
  animation: rotate-ccw 62s linear infinite;
}

.magic-circle-svg :deep(.magic-layer--inner) {
  animation: rotate-cw 34s linear infinite;
}

.magic-circle-svg :deep(.magic-layer--core) {
  animation: core-breathe 3.8s ease-in-out infinite;
}

.magic-circle-svg :deep(.magic-rune) {
  letter-spacing: 0.08em;
}

@keyframes circle-appear {
  from { opacity: 0; transform: scale(.92) rotate(-8deg); filter: blur(2px); }
  55% { opacity: 1; transform: scale(1.025) rotate(1deg); filter: blur(0); }
  to { opacity: 1; transform: scale(1) rotate(0); filter: blur(0); }
}

@keyframes rotate-cw { to { transform: rotate(360deg); } }
@keyframes rotate-ccw { to { transform: rotate(-360deg); } }
@keyframes core-breathe {
  0%, 100% { opacity: .76; transform: scale(.985); }
  50% { opacity: 1; transform: scale(1.035); }
}

/* ═══ 分阶段文案 ═══ */
.stage-text {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.9rem;
  color: var(--prose-dim);
  letter-spacing: 0.04em;
  text-align: center;
}

.stage-fade-enter-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.stage-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.stage-fade-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.stage-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
