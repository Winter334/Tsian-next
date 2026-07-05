<script setup lang="ts">
/**
 * GoalsBlock — 意图与目标三行（概况页目标区）。
 *
 * design §4.4 / R16 / §2.4：
 * - 三行 label-text：当前 / 短期 / 长期。
 * - 缺省项不展示该行。
 * - goals 为 undefined 时不展示整块。
 *
 * task 07-05：每行右上角挂 PinButton（kind=goals, key=current|shortTerm|longTerm）。
 */
import { computed } from "vue"
import type { CharacterGoals } from "../../lib/character-types"
import PinButton from "./PinButton.vue"

const props = defineProps<{
  goals?: CharacterGoals
  /** 当前角色 entity ref；用于构造 pin target。null 时不渲染 PinButton。 */
  entityRef: string | null
}>()

/** GoalRow.key 与 CharacterGoals 键名一致，作为 PinTarget.key 稳定标识。 */
type GoalKey = "current" | "shortTerm" | "longTerm"

interface GoalRow {
  key: GoalKey
  label: string
  text: string
}

const rows = computed<GoalRow[]>(() => {
  const g = props.goals
  if (!g) return []
  const out: GoalRow[] = []
  if (g.current) out.push({ key: "current", label: "当前", text: g.current })
  if (g.shortTerm) out.push({ key: "shortTerm", label: "短期", text: g.shortTerm })
  if (g.longTerm) out.push({ key: "longTerm", label: "长期", text: g.longTerm })
  return out
})
</script>

<template>
  <div v-if="rows.length > 0" class="target-list">
    <div v-for="r in rows" :key="r.key" class="target-row">
      <span class="target-label">{{ r.label }}</span>
      <span class="target-text">{{ r.text }}</span>
      <PinButton
        v-if="entityRef"
        :target="{ entityRef, kind: 'goals', key: r.key, label: r.label }"
      />
    </div>
  </div>
</template>

<style scoped>
.target-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.target-row {
  position: relative;
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 10px;
  font-size: 0.86rem;
  line-height: 1.65;
  padding-right: 22px;
}
.target-label {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  color: var(--whisper);
  padding-top: 2px;
}
.target-text {
  color: var(--prose-dim);
}
.target-row:hover :deep(.pin-btn) {
  opacity: 0.85;
}
.target-row :deep(.pin-btn.active) {
  opacity: 1;
}
</style>
