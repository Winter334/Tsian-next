<template>
  <!-- 调试页（B5）：消费 bridge.debug + bridge.query，渲染 6 类调试数据 -->
  <section class="page-section">
    <header class="section-copy">
      <p class="section-eyebrow">调试</p>
      <h2>调试面板</h2>
      <p>平台兜底调试入口（按 Ctrl+Shift+D 唤起）。展示工作流节点、检索调试、AI 调试、patch 输出，以及历史 / Checkpoints / 快照数据；所有数据均通过 `bridge.debug` 或 `bridge.query` 拉取。</p>
      <p v-if="!debugAvailable" class="warn-note">当前未注入 bridge.debug（基础桥模式）。所有面板将显示空状态。</p>
    </header>

    <article class="panel-card">
      <h3>工作流快照</h3>
      <template v-if="workflowSnapshot">
        <div class="meta-row">
          <span>turn: {{ workflowSnapshot.turn }}</span>
          <span>节点数：{{ workflowNodeEntries.length }}</span>
          <span>result 数：{{ workflowResultEntries.length }}</span>
        </div>

        <div v-if="workflowNodeEntries.length > 0" class="node-grid">
          <div
            v-for="entry in workflowNodeEntries"
            :key="entry.id"
            class="node-card"
            :data-status="entry.state.status"
          >
            <div class="node-card__head">
              <span class="node-id">{{ entry.id }}</span>
              <span class="node-status" :data-status="entry.state.status">
                {{ entry.state.status }}
              </span>
            </div>
            <div v-if="entry.state.startedAt || entry.state.finishedAt" class="node-times">
              <span v-if="entry.state.startedAt">start: {{ formatTimestamp(entry.state.startedAt) }}</span>
              <span v-if="entry.state.finishedAt">end: {{ formatTimestamp(entry.state.finishedAt) }}</span>
              <span v-if="entry.duration !== null">{{ entry.duration }}ms</span>
            </div>
            <p v-if="entry.state.error" class="node-error">
              [{{ entry.state.error.code }}] {{ entry.state.error.message }}
            </p>
            <details v-if="entry.state.outputs" class="inline-details">
              <summary>outputs</summary>
              <pre class="debug-pre">{{ formatJson(entry.state.outputs) }}</pre>
            </details>
          </div>
        </div>

        <details v-if="workflowResultEntries.length > 0" class="inline-details">
          <summary>results（{{ workflowResultEntries.length }}）</summary>
          <pre class="debug-pre">{{ formatJson(workflowSnapshot.results) }}</pre>
        </details>
      </template>
      <p v-else class="empty-note">暂无数据（尚未跑过一轮工作流）。</p>
    </article>

    <article class="panel-card">
      <h3>检索调试</h3>
      <template v-if="retrievalDebug">
        <div class="meta-row">
          <span>turn: {{ retrievalDebug.turn ?? "—" }}</span>
          <span>semantic: {{ retrievalDebug.semantic.enabled ? "on" : "off" }}</span>
          <span>groups: {{ retrievalDebug.groups.length }}</span>
          <span>candidates: {{ retrievalDebug.candidates.length }}</span>
          <span>archives: {{ retrievalDebug.archives.length }}</span>
          <span>catalogEvents: {{ retrievalDebug.catalogEvents.length }}</span>
          <span v-if="retrievalDebug.hintEntities">hintEntities: {{ retrievalDebug.hintEntities.length }}</span>
        </div>
        <p class="retrieval-input">input: {{ retrievalDebug.input || "(空)" }}</p>
        <p v-if="retrievalDebug.semantic.error" class="node-error">
          semantic error: {{ retrievalDebug.semantic.error }}
        </p>
        <details class="inline-details">
          <summary>完整记录</summary>
          <pre class="debug-pre">{{ formatJson(retrievalDebug) }}</pre>
        </details>
      </template>
      <p v-else class="empty-note">暂无数据（当前激活存档尚未进行过检索）。</p>
    </article>

    <article class="panel-card">
      <h3>AI 调试</h3>
      <template v-if="aiDebugRecords.length > 0">
        <p class="meta-row"><span>共 {{ aiDebugRecords.length }} 条记录</span></p>
        <ol class="ai-list">
          <li v-for="record in aiDebugRecords" :key="record.id" class="ai-item">
            <div class="ai-item__head">
              <span class="ai-kind" :data-kind="record.kind">{{ record.kind }}</span>
              <span class="ai-label">{{ record.label }}</span>
              <span class="ai-model">{{ record.model }}</span>
            </div>
            <div class="ai-item__meta">
              <span>{{ record.createdAt }}</span>
              <span v-if="record.turn !== undefined">turn {{ record.turn }}</span>
              <span v-if="record.usage">
                usage: in {{ record.usage.input ?? "—" }} / out {{ record.usage.output ?? "—" }} / total {{ record.usage.total ?? "—" }}
              </span>
              <span v-if="record.vectorCount !== undefined">vectors: {{ record.vectorCount }}</span>
              <span v-if="record.dimensions !== undefined">dim: {{ record.dimensions }}</span>
            </div>
            <p v-if="record.error" class="node-error">error: {{ record.error }}</p>
            <details v-if="record.messages" class="inline-details">
              <summary>messages（{{ record.messages.length }}）</summary>
              <pre class="debug-pre">{{ formatJson(record.messages) }}</pre>
            </details>
            <details v-if="record.input" class="inline-details">
              <summary>input（{{ record.input.length }}）</summary>
              <pre class="debug-pre">{{ formatJson(record.input) }}</pre>
            </details>
            <details v-if="record.responseText" class="inline-details">
              <summary>responseText</summary>
              <pre class="debug-pre">{{ record.responseText }}</pre>
            </details>
          </li>
        </ol>
      </template>
      <p v-else class="empty-note">暂无数据（尚未触发过 AI 调用）。</p>
    </article>

    <article class="panel-card">
      <h3>Patch（来自 maintenance / apply-patch 节点输出）</h3>
      <template v-if="patchNodeEntries.length > 0">
        <p class="meta-row"><span>命中节点：{{ patchNodeEntries.length }}</span></p>
        <div
          v-for="entry in patchNodeEntries"
          :key="entry.id"
          class="patch-block"
        >
          <div class="patch-block__head">
            <span class="node-id">{{ entry.id }}</span>
            <span class="node-status" :data-status="entry.state.status">{{ entry.state.status }}</span>
          </div>
          <pre v-if="entry.state.outputs" class="debug-pre">{{ formatJson(entry.state.outputs) }}</pre>
          <p v-else class="empty-note">该节点尚无 outputs。</p>
        </div>
      </template>
      <p v-else class="empty-note">暂无数据（工作流未跑出 patch 输出）。</p>
    </article>

    <article class="panel-card">
      <h3>历史 / Checkpoints / 快照</h3>
      <div class="meta-row">
        <span>history：{{ historyItems.length }} 条</span>
        <span>events：{{ eventItems.length }} 条</span>
        <span>archives：{{ archiveItems.length }} 条</span>
        <span>checkpoints：{{ checkpointItems.length }} 条</span>
      </div>

      <details class="inline-details">
        <summary>runtime snapshot</summary>
        <pre v-if="runtimeSnapshot" class="debug-pre">{{ formatJson(runtimeSnapshot) }}</pre>
        <p v-else class="empty-note">暂无快照。</p>
      </details>

      <details class="inline-details">
        <summary>history（{{ historyItems.length }}）</summary>
        <pre v-if="historyItems.length > 0" class="debug-pre">{{ formatJson(historyItems) }}</pre>
        <p v-else class="empty-note">暂无消息。</p>
      </details>

      <details class="inline-details">
        <summary>events（{{ eventItems.length }}）</summary>
        <pre v-if="eventItems.length > 0" class="debug-pre">{{ formatJson(eventItems) }}</pre>
        <p v-else class="empty-note">暂无事件。</p>
      </details>

      <details class="inline-details">
        <summary>archives（{{ archiveItems.length }}）</summary>
        <pre v-if="archiveItems.length > 0" class="debug-pre">{{ formatJson(archiveItems) }}</pre>
        <p v-else class="empty-note">暂无档案。</p>
      </details>

      <details class="inline-details">
        <summary>checkpoints（{{ checkpointItems.length }}）</summary>
        <pre v-if="checkpointItems.length > 0" class="debug-pre">{{ formatJson(checkpointItems) }}</pre>
        <p v-else class="empty-note">暂无 checkpoint。</p>
      </details>
    </article>
  </section>
