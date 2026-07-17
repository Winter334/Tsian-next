import type { ContentPart } from "@tsian/contracts"
import type { ToolSchema } from "./tool-schemas"
import type {
  ParsedRuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolCall,
  RuntimeWorkspaceToolError,
  RuntimeWorkspaceToolObservation,
} from "./workspace-tools-types"
import { compactLargeValueForModel } from "./tool-memory"

export const TEXT_TOOL_CALLS_TAG = "tsian-tool-calls"
export const TEXT_TOOL_CALL_RECORDS_TAG = "tsian-tool-call-records"
export const TEXT_TOOL_OBSERVATIONS_TAG = "tsian-tool-observations"
export const TEXT_TOOL_PROTOCOL_ERROR_TAG = "tsian-tool-protocol-error"

export const TEXT_TOOL_CALLS_OPEN_TAG = `<${TEXT_TOOL_CALLS_TAG}>`
export const TEXT_TOOL_CALLS_CLOSE_TAG = `</${TEXT_TOOL_CALLS_TAG}>`

export const TEXT_TOOL_PROTOCOL_MAX_RETRIES = 1

export type TextToolProtocolParseResult =
  | { kind: "stop" }
  | { kind: "tool_calls"; calls: ParsedRuntimeWorkspaceToolCall[]; interimText: string }
  | { kind: "protocol_error"; error: RuntimeWorkspaceToolError; interimText: string }

export interface TextToolCallRecord {
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
const CALL_RECORDS_PATTERN = /<tsian-tool-call-records>\s*([\s\S]*?)\s*<\/tsian-tool-call-records>/g
const OBSERVATIONS_PATTERN = /<tsian-tool-observations>\s*([\s\S]*?)\s*<\/tsian-tool-observations>/g
const PROTOCOL_ERROR_PATTERN = /<tsian-tool-protocol-error>\s*([\s\S]*?)\s*<\/tsian-tool-protocol-error>/g

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

export function stripTextExecutableToolCalls(text: string): string {
  let result = replacePattern(text, EXECUTABLE_CALLS_PATTERN)
  const danglingOpenIndex = result.indexOf(TEXT_TOOL_CALLS_OPEN_TAG)
  if (danglingOpenIndex >= 0) {
    result = result.slice(0, danglingOpenIndex)
  }
  return result.split(TEXT_TOOL_CALLS_CLOSE_TAG).join("").trim()
}

export function stripTextProtocolArtifacts(text: string): string {
  let result = text
  for (const pattern of [
    EXECUTABLE_CALLS_PATTERN,
    CALL_RECORDS_PATTERN,
    OBSERVATIONS_PATTERN,
    PROTOCOL_ERROR_PATTERN,
  ]) {
    result = replacePattern(result, pattern)
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

export function parseTextToolProtocolResponse(text: string): TextToolProtocolParseResult {
  const matches = [...text.matchAll(clonePattern(EXECUTABLE_CALLS_PATTERN))]
  const openTagCount = countOccurrences(text, TEXT_TOOL_CALLS_OPEN_TAG)
  const closeTagCount = countOccurrences(text, TEXT_TOOL_CALLS_CLOSE_TAG)

  if (matches.length === 0) {
    if (openTagCount > 0 || closeTagCount > 0) {
      return {
        kind: "protocol_error",
        error: protocolError(
          "TEXT_TOOL_PROTOCOL_BLOCK_UNCLOSED",
          `A ${TEXT_TOOL_CALLS_OPEN_TAG} block must include exactly one matching ${TEXT_TOOL_CALLS_CLOSE_TAG}.`,
          { openTagCount, closeTagCount },
        ),
        interimText: stripTextExecutableToolCalls(text),
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

export function formatTextToolCallRecords(
  calls: RuntimeWorkspaceToolCall[],
): string {
  const records: TextToolCallRecord[] = calls.map((call, index) => ({
    id: call.id ?? `text-c${index}`,
    name: call.name,
    arguments: call.arguments,
  }))
  return `<${TEXT_TOOL_CALL_RECORDS_TAG}>${JSON.stringify(records)}</${TEXT_TOOL_CALL_RECORDS_TAG}>`
}

function compactToolErrorForText(
  error: RuntimeWorkspaceToolObservation["error"],
): RuntimeWorkspaceToolError | undefined {
  if (!error) return undefined
  return {
    code: error.code,
    message: error.message,
    ...(error.details === undefined ? {} : { details: compactLargeValueForModel(error.details) }),
  }
}

function compactToolObservationForText(
  call: RuntimeWorkspaceToolCall | undefined,
  observation: RuntimeWorkspaceToolObservation,
  index: number,
): TextToolObservationRecord {
  const id = call?.id ?? `text-c${index}`
  const name = call?.name ?? observation.name
  if (!observation.ok) {
    const error = compactToolErrorForText(observation.error)
    return {
      id,
      name,
      ok: false,
      ...(error ? { error } : {}),
    }
  }
  return {
    id,
    name,
    ok: true,
    ...(observation.result === undefined ? {} : { result: compactLargeValueForModel(observation.result) }),
  }
}

export function formatTextToolObservations(
  calls: RuntimeWorkspaceToolCall[],
  observations: RuntimeWorkspaceToolObservation[],
): { text: string; imageParts: ContentPart[] } {
  const records = observations.map((observation, index) =>
    compactToolObservationForText(calls[index], observation, index)
  )
  const imageParts = observations.flatMap((observation) => observation.imageParts ?? [])
  return {
    text: [
      "Text Tool Protocol observations:",
      `<${TEXT_TOOL_OBSERVATIONS_TAG}>${JSON.stringify(records)}</${TEXT_TOOL_OBSERVATIONS_TAG}>`,
      "Use these observations to continue. If you have enough context, provide the required final output without protocol tags.",
    ].join("\n"),
    imageParts,
  }
}

export function formatTextToolProtocolError(
  error: RuntimeWorkspaceToolError,
  retryRemaining: number,
): string {
  return [
    "Text Tool Protocol error:",
    `<${TEXT_TOOL_PROTOCOL_ERROR_TAG}>${JSON.stringify({ ok: false, error, retryRemaining })}</${TEXT_TOOL_PROTOCOL_ERROR_TAG}>`,
    retryRemaining > 0
      ? `Retry by emitting exactly one ${TEXT_TOOL_CALLS_OPEN_TAG} JSON array block, or answer normally without protocol tags if no tool call is needed.`
      : "Retry budget exhausted; the runtime will fail this turn.",
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
  if (message.role === "assistant" && text.includes(`<${TEXT_TOOL_CALL_RECORDS_TAG}>`)) return true
  if (message.role === "user" && text.includes(`<${TEXT_TOOL_OBSERVATIONS_TAG}>`)) return true
  if (message.role === "user" && text.includes(`<${TEXT_TOOL_PROTOCOL_ERROR_TAG}>`)) return true
  return false
}

export function extractTextToolNameFromMessage(message: MessageLike): string | undefined {
  const text = textFromContent(message.content)
  if (message.role === "assistant") {
    const records = parseFirstArrayTag(text, CALL_RECORDS_PATTERN)
    const first = records?.[0]
    if (isRecord(first) && typeof first.name === "string" && first.name.trim()) {
      return first.name.trim()
    }
  }
  if (message.role === "user") {
    const observations = parseFirstArrayTag(text, OBSERVATIONS_PATTERN)
    const first = observations?.[0]
    if (isRecord(first) && typeof first.name === "string" && first.name.trim()) {
      return first.name.trim()
    }
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
