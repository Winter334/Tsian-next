import type { ContentPart } from "@tsian/contracts"
import type { ToolSchema } from "./tool-schemas"
import type {
  ParsedRuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolError,
  RuntimeWorkspaceToolObservation,
} from "./workspace-tools-types"

export const TEXT_TOOL_CALLS_TAG = "tsian-tool-calls"
export const TEXT_TOOL_CALL_RECORDS_TAG = "tsian-tool-call-records"
export const TEXT_TOOL_EXECUTED_TOOLS_TAG = "tsian-executed-tools"
export const TEXT_TOOL_OBSERVATIONS_TAG = "tsian-tool-observations"
export const TEXT_TOOL_PROTOCOL_ERROR_TAG = "tsian-tool-protocol-error"

const MODEL_NATIVE_TEXT_TOOL_CALL_TAG = "tool_call"
const LEGACY_TEXT_TOOL_CALL_TAG = "tsian-tool-call"

export const TEXT_TOOL_CALLS_OPEN_TAG = `<${TEXT_TOOL_CALLS_TAG}>`
export const TEXT_TOOL_CALLS_CLOSE_TAG = `</${TEXT_TOOL_CALLS_TAG}>`
export const TEXT_TOOL_CALL_TEMPLATE = `${TEXT_TOOL_CALLS_OPEN_TAG}[{"name":"TOOL_NAME","arguments":{}}]${TEXT_TOOL_CALLS_CLOSE_TAG}`

export const TEXT_TOOL_PROTOCOL_MAX_RETRIES = 3

export type TextToolProtocolParseResult =
  | { kind: "stop" }
  | { kind: "tool_calls"; calls: ParsedRuntimeWorkspaceToolCall[]; interimText: string }
  | { kind: "protocol_error"; error: RuntimeWorkspaceToolError; interimText: string }

