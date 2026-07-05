<script setup lang="ts">
/**
 * StatusBarStatus — 状态栏"状态"区。
 *
 * design §5.4：
 * - 小标题"状态" + 渐变细线。
 * - runtime.status 数组：每项 description + 可选 level 小标签。
 * - displayItems.tags：tag 类扩展项，label: value 或仅 label。
 * - 空态："暂无状态"（--whisper，小字斜置）。
 *
 * 不抛错：父容器只在 runtime 存在时渲染本区；本组件按字段 fallback。
 */
import { computed } from "vue"
import type { DisplayItem } from "../../lib/runtime-types"

interface RuntimeStatus {
  id: string
  description: string
  level?: string
}

const props = defineProps<{
  status: RuntimeStatus[]
  tags: DisplayItem[]
}>()

interface TagRow {
  label: string
  value?: string
}

const tagRows = computed<TagRow[]>(() => {
  return props.tags.map((item) => {
    const label = item.label
    const v = item.value
    return {
      label,
      value: typeof v === "string" && v.length > 0 ? v : undefined,
    }
  })
})

const isEmpty = computed(() => props.status.length === 0 && tagRows.value.length === 0)
</script>

<template>
  <section class="sb-status">
    <header class="sb-section-head">
      <h3 class="sb-section-title">状态</h3>
      <span class="sb-section-line" />
    </header>

    <ul v-if="!isEmpty" class="status-list">
      <li v-for="s in status" :key="s.id" class="status-row">
        <span class="status-desc">{{ s.description }}</span>
        <span v-if="s.level" class="status-level">{{ s.level }}</span>
      </li>
      <li v-for="(t, idx) in tagRows" :key="`tag-${idx}`" class="status-row tag-row">
        <span class="tag-label">{{ t.label }}</span>
        <span v-if="t.value" class="tag-value">{{ t.value }}</span>
      </li>
    </ul>

    <p v-else class="sb-empty">暂无状态</p>
  </section>
</template>

<style scoped>
.sb-status {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 分区小标题 + 渐变细线（design §8） */
.sb-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sb-section-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.14em;
  color: var(--whisper);
  text-transform: uppercase;
  flex-shrink: 0;
}
.sb-section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--line-strong), transparent);
  opacity: 0.6;
}

.status-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
}
.status-desc {
  font-family: var(--font-serif);
  font-size: 0.82rem;
  color: var(--prose);
  line-height: 1.4;
}
.status-level {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--prose-dim);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 6px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}

.tag-row .tag-label {
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-dim);
}
.tag-row .tag-value {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--ember-bright);
}

.sb-empty {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  color: var(--whisper);
  font-style: italic;
}
</style>
