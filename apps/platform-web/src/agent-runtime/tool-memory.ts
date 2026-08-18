import type { AgentContextToolMemory, JsonValue, ToolMemoryProjection } from "@tsian/contracts"
import { getPlatformConfig } from "../config/platform-config"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  type RuntimeWorkspaceToolCall,
  type RuntimeWorkspaceToolObservation,
} from "./workspace-tools-types"

const MAX_ANCHORS = 20
const MAX_EXACT_FIELDS = 24

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function cleanText(value: unknown, limit: number): string | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!text) return undefined
  return text.length <= limit ? text : `${text.slice(0, limit)}…`
}

function sanitizeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "tool"
}

function exactFields(value: unknown): Record<string, JsonValue> | undefined {
  if (!isRecord(value)) return undefined
  const exact: Record<string, JsonValue> = {}
  const names = /^(id|.*Id|.*Ref|.*Hash|hash|revision|receipt|code|status|phase|path|sequence)$/
  for (const [key, entry] of Object.entries(value)) {
    if (Object.keys(exact).length >= MAX_EXACT_FIELDS) break
    if (key === "responseRef") continue
    if (names.test(key) && isJsonValue(entry)) exact[key] = entry
  }
  return Object.keys(exact).length > 0 ? exact : undefined
}

function pathAnchors(call: RuntimeWorkspaceToolCall, observation: RuntimeWorkspaceToolObservation): string[] {
  const result = isRecord(observation.result) ? observation.result : {}
  const anchors = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.trim()) anchors.add(value.trim())
  }
  add(call.arguments.path)
  add(result.path)
  for (const key of ["paths", "writtenPaths", "deletedPaths", "writes"]) {
    const value = result[key]
    if (!Array.isArray(value)) continue
    for (const item of value) add(isRecord(item) ? item.path : item)
  }
  return Array.from(anchors).slice(0, MAX_ANCHORS)
}

function normalizeProjection(value: ToolMemoryProjection): ToolMemoryProjection | null {
  const key = cleanText(value.key, 240)
  const title = cleanText(value.title, 240)
  const summary = cleanText(value.summary, 2_000)
  if (!key || !title || !summary || (value.status !== "success" && value.status !== "failed")) return null
  const anchors = Array.from(new Set((value.anchors ?? []).map((item) => cleanText(item, 300)).filter((item): item is string => Boolean(item)))).slice(0, MAX_ANCHORS)
  const resolves = Array.from(new Set((value.resolves ?? []).map((item) => cleanText(item, 240)).filter((item): item is string => Boolean(item)))).slice(0, MAX_ANCHORS)
  const exact = value.exact && isJsonValue(value.exact) ? value.exact : undefined
  return {
    key,
    status: value.status,
    title,
    summary,
    ...(anchors.length > 0 ? { anchors } : {}),
    ...(exact ? { exact } : {}),
    ...(resolves.length > 0 ? { resolves } : {}),
  }
}

function builtinProjection(
  call: RuntimeWorkspaceToolCall,
  observation: RuntimeWorkspaceToolObservation,
): ToolMemoryProjection | null {
  if (observation.memoryProjection) return normalizeProjection(observation.memoryProjection)

  const omitted = new Set<string>([
    RUNTIME_WORKSPACE_TOOL_NAMES.useSkill,
    RUNTIME_WORKSPACE_TOOL_NAMES.list,
    RUNTIME_WORKSPACE_TOOL_NAMES.search,
    RUNTIME_WORKSPACE_TOOL_NAMES.glob,
    RUNTIME_WORKSPACE_TOOL_NAMES.diff,
    RUNTIME_WORKSPACE_TOOL_NAMES.read,
  ])
  if (omitted.has(call.name)) return null

  const anchors = pathAnchors(call, observation)
  const result = isRecord(observation.result) ? observation.result : {}
  const primary = anchors[0] ?? cleanText(call.arguments.path, 300) ?? call.name
  const skill = cleanText(call.arguments.skill, 120)
  const action = cleanText(call.arguments.script, 120) ?? cleanText(call.arguments.action, 120)
  const mutationTools = new Set<string>([
    RUNTIME_WORKSPACE_TOOL_NAMES.write,
    RUNTIME_WORKSPACE_TOOL_NAMES.edit,
    RUNTIME_WORKSPACE_TOOL_NAMES.copy,
    RUNTIME_WORKSPACE_TOOL_NAMES.move,
    RUNTIME_WORKSPACE_TOOL_NAMES.delete,
  ])
  const operationKey = mutationTools.has(call.name)
    ? `workspace:${primary}`
    : call.name === RUNTIME_WORKSPACE_TOOL_NAMES.runScript
      ? `action:${skill ?? "skill"}/${action ?? "script"}`
      : call.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall
        ? `agent_call:${cleanText(call.arguments.agentId, 120) ?? "agent"}`
        : `${call.name}:${primary}`
  if (!observation.ok) {
    const error = observation.error
    if (!error || /(?:INVALID|REQUIRED|NOT_FOUND|UNSUPPORTED)$/.test(error.code)) return null
    return {
      key: operationKey,
      status: "failed",
      title: `${call.name} failed`,
      summary: `${error.code}: ${error.message}`,
      ...(anchors.length > 0 ? { anchors } : {}),
      exact: { code: error.code },
    }
  }

  if (mutationTools.has(call.name)) {
    return {
      key: operationKey,
      status: "success",
      title: `${call.name} ${primary}`,
      summary: anchors.length > 0 ? `Workspace mutation completed for ${anchors.join(", ")}.` : "Workspace mutation completed.",
      ...(anchors.length > 0 ? { anchors } : {}),
      ...(exactFields(result) ? { exact: exactFields(result) } : {}),
    }
  }

  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.runScript || call.name === RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) {
    const exact = exactFields(isRecord(result.output) ? result.output : result)
    if (!exact && anchors.length === 0) return null
    return {
      key: operationKey,
      status: "success",
      title: call.name === RUNTIME_WORKSPACE_TOOL_NAMES.runScript ? `Completed ${skill ?? "Skill"}/${action ?? "action"}` : "Delegated Agent completed",
      summary: "Operation completed; exact continuation identifiers are retained below.",
      ...(anchors.length > 0 ? { anchors } : {}),
      ...(exact ? { exact } : {}),
    }
  }
  return null
}