</template>

<script setup lang="ts">
import type {
  AiDebugRecord,
  RetrievalDebugRecord,
  RuntimeSnapshotShell,
  WorkflowOutputsSnapshot,
} from "@tsian/contracts"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue"

import { playFrontendBridge } from "../platform-host"

const debugAvailable = ref<boolean>(Boolean(playFrontendBridge.debug))

const workflowSnapshot = shallowRef<WorkflowOutputsSnapshot | null>(null)
const retrievalDebug = shallowRef<RetrievalDebugRecord | null>(null)
const aiDebugRecords = shallowRef<AiDebugRecord[]>([])
const runtimeSnapshot = shallowRef<RuntimeSnapshotShell | null>(null)
const historyItems = shallowRef<unknown[]>([])
const eventItems = shallowRef<unknown[]>([])
const archiveItems = shallowRef<unknown[]>([])
const checkpointItems = shallowRef<unknown[]>([])

let unsubscribeWorkflow: (() => void) | null = null
let unsubscribeTurnReady: (() => void) | null = null

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toISOString().slice(11, 23)
  } catch {
    return String(ms)
  }
}

const workflowNodeEntries = computed(() => {
  const snapshot = workflowSnapshot.value
  if (!snapshot) return []
  return Object.entries(snapshot.nodes).map(([id, state]) => ({
    id,
    state,
    duration:
      state.startedAt !== undefined && state.finishedAt !== undefined
        ? state.finishedAt - state.startedAt
        : null,
  }))
})

