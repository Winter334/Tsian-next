<template>
  <section class="grid gap-6 mt-6">
    <div class="grid gap-2">
      <p class="font-mono text-xs tracking-wider uppercase text-neon glow-text">调试</p>
      <h2 class="text-2xl font-bold text-text-main">Agent Runtime 调试面板</h2>
      <p class="text-base text-text-dim leading-normal">
        展示当前会话的 AI 调用、历史、Checkpoint 与运行时快照。
      </p>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          class="border-neon text-neon bg-neon/5 hover:bg-neon/15 font-mono"
          @click="refreshAll"
        >
          刷新
        </Button>
      </div>
    </div>

    <Card class="bg-panel border-neon-deep/40">
      <CardHeader class="pb-3">
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">AI debug</p>
        <CardTitle class="text-xl text-text-main">模型调用</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <template v-if="aiDebugRecords.length > 0">
          <div class="flex flex-wrap gap-3 text-text-dim text-sm font-mono">
            <span>共 {{ aiDebugRecords.length }} 条记录</span>
          </div>
          <ol class="grid gap-3 list-none m-0 p-0">
            <li
              v-for="record in aiDebugRecords"
              :key="record.id"
              class="bg-elevated border border-neon-deep/30 rounded-lg p-3 grid gap-2"
            >
              <div class="flex flex-wrap items-center gap-2">
                <Badge class="bg-neon/10 text-neon border border-neon/30 font-mono text-xs">{{ record.kind }}</Badge>
                <span class="font-mono text-sm text-text-main">{{ record.label }}</span>
                <span class="text-text-dim text-sm">{{ record.model }}</span>
              </div>
              <div class="flex flex-wrap gap-3 text-text-dim text-xs font-mono">
                <span>{{ record.createdAt }}</span>
                <span v-if="record.usage">
                  usage: in {{ record.usage.input ?? '-' }} / out {{ record.usage.output ?? '-' }} / total {{ record.usage.total ?? '-' }}
                </span>
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
        <p class="font-mono text-xs tracking-wider uppercase text-neon-muted mb-1">session</p>
        <CardTitle class="text-xl text-text-main">历史 / Checkpoints / 状态</CardTitle>
      </CardHeader>
      <CardContent class="grid gap-3 pt-0">
        <div class="flex flex-wrap gap-3 text-text-dim text-sm font-mono">
          <span>history：{{ historyItems.length }} 条</span>
          <span>checkpoints：{{ checkpointItems.length }} 条</span>
        </div>

        <details class="group" open>
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
            checkpoints（{{ checkpointItems.length }}）▶
          </summary>
          <div class="mt-2 pl-2 border-l border-neon-deep/30 grid gap-2">
            <template v-if="checkpointItems.length > 0">
              <div
                v-for="item in checkpointItems"
                :key="checkpointId(item)"
                class="grid gap-2 border border-neon-deep/30 bg-elevated/40 p-3"
              >
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-mono text-sm text-text-main">{{ checkpointLabel(item) }}</span>
                  <Button
                    variant="outline"
                    class="border-neon-deep text-neon bg-neon/5 hover:bg-neon/15 font-mono"
                    @click="restoreCheckpoint(checkpointId(item))"
                  >
                    恢复
                  </Button>
                </div>
                <pre class="bg-void border border-neon-deep/30 rounded p-3 font-mono text-xs text-text-main whitespace-pre-wrap break-words">{{ formatJson(item) }}</pre>
              </div>
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
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue"

import { playFrontendBridge, waitForPlatformHostReady } from "../platform-host"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

const aiDebugRecords = shallowRef<AiDebugRecord[]>([])
const runtimeSnapshot = shallowRef<RuntimeSnapshotShell | null>(null)
const historyItems = shallowRef<unknown[]>([])
const checkpointItems = shallowRef<unknown[]>([])

let unsubscribeTurnReady: (() => void) | null = null

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function checkpointId(value: unknown): string {
  if (typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id
  }
  return ""
}

function checkpointLabel(value: unknown): string {
  if (typeof value === "object" && value !== null && typeof (value as { label?: unknown }).label === "string") {
    return (value as { label: string }).label
  }
  return checkpointId(value) || "checkpoint"
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
    refreshAiDebug(),
    refreshRuntimeSnapshot(),
    refreshQueryResource("history", (items) => (historyItems.value = items)),
    refreshQueryResource("checkpoints", (items) => (checkpointItems.value = items)),
  ])
}

async function restoreCheckpoint(checkpointIdValue: string) {
  if (!checkpointIdValue) return
  const result = await playFrontendBridge.platform.runAction({
    action: "restore-checkpoint",
    params: { checkpointId: checkpointIdValue },
  })
  if (!result.ok) {
    window.alert(result.error?.message ?? "恢复 checkpoint 失败。")
    return
  }
  await refreshAll()
}

onMounted(async () => {
  await waitForPlatformHostReady()
  await refreshAll()

  if (playFrontendBridge.debug) {
    unsubscribeTurnReady = playFrontendBridge.debug.onTurnDebugReady(() => {
      void refreshAll()
    })
  }
})

onBeforeUnmount(() => {
  unsubscribeTurnReady?.()
  unsubscribeTurnReady = null
})
</script>