function estimateMemoryTokens(memory: AgentContextToolMemory): number {
  return Math.ceil([
    memory.title,
    memory.summary,
    ...(memory.anchors ?? []),
    memory.exact ? JSON.stringify(memory.exact) : "",
  ].join("\n").length / 4)
}

export function projectToolMemoryForContext(input: {
  sequence: number
  gameTurn?: number
  round?: number
  call: RuntimeWorkspaceToolCall
  observation: RuntimeWorkspaceToolObservation
  sourceIndex: number
}): AgentContextToolMemory | null {
  const projection = builtinProjection(input.call, input.observation)
  if (!projection) return null
  const sourceToolCallId = input.call.id ?? `tool-${input.sourceIndex}`
  const memory: AgentContextToolMemory = {
    id: `tm-${input.sequence}-${input.round ?? 0}-${sanitizeIdPart(sourceToolCallId)}`,
    sourceToolCallId,
    key: projection.key,
    sequence: input.sequence,
    ...(input.gameTurn !== undefined ? { gameTurn: input.gameTurn } : {}),
    ...(input.round !== undefined ? { round: input.round } : {}),
    toolName: input.call.name,
    status: projection.status,
    title: projection.title,
    summary: projection.summary,
    ...(projection.anchors ? { anchors: projection.anchors } : {}),
    ...(projection.exact ? { exact: projection.exact } : {}),
    ...(projection.resolves ? { resolves: projection.resolves } : {}),
  }
  return { ...memory, tokenEstimate: estimateMemoryTokens(memory) }
}

export function collectToolMemoriesForContext(
  toolCalls: RuntimeWorkspaceToolCall[],
  observations: RuntimeWorkspaceToolObservation[],
  sequence: number,
  round?: number,
  gameTurn?: number,
): AgentContextToolMemory[] {
  const memories: AgentContextToolMemory[] = []
  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index]
    const observation = observations[index]
    if (!call || !observation) continue
    const memory = projectToolMemoryForContext({ sequence, gameTurn, round, call, observation, sourceIndex: index })
    if (memory) memories.push(memory)
  }
  return memories
}

function stableMemoryKey(memory: AgentContextToolMemory): string {
  return `${String(memory.sequence).padStart(12, "0")}\u0000${String(memory.round ?? 0).padStart(8, "0")}\u0000${memory.sourceToolCallId || memory.id}`
}

export function sortToolMemoriesStable(memories: readonly AgentContextToolMemory[]): AgentContextToolMemory[] {
  return [...memories].sort((left, right) => stableMemoryKey(left).localeCompare(stableMemoryKey(right)))
}

function memoryChars(memory: AgentContextToolMemory): number {
  return [memory.title, memory.summary, ...(memory.anchors ?? []), memory.exact ? JSON.stringify(memory.exact) : ""].join("\n").length
}

export function applyTaskToolMemoryRetention(
  memories: readonly AgentContextToolMemory[],
  currentSequence = memories.reduce((max, memory) => Math.max(max, memory.sequence), 0),
): AgentContextToolMemory[] {
  const sorted = sortToolMemoriesStable(memories)
  const currentByKey = new Map<string, AgentContextToolMemory>()
  for (const memory of sorted) {
    // Resolution is chronological: a success removes matching failures that
    // already exist, but must not hide a newer failure for the same resource.
    for (const key of memory.resolves ?? []) currentByKey.delete(key)
    currentByKey.set(memory.key, memory)
  }
  let retained = sortToolMemoriesStable(Array.from(currentByKey.values()))
  const config = getPlatformConfig().contextCompression
  const minimumSequence = Math.max(0, currentSequence - config.toolMemoryKeepRecentTurns + 1)
  retained = retained.filter((memory) => memory.sequence >= minimumSequence && memory.sequence <= currentSequence)
  let total = 0
  const bounded: AgentContextToolMemory[] = []
  for (const memory of [...retained].reverse()) {
    const chars = memoryChars(memory)
    if (chars > config.toolMemoryPerToolCharLimit || total + chars > config.toolMemoryTotalRecentCharLimit) continue
    total += chars
    bounded.push(memory)
  }
  return sortToolMemoriesStable(bounded)
}

export function renderToolMemoriesForModel(memories: readonly AgentContextToolMemory[] | undefined): string | null {
  const sorted = sortToolMemoriesStable(memories ?? [])
  if (sorted.length === 0) return null
  return [
    "已保留的语义工具结果（正文仍以 workspace/source 为权威）：",
    ...sorted.map((memory) => [
      `- sequence=${memory.sequence}${memory.gameTurn !== undefined ? ` gameTurn=${memory.gameTurn}` : ""} ${memory.title} [${memory.toolName}/${memory.status}]`,
      `  key: ${memory.key}`,
      memory.anchors?.length ? `  anchors: ${memory.anchors.join(", ")}` : undefined,
      memory.exact ? `  exact: ${JSON.stringify(memory.exact)}` : undefined,
      `  ${memory.summary}`,
    ].filter(Boolean).join("\n")),
  ].join("\n")
}
