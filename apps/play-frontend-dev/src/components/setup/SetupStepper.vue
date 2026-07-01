<script setup lang="ts">
/**
 * SetupStepper — 5 节点横向 stepper（燃烧烛芯方案 v3）。
 *
 * 视觉概念：一根贯通屏幕的烛芯，节点聚拢居中。
 * - 已点燃段（完成）：ember 渐变线 + 光脉冲沿烛芯传播
 * - 燃烧前沿（当前）：ember-bright 光团 + 呼吸 + 光晕脉冲扩散
 * - 已点燃节点：ember 光点（稳定发光 + 微光粒子上升）
 * - 未点燃节点：whisper 暗点
 * - 未点燃段：whisper 暗实线
 *
 * 火焰用抽象光符号替代拟真火苗——避免 CSS 拟真火焰的廉价感。
 * 节点聚拢居中而非均匀分布全宽。
 */
const props = defineProps<{
  /** 当前步骤索引 0-4 */
  current: number
  /** 已完成到第几步（-1 = 都没完成） */
  completedUntil: number
}>()

const STEPS = ["导入小说", "初始理解", "角色设定", "游玩倾向", "开局确认"]
const NODE_GAP = 120 // 节点间距 px（聚拢居中）

/** 节点状态：done 已点燃 / current 燃烧前沿 / locked 未点燃 */
function markStatus(i: number): "done" | "current" | "locked" {
  if (i === props.current) return "current"
  if (i <= props.completedUntil) return "done"
  return "locked"
}
</script>

<template>
  <div class="fuse-stepper">
    <!-- 烛芯基线：贯通到屏幕尽头 -->
    <div class="wick-base" />

    <!-- 已点燃段：从节点群左端到当前节点，覆盖在基线上方 -->
    <div
      class="wick-lit"
      :style="{
        left: `calc(50% - ${NODE_GAP * 2}px)`,
        width: `${NODE_GAP * current}px`,
      }"
    >
      <div class="wick-pulse" />
    </div>

    <!-- 节点群：聚拢居中 -->
    <div class="fuse-nodes" :style="{ gap: `${NODE_GAP}px` }">
      <div
        v-for="(step, i) in STEPS"
        :key="i"
        class="fuse-node"
        :class="markStatus(i)"
      >
        <!-- 节点标记 -->
        <div class="fuse-mark">
          <!-- 已点燃：ember 光点 + 微光粒子 -->
          <div v-if="markStatus(i) === 'done'" class="ember-orb">
            <span class="ember-particle" />
            <span class="ember-particle p2" />
          </div>

          <!-- 燃烧前沿：ember-bright 光团 + 呼吸 + 光晕脉冲 -->
          <div v-else-if="markStatus(i) === 'current'" class="blaze-orb">
            <div class="blaze-halo" />
            <div class="blaze-core" />
            <span class="blaze-spark s1" />
            <span class="blaze-spark s2" />
            <span class="blaze-spark s3" />
          </div>

          <!-- 未点燃：whisper 暗点 -->
          <div v-else class="wick-tip" />
        </div>

        <!-- 标签 -->
        <span class="fuse-label" :class="markStatus(i)">{{ step }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fuse-stepper {
  position: relative;
  width: 100%;
  padding: 48px 0 28px;
  min-height: 90px;
}

/* ══ 烛芯基线：贯通到屏幕尽头 ══ */
.wick-base {
  position: absolute;
  top: 36px;
  left: 0;
  right: 0;
  height: 1.5px;
  background: var(--whisper);
  opacity: 0.25;
  border-radius: 1px;
}

/* ══ 已点燃段 ══ */
.wick-lit {
  position: absolute;
  top: 36px;
  height: 2px;
  background: linear-gradient(
    90deg,
    rgba(181, 137, 61, 0.3) 0%,
    var(--ember) 20%,
    var(--ember-bright) 90%,
    var(--ember-bright) 100%
  );
  border-radius: 1px;
  box-shadow: 0 0 6px rgba(232, 169, 72, 0.35);
  overflow: hidden;
  transition: width 0.6s cubic-bezier(0.22, 1, 0.36, 1);
}

/* 光脉冲：沿已点燃段循环传播 */
.wick-pulse {
  position: absolute;
  top: 0;
  left: 0;
  width: 60px;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 230, 170, 0.7) 50%,
    transparent 100%
  );
  animation: pulse-propagate 2.5s ease-in-out infinite;
}
@keyframes pulse-propagate {
  0% { transform: translateX(-60px); opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { transform: translateX(360px); opacity: 0; }
}

/* ══ 节点群：聚拢居中 ══ */
.fuse-nodes {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.fuse-node {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.fuse-mark {
  position: relative;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 节点中心对齐到烛芯线（top:36px, padding-top:48px, mark 高 20px → 中心 58px，偏移 -22px） */
  margin-top: -22px;
  overflow: visible;
  z-index: 2;
}

/* ══ 已点燃节点：ember 光点 ══ */
.ember-orb {
  position: relative;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--ember-bright) 0%,
    var(--ember) 50%,
    rgba(181, 137, 61, 0.3) 100%
  );
  box-shadow:
    0 0 8px rgba(232, 169, 72, 0.4),
    0 0 3px var(--ember);
}

/* 微光粒子上升 */
.ember-particle {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 1.5px;
  height: 1.5px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 2px var(--ember);
  animation: particle-rise 3s ease-out infinite;
}
.ember-particle.p2 {
  animation-delay: 1.5s;
  left: 40%;
}
@keyframes particle-rise {
  0% { opacity: 0; transform: translate(-50%, 0); }
  20% { opacity: 0.7; }
  100% { opacity: 0; transform: translate(-50%, -14px); }
}

/* ══ 燃烧前沿：ember-bright 光团 ══ */
.blaze-orb {
  position: relative;
  width: 14px;
  height: 14px;
}

/* 核心：ember-bright 发光球 */
.blaze-core {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    #fff 0%,
    var(--ember-bright) 30%,
    var(--ember) 70%,
    rgba(155, 58, 46, 0.4) 100%
  );
  box-shadow:
    0 0 12px rgba(232, 169, 72, 0.6),
    0 0 4px var(--ember-bright);
  animation: blaze-breathe 2s ease-in-out infinite;
  z-index: 2;
}
@keyframes blaze-breathe {
  0%, 100% {
    box-shadow: 0 0 8px rgba(232, 169, 72, 0.4), 0 0 3px var(--ember-bright);
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    box-shadow: 0 0 20px rgba(232, 169, 72, 0.8), 0 0 6px var(--ember-bright);
    transform: translate(-50%, -50%) scale(1.15);
  }
}

