import type { WorkspaceOperationName, WorkspaceOperationRequest } from "@tsian/contracts"
import {
  RUNTIME_WORKSPACE_TOOL_NAMES,
  type RuntimeWorkspaceToolCall,
} from "../workspace-tools-types"
import { isRecord, toolError } from "./shared"

export const MAX_AGENT_READ_CONTENT_CHARS = 24 * 1024
export const DEFAULT_AGENT_LIST_LIMIT = 50
export const MAX_AGENT_LIST_LIMIT = 50
export const MAX_AGENT_LIST_DELIVERY_CHARS = 28 * 1024
export const DEFAULT_AGENT_SEARCH_FILE_LIMIT = 10
export const MAX_AGENT_SEARCH_FILE_LIMIT = 10
export const MAX_AGENT_SEARCH_CONTEXT_LINES = 2
export const MAX_AGENT_SEARCH_MATCHES_PER_FILE = 5
export const MAX_AGENT_SEARCH_SNIPPET_CHARS = 400
export const MAX_AGENT_SEARCH_DELIVERY_CHARS = 28 * 1024
export const MAX_AGENT_GLOB_MATCHES = 50
export const MAX_AGENT_GLOB_DELIVERY_CHARS = 28 * 1024
export const MAX_AGENT_DIFF_INLINE_CHARS = 8 * 1024
export const MAX_AGENT_MUTATION_PATH_SAMPLES = 20
export const MAX_AGENT_MUTATION_DELIVERY_CHARS = 28 * 1024

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.floor(value)))
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value).length
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function requestedSearchLimit(call: RuntimeWorkspaceToolCall): number {
  return boundedInteger(
    call.arguments.limit,
    DEFAULT_AGENT_SEARCH_FILE_LIMIT,
    1,
    MAX_AGENT_SEARCH_FILE_LIMIT,
  )
}

/**
 * Adapt an Agent tool call before it reaches the shared workspace operation.
 * Direct Resource Manager/SDK callers do not pass through this function and
 * retain the shared operation's full-result semantics.
 */
export function workspaceOperationRequestFromAgentTool(
  call: RuntimeWorkspaceToolCall,
): WorkspaceOperationRequest {
  const operation = call.name as WorkspaceOperationName
  const request = { ...call.arguments, operation } as WorkspaceOperationRequest

  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.read) {
    const usesLineRange = request.offset !== undefined || request.limit !== undefined
    const usesCharRange = request.charOffset !== undefined || request.charLimit !== undefined
    if (!usesLineRange && !usesCharRange) {
      return { ...request, charOffset: 0, charLimit: MAX_AGENT_READ_CONTENT_CHARS }
    }
    if (usesCharRange) {
      return {
        ...request,
        charLimit: boundedInteger(
          request.charLimit,
          MAX_AGENT_READ_CONTENT_CHARS,
          1,
          MAX_AGENT_READ_CONTENT_CHARS,
        ),
      }
    }
  }

  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.search) {
    // Ask the shared operation for one look-ahead item so the delivery envelope
    // can truthfully report whether narrowing is required. Context is capped
    // before the shared operation builds per-match arrays, avoiding a large
    // intermediate result that the Agent delivery would discard anyway.
    return {
      ...request,
      contextLines: boundedInteger(
        request.contextLines,
        0,
        0,
        MAX_AGENT_SEARCH_CONTEXT_LINES,
      ),
      limit: requestedSearchLimit(call) + 1,
    }
  }

  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.glob) {
    return {
      ...request,
      limit: boundedInteger(request.limit, MAX_AGENT_GLOB_MATCHES, 1, MAX_AGENT_GLOB_MATCHES),
    }
  }

  return request
}