export interface TextToolExecutionRecord {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface TextToolObservationRecord {
  id: string
  name: string
  ok: boolean
  result?: unknown
  error?: RuntimeWorkspaceToolError
}

interface MessageLike {
  role: string
  content: string | ContentPart[]
}

const EXECUTABLE_CALLS_PATTERN = /<tsian-tool-calls>\s*([\s\S]*?)\s*<\/tsian-tool-calls>/g
const MODEL_NATIVE_CALL_PATTERN = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
const LEGACY_EXECUTABLE_CALL_PATTERN = /<tsian-tool-call>\s*([\s\S]*?)\s*<\/tsian-tool-call>/g
const CALL_RECORDS_PATTERN = /<tsian-tool-call-records>\s*([\s\S]*?)\s*<\/tsian-tool-call-records>/g
const EXECUTED_TOOLS_PATTERN = /<tsian-executed-tools>\s*([\s\S]*?)\s*<\/tsian-executed-tools>/g
const OBSERVATIONS_PATTERN = /<tsian-tool-observations>\s*([\s\S]*?)\s*<\/tsian-tool-observations>/g
const PROTOCOL_ERROR_PATTERN = /<tsian-tool-protocol-error>\s*([\s\S]*?)\s*<\/tsian-tool-protocol-error>/g

const NON_EXECUTABLE_TEXT_PROTOCOL_TAGS = [
  MODEL_NATIVE_TEXT_TOOL_CALL_TAG,
  LEGACY_TEXT_TOOL_CALL_TAG,
  TEXT_TOOL_CALL_RECORDS_TAG,
  TEXT_TOOL_EXECUTED_TOOLS_TAG,
  TEXT_TOOL_OBSERVATIONS_TAG,
  TEXT_TOOL_PROTOCOL_ERROR_TAG,
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function textFromContent(content: string | ContentPart[]): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

function protocolError(
  code: string,
  message: string,
  details?: unknown,
): RuntimeWorkspaceToolError {
  return details === undefined ? { code, message } : { code, message, details }
}

function clonePattern(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, pattern.flags)
}

function replacePattern(text: string, pattern: RegExp): string {
  return text.replace(clonePattern(pattern), "")
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let offset = 0
  for (;;) {
    const index = text.indexOf(needle, offset)
    if (index < 0) return count
    count += 1
    offset = index + needle.length
  }
}

function firstTextProtocolTag(text: string, tags: readonly string[]): string | undefined {
  let first: { tag: string; index: number } | undefined
  for (const tag of tags) {
    const openIndex = text.indexOf(`<${tag}>`)
    const closeIndex = text.indexOf(`</${tag}>`)
    const index = openIndex < 0
      ? closeIndex
      : closeIndex < 0
        ? openIndex
        : Math.min(openIndex, closeIndex)
    if (index < 0) continue
    if (!first || index < first.index) {
      first = { tag, index }
    }
  }
  return first?.tag
}

function firstNonExecutableTextProtocolTag(text: string): string | undefined {
  return firstTextProtocolTag(text, NON_EXECUTABLE_TEXT_PROTOCOL_TAGS)
}

function nonExecutableProtocolError(tag: string): RuntimeWorkspaceToolError {
  const rejectedFormat = tag === MODEL_NATIVE_TEXT_TOOL_CALL_TAG
    ? "is a model-native tool-call format, not the executable text-protocol format"
    : tag === LEGACY_TEXT_TOOL_CALL_TAG
    ? "is a legacy tool-call format, not the executable tool-call format"
    : "is runtime history, not an executable tool-call format"
  return protocolError(
    "TEXT_TOOL_PROTOCOL_NON_EXECUTABLE_TAG",
    `<${tag}> ${rejectedFormat}. To call tools, emit exactly one complete ${TEXT_TOOL_CALLS_OPEN_TAG}...${TEXT_TOOL_CALLS_CLOSE_TAG} JSON array block; if no tool call is needed, answer normally without protocol tags.`,
    { tag },
  )
}

export function stripTextExecutableToolCalls(text: string): string {
  let result = replacePattern(text, EXECUTABLE_CALLS_PATTERN)
  const danglingOpenIndex = result.indexOf(TEXT_TOOL_CALLS_OPEN_TAG)
  if (danglingOpenIndex >= 0) {
    result = result.slice(0, danglingOpenIndex)
  }
  return result.split(TEXT_TOOL_CALLS_CLOSE_TAG).join("").trim()
}

export function stripTextProtocolArtifacts(text: string): string {
  let result = stripTextExecutableToolCalls(text)
  for (const pattern of [
    MODEL_NATIVE_CALL_PATTERN,
    LEGACY_EXECUTABLE_CALL_PATTERN,
    CALL_RECORDS_PATTERN,
    EXECUTED_TOOLS_PATTERN,
    OBSERVATIONS_PATTERN,
    PROTOCOL_ERROR_PATTERN,
  ]) {
    result = replacePattern(result, pattern)
  }
  for (const tag of [
    MODEL_NATIVE_TEXT_TOOL_CALL_TAG,
    LEGACY_TEXT_TOOL_CALL_TAG,
    TEXT_TOOL_CALL_RECORDS_TAG,
    TEXT_TOOL_EXECUTED_TOOLS_TAG,
    TEXT_TOOL_OBSERVATIONS_TAG,
    TEXT_TOOL_PROTOCOL_ERROR_TAG,
  ]) {
    result = result.split(`<${tag}>`).join("")
    result = result.split(`</${tag}>`).join("")
  }
  return result.trim()
}

function validateTextToolCallItem(
  item: unknown,
  index: number,
): ParsedRuntimeWorkspaceToolCall | RuntimeWorkspaceToolError {
  if (!isRecord(item)) {
    return protocolError(
      "TEXT_TOOL_PROTOCOL_CALL_INVALID",
      `Tool call at index ${index} must be a JSON object.`,
    )
  }

  const name = typeof item.name === "string" ? item.name.trim() : ""
  if (!name) {
    return protocolError(
      "TEXT_TOOL_PROTOCOL_TOOL_NAME_REQUIRED",
      `Tool call at index ${index} requires a non-empty string name.`,
    )
  }

  const rawArguments = item.arguments
  if (rawArguments !== undefined && !isRecord(rawArguments)) {
    return protocolError(
      "TEXT_TOOL_PROTOCOL_ARGUMENTS_INVALID",
      `Tool call at index ${index} has invalid arguments; arguments must be an object when provided.`,
    )
  }

  const normalizedCall: RuntimeWorkspaceToolCall = {
    name,
    arguments: rawArguments ?? {},
  }
  return {
    raw: JSON.stringify({ name, arguments: normalizedCall.arguments }),
    call: normalizedCall,
  }
}

function parseTextToolCallsJson(
  raw: string,
  interimText: string,
): TextToolProtocolParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return {
      kind: "protocol_error",
      error: protocolError(
        "TEXT_TOOL_PROTOCOL_INVALID_JSON",
        error instanceof Error ? error.message : "Text Tool Protocol JSON is invalid.",
      ),
      interimText,
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      kind: "protocol_error",
      error: protocolError(
        "TEXT_TOOL_PROTOCOL_CALLS_NOT_ARRAY",
        `${TEXT_TOOL_CALLS_OPEN_TAG} content must be a JSON array, even for a single call.`,
      ),
      interimText,
    }
  }

  if (parsed.length === 0) {
    return {
      kind: "protocol_error",
      error: protocolError(
        "TEXT_TOOL_PROTOCOL_CALLS_EMPTY",
        `${TEXT_TOOL_CALLS_OPEN_TAG} content must include at least one tool call. Answer normally without protocol tags when no tool call is needed.`,
      ),
      interimText,
    }
  }

  const calls: ParsedRuntimeWorkspaceToolCall[] = []
  for (let index = 0; index < parsed.length; index += 1) {
    const result = validateTextToolCallItem(parsed[index], index)
    if ("code" in result) {
      return { kind: "protocol_error", error: result, interimText }
    }
    calls.push(result)
  }

  return { kind: "tool_calls", calls, interimText }
}

