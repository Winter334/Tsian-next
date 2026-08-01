<script setup lang="ts">
import { computed, ref } from "vue"
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui"
import ProcessNode, { type ProcessNodeData } from "./ProcessNode.vue"

/** Outer process fold. Individual tools stay as direct rows in timeline order. */
const props = defineProps<{
  nodes: ProcessNodeData[]
  round: number
}>()

const open = ref(false)
const toolCount = computed(() => props.nodes.filter((node) => node.kind === "tool").length)
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
        <span v-if="toolCount > 0" class="rp-summary" aria-live="polite">
          <span class="rp-count-slot">
            <Transition name="tool-count">
              <span :key="toolCount" class="rp-count-number">{{ toolCount }}</span>
            </Transition>
          </span>
          <span>次工具调用</span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent class="rp-body">
        <div class="rp-inner">
          <ProcessNode v-for="node in nodes" :key="node.id" :node="node" />
        </div>
      </CollapsibleContent>
    </div>
  </CollapsibleRoot>
</template>

<style scoped>
.round-process {
  margin: 14px 0 18px;
}

.rp-head {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: var(--prose-faint);
  cursor: pointer;
  font-family: var(--font-mono);
  text-align: left;
  transition: color 0.2s;
}

.rp-head:hover {
  color: var(--ember);
}

.rp-chev {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--ember);
  transform: rotate(0deg);
  transition: transform 0.25s ease;
}

.round-process:has([data-state="open"]) .rp-chev {
  transform: rotate(90deg);
}

.rp-label {
  flex-shrink: 0;
  color: var(--ember);
  letter-spacing: 0.08em;
}

.rp-summary {
  display: inline-flex;
  align-items: baseline;
  gap: 0.15em;
  color: var(--prose-muted);
  font-family: var(--font-serif);
  font-size: 0.82rem;
  letter-spacing: 0;
  white-space: nowrap;
}

.rp-count-slot {
  display: inline-grid;
  width: 3ch;
  overflow: hidden;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.rp-count-number {
  grid-area: 1 / 1;
  display: block;
}

.tool-count-enter-active,
.tool-count-leave-active {
  transition: opacity 180ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tool-count-enter-from {
  opacity: 0;
  transform: translateY(45%);
}

.tool-count-leave-to {
  opacity: 0;
  transform: translateY(-45%);
}

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

@media (prefers-reduced-motion: reduce) {
  .rp-head,
  .rp-chev,
  .tool-count-enter-active,
  .tool-count-leave-active {
    transition-duration: 0.01ms;
  }

  :deep(.rp-body[data-state="open"]),
  :deep(.rp-body[data-state="closed"]) {
    animation: none;
  }
}
</style>
