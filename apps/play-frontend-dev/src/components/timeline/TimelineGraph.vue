<script setup lang="ts">
import type { HistoricalNode } from "../../lib/history-timeline"
defineProps<{ nodes: HistoricalNode[] }>()
</script>
<template>
  <ol class="history-line" aria-label="本局已发生的重要剧情">
    <li v-for="node in nodes" :key="node.turn" class="history-node">
      <div class="history-time">{{ node.turn === 0 ? '开局' : `第 ${node.turn} 回合` }}<span v-if="node.time"> · {{ node.time }}</span></div>
      <p>{{ node.summary }}</p>
    </li>
  </ol>
</template>
<style scoped>
.history-line { list-style: none; margin: 28px 0 0 8px; padding: 0 0 0 28px; border-left: 1px solid rgba(181,137,61,.4); }
.history-node { position: relative; padding: 0 0 24px; }
.history-node::before { content: ''; position: absolute; width: 8px; height: 8px; border-radius: 50%; background: #b5893d; left: -33px; top: 7px; }
.history-time { font-size: .8rem; color: #ab9470; }
p { margin: 8px 0 0; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink, #ddd4c2); }
</style>