function deliverReadResult(result: unknown): unknown {
  if (!isRecord(result) || typeof result.content !== "string") return result
  if (result.isBinaryPlaceholder === true) return result

  const content = result.content.slice(0, MAX_AGENT_READ_CONTENT_CHARS)
  const charOffset = typeof result.charOffset === "number" ? result.charOffset : 0
  const totalChars = typeof result.totalChars === "number"
    ? result.totalChars
    : charOffset + result.content.length
  const nextCharOffset = charOffset + content.length
  const hasMoreContent = nextCharOffset < totalChars
  const contentWasCapped = content.length < result.content.length

  const delivered: Record<string, unknown> = {
    ...result,
    content,
    charOffset,
    totalChars,
    returnedChars: content.length,
    truncated: hasMoreContent,
    ...(contentWasCapped && typeof result.returnedLines === "number"
      ? { returnedLines: content.length === 0 ? 0 : content.split("\n").length }
      : {}),
    ...(hasMoreContent ? { nextCharOffset } : {}),
  }
  if (!hasMoreContent) delete delivered.nextCharOffset
  return delivered
}

function boundedSnippet(value: unknown): { text: string; truncated: boolean } {
  if (typeof value !== "string") return { text: "", truncated: false }
  return {
    text: value.slice(0, MAX_AGENT_SEARCH_SNIPPET_CHARS),
    truncated: value.length > MAX_AGENT_SEARCH_SNIPPET_CHARS,
  }
}

function deliverSearchMatch(value: unknown): unknown {
  if (!isRecord(value)) return value
  const line = boundedSnippet(value.line)
  const match = boundedSnippet(value.match)
  const beforeValues = Array.isArray(value.contextBefore) ? value.contextBefore : []
  const afterValues = Array.isArray(value.contextAfter) ? value.contextAfter : []
  const contextBefore = beforeValues.slice(-2).map((entry) => boundedSnippet(entry))
  const contextAfter = afterValues.slice(0, 2).map((entry) => boundedSnippet(entry))
  const snippetTruncated = line.truncated
    || match.truncated
    || beforeValues.length > contextBefore.length
    || afterValues.length > contextAfter.length
    || contextBefore.some((entry) => entry.truncated)
    || contextAfter.some((entry) => entry.truncated)

  return {
    lineNumber: value.lineNumber,
    line: line.text,
    match: match.text,
    contextBefore: contextBefore.map((entry) => entry.text),
    contextAfter: contextAfter.map((entry) => entry.text),
    ...(snippetTruncated ? { snippetTruncated: true } : {}),
  }
}