/* 光晕脉冲扩散 */
.blaze-halo {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--ember-bright);
  transform: translate(-50%, -50%);
  opacity: 0;
  animation: halo-expand 2s ease-out infinite;
  z-index: 1;
}
@keyframes halo-expand {
  0% { width: 14px; height: 14px; opacity: 0.5; }
  100% { width: 40px; height: 40px; opacity: 0; }
}

/* 火星飞溅 */
.blaze-spark {
  position: absolute;
  width: 1.5px;
  height: 1.5px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 2px var(--ember-bright);
  top: 50%;
  left: 50%;
}
.blaze-spark.s1 {
  animation: spark-out 2s ease-out infinite;
  --dx: 5px;
  --dy: -10px;
}
.blaze-spark.s2 {
  animation: spark-out 2s ease-out infinite 0.7s;
  --dx: -4px;
  --dy: -8px;
}
.blaze-spark.s3 {
  animation: spark-out 2s ease-out infinite 1.3s;
  --dx: 3px;
  --dy: -12px;
}
@keyframes spark-out {
  0% { opacity: 0; transform: translate(-50%, -50%); }
  15% { opacity: 1; }
  100% { opacity: 0; transform: translate(calc(-50% + var(--dx)), var(--dy)); }
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

/* ══ 标签 ══ */
.fuse-label {
  margin-top: 14px;
  min-width: 80px;
  text-align: center;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  color: var(--prose-dim);
  white-space: nowrap;
  transition: color 0.3s, text-shadow 0.3s;
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
