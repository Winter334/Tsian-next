<script setup lang="ts">
/** EquipmentSlot — 动态装备轨道的只读紧凑槽位。 */
import { computed } from "vue"
import type { CharacterEquipmentSlot } from "../../lib/character-types"
import type { ItemEntity } from "../../lib/item-types"
import ItemIcon from "../inventory/ItemIcon.vue"

const props = defineProps<{
  name: string
  slotIndex: number
  slot: CharacterEquipmentSlot
  item: ItemEntity | null
  loading?: boolean
  highlighted?: boolean
  interactive: boolean
}>()

const emit = defineEmits<{
  select: [ref: string]
  activate: [trigger: HTMLElement]
  highlight: [ref: string | null]
}>()

const shortLabel = computed(() => {
  const chars = Array.from(props.name.trim())
  return chars.length <= 4 ? chars.join("") : `${chars.slice(0, 3).join("")}…`
})

const appliedSummary = computed(() => {
  const slot = props.slot
  if (slot.ref === null) return "无已记录贡献"
  const entries = Object.entries(slot.applied ?? {})
  if (entries.length === 0) return "无已记录贡献"
  return entries.map(([name, value]) => `${name}${value >= 0 ? "+" : ""}${value}`).join("、")
})

const tooltip = computed(() => {
  const itemName = props.item?.name ?? (props.slot.ref ? "物品不可读" : "空槽")
  const action = props.interactive ? "点击管理装备" : "装备记录不可用"
  return `${props.name}第${props.slotIndex + 1}槽 · ${itemName} · ${appliedSummary.value} · ${action}`
})

function onClick(event: MouseEvent): void {
  if (props.interactive) {
    emit("activate", event.currentTarget as HTMLElement)
    return
  }
  if (props.slot.ref) emit("select", props.slot.ref)
}
</script>

<template>
  <button
    type="button"
    class="equipment-slot"
    :class="{ empty: !slot.ref, highlighted, missing: slot.ref && !item && !loading, unavailable: !interactive }"
    :aria-disabled="!interactive"
    :aria-label="tooltip"
    :title="tooltip"
    @click="onClick"
    @mouseenter="emit('highlight', slot.ref)"
    @mouseleave="emit('highlight', null)"
    @focus="emit('highlight', slot.ref)"
    @blur="emit('highlight', null)"
  >
    <span class="equipment-icon" aria-hidden="true">
      <ItemIcon :entity="item" :entity-ref="slot.ref ?? name" />
    </span>
    <span class="equipment-label">{{ shortLabel }}</span>
    <span class="equipment-state">
      {{ loading ? "读取" : (item?.name ?? (slot.ref ? "缺失" : interactive ? "选择装备" : "空")) }}
    </span>
  </button>
</template>

<style scoped>
.equipment-slot {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  padding: 9px 7px 7px;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto auto;
  place-items: center;
  gap: 3px;
  overflow: hidden;
  border: 1px solid rgba(181, 137, 61, 0.17);
  border-radius: 4px 10px 2px 9px;
  background:
    radial-gradient(circle at 50% 34%, rgba(232, 169, 72, 0.1), transparent 46%),
    linear-gradient(145deg, rgba(181, 137, 61, 0.07), rgba(6, 6, 8, 0.3));
  color: var(--prose-muted);
  cursor: pointer;
  outline: none;
  transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;
}

.equipment-slot::before,
.equipment-slot::after {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  border-color: rgba(232, 169, 72, 0.34);
  pointer-events: none;
}

.equipment-slot::before {
  top: 4px;
  left: 4px;
  border-top: 1px solid;
  border-left: 1px solid;
}

.equipment-slot::after {
  right: 4px;
  bottom: 4px;
  border-right: 1px solid;
  border-bottom: 1px solid;
}

.equipment-slot:hover:not(.empty),
.equipment-slot:focus-visible,
.equipment-slot.highlighted {
  border-color: rgba(232, 169, 72, 0.6);
  background:
    radial-gradient(circle at 50% 34%, rgba(232, 169, 72, 0.18), transparent 52%),
    linear-gradient(145deg, rgba(181, 137, 61, 0.11), rgba(6, 6, 8, 0.3));
  transform: translateY(-1px);
}

.equipment-slot:focus-visible {
  outline: 2px solid var(--ember-bright);
  outline-offset: 2px;
}

.equipment-slot.empty {
  border-style: dashed;
  opacity: 0.72;
}

.equipment-slot.unavailable {
  opacity: 0.54;
  cursor: help;
  transform: none;
}

.equipment-slot.empty:focus-visible {
  opacity: 0.9;
}

.equipment-slot.missing {
  border-color: rgba(155, 58, 46, 0.45);
}

.equipment-icon {
  width: 58%;
  aspect-ratio: 1;
}

.equipment-label {
  max-width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-display);
  font-size: 0.72rem;
  letter-spacing: 0.05em;
  color: var(--ember-bright);
}

.equipment-state {
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
  font-size: 0.54rem;
  letter-spacing: 0.05em;
  color: var(--prose-faint);
}

@media (prefers-reduced-motion: reduce) {
  .equipment-slot {
    transition: none;
  }
}
</style>
