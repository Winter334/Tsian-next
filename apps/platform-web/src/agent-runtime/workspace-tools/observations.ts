import type { UiToolPresentation } from "@tsian/contracts"
import { compactLargeValueForModel } from "../tool-memory"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  type RuntimeWorkspaceToolCall,
  type RuntimeWorkspaceToolObservation,
} from "../workspace-tools-types"
import { isRecord } from "./shared"

export const DEFAULT_AGENT_OBSERVATION_CHAR_BUDGET = 32 * 1024
export const MAX_AGENT_OBSERVATION_CHAR_BUDGET = 32 * 1024
export const MAX_AGENT_READ_CONTENT_CHARS = 24 * 1024
export const MAX_UI_AGENT_CALL_RESPONSE_CHARS = 8 * 1024

const MAX_SEARCH_FILES = 10
const MAX_SEARCH_MATCHES_PER_FILE = 5
const MAX_SEARCH_SNIPPET_CHARS = 400

function jsonSafeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || typeof value === "undefined"
  ) {
    return value
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "function" || typeof value === "symbol") return String(value)
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafeValue(item, seen))
  }
  try {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      try {
        return [key, jsonSafeValue(child, seen)]
      } catch {
        return [key, "[Unserializable]"]
      }
    }))
  } catch {
    return String(value)
  }
}

function serialized(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function normalizedBudget(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_AGENT_OBSERVATION_CHAR_BUDGET
  }
  return Math.min(MAX_AGENT_OBSERVATION_CHAR_BUDGET, Math.max(512, Math.floor(value)))
}

function previewEnvelope(value: unknown, budget: number, anchors: string[]): unknown {
  const text = serialized(value)
  let previewLimit = Math.max(32, budget - 320 - serialized(anchors).length)
  let envelope: Record<string, unknown>
  do {
    envelope = {
      preview: text.slice(0, previewLimit),
      charCount: text.length,
      truncatedForModel: true,
      ...(anchors.length > 0 ? { anchors } : {}),
      continuation: "Read the authoritative source by path/id with a narrower range.",
    }
    if (serialized(envelope).length <= budget || previewLimit <= 32) return envelope
    previewLimit = Math.max(32, previewLimit - 128)
  } while (previewLimit > 32)
  return { preview: text.slice(0, 32), charCount: text.length, truncatedForModel: true }
}

function boundedValue(value: unknown, budget: number, anchors: string[] = []): unknown {
  if (serialized(value).length <= budget) return value
  const compacted = compactLargeValueForModel(value)
  return serialized(compacted).length <= budget
    ? compacted
    : previewEnvelope(compacted, budget, anchors)
}

function snippet(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.length <= MAX_SEARCH_SNIPPET_CHARS
    ? value
    : `${value.slice(0, MAX_SEARCH_SNIPPET_CHARS)}…`
}

function projectSearchResult(result: unknown, call: RuntimeWorkspaceToolCall | undefined): unknown {
  if (!Array.isArray(result)) return result
  const items = result.slice(0, MAX_SEARCH_FILES).map((item) => {
    if (!isRecord(item)) return boundedValue(item, 1_000)
    const matches = Array.isArray(item.matches) ? item.matches : []
    return {
      path: item.path,
      name: item.name,
      updatedAt: item.updatedAt,
      score: item.score,
      preview: snippet(item.preview),
      matches: matches.slice(0, MAX_SEARCH_MATCHES_PER_FILE).map((match) => {
        if (!isRecord(match)) return boundedValue(match, MAX_SEARCH_SNIPPET_CHARS)
        return {
          lineNumber: match.lineNumber,
          line: snippet(match.line),
          match: snippet(match.match),
          contextBefore: Array.isArray(match.contextBefore)
            ? match.contextBefore.map(snippet).slice(-2)
            : [],
          contextAfter: Array.isArray(match.contextAfter)
            ? match.contextAfter.map(snippet).slice(0, 2)
            : [],
        }
      }),
      omittedMatches: Math.max(0, matches.length - MAX_SEARCH_MATCHES_PER_FILE),
      matchesTruncated: item.matchesTruncated === true
        || matches.length > MAX_SEARCH_MATCHES_PER_FILE,
    }
  })
  const anchors = items.flatMap((item) =>
    isRecord(item) && typeof item.path === "string" ? [item.path] : [])
  return {
    items,
    totalFiles: result.length,
    returnedFiles: items.length,
    omittedFiles: Math.max(0, result.length - items.length),
    truncated: result.length > items.length
      || items.some((item) => isRecord(item) && item.matchesTruncated === true),
    anchors,
    continuation: {
      ...(typeof call?.arguments.path === "string" ? { path: call.arguments.path } : {}),
      hint: "Narrow path/query/pattern, then read an exact file range.",
    },
  }
}

