<script setup lang="ts">
/**
 * SetupStepper — 5 节点横向 stepper（燃烧烛芯方案）。
 *
 * 视觉概念：一根连续的烛芯，火苗在当前步骤燃烧，左侧已燃尽成灰烬，右侧未点燃。
 * 不是"圆点+直线"的分离结构，而是一根有机的烛芯——步骤是烛芯上的不同状态。
 *
 * 三段状态：
 * - 灰烬段（已完成）：暗 ember 线 + 余温微光 + 缓慢飘升的微光粒子
 * - 燃烧点（当前）：CSS 双层火焰（外焰+内焰）+ 光晕呼吸 + 火星飞溅
 * - 未点燃段（未完成）：whisper 虚线纹理
 *
 * 对齐保证：track 和 labels 用完全相同的 flex 结构（固定宽度 + flex:1 交替），
 * 从布局层面保证 mark 和 label 水平对齐，不依赖任何硬编码像素偏移。
 */
const props = defineProps<{
  /** 当前步骤索引 0-4 */
  current: number
  /** 已完成到第几步（-1 = 都没完成） */
  completedUntil: number
}>()

const STEPS = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]

/** 节点状态：done 已燃尽 / current 正在燃烧 / locked 未点燃 */
function markStatus(i: number): "done" | "current" | "locked" {
  if (i === props.current) return "current"
  if (i <= props.completedUntil) return "done"
  return "locked"
}

/** 烛芯线段状态：done 已燃尽 / unlit 未点燃 */
function wickStatus(i: number): "done" | "unlit" {
  // 线段 i 连接节点 i → i+1
  // 如果 i+1 是 current 或 done，说明火已经烧过了这段
  if (i + 1 <= props.current) return "done"
  return "unlit"
}
</script>

<template>
  <div class="fuse-stepper">
    <!-- 轨道层：mark + wick 交替，flex center 对齐 -->
    <div class="fuse-track">
      <template v-for="(step, i) in STEPS" :key="i">
        <!-- 节点 -->
        <div class="fuse-mark" :class="markStatus(i)">
          <!-- 灰烬光斑（完成态） -->
          <div v-if="markStatus(i) === 'done'" class="ember-dot">
            <span class="ember-particle" />
          </div>

          <!-- 火苗（当前态） -->
          <div v-else-if="markStatus(i) === 'current'" class="flame">
            <div class="flame-glow" />
            <div class="flame-outer" />
            <div class="flame-inner" />
            <span class="spark spark-1" />
            <span class="spark spark-2" />
            <span class="spark spark-3" />
          </div>

          <!-- 未点燃烛芯头（锁定态） -->
          <div v-else class="wick-tip" />
        </div>

        <!-- 烛芯线段（最后一个节点后没有线段） -->
        <div
          v-if="i < STEPS.length - 1"
          class="fuse-wick"
          :class="wickStatus(i)"
        />
      </template>
    </div>

    <!-- 标签层：与 track 完全相同的 flex 结构，自然对齐 -->
    <div class="fuse-labels">
      <template v-for="(step, i) in STEPS" :key="i">
        <span class="fuse-label" :class="markStatus(i)">{{ step }}</span>
        <span v-if="i < STEPS.length - 1" class="fuse-spacer" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.fuse-stepper {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 36px 24px 20px;
}

/* ══ 轨道层：mark + wick 交替 ══ */
.fuse-track {
  display: flex;
  align-items: center;
}

.fuse-mark {
  position: relative;
  width: 80px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.fuse-wick {
  flex: 1;
  height: 2px;
  position: relative;
  border-radius: 1px;
  overflow: visible;
}

/* ══ 烛芯线段：灰烬段（已燃尽）══ */
.fuse-wick.done {
  background: linear-gradient(
    90deg,
    rgba(181, 137, 61, 0.35),
    rgba(181, 137, 61, 0.55),
    rgba(181, 137, 61, 0.35)
  );
  box-shadow: 0 0 3px rgba(181, 137, 61, 0.15);
}
/* 灰烬段上缓慢飘升的微光粒子 */
.fuse-wick.done::before,
.fuse-wick.done::after {
  content: "";
  position: absolute;
  top: -3px;
  width: 1px;
  height: 1px;
  border-radius: 50%;
  background: var(--ember);
  box-shadow: 0 0 2px var(--ember);
}
.fuse-wick.done::before {
  left: 35%;
  animation: wick-ember 4s ease-out infinite;
}
.fuse-wick.done::after {
  left: 70%;
  animation: wick-ember 4s ease-out infinite 2s;
}
@keyframes wick-ember {
  0% { opacity: 0; transform: translateY(0); }
  30% { opacity: 0.5; }
  100% { opacity: 0; transform: translateY(-8px); }
}

/* ══ 烛芯线段：未点燃段 ══ */
.fuse-wick.unlit {
  background: repeating-linear-gradient(
    90deg,
    var(--whisper) 0,
    var(--whisper) 2px,
    transparent 2px,
    transparent 6px
  );
  opacity: 0.35;
}

/* ══ 灰烬光斑（完成态节点）══ */
.ember-dot {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--ember) 0%,
    rgba(181, 137, 61, 0.4) 60%,
    transparent 100%
  );
  box-shadow: 0 0 6px rgba(181, 137, 61, 0.3);
}
/* 灰烬光斑上微光粒子 */
.ember-particle {
  position: absolute;
  top: -3px;
  left: 50%;
  width: 1px;
  height: 1px;
  border-radius: 50%;
  background: var(--ember);
  box-shadow: 0 0 2px var(--ember);
  animation: ember-dot-rise 3s ease-out infinite;
}
@keyframes ember-dot-rise {
  0% { opacity: 0; transform: translate(-50%, 0); }
  25% { opacity: 0.7; }
  100% { opacity: 0; transform: translate(-50%, -12px); }
}

