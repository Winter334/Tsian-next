import type { AgentContextToolMemory } from "@tsian/contracts"
import { getPlatformConfig } from "../config/platform-config"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  type RuntimeWorkspaceToolCall,
  type RuntimeWorkspaceToolObservation,
} from "./workspace-tools-types"

const DEFAULT_TEXT_PREVIEW_LIMIT = 2_000
const LARGE_FIELD_INLINE_LIMIT = 6_000
const COMPACT_RECURSION_DEPTH = 4
const LARGE_FIELD_NAMES = new Set([
  "content",
  "response",
  "output",
  "stdout",
  "stderr",
  "html",
  "diagnostics",
  "logs",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function previewText(text: string, limit = DEFAULT_TEXT_PREVIEW_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars; rerun/read a narrower slice if exact content is needed]`
}

function stableStringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    const json = JSON.stringify(value, null, 2)
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

function boundedText(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit))}\n...[truncated ${text.length - limit} chars; use workspace tools again if exact content is needed]`
}

function valueCharSize(value: unknown): number {
  if (typeof value === "string") return value.length
  return stableStringify(value).length
}

/** Recursively compacts large model-facing tool results while preserving shape and metadata. */
export function compactLargeValueForModel(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length <= LARGE_FIELD_INLINE_LIMIT) return value
    return {
      preview: previewText(value),
      charCount: value.length,
      truncatedForModel: true,
    }
  }

  if (Array.isArray(value)) {
    if (depth >= COMPACT_RECURSION_DEPTH) {
      return {
        preview: previewText(stableStringify(value)),
        itemCount: value.length,
        truncatedForModel: true,
      }
    }
    const compacted = value.slice(0, 50).map((item) => compactLargeValueForModel(item, depth + 1))
    if (value.length > compacted.length) {
      compacted.push({ omittedItems: value.length - compacted.length, truncatedForModel: true })
    }
    return compacted
  }

  if (!isRecord(value)) {
    return value
  }

  if (depth >= COMPACT_RECURSION_DEPTH) {
    return {
      preview: previewText(stableStringify(value)),
      charCount: valueCharSize(value),
      truncatedForModel: true,
    }
  }

  const compact: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") {
      if (child.length > LARGE_FIELD_INLINE_LIMIT) {
        compact[key] = previewText(child)
        compact[`${key}CharCount`] = child.length
        compact[`${key}TruncatedForModel`] = true
      } else {
        compact[key] = child
      }
      continue
    }
    if (LARGE_FIELD_NAMES.has(key) && valueCharSize(child) > LARGE_FIELD_INLINE_LIMIT) {
      compact[key] = compactLargeValueForModel(child, depth + 1)
      compact[`${key}TruncatedForModel`] = true
      continue
    }
    compact[key] = compactLargeValueForModel(child, depth + 1)
  }

  if (typeof value.offset === "number" && typeof value.returnedLines === "number") {
    compact.nextOffset = value.offset + value.returnedLines
  }
  return compact
}

function compactJsonPreview(value: unknown, limit: number): string {
  return boundedText(stableStringify(compactLargeValueForModel(value)), limit)
}

function summarizeArgs(args: Record<string, unknown>, limit = 1_000): string | undefined {
  const text = stableStringify(compactLargeValueForModel(args))
  if (!text || text === "{}") return undefined
  return boundedText(text, limit)
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function resultRecord(observation: RuntimeWorkspaceToolObservation): Record<string, unknown> {
  return isRecord(observation.result) ? observation.result : {}
}

function titleForTool(call: RuntimeWorkspaceToolCall, observation: RuntimeWorkspaceToolObservation): string {
  const args = call.arguments
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.read) {
    return `read ${stringArg(args, "path") ?? resultRecord(observation).path ?? "workspace file"}`
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.search) {
    return `search ${stringArg(args, "query") ?? stringArg(args, "pattern") ?? "workspace"}`
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.glob) {
    return `glob ${stringArg(args, "pattern") ?? "workspace"}`
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.list) {
    return `list ${stringArg(args, "path") ?? "workspace"}`
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) {
    const targetAgent = resultRecord(observation).targetAgent
    const targetTitle = isRecord(targetAgent) && typeof targetAgent.title === "string"
      ? targetAgent.title
      : stringArg(args, "agentId")
    return `agent_call ${targetTitle ?? "agent"}`
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.inspectFrontend) {
    return `inspect_frontend ${stringArg(args, "operation") ?? "inspect"}`
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.runScript) {
    const skill = stringArg(args, "skill") ?? stringArg(args, "skillName")
    const action = stringArg(args, "action") ?? stringArg(args, "actionName")
    return `run_script ${[skill, action].filter(Boolean).join("/") || "action"}`
  }
  return call.name
}

