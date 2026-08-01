<script setup lang="ts">
import { computed, ref } from "vue"
import { CollapsibleRoot, CollapsibleTrigger, CollapsibleContent } from "reka-ui"

export type ToolProcessStatus = "loading" | "running" | "success" | "failed"

/** Player-facing process nodes. Tool protocol details remain outside this shape. */
export type ProcessNodeData =
  | {
      kind: "interim"
      id: string
      round?: number
      text: string
      agentId?: string | null
    }
  | {
      kind: "thought"
      id: string
      round?: number
      text: string
      agentId?: string | null
      collapsed?: boolean
    }
  | {
      kind: "tool"
      id: string
      round?: number
      name: string
      displayName?: string
      status: ToolProcessStatus
      agentId?: string | null
    }

const props = defineProps<{
  node: ProcessNodeData
}>()

const thoughtOpen = ref(
  props.node.kind === "thought" && props.node.collapsed === false,
)

const toolName = computed(() => (
  props.node.kind === "tool"
    ? props.node.displayName ?? props.node.name
    : ""
))

const toolStatus = computed<ToolProcessStatus>(() => (
  props.node.kind === "tool" ? props.node.status : "loading"
))

const toolStatusLabel = computed(() => ({
  loading: "运行中",
  running: "运行中",
  success: "成功",
  failed: "失败",
})[toolStatus.value])
</script>

<template>
  <div v-if="node.kind === 'interim'" class="process-interim">
    {{ node.text }}
  </div>
  <CollapsibleRoot v-else-if="node.kind === 'thought'" v-model:open="thoughtOpen">
    <div class="process-thought">
      <CollapsibleTrigger class="thought-head">
        <span class="thought-label">思考</span>
        <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 6l6 6-6 6"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </CollapsibleTrigger>
      <CollapsibleContent class="collapsible-body">
        <div class="thought-body">{{ node.text }}</div>
      </CollapsibleContent>
    </div>
  </CollapsibleRoot>
  <div
    v-else
    class="process-tool"
    :class="`status-${toolStatus}`"
    role="status"
    aria-live="polite"
    :aria-label="`${toolName}：${toolStatusLabel}`"
  >
    <span class="tool-name">{{ toolName }}</span>
    <Transition name="tool-state" mode="out-in">
      <span :key="toolStatus" class="tool-state" :class="`status-${toolStatus}`">
        <span class="tool-state-icon" aria-hidden="true">
          <svg v-if="toolStatus === 'success'" viewBox="0 0 20 20">
            <path class="success-mark" d="M4.5 10.5l3.2 3.2 7.8-8" />
          </svg>
          <svg v-else-if="toolStatus === 'failed'" viewBox="0 0 20 20">
            <path d="M5.5 5.5l9 9m0-9l-9 9" />
          </svg>
          <span v-else class="running-ring" />
        </span>
        <span class="tool-status-label">{{ toolStatusLabel }}</span>
      </span>
    </Transition>
  </div>
</template>

<style scoped>
.process-interim {
  margin: 9px 0 12px;
  color: var(--prose-muted);
  font-family: var(--font-serif);
  font-size: 0.9rem;
  line-height: 1.7;
  white-space: pre-wrap;
}

.process-thought {
  margin: 8px 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--void-deep);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.4);
}

.thought-head {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: var(--ember);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  text-align: left;
}

.thought-head:hover {
  background: rgba(181, 137, 61, 0.05);
}

.thought-label {
  letter-spacing: 0.06em;
}

.chevron {
  width: 13px;
  height: 13px;
  margin-left: auto;
  flex-shrink: 0;
  color: var(--prose-faint);
  transform: rotate(0deg);
  transition: transform 0.25s ease, color 0.2s ease;
}

.process-thought:has([data-state="open"]) .chevron {
  color: var(--ember);
  transform: rotate(90deg);
}

:deep(.collapsible-body) {
  overflow: hidden;
}

:deep(.collapsible-body[data-state="open"]) {
  animation: collapsible-open 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

:deep(.collapsible-body[data-state="closed"]) {
  animation: collapsible-close 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes collapsible-open {
  from { height: 0; opacity: 0; }
  to { height: var(--reka-collapsible-content-height); opacity: 1; }
}

@keyframes collapsible-close {
  from { height: var(--reka-collapsible-content-height); opacity: 1; }
  to { height: 0; opacity: 0; }
}

.thought-body {
  padding: 9px 12px 12px;
  border-top: 1px solid var(--line);
  color: var(--prose-muted);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.65;
  white-space: pre-wrap;
}

.process-tool {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 30px;
  padding: 5px 2px 5px 10px;
  border-left: 1px solid rgba(181, 137, 61, 0.34);
  font-family: var(--font-mono);
  font-size: 0.76rem;
  animation: tool-row-enter 200ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes tool-row-enter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.tool-name {
  min-width: 0;
  overflow: hidden;
  color: var(--prose-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-state {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  width: 4.8rem;
  flex-shrink: 0;
  color: var(--prose-faint);
  transform-origin: center;
}

.tool-state.status-success {
  color: var(--ember-bright);
  animation: tool-success-settle 320ms ease-out both;
}

.tool-state.status-failed {
  color: var(--blood);
  animation: tool-failed-settle 260ms ease-out both;
}

@keyframes tool-success-settle {
  0% { filter: drop-shadow(0 0 0 transparent); }
  45% { filter: drop-shadow(0 0 5px rgba(232, 169, 72, 0.55)); }
  100% { filter: drop-shadow(0 0 0 transparent); }
}

@keyframes tool-failed-settle {
  0%, 100% { transform: translateX(0); }
  35% { transform: translateX(-2px); }
  65% { transform: translateX(2px); }
}

.tool-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}

.tool-state-icon svg {
  width: 15px;
  height: 15px;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.success-mark {
  stroke-dasharray: 18;
  animation: success-mark-draw 260ms ease-out both;
}

@keyframes success-mark-draw {
  from { stroke-dashoffset: 18; }
  to { stroke-dashoffset: 0; }
}

.running-ring {
  width: 11px;
  height: 11px;
  box-sizing: border-box;
  border: 1.5px solid rgba(181, 137, 61, 0.28);
  border-top-color: var(--ember-bright);
  border-radius: 50%;
  animation: tool-running-spin 1.1s linear infinite;
}

@keyframes tool-running-spin {
  to { transform: rotate(360deg); }
}

.tool-status-label {
  white-space: nowrap;
}

.tool-state-enter-active,
.tool-state-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
}

.tool-state-enter-from {
  opacity: 0;
  transform: translateY(2px);
}

.tool-state-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}

@media (prefers-reduced-motion: reduce) {
  .process-tool,
  .tool-state.status-success,
  .tool-state.status-failed,
  .success-mark,
  .running-ring,
  :deep(.collapsible-body[data-state="open"]),
  :deep(.collapsible-body[data-state="closed"]) {
    animation: none;
  }

  .chevron,
  .tool-state-enter-active,
  .tool-state-leave-active {
    transition-duration: 0.01ms;
  }
}
</style>