export function parseTextToolProtocolResponse(text: string): TextToolProtocolParseResult {
  const matches = [...text.matchAll(clonePattern(EXECUTABLE_CALLS_PATTERN))]
  const openTagCount = countOccurrences(text, TEXT_TOOL_CALLS_OPEN_TAG)
  const closeTagCount = countOccurrences(text, TEXT_TOOL_CALLS_CLOSE_TAG)
  const nonExecutableTag = firstNonExecutableTextProtocolTag(text)

  if (nonExecutableTag) {
    return {
      kind: "protocol_error",
      error: nonExecutableProtocolError(nonExecutableTag),
      // A malformed or dangling runtime-history tag has no reliable payload
      // boundary. Drop the rejected response from interim persistence so raw
      // call arguments or observations cannot leak into the turn timeline.
      interimText: "",
    }
  }

  if (matches.length === 0) {
    const interimText = stripTextExecutableToolCalls(text)
    if (openTagCount === 1 && closeTagCount === 0) {
      const openTagIndex = text.indexOf(TEXT_TOOL_CALLS_OPEN_TAG)
      const raw = text.slice(openTagIndex + TEXT_TOOL_CALLS_OPEN_TAG.length).trim()
      const fallbackResult = parseTextToolCallsJson(raw, interimText)
      if (fallbackResult.kind === "tool_calls") {
        return fallbackResult
      }
      if (
        fallbackResult.kind === "protocol_error"
        && fallbackResult.error.code !== "TEXT_TOOL_PROTOCOL_INVALID_JSON"
      ) return fallbackResult
    }
    if (openTagCount > 0 || closeTagCount > 0) {
      return {
        kind: "protocol_error",
        error: protocolError(
          "TEXT_TOOL_PROTOCOL_BLOCK_UNCLOSED",
          `A ${TEXT_TOOL_CALLS_OPEN_TAG} block must include exactly one matching ${TEXT_TOOL_CALLS_CLOSE_TAG}.`,
          { openTagCount, closeTagCount },
        ),
        interimText,
      }
    }
    return { kind: "stop" }
  }

  const interimText = stripTextExecutableToolCalls(text)
  if (matches.length > 1 || openTagCount !== 1 || closeTagCount !== 1) {
    return {
      kind: "protocol_error",
      error: protocolError(
        "TEXT_TOOL_PROTOCOL_MULTIPLE_BLOCKS",
        `Use exactly one ${TEXT_TOOL_CALLS_OPEN_TAG} JSON array block per round.`,
        { blockCount: matches.length, openTagCount, closeTagCount },
      ),
      interimText,
    }
  }

  const raw = matches[0]?.[1] ?? ""
  return parseTextToolCallsJson(raw, interimText)
}