function anchorsFromArgsAndResult(args: Record<string, unknown>, observation: RuntimeWorkspaceToolObservation): string[] {
  const anchors = new Set<string>()
  const addPath = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) {
      anchors.add(value.trim())
    }
  }

  addPath(args.path)
  const paths = args.paths
  if (Array.isArray(paths)) {
    for (const path of paths) addPath(path)
  }

  const result = resultRecord(observation)
  addPath(result.path)
  if (Array.isArray(result.paths)) {
    for (const path of result.paths) addPath(path)
  }

  const offset = typeof result.offset === "number" ? result.offset : numberArg(args, "offset")
  const returnedLines = typeof result.returnedLines === "number" ? result.returnedLines : undefined
  const firstPath = Array.from(anchors)[0]
  if (firstPath && offset !== undefined && returnedLines !== undefined) {
    anchors.add(`${firstPath}:${offset}-${offset + Math.max(0, returnedLines - 1)}`)
  }

  return Array.from(anchors).slice(0, 20)
}

function summaryForTool(call: RuntimeWorkspaceToolCall, observation: RuntimeWorkspaceToolObservation, perToolLimit: number): string {
  if (!observation.ok) {
    const error = observation.error ?? { code: "UNKNOWN", message: "Unknown tool error" }
    return boundedText(`failed: ${error.code}: ${error.message}${error.details !== undefined ? `\ndetails: ${compactJsonPreview(error.details, 1_500)}` : ""}`, perToolLimit)
  }

  const result = resultRecord(observation)
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.read) {
    const path = stringArg(call.arguments, "path") ?? (typeof result.path === "string" ? result.path : undefined)
    const meta = [
      path ? `path=${path}` : undefined,
      typeof result.offset === "number" ? `offset=${result.offset}` : undefined,
      typeof result.returnedLines === "number" ? `returnedLines=${result.returnedLines}` : undefined,
      typeof result.totalLines === "number" ? `totalLines=${result.totalLines}` : undefined,
      typeof result.truncated === "boolean" ? `truncated=${result.truncated}` : undefined,
    ].filter(Boolean).join(" ")
    const content = typeof result.content === "string"
      ? previewText(result.content, Math.min(2_500, perToolLimit))
      : compactJsonPreview(observation.result, Math.min(2_500, perToolLimit))
    return boundedText([meta, content].filter(Boolean).join("\n"), perToolLimit)
  }

  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) {
    const targetAgent = isRecord(result.targetAgent) ? result.targetAgent : {}
    const response = typeof result.response === "string" ? previewText(result.response, Math.min(3_000, perToolLimit)) : undefined
    const body = {
      status: result.status ?? "completed",
      targetAgent,
      request: stringArg(call.arguments, "request"),
      response,
      metadata: result.metadata,
    }
    return boundedText(stableStringify(compactLargeValueForModel(body)), perToolLimit)
  }

  return compactJsonPreview(observation.result, perToolLimit)
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "tool"
}

function estimateMemoryTokens(memory: Pick<AgentContextToolMemory, "title" | "summaryText" | "argsSummary" | "anchors">): number {
  const chars = [memory.title, memory.summaryText, memory.argsSummary ?? "", ...(memory.anchors ?? [])]
    .join("\n")
    .length
  return Math.ceil(chars / 4)
}

export function projectToolMemoryForContext(input: {
  turn: number
  round?: number
  call: RuntimeWorkspaceToolCall
  observation: RuntimeWorkspaceToolObservation
  sourceIndex: number
}): AgentContextToolMemory {
  const perToolLimit = getPlatformConfig().contextCompression.toolMemoryPerToolCharLimit
  const sourceToolCallId = input.call.id ?? `tool-${input.sourceIndex}`
  const title = titleForTool(input.call, input.observation)
  const argsSummary = summarizeArgs(input.call.arguments)
  const anchors = anchorsFromArgsAndResult(input.call.arguments, input.observation)
  const memory: AgentContextToolMemory = {
    id: `tm-${input.turn}-${input.round ?? 0}-${sanitizeIdPart(sourceToolCallId)}`,
    sourceToolCallId,
    turn: input.turn,
    ...(input.round !== undefined ? { round: input.round } : {}),
    toolName: input.call.name,
    status: input.observation.ok ? "success" : "failed",
    visibility: "summary",
    title,
    summaryText: summaryForTool(input.call, input.observation, perToolLimit),
    ...(anchors.length > 0 ? { anchors } : {}),
    ...(argsSummary ? { argsSummary } : {}),
  }
  return { ...memory, tokenEstimate: estimateMemoryTokens(memory) }
}

