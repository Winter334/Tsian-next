<template>
  <section class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
    <header class="retro-toolbar flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
      <div class="min-w-0">
        <p class="font-mono text-[11px] uppercase tracking-wider text-neon">System Monitor</p>
        <h1 class="truncate text-base font-bold text-text-main">系统监视器</h1>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="inline-flex h-8 items-center gap-2 border px-3 font-mono text-xs"
          :class="overallStatus.badgeClass"
        >
          <span class="h-2 w-2" :class="overallStatus.dotClass" aria-hidden="true" />
          {{ overallStatus.label }}
        </span>
        <button
          type="button"
          class="retro-button retro-focus inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
          :disabled="loading"
          @click="refreshAll"
        >
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': loading }" aria-hidden="true" />
          刷新
        </button>
      </div>
    </header>

    <main class="min-h-0 overflow-hidden p-3">
      <div v-if="loading && !lastRefreshAt" class="retro-inset grid h-full min-h-[420px] place-items-center p-4">
        <p class="font-mono text-xs uppercase tracking-[0.22em] text-neon">正在读取运行时状态</p>
      </div>

      <div v-else-if="errorMessage" class="retro-inset grid h-full min-h-[420px] place-items-center p-4">
        <div class="max-w-lg border border-danger/40 bg-danger/10 p-4">
          <p class="font-mono text-xs uppercase tracking-wider text-danger">系统监视器不可用</p>
          <p class="mt-2 text-sm leading-6 text-text-dim">{{ errorMessage }}</p>
          <button
            type="button"
            class="retro-button retro-focus mt-4 inline-flex h-8 items-center gap-2 px-3 font-mono text-xs"
            @click="refreshAll"
          >
            <RefreshCw class="h-3.5 w-3.5" aria-hidden="true" />
            重试
          </button>
        </div>
      </div>

      <div v-else class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
        <section class="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          <div
            v-for="tile in identityTiles"
            :key="tile.label"
            class="retro-inset min-w-0 px-3 py-2"
          >
            <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">{{ tile.label }}</p>
            <p class="mt-1 truncate font-mono text-sm font-bold text-text-main">{{ tile.value }}</p>
            <p v-if="tile.caption" class="mt-1 truncate text-[11px] text-text-dim">{{ tile.caption }}</p>
          </div>
        </section>

        <section class="grid min-h-0 gap-3 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
          <nav class="retro-inset min-h-0 overflow-auto p-2" aria-label="系统监视器栏目">
            <button
              v-for="section in monitorSections"
              :key="section.id"
              type="button"
              class="retro-focus grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border px-3 py-2 text-left"
              :class="activeSection === section.id ? 'border-neon bg-neon/10 text-neon' : 'border-neon-deep/35 bg-panel/55 text-text-dim hover:bg-panel hover:text-text-main'"
              @click="activeSection = section.id"
            >
              <component :is="section.icon" class="h-4 w-4" aria-hidden="true" />
              <span class="min-w-0">
                <span class="block truncate font-mono text-xs">{{ section.label }}</span>
                <span class="block truncate text-[11px]">{{ section.caption }}</span>
              </span>
            </button>
          </nav>

          <div class="retro-inset min-h-0 overflow-auto p-3">
            <section v-if="activeSection === 'overview'" class="grid gap-3">
              <div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                <div
                  v-for="metric in overviewMetrics"
                  :key="metric.label"
                  class="border border-neon-deep/35 bg-elevated/40 p-3"
                >
                  <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">{{ metric.label }}</p>
                  <p class="mt-2 font-mono text-2xl font-bold" :class="metric.valueClass">{{ metric.value }}</p>
                  <p class="mt-1 text-xs leading-5 text-text-dim">{{ metric.caption }}</p>
                </div>
              </div>

              <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.72fr)]">
                <article class="border border-neon-deep/35 bg-panel/60 p-3">
                  <div class="flex flex-wrap items-center justify-between gap-2 border-b border-neon-deep/25 pb-2">
                    <p class="font-mono text-xs uppercase tracking-wider text-neon">最近诊断</p>
                    <span class="font-mono text-[11px] text-text-dim">{{ diagnosticItems.length }} 条摘要</span>
                  </div>
                  <div v-if="latestDiagnostic" class="mt-3 grid gap-3">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="border px-2 py-1 font-mono text-[11px]" :class="severityClass(latestDiagnostic.severity)">
                        {{ severityLabel(latestDiagnostic.severity) }}
                      </span>
                      <span class="font-mono text-sm text-text-main">Turn {{ latestDiagnostic.turn }}</span>
                      <span class="font-mono text-xs text-text-dim">{{ statusLabel(latestDiagnostic.status) }}</span>
                    </div>
                    <p class="text-sm leading-6 text-text-dim">
                      {{ diagnosticSummaryLine(latestDiagnostic) }}
                    </p>
                    <div class="grid gap-2 sm:grid-cols-3">
                      <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-1 font-mono text-[11px] text-text-dim">
                        事件 {{ latestDiagnostic.eventCount }}
                      </span>
                      <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-1 font-mono text-[11px] text-text-dim">
                        malformed {{ latestDiagnostic.malformedLineCount }}
                      </span>
                      <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-1 font-mono text-[11px] text-text-dim">
                        omitted {{ latestDiagnostic.omittedFactCount }}
                      </span>
                    </div>
                  </div>
                  <p v-else class="mt-3 text-sm text-text-dim">暂无运行时诊断摘要。</p>
                </article>

                <article class="border border-neon-deep/35 bg-panel/60 p-3">
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">最近问题</p>
                  <div v-if="recentIssues.length > 0" class="mt-3 grid gap-2">
                    <div
                      v-for="issue in recentIssues"
                      :key="issue.key"
                      class="border px-3 py-2"
                      :class="issue.tone === 'error' ? 'border-danger/45 bg-danger/10' : 'border-warning/45 bg-warning/10'"
                    >
                      <p class="font-mono text-xs" :class="issue.tone === 'error' ? 'text-danger' : 'text-warning'">{{ issue.title }}</p>
                      <p class="mt-1 line-clamp-2 text-xs leading-5 text-text-dim">{{ issue.detail }}</p>
                    </div>
                  </div>
                  <p v-else class="mt-3 text-sm text-text-dim">没有发现错误或警告。</p>
                </article>
              </div>
            </section>

            <section v-else-if="activeSection === 'diagnostics'" class="grid gap-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">运行时诊断</p>
                  <p class="mt-1 text-xs text-text-dim">来自 runtime-diagnostics 的有界事实摘要。</p>
                </div>
                <span class="font-mono text-xs text-text-dim">{{ diagnosticItems.length }} 条</span>
              </div>

              <div v-if="diagnosticItems.length > 0" class="grid gap-3">
                <article
                  v-for="item in diagnosticItems"
                  :key="`${item.turn}-${item.traceKind}-${item.status}`"
                  class="border border-neon-deep/35 bg-panel/60 p-3"
                >
                  <div class="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start">
                    <div class="grid h-14 w-16 place-items-center border border-neon-deep/40 bg-elevated/45 font-mono">
                      <span class="text-[10px] uppercase text-text-dim">turn</span>
                      <span class="text-lg font-bold text-neon">{{ item.turn }}</span>
                    </div>
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="border px-2 py-1 font-mono text-[11px]" :class="severityClass(item.severity)">
                          {{ severityLabel(item.severity) }}
                        </span>
                        <span class="font-mono text-xs text-text-dim">{{ statusLabel(item.status) }} · {{ traceKindLabel(item.traceKind) }}</span>
                      </div>
                      <p class="mt-2 text-sm leading-6 text-text-dim">{{ diagnosticSummaryLine(item) }}</p>
                    </div>
                    <div class="grid grid-cols-3 gap-1 font-mono text-[11px] text-text-dim lg:w-48">
                      <span class="border border-neon-deep/25 bg-elevated/35 px-2 py-1">E {{ item.eventCount }}</span>
                      <span class="border border-neon-deep/25 bg-elevated/35 px-2 py-1">M {{ item.malformedLineCount }}</span>
                      <span class="border border-neon-deep/25 bg-elevated/35 px-2 py-1">O {{ item.omittedFactCount }}</span>
                    </div>
                  </div>

                  <div v-if="item.health" class="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <span class="border border-neon-deep/25 bg-elevated/30 px-2 py-1 font-mono text-[11px] text-text-dim">模型调用 {{ item.health.modelCallCount }}</span>
                    <span class="border border-neon-deep/25 bg-elevated/30 px-2 py-1 font-mono text-[11px] text-text-dim">工具调用 {{ item.health.workspaceToolCallCount }}</span>
                    <span class="border border-neon-deep/25 bg-elevated/30 px-2 py-1 font-mono text-[11px] text-text-dim">工作区变更 {{ item.health.workspaceMutationCount }}</span>
                    <span class="border border-neon-deep/25 bg-elevated/30 px-2 py-1 font-mono text-[11px] text-text-dim">Agent {{ item.health.agentIds.length }}</span>
                  </div>

                  <div v-if="item.facts.length > 0" class="mt-3 grid gap-2">
                    <div
                      v-for="(fact, index) in item.facts.slice(0, 8)"
                      :key="`${item.turn}-fact-${index}`"
                      class="grid gap-2 border border-neon-deep/25 bg-elevated/30 p-2 lg:grid-cols-[140px_minmax(0,1fr)]"
                    >
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="border px-2 py-0.5 font-mono text-[10px]" :class="severityClass(fact.severity)">
                          {{ sourceLabel(fact.source) }}
                        </span>
                        <span v-if="fact.eventType" class="font-mono text-[11px] text-text-dim">{{ fact.eventType }}</span>
                      </div>
                      <div class="min-w-0">
                        <p class="text-xs leading-5 text-text-main">{{ factLine(fact) }}</p>
                        <p v-if="fact.relatedPaths.length > 0" class="mt-1 truncate font-mono text-[11px] text-neon-muted">
                          {{ fact.relatedPaths.join(" · ") }}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>
              </div>
              <p v-else class="border border-neon-deep/35 bg-panel/60 p-4 text-sm text-text-dim">暂无诊断摘要。运行一次游戏回合后这里会出现 runtime-diagnostics。</p>
            </section>

            <section v-else-if="activeSection === 'history'" class="grid gap-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">对话历史</p>
                  <p class="mt-1 text-xs text-text-dim">展示最近的玩家/助手消息，用于快速确认当前存档进度。</p>
                </div>
                <span class="font-mono text-xs text-text-dim">{{ historyItems.length }} 条</span>
              </div>

              <div v-if="recentHistory.length > 0" class="grid gap-2">
                <article
                  v-for="(message, index) in recentHistory"
                  :key="`history-${index}-${message.role}`"
                  class="grid gap-2 border border-neon-deep/35 bg-panel/60 p-3 md:grid-cols-[110px_minmax(0,1fr)]"
                >
                  <span class="font-mono text-xs uppercase" :class="message.role === 'assistant' ? 'text-neon' : 'text-text-main'">{{ roleLabel(message.role) }}</span>
                  <p class="line-clamp-3 text-sm leading-6 text-text-dim">{{ message.content || "空消息" }}</p>
                </article>
              </div>
              <p v-else class="border border-neon-deep/35 bg-panel/60 p-4 text-sm text-text-dim">暂无对话历史。</p>

              <details class="border border-neon-deep/35 bg-void/45 p-3">
                <summary class="cursor-pointer font-mono text-xs text-neon">原始历史 JSON</summary>
                <pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words border border-neon-deep/30 bg-void p-3 font-mono text-xs text-text-main">{{ formatJson(historyItems) }}</pre>
              </details>
            </section>

            <section v-else-if="activeSection === 'checkpoints'" class="grid gap-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">检查点</p>
                  <p class="mt-1 text-xs text-text-dim">按时间线查看可恢复的运行状态。</p>
                </div>
                <span class="font-mono text-xs text-text-dim">{{ checkpointItems.length }} 条</span>
              </div>

              <div v-if="checkpointItems.length > 0" class="grid gap-2">
                <article
                  v-for="item in checkpointItems"
                  :key="checkpointId(item)"
                  class="grid gap-3 border border-neon-deep/35 bg-panel/60 p-3 lg:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-sm font-bold text-text-main">{{ checkpointLabel(item) }}</span>
                      <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-0.5 font-mono text-[11px] text-text-dim">
                        Turn {{ checkpointTurn(item) }}
                      </span>
                      <span class="border border-neon-deep/30 bg-elevated/35 px-2 py-0.5 font-mono text-[11px] text-text-dim">
                        {{ checkpointReasonLabel(item) }}
                      </span>
                    </div>
                    <p class="mt-2 font-mono text-[11px] text-text-dim">{{ checkpointTime(item) }}</p>
                    <p class="mt-1 text-xs text-text-dim">
                      {{ checkpointMessageCount(item) }} 条消息 · {{ checkpointWorkspaceFileCount(item) }} 个运行时文件
                    </p>
                  </div>
                  <button
                    type="button"
                    class="retro-button retro-focus inline-flex h-8 items-center justify-center gap-2 px-3 font-mono text-xs"
                    @click="restoreCheckpoint(checkpointId(item))"
                  >
                    <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
                    恢复
                  </button>
                </article>
              </div>
              <p v-else class="border border-neon-deep/35 bg-panel/60 p-4 text-sm text-text-dim">暂无检查点。</p>
            </section>

            <section v-else-if="activeSection === 'ai-debug'" class="grid gap-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">AI 调试</p>
                  <p class="mt-1 text-xs text-text-dim">平台本地可见的模型调用记录，不暴露给游戏前端。</p>
                </div>
                <span class="font-mono text-xs text-text-dim">{{ aiDebugRecords.length }} 条</span>
              </div>

              <div v-if="aiDebugRecords.length > 0" class="grid gap-3">
                <article
                  v-for="record in aiDebugRecords"
                  :key="record.id"
                  class="border border-neon-deep/35 bg-panel/60 p-3"
                >
                  <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="border border-neon/35 bg-neon/10 px-2 py-1 font-mono text-[11px] text-neon">{{ record.label }}</span>
                        <span class="font-mono text-xs text-text-dim">{{ record.model }}</span>
                        <span v-if="record.error" class="border border-danger/45 bg-danger/10 px-2 py-1 font-mono text-[11px] text-danger">错误</span>
                      </div>
                      <p class="mt-2 font-mono text-[11px] text-text-dim">{{ record.createdAt }}</p>
                      <p v-if="record.error" class="mt-2 text-sm leading-6 text-danger">{{ record.error }}</p>
                    </div>
                    <div class="grid grid-cols-3 gap-1 font-mono text-[11px] text-text-dim lg:w-48">
                      <span class="border border-neon-deep/25 bg-elevated/35 px-2 py-1">IN {{ record.usage?.input ?? "-" }}</span>
                      <span class="border border-neon-deep/25 bg-elevated/35 px-2 py-1">OUT {{ record.usage?.output ?? "-" }}</span>
                      <span class="border border-neon-deep/25 bg-elevated/35 px-2 py-1">ALL {{ record.usage?.total ?? "-" }}</span>
                    </div>
                  </div>
                  <details class="mt-3 border border-neon-deep/25 bg-void/45 p-3">
                    <summary class="cursor-pointer font-mono text-xs text-neon">请求 / 响应详情</summary>
                    <div class="mt-3 grid gap-3 xl:grid-cols-2">
                      <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words border border-neon-deep/30 bg-void p-3 font-mono text-xs text-text-main">{{ formatJson(record.messages ?? record.input ?? []) }}</pre>
                      <pre class="max-h-72 overflow-auto whitespace-pre-wrap break-words border border-neon-deep/30 bg-void p-3 font-mono text-xs text-text-main">{{ record.responseText || "暂无响应文本。" }}</pre>
                    </div>
                  </details>
                </article>
              </div>
              <p v-else class="border border-neon-deep/35 bg-panel/60 p-4 text-sm text-text-dim">暂无 AI 调试记录。</p>
            </section>

            <section v-else-if="activeSection === 'snapshot'" class="grid gap-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p class="font-mono text-xs uppercase tracking-wider text-neon">运行时快照</p>
                  <p class="mt-1 text-xs text-text-dim">当前内存中的 RuntimeSnapshotShell。</p>
                </div>
                <span class="font-mono text-xs text-text-dim">turn {{ runtimeTurnLabel }}</span>
              </div>

              <div class="grid gap-3 md:grid-cols-3">
                <div class="border border-neon-deep/35 bg-panel/60 p-3">
                  <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">版本</p>
                  <p class="mt-2 font-mono text-lg font-bold text-text-main">{{ runtimeSnapshot?.version ?? "--" }}</p>
                </div>
                <div class="border border-neon-deep/35 bg-panel/60 p-3">
                  <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">回合</p>
                  <p class="mt-2 font-mono text-lg font-bold text-neon">{{ runtimeTurnLabel }}</p>
                </div>
                <div class="border border-neon-deep/35 bg-panel/60 p-3">
                  <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">消息</p>
                  <p class="mt-2 font-mono text-lg font-bold text-text-main">{{ snapshotMessageCount }}</p>
                </div>
              </div>

              <details class="border border-neon-deep/35 bg-void/45 p-3" open>
                <summary class="cursor-pointer font-mono text-xs text-neon">原始快照 JSON</summary>
                <pre class="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words border border-neon-deep/30 bg-void p-3 font-mono text-xs text-text-main">{{ formatJson(runtimeSnapshot) }}</pre>
              </details>
            </section>
          </div>

          <aside class="retro-inset hidden min-h-0 overflow-auto p-3 xl:block">
            <p class="font-mono text-xs uppercase tracking-wider text-neon">摘要面板</p>
            <div class="mt-3 grid gap-3">
              <div class="border border-neon-deep/35 bg-panel/55 p-3">
                <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">运行结论</p>
                <p class="mt-2 text-sm leading-6 text-text-main">{{ overallStatus.detail }}</p>
              </div>
              <div class="border border-neon-deep/35 bg-panel/55 p-3">
                <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">诊断计数</p>
                <div class="mt-2 grid gap-1 font-mono text-[11px] text-text-dim">
                  <span>error: {{ diagnosticStats.error }}</span>
                  <span>warning: {{ diagnosticStats.warning }}</span>
                  <span>info: {{ diagnosticStats.info }}</span>
                </div>
              </div>
              <div class="border border-neon-deep/35 bg-panel/55 p-3">
                <p class="font-mono text-[10px] uppercase tracking-wider text-text-dim">当前上下文</p>
                <div class="mt-2 grid gap-1 font-mono text-[11px] text-text-dim">
                  <span class="truncate">save: {{ platformContext?.activeSaveId ?? "未选择" }}</span>
                  <span class="truncate">frontend: {{ platformContext?.activeFrontendId ?? "未配置" }}</span>
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>

    <footer class="retro-statusbar flex min-h-9 flex-wrap items-center gap-2 border-t px-3 py-2">
      <span class="font-mono text-[11px] text-text-dim">{{ lastRefreshAt ? `上次刷新：${lastRefreshAt}` : "尚未刷新" }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import type {
  AiDebugRecord,
  ConversationMessageRecord,
  PlatformContextShell,
  RuntimeDiagnosticFact,
  RuntimeDiagnosticSeverity,
  RuntimeDiagnosticSource,
  RuntimeDiagnosticStatus,
  RuntimeDiagnosticSummary,
  RuntimeDiagnosticTraceKind,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import {
  Activity,
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  Database,
  FileClock,
  Gauge,
  History,
  RefreshCw,
  RotateCcw,
} from "lucide-vue-next"
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue"

import { playFrontendBridge, waitForPlatformHostReady } from "../platform-host"

type MonitorSectionId = "overview" | "diagnostics" | "history" | "checkpoints" | "ai-debug" | "snapshot"

interface MonitorSection {
  id: MonitorSectionId
  label: string
  caption: string
  icon: typeof Activity
}

interface IssueSummary {
  key: string
  tone: "warning" | "error"
  title: string
  detail: string
}

const monitorSections: MonitorSection[] = [
  { id: "overview", label: "概览", caption: "运行结论", icon: Gauge },
  { id: "diagnostics", label: "诊断", caption: "事件事实", icon: Activity },
  { id: "history", label: "历史", caption: "对话记录", icon: History },
  { id: "checkpoints", label: "检查点", caption: "恢复点", icon: FileClock },
  { id: "ai-debug", label: "AI 调试", caption: "模型调用", icon: Bot },
  { id: "snapshot", label: "快照", caption: "状态 JSON", icon: Braces },
]

const activeSection = ref<MonitorSectionId>("overview")
const loading = ref(false)
const errorMessage = ref("")
const lastRefreshAt = ref("")
const platformContext = shallowRef<PlatformContextShell | null>(null)
const aiDebugRecords = shallowRef<AiDebugRecord[]>([])
const runtimeSnapshot = shallowRef<RuntimeSnapshotShell | null>(null)
const historyItems = shallowRef<ConversationMessageRecord[]>([])
const checkpointItems = shallowRef<unknown[]>([])
const diagnosticItems = shallowRef<RuntimeDiagnosticSummary[]>([])

let unsubscribeTurnReady: (() => void) | null = null

const runtimeTurn = computed(() => runtimeSnapshot.value?.state.turn ?? null)
const runtimeTurnLabel = computed(() => runtimeTurn.value === null ? "--" : String(runtimeTurn.value))
const snapshotMessageCount = computed(() => runtimeSnapshot.value?.state.messages.length ?? 0)

const diagnosticStats = computed(() => {
  return diagnosticItems.value.reduce(
    (stats, item) => {
      stats[item.severity] += 1
      return stats
    },
    { info: 0, warning: 0, error: 0 },
  )
})

const latestDiagnostic = computed(() => diagnosticItems.value[0] ?? null)

const aggregateHealth = computed(() => {
  const agentIds = new Set<string>()
  const skillNames = new Set<string>()
  let modelCallCount = aiDebugRecords.value.length
  let workspaceMutationCount = 0
  let actionCallCount = 0
  let warningCount = diagnosticStats.value.warning
  let errorCount = diagnosticStats.value.error

  for (const item of diagnosticItems.value) {
    if (!item.health) continue
    modelCallCount = Math.max(modelCallCount, item.health.modelCallCount)
    workspaceMutationCount += item.health.workspaceMutationCount
    actionCallCount += item.health.actionCallCount
    warningCount += item.health.warningCount
    errorCount += item.health.errorCount
    item.health.agentIds.forEach((id) => agentIds.add(id))
    item.health.skillNames.forEach((name) => skillNames.add(name))
  }

  return {
    agentCount: agentIds.size,
    skillCount: skillNames.size,
    modelCallCount,
    workspaceMutationCount,
    actionCallCount,
    warningCount,
    errorCount,
  }
})

const overallStatus = computed(() => {
  const hasAiError = aiDebugRecords.value.some((record) => Boolean(record.error))
  const hasDiagnosticError = diagnosticItems.value.some((item) => item.severity === "error" || item.status === "failed")
  const hasWarning = diagnosticItems.value.some((item) => item.severity === "warning" || item.status === "anomalous")

  if (hasAiError || hasDiagnosticError) {
    return {
      label: "需要关注",
      detail: "最近的运行记录包含错误。优先查看诊断或 AI 调试分区。",
      badgeClass: "border-danger/50 bg-danger/10 text-danger",
      dotClass: "bg-danger",
    }
  }

  if (!platformContext.value?.activeSaveId) {
    return {
      label: "未选择存档",
      detail: "当前没有活动存档，运行时查询会返回空结果。",
      badgeClass: "border-warning/50 bg-warning/10 text-warning",
      dotClass: "bg-warning",
    }
  }

  if (hasWarning) {
    return {
      label: "有警告",
      detail: "运行时没有致命错误，但诊断摘要中存在警告项。",
      badgeClass: "border-warning/50 bg-warning/10 text-warning",
      dotClass: "bg-warning",
    }
  }

  return {
    label: "运行正常",
    detail: "当前监视器没有发现错误或警告。",
    badgeClass: "border-neon/45 bg-neon/10 text-neon",
    dotClass: "bg-neon",
  }
})

const identityTiles = computed(() => [
  {
    label: "活动存档",
    value: platformContext.value?.activeSaveId ?? "未选择",
    caption: platformContext.value?.activeSaveId ? "save context" : "runtime queries empty",
  },
  {
    label: "前端绑定",
    value: platformContext.value?.activeFrontendId ?? "未配置",
    caption: platformContext.value?.activeFrontendId ? "play frontend" : "frontend missing",
  },
  { label: "回合", value: runtimeTurnLabel.value, caption: "runtime snapshot" },
  { label: "消息", value: String(historyItems.value.length || snapshotMessageCount.value), caption: "history records" },
  { label: "检查点", value: String(checkpointItems.value.length), caption: "restore points" },
  { label: "模型调用", value: String(aiDebugRecords.value.length), caption: "platform debug" },
])

const overviewMetrics = computed(() => [
  {
    label: "错误",
    value: String(aggregateHealth.value.errorCount),
    caption: "诊断错误与健康计数",
    valueClass: aggregateHealth.value.errorCount > 0 ? "text-danger" : "text-neon",
  },
  {
    label: "警告",
    value: String(aggregateHealth.value.warningCount),
    caption: "异常与警告事实",
    valueClass: aggregateHealth.value.warningCount > 0 ? "text-warning" : "text-text-main",
  },
  {
    label: "模型调用",
    value: String(aggregateHealth.value.modelCallCount),
    caption: "最近运行中捕获的调用",
    valueClass: "text-text-main",
  },
  {
    label: "工作区变更",
    value: String(aggregateHealth.value.workspaceMutationCount),
    caption: "由运行时写入/删除的文件",
    valueClass: "text-text-main",
  },
])

const recentHistory = computed(() => historyItems.value.slice(-8).reverse())

const recentIssues = computed<IssueSummary[]>(() => {
  const issues: IssueSummary[] = []

  for (const diagnostic of diagnosticItems.value) {
    for (const fact of diagnostic.facts) {
      if (fact.severity === "info") continue
      issues.push({
        key: `diagnostic-${diagnostic.turn}-${issues.length}`,
        tone: fact.severity === "error" ? "error" : "warning",
        title: `Turn ${diagnostic.turn} · ${sourceLabel(fact.source)}`,
        detail: factLine(fact),
      })
      if (issues.length >= 5) return issues
    }
  }

  for (const record of aiDebugRecords.value) {
    if (!record.error) continue
    issues.push({
      key: `ai-${record.id}`,
      tone: "error",
      title: `AI · ${record.label}`,
      detail: record.error,
    })
    if (issues.length >= 5) return issues
  }

  return issues
})

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function normalizeHistory(items: unknown[]): ConversationMessageRecord[] {
  return items
    .filter(isRecord)
    .map((item) => ({
      role: readString(item.role) || "message",
      content: readString(item.content),
    }))
}

function isRuntimeDiagnosticSummary(value: unknown): value is RuntimeDiagnosticSummary {
  return isRecord(value)
    && value.schema === "tsian.runtime.diagnostic.v1"
    && typeof value.turn === "number"
    && Array.isArray(value.facts)
}

function normalizeDiagnostics(items: unknown[]): RuntimeDiagnosticSummary[] {
  return items
    .filter(isRuntimeDiagnosticSummary)
    .sort((a, b) => b.turn - a.turn)
}

function roleLabel(role: string): string {
  if (role === "user") return "玩家"
  if (role === "assistant") return "助手"
  if (role === "system") return "系统"
  return role || "消息"
}

function severityLabel(severity: RuntimeDiagnosticSeverity): string {
  if (severity === "error") return "错误"
  if (severity === "warning") return "警告"
  return "信息"
}

function severityClass(severity: RuntimeDiagnosticSeverity): string {
  if (severity === "error") return "border-danger/45 bg-danger/10 text-danger"
  if (severity === "warning") return "border-warning/45 bg-warning/10 text-warning"
  return "border-neon-deep/35 bg-elevated/35 text-text-dim"
}

function statusLabel(status: RuntimeDiagnosticStatus): string {
  if (status === "failed") return "失败"
  if (status === "anomalous") return "异常"
  return "完成"
}

function traceKindLabel(kind: RuntimeDiagnosticTraceKind): string {
  return kind === "failed" ? "失败 trace" : "成功 trace"
}

function sourceLabel(source: RuntimeDiagnosticSource): string {
  const labels: Record<RuntimeDiagnosticSource, string> = {
    turn: "回合",
    agent: "Agent",
    model: "模型",
    skill: "Skill",
    action: "Action",
    agent_call: "Agent 调用",
    workspace: "工作区",
    script: "脚本",
    session: "会话",
    trace: "Trace",
  }
  return labels[source] ?? source
}

function diagnosticSummaryLine(item: RuntimeDiagnosticSummary): string {
  const health = item.health
  const facts = item.facts.length
  if (!health) {
    return `${facts} 条事实，${item.eventCount} 个事件。`
  }
  return `${health.modelCallCount} 次模型调用，${health.workspaceToolCallCount} 次工作区工具调用，${health.workspaceMutationCount} 次工作区变更，${facts} 条事实。`
}

function factLine(fact: RuntimeDiagnosticFact): string {
  const parts = [
    fact.code,
    fact.message,
    fact.agentId ? `agent=${fact.agentId}` : "",
    fact.debugLabel ? `label=${fact.debugLabel}` : "",
    fact.skill ? `skill=${fact.skill}` : "",
    fact.action ? `action=${fact.action}` : "",
    fact.tool ? `tool=${fact.tool}` : "",
    fact.executor ? `executor=${fact.executor}` : "",
  ].filter(Boolean)

  if (parts.length > 0) {
    return parts.join(" · ")
  }

  if (fact.detailsSummary) {
    return formatJson(fact.detailsSummary)
  }

  return fact.ok === false ? "事件标记为失败。" : "记录到一条运行时事实。"
}

function checkpointId(value: unknown): string {
  return isRecord(value) && typeof value.id === "string" ? value.id : ""
}

function checkpointLabel(value: unknown): string {
  return isRecord(value) && typeof value.label === "string"
    ? value.label
    : checkpointId(value) || "检查点"
}

function checkpointTurn(value: unknown): string {
  const turn = isRecord(value) ? readNumber(value.turn) : null
  return turn === null ? "--" : String(turn)
}

function checkpointReasonLabel(value: unknown): string {
  if (!isRecord(value)) return "unknown"
  if (value.reason === "initial") return "初始"
  if (value.reason === "after-turn") return "回合后"
  if (value.reason === "manual") return "手动"
  return "unknown"
}

function checkpointTime(value: unknown): string {
  const createdAt = isRecord(value) ? readNumber(value.createdAt) : null
  if (createdAt === null) return "时间未知"
  return new Date(createdAt).toLocaleString()
}

function checkpointMessageCount(value: unknown): number {
  const count = isRecord(value) ? readNumber(value.messageCount) : null
  return count ?? 0
}

function checkpointWorkspaceFileCount(value: unknown): number {
  const count = isRecord(value) ? readNumber(value.workspaceFileCount) : null
  return count ?? 0
}

function markRefreshTime() {
  lastRefreshAt.value = new Date().toLocaleTimeString()
}

async function refreshAiDebug() {
  if (!playFrontendBridge.debug) {
    aiDebugRecords.value = []
    return
  }
  aiDebugRecords.value = await playFrontendBridge.debug.getAiDebugRecords()
}

async function refreshRuntimeSnapshot() {
  runtimeSnapshot.value = await playFrontendBridge.runtime.getRuntimeSnapshot()
}

async function refreshPlatformContext() {
  platformContext.value = await playFrontendBridge.platform.getPlatformContext()
}

async function refreshQueryResource(
  resource: string,
  setter: (items: unknown[]) => void,
  params?: Record<string, unknown>,
) {
  if (typeof playFrontendBridge.query?.query !== "function") {
    setter([])
    return
  }
  const result = await playFrontendBridge.query.query({ resource, params })
  setter(Array.isArray(result?.items) ? result.items : [])
}

async function refreshAll() {
  loading.value = true
  errorMessage.value = ""
  try {
    await Promise.all([
      refreshPlatformContext(),
      refreshAiDebug(),
      refreshRuntimeSnapshot(),
      refreshQueryResource("history", (items) => (historyItems.value = normalizeHistory(items))),
      refreshQueryResource("checkpoints", (items) => (checkpointItems.value = items)),
      refreshQueryResource(
        "runtime-diagnostics",
        (items) => (diagnosticItems.value = normalizeDiagnostics(items)),
        { limit: 8, lookbackTurns: 12, includeHealth: true },
      ),
    ])
    markRefreshTime()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "刷新系统监视器时发生未知错误。"
  } finally {
    loading.value = false
  }
}

async function restoreCheckpoint(checkpointIdValue: string) {
  if (!checkpointIdValue) return
  const confirmed = window.confirm("恢复检查点会回滚当前存档的运行时状态。确认继续吗？")
  if (!confirmed) return

  const result = await playFrontendBridge.platform.runAction({
    action: "restore-checkpoint",
    params: { checkpointId: checkpointIdValue },
  })
  if (!result.ok) {
    window.alert(result.error?.message ?? "恢复检查点失败。")
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
