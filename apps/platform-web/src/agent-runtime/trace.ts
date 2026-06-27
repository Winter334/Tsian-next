import type { JsonValue } from "@tsian/contracts"

export type RuntimeTraceEventType =
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "agent_step_started"
  | "agent_step_completed"
  | "agent_step_failed"
  | "model_call_completed"
  | "skill_loaded"
  | "agent_called"
  | "workspace_tool_called"
  | "action_executor_policy_checked"
  | "action_called"
  | "agent_context_staged"
  | "context_compressed"
  | "context_compressed_in_turn"
  | "context_compression_failed"
  | "script_log"
  | "workspace_mutation"

export type RuntimeTraceDebugLabel = "entry-agent" | `agent:${string}`

export interface RuntimeTraceEvent {
  type: RuntimeTraceEventType
  timestamp: number
  turn: number
  agentId?: string
  debugLabel?: RuntimeTraceDebugLabel
  ok?: boolean
  data?: Record<string, JsonValue>
}

export type RuntimeTraceEventInput =
  Omit<RuntimeTraceEvent, "timestamp" | "turn" | "data"> & {
    data?: Record<string, unknown>
  }

export type RuntimeTraceEmitter = (event: RuntimeTraceEventInput) => void

export interface RuntimeTraceCollector {
  readonly events: RuntimeTraceEvent[]
  emit: RuntimeTraceEmitter
}

const TRACE_PREVIEW_LIMIT = 120

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function valueKind(value: unknown): string {
  if (Array.isArray(value)) return "array"
  if (value === null) return "null"
  return typeof value
}

function toJsonValue(value: unknown, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return null
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return value.map((item) => toJsonValue(item, seen))
  }

  if (isRecord(value)) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, toJsonValue(entry, seen)]),
    )
  }

  return String(value)
}

function stringifyJsonValue(value: JsonValue): string {
  try {
    return JSON.stringify(value)
  } catch {
    return "null"
  }
}

export function summarizeTraceValue(value: unknown): Record<string, JsonValue> {
  const jsonValue = toJsonValue(value)
  const json = stringifyJsonValue(jsonValue)
  const summary: Record<string, JsonValue> = {
    type: valueKind(value),
    jsonLength: json.length,
  }

  if (isRecord(value)) {
    summary.keys = Object.keys(value).sort()
  } else if (Array.isArray(value)) {
    summary.length = value.length
  } else if (typeof value === "string") {
    summary.stringLength = value.length
    summary.preview = value.slice(0, TRACE_PREVIEW_LIMIT)
  }

  return summary
}

export function errorToTraceData(error: unknown): Record<string, JsonValue> {
  if (isRecord(error)) {
    return {
      code: typeof error.code === "string" ? error.code : "ERROR",
      message: typeof error.message === "string" ? error.message : "Unknown error.",
      ...(error.details === undefined ? {} : { details: toJsonValue(error.details) }),
    }
  }

  return {
    code: error instanceof DOMException ? error.name : "ERROR",
    message: error instanceof Error ? error.message : String(error),
  }
}

/** errorToTraceData + 截断 errorStack（trace 失败事件诊断用）。
 *  trace 只记元数据：message/code + 截断 stack，不记业务内容。 */
export function errorToTraceDataWithStack(error: unknown): Record<string, JsonValue> {
  const data = errorToTraceData(error)
  if (error instanceof Error && error.stack) {
    data.errorStack = truncateTraceText(error.stack, TRACE_ERROR_STACK_LIMIT)
  }
  return data
}

export function createRuntimeTraceCollector(turn: number): RuntimeTraceCollector {
  const events: RuntimeTraceEvent[] = []
  return {
    events,
    emit(event) {
      const { data, ...eventFields } = event
      events.push({
        ...eventFields,
        turn,
        timestamp: Date.now(),
        ...(data ? { data: toJsonValue(data) as Record<string, JsonValue> } : {}),
      })
    },
  }
}

export function serializeRuntimeTraceEvents(events: RuntimeTraceEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n") + "\n"
}

