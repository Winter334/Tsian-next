<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"

/**
 * UnderstandingRunning — 初始理解进行中（加载动画）。
 *
 * 设计：本质是加载阶段。视觉 = ember 光带循环扫过 + 分阶段时间文案 +
 * agent 心跳脉冲（光团闪一下，体现"它还活着"，不显示具体内容）。
 *
 * 不暴露 world-architect。分阶段文案按经过时间推进（时间 fallback，
 * agent 实际进度不可知）。
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

// agent 心跳脉冲：心跳计数变化时触发光团脉冲
const pulseKey = ref(0)
watch(agentHeartbeat, () => {
  pulseKey.value++
})
</script>

<template>
  <div class="understanding-running">
    <!-- 中央加载区 -->
    <div class="loading-core">
      <!-- 烛火核心：节律性明灭，像一盏被规律拨动的烛火 -->
      <div class="ember-core" :key="pulseKey">
        <div class="ember-flame" />
        <div class="ember-halo" />
        <div class="ember-ring" />
      </div>

      <!-- ember 光带：循环扫过（不确定进度型） -->
      <div class="loading-bar">
        <div class="bar-track" />
        <div class="bar-sweep" />
      </div>

      <!-- 分阶段文案 -->
      <Transition name="stage-fade" mode="out-in">
        <p :key="currentStage" class="stage-text">{{ STAGES[currentStage] }}</p>
      </Transition>

      <!-- 固定提示：处理需要时间 -->
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
  padding: 60px 20px;
  min-height: 280px;
}

.loading-core {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

/* ── 烛火核心：节律性明灭 ── */
/* 设计思路：不是小光点微微呼吸，而是一盏有体量的烛火——
   火焰本身随心跳节律明暗伸缩（1.2s 周期，像平稳心跳），
   外层光晕同步扩散收缩，脉冲环在 agent activity 时额外扩散。
   整体 60px 区域，在 280px 容器里存在感强。 */
.ember-core {
  position: relative;
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 火焰核心：ember-bright 发光体，心跳节律明灭 */
.ember-flame {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--ember-bright) 0%,
    var(--ember) 50%,
    rgba(181, 137, 61, 0.3) 80%,
    transparent 100%
  );
  box-shadow:
    0 0 20px rgba(232, 169, 72, 0.5),
    0 0 40px rgba(232, 169, 72, 0.2);
  animation: flame-heartbeat 1.2s ease-in-out infinite;
  z-index: 2;
}
@keyframes flame-heartbeat {
  0%, 100% {
    transform: scale(0.85);
    box-shadow: 0 0 14px rgba(232, 169, 72, 0.35), 0 0 28px rgba(232, 169, 72, 0.12);
    opacity: 0.8;
  }
  15% {
    transform: scale(1.15);
    box-shadow: 0 0 28px rgba(232, 169, 72, 0.7), 0 0 56px rgba(232, 169, 72, 0.3);
    opacity: 1;
  }
  30% {
    transform: scale(1.0);
    box-shadow: 0 0 22px rgba(232, 169, 72, 0.55), 0 0 44px rgba(232, 169, 72, 0.2);
    opacity: 0.95;
  }
  45% {
    transform: scale(1.08);
    box-shadow: 0 0 24px rgba(232, 169, 72, 0.6), 0 0 48px rgba(232, 169, 72, 0.22);
    opacity: 1;
  }
}

/* 光晕：同步呼吸，比火焰大一圈 */
.ember-halo {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(232, 169, 72, 0.12) 0%,
    rgba(232, 169, 72, 0.05) 50%,
    transparent 70%
  );
  animation: halo-breathe 1.2s ease-in-out infinite;
  z-index: 1;
}
@keyframes halo-breathe {
  0%, 100% { transform: scale(0.9); opacity: 0.5; }
  15% { transform: scale(1.3); opacity: 0.9; }
  30% { transform: scale(1.1); opacity: 0.7; }
  45% { transform: scale(1.2); opacity: 0.8; }
}

/* 脉冲环：agent activity 时额外扩散（key 变化重新挂载） */
.ember-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1.5px solid var(--ember-bright);
  transform: translate(-50%, -50%);
  animation: ring-burst 1.5s ease-out;
  z-index: 3;
}
@keyframes ring-burst {
  0% { width: 22px; height: 22px; opacity: 0.8; border-width: 2px; }
  100% { width: 90px; height: 90px; opacity: 0; border-width: 0.5px; }
}

/* ── ember 光带加载条 ── */
.loading-bar {
  position: relative;
  width: 200px;
  height: 2px;
  overflow: hidden;
  border-radius: 1px;
}

/* 轨道：暗 ember 底色 */
.bar-track {
  position: absolute;
  inset: 0;
  background: rgba(181, 137, 61, 0.12);
  border-radius: 1px;
}

/* 光带扫过：ember-bright 渐变循环 */
.bar-sweep {
  position: absolute;
  top: 0;
  left: 0;
  width: 40%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--ember) 30%,
    var(--ember-bright) 50%,
    var(--ember) 70%,
    transparent 100%
  );
  border-radius: 1px;
  animation: bar-sweep 1.8s ease-in-out infinite;
}
@keyframes bar-sweep {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

/* ── 分阶段文案 ── */
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

/* ── 固定提示：处理需要时间 ── */
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
