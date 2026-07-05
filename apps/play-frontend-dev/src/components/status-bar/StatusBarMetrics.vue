<script setup lang="ts">
/**
 * StatusBarMetrics — 状态栏"数值"区。
 *
 * design §5.5：
 * - 小标题"数值" + 渐变细线。
 * - progress：label + 数值条（--ember 填充，rgba(181,137,61,0.1) 轨道，4px 高，圆角 2px）+ 右侧数字。
 * - number：label + value + unit。
 * - tone 颜色映射：danger → --blood，warning → --ember-bright，success → --ember，默认 --ember。
 * - 空态："暂无数值"。
 *
 * 按 category=metric 渲染（render-mapping：progress/number → metric）。
 * 字段缺失走 fallback（parse-runtime 已标 fallback=true 并填默认值，type-safety
 * §"Runtime Extension Parsing"）。本组件按 value/max/min 安全计算百分比。
 */
import { computed } from "vue"
import type { DisplayItem } from "../../lib/runtime-types"

const props = defineProps<{
  metrics: DisplayItem[]
}>()

interface MetricRow {
  label: string
  render: "progress" | "number"
  value: number
  max?: number
  min?: number
  unit?: string
  tone?: DisplayItem["tone"]
  percent: number | null // null = 非 progress
}

const rows = computed<MetricRow[]>(() => {
  return props.metrics.map((item) => {
    const render = item.render === "progress" ? "progress" : "number"
    const rawValue = typeof item.value === "number" && Number.isFinite(item.value) ? item.value : 0
    const max = typeof item.max === "number" && Number.isFinite(item.max) ? item.max : 100
    const min = typeof item.min === "number" && Number.isFinite(item.min) ? item.min : 0
    let percent: number | null = null
    if (render === "progress") {
      const span = max - min
      if (span > 0) {
        percent = Math.max(0, Math.min(100, ((rawValue - min) / span) * 100))
      } else {
        percent = 0
      }
    }
    return {
      label: item.label,
      render,
      value: rawValue,
      max,
      min,
      unit: item.unit,
      tone: item.tone,
      percent,
    }
  })
})

const isEmpty = computed(() => rows.value.length === 0)

/** tone → CSS 变量（design §5.5）。 */
function toneColor(tone?: DisplayItem["tone"]): string {
  switch (tone) {
    case "danger":
      return "var(--blood)"
    case "warning":
      return "var(--ember-bright)"
    case "success":
    case "accent":
      return "var(--ember)"
    default:
      return "var(--ember)"
  }
}

function formatNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}
</script>

<template>
  <section class="sb-metrics">
    <header class="sb-section-head">
      <h3 class="sb-section-title">数值</h3>
      <span class="sb-section-line" />
    </header>

    <ul v-if="!isEmpty" class="metric-list">
      <li v-for="(m, idx) in rows" :key="`metric-${idx}`" class="metric-row">
        <div class="metric-head">
          <span class="metric-label">{{ m.label }}</span>
          <span class="metric-value">
            {{ formatNumber(m.value) }}<span v-if="m.unit" class="metric-unit">{{ m.unit }}</span>
          </span>
        </div>
        <div v-if="m.render === 'progress'" class="metric-bar-track">
          <div
            class="metric-bar-fill"
            :style="{ width: `${m.percent ?? 0}%`, background: toneColor(m.tone) }"
          />
        </div>
      </li>
    </ul>

    <p v-else class="sb-empty">暂无数值</p>
  </section>
</template>

<style scoped>
.sb-metrics {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sb-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sb-section-title {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  letter-spacing: 0.14em;
  color: var(--whisper);
  text-transform: uppercase;
  flex-shrink: 0;
}
.sb-section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, var(--line-strong), transparent);
  opacity: 0.6;
}

.metric-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.metric-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.metric-label {
  font-family: var(--font-serif);
  font-size: 0.78rem;
  color: var(--prose-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metric-value {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--ember-bright);
  flex-shrink: 0;
}
.metric-unit {
  margin-left: 2px;
  font-size: 0.7rem;
  color: var(--prose-dim);
}

/* progress 数值条：4px 高，圆角 2px，rgba(181,137,61,0.1) 轨道（design §5.5/§8） */
.metric-bar-track {
  height: 4px;
  border-radius: 2px;
  background: rgba(181, 137, 61, 0.1);
  overflow: hidden;
}
.metric-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
}

.sb-empty {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 0.75rem;
  color: var(--whisper);
  font-style: italic;
}
</style>
