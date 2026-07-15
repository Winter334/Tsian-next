<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import { generateMagicCircle } from "../step2/magicCircleGenerator"

/**
 * OpeningConfirm — 开局确认（Step 5）。
 *
 * 纯过渡入口屏：设定卡片 + 周围漂浮的随机魔法阵。
 * 魔法阵复用 magicCircleGenerator，内部多层（outer/text/inner/core）
 * 各自反向旋转（同 Step 2 UnderstandingRunning 风格），外层缓慢漂浮。
 * 魔法阵有淡入淡出生命周期——自然产生、自然消失、循环再生。
 * 玩家点"进入故事"由 SetupWizard action bar 触发 enterPlay → 烧蚀过渡翻转 mode。
 *
 * 开局 assistant 回复已写入 turn 0 history；玩家点"进入故事"后，StoryView 从正式历史流渲染第一条消息。
 */
const { playSetupSummary, understandingSummary, manifest } = useSetupState()

const title = computed(
  () => understandingSummary.value?.title ?? manifest.value?.title ?? "设定已成",
)

const summary = computed(() => playSetupSummary.value ?? "")

// ── 背景漂浮魔法阵：有生命周期的循环生成 ──
interface DriftCircle {
  id: number
  viewBox: string
  layers: string
  size: number
  left: number
  top: number
  driftDuration: number
  driftDelay: number
  lifeDuration: number // 淡入→停留→淡出 总周期
  lifeDelay: number
}

const driftCircles = ref<DriftCircle[]>([])
let nextId = 0
let spawnTimer = 0

function pickOpenPosition(size: number, existing: DriftCircle[]): { left: number; top: number } {
  // 全屏区域分配：装饰层铺满视口，不再受 720px 向导内容框限制。
  // 避开中央卡片（约 x:33%～67%, y:30%～70%）、顶部 stepper 和底部 action bar。
  // 区域池覆盖真正空旷处：左上/右上/左下/右下/远左/远右。
  const zones = [
    { x1: 6, x2: 26, y1: 20, y2: 40 },
    { x1: 74, x2: 94, y1: 20, y2: 40 },
    { x1: 6, x2: 28, y1: 62, y2: 80 },
    { x1: 72, x2: 94, y1: 62, y2: 80 },
    { x1: 2, x2: 16, y1: 42, y2: 60 },
    { x1: 84, x2: 98, y1: 42, y2: 60 },
  ]

  const viewportW = Math.max(window.innerWidth, 1)
  const viewportH = Math.max(window.innerHeight, 1)
  let best = { left: 50, top: 50, score: -Infinity }

  // Best-candidate sampling：多采样一些候选点，选择离现有魔法阵边缘最远的位置。
  for (let attempt = 0; attempt < 30; attempt++) {
    const zone = zones[Math.floor(Math.random() * zones.length)]!
    const left = zone.x1 + Math.random() * (zone.x2 - zone.x1)
    const top = zone.y1 + Math.random() * (zone.y2 - zone.y1)
    const x = (left / 100) * viewportW
    const y = (top / 100) * viewportH

    let minClearance = Infinity
    for (const other of existing) {
      const ox = (other.left / 100) * viewportW
      const oy = (other.top / 100) * viewportH
      const centerDistance = Math.hypot(x - ox, y - oy)
      // 视觉上魔法阵是线条 + glow，不需要按完整半径避免；0.42 比例更自然。
      const clearance = centerDistance - (size + other.size) * 0.42
      minClearance = Math.min(minClearance, clearance)
    }

    const score = existing.length === 0 ? 0 : minClearance
    if (score > best.score) best = { left, top, score }
  }

  return { left: best.left, top: best.top }
}

function createCircle(existing: DriftCircle[] = driftCircles.value): DriftCircle {
  const mc = generateMagicCircle()
  const size = 120 + Math.random() * 160
  const { left, top } = pickOpenPosition(size, existing)

  return {
    id: nextId++,
    viewBox: mc.viewBox,
    layers: mc.layers,
    size,
    left,
    top,
    driftDuration: 20 + Math.random() * 16, // 漂浮 20～36s
    driftDelay: -Math.random() * 15,
    lifeDuration: 20 + Math.random() * 15, // 生命周期 20～35s
    lifeDelay: 0,
  }
}

onMounted(() => {
  // 初始生成 5 个，错开生命周期相位，并尽量彼此分散
  const initial = 5
  const circles: DriftCircle[] = []
  for (let i = 0; i < initial; i++) {
    const c = createCircle(circles)
    c.lifeDelay = -Math.random() * c.lifeDuration // 随机相位，不同时出现
    circles.push(c)
  }
  driftCircles.value = circles

  // 定时补充：魔法阵淡出消失后，用新魔法阵替换（保持总数约 5 个）
  spawnTimer = window.setInterval(() => {
    if (driftCircles.value.length >= 6) return
    driftCircles.value.push(createCircle())
  }, 6000)
})

