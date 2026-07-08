<script setup lang="ts">
/**
 * ItemDetailModal — 物品/容器详情模态。
 *
 * design §6.4 / task 07-04 D6：
 * - props：entity（可 null）+ entityRef + breadcrumb 路径 + loading + gridItems（容器 contents 网格预解析）。
 * - 若 entity 是容器 → 展示 breadcrumb + 名称 + type chip + brief + extensions + contents InventoryGrid。
 * - 若 entity 是物品 → 展示 breadcrumb + 名称 + type chip + brief + tags + extensions。
 * - entity null + loading → 加载态；entity null + !loading → "档案缺失"降级。
 * - 关闭：ESC / 遮罩点击 / 右上关闭按钮 → emit `close`。
 * - 嵌套容器：InventoryGrid emit select → 本组件 emit `select(ref)` 上抛。
 * - 面包屑：InventoryBreadcrumb emit navigate → 本组件 emit `navigate(index)` 上抛。
 *
 * extensions 分区：直接消费父组件传入的 DisplayItems（父组件调 parseExtensionsOnly）。
 */
import { computed, onMounted, onUnmounted, watch } from "vue"
import type { InventoryEntity } from "../../lib/item-types"
import { isContainerEntity } from "../../lib/item-types"
import type { DisplayItems } from "../../lib/runtime-types"
import { emptyDisplayItems } from "../../lib/runtime-types"
import InventoryBreadcrumb from "./InventoryBreadcrumb.vue"
import InventoryGrid, { type InventoryGridItem } from "./InventoryGrid.vue"

const props = defineProps<{
  entity: InventoryEntity | null
  entityRef: string
  breadcrumb: Array<{ ref: string; name: string }>
  loading: boolean
  /** 容器 contents 预解析结果，由父组件负责读取。非容器实体传空数组即可。 */
  gridItems: InventoryGridItem[]
  /** entity.extensions 预解析结果，由父组件负责调 parseExtensionsOnly。 */
  displayItems: DisplayItems
}>()

const emit = defineEmits<{
  select: [ref: string]
  navigate: [index: number]
  close: []
}>()

const isContainer = computed(
  () => props.entity !== null && isContainerEntity(props.entity),
)

const typeLabel = computed<string>(() => {
  const e = props.entity
  if (!e) return ""
  switch (e.type) {
    case "container":
      return "容器"
    case "equipment":
      return "装备"
    case "material":
      return "材料"
    case "consumable":
      return "消耗品"
    case "special":
      return "特殊"
    case "other":
      return "其它"
    default:
      return String(e.type)
  }
})

const tags = computed<string[]>(() => {
  const e = props.entity
  if (!e || isContainerEntity(e)) return []
  return e.tags ?? []
})

const displayItems = computed<DisplayItems>(
  () => props.displayItems ?? emptyDisplayItems(),
)
const hasMetrics = computed(() => displayItems.value.metrics.length > 0)
const hasExtTags = computed(() => displayItems.value.tags.length > 0)
const hasRefs = computed(() => displayItems.value.refs.length > 0)
const hasSections = computed(() => displayItems.value.sections.length > 0)

const localIdFallback = computed(() => {
  const r = props.entityRef
  const idx = r.indexOf(":")
  return idx >= 0 ? r.slice(idx + 1) : r
})

function onBackdropClick() {
  emit("close")
}

function onCardClick(e: MouseEvent) {
  // 阻止冒泡到遮罩
  e.stopPropagation()
}

function onClose() {
  emit("close")
}

function onSelect(ref: string) {
  emit("select", ref)
}

function onNavigate(index: number) {
  emit("navigate", index)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault()
    emit("close")
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown)
})
onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown)
})

// 打开时锁滚动条，关闭时恢复。用 body overflow 简单处理。
watch(
  () => props.entity,
  () => {
    // 无需要额外操作；模态挂载/卸载由父 v-if 控制
  },
)
</script>