const workflowResultEntries = computed(() => {
  const snapshot = workflowSnapshot.value
  if (!snapshot) return []
  return Object.entries(snapshot.results)
})

const patchNodeEntries = computed(() => {
  const entries = workflowNodeEntries.value
  return entries.filter((entry) => {
    const id = entry.id.toLowerCase()
    return (
      id.includes("maintenance") ||
      id.includes("apply-patch") ||
      id.includes("applypatch")
    )
  })
})

async function refreshRetrievalDebug() {
  if (!playFrontendBridge.debug) return
  try {
    retrievalDebug.value = await playFrontendBridge.debug.getRetrievalDebug()
  } catch {
    retrievalDebug.value = null
  }
}

async function refreshAiDebug() {
  if (!playFrontendBridge.debug) return
  try {
    aiDebugRecords.value = await playFrontendBridge.debug.getAiDebugRecords()
  } catch {
    aiDebugRecords.value = []
  }
}

async function refreshRuntimeSnapshot() {
  try {
    runtimeSnapshot.value = await playFrontendBridge.runtime.getRuntimeSnapshot()
  } catch {
    runtimeSnapshot.value = null
  }
}

async function refreshQueryResource(
  resource: string,
  setter: (items: unknown[]) => void,
) {
  if (typeof playFrontendBridge.query?.query !== "function") {
    setter([])
    return
  }
  try {
    const result = await playFrontendBridge.query.query({ resource })
    setter(Array.isArray(result?.items) ? result.items : [])
  } catch {
    setter([])
  }
}

async function refreshAll() {
  await Promise.all([
    refreshRetrievalDebug(),
    refreshAiDebug(),
    refreshRuntimeSnapshot(),
    refreshQueryResource("history", (items) => (historyItems.value = items)),
    refreshQueryResource("events", (items) => (eventItems.value = items)),
    refreshQueryResource("archives", (items) => (archiveItems.value = items)),
    refreshQueryResource("checkpoints", (items) => (checkpointItems.value = items)),
  ])
}

onMounted(async () => {
  await refreshAll()

  if (playFrontendBridge.debug) {
    unsubscribeWorkflow = playFrontendBridge.debug.subscribeWorkflow(
      (snapshot) => {
        workflowSnapshot.value = snapshot
      },
    )
    unsubscribeTurnReady = playFrontendBridge.debug.onTurnDebugReady(() => {
      void refreshAll()
    })
  }
})

onBeforeUnmount(() => {
  unsubscribeWorkflow?.()
  unsubscribeTurnReady?.()
  unsubscribeWorkflow = null
  unsubscribeTurnReady = null
})
</script>

<style scoped>
.page-section {
  display: grid;
  gap: var(--ts-space-6);
  margin-top: var(--ts-space-6);
}

.section-copy {
  display: grid;
  gap: var(--ts-space-2);
}

.section-eyebrow {
  margin: 0 0 var(--ts-space-3);
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-xs);
  letter-spacing: var(--ts-tracking-wide);
  text-transform: uppercase;
}

h2 {
  margin: 0;
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-2xl);
  line-height: var(--ts-leading-tight);
  color: var(--ts-color-text-primary);
}

h3 {
  margin: 0 0 var(--ts-space-3);
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-xl);
  line-height: 1.3;
  color: var(--ts-color-text-primary);
}

