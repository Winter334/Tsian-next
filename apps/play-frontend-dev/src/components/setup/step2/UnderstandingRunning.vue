<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import { generateMagicCircle } from "./magicCircleGenerator"

/**
 * UnderstandingRunning — 初始理解进行中。
 *
 * 随机 SVG 魔法阵：每次进入理解阶段生成一张新的术式图案。
 * 图案结构随机，配色固定使用 Tsian token；多层低频反向旋转，表达"术式解析中"。
 */
const { understandingStartedAt } = useSetupState()
const magicCircle = generateMagicCircle()

const STAGES = [
  "正在观察导入结构…",
  "正在阅读开头剧情…",
  "正在整理开局资料…",
  "正在写入…",
]
const STAGE_INTERVAL = 12_000

const elapsedMs = ref(0)
const currentStage = computed(() => {
  if (!understandingStartedAt) return 0
  return Math.min(STAGES.length - 1, Math.floor(elapsedMs.value / STAGE_INTERVAL))
})

let tickTimer = 0
watch(
  () => understandingStartedAt,
  (started) => {
    if (!started) return
    tickTimer = window.setInterval(() => {
      elapsedMs.value = Date.now() - started
    }, 500)
  },
  { immediate: true },
)

// 只需清理阶段文案计时器；SVG 动画由 CSS 驱动，组件卸载时自动停止。
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})
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

      <!-- 分阶段文案 -->
      <Transition name="stage-fade" mode="out-in">
        <p :key="currentStage" class="stage-text">{{ STAGES[currentStage] }}</p>
      </Transition>

      <!-- 固定提示 -->
      <p class="duration-hint">
        <span class="hint-text">正在处理开局资料，这可能需要一些时间</span>
        <span class="hint-dots" aria-hidden="true">
          <span class="hint-dot" />
          <span class="hint-dot" />
          <span class="hint-dot" />
        </span>
      </p>
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

/* ═══ 固定提示 ═══ */
.duration-hint {
  margin: -6px 0 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--whisper);
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 4px;
}
.hint-text {
  animation: hint-fade 0.6s ease 0.3s both;
}
@keyframes hint-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.hint-dots {
  display: inline-flex;
  gap: 2px;
}
.hint-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--ember);
  animation: hint-dot-pulse 1.8s ease-in-out infinite;
}
.hint-dot:nth-child(1) { animation-delay: 0s; }
.hint-dot:nth-child(2) { animation-delay: 0.3s; }
.hint-dot:nth-child(3) { animation-delay: 0.6s; }
@keyframes hint-dot-pulse {
  0%, 100% { opacity: 0.15; transform: translateY(0); }
  50% { opacity: 0.8; transform: translateY(-2px); }
}
</style>
