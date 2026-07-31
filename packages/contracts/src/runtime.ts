import type { CreateCheckpointOptions, OverwriteCheckpointOptions } from "./debug"

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
  /** assistant 消息的原始工具调用记录(仅助手填). UI/debug 层使用:
   *  刷新/重进会话后可回看工具调用参数与 observation；不作为 agent
   *  model context 的跨 turn 回放来源。模型可见的 task 工具历史使用
   *  AgentContextSnapshot.toolMemories 的受预算投影。 */
  toolCalls?: AgentContextToolCall[]
  /** assistant 消息的过程节点 timeline(thought/tool/interim,按发生顺序). UI 层用:
   *  刷新/重进会话后重建 timeline 历史节点(保留穿插顺序).与 toolCalls 分离——
   *  toolCalls/timeline 服务 UI 与 debug 回溯,不压缩完整保留。 */
  timeline?: TurnTimelineItem[]
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

/** 单个 turn 的 token 消耗统计，供前端在正文末尾显示 meta 行。
 *  耗时由前端自己计时（setInterval），不在此结构中——本结构只承载
 *  前端无法自行获取的 provider token usage。所有字段可选。
 *  定义在 runtime.ts(base 模块,无循环依赖),bridge.ts re-export 保持现有 import 路径。 */
export interface TurnStats {
  /** provider 报告的 input tokens（最后一轮，代表完整上下文大小）。 */
  inputTokens?: number
  /** provider 报告的 output tokens。 */
  outputTokens?: number
  /** provider 报告的 total tokens（input + output 或 provider 直接给）。 */
  totalTokens?: number
}

export interface AssistantTurnTimelineItem {
  kind: "assistant"
  /** Clean assistant text used for future LLM-visible history/context. */
  content: string
  /** Optional frontend display lane. When absent, display falls back to content. */
  displayContent?: string
  /** Frontend/card-defined structured projections. Platform keeps this generic. */
  projections?: Record<string, JsonValue>
  stats?: TurnStats
}

/** turn 内 timeline 项,按真实发生顺序排列.单一有序数组替代旧的
 *  messages + processNodes 分裂结构——processNodes 永远是一整块,无法表达
 *  interim→thought→tool→…→assistant 的穿插顺序.timeline 数组顺序即发生顺序,
 *  渲染器逐项渲染即可,不需要理解 round 语义.
 *
 *  持久化到 workspace turn 文件 `save/history/turns/turn-NNNNNN.json` 的
 *  `timeline` 字段(schema v2),以及助手会话消息存储的 `ConversationMessageRecord.timeline`
 *  字段(assistant 会话存储的 timeline 只含 process items,不含 user/assistant/options,
 *  因为消息本身即 user/assistant).
 *
 *  - user:      玩家输入正文.
 *  - assistant: AI 最终回复正文,带可选 stats(token 消耗).
 *  - thought:   tool_calls 轮的推理思维链,默认折叠.
 *  - tool:      工具调用节点,按 callId 去重,output 带 agent_call 结构化分支.
 *  - interim:   tool_calls 轮模型在调用工具前输出的过渡文本(如"我先看一下…"),
 *               当正常可见回复处理,始终展开.
 *  - options:   legacy 剧情选项项。旧 turn 可包含 host 早期从 [[选项]] 块提取的选项；
 *               新 turn 不应由 platform-host 生成该项，默认前端可自行解析正文约定。
 *
 *  ask 节点(ask_user 交互)不入 TurnTimelineItem——仅存在于内存
 *  AssistantTimelineNode,持久化边界拍平成 interim 文本.
 *
 *  与 composable 层的 AssistantTimelineNode 关系:AssistantTimelineNode 有 ask 变体
 *  (内存专用),TurnTimelineItem 有 user/assistant/options 变体(持久化专用).
 *  mapper 边界双向转换(ask → interim 拍平). */
export type TurnTimelineItem =
  | { kind: "user"; content: string; attachments?: AttachmentRef[] }
  | AssistantTurnTimelineItem
  | { kind: "interim"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }
  | { kind: "thought"; id: string; round: number; agentId?: string; text: string; collapsed: boolean }
  | {
      kind: "tool"
      id: string
      round: number
      agentId?: string
      name: string
      status: "loading" | "running" | "success" | "failed"
      output?: TurnToolOutput
      collapsed: boolean
    }
  | { kind: "options"; items: string[] }

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
  /** 调用参数(JSON 序列化字符串). UI/debug 展示用. */
  arguments: string
  /** 工具返回 observation(文本化). 直接存工具返回层结果,持久化层不截断. */
  observation: string
  /** observation 是否被截断. 来自工具返回层(如 workspace_read 的 truncated). */
  truncated?: boolean
  /** 失败时填(observation 放 error.message). */
  failed?: boolean
}

