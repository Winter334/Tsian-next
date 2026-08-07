import type {
  AgentContextEntry,
  AskUserRequest,
  AskUserResult,
  ContentPart,
  PlatformActionResult,
  RemotePlayBridgeMethod,
  SkillConfigItem,
  SkillRegistryEntry,
  UiToolPresentation,
  WorkspaceFile,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
} from "@tsian/contracts"
import type {
  RuntimeTraceDebugLabel,
  RuntimeTraceEmitter,
} from "./trace"
import type {
  WorkspaceOperationMutationAdapter,
  WorkspaceOperationVirtualReadAdapter,
} from "./workspace-operations"

export interface RuntimeWorkspaceToolCall {
  name: string
  arguments: Record<string, unknown>
  /**
   * Provider-assigned tool call id (native function-calling mode). Used as the
   * `callId` for turn-tool events so the frontend can correlate status updates
   * for the same call. Text-protocol calls have no provider id and fall back to
   * `tool-${index}` at emit time.
   */
  id?: string
}

export const RUNTIME_WORKSPACE_TOOL_NAMES = {
  useSkill: "use_skill",
  runScript: "run_script",
  agentCall: "agent_call",
  inspectFrontend: "inspect_frontend",
  askUser: "ask_user",
  testSkillScript: "test_skill_script",
  queryDiagnostics: "query_diagnostics",
  read: "read",
  list: "list",
  search: "search",
  glob: "glob",
  diff: "diff",
  write: "write",
  edit: "edit",
  copy: "copy",
  move: "move",
  delete: "delete",
  semanticSearch: "semantic_search",
} as const

export type RuntimeWorkspaceToolName =
  (typeof RUNTIME_WORKSPACE_TOOL_NAMES)[keyof typeof RUNTIME_WORKSPACE_TOOL_NAMES]

/**
 * Names of the workspace file-operation tools exposed to the model. These are
 * the short primitive names (`read`/`list`/...). They map 1:1 to the underlying
 * `WorkspaceOperationName`, so `call.name` is used directly as the operation
 * (no prefix to slice). The `browser_script` SDK RPC wire protocol still uses
 * `workspace.<op>` strings — see `browser-skill-script-executor.ts` — and is a
 * separate path that is intentionally not renamed here.
 */
export const WORKSPACE_OPERATION_TOOL_NAMES = new Set<string>([
  RUNTIME_WORKSPACE_TOOL_NAMES.read,
  RUNTIME_WORKSPACE_TOOL_NAMES.list,
  RUNTIME_WORKSPACE_TOOL_NAMES.search,
  RUNTIME_WORKSPACE_TOOL_NAMES.glob,
  RUNTIME_WORKSPACE_TOOL_NAMES.diff,
  RUNTIME_WORKSPACE_TOOL_NAMES.write,
  RUNTIME_WORKSPACE_TOOL_NAMES.edit,
  RUNTIME_WORKSPACE_TOOL_NAMES.copy,
  RUNTIME_WORKSPACE_TOOL_NAMES.move,
  RUNTIME_WORKSPACE_TOOL_NAMES.delete,
  RUNTIME_WORKSPACE_TOOL_NAMES.semanticSearch,
])

export function isWorkspaceOperationToolName(name: string): boolean {
  return WORKSPACE_OPERATION_TOOL_NAMES.has(name)
}

export interface ParsedRuntimeWorkspaceToolCall {
  raw: string
  call?: RuntimeWorkspaceToolCall
  error?: RuntimeWorkspaceToolError
}

export interface RuntimeWorkspaceToolError {
  code: string
  message: string
  details?: unknown
}

export interface RuntimeWorkspaceToolObservation {
  index: number
  name: string
  ok: boolean
  result?: unknown
  error?: RuntimeWorkspaceToolError
  /** 图片 ContentPart 列表(workspace_read 读图片时提取). 不进 text observation
   *  (避免 base64 爆文本上下文),由消息注入层追加到 user 消息的 ContentPart[]. */
  imageParts?: ContentPart[]
}

export interface RuntimeSkillActionDeclaration {
  name: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  executor: RuntimeActionExecutorReference
}

export interface RuntimeActionExecutorReference {
  type: string
  name: string
  path?: string
  timeoutMs?: number
  /**
   * Helper source files to concatenate before the script source at eval time.
   * Relative paths (`_common.js`, `./foo.js`, `sub/bar.js`) resolve against the
   * Skill's scripts/ directory; absolute paths (`agents/.../scripts/foo.js`)
   * resolve from workspace root. Omitted when the script needs no helpers.
   */
  helpers?: string[]
}

