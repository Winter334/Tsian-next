<script setup lang="ts">
import { ref, computed } from "vue"
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui"
import ProcessNode, { type ProcessNodeData } from "./ProcessNode.vue"

/**
 * RoundProcess — 本轮推演大折叠。
 *
 * 把一轮（或多轮）推演中的过程节点（interim/thought/tool/tool-group）整体收进
 * 一个无框大折叠，默认折叠，降低过程噪音、让正文流更干净。
 * 与内部 ProcessNode 小折叠（有边框）形成两级层次：大折叠管"推演过程"整体显隐，
 * 小折叠管单个思考/工具的明细。
 *
 * 样式语言：无框，仅一行 ember 标签 + 概要摘要；展开时左侧 ember 细线串联小折叠。
 */
const props = defineProps<{
  nodes: ProcessNodeData[]
  round: number
}>()

// 默认折叠——推演过程是"可展开查看"的副信息，不抢占正文注意力
const open = ref(false)

// 概要摘要：统计轮数 / 思考 / 过渡 / 工具调用数
const summary = computed(() => {
  const rounds = new Set<number>()
  let thoughts = 0
  let interims = 0
  let tools = 0
  for (const n of props.nodes) {
    if (n.round != null) rounds.add(n.round)
    if (n.kind === "thought") thoughts += 1
    else if (n.kind === "interim") interims += 1
    else if (n.kind === "tool") tools += 1
    else if (n.kind === "tool-group" && n.tools) tools += n.tools.length
  }
  const parts: string[] = []
  if (rounds.size > 0) parts.push(`${rounds.size} 轮`)
  if (thoughts > 0) parts.push(`${thoughts} 思考`)
  if (interims > 0) parts.push(`${interims} 过渡`)
  if (tools > 0) parts.push(`${tools} 工具`)
  return parts.join(" · ")
})
</script>

<template>
  <CollapsibleRoot v-model:open="open">
    <div class="round-process" :class="{ open }">
      <CollapsibleTrigger class="rp-head">
        <svg class="rp-chev" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="rp-label">推演过程</span>
        <span v-if="summary" class="rp-summary">{{ summary }}</span>
      </CollapsibleTrigger>
      <CollapsibleContent class="rp-body">
        <div class="rp-inner">
          <ProcessNode v-for="n in nodes" :key="n.id" :node="n" />
        </div>
      </CollapsibleContent>
    </div>
  </CollapsibleRoot>
</template>

<style scoped>
.round-process {
  margin: 14px 0 18px;
}

/* 无框头部：仅一行 ember 标签 + 概要，hover 提亮 */
.rp-head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px 0;
  font-family: var(--font-mono);
  color: var(--prose-faint);
  transition: color 0.2s;
}
.rp-head:hover {
  color: var(--ember);
}
.rp-chev {
  width: 12px;
  height: 12px;
  color: var(--ember);
  flex-shrink: 0;
  transform: rotate(0deg);
  transition: transform 0.25s ease;
}
.round-process:has([data-state="open"]) .rp-chev {
  transform: rotate(90deg);
}
.rp-label {
  color: var(--ember);
  letter-spacing: 0.08em;
  flex-shrink: 0;
}
.rp-summary {
  color: var(--prose-muted);
  font-family: var(--font-serif);
  font-size: 0.82rem;
  letter-spacing: 0;
}

/* 展开体：左侧 ember 细线串联内部小折叠，无外框 */
:deep(.rp-body) {
  overflow: hidden;
}
:deep(.rp-body[data-state="open"]) {
  animation: rp-open 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}
:deep(.rp-body[data-state="closed"]) {
  animation: rp-close 0.24s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes rp-open {
  from { height: 0; opacity: 0; }
  to { height: var(--reka-collapsible-content-height); opacity: 1; }
}
@keyframes rp-close {
  from { height: var(--reka-collapsible-content-height); opacity: 1; }
  to { height: 0; opacity: 0; }
}

.rp-inner {
  padding: 6px 0 10px 18px;
  margin-left: 4px;
  border-left: 1px solid var(--line);
}
</style>
