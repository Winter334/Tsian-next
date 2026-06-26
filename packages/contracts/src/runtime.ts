/** 多模态消息内容的一个组成部分. 图片走多模态 content block,
 *  文本仍用 plain string (向后兼容). */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }

/** 附件引用元数据. Blob 本体存在 Dexie assistantAttachments 表,
 *  这里只存路径引用 + 展示用元数据. */
export interface AttachmentRef {
  /** VFS 路径,形如 "temp/<sessionId>/<filename>". */
  path: string
  /** 原始文件名. */
  name: string
  /** MIME 类型. */
  mimeType: string
  /** 文件大小(字节). */
  size: number
  /** 附件种类: image 走多模态, text 走文本注入. */
  kind: "image" | "text"
}

export interface ConversationMessageRecord {
  role: string
  content: string
  /** 附件元数据列表. 不持久化 Blob 本体(Blob 存 Dexie 表);
   *  这里只存引用路径,加载时按路径从附件表取回 Blob. */
  attachments?: AttachmentRef[]
  /** assistant 消息的工具调用记录(仅助手填). agent 层用:context.json rebuild
   *  还原为 tool_call + tool_result message.UI 层挂消息上不占条数名额,
   *  随消息截到 MAX_STORED_MESSAGES 保留/丢弃;不压缩,完整保留. */
  toolCalls?: AgentContextToolCall[]
  /** assistant 消息的过程节点(thought/tool/interim,按发生顺序). UI 层用:
   *  刷新/重进会话后重建 timeline 历史节点(保留交错顺序).与 toolCalls 分离——
   *  toolCalls 服务 agent 上下文(需要 observation/arguments),processNodes 服务
   *  UI 显示(需要 TurnToolOutput 形态的 output).仅助手填,不压缩完整保留. */
  processNodes?: TurnProcessNode[]
}

/** 工具调用输出(喂 UI 渲染).string = 普通工具 observation;object = agent_call 结构化.
 *  定义在 runtime.ts(base 模块,无循环依赖),bridge.ts re-export 保持现有 import 路径. */
export type TurnToolOutput =
  | string
  | {
      type: "agent_call"
      targetAgent: {
        id: string
        title: string
        summary?: string
      }
      response: string
      status: "completed" | "failed"
      error?: {
        code: string
        message: string
      }
    }

/** turn 内过程节点(thought/tool/interim),按发生顺序排列.
 *  持久化到 workspace turn 文件 + 助手会话消息存储 processNodes 字段.
 *  与 composable 层 AssistantTimelineNode 同构,多可选 agentId 字段. */
export type TurnProcessNode =
  | { type: "thought"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }
  | {
      type: "tool"
      id: string
      round: number
      agentId?: string
      name: string
      status: "loading" | "running" | "success" | "failed"
      output?: TurnToolOutput
      collapsed: boolean
    }
  | { type: "interim"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }

/**
 * 单个工具调用记录(跨 turn/UI 保留的最小形态). observation 直接存工具返回层
 * 结果(持久化层不二次截断)——workspace_read 等有分页的工具返回层已截断
 * (DEFAULT_READ_LIMIT=2000 行)+ 带 truncated 元数据, agent 续读靠 offset;
 * agent_call/inspect_frontend 等无分页工具当前不截断(无分页是工具缺陷,后续补齐).
 * truncated 字段来自工具返回层(如 workspace_read),非持久化层造.
 */
export interface AgentContextToolCall {
  /** 工具调用 id(native: toolCallId; text: `tool-${index}`). UI 去重用. */
  id: string
  /** 工具名(workspace_read / agent_call / inspect_frontend …). */
  name: string
  /** 调用参数(JSON 序列化字符串). UI 展示 + 压缩 prompt 用. */
  arguments: string
  /** 工具返回 observation(文本化). 直接存工具返回层结果,持久化层不截断. */
  observation: string
  /** observation 是否被截断. 来自工具返回层(如 workspace_read 的 truncated). */
  truncated?: boolean
  /** 失败时填(observation 放 error.message). */
  failed?: boolean
}

/**
 * One剧情正文 entry inside an `AgentContextSnapshot.recentTurns` list.
 * Stored as原文 (user input or assistant final reply); tool process / thought
 * streams are intentionally excluded so压缩摘要 stays pure剧情.
 * 助手路径额外在 assistant entry 上带 toolCalls(工具调用跨 turn 保留),
 * master 不填(剧情型 agent 工具少、正文是真相).
 */