export interface RuntimeActionExecutorResult {
  status: "executed"
  output: unknown
}

export type RuntimeAgentCallHistoryMode = "minimal" | "recent" | "scene"

export interface RuntimeAgentCallArguments {
  agentId: string
  request: string
  reason?: string
  contextSummary?: string
  expectedOutput?: string
  historyMode: RuntimeAgentCallHistoryMode
  /**
   * Optional inactivity timeout quota in ms for this delegated agent call.
   * When no activity (delta/tool/round-end) occurs for this duration, the
   * delegated tool loop aborts and the call resolves as AGENT_CALL_FAILED with
   * `{ timeout: true }` details. Defaults to DEFAULT_TASK_INACTIVITY_TIMEOUT_MS
   * (600s) when omitted. Only meaningful for task-mode delegated agents (all
   * delegated agents are task-mode).
   */
  timeoutMs?: number
}

export type RuntimeAgentCallRunner = (
  input: RuntimeAgentCallArguments,
) => Promise<unknown>

export type RuntimeDiagnosticsQueryInput =
  | {
      operation: "list"
      recordType?: "ai-request" | "frontend-error"
      status?: string
      provider?: string
      model?: string
      operationId?: string
      limit?: number
    }
  | { operation: "search"; query: string; recordType?: "ai-request" | "frontend-error"; limit?: number }
  | {
      operation: "read"
      id: string
      section?: "summary" | "error" | "attempts" | "request" | "response"
      offset?: number
      limit?: number
    }

export type RuntimeDiagnosticsQueryRunner = (
  input: RuntimeDiagnosticsQueryInput,
) => Promise<unknown>

/**
 * inspect_frontend — 助手前端自检工具的入参/出参类型。
 *
 * 类型定义在 agent-runtime 层（与 RuntimeAgentCallArguments /
 * RuntimeBrowserScriptRunner 平级），实现编排逻辑在 platform-host/
 * frontend-inspector.ts。这样 agent-runtime 不反向依赖 platform-host，
 * 顺应 "agent-runtime must not import platform-host" 的 spec 约束。
 * 工具不接受 cardId，inspector 内部从 getPlatformActiveGameCard() 取当前卡。
 */
export type InspectDomActionType =
  | "click" | "type" | "press" | "scroll"
  | "selectOption" | "check" | "fill" | "hover" | "focus"

export interface InspectDomAction {
  type: InspectDomActionType
  selector: string
  /** type / fill 动作用 */
  text?: string
  /** press 动作用 */
  key?: string
  /** scroll 动作用 */
  to?: "top" | "bottom"
  /** selectOption：按 option value 匹配 */
  value?: string
  /** selectOption：按 option 文本匹配 */
  label?: string
  /** check：默认 true，false=取消勾选 */
  checked?: boolean
}

export type InspectFrontendWaitMode = "runtime-settled" | "dom-stable"

export type InspectFrontendWaitStatus =
  | "not-requested"
  | "triggered"
  | "settled"
  | "settled-with-failures"
  | "not-triggered"
  | "timeout"
  | "not-active"

export interface InspectFrontendWaitSummary {
  mode: "none" | InspectFrontendWaitMode
  status: InspectFrontendWaitStatus
  waitedMs: number
  activityBefore: number
  activityAfter: number
  triggerTimeoutMs?: number
  settleTimeoutMs?: number
  triggered?: boolean
  settled?: boolean
}

export type InspectFrontendInteractableKind =
  | "button" | "input" | "textarea" | "select" | "link"
  | "checkbox" | "radio" | "card" | "tab" | "option"
  | "dialog" | "status" | "generic"

export interface InspectFrontendInteractable {
  ref: string
  kind: InspectFrontendInteractableKind
  name?: string
  selector: string
  visible: boolean
  disabled?: boolean
  readonly?: boolean
  checked?: boolean
  selected?: boolean
  expanded?: boolean
}

export interface InspectFrontendActionResult {
  step: number
  action: InspectDomAction
  ok: boolean
  matchedCount: number
  target?: {
    tag: string
    role: string
    name?: string
    selector: string
    visible: boolean
    disabled?: boolean
    readonly?: boolean
  }
  effect?: {
    domChanged: boolean
    bridgeTriggered: boolean
  }
  error?: { code: string; message: string; details?: unknown }
}

export interface InspectFrontendDiagnosticsSummary {
  errors: number
  consoleErrors: number
  consoleWarnings: number
  resourceFailures: number
  resourceTimingAnomalies: number
  resourceTimingAnomaliesCollapsed?: boolean
}

