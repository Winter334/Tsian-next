import type {
  AgentContextEntry,
  AskUserRequest,
  AskUserResult,
  ContentPart,
  PlatformActionResult,
  SkillConfigItem,
  SkillRegistryEntry,
  TurnToolOutput,
  WorkspaceFile,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
} from "@tsian/contracts"
import type {
  RuntimeTraceDebugLabel,
  RuntimeTraceEmitter,
} from "./trace"
import type { WorkspaceOperationMutationAdapter } from "./workspace-operations"

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
   * Optional timeout quota in ms for this delegated agent call (design
   * 06-20-agent-task-compression). When elapsed, the delegated tool loop aborts
   * and the call resolves as AGENT_CALL_FAILED with `{ timeout: true }` details.
   * Defaults to DEFAULT_TASK_TIMEOUT_MS (300s) when omitted. Only meaningful for
   * task-mode delegated agents (all delegated agents are task-mode).
   */
  timeoutMs?: number
}

export type RuntimeAgentCallRunner = (
  input: RuntimeAgentCallArguments,
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

export interface InspectFrontendInput {
  /** 驱动回合（烧 token，语义化原语，非任意 bridgeCall） */
  send?: { message: string }
  /** DOM 交互（same-origin contentDocument.querySelector + dispatchEvent） */
  actions?: InspectDomAction[]
  /** 每个 action 之间采一次结构层快照 */
  observeBetween?: boolean
  /** 操作后拉最新 snapshot（语义化原语） */
  refresh?: boolean
  /** 观测点，默认 bridge-ready */
  wait?: "bridge-ready" | "turn-completed"
  /** auto-waiting：每个 action 前等元素可操作，默认 true */
  autoWait?: boolean
  /** 预留，初版只 real，传 mock 报 not-supported */
  runtime?: "real" | "mock"
  /** 预留，初版不做，传 true 报 not-supported */
  screenshot?: boolean
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

export interface InspectFrontendTimelineEntry {
  t: number
  event: "turn-delta" | "turn-tool" | "turn-round-end" | "turn-completed"
  payload: unknown
}

export interface InspectFrontendActionSnapshot {
  step: number
  action: InspectDomAction
  after: { domSummary: string; bridgeState: string }
}

export interface InspectFrontendResult {
  ok: boolean
  cardId: string
  entry: string
  structure: InspectFrontendStructure
  diagnostics: InspectFrontendDiagnostics
  timeline?: InspectFrontendTimelineEntry[]
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
}

export interface RuntimeBrowserScriptExecutorRequest {
  skillName: string
  skillPath: string
  actionName: string
  scriptPath: string
  input: Record<string, unknown>
  timeoutMs: number
  /**
   * Config items declared by the skill's `skill.config` (carried from the
   * `SkillRegistryEntry`). The browser-script executor merges these defaults
   * with player-saved overrides and injects the result as `tsian.config`.
   * Absent when the skill declares no config.
   */
  configItems?: SkillConfigItem[]
}

export type RuntimeBrowserScriptRunner = (
  request: RuntimeBrowserScriptExecutorRequest,
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
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  runBrowserScript?: RuntimeBrowserScriptRunner
  signal?: AbortSignal
}

export interface RuntimeLoadedSkill {
  skill: SkillRegistryEntry
  actions: RuntimeSkillActionDeclaration[]
}

export interface RuntimeWorkspaceToolSessionState {
  loadedSkills: RuntimeLoadedSkill[]
  /**
   * Skill paths whose full SKILL.md has already been injected as a context
   * message in the current tool loop. Prevents re-injecting the same skill
   * when use_skill is called repeatedly (registerLoadedSkill upserts by path).
   */
  injectedSkillPaths: string[]
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
  runBrowserScript?: RuntimeBrowserScriptRunner
  actionExecutorPolicy?: RuntimeActionExecutorPolicy
  workspaceMutations?: WorkspaceOperationMutationAdapter
  exposedWorkspaceOperations?: Iterable<WorkspaceOperationName>
  /** semantic_search 专用:owner id(save-runtime 下为 saveId). */
  semanticSearchOwnerId?: string
  signal?: AbortSignal
  debugLabel?: RuntimeTraceDebugLabel
  emitTrace?: RuntimeTraceEmitter
  /**
   * Tool process event callback (子2b R2). Invoked before/after each tool
   * executes with the tool's callId, name, status, and (for success/failed) a
   * truncated output summary. `undefined` disables events (delegated agents,
   * text-protocol entry path). Signature excludes turn/round — the caller binds
   * round before threading it in, and turn is bound at the platform-host layer.
   */
  onTool?: (
    callId: string,
    name: string,
    status: "loading" | "running" | "success" | "failed",
    output?: TurnToolOutput,
  ) => void
  /**
   * ask_user 工具回调（ask_user R3）。工具执行时 await 此回调，阻塞 turn 等待
   * 玩家回答。host 侧绑定为 emitInteractionRequest，返回 Promise 在玩家回答后 resolve。
   * `undefined` 时 ask_user 返回 ASK_USER_UNAVAILABLE 错误。
   */
  onAskUser?: (requestId: string, request: AskUserRequest) => Promise<AskUserResult>
}
