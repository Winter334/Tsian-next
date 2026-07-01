<script setup lang="ts">
import { ref, watch, onMounted } from "vue"
import { useSetupState } from "../../../composables/useSetupState"
import { formatNumber, formatCharacters, formatOptionalCharacters, type SourceManifest, type ChapterIndexFile } from "../../../lib/source"

/**
 * SplitReview — 导入结果确认（概览 + 双栏章节/预览）。
 *
 * prd 向导 Step 1 review：概览（标题 + 章节数 + 字数 mono）+ 双栏（章节列表 / 预览）；
 * 列表项 --ember 左条选中；预览异步加载；"开始理解"按钮在 SetupWizard action bar。
 */
const props = defineProps<{
  manifest: SourceManifest | null
  chapterIndex: ChapterIndexFile | null
}>()

const { selectedChapterWritable, loadChapterPreview } = useSetupState()

const previewText = ref("读取预览中…")
const previewTitle = ref("")

const chapters = () => props.chapterIndex?.chapters ?? []
const selected = () => Math.max(0, Math.min(selectedChapterWritable.value, chapters().length - 1))

async function loadPreview() {
  const ch = chapters()[selected()]
  if (!ch) {
    previewText.value = "章节列表为空。"
    previewTitle.value = "暂无章节"
    return
  }
  previewTitle.value = ch.title || `第 ${selected() + 1} 章`
  previewText.value = "读取预览中…"
  try {
    previewText.value = await loadChapterPreview(ch.path)
  } catch {
    previewText.value = "预览读取失败。"
  }
}

function selectChapter(i: number) {
  selectedChapterWritable.value = i
}

// 章节选择变化时重新加载预览
watch(selectedChapterWritable, loadPreview)

onMounted(loadPreview)
</script>

<template>
  <div class="review">
    <!-- 概览 -->
    <div class="overview" v-if="manifest">
      <div class="book-title">{{ manifest.title }}</div>
      <div class="overview-stats">
        <span class="stat">{{ formatNumber(manifest.chapterCount) }} 章</span>
        <span class="stat">{{ formatCharacters(manifest.totalCharacters) }}</span>
      </div>
    </div>

    <!-- 双栏：章节列表 + 预览 -->
    <div class="review-panes">
      <div class="chapter-list">
        <button
          v-for="(ch, i) in chapters()"
          :key="i"
          class="chapter-card"
          :class="{ selected: i === selected() }"
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

      <div class="preview">
        <div class="preview-kicker">预览 · {{ String(selected() + 1).padStart(3, '0') }}</div>
        <h3 class="preview-title">{{ previewTitle }}</h3>
        <div class="preview-body">{{ previewText }}</div>
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

/* 概览 */
.overview {
  display: flex;
  align-items: baseline;
  gap: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.book-title {
  font-family: var(--font-display);
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--ember-bright);
  letter-spacing: 0.04em;
}
.overview-stats {
  display: flex;
  gap: 12px;
}
.stat {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--prose-dim);
  letter-spacing: 0.05em;
}

/* 双栏 */
.review-panes {
  display: flex;
  gap: 16px;
  height: 360px;
}

/* 章节列表 */
.chapter-list {
  flex: 0 0 200px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
  padding-right: 4px;
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
  transition: all 0.2s;
}
.chapter-card:hover {
  background: rgba(181, 137, 61, 0.05);
  color: var(--prose);
}
.chapter-card.selected {
  border-left-color: var(--ember);
  background: rgba(181, 137, 61, 0.08);
  color: var(--ember-bright);
}

.chapter-num {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--ember);
  flex-shrink: 0;
}
.chapter-card.selected .chapter-num {
  color: var(--ember-bright);
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
  font-size: 0.65rem;
  color: var(--whisper);
}

/* 预览 */
.preview {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow-y: auto;
}
.preview-kicker {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--ember);
  letter-spacing: 0.1em;
}
.preview-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1rem;
  color: var(--ember-bright);
  font-weight: 600;
}
.preview-body {
  font-family: var(--font-serif);
  font-size: 0.85rem;
  line-height: 1.8;
  color: var(--prose-dim);
  white-space: pre-wrap;
}
</style>
