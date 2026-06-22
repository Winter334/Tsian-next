export interface ConversationMessageRecord {
  role: string
  content: string
}

/**
 * One剧情正文 entry inside an `AgentContextSnapshot.recentTurns` list.
 * Stored as原文 (user input or assistant final reply); tool process / thought
 * streams are intentionally excluded so压缩摘要 stays pure剧情.
 */
export interface AgentContextTurnEntry {
  turn: number
  role: "user" | "assistant"
  content: string
}

/**
 * agent 会话上下文快照,持久化跨 turn 稳态("1 摘要 + 最近 K 轮正文").
 * 与可见消息存档(`saveHistory`/助手会话消息)分离:这里存的是 agent 视角的
 * 上下文稳态,跨 turn/跨加载保持不膨胀不失忆.
 * system prompt / Workspace 上下文 / 当前回合号 / 玩家本轮输入不持久化
 * (每 turn 现构建),这里只存跨 turn 需保持的上下文段.
 *
 * 两种实例:
 * - master:schema `tsian.agent.context.v1`,agentId `"master"`,落 save runtime
 *   `save/agents/master/context.json`,summary 是叙事梗概.
 * - 助手:schema `tsian.assistant.context.v1`,agentId `"assistant"`,落虚拟文件
 *   `.tsian/local/assistant/sessions/<sessionId>/context.json`,summary 是任务摘要.
 * 类型复用(master/助手结构同构),agentId/schema 值层面区分语义.
 */
export interface AgentContextSnapshot {
  /** schema 标记.master=tsian.agent.context.v1;助手=tsian.assistant.context.v1. */
  schema: "tsian.agent.context.v1" | "tsian.assistant.context.v1"
  /** master=saveId;助手=sessionId(语义复用,定位靠文件路径不靠此字段). */
  saveId: string
  /** master="master";助手="assistant".放宽为 string 以复用类型. */
  agentId: string
  /** 早期摘要(压缩后产生).null = 尚未触发压缩.master 叙事梗概,助手任务摘要. */
  summary: string | null
  /** 最近 K=5 轮正文(user+assistant 对,带 turn 索引,原文).按 turn 升序. */
  recentTurns: AgentContextTurnEntry[]
  /** 上次压缩覆盖到第几轮(防重复压缩).null = 未压缩过. */
  lastCompressedTurn: number | null
  /** ISO timestamp,最后一次更新时间. */
  updatedAt: string
}

export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | {
      [key: string]: JsonValue
    }

export interface RuntimeGlobalsMap {
  [key: string]: JsonValue
}

export type WorkspaceEntryKind = "file" | "directory"

export interface WorkspaceEntry {
  path: string
  name: string
  kind: WorkspaceEntryKind
  updatedAt?: number
  size?: number
  childCount?: number
}

export interface WorkspaceFile {
  path: string
  /** Text content for text files; a placeholder string for binary files
   *  (see `binary`). Agents read only this field; it is always a string. */
  content: string
  /** Binary payload for media files (image/audio/video/etc.). Mutually
   *  exclusive with meaningful `content` — when present, `content` is a
   *  placeholder description, not the file bytes. Agents do not read this
   *  field; future multimodal support will surface it as an image content
   *  block through an independent channel. */
  binary?: Blob
  createdAt: number
  updatedAt: number
}

export type WorkspaceScope =
  | "effective"
  | "card-content"
  | "save-runtime"
  | "platform-meta"
  | "card-frontend"

export type WorkspaceOperationName =
  | "list"
  | "search"
  | "read"
  | "glob"
  | "diff"
  | "patch"
  | "write"
  | "move"
  | "delete"
  | "validate"

export interface WorkspaceOperationRequest {
  operation: WorkspaceOperationName
  scope: WorkspaceScope
  path?: string
  targetPath?: string
  query?: string
  pattern?: string
  limit?: number
  /** Text content for write/patch, or a Blob for binary writes. */
  content?: string | Blob
  expectedContent?: string
  validator?: "json" | "frontmatter"
  autoFix?: boolean
}

export interface WorkspaceDiffResult {
  path: string
  scope: WorkspaceScope
  currentContent: string
  nextContent: string
  changed: boolean
  currentSize: number
  nextSize: number
}

export interface WorkspaceGlobResult {
  scope: WorkspaceScope
  pattern: string
  matches: string[]
  truncated: boolean
}

export interface WorkspacePatchResult {
  path: string
  scope: WorkspaceScope
  file: WorkspaceFile
  changed: boolean
}

export interface WorkspaceMoveResult {
  scope: WorkspaceScope
  fromPath: string
  toPath: string
  movedPaths: string[]
}

export interface WorkspaceDeleteResult {
  scope: WorkspaceScope
  deletedPaths: string[]
}

export interface WorkspaceValidationResult {
  scope: WorkspaceScope
  path?: string
  valid: boolean
  validator: string
  errors: Array<{
    code: string
    message: string
    path?: string
  }>
}

export type AgentPlatformToolName =
  | "agent_call"
  | "workspace_read"
  | "workspace_write"

export interface AgentSkillConfig {
  enabled: string[]
  disabled: string[]
}

export interface AgentPlatformToolConfig {
  enabled: AgentPlatformToolName[]
  disabled: AgentPlatformToolName[]
}

export interface AgentWorkspaceAccessConfig {
  level: number
}

export interface AgentConfig {
  id: string
  title: string
  summary: string
  contacts: string[]
  contextPaths: string[]
  skills: AgentSkillConfig
  platformTools: AgentPlatformToolConfig
  workspaceAccess: AgentWorkspaceAccessConfig
  knowledgeMount?: string
  providerPresetId?: string
}

