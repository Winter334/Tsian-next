<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue"
import gsap from "gsap"

/**
 * SetupStepper — 5 节点横向 stepper（火脉涌动方案）。
 *
 * 视觉语言：圆点 + 火焰呼吸光晕 + ember 光脉连线（流动光效）。
 * - 完成态：ember 实心圆 + 微光粒子上升
 * - 当前态：ember-bright 圆 + 火焰呼吸 + 光晕扩散
 * - 锁定态：whisper 空心圆
 * - 连线：完成段 ember 光脉 + 流动光带扫过（呼应 Composer ink-sweep）
 *
 * 呼应 Composer 的烛火辉光 + ink-sweep 流动光效语言。
 */
const props = defineProps<{
  /** 当前步骤索引 0-4 */
  current: number
  /** 已完成到第几步（-1 = 都没完成） */
  completedUntil: number
}>()

const STEPS = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]

const fillRef = ref<HTMLElement | null>(null)
const sweepRef = ref<HTMLElement | null>(null)
const currentNodeRef = ref<HTMLElement | null>(null)

// GSAP 连线填充：current 变化时 scaleX 动画
watch(
  () => props.current,
  async (idx) => {
    await nextTick()
    if (!fillRef.value) return
    const ratio = STEPS.length > 1 ? idx / (STEPS.length - 1) : 0
    gsap.to(fillRef.value, {
      scaleX: ratio,
      duration: 0.6,
      ease: "power2.out",
    })
  },
  { immediate: true },
)

// 流动光带：完成段有光带扫过（持续循环）
watch(
  () => [props.current, props.completedUntil] as const,
  async () => {
    await nextTick()
    if (sweepRef.value) {
      gsap.killTweensOf(sweepRef.value)
      // 光带从左到右循环扫过 fill 区域
      gsap.fromTo(
        sweepRef.value,
        { xPercent: -100 },
        { xPercent: 300, duration: 3, ease: "none", repeat: -1, repeatDelay: 1.5 },
      )
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  if (fillRef.value) gsap.killTweensOf(fillRef.value)
  if (sweepRef.value) gsap.killTweensOf(sweepRef.value)
})
</script>

<template>
  <nav class="setup-stepper" aria-label="向导步骤">
    <!-- 轨道：贯通到屏幕尽头，极淡基线 -->
    <span class="stepper-track" aria-hidden="true" />

    <!-- 节点群：居中聚拢，承载 fill 进度线 + 流动光带 -->
    <ol class="stepper-nodes">
      <!-- fill 进度线：ember 光脉，scaleX 从左原点增长 -->
      <span ref="fillRef" class="stepper-fill" aria-hidden="true">
        <!-- 流动光带：完成段循环扫过的亮带 -->
        <span ref="sweepRef" class="fill-sweep" aria-hidden="true" />
      </span>

      <li
        v-for="(label, i) in STEPS"
        :key="i"
        class="stepper-node"
        :class="{
          done: i <= completedUntil && i !== current,
          current: i === current,
          locked: i > completedUntil,
        }"
      >
        <!-- 节点圆点 + 光晕层 -->
        <span class="node-orb">
          <!-- 光晕扩散层（当前态火焰呼吸） -->
          <span v-if="i === current" class="orb-halo" aria-hidden="true" />
          <!-- 微光粒子上升层（完成态） -->
          <span v-if="i <= completedUntil && i !== current" class="orb-ember" aria-hidden="true" />
          <!-- 核心圆点 -->
          <span class="orb-core" />
          <!-- 完成勾 -->
          <svg
            v-if="i <= completedUntil && i !== current"
            class="orb-check"
            viewBox="0 0 12 12"
            aria-hidden="true"
          >
            <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="node-label">{{ label }}</span>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.setup-stepper {
  position: relative;
  width: 100%;
  padding: 28px 0 20px;
  display: flex;
  justify-content: center;
}

/* 贯通轨道基线：从屏幕左到右，极淡 */
.stepper-track {
  position: absolute;
  top: 41px; /* 对齐 orb 圆心 */
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line);
}

/* 节点群：居中聚拢 */
.stepper-nodes {
  position: relative;
  display: flex;
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  max-width: 640px;
  justify-content: space-between;
}

