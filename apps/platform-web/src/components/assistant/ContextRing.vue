<template>
  <div class="relative inline-flex items-center justify-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" viewBox="0 0 24 24" aria-hidden="true">
      <!-- Track (空心底环) -->
      <circle
        cx="12" cy="12" r="9"
        fill="none"
        :stroke="trackColor"
        :stroke-width="strokeWidth"
      />
      <!-- Value (实心已用环,从顶部顺时针填充) -->
      <circle
        v-if="hasTotal"
        cx="12" cy="12" r="9"
        fill="none"
        :stroke="valueColor"
        :stroke-width="strokeWidth"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        transform="rotate(-90 12 12)"
        stroke-linecap="butt"
      />
    </svg>
    <!-- 中心百分比 -->
    <span
      class="absolute inset-0 flex items-center justify-center font-mono leading-none text-text-dim"
      :style="{ fontSize: `${Math.max(7, size * 0.28)}px` }"
      :class="hasTotal ? percentageClass : ''"
    >
      {{ hasTotal ? `${Math.round(fraction * 100)}` : "—" }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(defineProps<{
  /** 已用 tokens(provider 返回的 input).0 表示无数据. */
  used: number
  /** 上下文窗口总量(contextWindow).0/未配表示无总量. */
  total: number
  /** 环尺寸(px).默认 28. */
  size?: number
}>(), {
  size: 28,
})

const strokeWidth = 2.5
const radius = 9
const circumference = 2 * Math.PI * radius

const hasTotal = computed(() => props.total > 0)
const fraction = computed(() => {
  if (!hasTotal.value) return 0
  return Math.min(1, Math.max(0, props.used / props.total))
})
const dashOffset = computed(() => circumference * (1 - fraction.value))

// 阈值配色:<70% neon(健康)、70-90% warning(警告)、>90% danger(危险).
const valueColor = computed(() => {
  if (!hasTotal.value) return "rgba(139,128,102,0.3)"
  const pct = fraction.value
  if (pct > 0.9) return "var(--color-danger)"
  if (pct > 0.7) return "var(--color-warning)"
  return "var(--color-neon)"
})
const trackColor = "rgba(159,119,64,0.3)"

const percentageClass = computed(() => {
  const pct = fraction.value
  if (pct > 0.9) return "text-danger"
  if (pct > 0.7) return "text-warning"
  return "text-neon"
})
</script>
