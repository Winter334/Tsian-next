<script setup lang="ts">
import { computed } from "vue"
import { formatDuration, formatTokens } from "../../composables/useTurnState"

/**
 * TurnMeta — 轮次计时 meta 行。
 *
 * prd 屏3：`· 12.4s · 1.2k tokens · 第 N 轮` mono --whisper。
 */
const props = defineProps<{
  elapsedMs: number
  tokens?: number
  turn: number
}>()

const text = computed(() => {
  const parts = [formatDuration(props.elapsedMs)]
  if (props.tokens !== undefined) parts.push(`${formatTokens(props.tokens)} tokens`)
  return `· ${parts.join(" · ")}`
})
</script>

<template>
  <p class="turn-meta">{{ text }}</p>
</template>

<style scoped>
.turn-meta {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  color: var(--prose-faint);
  letter-spacing: 0.08em;
  margin: 16px 0 24px;
  text-align: right;
}
</style>
