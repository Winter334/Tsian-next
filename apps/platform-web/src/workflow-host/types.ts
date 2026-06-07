/**
 * platform-web 工作流执行上下文（H4）
 *
 * 在 @tsian/workflow-engine 的 WorkflowExecutionContext 之上扩展平台运行时所需句柄。
 * H8 之前由本目录 createWorkflowExecutionContext 工厂逐轮新建，不跨轮共享。
 *
 * 字段使用宽松类型（unknown / Record）的原因：
 *   - PresetInfo / WorldBook 的强类型来自 @tsian/prompt-engine；本文件不引入硬依赖以免
 *     把 prompt-engine 的类型披露到 contracts 链路。
 *   - executor 在自己内部 cast 后再消费，便于按节点单独演进。
 */

import type {
  NodeExecutor,
  WorkflowExecutionContext,
} from "@tsian/workflow-engine"
import type {
  ArchiveRecord,
  CatalogEventRecord,
  ConversationMessageRecord,
  RetrievalDebugRecord,
  RuntimeGlobalsMap,
} from "@tsian/contracts"
import type { BrowserRetrievalSettings } from "../config/ai"
import type { LocalEventRecord } from "../storage"
import type { LocalRuntimeEngine } from "../runtime-host/engine"

/**
 * 模组/平台预设条目。具体为 PresetInfo（@tsian/prompt-engine），
 * 在 ai-call executor 内部按 unknown → PresetInfo cast 校验最小字段。
 */
export type WorkflowPresetEntry = unknown

/**
 * 模组 worldBook 集合：按 key 索引（与 ai-call 节点 config.worldBookKeys 对齐）。
 * 值具体为 WorldBook（@tsian/prompt-engine）。
 */
export type WorkflowWorldBookMap = Readonly<Record<string, unknown>>

/**
 * 平台扩展的工作流执行上下文。
 *
 * - executors：内置 NodeExecutor 集合（由 createWorkflowExecutionContext 注入）
 * - runtimeEngine / saveId：state-write 等副作用 executor 使用
 * - macros：平台 + 模组 customMacros 合并后的最终宏 KV
 * - presets：从平台资源库加载的 prompt preset，按 presetId 索引
 * - worldBooks：从平台资源库加载的 world book，按 worldBookKeys 过滤
 * - history：本轮起点的会话历史（platform-host 在 sendMessage 入口准备好）
 */
export interface PlatformWorkflowContext extends WorkflowExecutionContext {
  executors: ReadonlyMap<string, NodeExecutor>
  runtimeEngine: LocalRuntimeEngine
  saveId: string
  turn: number
  macros: Record<string, string>
  presets: ReadonlyMap<string, WorkflowPresetEntry>
  worldBooks: WorkflowWorldBookMap
  history: ReadonlyArray<ConversationMessageRecord>
  userInput: string
  events: ReadonlyArray<LocalEventRecord>
  activeEvents: ReadonlyArray<LocalEventRecord>
  archives: ReadonlyArray<ArchiveRecord>
  catalogEvents: ReadonlyArray<CatalogEventRecord>
  currentTime?: string
  narrativeTimeText?: string
  globals?: RuntimeGlobalsMap
  playerArchiveIds: ReadonlyArray<string>
  retrievalSettings: BrowserRetrievalSettings
  recordRetrievalDebug?: (debug: RetrievalDebugRecord) => void
}

/**
 * 工厂入参：平台壳在 sendMessage 入口收齐这些字段后调用。
 */
export interface CreateWorkflowExecutionContextInput {
  runtimeEngine: LocalRuntimeEngine
  saveId: string
  turn: number
  macros: Record<string, string>
  presets: ReadonlyMap<string, WorkflowPresetEntry>
  worldBooks: WorkflowWorldBookMap
  history: ReadonlyArray<ConversationMessageRecord>
  userInput: string
  events: ReadonlyArray<LocalEventRecord>
  activeEvents: ReadonlyArray<LocalEventRecord>
  archives: ReadonlyArray<ArchiveRecord>
  catalogEvents: ReadonlyArray<CatalogEventRecord>
  currentTime?: string
  narrativeTimeText?: string
  globals?: RuntimeGlobalsMap
  playerArchiveIds: ReadonlyArray<string>
  retrievalSettings: BrowserRetrievalSettings
  recordRetrievalDebug?: (debug: RetrievalDebugRecord) => void
}