onUnmounted(() => {
  if (spawnTimer) clearInterval(spawnTimer)
})
</script>

<template>
  <div class="opening-confirm">
    <!-- 背景漂浮魔法阵（装饰，aria-hidden） -->
    <div class="drift-layer" aria-hidden="true">
      <div
        v-for="c in driftCircles"
        :key="c.id"
        class="drift-circle"
        :style="{
          width: c.size + 'px',
          height: c.size + 'px',
          left: c.left + '%',
          top: c.top + '%',
          animationDuration: c.driftDuration + 's, ' + c.lifeDuration + 's',
          animationDelay: c.driftDelay + 's, ' + c.lifeDelay + 's',
        }"
      >
        <svg :viewBox="c.viewBox" class="drift-svg">
          <g v-html="c.layers" />
        </svg>
      </div>
    </div>

    <div class="confirm-card">
      <!-- 点阵纹理叠加（lachisa .canvas-dot-overlay） -->
      <div class="dot-overlay" aria-hidden="true" />

      <!-- 背景巨字缓慢横移（lachisa .nihility-bg-text） -->
      <span class="bg-glyph" aria-hidden="true">{{ title }}</span>

      <!-- 四角括号（呼应 CharacterConfirmed） -->
      <span class="bracket tl" aria-hidden="true" />
      <span class="bracket tr" aria-hidden="true" />
      <span class="bracket bl" aria-hidden="true" />
      <span class="bracket br" aria-hidden="true" />

      <!-- 一次性脉冲环（mount 时触发，类比 CharacterConfirmed） -->
      <div class="pulse-ring" aria-hidden="true" />

      <!-- 卡片内容 -->
      <div class="card-body">
        <span class="card-label">術式已定</span>
        <h2 class="card-title">{{ title }}</h2>

        <div class="card-divider" aria-hidden="true">
          <span class="diamond">✦</span>
        </div>

        <p class="card-summary">{{ summary }}</p>

        <div class="pulse-bar" aria-hidden="true" />
        <span class="card-status">就绪 · 等待开启</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.opening-confirm {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 20px;
  min-height: 360px;
}

/* ═══ 背景漂浮魔法阵层（允许溢出，装饰卡片周围） ═══ */
.drift-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: visible;
}

.drift-circle {
  position: absolute;
  /* 双动画：drift 做位置漂浮，life 做淡入淡出生命周期。
     居中 translate(-50%,-50%) 放进 keyframes 避免被 transform 覆盖。 */
  animation-name: circle-drift, circle-life;
  animation-timing-function: ease-in-out, ease-in-out;
  animation-iteration-count: infinite, infinite;
  animation-direction: alternate, normal;
  will-change: transform, opacity;
}

.drift-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  filter:
    drop-shadow(0 0 5px rgba(232, 169, 72, 0.6))
    drop-shadow(0 0 16px rgba(181, 137, 61, 0.4));
}

/* SVG 内部所有线条 non-scaling-stroke */
.drift-svg :deep(*) {
  vector-effect: non-scaling-stroke;
}

/* 魔法阵内部多层反向旋转（同 Step 2 UnderstandingRunning 风格） */
.drift-svg :deep(.magic-layer) {
  transform-box: view-box;
  transform-origin: 256px 256px;
}
.drift-svg :deep(.magic-layer--outer) {
  animation: rotate-cw 46s linear infinite;
}
.drift-svg :deep(.magic-layer--text) {
  animation: rotate-ccw 62s linear infinite;
}
.drift-svg :deep(.magic-layer--inner) {
  animation: rotate-cw 34s linear infinite;
}
.drift-svg :deep(.magic-layer--core) {
  animation: core-breathe 3.8s ease-in-out infinite;
}
@keyframes rotate-cw { to { transform: rotate(360deg); } }
@keyframes rotate-ccw { to { transform: rotate(-360deg); } }
@keyframes core-breathe {
  0%, 100% { opacity: 0.76; transform: scale(0.985); }
  50% { opacity: 1; transform: scale(1.035); }
}

/* 漂浮：缓慢位置偏移（含居中 translate） */
@keyframes circle-drift {
  0% { transform: translate(-50%, -50%) translate(0px, 0px); }
  50% { transform: translate(-50%, -50%) translate(20px, -16px); }
  100% { transform: translate(-50%, -50%) translate(-14px, 12px); }
}

/* 生命周期：淡入 → 停留 → 淡出 → 循环 */
@keyframes circle-life {
  0% { opacity: 0; }
  15% { opacity: 0.55; }
  75% { opacity: 0.55; }
  100% { opacity: 0; }
}

