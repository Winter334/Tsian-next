<template>
  <!-- 调试页（B5）：消费 bridge.debug + bridge.query，渲染 6 类调试数据 -->
  <section class="grid gap-6 mt-6">
    <div class="grid gap-2">
      <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">调试</p>
      <h2 class="text-2xl font-bold text-text-main">调试面板</h2>
      <p class="text-base text-text-dim leading-normal">
        平台兜底调试入口（按 Ctrl+Shift+D 唤起）。展示工作流节点、检索调试、AI 调试、维护写入输出，以及历史 / Checkpoints / 快照数据；所有数据均通过 `bridge.debug` 或 `bridge.query` 拉取。
      </p>
      <p v-if="!debugAvailable" class="text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2 text-sm">
        当前未注入 bridge.debug（基础桥模式）。所有面板将显示空状态。
      </p>
    </div>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">workflow</p>
        <CardTitle class="text-xl text-text-main">工作流 Run Trace</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <template v-if="workflowSnapshot">
          <div class="flex flex-wrap items-center gap-3 text-text-dim text-sm font-mono">
            <Badge :class="nodeStatusBadgeClass(workflowSnapshot.run.status)">
              {{ workflowSnapshot.run.status }}
            </Badge>
            <span>turn: {{ workflowSnapshot.run.turn }}</span>
            <span>source: {{ formatSourceKind(workflowSnapshot.run.source.kind) }}</span>
            <span>mode: {{ workflowSnapshot.run.isModWorkflow ? 'mod' : 'save/platform' }}</span>
            <span>节点数：{{ workflowNodeEntries.length }}</span>
            <span>result 数：{{ workflowResultEntries.length }}</span>
          </div>
          <div class="flex flex-wrap gap-3 text-text-dim text-xs font-mono">
            <span>run: {{ workflowSnapshot.run.runId }}</span>
            <span>save: {{ workflowSnapshot.run.saveId }}</span>
            <span v-if="workflowSnapshot.run.source.workflowName">workflow: {{ workflowSnapshot.run.source.workflowName }}</span>
            <span v-if="workflowSnapshot.run.source.workflowPresetId">preset: {{ workflowSnapshot.run.source.workflowPresetId }}</span>
            <span>start: {{ formatTimestamp(workflowSnapshot.run.startedAt) }}</span>
            <span v-if="workflowSnapshot.run.finishedAt">end: {{ formatTimestamp(workflowSnapshot.run.finishedAt) }}</span>
            <span v-if="workflowRunDuration !== null">{{ workflowRunDuration }}ms</span>
          </div>
          <p v-if="workflowSnapshot.run.error" class="text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2 text-sm">
            [{{ workflowSnapshot.run.error.code }}] {{ workflowSnapshot.run.error.message }}
          </p>

          <div v-if="workflowNodeEntries.length > 0" class="grid gap-3 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
            <div
              v-for="entry in workflowNodeEntries"
              :key="entry.id"
              class="bg-elevated border border-neon-deep/30 rounded-lg p-3 grid gap-2"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="grid gap-1">
                  <span class="font-mono text-sm text-text-main">{{ entry.id }}</span>
                  <div class="flex flex-wrap gap-2 text-text-dim text-xs font-mono">
                    <span v-if="entry.state.type">type: {{ entry.state.type }}</span>
                    <span v-if="entry.state.startOrder !== undefined">order: {{ entry.state.startOrder }}</span>
                  </div>
                </div>
                <Badge
                  :class="nodeStatusBadgeClass(entry.state.status)"
                >
                  {{ entry.state.status }}
                </Badge>
              </div>
              <div v-if="entry.state.startedAt || entry.state.finishedAt" class="flex flex-wrap gap-2 text-text-dim text-xs font-mono">
                <span v-if="entry.state.startedAt">start: {{ formatTimestamp(entry.state.startedAt) }}</span>
                <span v-if="entry.state.finishedAt">end: {{ formatTimestamp(entry.state.finishedAt) }}</span>
                <span v-if="entry.duration !== null">{{ entry.duration }}ms</span>
              </div>
              <p v-if="entry.state.error" class="text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2 text-sm">
                [{{ entry.state.error.code }}] {{ entry.state.error.message }}
              </p>
              <div v-if="entry.inputEntries.length > 0" class="grid gap-1">
                <p class="font-mono text-[11px] tracking-wider uppercase text-neon-muted">inputs</p>
                <div class="grid gap-1 text-xs font-mono text-text-dim">
                  <div v-for="item in entry.inputEntries" :key="`${entry.id}-input-${item.name}`" class="flex items-start justify-between gap-3">
                    <span class="text-text-main">{{ item.name }}</span>
                    <span class="text-right break-all">{{ item.summary }}</span>
                  </div>
                </div>
              </div>
              <div v-if="entry.outputEntries.length > 0" class="grid gap-1">
                <p class="font-mono text-[11px] tracking-wider uppercase text-neon-muted">outputs</p>
                <div class="grid gap-1 text-xs font-mono text-text-dim">
                  <div v-for="item in entry.outputEntries" :key="`${entry.id}-output-${item.name}`" class="flex items-start justify-between gap-3">
                    <span class="text-text-main">{{ item.name }}</span>
                    <span class="text-right break-all">{{ item.summary }}</span>
                  </div>
                </div>
              </div>
              <details v-if="entry.state.inputs" class="group">
                <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
                  inputs JSON ▶
                </summary>
                <div class="mt-2 pl-2 border-l border-neon-deep/30">
                  <ScrollArea class="max-h-80 rounded">
                    <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(entry.state.inputs) }}</pre>
                  </ScrollArea>
                </div>
              </details>
              <details v-if="entry.state.outputs" class="group">
                <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
                  outputs JSON ▶
                </summary>
                <div class="mt-2 pl-2 border-l border-neon-deep/30">
                  <ScrollArea class="max-h-80 rounded">
                    <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(entry.state.outputs) }}</pre>
                  </ScrollArea>
                </div>
              </details>
            </div>
          </div>

          <details v-if="workflowResultEntries.length > 0" class="group">
            <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
              results（{{ workflowResultEntries.length }}）▶
            </summary>
            <div class="mt-2 pl-2 border-l border-neon-deep/30">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(workflowSnapshot.results) }}</pre>
              </ScrollArea>
            </div>
          </details>
        </template>
        <p v-else class="text-text-dim text-sm">暂无数据（尚未跑过一轮工作流）。</p>
      </CardContent>
    </Card>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">retrieval</p>
        <CardTitle class="text-xl text-text-main">检索调试</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <template v-if="retrievalDebug">
          <div class="flex flex-wrap gap-3 text-text-dim text-sm font-mono">
            <span>turn: {{ retrievalDebug.turn ?? '-' }}</span>
            <span>semantic: {{ retrievalDebug.semantic.enabled ? 'on' : 'off' }}</span>
            <span>groups: {{ retrievalDebug.groups.length }}</span>
            <span>candidates: {{ retrievalDebug.candidates.length }}</span>
            <span>archives: {{ retrievalDebug.archives.length }}</span>
            <span>catalogEvents: {{ retrievalDebug.catalogEvents.length }}</span>
            <span v-if="retrievalDebug.hintEntities">hintEntities: {{ retrievalDebug.hintEntities.length }}</span>
          </div>
          <p class="text-sm text-text-dim">input: {{ retrievalDebug.input || '(空)' }}</p>
          <p v-if="retrievalDebug.semantic.error" class="text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2 text-sm">
            semantic error: {{ retrievalDebug.semantic.error }}
          </p>
          <details class="group">
            <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
              完整记录 ▶
            </summary>
            <div class="mt-2 pl-2 border-l border-neon-deep/30">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(retrievalDebug) }}</pre>
              </ScrollArea>
            </div>
          </details>
        </template>
        <p v-else class="text-text-dim text-sm">暂无数据（当前激活存档尚未进行过检索）。</p>
      </CardContent>
    </Card>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">AI debug</p>
        <CardTitle class="text-xl text-text-main">AI 调试</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <template v-if="aiDebugRecords.length > 0">
          <div class="flex flex-wrap gap-3 text-text-dim text-sm font-mono">
            <span>共 {{ aiDebugRecords.length }} 条记录</span>
          </div>
          <ol class="grid gap-3 list-none m-0 p-0">
            <li v-for="record in aiDebugRecords" :key="record.id" class="bg-elevated border border-neon-deep/30 rounded-lg p-3 grid gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <Badge class="bg-neon/10 text-neon border border-neon/30 font-mono text-xs">{{ record.kind }}</Badge>
                <span class="font-mono text-sm text-text-main">{{ record.label }}</span>
                <span class="text-text-dim text-sm">{{ record.model }}</span>
              </div>
              <div class="flex flex-wrap gap-3 text-text-dim text-xs font-mono">
                <span>{{ record.createdAt }}</span>
                <span v-if="record.turn !== undefined">turn {{ record.turn }}</span>
                <span v-if="record.usage">
                  usage: in {{ record.usage.input ?? '-' }} / out {{ record.usage.output ?? '-' }} / total {{ record.usage.total ?? '-' }}
                </span>
                <span v-if="record.vectorCount !== undefined">vectors: {{ record.vectorCount }}</span>
                <span v-if="record.dimensions !== undefined">dim: {{ record.dimensions }}</span>
              </div>
              <p v-if="record.error" class="text-danger bg-danger/10 border border-danger/40 rounded px-3 py-2 text-sm">
                error: {{ record.error }}
              </p>
              <details v-if="record.messages" class="group">
                <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
                  messages（{{ record.messages.length }}）▶
                </summary>
                <div class="mt-2 pl-2 border-l border-neon-deep/30">
                  <ScrollArea class="max-h-80 rounded">
                    <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(record.messages) }}</pre>
                  </ScrollArea>
                </div>
              </details>
              <details v-if="record.input" class="group">
                <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
                  input（{{ record.input.length }}）▶
                </summary>
                <div class="mt-2 pl-2 border-l border-neon-deep/30">
                  <ScrollArea class="max-h-80 rounded">
                    <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(record.input) }}</pre>
                  </ScrollArea>
                </div>
              </details>
              <details v-if="record.responseText" class="group">
                <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
                  responseText ▶
                </summary>
                <div class="mt-2 pl-2 border-l border-neon-deep/30">
                  <ScrollArea class="max-h-80 rounded">
                    <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ record.responseText }}</pre>
                  </ScrollArea>
                </div>
              </details>
            </li>
          </ol>
        </template>
        <p v-else class="text-text-dim text-sm">暂无数据（尚未触发过 AI 调用）。</p>
      </CardContent>
    </Card>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">state write</p>
        <CardTitle class="text-xl text-text-main">维护写入（maintenance / state-write）</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <template v-if="maintenanceWriteNodeEntries.length > 0">
          <div class="flex flex-wrap gap-3 text-text-dim text-sm font-mono">
            <span>命中节点：{{ maintenanceWriteNodeEntries.length }}</span>
          </div>
          <div
            v-for="entry in maintenanceWriteNodeEntries"
            :key="entry.id"
            class="bg-elevated border border-neon-deep/30 rounded-lg p-3 grid gap-2"
          >
            <div class="flex items-center justify-between gap-3">
              <span class="font-mono text-sm text-text-main">{{ entry.id }}</span>
              <Badge
                :class="nodeStatusBadgeClass(entry.state.status)"
              >
                {{ entry.state.status }}
              </Badge>
            </div>
            <template v-if="entry.state.outputs">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(entry.state.outputs) }}</pre>
              </ScrollArea>
            </template>
            <p v-else class="text-text-dim text-sm">该节点尚无 outputs。</p>
          </div>
        </template>
        <p v-else class="text-text-dim text-sm">暂无数据（工作流未跑出维护写入输出）。</p>
      </CardContent>
    </Card>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">history / checkpoints / snapshots</p>
        <CardTitle class="text-xl text-text-main">历史 / Checkpoints / 快照</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <div class="flex flex-wrap gap-3 text-text-dim text-sm font-mono">
          <span>history：{{ historyItems.length }} 条</span>
          <span>events：{{ eventItems.length }} 条</span>
          <span>archives：{{ archiveItems.length }} 条</span>
          <span>checkpoints：{{ checkpointItems.length }} 条</span>
        </div>

        <details class="group">
          <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
            runtime snapshot ▶
          </summary>
          <div class="mt-2 pl-2 border-l border-neon-deep/30">
            <template v-if="runtimeSnapshot">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(runtimeSnapshot) }}</pre>
              </ScrollArea>
            </template>
            <p v-else class="text-text-dim text-sm">暂无快照。</p>
          </div>
        </details>

        <details class="group">
          <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
            history（{{ historyItems.length }}）▶
          </summary>
          <div class="mt-2 pl-2 border-l border-neon-deep/30">
            <template v-if="historyItems.length > 0">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(historyItems) }}</pre>
              </ScrollArea>
            </template>
            <p v-else class="text-text-dim text-sm">暂无消息。</p>
          </div>
        </details>

        <details class="group">
          <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
            events（{{ eventItems.length }}）▶
          </summary>
          <div class="mt-2 pl-2 border-l border-neon-deep/30">
            <template v-if="eventItems.length > 0">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(eventItems) }}</pre>
              </ScrollArea>
            </template>
            <p v-else class="text-text-dim text-sm">暂无事件。</p>
          </div>
        </details>

        <details class="group">
          <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
            archives（{{ archiveItems.length }}）▶
          </summary>
          <div class="mt-2 pl-2 border-l border-neon-deep/30">
            <template v-if="archiveItems.length > 0">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(archiveItems) }}</pre>
              </ScrollArea>
            </template>
            <p v-else class="text-text-dim text-sm">暂无档案。</p>
          </div>
        </details>

        <details class="group">
          <summary class="text-neon text-sm cursor-pointer font-mono hover:text-neon/80 select-none">
            checkpoints（{{ checkpointItems.length }}）▶
          </summary>
          <div class="mt-2 pl-2 border-l border-neon-deep/30">
            <template v-if="checkpointItems.length > 0">
              <ScrollArea class="max-h-80 rounded">
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(checkpointItems) }}</pre>
              </ScrollArea>
            </template>
            <p v-else class="text-text-dim text-sm">暂无 checkpoint。</p>
          </div>
        </details>
      </CardContent>
    </Card>
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

