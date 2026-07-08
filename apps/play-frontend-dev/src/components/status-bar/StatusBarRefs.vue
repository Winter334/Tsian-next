<script setup lang="ts">
/**
 * StatusBarRefs — 状态栏"关联"区（可选）。
 *
 * design §5.6：
 * - 小标题"关联" + 渐变细线。
 * - 每项显示 label + name（ref 的展示快照，非权威）。
 * - refs 为空时整个关联区不渲染（避免空标题占位）。
 * - MVP：仅展示，不跳转（跳转归角色卡子任务）。
 *
 * 按 category=ref 渲染（render-mapping：ref/cards/list → ref）。
 */
import { computed } from "vue"
import type { DisplayItem } from "../../lib/runtime-types"

const props = defineProps<{
  refs: DisplayItem[]
}>()

interface RefRow {
  label: string
  name?: string
  ref?: string
}

const rows = computed<RefRow[]>(() => {
  return props.refs.map((item) => ({
    label: item.label,
    name: typeof item.name === "string" && item.name.length > 0 ? item.name : undefined,
    ref: item.ref,
  }))
})

// refs 为空时整个区域不渲染（design §5.6）。
const hasContent = computed(() => rows.value.length > 0)
</script>

<template>
  <section v-if="hasContent" class="sb-refs">
    <header class="sb-section-head">
      <h3 class="sb-section-title">关联</h3>
      <span class="sb-section-line" />
    </header>

    <ul class="ref-list">
      <li v-for="(r, idx) in rows" :key="`ref-${idx}`" class="ref-row">
        <span class="ref-label">{{ r.label }}</span>
        <span v-if="r.name" class="ref-name">{{ r.name }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.sb-refs {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sb-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sb-section-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
  text-transform: uppercase;
  flex-shrink: 0;
}
.sb-section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--line-strong), transparent);
  opacity: 0.6;
}

.ref-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ref-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.78rem;
}

.ref-label {
  font-family: var(--font-serif);
  color: var(--prose-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ref-name {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ember-bright);
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
