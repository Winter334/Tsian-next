<script setup lang="ts">
import { ref, watch, onMounted, nextTick, computed } from "vue"
import gsap from "gsap"
import { useSetupState } from "../../../composables/useSetupState"
import { formatNumber, formatCharacters, formatOptionalCharacters, type SourceManifest, type ChapterIndexFile } from "../../../lib/source"

/**
 * SplitReview — 导入结果确认（概览 + 双栏章节/预览）。
 *
 * 章节目录使用固定行高虚拟滚动，避免长篇导入时渲染几千个按钮。
 */
const props = defineProps<{
  manifest: SourceManifest | null
  chapterIndex: ChapterIndexFile | null
}>()

const { selectedChapterWritable, loadChapterPreview } = useSetupState()

const ROW_HEIGHT = 58
const OVERSCAN = 6

const previewText = ref("读取预览中…")
const previewTitle = ref("")
const previewKey = ref(0) // 用于触发预览区 Transition
const listRef = ref<HTMLElement | null>(null)
const previewRef = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(380)

const chapters = computed(() => props.chapterIndex?.chapters ?? [])
const selectedIndex = computed(() =>
  Math.max(0, Math.min(selectedChapterWritable.value, Math.max(0, chapters.value.length - 1))),
)
const totalListHeight = computed(() => chapters.value.length * ROW_HEIGHT)
const visibleStart = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_HEIGHT) - OVERSCAN))
const visibleEnd = computed(() => Math.min(
  chapters.value.length,
  Math.ceil((scrollTop.value + viewportHeight.value) / ROW_HEIGHT) + OVERSCAN,
))
const visibleChapters = computed(() => chapters.value.slice(visibleStart.value, visibleEnd.value))
const visibleOffset = computed(() => visibleStart.value * ROW_HEIGHT)

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
    previewText.value = await loadChapterPreview(ch)
  } catch {
    previewText.value = "预览读取失败。"
  }
}

function updateViewportMetrics() {
  if (!listRef.value) return
  viewportHeight.value = listRef.value.clientHeight || 380
}

function onScroll() {
  scrollTop.value = listRef.value?.scrollTop ?? 0
}

function selectChapter(i: number) {
  if (i === selectedChapterWritable.value) return
  selectedChapterWritable.value = i
  // 触发预览区过渡动画
  previewKey.value++
}

function scrollSelectedIntoView() {
  const el = listRef.value
  if (!el || chapters.value.length === 0) return
  const top = selectedIndex.value * ROW_HEIGHT
  const bottom = top + ROW_HEIGHT
  const viewportTop = el.scrollTop
  const viewportBottom = viewportTop + el.clientHeight
  if (top < viewportTop) {
    el.scrollTop = top
  } else if (bottom > viewportBottom) {
    el.scrollTop = bottom - el.clientHeight
  }
  scrollTop.value = el.scrollTop
}

// 章节选择变化时重新加载预览
watch(selectedChapterWritable, async () => {
  await loadPreview()
  await nextTick()
  scrollSelectedIntoView()
})

watch(chapters, () => {
  if (selectedChapterWritable.value >= chapters.value.length) {
    selectedChapterWritable.value = Math.max(0, chapters.value.length - 1)
  }
  void loadPreview()
})

onMounted(async () => {
  updateViewportMetrics()
  await loadPreview()
  await nextTick()
  scrollSelectedIntoView()
  if (listRef.value && chapters.value.length <= 200) {
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
      <div ref="listRef" class="chapter-list" @scroll="onScroll">
        <div class="chapter-spacer" :style="{ height: `${totalListHeight}px` }">
          <div class="chapter-window" :style="{ transform: `translateY(${visibleOffset}px)` }">
            <button
              v-for="(ch, offset) in visibleChapters"
              :key="'ref' in ch ? ch.ref : ch.path"
              class="chapter-card"
              :class="{ selected: (visibleStart + offset) === selectedIndex }"
              type="button"
              @click="selectChapter(visibleStart + offset)"
            >
              <span class="chapter-num">{{ String(visibleStart + offset + 1).padStart(3, '0') }}</span>
              <span class="chapter-main">
                <span class="chapter-title">{{ ch.title || `第 ${visibleStart + offset + 1} 章` }}</span>
                <span class="chapter-size">{{ formatOptionalCharacters(ch.characters) }}</span>
              </span>
            </button>
          </div>
        </div>
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
  color: var(--prose-muted);
  letter-spacing: 0.06em;
}
.meta-dot {
  color: var(--prose-faint);
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
  overflow-y: auto;
  padding-right: 8px;
}
.chapter-spacer {
  position: relative;
  width: 100%;
}
.chapter-window {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  will-change: transform;
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
  height: 56px;
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
  color: var(--prose-muted);
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
  color: var(--prose-faint);
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
  letter-spacing: 0.08em;
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
  color: var(--prose-muted);
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
