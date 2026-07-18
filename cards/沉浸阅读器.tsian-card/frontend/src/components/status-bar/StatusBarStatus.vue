<script setup lang="ts">
/**
 * StatusBarStatus — 状态栏"状态"区。
 *
 * 主数据源为主角 entity.status；runtime tags 作为补充状态展示。
 */
import { computed } from "vue"
import type { CharacterStatus } from "../../lib/character-types"
import type { DisplayItem } from "../../lib/runtime-types"

const props = defineProps<{
  statuses: CharacterStatus[]
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

const isEmpty = computed(() => props.statuses.length === 0 && tagRows.value.length === 0)

/** 状态行主展示文本：优先 name，其次 description，兜底 id。 */
function statusText(s: CharacterStatus): string {
  return s.name ?? s.description ?? s.id
}

/** 状态行 tooltip：主展示是 name 时展示 description；主展示已是 description/id 时省略。 */
function statusTooltip(s: CharacterStatus): string | undefined {
  if (s.name && s.description && s.name !== s.description) return s.description
  return undefined
}
</script>

<template>
  <section class="sb-status">
    <header class="section-title-row">
      <h3 class="section-title">状态</h3>
      <span class="section-line" />
    </header>

    <ul v-if="!isEmpty" class="status-list">
      <li
        v-for="s in statuses"
        :key="s.id"
        class="status-row"
        :class="s.polarity ? `polarity-${s.polarity}` : undefined"
        :title="statusTooltip(s)"
      >
        <span class="status-dot" aria-hidden="true"></span>
        <span class="status-desc">{{ statusText(s) }}</span>
      </li>
      <li v-for="(t, idx) in tagRows" :key="`tag-${idx}`" class="status-row tag-row">
        <span class="status-dot" aria-hidden="true"></span>
        <span class="tag-label">{{ t.label }}</span>
        <span v-if="t.value" class="tag-value">{{ t.value }}</span>
      </li>
    </ul>

    <p v-else class="sb-empty">未见异常</p>
  </section>
</template>

<style scoped>
.sb-status {
  padding: 14px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-bottom: 1px solid rgba(181, 137, 61, 0.14);
}
.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title {
  margin: 0;
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 0.86rem;
  color: var(--ember-bright);
  letter-spacing: 0.08em;
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.12);
}
.section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(232, 169, 72, 0.42), transparent);
  opacity: 0.58;
}
.status-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.status-row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
}
.status-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--prose-muted);
  box-shadow: 0 0 6px rgba(181, 137, 61, 0.16);
}
.status-row.polarity-positive .status-dot {
  background: #7ea968;
  box-shadow: 0 0 8px rgba(126, 169, 104, 0.34);
}
.status-row.polarity-negative .status-dot {
  background: #c76d5a;
  box-shadow: 0 0 8px rgba(199, 109, 90, 0.34);
}
.status-row.polarity-neutral .status-dot,
.tag-row .status-dot {
  background: var(--ember);
  box-shadow: 0 0 8px rgba(181, 137, 61, 0.28);
}
.status-desc,
.tag-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-serif);
  font-size: 0.8rem;
  color: var(--prose);
  line-height: 1.4;
}
.tag-label {
  color: var(--prose-muted);
}
.tag-value {
  margin-left: auto;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ember-bright);
}
.sb-empty {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  color: var(--prose-faint);
  font-style: italic;
}
</style>
