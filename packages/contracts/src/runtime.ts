export interface ConversationMessageRecord {
  role: string
  content: string
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
  mediaType?: string
  size?: number
  childCount?: number
}

export interface WorkspaceFile {
  path: string
  content: string
  mediaType: string
  createdAt: number
  updatedAt: number
}

export type WorkspaceScope =
  | "effective"
  | "card-content"
  | "save-runtime"
  | "platform-meta"

export type WorkspaceOperationName =
  | "list"
  | "search"
  | "read"
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
  limit?: number
  content?: string
  mediaType?: string
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

export interface AgentRegistryEntry {
  id: string
  title: string
  summary: string
  path: string
  contacts: string[]
  defaultSkills: string[]
  contextPaths: string[]
  updatedAt: number
}

export interface AgentContextEntry {
  agent: AgentRegistryEntry
  agentFile: WorkspaceFile
  notesFile?: WorkspaceFile
  sessionFile?: WorkspaceFile
  skillIndex: SkillRegistryEntry[]
  contextFiles: WorkspaceFile[]
  missingContextPaths: string[]
}

export type SkillRegistryScope = "shared" | "agent-local"

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
}

export interface SkillResourceEntry {
  path: string
  name: string
  relativePath: string
  mediaType: string
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
  mediaType: string
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