export type AgentContextToolMemoryVisibility = "summary" | "placeholder"
export type AgentContextToolMemoryStatus = "success" | "failed"

/**
 * Model-facing task-mode tool memory. This is a bounded deterministic
 * projection of a raw tool call, not the raw UI/debug observation. It is stored
 * at AgentContextSnapshot.toolMemories so dialogue recentTurns remain text-only.
 */
export interface AgentContextToolMemory {
  /** Stable id for this model-facing memory part. */
  id: string
  /** Raw tool call id for UI/debug correlation; not a model raw-log handle. */
  sourceToolCallId: string
  /** Assistant turn number that produced this memory. */
  turn: number
  /** Tool-loop round if known. */
  round?: number
  /** Tool name such as read / agent_call / inspect_frontend. */
  toolName: string
  status: AgentContextToolMemoryStatus
  /** summary = bounded summaryText visible; placeholder = action trace only. */
  visibility: AgentContextToolMemoryVisibility
  /** Short model-facing title, e.g. "read apps/foo.ts". */
  title: string
  /** Bounded model-facing summary or placeholder line. */
  summaryText: string
  /** File/resource anchors extracted from args/result. */
  anchors?: string[]
  /** Bounded argument summary; avoid full JSON for large args. */
  argsSummary?: string
  /** Coarse estimate used for deterministic budget decisions. */
  tokenEstimate?: number
}

/**
 * One剧情正文 entry inside an `AgentContextSnapshot.recentTurns` list.
 * Stored as原文 (user input or assistant final reply); tool process / thought
 * streams are intentionally excluded so压缩摘要 stays pure剧情/对话.
 * Task-mode 工具行动痕迹独立存到 snapshot.toolMemories。
 */
export interface AgentContextTurnEntry {
  turn: number
  role: "user" | "assistant"
  content: string
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
  /** 最近 K=5 轮正文(user+assistant 对,带 turn 索引,原文).按 turn 升序；不含工具原文. */
  recentTurns: AgentContextTurnEntry[]
  /** task 模式 model-facing 工具记忆投影；raw/UI 工具记录仍在 ConversationMessageRecord.toolCalls. */
  toolMemories?: AgentContextToolMemory[]
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
  /** Read-view capability metadata. It is not part of persisted file records. */
  readOnly?: boolean
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
  /** Read-view capability metadata. It is not part of persisted file records. */
  readOnly?: boolean
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
  | "copy"
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
  /** diff: proposed next text content. The Agent-facing diff schema names this
   *  field `expectedContent`; `content` remains a compatibility input for
   *  internal/browser-script callers. write: optimistic-concurrency guard. */
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
  fromScope: WorkspaceScope
  toScope: WorkspaceScope
  fromPath: string
  toPath: string
  movedPaths: string[]
}

export interface WorkspaceCopyResult {
  fromScope: WorkspaceScope
  toScope: WorkspaceScope
  fromPath: string
  toPath: string
  copiedPaths: string[]
}

export interface WorkspaceDeleteResult {
  scope: WorkspaceScope
  deletedPaths: string[]
}

/**
 * 路由点传给 volume dispatch 的 owner 解析上下文。card-scope volume 需要 cardId；
 * save-scope / save-platform-meta volume 需要 saveId；local-assistant volume 忽略
 * ownerId（全局 meta，跨 save 持久）；temp volume 需要 sessionId。
 *
 * 跨层契约：agent-runtime 的 mutation adapter input 带此类型（runtime 层不填，
 * 由 host adapter 闭包按 input.scope 填充），volume 层 `executeWorkspaceMutation` 消费。
 */
