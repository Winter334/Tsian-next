<script setup lang="ts">
/**
 * SetupStepper — 5 节点横向 stepper（燃烧烛芯方案 v2）。
 *
 * 视觉概念：一根贯通屏幕的烛芯，从左端开始燃烧。
 * - 已点燃段（完成）：ember 渐变线 + 火焰沿烛芯传播的光脉动效
 * - 燃烧前沿（当前）：大火苗 + 光晕呼吸 + 火星飞溅
 * - 未点燃段（未完成）：暗 whisper 实线（不用虚线）
 *
 * 结构：一根绝对定位贯通全屏的烛芯基线 + 5 个等距节点定位在烛芯上。
 * 线和点在同一个坐标系内层叠，天然连接。两端延伸到屏幕尽头。
 */
const props = defineProps<{
  /** 当前步骤索引 0-4 */
  current: number
  /** 已完成到第几步（-1 = 都没完成） */
  completedUntil: number
}>()

const STEPS = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]

/** 节点状态：done 已点燃 / current 燃烧前沿 / locked 未点燃 */
function markStatus(i: number): "done" | "current" | "locked" {
  if (i === props.current) return "current"
  if (i <= props.completedUntil) return "done"
  return "locked"
}

/** 烛芯线段状态：lit 已点燃 / unlit 未点燃 */
function wickStatus(i: number): "lit" | "unlit" {
  // 线段 i 连接节点 i → i+1
  // 如果 i+1 是 current 或 done，说明火已经烧过了这段
  if (i + 1 <= props.current) return "lit"
  return "unlit"
}
</script>

<template>
  <div class="fuse-stepper">
    <!-- 烛芯基线：贯通到屏幕尽头，绝对定位 -->
    <div class="wick-base" />

    <!-- 已点燃段：从第一个节点到当前节点，覆盖在基线上方 -->
    <div
      class="wick-lit"
      :style="{ width: `${(current / (STEPS.length - 1)) * 100}%` }"
    >
      <!-- 光脉冲：沿已点燃段从左到右传播 -->
      <div class="wick-pulse" />
    </div>

    <!-- 节点层：5 个等距节点定位在烛芯上 -->
    <div class="fuse-nodes">
      <template v-for="(step, i) in STEPS" :key="i">
        <!-- 节点标记 -->
        <div class="fuse-mark" :class="markStatus(i)">
          <!-- 已点燃节点：小火苗 -->
          <div v-if="markStatus(i) === 'done'" class="flame-small">
            <div class="flame-small-outer" />
            <div class="flame-small-inner" />
            <span class="spark-sm spark-sm-1" />
            <span class="spark-sm spark-sm-2" />
          </div>

          <!-- 燃烧前沿：大火苗 -->
          <div v-else-if="markStatus(i) === 'current'" class="flame-big">
            <div class="flame-big-glow" />
            <div class="flame-big-outer" />
            <div class="flame-big-mid" />
            <div class="flame-big-inner" />
            <span class="spark spark-1" />
            <span class="spark spark-2" />
            <span class="spark spark-3" />
            <span class="spark spark-4" />
          </div>

          <!-- 未点燃烛芯头 -->
          <div v-else class="wick-tip" />
        </div>

        <!-- 标签 -->
        <span class="fuse-label" :class="markStatus(i)">{{ step }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.fuse-stepper {
  position: relative;
  width: 100%;
  padding: 48px 0 20px;
  /* 内部用绝对定位，需要足够高度容纳火苗 + 标签 */
  min-height: 90px;
}

/* ══ 烛芯基线：贯通到屏幕尽头 ══ */
.wick-base {
  position: absolute;
  top: 36px; /* 烛芯垂直位置（节点中心线） */
  left: 0;
  right: 0;
  height: 2px;
  background: var(--whisper);
  opacity: 0.3;
  border-radius: 1px;
}

/* ══ 已点燃段：覆盖在基线上方 ══ */
.wick-lit {
  position: absolute;
  top: 36px;
  left: 0;
  height: 2px;
  background: linear-gradient(
    90deg,
    rgba(181, 137, 61, 0.4) 0%,
    var(--ember) 30%,
    var(--ember-bright) 80%,
    var(--ember-bright) 100%
  );
  border-radius: 1px;
  box-shadow: 0 0 6px rgba(232, 169, 72, 0.3);
  overflow: hidden;
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 光脉冲：沿已点燃段从左到右循环传播 */
.wick-pulse {
  position: absolute;
  top: 0;
  left: 0;
  width: 20%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 220, 150, 0.8) 50%,
    transparent 100%
  );
  animation: pulse-propagate 3s ease-in-out infinite;
}
@keyframes pulse-propagate {
  0% { transform: translateX(-100%); opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateX(500%); opacity: 0; }
}

/* ══ 节点层：5 个等距节点 ══ */
.fuse-nodes {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0 24px; /* 留出首尾节点空间 */
}

.fuse-mark {
  position: relative;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 节点中心对齐到烛芯线上（烛芯 top:36px，stepper padding-top:48px，
     节点高 24px，中心 = 48 + 12 = 60px，需偏移使中心到 36px → margin-top: -24px） */
  margin-top: -24px;
  overflow: visible;
  z-index: 2;
}

.fuse-label {
  position: absolute;
  top: 16px; /* 在节点下方 */
  width: 80px;
  margin-left: -28px; /* 居中到 24px 节点上：(80-24)/2 = 28 */
  text-align: center;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--prose-dim);
  white-space: nowrap;
  transition: color 0.3s, text-shadow 0.3s;
  z-index: 1;
}

