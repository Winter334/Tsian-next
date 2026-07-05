<script setup lang="ts">
/**
 * InventoryGrid — 图标网格（顶层容器 / 容器 contents 复用）。
 *
 * design §6.2 / task 07-04 D4：
 * - 父组件负责 useEntity 读取（避免网格内部重复读取）。
 * - CSS grid，固定列宽 64-72px，自适应列数。
 * - 每格：ItemIcon + count 角标（count > 1） + 底部名字（截断）。
 * - 容器格：边框 `--ember` 半透明，`data-variant="container"`。
 * - entity 缺失：首字 fallback + 暗化边框，title="档案缺失"。
 * - 空 contents：展示 `<div class="empty">`（"空容器"）。
 *
 * emit `select(ref)`：点击非缺失格触发。缺失格仍可点击但父组件可决定是否忽略。
 */
import type { InventoryEntity } from "../../lib/item-types"
import { isContainerEntity } from "../../lib/item-types"
import ItemIcon from "./ItemIcon.vue"

/** 网格单元：由父组件预解析实体，含读取状态。 */
export interface InventoryGridItem {
  ref: string
  count?: number
  entity: InventoryEntity | null
  /** ready = 读取到实体；missing = 读不到；loading = 读取中。 */
  status: "ready" | "missing" | "loading"
}

const props = defineProps<{
  items: InventoryGridItem[]
  /** 网格容器为空时展示的文案；缺省则展示"空容器"。 */
  emptyText?: string
}>()

const emit = defineEmits<{
  select: [ref: string]
}>()

function displayName(item: InventoryGridItem): string {
  if (item.entity && item.entity.name.length > 0) return item.entity.name
  const idx = item.ref.indexOf(":")
  return idx >= 0 ? item.ref.slice(idx + 1) : item.ref
}

function isContainer(item: InventoryGridItem): boolean {
  return item.entity !== null && isContainerEntity(item.entity)
}

function onClick(item: InventoryGridItem) {
  emit("select", item.ref)
}

function onKeydown(event: KeyboardEvent, item: InventoryGridItem) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault()
    onClick(item)
  }
}
</script>

<template>
  <div v-if="items.length === 0" class="grid-empty">
    <span>{{ emptyText ?? "空容器" }}</span>
  </div>
  <div v-else class="inv-grid" role="list">
    <button
      v-for="item in items"
      :key="item.ref"
      type="button"
      class="inv-cell"
      role="listitem"
      :data-variant="isContainer(item) ? 'container' : 'item'"
      :data-missing="item.status === 'missing' ? 'true' : undefined"
      :title="item.status === 'missing' ? '档案缺失' : displayName(item)"
      @click="onClick(item)"
      @keydown="onKeydown($event, item)"
    >
      <div class="inv-cell-icon">
        <ItemIcon :entity="item.entity" :entity-ref="item.ref" />
      </div>
      <span
        v-if="typeof item.count === 'number' && item.count > 1"
        class="inv-cell-count"
      >×{{ item.count }}</span>
      <div class="inv-cell-name">{{ displayName(item) }}</div>
    </button>
  </div>
</template>

<style scoped>
.inv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
  gap: 12px;
  padding: 4px 0;
}
.inv-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 6px 4px 4px;
  background: var(--void-deep);
  border: 1px solid var(--line);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s, box-shadow 0.2s;
  color: inherit;
  font: inherit;
  text-align: center;
  outline: none;
}
.inv-cell:hover {
  border-color: var(--ember);
  box-shadow: 0 0 12px rgba(181, 137, 61, 0.16);
}
.inv-cell:focus-visible {
  border-color: var(--ember-bright);
  box-shadow: 0 0 0 1px rgba(232, 169, 72, 0.35);
}
.inv-cell[data-variant="container"] {
  border-color: rgba(181, 137, 61, 0.5);
}
.inv-cell[data-variant="container"]::before {
  /* 内层细线，参考 CharacterPortrait 风格 */
  content: "";
  position: absolute;
  inset: 3px;
  border: 1px solid rgba(181, 137, 61, 0.15);
  border-radius: 5px;
  pointer-events: none;
}
.inv-cell[data-missing="true"] {
  border-color: rgba(120, 120, 130, 0.35);
  opacity: 0.72;
}
.inv-cell-icon {
  aspect-ratio: 1 / 1;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.inv-cell-count {
  position: absolute;
  top: 4px;
  right: 6px;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  color: var(--ember-bright);
  letter-spacing: 0.04em;
  background: rgba(6, 6, 8, 0.72);
  padding: 1px 5px;
  border-radius: 8px;
  line-height: 1.4;
}
.inv-cell-name {
  font-family: var(--font-serif);
  font-size: 0.72rem;
  color: var(--prose-dim);
  line-height: 1.25;
  padding: 0 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.grid-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  color: var(--whisper);
}
</style>
