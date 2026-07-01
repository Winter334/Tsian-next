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
      <!-- 心跳光团：agent 有动作时脉冲一下 -->
      <div class="heartbeat-orb" :key="pulseKey">
        <div class="orb-center" />
        <div class="orb-ring" />
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

/* ── 心跳光团 ── */
.heartbeat-orb {
  position: relative;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 核心：ember-bright 发光球 */
.orb-center {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--ember-bright) 0%,
    var(--ember) 60%,
    transparent 100%
  );
  box-shadow: 0 0 16px rgba(232, 169, 72, 0.4);
  animation: orb-idle 3s ease-in-out infinite;
}
@keyframes orb-idle {
  0%, 100% { box-shadow: 0 0 10px rgba(232, 169, 72, 0.3); transform: scale(1); }
  50% { box-shadow: 0 0 20px rgba(232, 169, 72, 0.5); transform: scale(1.1); }
}

/* 心跳脉冲环：key 变化时重新挂载，播放一次扩散动画 */
.orb-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--ember-bright);
  transform: translate(-50%, -50%);
  animation: ring-pulse 1.2s ease-out;
}
@keyframes ring-pulse {
  0% { width: 14px; height: 14px; opacity: 0.7; }
  100% { width: 56px; height: 56px; opacity: 0; }
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
</style>