/* ══ 未点燃烛芯头 ══ */
.wick-tip {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: 1px solid var(--whisper);
  background: var(--void);
  opacity: 0.5;
}

/* ══ 已点燃节点：小火苗 ══ */
.flame-small {
  position: absolute;
  bottom: 50%;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 16px;
}
.flame-small-outer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: radial-gradient(
    ellipse 55% 75% at center 85%,
    var(--ember) 0%,
    rgba(181, 137, 61, 0.5) 40%,
    transparent 100%
  );
  border-radius: 25% 25% 50% 50% / 35% 35% 65% 65%;
  filter: blur(0.3px);
  animation: flame-sway-small 0.2s ease-in-out infinite alternate;
}
.flame-small-inner {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 5px;
  height: 10px;
  background: radial-gradient(
    ellipse 55% 70% at center 80%,
    var(--ember-bright) 0%,
    transparent 100%
  );
  border-radius: 30% 30% 50% 50% / 40% 40% 60% 60%;
  filter: blur(0.2px);
  animation: flame-sway-small 0.17s ease-in-out infinite alternate-reverse;
}
@keyframes flame-sway-small {
  0% { transform: scale(1, 1) rotate(-1deg); }
  100% { transform: scale(0.92, 1.08) rotate(1deg); }
}
/* 内焰保留 translateX(-50%) */
.flame-small-inner {
  animation-name: flame-sway-small-inner;
}
@keyframes flame-sway-small-inner {
  0% { transform: translateX(-50%) scale(1, 1) rotate(0.8deg); }
  100% { transform: translateX(-50%) scale(0.92, 1.08) rotate(-1deg); }
}

/* 小火星 */
.spark-sm {
  position: absolute;
  width: 1px;
  height: 1px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 2px var(--ember);
  bottom: 6px;
  left: 50%;
}
.spark-sm-1 {
  animation: spark-fly-sm 2.5s ease-out infinite;
  --dx: 3px;
}
.spark-sm-2 {
  animation: spark-fly-sm 2.5s ease-out infinite 1.2s;
  --dx: -2px;
}
@keyframes spark-fly-sm {
  0% { opacity: 0; transform: translate(-50%, 0); }
  15% { opacity: 0.8; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 3px)), -12px); }
}

/* ══ 燃烧前沿：大火苗 ══ */
.flame-big {
  position: absolute;
  bottom: 50%;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 38px;
}

/* 光晕：火焰底部的光池 */
.flame-big-glow {
  position: absolute;
  bottom: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 44px;
  height: 24px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(232, 169, 72, 0.3) 0%,
    rgba(232, 169, 72, 0.1) 50%,
    transparent 70%
  );
  animation: big-glow-breathe 2s ease-in-out infinite;
}
@keyframes big-glow-breathe {
  0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.3); }
}

/* 外焰：最大层，ember → blood → 透明 */
.flame-big-outer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: radial-gradient(
    ellipse 55% 75% at center 85%,
    var(--ember-bright) 0%,
    var(--ember) 25%,
    var(--blood) 55%,
    transparent 100%
  );
  border-radius: 25% 25% 50% 50% / 35% 35% 65% 65%;
  filter: blur(0.5px);
  animation: big-flame-sway 0.18s ease-in-out infinite alternate;
}

/* 中焰：ember-bright 主体 */
.flame-big-mid {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 28px;
  background: radial-gradient(
    ellipse 55% 70% at center 80%,
    var(--ember-bright) 0%,
    var(--ember) 50%,
    transparent 100%
  );
  border-radius: 28% 28% 50% 50% / 38% 38% 62% 62%;
  filter: blur(0.3px);
  animation: big-flame-sway 0.16s ease-in-out infinite alternate-reverse;
}

/* 内焰：白 → ember-bright，亮度核心 */
.flame-big-inner {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 18px;
  background: radial-gradient(
    ellipse 55% 70% at center 80%,
    #fff 0%,
    var(--ember-bright) 40%,
    transparent 100%
  );
  border-radius: 30% 30% 50% 50% / 40% 40% 60% 60%;
  filter: blur(0.2px);
  animation: big-flame-sway-inner 0.14s ease-in-out infinite alternate;
}

@keyframes big-flame-sway {
  0% { transform: scale(1, 1) rotate(-1.5deg); }
  100% { transform: scale(0.92, 1.08) rotate(1.5deg); }
}
@keyframes big-flame-sway-inner {
  0% { transform: translateX(-50%) scale(1, 1) rotate(1deg); }
  100% { transform: translateX(-50%) scale(0.92, 1.08) rotate(-1.5deg); }
}

/* 大火星飞溅 */
.spark {
  position: absolute;
  width: 2px;
  height: 2px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 3px var(--ember-bright);
  bottom: 14px;
  left: 50%;
}
.spark-1 {
  animation: spark-fly 2s ease-out infinite;
  --dx: 6px;
}
.spark-2 {
  animation: spark-fly 2s ease-out infinite 0.5s;
  --dx: -5px;
}
.spark-3 {
  animation: spark-fly 2s ease-out infinite 1s;
  --dx: 3px;
}
.spark-4 {
  animation: spark-fly 2s ease-out infinite 1.5s;
  --dx: -4px;
}
@keyframes spark-fly {
  0% { opacity: 0; transform: translate(-50%, 0) scale(0.5); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 6px)), -24px) scale(0.2); }
}

/* ══ 标签 ══ */
.fuse-label.current {
  color: var(--ember-bright);
  text-shadow: 0 0 8px rgba(232, 169, 72, 0.4);
}
.fuse-label.done {
  color: var(--ember);
}
.fuse-label.locked {
  color: var(--whisper);
}
</style>