/* fill 进度线：ember 光脉 */
.stepper-fill {
  position: absolute;
  top: 13px; /* orb 圆心相对 ol 顶部 */
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    var(--ember) 0%,
    var(--ember-bright) 50%,
    var(--ember) 100%
  );
  transform-origin: left center;
  transform: scaleX(0);
  border-radius: 1px;
  box-shadow: 0 0 8px rgba(232, 169, 72, 0.4);
  overflow: hidden;
}

/* 流动光带：在 fill 区域内循环扫过 */
.fill-sweep {
  position: absolute;
  top: 0;
  left: 0;
  width: 30%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(232, 169, 72, 0.6) 50%,
    transparent 100%
  );
}

/* ── 单个节点 ── */
.stepper-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  position: relative;
  z-index: 1;
}

/* 圆点容器 */
.node-orb {
  position: relative;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 核心圆点 */
.orb-core {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1.5px solid var(--whisper);
  background: var(--void);
  transition: border-color 0.3s, background 0.3s, box-shadow 0.3s;
  z-index: 2;
}

/* ── 完成态：ember 实心 + 勾 ── */
.stepper-node.done .orb-core {
  border-color: var(--ember);
  background: var(--ember);
  box-shadow: 0 0 6px rgba(181, 137, 61, 0.3);
}
.orb-check {
  position: absolute;
  width: 10px;
  height: 10px;
  color: var(--void-deep);
  z-index: 3;
}

/* 微光粒子上升（完成态，纯 CSS） */
.orb-ember {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--ember-bright);
  transform: translateX(-50%);
  opacity: 0;
  animation: ember-rise 2.5s ease-out infinite;
  z-index: 1;
}
.orb-ember::before,
.orb-ember::after {
  content: "";
  position: absolute;
  width: 1.5px;
  height: 1.5px;
  border-radius: 50%;
  background: var(--ember);
  opacity: 0.6;
}
.orb-ember::before {
  top: -3px;
  left: 3px;
  animation: ember-rise 2.5s ease-out infinite 0.4s;
}
.orb-ember::after {
  top: -2px;
  left: -3px;
  animation: ember-rise 2.5s ease-out infinite 0.8s;
}
@keyframes ember-rise {
  0% { opacity: 0; transform: translate(-50%, 0); }
  20% { opacity: 0.8; }
  100% { opacity: 0; transform: translate(-50%, -14px); }
}

/* ── 当前态：ember-bright + 火焰呼吸光晕 ── */
.stepper-node.current .orb-core {
  border-color: var(--ember-bright);
  background: var(--ember-bright);
  box-shadow:
    0 0 10px rgba(232, 169, 72, 0.5),
    inset 0 0 4px rgba(255, 220, 150, 0.4);
  animation: orb-breathe 2s ease-in-out infinite;
}
@keyframes orb-breathe {
  0%, 100% {
    box-shadow: 0 0 8px rgba(232, 169, 72, 0.4), inset 0 0 3px rgba(255, 220, 150, 0.3);
  }
  50% {
    box-shadow: 0 0 18px rgba(232, 169, 72, 0.7), 0 0 4px rgba(232, 169, 72, 0.4), inset 0 0 6px rgba(255, 220, 150, 0.5);
  }
}

/* 光晕扩散层（当前态） */
.orb-halo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid var(--ember-bright);
  transform: translate(-50%, -50%);
  opacity: 0;
  animation: halo-pulse 2s ease-out infinite;
  z-index: 0;
}
@keyframes halo-pulse {
  0% { width: 12px; height: 12px; opacity: 0.6; }
  100% { width: 32px; height: 32px; opacity: 0; }
}

/* ── 锁定态：whisper 空心 ── */
.stepper-node.locked .orb-core {
  border-color: var(--whisper);
  background: var(--void);
}

/* ── 标签文字 ── */
.node-label {
  font-family: var(--font-serif);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--prose-dim);
  white-space: nowrap;
  transition: color 0.3s, text-shadow 0.3s;
}
.stepper-node.current .node-label {
  color: var(--ember-bright);
  text-shadow: 0 0 8px rgba(232, 169, 72, 0.3);
}
.stepper-node.done .node-label {
  color: var(--ember);
}
.stepper-node.locked .node-label {
  color: var(--whisper);
}
</style>
