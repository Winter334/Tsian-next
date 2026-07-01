<script setup lang="ts">
import { ref, watch, nextTick, onUnmounted } from "vue"
import gsap from "gsap"

/**
 * SetupStepper — 5 节点横向 stepper。
 *
 * prd 向导共用骨架：完成态 --ember 实心+勾，当前态 --ember-bright 发光脉动，
 * 未实现 --whisper 空心；连线 GSAP scaleX 填充；节点文字 mono --prose-dim。
 * 无页头标题条，破出限宽容器延长到屏幕尽头。
 */
const props = defineProps<{
  /** 当前步骤索引 0-4 */
  current: number
  /** 已完成到第几步（-1 = 都没完成） */
  completedUntil: number
}>()

const STEPS = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]

const fillRef = ref<HTMLElement | null>(null)

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

onUnmounted(() => {
  if (fillRef.value) gsap.killTweensOf(fillRef.value)
})
</script>

<template>
  <nav class="setup-stepper" aria-label="向导步骤">
    <!-- 贯通到屏幕尽头的轨道线（装饰延长，不承载 fill） -->
    <span class="stepper-line" aria-hidden="true" />
    <!-- 节点群居中聚拢，内含精确对应节点位置的 fill 进度线 -->
    <ol class="stepper-nodes">
      <span ref="fillRef" class="stepper-fill" aria-hidden="true" />
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
        <span class="node-dot">
          <svg v-if="i <= completedUntil && i !== current" class="node-check" viewBox="0 0 12 12" aria-hidden="true">
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

/* 贯通轨道线：从屏幕左到右，极淡 */
.stepper-line {
  position: absolute;
  top: 41px; /* 对齐 node-dot 圆心（28px padding + ~13px 半高） */
  left: 0;
  right: 0;
  height: 1px;
  background: var(--line);
}

/* 节点群：居中聚拢 */
.stepper-nodes {
  position: relative;
  display: flex;
  gap: 0;
  list-style: none;
  margin: 0;
  padding: 0;
  /* 节点等距分布，总宽度撑满合理区域 */
  width: 100%;
  max-width: 640px;
  justify-content: space-between;
}

/* fill 进度线：精确对应节点位置，scaleX 从左原点增长 */
.stepper-fill {
  position: absolute;
  top: 13px; /* node-dot 圆心相对 ol 顶部 */
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    var(--ember) 0%,
    var(--ember-bright) 100%
  );
  transform-origin: left center;
  transform: scaleX(0);
  box-shadow: 0 0 6px rgba(232, 169, 72, 0.3);
}

/* 单个节点 */
.stepper-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
  z-index: 1;
}

/* 圆点 */
.node-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1.5px solid var(--whisper);
  background: var(--void);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.3s, background 0.3s, box-shadow 0.3s;
}

/* 完成态：ember 实心 + 勾 */
.stepper-node.done .node-dot {
  border-color: var(--ember);
  background: var(--ember);
  color: var(--void-deep);
}
.node-check {
  width: 10px;
  height: 10px;
}

/* 当前态：ember-bright 发光脉动 */
.stepper-node.current .node-dot {
  border-color: var(--ember-bright);
  background: var(--void-deep);
  box-shadow: 0 0 12px rgba(232, 169, 72, 0.5), inset 0 0 6px rgba(232, 169, 72, 0.2);
  animation: node-pulse 2s ease-in-out infinite;
}
@keyframes node-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(232, 169, 72, 0.35), inset 0 0 4px rgba(232, 169, 72, 0.1); }
  50% { box-shadow: 0 0 16px rgba(232, 169, 72, 0.6), inset 0 0 8px rgba(232, 169, 72, 0.3); }
}

/* 锁定态：whisper 空心 */
.stepper-node.locked .node-dot {
  border-color: var(--whisper);
  background: var(--void);
}

/* 标签文字 */
.node-label {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  color: var(--prose-dim);
  white-space: nowrap;
  transition: color 0.3s;
}
.stepper-node.current .node-label {
  color: var(--ember-bright);
}
.stepper-node.done .node-label {
  color: var(--ember);
}
.stepper-node.locked .node-label {
  color: var(--whisper);
}
</style>
