<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from "vue"
import gsap from "gsap"
import type { OpeningCandidateCharacter } from "../../../lib/source"

/**
 * CanonCharacterSelect — 原著角色竖向列表选择。
 *
 * 候选角色来自 understandingSummary.candidateCharacters。
 * 选中态：标记字点燃（ember→ember-bright 发光）+ 粒子上升（复用 stepper particle-rise）。
 * 进场：照搬 SplitReview 章节列表模式，x:-16 stagger 滑入。
 */
const props = defineProps<{
  candidates: OpeningCandidateCharacter[]
}>()

const emit = defineEmits<{
  select: [candidate: OpeningCandidateCharacter]
  back: []
}>()

const listRef = ref<HTMLElement | null>(null)
const selectedIndex = ref<number | null>(null)
const expandedBrief = ref<number | null>(null)
const truncationMap = ref<Record<number, boolean>>({})

function selectCandidate(index: number) {
  selectedIndex.value = index
}

function toggleBrief(index: number) {
  expandedBrief.value = expandedBrief.value === index ? null : index
}

/** 检测每行简介文本是否被 ellipsis 截断，只给被截断的行显示展开链接。 */
function checkTruncation() {
  if (!listRef.value) return
  const briefEls = listRef.value.querySelectorAll(".brief-text")
  const map: Record<number, boolean> = {}
  briefEls.forEach((el) => {
    const htmlEl = el as HTMLElement
    const index = Number(htmlEl.dataset.index)
    map[index] = htmlEl.scrollWidth > htmlEl.clientWidth + 1
  })
  truncationMap.value = map
}

function confirmSelection() {
  if (selectedIndex.value === null) return
  emit("select", props.candidates[selectedIndex.value])
}

onMounted(async () => {
  await nextTick()
  if (!listRef.value) return
  const rows = listRef.value.querySelectorAll(".char-row")
  gsap.fromTo(rows,
    { opacity: 0, x: -16 },
    {
      opacity: 1, x: 0, duration: 0.35, stagger: 0.04, ease: "power2.out",
      onComplete: () => checkTruncation(),
    },
  )
})

onUnmounted(() => {
  if (listRef.value) gsap.killTweensOf(listRef.value.querySelectorAll(".char-row"))
})
</script>

<template>
  <div class="canon-select">
    <h3 class="guide-question">选择你要扮演的角色</h3>

    <!-- 空候选提示 -->
    <div v-if="candidates.length === 0" class="empty-hint">
      <p class="empty-text">未找到合适的原著角色候选</p>
      <p class="empty-sub">请返回选择原创角色，创造你自己的身份</p>
      <button class="empty-back" type="button" @click="emit('back')">
        返回选择原创角色
      </button>
    </div>

    <!-- 候选列表 -->
    <div v-else ref="listRef" class="char-list">
      <button
        v-for="(candidate, i) in candidates"
        :key="candidate.id || candidate.name"
        class="char-row"
        :class="{ selected: selectedIndex === i }"
        type="button"
        @click="selectCandidate(i)"
        @dblclick="selectCandidate(i); confirmSelection()"
      >
        <!-- 标记字方块 -->
        <span class="row-mark" aria-hidden="true">
          {{ candidate.name.charAt(0) }}
          <!-- 选中时粒子上升 -->
          <span v-if="selectedIndex === i" class="mark-particle" />
          <span v-if="selectedIndex === i" class="mark-particle p2" />
          <span v-if="selectedIndex === i" class="mark-particle p3" />
        </span>

        <!-- 角色信息 -->
        <span class="row-body">
          <span class="row-name">{{ candidate.name }}</span>
          <span v-if="expandedBrief !== i" class="row-brief">
            <span class="brief-text" :data-index="i">{{ candidate.brief }}</span>
            <span
              v-if="truncationMap[i]"
              class="brief-expand"
              role="button"
              tabindex="0"
              @click.stop="toggleBrief(i)"
              @keydown.enter.stop.prevent="toggleBrief(i)"
            >展开</span>
          </span>
          <Transition name="brief-detail-fade">
            <span v-if="expandedBrief === i" class="row-brief-full">
              {{ candidate.brief }}
              <span
                class="brief-expand"
                role="button"
                tabindex="0"
                @click.stop="toggleBrief(i)"
                @keydown.enter.stop.prevent="toggleBrief(i)"
              >收起</span>
            </span>
          </Transition>
        </span>

        <!-- 四角括号 -->
        <span class="bracket tl" aria-hidden="true" />
        <span class="bracket tr" aria-hidden="true" />
        <span class="bracket bl" aria-hidden="true" />
        <span class="bracket br" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.canon-select {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 20px 0;
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

/* ── 空候选提示 ── */
.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 40px 20px;
  text-align: center;
}
.empty-text {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 1rem;
  color: var(--prose-dim);
}
.empty-sub {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--whisper);
  letter-spacing: 0.05em;
}
.empty-back {
  margin-top: 12px;
  background: transparent;
  border: 1px solid var(--line-strong);
  border-radius: 4px;
  padding: 8px 24px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.1em;
  color: var(--prose-dim);
  transition: border-color 0.2s, color 0.2s;
}
.empty-back:hover {
  border-color: var(--ember);
  color: var(--prose);
}
.empty-back:active {
  transform: scale(0.96);
}