function deliverSearchResult(call: RuntimeWorkspaceToolCall, result: unknown): unknown {
  if (!Array.isArray(result)) return result
  const fileLimit = requestedSearchLimit(call)
  const sourceItems = result.slice(0, fileLimit)
  const candidates = sourceItems.map((value) => {
    if (!isRecord(value)) return value
    const matches = Array.isArray(value.matches) ? value.matches : []
    const returnedMatches = matches.slice(0, MAX_AGENT_SEARCH_MATCHES_PER_FILE)
      .map(deliverSearchMatch)
    const sourceHadMoreMatches = value.matchesTruncated === true
    const omittedMatchesAtLeast = Math.max(0, matches.length - returnedMatches.length)
      + (sourceHadMoreMatches ? 1 : 0)
    const preview = boundedSnippet(value.preview)
    return {
      path: value.path,
      name: value.name,
      updatedAt: value.updatedAt,
      score: value.score,
      ...(value.readOnly === true ? { readOnly: true } : {}),
      preview: preview.text,
      ...(preview.truncated ? { previewTruncated: true } : {}),
      matches: returnedMatches,
      returnedMatches: returnedMatches.length,
      matchesTruncated: omittedMatchesAtLeast > 0,
      omittedMatchesAtLeast,
    }
  })

  const envelope = (items: unknown[]) => {
    const hasLookAheadFile = result.length > fileLimit
    const hasMoreFiles = hasLookAheadFile || items.length < candidates.length
    const anchors = items.flatMap((item) =>
      isRecord(item) && typeof item.path === "string" ? [item.path] : [])
    return {
      items,
      returnedFiles: items.length,
      fileLimit,
      hasMoreFiles,
      omittedFilesAtLeast: Math.max(0, candidates.length - items.length)
        + (hasLookAheadFile ? 1 : 0),
      anchors,
      continuation: {
        ...(typeof call.arguments.path === "string" ? { path: call.arguments.path } : {}),
        hint: "Narrow path/query/pattern, then read an authoritative file by exact character range.",
      },
    }
  }

  // Pack complete semantic match records into a producer-owned aggregate
  // budget. When a record does not fit, report it as omitted instead of
  // slicing the final JSON observation or presenting partial success text.
  const items: unknown[] = []
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    const matches = Array.isArray(candidate.matches) ? candidate.matches : []
    const producerOmitted = typeof candidate.omittedMatchesAtLeast === "number"
      ? candidate.omittedMatchesAtLeast
      : 0
    let packedCandidate = {
      ...candidate,
      matches: [] as unknown[],
      returnedMatches: 0,
      matchesTruncated: matches.length + producerOmitted > 0,
      omittedMatchesAtLeast: matches.length + producerOmitted,
    }
    if (serializedLength(envelope([...items, packedCandidate])) > MAX_AGENT_SEARCH_DELIVERY_CHARS) {
      break
    }
    items.push(packedCandidate)
    for (const match of matches) {
      const nextMatches = [...packedCandidate.matches, match]
      const nextOmitted = matches.length - nextMatches.length + producerOmitted
      const nextCandidate = {
        ...packedCandidate,
        matches: nextMatches,
        returnedMatches: nextMatches.length,
        matchesTruncated: nextOmitted > 0,
        omittedMatchesAtLeast: nextOmitted,
      }
      const nextItems = [...items.slice(0, -1), nextCandidate]
      if (serializedLength(envelope(nextItems)) > MAX_AGENT_SEARCH_DELIVERY_CHARS) break
      packedCandidate = nextCandidate
      items[items.length - 1] = packedCandidate
    }
  }

  return envelope(items)
}

function deliverListResult(call: RuntimeWorkspaceToolCall, result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.entries)) return result
  const sourceEntries = result.entries
  const offset = boundedInteger(call.arguments.offset, 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = boundedInteger(
    call.arguments.limit,
    DEFAULT_AGENT_LIST_LIMIT,
    1,
    MAX_AGENT_LIST_LIMIT,
  )
  const entries = sourceEntries.slice(offset, offset + limit)
  const envelope = (pageEntries: unknown[]) => {
    const nextOffset = offset + pageEntries.length
    const truncated = nextOffset < sourceEntries.length
    return {
      path: result.path,
      ...(result.readOnly === true ? { readOnly: true } : {}),
      entries: pageEntries,
      offset,
      limit,
      totalEntries: sourceEntries.length,
      returnedEntries: pageEntries.length,
      truncated,
      ...(truncated ? { nextOffset } : {}),
    }
  }
  while (entries.length > 0 && serializedLength(envelope(entries)) > MAX_AGENT_LIST_DELIVERY_CHARS) {
    entries.pop()
  }
  if (entries.length === 0 && offset < sourceEntries.length) {
    throw toolError(
      "WORKSPACE_LIST_ENTRY_TOO_LARGE",
      "A workspace list entry is too large to deliver safely. List a narrower directory path.",
      { path: result.path, offset },
    )
  }
  return envelope(entries)
}

function deliverGlobResult(result: unknown): unknown {
  if (!isRecord(result) || !Array.isArray(result.matches)) return result
  const sourceMatches = result.matches
  const matches = [...sourceMatches]
  const envelope = (pageMatches: unknown[]) => {
    const omittedByDelivery = sourceMatches.length - pageMatches.length
    const truncated = result.truncated === true || omittedByDelivery > 0
    return {
      ...result,
      matches: pageMatches,
      returnedMatches: pageMatches.length,
      truncated,
      omittedMatchesAtLeast: omittedByDelivery + (result.truncated === true ? 1 : 0),
      continuation: truncated
        ? { hint: "Narrow the glob pattern to retrieve omitted paths." }
        : { hint: "All matching paths were returned." },
    }
  }
  while (matches.length > 0 && serializedLength(envelope(matches)) > MAX_AGENT_GLOB_DELIVERY_CHARS) {
    matches.pop()
  }
  return envelope(matches)
}