export interface AgentContextTurnEntry {
  turn: number
  role: "user" | "assistant"
  content: string
  /** 该 turn 工具调用记录(仅助手填, master 不填). agent 层跟正文同寿命:
   *  最近 K 轮原文保留, 早期随正文压缩进 summary. */
  toolCalls?: AgentContextToolCall[]
}

/**
 * agent 会话上下文快照,持久化跨 turn 稳态("1 摘要 + 最近 K 轮正文").
 * 与可见消息存档(turn 文件 `save/history/turns/`/助手会话消息)分离:这里存的是 agent 视角的
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
  /** 图片 MIME 类型,当 binary 是图片时设置. Agent runtime 据此
   *  判断文件是否为图片并构建 image ContentPart. 非图片文件省略. */
  imageMimeType?: string
  createdAt: number
  updatedAt: number
}

/** Result of `workspace.read`. Superset of `WorkspaceFile` carrying
 *  line-level slicing metadata. When `offset`/`limit` are omitted the
 *  `content` is the full file and the slice fields describe the whole file
 *  (`offset: 1`, `truncated: false`). Old consumers reading `path`/
 *  `content`/`updatedAt` are unaffected. */
export interface WorkspaceReadResult extends WorkspaceFile {
  /** Total lines in the file (`content.split("\n").length`). Always present
   *  for text files; for binary placeholders it is `1`. */
  totalLines?: number
  /** Number of lines actually returned in `content`. */
  returnedLines?: number
  /** The 1-based start line used for this slice. */
  offset?: number
  /** `true` when more lines remain beyond this slice. */
  truncated?: boolean
  /** `true` when `content` is a binary placeholder and `offset`/`limit`
   *  were not applied. Agents should not try to re-slice binary
   *  placeholders. */
  isBinaryPlaceholder?: boolean
  /** 图片 base64 数据,当文件是图片且 workspace_read 返回时设置.
   *  Agent runtime 据此 + imageMimeType 构建 image ContentPart 注入 LLM 消息.
   *  非图片文件省略. */
  imageBase64?: string
}

export type WorkspaceScope =
  | "effective"
  | "card-content"
  | "save-runtime"
  | "platform-meta"
  | "card-frontend"
  | "temp"

export type WorkspaceOperationName =
  | "list"
  | "search"
  | "read"
  | "glob"
  | "diff"
  | "write"
  | "edit"
  | "move"
  | "delete"
  | "validate"
  | "semantic_search"

export interface WorkspaceOperationRequest {
  operation: WorkspaceOperationName
  /** Workspace scope. Optional for LLM-facing tool calls: when omitted, read
   *  operations default to "effective" (union view) and edit operations infer
   *  the scope from the path prefix (save/→save-runtime, temp/→temp, …).
   *  Internal callers (SDK RPC, platform-host) always pass it explicitly. */
  scope?: WorkspaceScope
  path?: string
  targetPath?: string
  query?: string
  pattern?: string
  limit?: number
  /** Read: 1-based start line for line-level slicing. Default 1 (whole file
   *  when `limit` is also omitted). */
  offset?: number
  /** Search: context lines returned before and after each match. Default 0. */
  contextLines?: number
  /** Search: case-insensitive matching. `query` defaults to `true`
   *  (back-compat), `pattern` defaults to `false` (regex convention). */
  ignoreCase?: boolean
  /** Text content for write, or a Blob for binary writes. */
  content?: string | Blob
  /** write: optimistic-concurrency guard. When set (string), the write is
   *  rejected if the file's current content does not match — detects stale
   *  overwrites. Omit to skip the check (unconditional overwrite). */
  expectedContent?: string
  /** edit: the exact string to find. Must match exactly once unless
   *  `replaceAll` is set. Include surrounding lines for uniqueness. */
  oldString?: string
  /** edit: the replacement string. Empty string deletes the matched fragment. */
  newString?: string
  /** edit: replace every occurrence of `oldString` instead of requiring a
   *  unique match. Default false. */
  replaceAll?: boolean
  validator?: "json" | "frontmatter"
  autoFix?: boolean
  /** semantic_search: 自然语言查询. */
  semanticQuery?: string
  /** semantic_search: 语料类型过滤(turn/agent-notes/memory-summary). */
  typeFilter?: WorkspaceSemanticType
}