.section-copy p,
.panel-card p {
  margin: 0;
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-base);
  line-height: var(--ts-leading-normal);
}

.warn-note {
  color: var(--ts-color-state-error-fg);
  background: var(--ts-color-state-error-bg);
  padding: var(--ts-space-2) var(--ts-space-3);
  border-radius: var(--ts-radius-md);
}

.panel-card {
  display: grid;
  gap: var(--ts-space-3);
  padding: var(--ts-space-4);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-xl);
  background: var(--ts-color-surface-raised);
  box-shadow: var(--ts-shadow-2);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ts-space-3);
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-sm);
  line-height: 1.5;
}

.empty-note {
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-sm);
  line-height: 1.5;
}

.retrieval-input {
  color: var(--ts-color-text-secondary);
  font-size: var(--ts-text-sm);
  line-height: 1.5;
}

.node-grid {
  display: grid;
  gap: var(--ts-space-3);
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
}

.node-card {
  display: grid;
  gap: var(--ts-space-2);
  padding: var(--ts-space-3);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-lg);
  background: var(--ts-color-surface-overlay);
  box-shadow: var(--ts-shadow-1);
}

.node-card__head,
.patch-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ts-space-2);
}

.node-id {
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-base);
  color: var(--ts-color-text-primary);
  font-weight: var(--ts-weight-medium);
}

.node-status {
  font-size: var(--ts-text-xs);
  letter-spacing: var(--ts-tracking-wide);
  text-transform: uppercase;
  padding: var(--ts-space-1) var(--ts-space-2);
  border-radius: var(--ts-radius-sm);
  color: var(--ts-color-text-muted);
  background: var(--ts-color-surface-base);
}

.node-status[data-status="succeeded"] {
  color: var(--ts-color-state-success-fg);
  background: var(--ts-color-state-success-bg);
}

.node-status[data-status="failed"],
.node-status[data-status="aborted"] {
  color: var(--ts-color-state-error-fg);
  background: var(--ts-color-state-error-bg);
}

.node-status[data-status="running"] {
  color: var(--ts-color-accent-default);
  background: var(--ts-color-accent-subtle);
}

.node-times {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ts-space-2);
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-xs);
  line-height: 1.5;
}

.node-error {
  margin: 0;
  color: var(--ts-color-state-error-fg);
  background: var(--ts-color-state-error-bg);
  padding: var(--ts-space-2) var(--ts-space-3);
  border-radius: var(--ts-radius-md);
  font-size: var(--ts-text-sm);
  line-height: 1.5;
}

.inline-details {
  display: grid;
  gap: var(--ts-space-2);
  border-top: 1px solid var(--ts-color-border-default);
  padding-top: var(--ts-space-2);
}

.inline-details > summary {
  cursor: pointer;
  color: var(--ts-color-accent-default);
  font-size: var(--ts-text-sm);
  line-height: 1.5;
}

.debug-pre {
  margin: 0;
  padding: var(--ts-space-3);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-md);
  background: var(--ts-color-surface-base);
  color: var(--ts-color-text-primary);
  font-family: var(--ts-font-sans);
  font-size: var(--ts-text-xs);
  line-height: 1.5;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--ts-space-3);
}

.ai-item {
  display: grid;
  gap: var(--ts-space-2);
  padding: var(--ts-space-3);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-lg);
  background: var(--ts-color-surface-overlay);
}

.ai-item__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ts-space-2);
}

.ai-kind {
  font-size: var(--ts-text-xs);
  letter-spacing: var(--ts-tracking-wide);
  text-transform: uppercase;
  padding: var(--ts-space-1) var(--ts-space-2);
  border-radius: var(--ts-radius-sm);
  color: var(--ts-color-accent-fg);
  background: var(--ts-color-accent-default);
}

.ai-kind[data-kind="embedding"] {
  background: var(--ts-color-text-muted);
}

.ai-label {
  font-family: var(--ts-font-serif);
  font-size: var(--ts-text-base);
  color: var(--ts-color-text-primary);
  font-weight: var(--ts-weight-medium);
}

.ai-model {
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-sm);
  line-height: 1.5;
}

.ai-item__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ts-space-3);
  color: var(--ts-color-text-muted);
  font-size: var(--ts-text-xs);
  line-height: 1.5;
}

.patch-block {
  display: grid;
  gap: var(--ts-space-2);
  padding: var(--ts-space-3);
  border: 1px solid var(--ts-color-border-default);
  border-radius: var(--ts-radius-lg);
  background: var(--ts-color-surface-overlay);
}
</style>