export interface AgentRegistryEntry {
  id: string
  title: string
  summary: string
  configPath: string
  path: string
  contacts: string[]
  defaultSkills: string[]
  enabledSkills: string[]
  disabledSkills: string[]
  platformTools: AgentPlatformToolConfig
  workspaceAccess: AgentWorkspaceAccessConfig
  contextPaths: string[]
  knowledgeMount?: string
  providerPresetId?: string
  updatedAt: number
}

export interface AgentContextEntry {
  agent: AgentRegistryEntry
  agentFile: WorkspaceFile
  soulFile?: WorkspaceFile
  notesFile?: WorkspaceFile
  skillIndex: SkillRegistryEntry[]
  contextFiles: WorkspaceFile[]
  knowledgeFiles: WorkspaceFile[]
  missingContextPaths: string[]
}

export type SkillRegistryScope = "shared" | "agent-local"

/**
 * Lightweight summary of a Skill action declared in a `tsian-actions` fence.
 * This is a capability-existence listing (name + description + executor type +
 * executability), not the full action declaration — it deliberately omits
 * `inputSchema`, `outputSchema`, and executor `path` so progressive disclosure
 * is preserved: the model still needs `use_skill` to get the full SKILL.md and
 * `run_script` to execute a browser_script action.
 */
export interface SkillActionSummary {
  name: string
  description: string
  /** Executor type; after the tool/skill decouple task this is always "browser_script". */
  executorType: string
  /** Whether `run_script` can execute this action (true for browser_script). */
  executable: boolean
}

export interface SkillRegistryEntry {
  id: string
  name: string
  title: string
  description: string
  summary: string
  path: string
  scope: SkillRegistryScope
  agentId?: string
  triggers: string[]
  appliesTo: string[]
  updatedAt: number
  /** Action summaries parsed from the `tsian-actions` fence at registry build time. */
  actions?: SkillActionSummary[]
  /** Human-readable errors from parsing the `tsian-actions` fence (unsupported executor types, malformed JSON). */
  actionDeclarationErrors?: string[]
}

export interface SkillResourceEntry {
  path: string
  name: string
  relativePath: string
  size: number
  updatedAt: number
}

export interface SkillDetailEntry {
  registry: SkillRegistryEntry
  file: WorkspaceFile
  resources: SkillResourceEntry[]
}

export interface WorkspaceListResult {
  path: string
  entries: WorkspaceEntry[]
}

export interface WorkspaceSearchResult {
  path: string
  name: string
  updatedAt: number
  score: number
  preview: string
}

export type RuntimeDiagnosticSource =
  | "turn"
  | "agent"
  | "model"
  | "skill"
  | "action"
  | "agent_call"
  | "workspace"
  | "script"
  | "session"
  | "trace"

export type RuntimeDiagnosticStatus = "completed" | "failed" | "anomalous"

export type RuntimeDiagnosticSeverity = "info" | "warning" | "error"

export type RuntimeDiagnosticTraceKind = "success" | "failed"

export interface RuntimeDiagnosticsQueryParams {
  turn?: number
  limit?: number
  lookbackTurns?: number
  includeHealth?: boolean
}

export interface RuntimeDiagnosticFact {
  source: RuntimeDiagnosticSource
  eventType?: string
  severity: RuntimeDiagnosticSeverity
  timestamp?: number
  ok?: boolean
  agentId?: string
  debugLabel?: string
  code?: string
  message?: string
  detailsSummary?: Record<string, JsonValue>
  skill?: string
  action?: string
  tool?: string
  executor?: string
  relatedPaths: string[]
}

export interface RuntimeDiagnosticHealth {
  agentIds: string[]
  skillNames: string[]
  actionNames: string[]
  workspaceMutationPaths: string[]
  modelCallCount: number
  workspaceToolCallCount: number
  actionCallCount: number
  agentCallCount: number
  scriptLogCount: number
  workspaceMutationCount: number
  warningCount: number
  errorCount: number
}

export interface RuntimeDiagnosticSummary {
  schema: "tsian.runtime.diagnostic.v1"
  turn: number
  status: RuntimeDiagnosticStatus
  severity: RuntimeDiagnosticSeverity
  traceKind: RuntimeDiagnosticTraceKind
  startedAt?: number
  endedAt?: number
  updatedAt?: number
  eventCount: number
  malformedLineCount: number
  omittedFactCount: number
  health?: RuntimeDiagnosticHealth
  facts: RuntimeDiagnosticFact[]
}

export interface RuntimeStateShell {
  turn: number
  messages: ConversationMessageRecord[]
  globals?: RuntimeGlobalsMap
}

export interface RuntimeSnapshotShell {
  version: string
  state: RuntimeStateShell
}

export interface MessageInteractionRequest {
  content: string
}

export interface MessageInteractionResult {
  snapshot: RuntimeSnapshotShell
}

export interface DeepQueryRequest {
  resource: string
  params?: Record<string, unknown>
}

export interface DeepQueryResult<T = unknown> {
  items: T[]
}

export interface PlatformContextShell {
  version: string
  activeFrontendId?: string
  activeSaveId?: string
}

export interface PlatformActionRequest {
  action: string
  params?: Record<string, unknown>
}

export interface PlatformActionError {
  code: string
  message: string
  details?: Record<string, JsonValue>
}

export interface PlatformActionResult<T = unknown> {
  ok: boolean
  item?: T
  error?: PlatformActionError
}
