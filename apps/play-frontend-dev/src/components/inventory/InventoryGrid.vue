<script setup lang="ts">
/** InventoryGrid — 容器与物品共用的统一方格。 */
import type { InventoryEntity } from "../../lib/item-types"
import { isContainerEntity } from "../../lib/item-types"
import ItemIcon from "./ItemIcon.vue"

export interface InventoryGridItem {
  ref: string
  count?: number
  entity: InventoryEntity | null
  status: "ready" | "missing" | "loading" | "cycle"
  equippedSlots?: string[]
  highlighted?: boolean
}

defineProps<{
  items: InventoryGridItem[]
  emptyText?: string
}>()

const emit = defineEmits<{
  select: [item: InventoryGridItem, trigger: HTMLElement]
  highlight: [ref: string | null]
}>()

function selectItem(event: MouseEvent, item: InventoryGridItem): void {
  emit("select", item, event.currentTarget as HTMLElement)
}

function displayName(item: InventoryGridItem): string {
  if (item.entity?.name) return item.entity.name
  const idx = item.ref.indexOf(":")
  return idx >= 0 ? item.ref.slice(idx + 1) : item.ref
}

function isContainer(item: InventoryGridItem): boolean {
  return item.entity !== null && isContainerEntity(item.entity)
}

function slotBadge(item: InventoryGridItem): string {
  const slots = item.equippedSlots ?? []
  if (slots.length === 0) return ""
  return slots.length === 1 ? slots[0] : `${slots[0]} +${slots.length - 1}`
}
</script>

<template>
  <div v-if="items.length === 0" class="grid-empty">{{ emptyText ?? "空容器" }}</div>
  <div v-else class="inv-grid" role="list">
    <button
      v-for="(item, index) in items"
      :key="`${item.ref}-${index}`"
      type="button"
      class="inv-cell"
      :class="{ highlighted: item.highlighted }"
      role="listitem"
      :data-variant="isContainer(item) ? 'container' : 'item'"
      :data-status="item.status"
      :aria-disabled="item.status === 'loading' || item.status === 'missing' || item.status === 'cycle'"
      :aria-label="`${displayName(item)}${isContainer(item) ? '，容器，进入' : ''}${item.status === 'loading' ? '，读取中' : item.status === 'missing' ? '，档案缺失' : item.status === 'cycle' ? '，循环引用，无法进入' : ''}${slotBadge(item) ? `，已装备于${slotBadge(item)}` : ''}`"
      :title="item.status === 'cycle' ? '检测到循环引用，无法进入' : item.status === 'missing' ? '档案缺失' : displayName(item)"
      @click="selectItem($event, item)"
      @mouseenter="emit('highlight', item.ref)"
      @mouseleave="emit('highlight', null)"
      @focus="emit('highlight', item.ref)"
      @blur="emit('highlight', null)"
    >
      <span class="inv-cell-icon"><ItemIcon :entity="item.entity" :entity-ref="item.ref" /></span>
      <span v-if="typeof item.count === 'number' && item.count > 1" class="inv-cell-count">×{{ item.count }}</span>
      <span v-if="slotBadge(item)" class="inv-cell-equipped">{{ slotBadge(item) }}</span>
      <span class="inv-cell-name">{{ displayName(item) }}</span>
      <span v-if="isContainer(item)" class="inv-cell-enter">进入</span>
      <span v-else-if="item.status === 'missing'" class="inv-cell-enter">缺失</span>
      <span v-else-if="item.status === 'cycle'" class="inv-cell-enter">循环</span>
    </button>
  </div>
</template>

<style scoped>
.inv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
  gap: 10px;
  padding: 4px 0;
}

.inv-cell {
  position: relative;
  aspect-ratio: 1;
  min-width: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  place-items: center;
  gap: 2px;
  padding: 7px 5px 5px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 5px 10px 4px 9px;
  background:
    radial-gradient(circle at 50% 35%, rgba(181, 137, 61, 0.08), transparent 48%),
    rgba(10, 5, 6, 0.58);
  color: inherit;
  font: inherit;
  cursor: pointer;
  outline: none;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
}

.inv-cell:hover:not([aria-disabled="true"]),
.inv-cell:focus-visible:not([aria-disabled="true"]),
.inv-cell.highlighted {
  border-color: rgba(232, 169, 72, 0.64);
  background:
    radial-gradient(circle at 50% 35%, rgba(232, 169, 72, 0.16), transparent 54%),
    rgba(10, 5, 6, 0.74);
  box-shadow: 0 0 18px rgba(181, 137, 61, 0.14);
}

.inv-cell:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 2px;
}

.inv-cell[data-variant="container"] {
  border-color: rgba(181, 137, 61, 0.42);
  background:
    repeating-linear-gradient(135deg, rgba(181, 137, 61, 0.035) 0 4px, transparent 4px 9px),
    rgba(10, 5, 6, 0.7);
}

.inv-cell[data-variant="container"]::after {
  content: "";
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(181, 137, 61, 0.12);
  border-radius: 3px 7px 3px 7px;
  pointer-events: none;
}

.inv-cell[aria-disabled="true"] {
  cursor: default;
  opacity: 0.55;
}

.inv-cell[data-status="cycle"],
.inv-cell[data-status="missing"] {
  border-color: rgba(155, 58, 46, 0.42);
}

.inv-cell-icon {
  width: 64%;
  aspect-ratio: 1;
}

.inv-cell-count,
.inv-cell-equipped {
  position: absolute;
  z-index: 2;
  font-family: var(--font-mono);
  font-size: 0.52rem;
  background: rgba(6, 6, 8, 0.86);
}

.inv-cell-count {
  top: 4px;
  right: 5px;
  color: var(--ember-bright);
}

.inv-cell-equipped {
  top: 4px;
  left: 4px;
  max-width: calc(100% - 24px);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 1px 4px;
  border: 1px solid rgba(232, 169, 72, 0.3);
  border-radius: 6px;
  color: var(--ember-bright);
}

.inv-cell-name {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 0.7rem;
  color: var(--prose-muted);
}

.inv-cell-enter {
  font-family: var(--font-mono);
  font-size: 0.5rem;
  letter-spacing: 0.08em;
  color: var(--prose-faint);
}

.grid-empty {
  display: grid;
  place-items: center;
  min-height: 150px;
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  color: var(--prose-faint);
}

@media (prefers-reduced-motion: reduce) {
  .inv-cell {
    transition: none;
  }
}
</style>