/* ═══ 设定卡片 — 融合 lachisa + CharacterConfirmed 语言 ═══ */
.confirm-card {
  position: relative;
  width: 100%;
  max-width: 580px;
  padding: 36px 32px 28px;
  background-image: url("https://u.cubeupload.com/zmonochrome/tumblr8b1866a9355004.jpg");
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(232, 169, 72, 0.08);
  border-radius: 12px;
  overflow: hidden;
  /* 多层 shadow 打破矩形刚性：外投影 + 双层 inset 暗角（lachisa .canvas-container） */
  box-shadow:
    0 30px 100px rgba(0, 0, 0, 0.8),
    inset 0 0 80px rgba(10, 5, 6, 0.9),
    inset 0 0 140px rgba(0, 0, 0, 0.95);
  z-index: 1;
}

/* 暗色渐变 overlay：压暗背景图，使内容可读 */
.confirm-card::before {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    135deg,
    rgba(10, 5, 6, 0.92) 0%,
    rgba(43, 4, 4, 0.85) 50%,
    rgba(10, 5, 6, 0.95) 100%
  );
  z-index: 0;
  pointer-events: none;
}

/* Vignette：四周进一步暗化（lachisa .canvas-container::after） */
.confirm-card::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, transparent 40%, rgba(10, 5, 6, 0.85) 100%);
  z-index: 2;
  pointer-events: none;
}

/* 点阵纹理叠加（lachisa .canvas-dot-overlay） */
.dot-overlay {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(212, 201, 180, 0.04) 15%, transparent 16%);
  background-size: 6px 6px;
  z-index: 1;
  pointer-events: none;
}

/* 背景巨字缓慢横移（lachisa .nihility-bg-text） */
.bg-glyph {
  position: absolute;
  width: 200%;
  top: 45%;
  left: 0;
  transform: translateY(-50%);
  font-family: var(--font-display, serif);
  font-size: 10rem;
  font-weight: 700;
  color: rgba(181, 137, 61, 0.03);
  letter-spacing: 24px;
  white-space: nowrap;
  z-index: 1;
  pointer-events: none;
  user-select: none;
  animation: glyph-drift 35s linear infinite;
}
@keyframes glyph-drift {
  0% { transform: translate(0, -50%); }
  100% { transform: translate(-50%, -50%); }
}

/* 四角括号（呼应 CharacterConfirmed，适配大卡片尺寸） */
.bracket {
  position: absolute;
  width: 12px;
  height: 12px;
  border: 1px solid var(--ember-bright);
  opacity: 0.5;
  z-index: 3;
}
.bracket.tl { top: 10px; left: 10px; border-right: none; border-bottom: none; }
.bracket.tr { top: 10px; right: 10px; border-left: none; border-bottom: none; }
.bracket.bl { bottom: 10px; left: 10px; border-right: none; border-top: none; }
.bracket.br { bottom: 10px; right: 10px; border-left: none; border-top: none; }

/* 一次性脉冲环（类比 CharacterConfirmed .pulse-ring） */
.pulse-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--ember-bright);
  transform: translate(-50%, -50%);
  opacity: 0;
  animation: ring-pulse 1.4s ease-out forwards;
  pointer-events: none;
  z-index: 3;
}
@keyframes ring-pulse {
  0% { width: 14px; height: 14px; opacity: 0.6; }
  100% { width: 180px; height: 180px; opacity: 0; }
}

/* ═══ 卡片内容 ═══ */
.card-body {
  position: relative;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
}

.card-label {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--ember);
  letter-spacing: 0.3em;
  text-transform: uppercase;
}

/* 卡片标题：阶梯阴影（复用 App.vue:175 同款古金色阶梯） */
.card-title {
  margin: 0;
  font-family: var(--font-display, serif);
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--prose);
  letter-spacing: 0.04em;
  text-shadow:
    1px 1px 0 var(--ember),
    2px 2px 0 #8a6428,
    3px 3px 0 #5e4319,
    5px 5px 25px rgba(0, 0, 0, 0.95);
}

/* 分隔线 + 菱形脉冲（lachisa .diamond） */
.card-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0;
}
.card-divider::before,
.card-divider::after {
  content: "";
  width: 40px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--ember), transparent);
}
.diamond {
  color: var(--ember);
  font-size: 0.8rem;
  animation: diamond-pulse 2s ease-in-out infinite;
}
@keyframes diamond-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.15); }
}

/* 设定摘要正文 */
.card-summary {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.88rem;
  line-height: 1.75;
  color: var(--prose-muted);
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--whisper) transparent;
  padding: 0 4px;
}
.card-summary::-webkit-scrollbar { width: 4px; }
.card-summary::-webkit-scrollbar-thumb {
  background: var(--whisper);
  border-radius: 2px;
}

/* 就绪脉冲条（lachisa .live-pulse-bar） */
.pulse-bar {
  width: 40px;
  height: 2px;
  background: var(--ember);
  margin-top: 8px;
  animation: bar-stretch 1.2s ease-in-out infinite;
}
@keyframes bar-stretch {
  0%, 100% { width: 24px; opacity: 0.6; }
  50% { width: 52px; opacity: 1; }
}

.card-status {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--prose-faint);
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
</style>
