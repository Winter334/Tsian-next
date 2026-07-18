<script setup lang="ts">
/**
 * ItemIcon — 类型剪影图标 + 首字 fallback。
 *
 * design §6.3 / task 07-04 D3：
 * - entity.type ∈ 6 类 → 内联 SVG 剪影图标（--ember 色）。
 * - entity=null 或 type 未识别 → 首字占位（font-display，--ember-bright）。
 * - MVP 六个：equipment/material/consumable/special/other/container。
 * - 图标源自 currentColor，父组件通过 color 控制。
 *
 * props 由父组件传入 entity（可 null）+ ref（用于 fallback 取 localId 首字）。
 */
import { computed } from "vue"
import type { InventoryEntity } from "../../lib/item-types"

const props = defineProps<{
  entity: InventoryEntity | null
  entityRef: string
}>()

type IconKey =
  | "container"
  | "equipment"
  | "material"
  | "consumable"
  | "special"
  | "other"

const KNOWN: ReadonlySet<IconKey> = new Set([
  "container",
  "equipment",
  "material",
  "consumable",
  "special",
  "other",
])

const iconKey = computed<IconKey | null>(() => {
  const e = props.entity
  if (!e) return null
  const t = e.type as string
  return KNOWN.has(t as IconKey) ? (t as IconKey) : null
})

const fallbackGlyph = computed(() => {
  const e = props.entity
  if (e && e.name.length > 0) return e.name.charAt(0)
  const r = props.entityRef
  if (!r) return "?"
  const idx = r.indexOf(":")
  const localId = idx >= 0 ? r.slice(idx + 1) : r
  return localId.charAt(0) || "?"
})
</script>

<template>
  <div class="item-icon">
    <!-- 装备：一把剪影短剑 -->
    <svg
      v-if="iconKey === 'equipment'"
      viewBox="0 0 24 24"
      class="icon-svg"
      aria-hidden="true"
    >
      <path
        d="M13.5 3.5 20.5 10.5 15 12l-1.5 1.5-2-2L13 10 6 17l-1.5-0.5L4 15l7-7 1.5-0.5 0-1.5z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path
        d="M4 20 8 16"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
      />
    </svg>

    <!-- 材料：矿石/晶簇剪影 -->
    <svg
      v-else-if="iconKey === 'material'"
      viewBox="0 0 24 24"
      class="icon-svg"
      aria-hidden="true"
    >
      <path
        d="M12 3 5 9l3 11h8l3-11z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path
        d="M5 9h14M12 3v17"
        stroke="currentColor"
        stroke-width="1"
        stroke-linejoin="round"
      />
    </svg>

    <!-- 消耗品：药瓶剪影 -->
    <svg
      v-else-if="iconKey === 'consumable'"
      viewBox="0 0 24 24"
      class="icon-svg"
      aria-hidden="true"
    >
      <path
        d="M10 3h4v3l2 3v9a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path
        d="M8 13h8"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
      />
    </svg>

    <!-- 特殊：星辰/符 -->
    <svg
      v-else-if="iconKey === 'special'"
      viewBox="0 0 24 24"
      class="icon-svg"
      aria-hidden="true"
    >
      <path
        d="M12 3 14 10 21 12 14 14 12 21 10 14 3 12 10 10z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
    </svg>

    <!-- 其它：书卷/文书 -->
    <svg
      v-else-if="iconKey === 'other'"
      viewBox="0 0 24 24"
      class="icon-svg"
      aria-hidden="true"
    >
      <path
        d="M5 4h11l3 3v13a1 1 0 0 1-1 1H5z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path
        d="M16 4v3h3M8 10h8M8 14h8M8 18h5"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
      />
    </svg>

    <!-- 容器：储物袋 -->
    <svg
      v-else-if="iconKey === 'container'"
      viewBox="0 0 24 24"
      class="icon-svg"
      aria-hidden="true"
    >
      <path
        d="M7 9c0-2 2-3 5-3s5 1 5 3l1 10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path
        d="M9 9V6a3 3 0 0 1 6 0v3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.1"
        stroke-linejoin="round"
      />
      <path
        d="M9 14h6"
        stroke="currentColor"
        stroke-width="1"
        stroke-linecap="round"
      />
    </svg>

    <!-- fallback：首字 -->
    <span v-else class="icon-glyph">{{ fallbackGlyph }}</span>
  </div>
</template>

<style scoped>
.item-icon {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ember);
}
.icon-svg {
  width: 60%;
  height: 60%;
  color: inherit;
  filter: drop-shadow(0 0 4px rgba(181, 137, 61, 0.18));
}
.icon-glyph {
  font-family: var(--font-display);
  font-size: 1.5rem;
  color: var(--ember-bright);
  font-weight: 700;
  text-shadow: 0 0 12px rgba(232, 169, 72, 0.16);
  line-height: 1;
}
</style>