import { playFrontendBridge, waitForPlatformHostReady } from "../platform-host"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

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

function previewText(value: string, max = 48): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, max - 3))}...`
}

function summarizeValue(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (typeof value === "string") {
    return `string(${value.length}) "${previewText(value)}"`
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return `${typeof value}(${String(value)})`
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
    if (keys.length === 0) {
      return "object(0)"
    }
    const head = keys.slice(0, 3).join(", ")
    return keys.length > 3 ? `object(${keys.length}) ${head}, ...` : `object(${keys.length}) ${head}`
  }
  return typeof value
}

function summarizePortRecord(record?: Record<string, unknown>) {
  if (!record) return []
  return Object.entries(record).map(([name, value]) => ({
    name,
    summary: summarizeValue(value),
  }))
}

function formatSourceKind(kind: string): string {
  switch (kind) {
    case "save-override":
      return "save-override"
    case "mod-preset":
      return "mod-preset"
    case "legacy-mod-workflow":
      return "legacy-mod-workflow"
    case "platform-default":
      return "platform-default"
    default:
      return kind
  }
}

function nodeStatusBadgeClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'succeeded' || s === 'completed') {
    return 'bg-neon/10 text-neon border border-neon/30 font-mono text-xs'
  }
  if (s === 'failed' || s === 'aborted' || s === 'error') {
    return 'bg-danger/10 text-danger border border-danger/30 font-mono text-xs'
  }
  if (s === 'running' || s === 'pending') {
    return 'bg-warning/10 text-warning border border-warning/30 font-mono text-xs'
  }
  return 'border-neon-deep/60 text-neon-muted font-mono text-xs'
}

const workflowNodeEntries = computed(() => {
  const snapshot = workflowSnapshot.value
  if (!snapshot) return []
  return Object.entries(snapshot.nodes)
    .map(([id, state]) => ({
    id,
    state,
    inputEntries: summarizePortRecord(state.inputs),
    outputEntries: summarizePortRecord(state.outputs),
    duration:
      state.startedAt !== undefined && state.finishedAt !== undefined
        ? state.finishedAt - state.startedAt
        : null,
  }))
    .sort((a, b) => {
      const aOrder = a.state.startOrder ?? Number.MAX_SAFE_INTEGER
      const bOrder = b.state.startOrder ?? Number.MAX_SAFE_INTEGER
      if (aOrder !== bOrder) {
        return aOrder - bOrder
      }
      return a.id.localeCompare(b.id)
    })
})

const workflowResultEntries = computed(() => {
  const snapshot = workflowSnapshot.value
  if (!snapshot) return []
  return Object.entries(snapshot.results)
})

const workflowRunDuration = computed(() => {
  const run = workflowSnapshot.value?.run
  if (!run?.finishedAt) return null
  return run.finishedAt - run.startedAt
})

const maintenanceWriteNodeEntries = computed(() => {
  const entries = workflowNodeEntries.value
  return entries.filter((entry) => {
    const id = entry.id.toLowerCase()
    return (
      id.includes("maintenance") ||
      id.includes("statewrite") ||
      id.includes("state-write")
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
  await waitForPlatformHostReady()
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