export function assignTextToolCallIds(
  calls: ParsedRuntimeWorkspaceToolCall[],
  round: number,
): ParsedRuntimeWorkspaceToolCall[] {
  return calls.map((entry, index) => ({
    ...entry,
    call: entry.call
      ? { ...entry.call, id: `text-r${round}-c${index}` }
      : entry.call,
  }))
}

function textToolExecutionRecords(
  calls: RuntimeWorkspaceToolCall[],
): TextToolExecutionRecord[] {
  return calls.map((call, index) => ({
    id: call.id ?? `text-c${index}`,
    name: call.name,
    arguments: call.arguments,
  }))
}

function toolObservationForText(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
  index: number,
): TextToolObservationRecord {
  const id = call?.id ?? `text-c${index}`
  const name = call?.name ?? observation.name
  if (!observation.ok) {
    return {
      id,
      name,
      ok: false,
      ...(observation.error ? { error: observation.error } : {}),
    }
  }
  return {
    id,
    name,
    ok: true,
    ...(observation.result === undefined ? {} : { result: observation.result }),
  }
}

export function formatTextToolExecutionReport(
  calls: RuntimeWorkspaceToolCall[],
  observations: RuntimeWorkspaceToolObservation[],
): string | ContentPart[] {
  const executionRecords = textToolExecutionRecords(calls)
  const observationRecords = observations.map((observation, index) =>
    toolObservationForText(calls[index], observation, index)
  )
  const imageParts = observations.flatMap((observation) => observation.imageParts ?? [])
  const text = [
    "Text Tool Protocol execution report:",
    `<${TEXT_TOOL_EXECUTED_TOOLS_TAG}>${JSON.stringify(executionRecords)}</${TEXT_TOOL_EXECUTED_TOOLS_TAG}>`,
    `<${TEXT_TOOL_OBSERVATIONS_TAG}>${JSON.stringify(observationRecords)}</${TEXT_TOOL_OBSERVATIONS_TAG}>`,
    `Use these completed results to continue. If another tool is needed, emit one complete block beginning with ${TEXT_TOOL_CALLS_OPEN_TAG} and ending with ${TEXT_TOOL_CALLS_CLOSE_TAG}; otherwise answer normally without protocol tags.`,
  ].join("\n")
  if (imageParts.length === 0) return text
  return [{ type: "text", text }, ...imageParts]
}

function textToolProtocolCorrectionAction(code: string): string {
  switch (code) {
    case "TEXT_TOOL_PROTOCOL_INVALID_JSON":
      return "Regenerate the complete call as a strict JSON array. Use double-quoted keys and strings, escape newlines, quotes, and control characters, and place commas only between items."
    case "TEXT_TOOL_PROTOCOL_NON_EXECUTABLE_TAG":
      return "Express only the intended new calls in the executable block, with each array item containing name and arguments."
    case "TEXT_TOOL_PROTOCOL_BLOCK_UNCLOSED":
      return `Regenerate the complete block and end it with the literal closing tag ${TEXT_TOOL_CALLS_CLOSE_TAG}. End of message does not replace the closing tag.`
    case "TEXT_TOOL_PROTOCOL_MULTIPLE_BLOCKS":
      return `Emit exactly one complete block beginning with ${TEXT_TOOL_CALLS_OPEN_TAG} and ending with ${TEXT_TOOL_CALLS_CLOSE_TAG}.`
    case "TEXT_TOOL_PROTOCOL_CALLS_NOT_ARRAY":
    case "TEXT_TOOL_PROTOCOL_CALLS_EMPTY":
      return "Put one or more calls in a non-empty JSON array. If no tool is needed, leave the protocol and answer normally."
    case "TEXT_TOOL_PROTOCOL_CALL_INVALID":
    case "TEXT_TOOL_PROTOCOL_TOOL_NAME_REQUIRED":
    case "TEXT_TOOL_PROTOCOL_ARGUMENTS_INVALID":
      return "Encode every array item as a name-and-arguments object: name must be a non-empty string, and arguments must be an object."
    default:
      return "Regenerate the complete call using the correct tool-call format."
  }
}