/** save-runtime 语义检索的语料类型,由路径派生. */
export type WorkspaceSemanticType = "turn" | "agent-notes" | "memory-summary"

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

export interface WorkspaceWriteResult {
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
  | "inspect_frontend"
  | "workspace_semantic_search"
  | "ask_user"

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
  /**
   * Entry mode: `"persistent"` (default) agents have an independent context
   * snapshot (`save/agents/<id>/context.json`) that accumulates across turns;
   * `"ephemeral"` agents have no context snapshot — each call rebuilds from
   * recentHistory and discards state after. Used by `invokeAgent` to decide
   * whether to read/write context.json.
   */
  entryMode?: "persistent" | "ephemeral"
  /**
   * System-level agent marker. `true` for master and assistant — these are
   * platform-essential agents. The field is informational: it tells the
   * assistant agent (via workspace_read) that these agents should not be
   * renamed or deleted. The Studio agent panel has no delete/rename UI, so
   * no hard UI interception is needed; the field is ready for future agent
   * management UIs.
   */
  system?: boolean
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
  /** Entry mode resolved from agent.json; defaults to `"persistent"`. */
  entryMode: "persistent" | "ephemeral"
  /** System-level agent marker resolved from agent.json; defaults to `false`. */
  system: boolean
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
 * A declared configuration item parsed from a skill's `skill.config` file
 * (`.env`-style key-value + comments). The player overrides `defaultValue`
 * through the skill config UI; overrides are stored locally and never enter
 * the workspace (secrets stay out of exported skill packages).
 */
export interface SkillConfigItem {
  /** Config key, e.g. "TAVILY_API_KEY". */
  key: string
  /** Description parsed from the `#` comment line immediately above the key. */
  description: string
  /** Default value declared in `skill.config` (always a string; scripts convert). */
  defaultValue: string
}

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
  /** Configuration items parsed from a sibling `skill.config` file. Absent when the skill declares no config. */
  configItems?: SkillConfigItem[]
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

export interface WorkspaceSearchMatch {
  /** 1-based line number of the matched line. */
  lineNumber: number
  /** Full text of the matched line (no trailing newline). */
  line: string
  /** Up to `contextLines` lines before the match (excluding the match line). */
  contextBefore: string[]
  /** Up to `contextLines` lines after the match (excluding the match line). */
  contextAfter: string[]
  /** Matched substring: the query substring (query mode) or the first regex
   *  match group 0 (pattern mode). */
  match: string
}

export interface WorkspaceSearchResult {
  path: string
  name: string
  updatedAt: number
  /** Path-match score preserved from the legacy format: 2 = path hit,
   *  0 = content-only. Content hits do not raise the score so path-matched
   *  files still sort first. */
  score: number
  /** Per-line matches inside this file. Empty when only the path matched
   *  (e.g. binary files) — the file still appears so the agent knows the
   *  name matched without content hits. */
  matches: WorkspaceSearchMatch[]
  /** `true` when matches were truncated to the per-file cap. */
  matchesTruncated: boolean
  /** Back-compat field: short preview of the first match (or `path` when
   *  there are no content matches). New consumers should read `matches`;
   *  this field may be removed in a later task. 语义模式下 preview 为 chunk
   *  原文前 96 字符. */
  preview: string
  /** semantic_search 模式回显:语料类型. 字面 search 省略. */
  semanticType?: WorkspaceSemanticType
  /** semantic_search 模式回显:turn 编号(仅 raw turn). */
  turn?: number
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

export interface MessageInteractionRequest {
  content: string
}

export interface MessageInteractionResult {
}

/** invokeAgent 请求：游戏前端按 agentId 直接调用某个 agent（NPC 视角、
 *  UI 触发的单次修正等）。与 sendMessage 不同：不推进 turn、不写历史、
 *  不更新 runtimeSnapshot——旁路调用，结果直接返回调用方。 */
export interface InvokeAgentRequest {
  agentId: string
  input: string
}

/** invokeAgent 返回：agent 的回复文本。不含 snapshot（不进运行时状态）。 */
export interface InvokeAgentResult {
  response: string
}

/** ask_user 工具请求：AI 向玩家提问。 */
export interface AskUserRequest {
  question: string
  options?: string[]
  allowCustom?: boolean
}

/** ask_user 工具结果：玩家回答。 */
export interface AskUserResult {
  answer: string
  cancelled?: boolean
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