export interface InspectFrontendBuildSummary {
  status: "idle" | "building" | "ok" | "failed"
  lastBuiltAt: string | null
  error?: { message: string; file?: string; line?: number }
}

export interface InspectFrontendSourceHint {
  kind: "runtime-error" | "build-error"
  path: string
  line?: number
  confidence: "high"
  message?: string
}

export interface InspectFrontendInput {
  operation?: "inspect" | "finish"
  actions?: InspectDomAction[]
  observeBetween?: boolean
  autoWait?: boolean
  wait?: InspectFrontendWaitMode
  timeoutMs?: number
}

export interface InspectFrontendStructure {
  domSummary: string
  computedStyles: Record<string, string>[]
  renderedText: string
  bridgeState: "loading" | "ready" | "turn-active" | "error"
}

export interface InspectFrontendDiagnostics {
  errors: { message: string; stack?: string; source?: string; line?: number; col?: number }[]
  console: { level: "log" | "warn" | "error"; args: string[] }[]
  resourceFailures: { url: string; status?: number; reason: string }[]
  bridgeHandshake: "pending" | "ready" | "timeout"
}

export interface InspectFrontendActivityEntry {
  sequence: number
  requestId: string
  method: RemotePlayBridgeMethod
  phase: "started" | "completed" | "failed"
  relativeMs: number
  error?: { code: string; message: string }
}

export interface InspectFrontendActionSnapshot {
  step: number
  action: InspectDomAction
  after: { domSummary: string; bridgeState: string }
}

export interface InspectFrontendResult {
  ok: boolean
  operation: "inspect" | "finish"
  cardId: string
  entry: string
  frameGeneration?: number
  debugSession?: {
    active: boolean
    saveId: string
    baselineCheckpointId: string
    baselineTurn: number
    startedAt: number
    rollbackScope: "save-runtime"
  }
  structure: InspectFrontendStructure
  diagnostics: InspectFrontendDiagnostics
  wait?: InspectFrontendWaitSummary
  interactables?: InspectFrontendInteractable[]
  actions?: InspectFrontendActionResult[]
  diagnosticsSummary?: InspectFrontendDiagnosticsSummary
  frontendBuild?: InspectFrontendBuildSummary
  sourceHints?: InspectFrontendSourceHint[]
  activity?: InspectFrontendActivityEntry[]
  runtime?: {
    status: "not-requested" | "active" | "settled" | "settled-with-failures" | "timeout"
    sendCount: number
    inFlight: number
    quietMs: number
  }
  restored?: {
    restored: boolean
    restoredTurn: number
    reloadReady: boolean
  }
  actionSnapshots?: InspectFrontendActionSnapshot[]
  fileLineMap?: Record<string, { source: string; line: number }[]>
  diff?: {
    added: string[]
    removed: string[]
    changed: { path: string; from: string; to: string }[]
  }
  truncated?: boolean
  error?: { code: string; message: string; details?: unknown }
}

export type RuntimeInspectFrontendRunner = (
  input: InspectFrontendInput,
) => Promise<InspectFrontendResult>

export interface RuntimeControlledExecutorContext {
  agentContext?: AgentContextEntry
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  workspaceFileFilter?: (file: WorkspaceFile) => boolean
  virtualWorkspaceReads?: WorkspaceOperationVirtualReadAdapter
}

export interface RuntimeBrowserScriptExecutorRequest {
  /**
   * Owner kind driving root-directory resolution and config injection.
   *
   * - `"skill"` (default, back-compat): root derived from `skillPath`; the
   *   Skill's declared `configItems` (if any) are merged with player-saved
   *   overrides and injected as `tsian.config`.
   * - `"tool"`: root taken from `rootDirectory`; `tsian.config` is empty.
   *
   * Old Skill callers can omit this field entirely — the executor treats an
   * absent value as `"skill"` and reads `skillPath` as it did before the
   * Tool layer landed.
   */
  ownerType?: "skill" | "tool"
  /**
   * Declaring directory of the owner (Skill dir or Tool dir). Required when
   * `ownerType === "tool"`; ignored for Skill callers (they carry `skillPath`).
   * The executor uses this as the root against which `scriptPath`,
   * `importScripts('./x.js')`, and `helpers` entries are validated.
   */
  rootDirectory?: string
  /**
   * Skill name. Retained for back-compat with existing Skill call sites; the
   * Tool dispatch branch passes the Tool `name` in the same field so trace
   * events keep a single label column.
   */
  skillName: string
  /**
   * Path to `SKILL.md`. Kept for back-compat; not used for Tools (they
   * carry `rootDirectory` instead). Trace events reference this field.
   */
  skillPath: string
  actionName: string
  scriptPath: string
  input: Record<string, unknown>
  timeoutMs: number
  /**
   * Helper source file paths declared by `executor.helpers`. The browser-script
   * executor reads each file and concatenates its source before the script
   * source (after importScripts inlining). Same path resolution as
   * `RuntimeActionExecutorReference.helpers`.
   */
  helpers?: string[]
  /**
   * Config items declared by the skill's `skill.config` (carried from the
   * `SkillRegistryEntry`). The browser-script executor merges these defaults
   * with player-saved overrides and injects the result as `tsian.config`.
   * Absent when the skill declares no config, and always absent for Tools
   * (Tool scripts get an empty `tsian.config` by design — see PRD R12).
   */
  configItems?: SkillConfigItem[]
}

