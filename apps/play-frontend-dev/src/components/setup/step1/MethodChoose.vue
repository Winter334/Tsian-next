<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue"
import gsap from "gsap"

/**
 * MethodChoose — 导入方式选择（两卡：粘贴/文件）。
 *
 * prd 向导 Step 1 choose：仅两卡居中，--void-deep + --line + inset shadow +
 * 括号 + 小图标；hover translateY(-2px) + --ember 描边 + 内发光；
 * 进场 GSAP stagger；无标题副标题。
 */
const emit = defineEmits<{
  select: [mode: "paste" | "file"]
}>()

const cardsRef = ref<HTMLElement | null>(null)

onMounted(async () => {
  await nextTick()
  if (!cardsRef.value) return
  const cards = cardsRef.value.querySelectorAll(".method-card")
  // 不用 y 位移 + stagger：stagger 让两张卡片先后进场，y 偏移会导致"一高一低"。
  // 改用 opacity + scale 依次淡入，无垂直位移，不会错位。
  // fromTo 明确起止值，避免 from 的隐式推断陷阱（见 UnderstandingReady 注释）。
  gsap.fromTo(cards,
    { opacity: 0, scale: 0.94 },
    { opacity: 1, scale: 1, duration: 0.45, stagger: 0.1, ease: "power2.out" },
  )
})

onUnmounted(() => {
  if (cardsRef.value) gsap.killTweensOf(cardsRef.value.querySelectorAll(".method-card"))
})
</script>

<template>
  <div ref="cardsRef" class="method-grid">
    <button class="method-card" type="button" @click="emit('select', 'paste')">
      <span class="card-mark" aria-hidden="true">贴</span>
      <span class="card-body">
        <span class="card-title">粘贴文本</span>
        <span class="card-copy">适合短篇、片段，或先拿一小段故事试试手感。</span>
      </span>
      <!-- 四角括号 -->
      <span class="bracket tl" aria-hidden="true" />
      <span class="bracket tr" aria-hidden="true" />
      <span class="bracket bl" aria-hidden="true" />
      <span class="bracket br" aria-hidden="true" />
    </button>

    <button class="method-card" type="button" @click="emit('select', 'file')">
      <span class="card-mark" aria-hidden="true">卷</span>
      <span class="card-body">
        <span class="card-title">导入文件</span>
        <span class="card-copy">适合完整长篇，把整本书放进当前存档。</span>
      </span>
      <span class="bracket tl" aria-hidden="true" />
      <span class="bracket tr" aria-hidden="true" />
      <span class="bracket bl" aria-hidden="true" />
      <span class="bracket br" aria-hidden="true" />
    </button>
  </div>
</template>

<style scoped>
.method-grid {
  display: flex;
  gap: 24px;
  justify-content: center;
  padding: 20px 0;
}

.method-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 28px 24px;
  min-width: 220px;
  background: linear-gradient(135deg, rgba(20, 14, 8, 0.85), rgba(10, 5, 6, 0.9));
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  color: var(--prose);
  font-family: var(--font-serif);
  box-shadow:
    inset 0 0 20px rgba(181, 137, 61, 0.04),
    0 4px 16px rgba(0, 0, 0, 0.3);
  transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
}

.method-card:hover {
  transform: translateY(-2px);
  border-color: var(--ember);
  box-shadow:
    inset 0 0 24px var(--ember-glow),
    0 6px 24px rgba(0, 0, 0, 0.4),
    0 0 12px rgba(181, 137, 61, 0.15);
}

/* 标记字 */
.card-mark {
  font-family: var(--font-display);
  font-size: 1.8rem;
  font-weight: 700;
  color: var(--ember);
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(181, 137, 61, 0.05);
  transition: color 0.25s, border-color 0.25s;
}
.method-card:hover .card-mark {
  color: var(--ember-bright);
  border-color: var(--ember);
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--prose);
}

.card-copy {
  font-size: 0.82rem;
  color: var(--prose-dim);
  line-height: 1.5;
}

/* 四角括号 */
.bracket {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid var(--ember);
  opacity: 0.45;
  transition: opacity 0.25s;
}
.method-card:hover .bracket {
  opacity: 0.7;
}
.bracket.tl { top: 5px; left: 5px; border-right: none; border-bottom: none; }
.bracket.tr { top: 5px; right: 5px; border-left: none; border-bottom: none; }
.bracket.bl { bottom: 5px; left: 5px; border-right: none; border-top: none; }
.bracket.br { bottom: 5px; right: 5px; border-left: none; border-top: none; }
</style>
