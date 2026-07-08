<script setup lang="ts">
/**
 * StatusBarMetrics — 状态栏"数值"区。
 *
 * 优先展示主角 entity.gauges；runtime extension metrics 作为补充数值。
 * 数值条采用细长流光样式，贴近命册侧卷而非现代仪表盘。
 */
import { computed } from "vue"
import type { CharacterGauge } from "../../lib/character-types"
import type { DisplayItem } from "../../lib/runtime-types"

const props = defineProps<{
  gauges: CharacterGauge[]
  metrics: DisplayItem[]
}>()

type Tone = CharacterGauge["tone"] | DisplayItem["tone"]

interface MetricRow {
  key: string
  label: string
  valueText: string
  tone?: Tone
  percent: number | null
  source: "gauge" | "metric"
}

const rows = computed<MetricRow[]>(() => {
  const gaugeRows = props.gauges.map((g) => ({
    key: `gauge:${g.id}`,
    label: g.name,
    valueText: formatGaugeValue(g),
    tone: g.tone,
    percent: gaugePercent(g),
    source: "gauge" as const,
  }))

  const metricRows = props.metrics.map((item, idx) => {
    const rawValue = typeof item.value === "number" && Number.isFinite(item.value) ? item.value : 0
    const max = typeof item.max === "number" && Number.isFinite(item.max) ? item.max : 100
    const min = typeof item.min === "number" && Number.isFinite(item.min) ? item.min : 0
    const isProgress = item.render === "progress"
    return {
      key: `metric:${item.label}:${idx}`,
      label: item.label,
      valueText: `${formatNumber(rawValue)}${item.unit ?? ""}`,
      tone: item.tone,
      percent: isProgress ? progressPercent(rawValue, min, max) : null,
      source: "metric" as const,
    }
  })

  return [...gaugeRows, ...metricRows]
})

const isEmpty = computed(() => rows.value.length === 0)

function gaugePercent(gauge: CharacterGauge): number | null {
  const max = typeof gauge.max === "number" && Number.isFinite(gauge.max) ? gauge.max : undefined
  if (max === undefined) return null
  const min = typeof gauge.min === "number" && Number.isFinite(gauge.min) ? gauge.min : 0
  return progressPercent(gauge.value, min, max)
}

function progressPercent(value: number, min: number, max: number): number {
  const span = max - min
  if (span <= 0) return 0
  const p = ((value - min) / span) * 100
  if (p < 0) return 0
  if (p > 100) return 100
  return p
}

function formatGaugeValue(gauge: CharacterGauge): string {
  const value = formatNumber(gauge.value)
  const max = typeof gauge.max === "number" && Number.isFinite(gauge.max)
    ? ` / ${formatNumber(gauge.max)}`
    : ""
  return `${value}${max}${gauge.unit ?? ""}`
}

function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function toneClass(tone?: Tone): string {
  if (!tone) return "tone-accent"
  return `tone-${tone}`
}
</script>

<template>
  <section class="sb-metrics">
    <header class="section-title-row">
      <h3 class="section-title">数值</h3>
      <span class="section-line" />
    </header>

    <ul v-if="!isEmpty" class="metric-list">
      <li
        v-for="row in rows"
        :key="row.key"
        class="metric-row"
        :class="[toneClass(row.tone), `source-${row.source}`]"
      >
        <div class="metric-head">
          <span class="metric-label">{{ row.label }}</span>
          <span class="metric-value">{{ row.valueText }}</span>
        </div>
        <div v-if="row.percent !== null" class="metric-bar-track">
          <div class="metric-bar-fill" :style="{ width: `${row.percent}%` }">
            <span class="metric-bar-shine" aria-hidden="true"></span>
          </div>
        </div>
      </li>
    </ul>

    <p v-else class="sb-empty">暂无记录</p>
  </section>
</template>

<style scoped>
.sb-metrics {
  padding: 14px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-bottom: 1px solid rgba(181, 137, 61, 0.14);
}
.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-title {
  margin: 0;
  flex-shrink: 0;
  font-family: var(--font-display);
  font-size: 0.86rem;
  color: var(--ember-bright);
  letter-spacing: 0.08em;
  text-shadow: 0 0 10px rgba(232, 169, 72, 0.12);
}
.section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(232, 169, 72, 0.42), transparent);
  opacity: 0.58;
}
.metric-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.metric-row {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.metric-row.source-metric {
  opacity: 0.92;
}
.metric-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.metric-label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--font-serif);
  font-size: 0.8rem;
  color: var(--prose-muted);
}
.metric-value {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose);
  letter-spacing: 0.02em;
}
.metric-bar-track {
  height: 7px;
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(0, 0, 0, 0.10)),
    rgba(181, 137, 61, 0.12);
  overflow: hidden;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.16),
    inset 0 1px 2px rgba(0, 0, 0, 0.28);
}
.metric-bar-fill {
  position: relative;
  height: 100%;
  min-width: 4px;
  overflow: hidden;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(181, 137, 61, 0.85), var(--ember-bright));
  box-shadow: 0 0 10px rgba(181, 137, 61, 0.24);
  transition: width 0.4s ease;
}
.metric-bar-shine {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.26), transparent),
    repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.10) 0 1px, transparent 1px 5px);
  opacity: 0.58;
  transform: translateX(-38%);
  animation: bar-shimmer 2.8s ease-in-out infinite;
}
.metric-row.tone-danger .metric-bar-fill {
  background: linear-gradient(90deg, rgba(112, 28, 24, 0.92), #c76d5a);
  box-shadow: 0 0 10px rgba(199, 109, 90, 0.25);
}
.metric-row.tone-warning .metric-bar-fill {
  background: linear-gradient(90deg, rgba(181, 137, 61, 0.92), var(--ember-bright));
  box-shadow: 0 0 10px rgba(232, 169, 72, 0.28);
}
.metric-row.tone-success .metric-bar-fill {
  background: linear-gradient(90deg, rgba(76, 112, 82, 0.92), #9ec28a);
  box-shadow: 0 0 10px rgba(126, 169, 104, 0.24);
}
.metric-row.tone-muted .metric-bar-fill {
  background: linear-gradient(90deg, rgba(111, 103, 93, 0.86), var(--prose-dim));
  box-shadow: 0 0 8px rgba(166, 154, 137, 0.16);
}
.metric-row.tone-neutral .metric-bar-fill,
.metric-row.tone-accent .metric-bar-fill {
  background: linear-gradient(90deg, rgba(181, 137, 61, 0.85), var(--ember-bright));
}
.sb-empty {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  color: var(--prose-faint);
  font-style: italic;
}
@keyframes bar-shimmer {
  0% { transform: translateX(-48%); opacity: 0.36; }
  55% { transform: translateX(28%); opacity: 0.62; }
  100% { transform: translateX(58%); opacity: 0.30; }
}
@media (prefers-reduced-motion: reduce) {
  .metric-bar-shine {
    animation: none;
    transform: none;
  }
}
</style>
