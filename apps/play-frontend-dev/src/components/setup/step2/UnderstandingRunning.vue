<script setup lang="ts">
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from "vue"
import gsap from "gsap"
import { useSetupState } from "../../../composables/useSetupState"

/**
 * UnderstandingRunning — 初始理解进行中。
 *
 * 视觉意象「源文鳞阵」：借鉴 sssscales 的网格鳞片波动思路。
 * 小说原文被切成许多 source scales，逐列起伏、逐片点亮，表示系统正在
 * 观察结构、阅读开头、提取开局资料。不是 spinner/loading bar，
 * 而是一组有生命的文本切片在烛火中被理解。
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

  gsap.set(columns, { y: (i) => (i % 2 === 0 ? -5 : 5) })
  gsap.set(field.querySelectorAll(".scale-cell"), {
    y: 8,
    scale: 0.38,
    opacity: 0.35,
    transformOrigin: "50% 50%",
  })

  // 列级波动：来自 sssscales 的 column stagger 思路
  scalesTl.to(columns, {
    y: 8,
    duration: 1.5,
    ease: "sine.inOut",
    stagger: {
      amount: 3,
      repeat: -1,
      yoyo: true,
    },
  }, 0)

  // 单元格级波动：每列内部从收缩到点亮，行间形成错位流动
  columns.forEach((column, colIndex) => {
    const cells = column.querySelectorAll(".scale-cell")
    scalesTl?.add(
      gsap.fromTo(cells,
        {
          y: (row) => gsap.utils.interpolate(18, -18, row / (ROWS - 1)),
          scale: 0.28,
          opacity: 0.22,
        },
        {
          y: (row) => gsap.utils.interpolate((colIndex - 4.5) * 0.8, -(colIndex - 4.5) * 0.8, row / (ROWS - 1)),
          scale: 0.92,
          opacity: 1,
          duration: 1.05,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
          yoyoEase: "sine.in",
          stagger: { amount: 0.12, from: "center" },
        },
      ),
      colIndex / 10,
    )
  })

  scalesTl.play(8)
}

onMounted(() => {
  void startScalesAnimation()
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
  scalesTl?.kill()
  scalesTl = null
})

// agent activity 时增强一次整体亮度
watch(agentHeartbeat, () => {
  const field = scaleFieldRef.value
  if (!field) return
  gsap.fromTo(field,
    { filter: "drop-shadow(0 0 10px rgba(232, 169, 72, 0.08))", scale: 1 },
    {
      filter: "drop-shadow(0 0 34px rgba(232, 169, 72, 0.28))",
      scale: 1.035,
      duration: 0.18,
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
      <!-- 源文鳞阵：规则网格 + stagger 波纹 -->
      <div ref="scaleFieldRef" class="scale-field" aria-hidden="true">
        <div
          v-for="col in COLUMNS"
          :key="col"
          class="scale-col"
          :style="{ '--col': col - 1 }"
        >
          <span
            v-for="row in ROWS"
            :key="row"
            class="scale-cell"
            :style="{ '--row': row - 1 }"
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
/* 参考 sssscales 的思路：列级上下浮动 + 单元格级 scale/位移波纹。
   改造成 Tsian 的 source scales：每个单元是被烛火点亮的文本切片。
   不用 GSAP，全部 CSS stagger。 */
.scale-field {
  position: relative;
  display: grid;
  grid-template-columns: repeat(10, 12px);
  gap: 3px;
  padding: 18px;
  border-radius: 12px;
  background:
    radial-gradient(ellipse 70% 70% at 50% 45%, rgba(232, 169, 72, 0.08) 0%, transparent 70%),
    rgba(10, 5, 6, 0.12);
  filter: drop-shadow(0 0 18px rgba(232, 169, 72, 0.08));
  animation: field-pulse 2.8s ease-in-out both;
}
.scale-field::before,
.scale-field::after {
  content: "";
  position: absolute;
  inset: 8px;
  border: 1px solid rgba(181, 137, 61, 0.12);
  border-radius: 10px;
  pointer-events: none;
}
.scale-field::after {
  inset: 14px;
  border-color: rgba(232, 169, 72, 0.08);
  animation: frame-breathe 3.2s ease-in-out infinite;
}
@keyframes field-pulse {
  0% { filter: drop-shadow(0 0 8px rgba(232, 169, 72, 0.05)); }
  25% { filter: drop-shadow(0 0 30px rgba(232, 169, 72, 0.22)); }
  100% { filter: drop-shadow(0 0 18px rgba(232, 169, 72, 0.08)); }
}
@keyframes frame-breathe {
  0%, 100% { opacity: 0.35; transform: scale(0.98); }
  50% { opacity: 0.8; transform: scale(1.02); }
}

.scale-col {
  display: grid;
  grid-template-rows: repeat(10, 12px);
  gap: 3px;
}

.scale-cell {
  position: relative;
  width: 12px;
  height: 12px;
  border-radius: 3px 9px 3px 9px;
  background: linear-gradient(135deg, rgba(232, 169, 72, 0.42), rgba(181, 137, 61, 0.16));
  box-shadow:
    inset 0 0 8px rgba(232, 169, 72, 0.10),
    0 0 8px rgba(232, 169, 72, 0.08);
  transform-origin: center;
  will-change: transform, opacity;
}
.scale-cell::after {
  content: "";
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: rgba(232, 169, 72, 0.35);
  opacity: 0.55;
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
