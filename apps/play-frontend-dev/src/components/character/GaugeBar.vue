<script setup lang="ts">
/**
 * GaugeBar — 特殊量表单条（属性页）。
 *
 * design §4.5 / D9：
 * - 单行：name + progress bar（width = value/max）+ value。
 * - tone 决定 bar 颜色（design §6 gauge tone 映射）：
 *   accent → --ember；danger → --blood；warning → --ember-bright；
 *   success → 成功色；muted → --prose-dim；neutral → --ember。
 * - max 缺省 100，min 缺省 0。
 */
import { computed } from "vue"
import type { CharacterGauge } from "../../lib/character-types"

const props = defineProps<{
  gauge: CharacterGauge
}>()

const max = computed(() => props.gauge.max ?? 100)
const min = computed(() => props.gauge.min ?? 0)

const fillPercent = computed(() => {
  const span = max.value - min.value
  if (span <= 0) return 0
  const pct = ((props.gauge.value - min.value) / span) * 100
  return Math.max(0, Math.min(100, pct))
})

const toneClass = computed(() => {
  const t = props.gauge.tone
  if (!t || t === "neutral") return "tone-neutral"
  return `tone-${t}`
})

const valueText = computed(() => {
  const unit = props.gauge.unit ?? ""
  return `${props.gauge.value}${unit}`
})
</script>

<template>
  <div class="gauge-row">
    <span class="gauge-label">{{ gauge.name }}</span>
    <div class="gauge-track">
      <div
        class="gauge-fill"
        :class="toneClass"
        :style="{ width: `${fillPercent}%` }"
      />
    </div>
    <span class="gauge-value">{{ valueText }}</span>
  </div>
</template>

<style scoped>
.gauge-row {
  display: grid;
  grid-template-columns: 88px 1fr 56px;
  align-items: center;
  gap: 12px;
  font-size: 0.82rem;
}
.gauge-label {
  color: var(--prose-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gauge-track {
  height: 5px;
  background: rgba(181, 137, 61, 0.1);
  border-radius: 999px;
  overflow: hidden;
}
.gauge-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s;
}
/* tone 映射（design §6） */
.gauge-fill.tone-neutral,
.gauge-fill.tone-accent {
  background: var(--ember);
}
.gauge-fill.tone-danger {
  background: var(--blood);
}
.gauge-fill.tone-warning {
  background: var(--ember-bright);
}
.gauge-fill.tone-success {
  background: #7ea968;
}
.gauge-fill.tone-muted {
  background: var(--prose-dim);
}
.gauge-value {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--prose);
  text-align: right;
  white-space: nowrap;
}
</style>