export function collectToolMemoriesForContext(
  toolCalls: RuntimeWorkspaceToolCall[],
  observations: RuntimeWorkspaceToolObservation[],
  turn: number,
  round?: number,
): AgentContextToolMemory[] {
  const memories: AgentContextToolMemory[] = []
  for (let i = 0; i < toolCalls.length; i += 1) {
    const call = toolCalls[i]
    const observation = observations[i]
    if (!call || !observation) continue
    memories.push(projectToolMemoryForContext({ turn, round, call, observation, sourceIndex: i }))
  }
  return memories
}

function stableMemoryKey(memory: AgentContextToolMemory): string {
  return `${String(memory.turn).padStart(12, "0")}\u0000${String(memory.round ?? 0).padStart(8, "0")}\u0000${memory.sourceToolCallId || memory.id}`
}

export function sortToolMemoriesStable(memories: readonly AgentContextToolMemory[]): AgentContextToolMemory[] {
  return [...memories].sort((left, right) => stableMemoryKey(left).localeCompare(stableMemoryKey(right)))
}

function placeholderText(memory: AgentContextToolMemory): string {
  return `${memory.title}: ${memory.status}; details omitted from model context. Use workspace tools again if exact content is needed.`
}

function toPlaceholder(memory: AgentContextToolMemory): AgentContextToolMemory {
  const placeholder: AgentContextToolMemory = {
    ...memory,
    visibility: "placeholder",
    summaryText: placeholderText(memory),
  }
  return { ...placeholder, tokenEstimate: estimateMemoryTokens(placeholder) }
}

function memoryModelChars(memory: AgentContextToolMemory): number {
  return [memory.title, memory.summaryText, memory.argsSummary ?? "", ...(memory.anchors ?? [])]
    .join("\n")
    .length
}

/** Applies monotonic task-mode visibility/budget rules to top-level tool memories. */
export function applyTaskToolMemoryRetention(memories: readonly AgentContextToolMemory[]): AgentContextToolMemory[] {
  if (memories.length === 0) return []

  const config = getPlatformConfig().contextCompression
  const byId = new Map<string, AgentContextToolMemory>()
  for (const memory of memories) {
    const previous = byId.get(memory.id)
    if (previous?.visibility === "placeholder" && memory.visibility === "summary") {
      byId.set(memory.id, toPlaceholder({ ...memory, visibility: "placeholder" }))
    } else {
      byId.set(memory.id, memory)
    }
  }

  const sorted = sortToolMemoriesStable(Array.from(byId.values()))
  const turnNumbers = Array.from(new Set(sorted.map((memory) => memory.turn))).sort((a, b) => a - b)
  const keepTurns = new Set(turnNumbers.slice(-config.toolMemoryKeepRecentTurns))
  const windowed = sorted.map((memory) => {
    if (memory.visibility === "placeholder") return toPlaceholder(memory)
    if (!keepTurns.has(memory.turn)) return toPlaceholder(memory)
    if (memory.summaryText.length > config.toolMemoryPerToolCharLimit) {
      return {
        ...memory,
        summaryText: boundedText(memory.summaryText, config.toolMemoryPerToolCharLimit),
        tokenEstimate: estimateMemoryTokens(memory),
      }
    }
    return memory
  })

  let total = 0
  const keepSummaryIds = new Set<string>()
  for (const memory of [...windowed].reverse()) {
    if (memory.visibility !== "summary") continue
    const chars = memoryModelChars(memory)
    if (total + chars <= config.toolMemoryTotalRecentCharLimit) {
      total += chars
      keepSummaryIds.add(memory.id)
    }
  }

  return windowed.map((memory) => {
    if (memory.visibility !== "summary") return memory
    return keepSummaryIds.has(memory.id) ? memory : toPlaceholder(memory)
  })
}

export function renderToolMemoriesForModel(memories: readonly AgentContextToolMemory[] | undefined): string | null {
  const sorted = sortToolMemoriesStable(memories ?? [])
  if (sorted.length === 0) return null
  return [
    "最近工具工作记录（受上下文预算限制；如需精确信息，请用 workspace 工具重新读取或检查）：",
    ...sorted.map((memory) => {
      const head = `- turn=${memory.turn}${memory.round !== undefined ? ` round=${memory.round}` : ""} ${memory.title} [${memory.toolName}/${memory.status}/${memory.visibility}]`
      const details = [
        memory.argsSummary ? `  args: ${memory.argsSummary}` : undefined,
        memory.anchors && memory.anchors.length > 0 ? `  anchors: ${memory.anchors.join(", ")}` : undefined,
        `  ${memory.summaryText}`,
      ].filter(Boolean)
      return [head, ...details].join("\n")
    }),
  ].join("\n")
}
