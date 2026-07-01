<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from "vue"
import gsap from "gsap"
import { useSetupState } from "../../../composables/useSetupState"
import { formatNumber, formatCharacters, formatOptionalCharacters, type SourceManifest, type ChapterIndexFile } from "../../../lib/source"

/**
 * SplitReview — 导入结果确认（概览 + 双栏章节/预览）。
 *
 * 保留双栏结构，提升精致感：
 * - 概览区：书名 Cinzel + ember-bright + 分隔线 + 统计 mono 标签化
 * - 章节列表：选中项 ember 左条 + 背景渐入 + 文字变亮，切换时 GSAP 高亮过渡
 * - 预览区：切换章节时 opacity+translateY 过渡（非硬切），逐段 Serif 文字
 * - 双栏间 ember 竖线分隔（非 gap 空白）
 * - 章节卡片进场 GSAP stagger
 */
const props = defineProps<{
  manifest: SourceManifest | null
  chapterIndex: ChapterIndexFile | null
}>()

const { selectedChapterWritable, loadChapterPreview } = useSetupState()

const previewText = ref("读取预览中…")
const previewTitle = ref("")
const previewKey = ref(0) // 用于触发预览区 Transition
const listRef = ref<HTMLElement | null>(null)
const previewRef = ref<HTMLElement | null>(null)

const chapters = computed(() => props.chapterIndex?.chapters ?? [])
const selectedIndex = computed(() =>
  Math.max(0, Math.min(selectedChapterWritable.value, chapters.value.length - 1)),
)

async function loadPreview() {
  const ch = chapters.value[selectedIndex.value]
  if (!ch) {
    previewText.value = "章节列表为空。"
    previewTitle.value = "暂无章节"
    return
  }
  previewTitle.value = ch.title || `第 ${selectedIndex.value + 1} 章`
  previewText.value = "读取预览中…"
  try {
    previewText.value = await loadChapterPreview(ch.path)
  } catch {
    previewText.value = "预览读取失败。"
  }
}

function selectChapter(i: number) {
  if (i === selectedChapterWritable.value) return
  selectedChapterWritable.value = i
  // 触发预览区过渡动画
  previewKey.value++
}

// 章节选择变化时重新加载预览
watch(selectedChapterWritable, loadPreview)

onMounted(async () => {
  await loadPreview()
  // 章节列表进场动画
  await nextTick()
  if (listRef.value) {
    const cards = listRef.value.querySelectorAll(".chapter-card")
    gsap.fromTo(cards,
      { opacity: 0, x: -16 },
      { opacity: 1, x: 0, duration: 0.35, stagger: 0.04, ease: "power2.out" },
    )
  }
})
</script>

<template>
  <div class="review">
    <!-- 概览区：书名 + 统计标签 -->
    <div class="overview" v-if="manifest">
      <div class="overview-main">
        <div class="book-title">{{ manifest.title }}</div>
        <div class="overview-meta">
          <span class="meta-tag">{{ formatNumber(manifest.chapterCount) }} 章</span>
          <span class="meta-dot">·</span>
          <span class="meta-tag">{{ formatCharacters(manifest.totalCharacters) }}</span>
          <span class="meta-dot">·</span>
          <span class="meta-tag">{{ manifest.importMode === 'paste' ? '粘贴导入' : '文件导入' }}</span>
        </div>
      </div>
    </div>

    <!-- 双栏：章节列表 | ember 竖线 | 预览 -->
    <div class="review-panes">
      <!-- 章节列表 -->
      <div ref="listRef" class="chapter-list">
        <button
          v-for="(ch, i) in chapters"
          :key="i"
          class="chapter-card"
          :class="{ selected: i === selectedIndex }"
          type="button"
          @click="selectChapter(i)"
        >
          <span class="chapter-num">{{ String(i + 1).padStart(3, '0') }}</span>
          <span class="chapter-main">
            <span class="chapter-title">{{ ch.title || `第 ${i + 1} 章` }}</span>
            <span class="chapter-size">{{ formatOptionalCharacters(ch.characters) }}</span>
          </span>
        </button>
      </div>

      <!-- ember 竖线分隔 -->
      <div class="panes-divider" aria-hidden="true" />

      <!-- 预览区 -->
      <div ref="previewRef" class="preview">
        <Transition name="preview-switch" mode="out-in">
          <div :key="previewKey" class="preview-inner">
            <div class="preview-kicker">
              预览 · {{ String(selectedIndex + 1).padStart(3, '0') }}
            </div>
            <h3 class="preview-title">{{ previewTitle }}</h3>
            <div class="preview-body">{{ previewText }}</div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── 概览区 ── */
.overview {
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.overview-main {
  display: flex;
  align-items: baseline;
  gap: 16px;
  flex-wrap: wrap;
}
.book-title {
  font-family: var(--font-display);
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--ember-bright);
  letter-spacing: 0.04em;
  text-shadow: 0 0 12px rgba(232, 169, 72, 0.15);
}
.overview-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.meta-tag {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-dim);
  letter-spacing: 0.06em;
}
.meta-dot {
  color: var(--whisper);
  font-size: 0.65rem;
}

/* ── 双栏 ── */
.review-panes {
  display: flex;
  height: 380px;
}

/* 章节列表 */
.chapter-list {
  flex: 0 0 210px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
  padding-right: 8px;
}
/* 滚动条细化 */
.chapter-list::-webkit-scrollbar {
  width: 3px;
}
.chapter-list::-webkit-scrollbar-thumb {
  background: var(--whisper);
  border-radius: 2px;
}

.chapter-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0 4px 4px 0;
  cursor: pointer;
  text-align: left;
  color: var(--prose-dim);
  font-family: var(--font-serif);
  transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.chapter-card:hover {
  background: rgba(181, 137, 61, 0.04);
  color: var(--prose);
}
.chapter-card.selected {
  border-left-color: var(--ember-bright);
  background: linear-gradient(
    90deg,
    rgba(232, 169, 72, 0.08) 0%,
    transparent 100%
  );
  color: var(--ember-bright);
}

.chapter-num {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ember);
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 0.25s;
}
.chapter-card.selected .chapter-num {
  color: var(--ember-bright);
  opacity: 1;
}

.chapter-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}
.chapter-title {
  font-size: 0.82rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chapter-size {
  font-family: var(--font-mono);
  font-size: 0.63rem;
  color: var(--whisper);
}

/* ember 竖线分隔 */
.panes-divider {
  flex: 0 0 1px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--line) 15%,
    var(--line) 85%,
    transparent 100%
  );
}

/* ── 预览区 ── */
.preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 4px 0 4px 20px;
  overflow: hidden;
}
.preview-inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow-y: auto;
  padding-right: 8px;
}
.preview-inner::-webkit-scrollbar {
  width: 3px;
}
.preview-inner::-webkit-scrollbar-thumb {
  background: var(--whisper);
  border-radius: 2px;
}

.preview-kicker {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  color: var(--ember);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.preview-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.05rem;
  color: var(--ember-bright);
  font-weight: 600;
  letter-spacing: 0.03em;
}
.preview-body {
  font-family: var(--font-serif);
  font-size: 0.85rem;
  line-height: 1.85;
  color: var(--prose-dim);
  white-space: pre-wrap;
}

/* ── 预览切换过渡 ── */
.preview-switch-enter-active {
  transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.preview-switch-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.preview-switch-enter-from {
  opacity: 0;
  transform: translateX(16px);
}
.preview-switch-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}
</style>
