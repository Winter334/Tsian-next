<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from "vue"
import gsap from "gsap"
import { useSetupState } from "../../../composables/useSetupState"

/**
 * UnderstandingRunning — 初始理解进行中。
 *
 * 视觉意象「源文鳞阵」：复刻 sssscales 的网格圆点波动。
 * 10×10 圆点阵列，列级 y 波动 + 单元格级 y/scale 错位，
 * 形成有机的波纹流动。圆点用 ember 配色，点亮时发光像火星。
 *
 * 不暴露 world-architect。分阶段文案按经过时间推进（agent 实际进度不可知）。
 */
const { agentHeartbeat, understandingStartedAt } = useSetupState()

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

const COLUMNS = 10
const ROWS = 10
const scaleFieldRef = ref<HTMLElement | null>(null)
let scalesTl: gsap.core.Timeline | null = null

async function startScalesAnimation() {
  await nextTick()
  const field = scaleFieldRef.value
  if (!field) return
  const columns = gsap.utils.toArray<HTMLElement>(field.querySelectorAll(".scale-col"))

  scalesTl?.kill()
  scalesTl = gsap.timeline()

  // 复刻 sssscales：列级 y 波动，stagger amount 3, yoyo, repeat -1
  scalesTl.to(columns, {
    y: 11,
    duration: 1.5,
    ease: "sine.inOut",
    stagger: {
      amount: 3,
      repeat: -1,
      yoyo: true,
    },
  }, 0)

  // 复刻 sssscales：每列单元格 fromTo y+scale，interpolate 大范围→小范围
  columns.forEach((column, colIndex) => {
    const cells = column.querySelectorAll(".scale-cell")
    scalesTl?.add(
      gsap.fromTo(cells,
        {
          y: (row) => gsap.utils.interpolate(77, -77, row / 10),
          scale: 0.133,
          opacity: 0.2,
        },
        {
          y: (row) => gsap.utils.interpolate(colIndex, -colIndex, row / 10),
          scale: 0.8,
          opacity: 1,
          duration: 1,
          ease: "sine",
          repeat: -1,
          yoyo: true,
          yoyoEase: "sine.in",
        },
      ),
      colIndex / 10,
    )
  })

  scalesTl.play(50)
}

onMounted(() => {
  void startScalesAnimation()
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
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
  scalesTl?.kill()
  scalesTl = null
})

// agent activity 时整体闪亮
watch(agentHeartbeat, () => {
  const field = scaleFieldRef.value
  if (!field) return
  gsap.fromTo(field,
    { filter: "drop-shadow(0 0 6px rgba(232, 169, 72, 0.1))" },
    {
      filter: "drop-shadow(0 0 30px rgba(232, 169, 72, 0.35))",
      duration: 0.2,
      yoyo: true,
      repeat: 1,
      ease: "sine.inOut",
    },
  )
})
</script>

<template>
  <div class="understanding-running">
    <div class="loading-core">
      <!-- 源文鳞阵：10×10 圆点网格，无框，GSAP 波纹 -->
      <div ref="scaleFieldRef" class="scale-field" aria-hidden="true">
        <div
          v-for="col in COLUMNS"
          :key="col"
          class="scale-col"
        >
          <span
            v-for="row in ROWS"
            :key="row"
            class="scale-cell"
          />
        </div>
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
  padding: 50px 20px;
  min-height: 280px;
}

.loading-core {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
}

/* ═══ 源文鳞阵 ═══ */
/* 无框、无背景，纯圆点阵列。复刻 sssscales 的简洁感。 */
.scale-field {
  display: grid;
  grid-template-columns: repeat(10, 14px);
  gap: 4px;
}

.scale-col {
  display: grid;
  grid-template-rows: repeat(10, 14px);
  gap: 4px;
}

/* 圆点：ember 配色，发光火星 */
.scale-cell {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow:
    0 0 4px rgba(232, 169, 72, 0.6),
    0 0 8px rgba(232, 169, 72, 0.3);
  will-change: transform, opacity;
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
