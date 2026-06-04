/**
 * 调试类型契约
 *
 * 这些类型原住在 `apps/platform-web` 内部，UI 重构期间迁到 contracts 公共契约层，
 * 以便 `bridge.debug` 命名空间（B3）与游玩前端跨包共享。字段名/字段类型完全照搬源定义。
 *
 * 每个 record 类型新增 `turn?: number` 字段，含义：本轮编号，用于历史轮回溯（首版可缺省）。
 * 运行时是否填值由桥实现方在 B3 决定，本契约只暂留位置。
 */

// ============================================================================
// AI 调试记录（原 apps/platform-web/src/runtime-host/ai.ts）
// ============================================================================

export interface AiChatMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export interface AiDebugRecord {
  id: string
  kind: "chat" | "embedding"
  label: string
  model: string
  createdAt: string
  messages?: AiChatMessage[]
  input?: string[]
  responseText?: string
  vectorCount?: number
  dimensions?: number
  error?: string
  /** 本轮编号，用于历史轮回溯（首版可缺省） */
  turn?: number
  /**
   * B3 / D11：上游 API 响应里的 token 计数。能解析到就填，否则 undefined。
   * 不做估算、不伪造；不同 channel 字段名不同（OpenAI: prompt/completion/total，
   * Anthropic: input/output），统一归一到本字段。
   */
  usage?: {
    input?: number
    output?: number
    total?: number
  }
}

// ============================================================================
// 检索调试记录（原 apps/platform-web/src/runtime-host/retrieval.ts）
// ============================================================================

export interface RetrievalCandidateDebugRecord {
  id: string
  time: string
  status: string
  tags: string[]
  keywordScore: number
  semanticScore: number | null
  finalScore: number
  selected: boolean
  content: string
}

export interface RetrievalArchiveDebugRecord {
  id: string
  name: string
  presence: string
  score: number
  source: "direct" | "present" | "event" | "bridge" | "semantic"
}

export interface RetrievalCatalogEventDebugRecord {
  id: string
  name: string
  score: number
  selected: boolean
  content: string
  guidance?: string
}

export interface RetrievalSemanticDebugRecord {
  enabled: boolean
  keywords: string[]
  eventIds: string[]
  archiveIds: string[]
  error?: string
}

export interface RetrievalHintEntityDebugRecord {
  archiveId: string
  name: string
  type: string
}

/**
 * 检索阶段调试记录。`settings` 字段在源文件里强类型 `BrowserRetrievalSettings`，
 * 但该类型属于 platform-web 内部配置（含 env / localStorage 兜底），跨包共享不必收紧；
 * 这里保留为 `unknown`，调用方按需 cast 回具体类型。
 */
export interface RetrievalDebugRecord {
  input: string
  settings: unknown
  semantic: RetrievalSemanticDebugRecord
  directEntities: string[]
  presentEntities: string[]
  linkedEntities: string[]
  groups: string[][]
  candidates: RetrievalCandidateDebugRecord[]
  archives: RetrievalArchiveDebugRecord[]
  catalogEvents: RetrievalCatalogEventDebugRecord[]
  hintEntities?: RetrievalHintEntityDebugRecord[]
  /** 本轮编号，用于历史轮回溯（首版可缺省） */
  turn?: number
}

export interface RetrievalAssemblyResult {
  prompt: string
  debug: RetrievalDebugRecord
}

// ============================================================================
// 工作流输出快照（原 apps/platform-web/src/workflow-host/outputs-store.ts）
// ============================================================================

export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "aborted"

export type WorkflowRunSourceKind =
  | "save-override"
  | "mod-preset"
  | "legacy-mod-workflow"
  | "platform-default"

export interface WorkflowRunSource {
  kind: WorkflowRunSourceKind
  modId: string
  saveId?: string
  workflowPresetId?: string
  workflowName?: string
}

export interface WorkflowTraceError {
  code: string
  message: string
}

export interface WorkflowRunMetadata {
  runId: string
  saveId: string
  turn: number
  status: WorkflowRunStatus
  isModWorkflow: boolean
  source: WorkflowRunSource
  startedAt: number
  finishedAt?: number
  error?: WorkflowTraceError
}

/**
 * 单节点输出状态。
 *
 * 状态机：
 *   pending --(startNode)--> running
 *   running --(succeedNode)--> succeeded
 *   running --(failNode)--> failed
 *   pending|running --(abortNode)--> aborted
 *   succeeded|failed --(abortNode)--> 原状（abortNode 对已 settled 节点 no-op）
 */
export interface NodeOutputState {
  status: "pending" | "running" | "succeeded" | "failed" | "aborted"
  /** 节点类型（来自 workflow definition） */
  type?: string
  /** 本轮调度开始顺序（running 时分配），便于 UI 按执行顺序展示 */
  startOrder?: number
  /** 节点输入端口 → 值（running/succeeded/failed/aborted 都可能保留） */
  inputs?: Record<string, unknown>
  /** 节点端口 → 值（仅 succeeded 时有值） */
  outputs?: Record<string, unknown>
  /** 失败原因（仅 failed 时有值） */
  error?: WorkflowTraceError
  /** 进入 running 时间戳（ms） */
  startedAt?: number
  /** 进入 succeeded/failed/aborted 时间戳（ms） */
  finishedAt?: number
}

export interface WorkflowOutputsSnapshot {
  /** 本轮工作流运行元数据 */
  run: WorkflowRunMetadata
  /** nodeId → state */
  nodes: Record<string, NodeOutputState>
  /** result 节点的 config.name → outputs.value */
  results: Record<string, unknown>
  /** 当前轮序号（与 SaveState.turn 对齐；等同于 run.turn） */
  turn: number
}