/* ══ 未点燃烛芯头（锁定态节点）══ */
.wick-tip {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  border: 1px solid var(--whisper);
  background: var(--void);
  opacity: 0.4;
}

/* ══ 火苗（当前态节点）══ */
.flame {
  position: absolute;
  bottom: 50%; /* 底部对齐到 mark 中心（烛芯线上） */
  left: 50%;
  transform: translateX(-50%);
  width: 14px;
  height: 22px;
}

/* 光晕：火焰底部的光池 */
.flame-glow {
  position: absolute;
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 16px;
  border-radius: 50%;
  background: radial-gradient(
    ellipse at center,
    rgba(232, 169, 72, 0.25) 0%,
    transparent 70%
  );
  animation: glow-breathe 2s ease-in-out infinite;
}
@keyframes glow-breathe {
  0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
  50% { opacity: 1; transform: translateX(-50%) scale(1.25); }
}

/* 外焰：ember → 透明，较大 */
.flame-outer {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: radial-gradient(
    ellipse 55% 75% at center 85%,
    var(--ember-bright) 0%,
    var(--ember) 30%,
    rgba(155, 58, 46, 0.5) 60%,
    transparent 100%
  );
  border-radius: 25% 25% 50% 50% / 35% 35% 65% 65%;
  /* 上尖下圆：左上右上小值(尖)，左下右下大值(圆) */
  filter: blur(0.4px);
  animation: flame-sway 0.18s ease-in-out infinite alternate;
}

/* 内焰：白 → ember-bright，较小，亮度核心 */
.flame-inner {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 7px;
  height: 13px;
  background: radial-gradient(
    ellipse 55% 70% at center 80%,
    #fff 0%,
    var(--ember-bright) 35%,
    transparent 100%
  );
  border-radius: 30% 30% 50% 50% / 40% 40% 60% 60%;
  filter: blur(0.3px);
  animation: flame-sway 0.15s ease-in-out infinite alternate-reverse;
}

@keyframes flame-sway {
  0% { transform: scale(1, 1) rotate(-1.5deg); }
  100% { transform: scale(0.93, 1.08) rotate(1.5deg); }
}
/* 内焰保留 translateX(-50%)，单独的 keyframe */
.flame-inner {
  animation-name: flame-sway-inner;
}
@keyframes flame-sway-inner {
  0% { transform: translateX(-50%) scale(1, 1) rotate(1deg); }
  100% { transform: translateX(-50%) scale(0.93, 1.08) rotate(-1.5deg); }
}

/* 火星飞溅 */
.spark {
  position: absolute;
  width: 1.5px;
  height: 1.5px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 3px var(--ember-bright);
  bottom: 8px;
  left: 50%;
}
.spark-1 {
  animation: spark-fly 2s ease-out infinite;
  --dx: 4px;
}
.spark-2 {
  animation: spark-fly 2s ease-out infinite 0.7s;
  --dx: -3px;
}
.spark-3 {
  animation: spark-fly 2s ease-out infinite 1.3s;
  --dx: 2px;
}
@keyframes spark-fly {
  0% { opacity: 0; transform: translate(-50%, 0) scale(0.5); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx, 4px)), -18px) scale(0.2); }
}

/* ══ 标签层：与 track 结构完全一致 ══ */
.fuse-labels {
  display: flex;
  margin-top: 12px;
}

.fuse-label {
  width: 80px;  /* 与 fuse-mark 同宽，自然对齐 */
  flex-shrink: 0;
  text-align: center;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--prose-dim);
  white-space: nowrap;
  transition: color 0.3s, text-shadow 0.3s;
}

.fuse-spacer {
  flex: 1;  /* 与 fuse-wick 同 flex，自然对齐 */
}

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
