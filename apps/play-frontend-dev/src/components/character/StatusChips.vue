<script setup lang="ts">
/**
 * StatusChips — 当前状态 chips（概况页状态区）。
 *
 * design §4.4 / D5 / R8：
 * - 逐项 chip；polarity 决定颜色 tone。
 * - 默认只显示 name；description 通过 title 属性挂载为 tooltip。
 * - 不展示 level / minor / severe 等内部字段值。
 * - polarity 颜色映射（design §6）：
 *   positive → #7ea968；negative → --blood/#c76d5a；neutral → --prose-dim。
 *
 * task 07-05-status-bar-character-field-pinning：
 * - 每个 chip 加 PinButton；`entityRef` 由父组件传入（null 时不渲染 pin）。
 * - 父容器 `.status-chip` 设 `position: relative` 承载 pin。
 */
import type { CharacterStatus } from "../../lib/character-types"
import PinButton from "./PinButton.vue"

const props = defineProps<{
  status: CharacterStatus[]
  /** 当前角色 entity ref；用于构造钉选 target。null 时不渲染 PinButton。 */
  entityRef: string | null
}>()

void props

function statusText(s: CharacterStatus): string {
  return s.name ?? s.description ?? s.id
}

function statusTooltip(s: CharacterStatus): string | undefined {
  if (s.name && s.description && s.name !== s.description) return s.description
  return undefined
}
</script>

<template>
  <div v-if="status.length > 0" class="status-chips">
    <span
      v-for="s in status"
      :key="s.id"
      class="status-chip"
      :class="s.polarity ? `polarity-${s.polarity}` : ''"
      :title="statusTooltip(s)"
    >
      {{ statusText(s) }}
      <PinButton
        v-if="entityRef"
        :target="{
          entityRef,
          kind: 'status',
          key: s.id,
          label: s.name ?? s.id,
        }"
      />
    </span>
  </div>
</template>

<style scoped>
.status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.status-chip {
  position: relative;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: rgba(181, 137, 61, 0.035);
  color: var(--prose);
  font-family: var(--font-serif);
  font-size: 0.82rem;
  padding: 4px 22px 4px 10px;
  cursor: default;
  transition: border-color 0.2s, background 0.2s, color 0.2s;
}
.status-chip:hover {
  color: var(--ember-bright);
  border-color: var(--ember);
  background: rgba(181, 137, 61, 0.08);
}
/* 父 hover 时 PinButton 半显 */
.status-chip:hover :deep(.pin-btn),
.status-chip :deep(.pin-btn.active) {
  opacity: 0.85;
}
.status-chip.polarity-positive {
  border-color: rgba(126, 169, 104, 0.55);
  color: #a8c98f;
}
.status-chip.polarity-positive:hover {
  border-color: #7ea968;
  color: #c0d8a8;
}
.status-chip.polarity-negative {
  border-color: rgba(199, 109, 90, 0.55);
  color: #d08a7c;
}
.status-chip.polarity-negative:hover {
  border-color: var(--blood);
  color: #e0a090;
}
.status-chip.polarity-neutral {
  border-color: rgba(92, 83, 71, 0.75);
  color: var(--prose-muted);
}
.status-chip.polarity-neutral:hover {
  border-color: var(--prose-muted);
  color: var(--prose);
}
</style>
