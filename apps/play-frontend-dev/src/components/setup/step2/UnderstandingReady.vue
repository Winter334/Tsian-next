<script setup lang="ts">
import { ref, onMounted, nextTick } from "vue"
import gsap from "gsap"
import { useSetupState } from "../../../composables/useSetupState"
import type { OpeningUnderstandingSummary } from "../../../lib/source"

/**
 * UnderstandingReady — 初始理解完成。
 *
 * 显示理解摘要（标题/实体数/角色数）+ 引导问 + 角色分支卡（原著/原创）。
 * 选中分支 → Step 3 角色设定（本任务 stub，暂不推进 stepper）。
 */
const props = defineProps<{
  summary: OpeningUnderstandingSummary | null
}>()

const emit = defineEmits<{
  select: [branch: "canon" | "original"]
}>()

const { manifest } = useSetupState()

const rootRef = ref<HTMLElement | null>(null)
const selectedBranch = ref<"canon" | "original" | null>(null)

function select(branch: "canon" | "original") {
  if (selectedBranch.value) return
  selectedBranch.value = branch
  emit("select", branch)
}

onMounted(async () => {
  await nextTick()
  if (!rootRef.value) return
  const cards = rootRef.value.querySelectorAll(".branch-card")
  gsap.from(cards, {
    opacity: 0,
    scale: 0.92,
    duration: 0.5,
    stagger: 0.12,
    ease: "power2.out",
    delay: 0.15,
  })
})
</script>

<template>
  <div ref="rootRef" class="understanding-ready">
    <!-- 理解摘要 -->
    <div class="summary" v-if="summary">
      <div class="summary-title">{{ summary.title || manifest?.title || '导入小说' }}</div>
      <div class="summary-meta">
        <span v-if="typeof summary.entityCount === 'number'" class="meta-item">
          <span class="meta-num">{{ summary.entityCount }}</span> 实体
        </span>
        <span v-if="summary.candidateCharacters?.length" class="meta-item">
          <span class="meta-num">{{ summary.candidateCharacters.length }}</span> 候选角色
        </span>
        <span class="meta-item ready-tag">理解完成</span>
      </div>
    </div>

    <!-- 引导问 -->
    <h3 class="guide-question">你想以谁的身份走进这个故事？</h3>

    <!-- 角色分支卡 -->
    <div class="branch-cards">
      <button
        class="branch-card"
        :class="{ selected: selectedBranch === 'canon' }"
        type="button"
        :disabled="!!selectedBranch && selectedBranch !== 'canon'"
        @click="select('canon')"
      >
        <span class="branch-mark" aria-hidden="true">原</span>
        <span class="branch-body">
          <span class="branch-title">原著角色</span>
          <span class="branch-copy">扮演故事里已有的人</span>
        </span>
        <span class="bracket tl" aria-hidden="true" />
        <span class="bracket tr" aria-hidden="true" />
        <span class="bracket bl" aria-hidden="true" />
        <span class="bracket br" aria-hidden="true" />
      </button>

      <button
        class="branch-card"
        :class="{ selected: selectedBranch === 'original' }"
        type="button"
        :disabled="!!selectedBranch && selectedBranch !== 'original'"
        @click="select('original')"
      >
        <span class="branch-mark" aria-hidden="true">创</span>
        <span class="branch-body">
          <span class="branch-title">原创角色</span>
          <span class="branch-copy">创造一个全新的角色</span>
        </span>
        <span class="bracket tl" aria-hidden="true" />
        <span class="bracket tr" aria-hidden="true" />
        <span class="bracket bl" aria-hidden="true" />
        <span class="bracket br" aria-hidden="true" />
      </button>
    </div>

    <!-- 选中后的提示 -->
    <Transition name="hint-fade">
      <p v-if="selectedBranch" class="selected-hint">角色设定即将开放</p>
    </Transition>
  </div>
</template>

<style scoped>
.understanding-ready {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 32px 20px 20px;
}

/* ── 理解摘要 ── */
.summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
  width: 100%;
  max-width: 420px;
}
.summary-title {
  font-family: var(--font-display);
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--ember-bright);
  letter-spacing: 0.04em;
}
.summary-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.meta-item {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-dim);
  letter-spacing: 0.05em;
}
.meta-num {
  color: var(--ember);
  font-weight: 600;
}
.ready-tag {
  color: var(--ember-bright);
}

/* ── 引导问 ── */
.guide-question {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1.05rem;
  color: var(--prose);
  text-align: center;
  letter-spacing: 0.02em;
}

/* ── 分支卡 ── */
.branch-cards {
  display: flex;
  gap: 20px;
}

.branch-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 22px 20px;
  min-width: 180px;
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  color: var(--prose);
  font-family: var(--font-serif);
  box-shadow: inset 0 0 16px rgba(0, 0, 0, 0.3);
  transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s, opacity 0.25s;
}
.branch-card:hover:not(:disabled) {
  transform: translateY(-2px);
  border-color: var(--ember);
  box-shadow: inset 0 0 20px var(--ember-glow), 0 4px 16px rgba(0, 0, 0, 0.3);
}
.branch-card.selected {
  border-color: var(--ember-bright);
  box-shadow: inset 0 0 24px rgba(232, 169, 72, 0.15), 0 0 12px rgba(232, 169, 72, 0.2);
}
.branch-card:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.branch-card.selected:disabled {
  opacity: 1;
}

.branch-mark {
  font-family: var(--font-display);
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--ember);
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: rgba(181, 137, 61, 0.05);
  transition: color 0.25s, border-color 0.25s;
}
.branch-card:hover .branch-mark,
.branch-card.selected .branch-mark {
  color: var(--ember-bright);
  border-color: var(--ember);
}

.branch-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.branch-title {
  font-size: 0.95rem;
  font-weight: 600;
}
.branch-copy {
  font-size: 0.78rem;
  color: var(--prose-dim);
}

/* 四角括号 */
.bracket {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1px solid var(--ember);
  opacity: 0.3;
  transition: opacity 0.25s;
}
.branch-card:hover .bracket,
.branch-card.selected .bracket {
  opacity: 0.6;
}
.bracket.tl { top: 4px; left: 4px; border-right: none; border-bottom: none; }
.bracket.tr { top: 4px; right: 4px; border-left: none; border-bottom: none; }
.bracket.bl { bottom: 4px; left: 4px; border-right: none; border-top: none; }
.bracket.br { bottom: 4px; right: 4px; border-left: none; border-top: none; }

/* 选中提示 */
.selected-hint {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--whisper);
  letter-spacing: 0.08em;
}
.hint-fade-enter-active {
  transition: opacity 0.3s ease;
}
.hint-fade-enter-from {
  opacity: 0;
}
</style>
