<script setup lang="ts">
/**
 * GoalsBlock — 意图与目标三行（概况页目标区）。
 *
 * design §4.4 / R16 / §2.4：
 * - 三行 label-text：当前 / 短期 / 长期。
 * - 缺省项不展示该行。
 * - goals 为 undefined 时不展示整块。
 */
import { computed } from "vue"
import type { CharacterGoals } from "../../lib/character-types"

const props = defineProps<{
  goals?: CharacterGoals
}>()

interface GoalRow {
  label: string
  text: string
}

const rows = computed<GoalRow[]>(() => {
  const g = props.goals
  if (!g) return []
  const out: GoalRow[] = []
  if (g.current) out.push({ label: "当前", text: g.current })
  if (g.shortTerm) out.push({ label: "短期", text: g.shortTerm })
  if (g.longTerm) out.push({ label: "长期", text: g.longTerm })
  return out
})
</script>

<template>
  <div v-if="rows.length > 0" class="target-list">
    <div v-for="r in rows" :key="r.label" class="target-row">
      <span class="target-label">{{ r.label }}</span>
      <span class="target-text">{{ r.text }}</span>
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
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 10px;
  font-size: 0.86rem;
  line-height: 1.65;
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
</style>