export interface WorkspaceVolumeOwnerContext {
  cardId?: string
  saveId?: string
  /** 助手会话 id,用于 temp scope(附件 volume). */
  sessionId?: string
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
  | "test_skill_script"

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

/**
 * 注入在消息序列中的位置。控制 contextPath 条目编译后注入到消息骨架的哪个区段。
 *
 * - `"prelude"`：system prompt 之后、history 之前。背景层——适合长期稳定、很少变化的
 *   规则、参考资料和衔接内容。跨轮命中前缀缓存。
 * - `"runtime"`（默认）：history 之后、turn-runtime 之前。状态层——适合每轮可能变化的
 *   状态文件（runtime.json、frontier.json、记忆文件等）。
 * - `"framing"`：玩家输入之后、消息序列末尾。框架层——适合输出格式、思考框架和续写引导。
 *
 * 不写 position 的条目默认 `"runtime"`。
 */
export type ContextPathPosition =
  | "prelude"
  | "runtime"
  | "framing"

/** contextPath 条目对象形式：支持指定注入角色、内联模板与消息序列位置。path 与 template 互斥。 */
export interface ContextPathObject {
  /** workspace 文件路径。与 template 互斥。 */
  path?: string
  /** 内联模板字符串（非文件路径）。与 path 互斥。 */
  template?: string
  /** 注入消息角色。默认 "user"。 */
  role?: "system" | "user" | "assistant"
  /** 注入在消息序列中的位置。默认 "runtime"。 */
  position?: ContextPathPosition
}

/** contextPath 条目：纯字符串（向后兼容）或对象形式（支持 role/template）。 */
export type ContextPathEntry = string | ContextPathObject

/** 编译后的注入条目（宏已展开）。携带 role、最终内容与消息序列位置，供消息构建层消费。 */
export interface ContextInjection {
  role: "system" | "user" | "assistant"
  content: string
  /** 来源描述（用于 meta 信息显示，如文件路径或 "inline template"）。 */
  source: string
  /** 注入在消息序列中的位置。编译时从 contextPath 条目携带，默认 "runtime"。 */
  position: ContextPathPosition
}

/** 单个固定注入层的 role 配置。 */
export interface MessageLayerConfig {
  /** 注入消息角色。不写则保持该层默认 role。 */
  role?: "system" | "user" | "assistant"
}

/** 固定注入层 role 配置。所有字段可选，不写 = 该层保持默认 role。
 *  systemPrompt 层不在配置范围内（固定 system）。
 *  不支持禁用层——所有层始终注入。 */
export interface MessageLayersConfig {
  /** 早期剧情/任务摘要。默认 role: user */
  historySummary?: MessageLayerConfig
  /** Agent 上下文元信息（Skill Index 等）。默认 role: user */
  contextMeta?: MessageLayerConfig
  /** 工具记忆日志（task-mode 助手）。默认 role: user */
  toolMemory?: MessageLayerConfig
  /** 当前回合号。默认 role: user */
  turnRuntime?: MessageLayerConfig
}

export interface AgentConfig {
  id: string
  title: string
  summary: string
  contacts: string[]
  /** workspace 注入条目列表。纯字符串向后兼容；对象形式支持 role/template 与宏展开。 */
  contextPaths: ContextPathEntry[]
  /** 启用的规则模块名列表（文件名 stem）。用于 {{file:...?enabled}} 条件检查。
   *  未提供时 ?enabled 条件默认为"包含"（向后兼容）。 */
  enabledModules?: string[]
  skills: AgentSkillConfig
  /**
   * Agent-scoped Tool whitelist/blacklist. Empty `enabled` means "no user
   * tools exposed by default" — enabling is explicit per agent. Agent-local
   * tools (under `agents/<agentId>/tools/`) are always available to their
   * owning agent regardless of `enabled`.
   */
  tools?: AgentToolConfig
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
  /** System-level agent marker. `true` for master and assistant — these are
   * platform-essential agents. The field is informational: it tells the
   * assistant agent (via workspace_read) that these agents should not be
   * renamed or deleted. The Studio agent panel has no delete/rename UI, so
   * no hard UI interception is needed; the field is ready for future agent
   * management UIs.
   */
  system?: boolean
  /** 固定注入层的 role 配置。可选，不写则全部默认。 */
  messageLayers?: MessageLayersConfig
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
  /** Explicit user-tool whitelist parsed from `agent.json.tools.enabled`. */
  enabledTools: string[]
  /** Explicit user-tool blacklist parsed from `agent.json.tools.disabled`. */
  disabledTools: string[]
  platformTools: AgentPlatformToolConfig
  workspaceAccess: AgentWorkspaceAccessConfig
  contextPaths: ContextPathEntry[]
  /** 启用的规则模块名列表（解析后，默认空数组）。用于 {{file:...?enabled}} 条件检查。 */
  enabledModules: string[]
  /** Raw agent.json 是否显式声明 enabledModules；未声明时 ?enabled 宏保持 include-all 兼容语义。 */
  enabledModulesConfigured: boolean
  knowledgeMount?: string
  providerPresetId?: string
  /** Entry mode resolved from agent.json; defaults to `"persistent"`. */
  entryMode: "persistent" | "ephemeral"
  /** System-level agent marker resolved from agent.json; defaults to `false`. */
  system: boolean
  /** 解析后的固定层 role 配置。空对象 = 全部默认。 */
  messageLayers: MessageLayersConfig
  updatedAt: number
}

export interface AgentContextEntry {
  agent: AgentRegistryEntry
  agentFile: WorkspaceFile
  soulFile?: WorkspaceFile
  notesFile?: WorkspaceFile
  skillIndex: SkillRegistryEntry[]
  /** Tools visible to this Agent after `tools.enabled/disabled` filtering. */
  toolIndex: ToolRegistryEntry[]
  /** 编译后的注入条目按 position 分组。消息构建层按骨架顺序从各组取注入。
   *  3 个数组始终存在（即使为空），便于消费侧无需判空。 */
  contextInjectionsByPosition: Record<ContextPathPosition, ContextInjection[]>
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

/**
 * Agent Tool layer (parallel to Skill layer, MCP-like).
 *
 * A Tool is an atomic callable capability declared by a `tool.json` manifest
 * plus a sibling `browser_script`. Tools are exposed directly to the Agent's
 * native function calling schemas — no `use_skill` activation required. See
 * `.trellis/spec/*` for the Tool vs Skill boundary.
 *
 * Path layout (mirrors the Skill layer):
 *   - Shared:      `tools/<id>/tool.json`
 *   - Agent-local: `agents/<agentId>/tools/<id>/tool.json`
 *   - User-local:  `.tsian/local/<agentId>/tools/<id>/tool.json`
 */
export interface AgentToolConfig {
  enabled: string[]
  disabled: string[]
}

export type ToolRegistryScope = "shared" | "agent-local"

/**
 * A single Tool registry entry. `name` is the wire name used by the Agent's
 * native function-calling schema (English snake_case). `title`/`description`
 * are Chinese-native and shown to users in Studio. `parameters` is a
 * JSON-Schema-shaped object suitable for direct injection into the model's
 * function schema.
 */
export interface ToolRegistryEntry {
  /** Registry id derived from the directory name (e.g. `roll_dice`). */
  id: string
  /** Wire name used by native function-calling. Equal to `id` today. */
  name: string
  /** Chinese-native short title shown in Studio. */
  title: string
  /** Chinese-native description that also becomes the function schema `description`. */
  description: string
  /** Absolute workspace path to the `tool.json` manifest. */
  path: string
  /** Absolute workspace path to the tool's directory (script root). */
  directoryPath: string
  scope: ToolRegistryScope
  /** Owning agent id when `scope === "agent-local"`. */
  agentId?: string
  /** JSON-Schema-shaped parameters block. */
  parameters: Record<string, unknown>
  /** Executor reference (only `browser_script` supported today). */
  executor: {
    type: string
    /** Script path relative to `directoryPath` (e.g. `run.js`). */
    path: string
    /** Optional per-tool timeout override. */
    timeoutMs?: number
    /** Optional helper script paths (relative to `directoryPath`). */
    helpers?: string[]
  }
  updatedAt: number
}

/**
 * A single registry diagnostic emitted by tool/skill discovery. Diagnostics
 * are shown in Studio's registry-health panel and never abort registry build.
 */
export interface RegistryDiagnostic {
  level: "error" | "warn" | "info"
  /** Stable machine code (e.g. `TOOL_MANIFEST_INVALID_JSON`). */
  code: string
  /** Human-readable Chinese-native message. */
  message: string
  /** Optional workspace path that triggered the diagnostic. */
  path?: string
  /** Optional fix hint shown alongside the message. */
  hint?: string
}

export interface WorkspaceListResult {
  path: string
  entries: WorkspaceEntry[]
  /** Whether the listed directory rejects mutations. */
  readOnly?: boolean
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
  /** Read-view capability metadata. It is not part of persisted file records. */
  readOnly?: boolean
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

/** 前端注入的上下文消息：独立于玩家输入，由前端决定 role/content/position。
 *  平台只负责按 role + position 放进 agent 上下文消息序列，不解释语义、不落盘。
 *  - position "before-input"（默认）：插在玩家本轮输入之前
 *  - position "after-input"：插在玩家本轮输入之后 */
export interface InjectionMessage {
  role: "system" | "user" | "assistant"
  content: string
  position?: "before-input" | "after-input"
}

export interface MessageInteractionRequest {
  content: string
  /** 前端注入的上下文消息（本轮有效，不落盘）。 */
  injection?: InjectionMessage[]
}

export interface MessageInteractionResult {
  /** The formal player-turn number committed by the platform. */
  turn: number
  /** The projected assistant item committed to the turn timeline. */
  assistant: AssistantTurnTimelineItem
}

/** invokeAgent workspace commit strategy.
 *  - "workspace" (default): commit save-runtime workspace changes without creating a checkpoint.
 *  - "workspace-with-checkpoint": deprecated compatibility alias for
 *    `checkpoint: { mode: "current-turn-auto" }` when no explicit checkpoint option is supplied. */
export type AgentInvocationCommitMode = "workspace" | "workspace-with-checkpoint"

export type InvokeAgentCheckpointOption =
  | boolean
  | ({ mode?: "create" } & CreateCheckpointOptions)
  | ({ mode: "overwrite"; checkpointId: string } & OverwriteCheckpointOptions)
  | {
      mode: "current-turn-auto"
      label?: string
      tags?: string[]
      metadata?: Record<string, JsonValue>
    }

/** invokeAgent 请求：游戏前端按 agentId 直接调用某个 agent（NPC 视角、
 *  UI 触发的单次修正等）。与 sendMessage 不同：不推进 turn、不写历史、
 *  不更新 runtimeSnapshot——结果直接返回调用方；过程事件通过 invocationId 关联。 */
export interface InvokeAgentRequest {
  agentId: string
  input: string
  /** invocation 级唯一 id。调用方可传入以便在 Promise resolve 前过滤流式事件；
   *  省略时 SDK/平台会生成。 */
  invocationId?: string
  /** 调用目的标签（如 post-turn-maintenance / setup），仅用于前端过滤、日志和调试。 */
  purpose?: string
  /** Checkpoint operation to run after the workspace commit succeeds. */
  checkpoint?: InvokeAgentCheckpointOption
  /** @deprecated Use `checkpoint` instead. `workspace-with-checkpoint` maps to current-turn-auto. */
  commitMode?: AgentInvocationCommitMode
  /** @deprecated Compatibility data for legacy workspace-with-checkpoint callers. */
  checkpointReason?: string
  /** 前端注入的上下文消息（本轮有效，不落盘）。 */
  injection?: InjectionMessage[]
  /** 上下文隔离 slot。不同 slot 读写不同 context-<slot>.json，防止不同调用方上下文串。
   *  省略时用默认路径 save/agents/<agentId>/context.json（向后兼容）。 */
  contextSlot?: string
  /** 是否持久化上下文。true = 读写 context-slot.json（跨调用持久化）；
   *  false/省略 = 不读不写（一次性调用）。默认 false。 */
  persist?: boolean
}

/** invokeAgent 返回：agent 的回复文本。不含 snapshot（不进运行时状态）。 */
export interface InvokeAgentResult {
  invocationId: string
  response: string
}

/** invokeAgent 的 invocation 级过程事件。agentId 表示实际产出事件的 agent；
 *  delegated agent_call 的事件使用同一 invocationId、各自的 agentId。 */
export type AgentInvocationEvent =
  | {
      type: "started"
      invocationId: string
      agentId: string
      purpose?: string
    }
  | {
      type: "delta"
      invocationId: string
      agentId: string
      round: number
      kind: "reasoning" | "content"
      delta: string
    }
  | {
      type: "round-end"
      invocationId: string
      agentId: string
      round: number
      kind: "thought" | "final"
    }
  | {
      type: "tool"
      invocationId: string
      agentId: string
      round: number
      callId: string
      name: string
      status: "loading" | "running" | "success" | "failed"
      output?: TurnToolOutput
    }
  | {
      type: "completed"
      invocationId: string
      agentId: string
    }
  | {
      type: "failed"
      invocationId: string
      agentId: string
      error: PlatformActionError
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