export function formatRuntimeTracePath(turn: number, failedAt?: number): string {
  const paddedTurn = String(Math.max(0, Math.floor(turn))).padStart(6, "0")
  const suffix = failedAt === undefined ? "" : `-failed-${failedAt}`
  return `.tsian/save/traces/turns/turn-${paddedTurn}${suffix}.jsonl`
}

// ─── 人类可读渲染（开发者诊断用）────────────────────────────────────────────
// trace 只记元数据；本渲染层把 JSONL 事件拍平为 logfmt/rust-tracing 风格的文本，
// 供 DebugView"运行日志"浏览器显示。纯函数、无副作用、可单测。
// 存储格式（JSONL）不动；这是渲染层，不改 trace 采集。

/** errorStack 截断上限。trace 不记业务内容片段，故无 output/result preview 常量。 */
export const TRACE_ERROR_STACK_LIMIT = 1000

const TRACE_TYPE_COLUMN_WIDTH = 24

/** 截断 helper：超长截断 + `…`，供 errorStack 等长字段用。 */
export function truncateTraceText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function padType(type: string): string {
  return type.length >= TRACE_TYPE_COLUMN_WIDTH
    ? type
    : type.padEnd(TRACE_TYPE_COLUMN_WIDTH)
}

function formatOffsetMs(deltaMs: number): string {
  const totalMs = Math.max(0, Math.floor(deltaMs))
  const minutes = Math.floor(totalMs / 60000)
  const seconds = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  const mm = String(minutes).padStart(2, "0")
  const ss = String(seconds).padStart(2, "0")
  const mmm = String(ms).padStart(3, "0")
  return `${mm}:${ss}.${mmm}`
}

// data key → 渲染友好名映射。未知 key 原样输出（开发者能认）。
// 嵌套对象拍平为 key.sub=val；数组用 length，元素对象列 name+argsKeys。
const FRIENDLY_KEY_MAP: Record<string, string> = {
  outputLength: "out",
  messageCount: "msg",
  replyLength: "reply",
  historyCount: "hist",
  userInputLength: "in",
  toolCallCount: "tools",
  hasToolCalls: "hasTools",
  finishReason: "finish",
  durationMs: "dur",
  startedAt: "startedAt",
  round: "round",
  totalMatches: "matches",
  resultCount: "results",
  beforeTokens: "before",
  afterTokens: "after",
  ratio: "ratio",
  budget: "budget",
  triggerThreshold: "thresh",
  mode: "mode",
  delegated: "delegated",
  agentTitle: "agentTitle",
  targetAgentTitle: "target",
  storyOptions: "options",
  deletedCount: "deleted",
  actionCount: "actions",
  declarationErrorCount: "declErrors",
}

function friendlyKey(key: string): string {
  return FRIENDLY_KEY_MAP[key] ?? key
}

function formatScalar(value: JsonValue): string {
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (value === null) return "null"
  return JSON.stringify(value)
}