/* ── 候选列表 ── */
.char-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 480px;
}

/* ── 角色行 ── */
.char-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px 18px;
  background: linear-gradient(135deg, rgba(20, 14, 8, 0.5), rgba(10, 5, 6, 0.6));
  border: 1px solid var(--line);
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
  color: var(--prose);
  font-family: var(--font-serif);
  transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
}
.char-row:hover {
  transform: translateY(-1px);
  border-color: var(--ember);
  box-shadow: 0 0 12px rgba(181, 137, 61, 0.08);
}
.char-row.selected {
  border-color: var(--ember-bright);
  box-shadow:
    inset 0 0 20px rgba(232, 169, 72, 0.1),
    0 0 16px rgba(232, 169, 72, 0.12);
  /* 选中行从标记字向右渐隐的琥珀底色 */
  background:
    linear-gradient(90deg, rgba(232, 169, 72, 0.06) 0%, transparent 50%),
    linear-gradient(135deg, rgba(20, 14, 8, 0.5), rgba(10, 5, 6, 0.6));
}

/* ── 标记字方块 ── */
.row-mark {
  position: relative;
  font-family: var(--font-display);
  font-size: 1.3rem;
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
  background: rgba(181, 137, 61, 0.04);
  transition: color 0.25s, border-color 0.25s, box-shadow 0.25s;
}
.char-row:hover .row-mark {
  color: var(--ember-bright);
  border-color: var(--ember);
}
/* 选中态：标记字点燃 */
.char-row.selected .row-mark {
  color: var(--ember-bright);
  border-color: var(--ember-bright);
  background: rgba(232, 169, 72, 0.1);
  box-shadow:
    0 0 16px rgba(232, 169, 72, 0.35),
    inset 0 0 8px rgba(232, 169, 72, 0.15);
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.5);
  animation: mark-ignite 0.4s cubic-bezier(0.22, 1, 0.36, 1);
}
/* 点燃弹跳：选中瞬间 scale 放大再回弹 */
@keyframes mark-ignite {
  0% { transform: scale(1); }
  40% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

/* ── 粒子上升（复用 stepper particle-rise）── */
.mark-particle {
  position: absolute;
  top: -2px;
  left: 50%;
  width: 1.5px;
  height: 1.5px;
  border-radius: 50%;
  background: var(--ember-bright);
  box-shadow: 0 0 2px var(--ember);
  animation: mark-particle-rise 3s ease-out infinite;
}
.mark-particle.p2 {
  animation-delay: 1s;
  left: 35%;
}
.mark-particle.p3 {
  animation-delay: 2s;
  left: 65%;
}
@keyframes mark-particle-rise {
  0% { opacity: 0; transform: translate(-50%, 0); }
  20% { opacity: 0.7; }
  100% { opacity: 0; transform: translate(-50%, -14px); }
}

/* ── 角色信息 ── */
.row-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.row-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--prose);
  transition: color 0.25s, text-shadow 0.25s;
}
.char-row.selected .row-name {
  color: var(--ember-bright);
  text-shadow: 0 0 6px rgba(232, 169, 72, 0.25);
}
.row-brief {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--prose-dim);
  line-height: 1.4;
}
.brief-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.brief-expand {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ember);
  cursor: pointer;
  letter-spacing: 0.05em;
  transition: color 0.2s;
}
.brief-expand:hover {
  color: var(--ember-bright);
}
.row-brief-full {
  display: block;
  margin-top: 4px;
  font-size: 0.76rem;
  color: var(--prose-dim);
  line-height: 1.5;
  white-space: normal;
  word-break: break-all;
}
.row-brief-full .brief-expand {
  display: inline-block;
  margin-left: 6px;
  vertical-align: baseline;
}
.brief-detail-fade-enter-active,
.brief-detail-fade-leave-active {
  transition: opacity 0.2s ease, max-height 0.25s ease;
  overflow: hidden;
  max-height: 120px;
}
.brief-detail-fade-enter-from,
.brief-detail-fade-leave-to {
  opacity: 0;
  max-height: 0;
}

/* ── 四角括号 ── */
.bracket {
  position: absolute;
  width: 7px;
  height: 7px;
  border: 1px solid var(--ember);
  opacity: 0.3;
  transition: opacity 0.25s;
}
.char-row:hover .bracket {
  opacity: 0.5;
}
.char-row.selected .bracket {
  opacity: 0.7;
}
.bracket.tl { top: 4px; left: 4px; border-right: none; border-bottom: none; }
.bracket.tr { top: 4px; right: 4px; border-left: none; border-bottom: none; }
.bracket.bl { bottom: 4px; left: 4px; border-right: none; border-top: none; }
.bracket.br { bottom: 4px; right: 4px; border-left: none; border-top: none; }
</style>