export type RuntimeBrowserScriptRunner = (
  request: RuntimeBrowserScriptExecutorRequest,
  context?: RuntimeControlledExecutorContext,
) => Promise<PlatformActionResult>

export interface RuntimeTestSkillScriptInput {
  skillName: string
  actionName: string
  input: Record<string, unknown>
}

export type RuntimeTestSkillScriptRunner = (
  input: RuntimeTestSkillScriptInput,
  context?: RuntimeControlledExecutorContext,
) => Promise<PlatformActionResult>

export interface RuntimeActionExecutorPolicyRequest {
  skill: {
    name: string
    path: string
    scope: string
    agentId?: string
  }
  action: {
    name: string
  }
  executor: RuntimeActionExecutorReference
}

export interface RuntimeActionExecutorPolicyDecision {
  enabled: boolean
  reason?: string
  source?: string
}

export type RuntimeActionExecutorPolicy = (
  request: RuntimeActionExecutorPolicyRequest,
) => RuntimeActionExecutorPolicyDecision | boolean

export interface RuntimeActionExecutorContext {
  input: Record<string, unknown>
  loadedSkill: RuntimeLoadedSkill
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  workspaceMutations?: WorkspaceOperationMutationAdapter
  virtualWorkspaceReads?: WorkspaceOperationVirtualReadAdapter
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  workspaceFileFilter?: (file: WorkspaceFile) => boolean
  runBrowserScript?: RuntimeBrowserScriptRunner
  signal?: AbortSignal
}

export interface RuntimeLoadedSkill {
  skill: SkillRegistryEntry
  actions: RuntimeSkillActionDeclaration[]
}

export interface RuntimeWorkspaceToolSessionState {
  loadedSkills: RuntimeLoadedSkill[]
}

export interface SkillActionParseResult {
  actions: RuntimeSkillActionDeclaration[]
  errors: RuntimeWorkspaceToolError[]
}

export interface RuntimeWorkspaceToolExecutionContext {
  workspaceFiles: WorkspaceFile[]
  agentContext?: AgentContextEntry
  sessionState?: RuntimeWorkspaceToolSessionState
  runAgentCall?: RuntimeAgentCallRunner
  runInspectFrontend?: RuntimeInspectFrontendRunner
  runQueryDiagnostics?: RuntimeDiagnosticsQueryRunner
  runBrowserScript?: RuntimeBrowserScriptRunner
  runTestSkillScript?: RuntimeTestSkillScriptRunner
  actionExecutorPolicy?: RuntimeActionExecutorPolicy
  workspaceMutations?: WorkspaceOperationMutationAdapter
  virtualWorkspaceReads?: WorkspaceOperationVirtualReadAdapter
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  workspaceFileFilter?: (file: WorkspaceFile) => boolean
  /** semantic_search 专用:owner id(save-runtime 下为 saveId). */
  semanticSearchOwnerId?: string
  signal?: AbortSignal
  debugLabel?: RuntimeTraceDebugLabel
  emitTrace?: RuntimeTraceEmitter
  /**
   * Tool process event callback (子2b R2). Invoked before/after each tool
   * executes with the tool's callId, name, status, and (for success/failed) a
   * closed presentation. `undefined` disables events (delegated agents,
   * text-protocol entry path). Signature excludes turn/round — the caller binds
   * round before threading it in, and turn is bound at the platform-host layer.
   */
  onTool?: (
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    presentation?: UiToolPresentation,
    displayName?: string,
  ) => void
  /**
   * ask_user 工具回调（ask_user R3）。工具执行时 await 此回调，阻塞 turn 等待
   * 玩家回答。host 侧绑定为 emitInteractionRequest，返回 Promise 在玩家回答后 resolve。
   * `undefined` 时 ask_user 返回 ASK_USER_UNAVAILABLE 错误。
   */
  onAskUser?: (requestId: string, request: AskUserRequest) => Promise<AskUserResult>
}
