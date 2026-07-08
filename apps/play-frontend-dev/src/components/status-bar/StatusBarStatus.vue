<script setup lang="ts">
/**
 * StatusBarStatus — 状态栏"状态"区。
 *
 * design §5.4（对齐新 schema）：
 * - 小标题"状态" + 渐变细线。
 * - 数据源：主角 entity.status 数组（每项 { id, name?, description?, polarity? }），
 *   通过 useEntity(protagonistRef) 按需读取；旧 runtime.status 已废弃。
 * - polarity: positive/negative/neutral（替代旧 level）。
 * - displayItems.tags：tag 类扩展项，label: value 或仅 label。
 * - 空态："暂无状态"（--whisper，小字斜置）。
 *
 * 不抛错：父容器只在 runtime 存在时渲染本区；本组件按字段 fallback。
 */
import { computed, onMounted } from "vue"
import type { DisplayItem } from "../../lib/runtime-types"
import { useEntity } from "../../composables/useEntity"

type Polarity = "positive" | "negative" | "neutral"

interface EntityStatus {
  id: string
  name?: string
  description?: string
  polarity?: Polarity
}

const props = defineProps<{
  /** 主角 entity ref（`character:<localId>`）；null 时不加载。 */
  protagonistRef: string | null
  tags: DisplayItem[]
}>()

// 通过 useEntity 按需读取主角实体，从 entity.status 提取状态数组。
// useEntity 在 setup 期捕获 ref 字符串；父容器通过 :key=protagonistRef 变化重挂本组件，
// 因此 setup 内直接用当前 ref 即可。ref 为空时不发起读取。
const { data: entityData, load: loadEntity } = useEntity(props.protagonistRef ?? "")

onMounted(() => {
  if (props.protagonistRef) void loadEntity()
})

const statusList = computed<EntityStatus[]>(() => {
  const raw = entityData.value?.entity?.status
  if (!Array.isArray(raw)) return []
  const out: EntityStatus[] = []
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue
    const r = item as Record<string, unknown>
    const id = typeof r.id === "string" ? r.id : null
    if (!id) continue
    const name = typeof r.name === "string" && r.name.length > 0 ? r.name : undefined
    const description = typeof r.description === "string" && r.description.length > 0 ? r.description : undefined
    const p = r.polarity
    const polarity: Polarity | undefined =
      p === "positive" || p === "negative" || p === "neutral" ? p : undefined
    out.push({ id, name, description, polarity })
  }
  return out
})

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

const isEmpty = computed(() => statusList.value.length === 0 && tagRows.value.length === 0)

/**
 * 状态行主展示文本：优先 name，其次 description，兜底 id。
 * design.md §6 / PRD D3：状态以名字为主视觉；description 作为 tooltip（title 属性）。
 */
function statusText(s: EntityStatus): string {
  return s.name ?? s.description ?? s.id
}

/**
 * 状态行 tooltip：主展示是 name 时展示 description；主展示已是 description/id 时省略。
 * 避免同一段文字在主内容与 tooltip 中重复。
 */
function statusTooltip(s: EntityStatus): string | undefined {
  if (s.name && s.description && s.name !== s.description) return s.description
  return undefined
}
</script>

<template>
  <section class="sb-status">
    <header class="sb-section-head">
      <h3 class="sb-section-title">状态</h3>
      <span class="sb-section-line" />
    </header>

    <ul v-if="!isEmpty" class="status-list">
      <li v-for="s in statusList" :key="s.id" class="status-row" :title="statusTooltip(s)">
        <span class="status-desc">{{ statusText(s) }}</span>
        <span
          v-if="s.polarity"
          class="status-polarity"
          :class="`polarity-${s.polarity}`"
        >{{ s.polarity }}</span>
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
.status-polarity {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--prose-muted);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 6px;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  text-transform: lowercase;
}
.status-polarity.polarity-positive {
  color: #7ea968;
  border-color: rgba(126, 169, 104, 0.4);
}
.status-polarity.polarity-negative {
  color: #c76d5a;
  border-color: rgba(199, 109, 90, 0.4);
}
.status-polarity.polarity-neutral {
  color: var(--prose-muted);
}

.tag-row .tag-label {
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-muted);
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
  color: var(--prose-faint);
  font-style: italic;
}
</style>