function deliverDiffResult(result: unknown): unknown {
  if (!isRecord(result)) return result
  const currentContent = typeof result.currentContent === "string" ? result.currentContent : ""
  const nextContent = typeof result.nextContent === "string" ? result.nextContent : ""
  if (currentContent.length + nextContent.length <= MAX_AGENT_DIFF_INLINE_CHARS) return result
  return {
    path: result.path,
    scope: result.scope,
    changed: result.changed,
    currentSize: result.currentSize,
    nextSize: result.nextSize,
    contentOmitted: true,
    continuation: {
      operation: "read",
      path: result.path,
      charOffset: 0,
      hint: "Read the current file by character range. The proposed content is already present in the Tool call arguments.",
    },
  }
}

function deliverWriteResult(result: unknown): unknown {
  if (!isRecord(result) || !isRecord(result.file)) return result
  const file = result.file
  return {
    path: result.path,
    scope: result.scope,
    changed: result.changed,
    file: {
      path: file.path,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
      ...(typeof file.content === "string" ? { size: file.content.length } : {}),
      binary: typeof Blob !== "undefined" && file.binary instanceof Blob,
      ...(typeof file.imageMimeType === "string" ? { imageMimeType: file.imageMimeType } : {}),
    },
  }
}

function deliverPathMutation(
  call: RuntimeWorkspaceToolCall,
  result: unknown,
  pathsField: "copiedPaths" | "movedPaths" | "deletedPaths",
  countField: "copiedCount" | "movedCount" | "deletedCount",
): unknown {
  if (!isRecord(result) || !Array.isArray(result[pathsField])) return result
  const paths = result[pathsField]
  const samples = paths.slice(0, MAX_AGENT_MUTATION_PATH_SAMPLES)
  const envelope = (pathSamples: unknown[]) => {
    const pathsTruncated = pathSamples.length < paths.length
    return {
      ...(typeof result.scope === "string" ? { scope: result.scope } : {}),
      ...(typeof result.fromScope === "string" ? { fromScope: result.fromScope } : {}),
      ...(typeof result.toScope === "string" ? { toScope: result.toScope } : {}),
      ...(typeof result.fromPath === "string" ? { fromPath: result.fromPath } : {}),
      ...(typeof result.toPath === "string" ? { toPath: result.toPath } : {}),
      ...(typeof (call.arguments.targetPath ?? call.arguments.path) === "string"
        ? { targetRoot: call.arguments.targetPath ?? call.arguments.path }
        : {}),
      [pathsField]: pathSamples,
      [countField]: paths.length,
      pathsTruncated,
      omittedPaths: paths.length - pathSamples.length,
    }
  }
  while (samples.length > 0 && serializedLength(envelope(samples)) > MAX_AGENT_MUTATION_DELIVERY_CHARS) {
    samples.pop()
  }
  return envelope(samples)
}

/** Shape the raw shared-operation result into the bounded Agent Tool result. */
export function deliverWorkspaceOperationResultToAgent(
  call: RuntimeWorkspaceToolCall,
  result: unknown,
): unknown {
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.read) return deliverReadResult(result)
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.search) return deliverSearchResult(call, result)
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.list) return deliverListResult(call, result)
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.glob) return deliverGlobResult(result)
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.diff) return deliverDiffResult(result)
  if (
    call.name === RUNTIME_WORKSPACE_TOOL_NAMES.write
    || call.name === RUNTIME_WORKSPACE_TOOL_NAMES.edit
  ) return deliverWriteResult(result)
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.copy) {
    return deliverPathMutation(call, result, "copiedPaths", "copiedCount")
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.move) {
    return deliverPathMutation(call, result, "movedPaths", "movedCount")
  }
  if (call.name === RUNTIME_WORKSPACE_TOOL_NAMES.delete) {
    return deliverPathMutation(call, result, "deletedPaths", "deletedCount")
  }
  return result
}