<template>
  <div class="modal-mask" role="presentation" @click="onBackdropClick">
    <div
      class="modal-card"
      role="dialog"
      aria-modal="true"
      @click="onCardClick"
    >
      <button
        type="button"
        class="modal-close"
        aria-label="关闭"
        @click="onClose"
      >×</button>

      <!-- 面包屑 -->
      <InventoryBreadcrumb
        v-if="breadcrumb.length > 1"
        :path="breadcrumb"
        @navigate="onNavigate"
      />

      <!-- 主体：entity 有效 -->
      <template v-if="entity">
        <div class="title-row">
          <div class="title-name">{{ entity.name }}</div>
          <span class="type-chip">{{ typeLabel }}</span>
        </div>
        <p class="brief">{{ entity.brief }}</p>

        <!-- 物品 tags -->
        <div v-if="tags.length > 0" class="tag-list">
          <span v-for="t in tags" :key="t" class="tag-chip">{{ t }}</span>
        </div>

        <!-- extensions 分区 -->
        <section v-if="hasMetrics" class="ext-section">
          <div class="section-title">数值</div>
          <ul class="ext-metric-list">
            <li
              v-for="(m, idx) in displayItems.metrics"
              :key="`metric-${idx}`"
              class="ext-metric-row"
            >
              <div class="ext-metric-head">
                <span class="ext-metric-label">{{ m.label }}</span>
                <span class="ext-metric-value">
                  {{ typeof m.value === "number" ? m.value : 0
                  }}<span v-if="m.unit" class="ext-metric-unit">{{ m.unit }}</span>
                </span>
              </div>
              <div v-if="m.render === 'progress'" class="ext-metric-track">
                <div
                  class="ext-metric-fill"
                  :style="{
                    width: `${Math.max(0, Math.min(100, ((typeof m.value === 'number' ? m.value : 0) - (m.min ?? 0)) / ((m.max ?? 100) - (m.min ?? 0)) * 100))}%`
                  }"
                />
              </div>
            </li>
          </ul>
        </section>

        <section v-if="hasExtTags" class="ext-section">
          <div class="section-title">标签</div>
          <div class="ext-tags">
            <span
              v-for="(t, idx) in displayItems.tags"
              :key="`ext-tag-${idx}`"
              class="ext-tag"
            >{{ t.label }}<template v-if="typeof t.value === 'string' && t.value.length > 0">：{{ t.value }}</template></span>
          </div>
        </section>

        <section v-if="hasRefs" class="ext-section">
          <div class="section-title">关联</div>
          <ul class="ext-ref-list">
            <li
              v-for="(r, idx) in displayItems.refs"
              :key="`ext-ref-${idx}`"
              class="ext-ref-row"
            >
              <span class="ext-ref-label">{{ r.label }}</span>
              <span v-if="r.name" class="ext-ref-name">{{ r.name }}</span>
            </li>
          </ul>
        </section>

        <section v-if="hasSections" class="ext-section">
          <div class="section-title">详情</div>
          <div class="ext-sections">
            <div
              v-for="(s, idx) in displayItems.sections"
              :key="`sec-${idx}`"
              class="ext-section-inner"
            >
              <div v-if="s.title" class="ext-section-inner-title">{{ s.title }}</div>
              <div v-if="s.body" class="ext-section-inner-body">{{ s.body }}</div>
            </div>
          </div>
        </section>

        <!-- 容器内容网格 -->
        <section v-if="isContainer" class="ext-section">
          <div class="section-title">内含</div>
          <InventoryGrid
            :items="gridItems"
            empty-text="空容器"
            @select="onSelect"
          />
        </section>
      </template>

      <!-- 加载态 -->
      <div v-else-if="loading" class="fallback">
        <div class="fallback-glyph">…</div>
        <div class="fallback-text">读取中…</div>
      </div>

      <!-- 档案缺失 -->
      <div v-else class="fallback">
        <div class="fallback-glyph">{{ localIdFallback.charAt(0) || "?" }}</div>
        <div class="fallback-name">{{ localIdFallback || "未知" }}</div>
        <div class="fallback-text">档案缺失</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(6, 6, 8, 0.7);
  backdrop-filter: blur(6px);
}
.modal-card {
  position: relative;
  width: min(560px, 100%);
  max-height: 80vh;
  overflow-y: auto;
  background: var(--void-deep);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  padding: 24px 26px 22px;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.02),
    0 26px 60px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.modal-card::before {
  content: "";
  position: absolute;
  inset: 8px;
  border: 1px solid rgba(181, 137, 61, 0.1);
  border-radius: 8px;
  pointer-events: none;
}
.modal-close {
  position: absolute;
  top: 10px;
  right: 12px;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--prose-muted);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background 0.2s;
  z-index: 1;
}
.modal-close:hover {
  color: var(--ember-bright);
  border-color: var(--line);
  background: rgba(181, 137, 61, 0.06);
}
.modal-close:focus-visible {
  outline: 1px solid rgba(232, 169, 72, 0.5);
  outline-offset: 1px;
}

.title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.title-name {
  font-family: var(--font-display);
  font-size: 1.55rem;
  color: var(--ember-bright);
  font-weight: 700;
  letter-spacing: 0.04em;
}
.type-chip {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  color: var(--ember);
  border: 1px solid rgba(181, 137, 61, 0.35);
  border-radius: 10px;
  padding: 2px 8px;
  text-transform: uppercase;
}
.brief {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.75;
  color: var(--prose-muted);
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tag-chip {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1px 8px;
}

.ext-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-title {
  font-family: var(--font-mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
  text-transform: uppercase;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}
.ext-metric-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ext-metric-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ext-metric-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.ext-metric-label {
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-muted);
}
.ext-metric-value {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--ember-bright);
}
.ext-metric-unit {
  margin-left: 2px;
  font-size: 0.7rem;
  color: var(--prose-muted);
}
.ext-metric-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(181, 137, 61, 0.1);
  overflow: hidden;
}
.ext-metric-fill {
  height: 100%;
  background: var(--ember);
  transition: width 0.4s ease;
}
.ext-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ext-tag {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--prose-muted);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 1px 8px;
}
.ext-ref-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ext-ref-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.78rem;
}
.ext-ref-label {
  font-family: var(--font-serif);
  color: var(--prose-muted);
}
.ext-ref-name {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--ember-bright);
  margin-left: auto;
}
.ext-sections {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ext-section-inner-title {
  font-family: var(--font-serif);
  font-size: 0.86rem;
  color: var(--prose);
  margin-bottom: 4px;
}
.ext-section-inner-body {
  font-size: 0.82rem;
  line-height: 1.7;
  color: var(--prose-muted);
}

.fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 32px 0 24px;
  color: var(--prose-faint);
}
.fallback-glyph {
  font-family: var(--font-display);
  font-size: 3.2rem;
  color: var(--ember-bright);
  opacity: 0.4;
  font-weight: 700;
  text-shadow: 0 0 16px rgba(232, 169, 72, 0.12);
  line-height: 1;
}
.fallback-name {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--prose-muted);
  letter-spacing: 0.06em;
}
.fallback-text {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}
</style>