function projectReadResult(result: unknown): unknown {
  if (!isRecord(result) || typeof result.content !== "string") return result
  const content = result.content
  const charOffset = typeof result.charOffset === "number" ? result.charOffset : 0
  const returned = content.slice(0, MAX_AGENT_READ_CONTENT_CHARS)
  const totalChars = typeof result.totalChars === "number" ? result.totalChars : content.length
  const projectedTruncated = returned.length < content.length
  const truncated = result.truncated === true || projectedTruncated
  return {
    ...result,
    content: returned,
    totalChars,
    returnedChars: returned.length,
    charOffset,
    truncated,
    ...(projectedTruncated
      ? { nextCharOffset: charOffset + returned.length }
      : typeof result.nextCharOffset === "number"
        ? { nextCharOffset: result.nextCharOffset }
        : {}),
  }
}

function anchorsFor(call: RuntimeWorkspaceToolCall | undefined, result: unknown): string[] {
  const anchors = new Set<string>()
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim()) anchors.add(value.trim())
  }
  add(call?.arguments.path)
  add(call?.arguments.id)
  if (isRecord(result)) {
    add(result.path)
    add(result.id)
    if (Array.isArray(result.anchors)) result.anchors.forEach(add)
  }
  return [...anchors].slice(0, 20)
}

/** Project one execution result into the only representation allowed to enter
 * model messages/tool memories. The returned value always fits the final
 * serialized observation budget and remains valid JSON when stringified. */
export function projectToolObservationForAgent(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
  requestedBudget?: number,
): RuntimeWorkspaceToolObservation {
  const budget = normalizedBudget(requestedBudget)
  const rawResult = jsonSafeValue(observation.result)
  const anchors = anchorsFor(call, rawResult)
  let result = rawResult
  if (call?.name === RUNTIME_WORKSPACE_TOOL_NAMES.read) {
    result = projectReadResult(rawResult)
  } else if (call?.name === RUNTIME_WORKSPACE_TOOL_NAMES.search) {
    result = projectSearchResult(rawResult, call)
  }

  const projected: RuntimeWorkspaceToolObservation = observation.ok
    ? {
        index: observation.index,
        name: observation.name,
        ok: true,
        ...(result === undefined ? {} : { result: boundedValue(result, budget, anchors) }),
        ...(observation.imageParts ? { imageParts: observation.imageParts } : {}),
      }
    : {
        index: observation.index,
        name: observation.name,
        ok: false,
        ...(observation.error
          ? {
              error: {
                code: observation.error.code,
                message: observation.error.message,
                ...(observation.error.details === undefined
                  ? {}
                  : { details: boundedValue(jsonSafeValue(observation.error.details), Math.floor(budget / 2), anchors) }),
              },
            }
          : {}),
      }

  const projectedText = { ...projected, imageParts: undefined }
  if (serialized(projectedText).length <= budget) return projected
  const fallback: RuntimeWorkspaceToolObservation = {
    index: projected.index,
    name: projected.name,
    ok: projected.ok,
    ...(projected.ok
      ? { result: previewEnvelope(projected.result, Math.max(512, budget - 96), anchors) }
      : {
          error: {
            code: projected.error?.code ?? "TOOL_FAILED",
            message: snippet(projected.error?.message ?? "Tool failed."),
            details: previewEnvelope(projected.error?.details, Math.max(512, budget - 256), anchors),
          },
        }),
  }
  return {
    ...fallback,
    ...(projected.imageParts ? { imageParts: projected.imageParts } : {}),
  }
}

/** Build the closed UI projection. Ordinary tools intentionally return no
 * payload; only agent_call currently has a real presentation consumer. */
export function buildToolPresentation(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
): UiToolPresentation | undefined {
  if (call?.name !== RUNTIME_WORKSPACE_TOOL_NAMES.agentCall) return undefined
  const requestedAgentId = typeof call.arguments.agentId === "string" ? call.arguments.agentId : ""
  if (!observation.ok) {
    return {
      type: "agent_call",
      targetAgent: { id: requestedAgentId, title: requestedAgentId },
      response: "",
      status: "failed",
      ...(observation.error
        ? { error: { code: observation.error.code, message: observation.error.message } }
        : {}),
    }
  }
  const result = isRecord(observation.result) ? observation.result : {}
  const targetAgent = isRecord(result.targetAgent) ? result.targetAgent : {}
  const response = typeof result.response === "string" ? result.response : ""
  return {
    type: "agent_call",
    targetAgent: {
      id: typeof targetAgent.id === "string" ? targetAgent.id : requestedAgentId,
      title: typeof targetAgent.title === "string" ? targetAgent.title : requestedAgentId,
      ...(typeof targetAgent.summary === "string" ? { summary: targetAgent.summary } : {}),
    },
    response: response.slice(0, MAX_UI_AGENT_CALL_RESPONSE_CHARS),
    ...(response.length > MAX_UI_AGENT_CALL_RESPONSE_CHARS ? { responseTruncated: true } : {}),
    status: "completed",
  }
}

export function compactToolObservationForModel(
  observation: RuntimeWorkspaceToolObservation,
): RuntimeWorkspaceToolObservation {
  return projectToolObservationForAgent(undefined, observation)
}

export function formatNativeToolObservationContent(
  observation: RuntimeWorkspaceToolObservation,
): string {
  if (!observation.ok) {
    return JSON.stringify(observation.error ?? { code: "UNKNOWN", message: "Unknown error" })
  }
  return typeof observation.result === "string"
    ? observation.result
    : JSON.stringify(observation.result)
}