export function formatTextToolProtocolError(
  error: RuntimeWorkspaceToolError,
  retryRemaining: number,
): string {
  return [
    "Text Tool Protocol correction:",
    `<${TEXT_TOOL_PROTOCOL_ERROR_TAG}>${JSON.stringify({
      code: error.code,
      message: error.message,
      retryRemaining,
    })}</${TEXT_TOOL_PROTOCOL_ERROR_TAG}>`,
    "The previous response was not executed.",
    `Correction attempts remaining for this error code, including this attempt: ${retryRemaining}.`,
    `Correction action: ${textToolProtocolCorrectionAction(error.code)}`,
    `Correct tool-call format: ${TEXT_TOOL_CALL_TEMPLATE}`,
    "If no tool is needed, answer normally without protocol tags.",
  ].join("\n")
}

function parseFirstArrayTag(text: string, pattern: RegExp): unknown[] | undefined {
  const match = clonePattern(pattern).exec(text)
  if (!match) return undefined
  try {
    const parsed = JSON.parse(match[1] ?? "")
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function isTextToolInteractionMessage(message: MessageLike): boolean {
  const text = textFromContent(message.content)
  return text.includes(`<${TEXT_TOOL_EXECUTED_TOOLS_TAG}>`)
    || text.includes(`<${TEXT_TOOL_OBSERVATIONS_TAG}>`)
    || text.includes(`<${TEXT_TOOL_PROTOCOL_ERROR_TAG}>`)
}

export function extractTextToolNameFromMessage(message: MessageLike): string | undefined {
  const text = textFromContent(message.content)
  const executions = parseFirstArrayTag(text, EXECUTED_TOOLS_PATTERN)
  const firstExecution = executions?.[0]
  if (isRecord(firstExecution) && typeof firstExecution.name === "string" && firstExecution.name.trim()) {
    return firstExecution.name.trim()
  }
  const observations = parseFirstArrayTag(text, OBSERVATIONS_PATTERN)
  const firstObservation = observations?.[0]
  if (isRecord(firstObservation) && typeof firstObservation.name === "string" && firstObservation.name.trim()) {
    return firstObservation.name.trim()
  }
  return undefined
}

function schemaTypeText(schema: unknown): string {
  if (!isRecord(schema)) return "any"
  const type = schema.type
  if (Array.isArray(type)) {
    return type.filter((item): item is string => typeof item === "string").join(" | ") || "any"
  }
  if (typeof type === "string") {
    if (type === "array") {
      const items = schemaTypeText(schema.items)
      return `array<${items}>`
    }
    return type
  }
  if (Array.isArray(schema.enum)) return "enum"
  return "object"
}

function formatEnumValues(schema: Record<string, unknown>): string {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) return ""
  return ` enum=${schema.enum.map((value) => JSON.stringify(value)).join("|")}`
}

function formatParameterLine(
  name: string,
  schema: unknown,
  required: Set<string>,
): string {
  const record = isRecord(schema) ? schema : {}
  const description = typeof record.description === "string" && record.description.trim()
    ? ` — ${record.description.trim()}`
    : ""
  const marker = required.has(name) ? "required" : "optional"
  return `  - ${name}: ${schemaTypeText(record)} ${marker}${formatEnumValues(record)}${description}`
}

function formatToolParameters(parameters: Record<string, unknown>): string {
  const requiredValues = Array.isArray(parameters.required)
    ? parameters.required.filter((item): item is string => typeof item === "string")
    : []
  const required = new Set(requiredValues)
  const properties = isRecord(parameters.properties) ? parameters.properties : {}
  const entries = Object.entries(properties)
  if (entries.length === 0) {
    return "  - arguments: object optional — Use an empty object when the tool takes no named arguments."
  }
  return entries
    .map(([name, schema]) => formatParameterLine(name, schema, required))
    .join("\n")
}

export function formatTextToolManifest(tools: ToolSchema[]): string {
  if (tools.length === 0) {
    return "（当前没有可用工具）"
  }
  return tools.map((tool) => {
    const description = tool.description.trim() || "No description."
    return [
      `- ${tool.name}: ${description}`,
      "  arguments:",
      formatToolParameters(tool.parameters),
    ].join("\n")
  }).join("\n")
}