function isJsonRecord(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// 把单个 data entry 拍平成 `friendlyKey=value` 片段。
// 特殊处理：usage 嵌套 → tokens_in/tokens_out/tokens_total；toolCalls 数组 →
// tools=[name1(name2),name2(arg1)]；skill/action 嵌套 → name 取出。
function flattenDataEntry(key: string, value: JsonValue, out: string[]): void {
  if (value === undefined) return

  // usage → tokens_in/out/total（最常用诊断字段，单独友好名）
  if (key === "usage" && isJsonRecord(value)) {
    const u = value
    if (typeof u.input === "number") out.push(`tokens_in=${u.input}`)
    if (typeof u.output === "number") out.push(`tokens_out=${u.output}`)
    if (typeof u.total === "number") out.push(`tokens_total=${u.total}`)
    return
  }

  // toolCalls → tools=[name1(keys:k1,k2),name2(keys:k1)]
  if (key === "toolCalls" && Array.isArray(value)) {
    const parts = value.map((tc) => {
      if (!isJsonRecord(tc)) return formatScalar(tc)
      const name = typeof tc.name === "string" ? tc.name : "?"
      const argsKeys = Array.isArray(tc.argsKeys)
        ? tc.argsKeys.filter((k): k is string => typeof k === "string").join(",")
        : ""
      return argsKeys ? `${name}(${argsKeys})` : name
    })
    if (parts.length > 0) out.push(`tools=[${parts.join(",")}]`)
    return
  }

  // skill/action/file/error 嵌套对象 → 取 name/path/message 等子键拍平
  if (isJsonRecord(value)) {
    // 已知嵌套：skill{name,path,scope,...} action{name,...} file{path,...} error{code,message,...}
    // 取最有诊断价值的子键，其余忽略（避免噪声）
    if (key === "skill" || key === "action") {
      const name = typeof value.name === "string" ? value.name : undefined
      if (name) {
        out.push(`${friendlyKey(key)}=${name}`)
        return
      }
    }
    if (key === "file" && typeof value.path === "string") {
      out.push(`file=${value.path}`)
      return
    }
    // error 嵌套由 errorStack 行单独处理，data 主行不重复展开
    if (key === "error" && isJsonRecord(value)) {
      const msg = typeof value.message === "string" ? value.message : undefined
      if (msg) out.push(`error="${msg}"`)
      return
    }
    // 其他嵌套对象 → JSON 紧凑（兜底，少见）
    out.push(`${friendlyKey(key)}=${JSON.stringify(value)}`)
    return
  }

  if (Array.isArray(value)) {
    // deletedPaths 等字符串数组 → path1,path2
    if (value.every((v) => typeof v === "string")) {
      out.push(`${friendlyKey(key)}=${value.join(",")}`)
      return
    }
    out.push(`${friendlyKey(key)}=[${value.length}]`)
    return
  }

  // 字符串值含空格/特殊字符 → 加引号
  const formatted = formatScalar(value)
  if (typeof value === "string" && /[\s="']/.test(formatted)) {
    out.push(`${friendlyKey(key)}="${formatted}"`)
  } else {
    out.push(`${friendlyKey(key)}=${formatted}`)
  }
}

function flattenData(data: Record<string, JsonValue> | undefined): string {
  if (!data) return ""
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    // errorStack 单独成行，不进主 data 行
    if (key === "errorStack") continue
    flattenDataEntry(key, value, parts)
  }
  return parts.join(" ")
}

/**
 * 渲染单个 trace 事件为人类可读行（+ 可选 errorStack 缩进行）。
 * baseTimestamp 省略时用事件自身 timestamp（偏移 00:00.000）。
 */
export function formatTraceEventForHuman(
  event: RuntimeTraceEvent,
  baseTimestamp?: number,
): string {
  const base = baseTimestamp ?? event.timestamp
  const offset = formatOffsetMs(event.timestamp - base)
  const prefix = `[turn ${event.turn}]`
  const typeCol = padType(event.type)

  const agentPart = event.debugLabel ?? event.agentId ?? ""
  const okPart = event.ok === false ? "FAIL" : event.ok === true ? "ok" : ""

  const dataPart = flattenData(event.data)
  const head = [
    prefix,
    offset,
    typeCol,
    agentPart,
    okPart,
    dataPart,
  ].filter((s) => s !== "").join("  ")

  // errorStack 缩进行（`└`），多行 stack 各加 `└` 前缀
  const stack = event.data?.errorStack
  if (typeof stack === "string" && stack.length > 0) {
    const stackLines = stack.split(/\r?\n/).map((line) => `  └ ${line}`)
    return `${head}\n${stackLines.join("\n")}`
  }

  return head
}

/**
 * 渲染整批 trace 事件为人类可读事件流。按 timestamp 升序，首事件为时间基准。
 */
export function formatTraceForHuman(events: RuntimeTraceEvent[]): string {
  if (events.length === 0) return ""
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  const base = sorted[0].timestamp
  return sorted.map((event) => formatTraceEventForHuman(event, base)).join("\n")
}
