<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"

/**
 * UnderstandingRunning — 初始理解进行中。
 *
 * 视觉意象「翻卷烛照」：暗室中一盏烛火，正在逐行阅读一卷古书。
 * 烛火摇曳投光 → 书卷行依次被照亮（亮起→褪去循环）→ 底部提示。
 * agent activity 时烛火闪一下 + 光环扩散，像翻了一页。
 *
 * 不暴露 world-architect。分阶段文案按经过时间推进（agent 实际进度不可知）。
 */
const { agentHeartbeat, understandingStartedAt } = useSetupState()

// 分阶段文案（对应 skill 三步 + 写入，不暴露 agent 名称）
const STAGES = [
  "正在观察导入结构…",
  "正在阅读开头剧情…",
  "正在整理开局资料…",
  "正在写入…",
]
const STAGE_INTERVAL = 12_000 // 每 12s 推进一阶段

const elapsedMs = ref(0)
const currentStage = computed(() => {
  if (!understandingStartedAt) return 0
  return Math.min(STAGES.length - 1, Math.floor(elapsedMs.value / STAGE_INTERVAL))
})

// 时间更新循环
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
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

// agent 心跳：触发烛火闪烁
const pulseKey = ref(0)
watch(agentHeartbeat, () => {
  pulseKey.value++
})
</script>

<template>
  <div class="understanding-running">
    <div class="reading-scene">
      <!-- 烛火 -->
      <div class="candle" :key="pulseKey">
        <div class="flame" />
        <div class="flame-glow" />
        <div class="page-flip-ring" />
      </div>

      <!-- 书卷行：依次被烛光照亮 -->
      <div class="scroll-lines">
        <div class="scroll-line" v-for="i in 5" :key="i" :style="{ '--line-i': i - 1 }" />
      </div>

      <!-- 分阶段文案 -->
      <Transition name="stage-fade" mode="out-in">
        <p :key="currentStage" class="stage-text">{{ STAGES[currentStage] }}</p>
      </Transition>

      <!-- 固定提示 -->
      <p class="duration-hint">
        <span class="hint-text">这可能需要一些时间，请稍候</span>
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
  padding: 50px 20px;
  min-height: 280px;
}

.reading-scene {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
}

/* ═══ 烛火 ═══ */
/* 一颗有体量的火焰：椭圆 + 摇曳 + 投光到下方书卷 */
.candle {
  position: relative;
  width: 50px;
  height: 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* 火焰本体：水滴形 ember-bright，摇曳 */
.flame {
  width: 18px;
  height: 28px;
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  background: radial-gradient(
    ellipse at 50% 70%,
    var(--ember-bright) 0%,
    var(--ember) 50%,
    rgba(181, 137, 61, 0.4) 80%,
    transparent 100%
  );
  box-shadow:
    0 0 18px rgba(232, 169, 72, 0.5),
    0 0 36px rgba(232, 169, 72, 0.2);
  transform-origin: center bottom;
  animation: flame-sway 2.5s ease-in-out infinite;
  margin-top: 6px;
}
@keyframes flame-sway {
  0%, 100% { transform: rotate(-2deg) scaleY(1) scaleX(1); }
  25% { transform: rotate(2deg) scaleY(1.08) scaleX(0.95); }
  50% { transform: rotate(-1deg) scaleY(0.95) scaleX(1.05); }
  75% { transform: rotate(1.5deg) scaleY(1.05) scaleX(0.97); }
}

/* 烛火光晕：投射到下方区域，呼吸 */
.flame-glow {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(232, 169, 72, 0.08) 0%,
    rgba(232, 169, 72, 0.04) 40%,
    transparent 70%
  );
  animation: glow-breathe 2.5s ease-in-out infinite;
  pointer-events: none;
}
@keyframes glow-breathe {
  0%, 100% { opacity: 0.6; transform: translateX(-50%) scale(0.95); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.1); }
}

/* 翻页光环：agent activity 时从烛火扩散（key 变化重新挂载） */
.page-flip-ring {
  position: absolute;
  top: 18px;
  left: 50%;
  width: 18px;
  height: 28px;
  border-radius: 50% 50% 50% 50% / 60% 60% 40% 40%;
  border: 1.5px solid var(--ember-bright);
  transform: translateX(-50%);
  animation: ring-burst 1.5s ease-out;
  pointer-events: none;
}
@keyframes ring-burst {
  0% { width: 18px; height: 28px; opacity: 0.7; }
  100% { width: 100px; height: 120px; opacity: 0; }
}

/* ═══ 书卷行 ═══ */
/* 5 条横线模拟书卷文字，依次被烛火照亮（亮起→褪去循环） */
.scroll-lines {
  display: flex;
  flex-direction: column;
  gap: 9px;
  align-items: center;
  width: 220px;
}

.scroll-line {
  width: 100%;
  height: 2px;
  border-radius: 1px;
  background: rgba(181, 137, 61, 0.1);
  /* 依次被照亮：每行错开 0.6s，整体 5s 循环 */
  animation: line-illuminate 5s ease-in-out infinite;
  animation-delay: calc(var(--line-i) * 0.6s);
}
@keyframes line-illuminate {
  0%, 100% {
    background: rgba(181, 137, 61, 0.1);
    box-shadow: none;
    height: 2px;
  }
  /* 被烛火扫过：变亮变粗 + 暖光晕 */
  10%, 30% {
    background: linear-gradient(90deg, transparent 0%, var(--ember) 20%, var(--ember-bright) 50%, var(--ember) 80%, transparent 100%);
    box-shadow: 0 0 8px rgba(232, 169, 72, 0.4);
    height: 3px;
  }
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
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--whisper);
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 2px;
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
  animation: hint-dot-pulse 1.8s ease-in-out infinite;
}
.hint-dot:nth-child(1) { animation-delay: 0s; }
.hint-dot:nth-child(2) { animation-delay: 0.3s; }
.hint-dot:nth-child(3) { animation-delay: 0.6s; }
@keyframes hint-dot-pulse {
  0%, 100% { opacity: 0.15; }
  50% { opacity: 0.8; }
}
</style>
