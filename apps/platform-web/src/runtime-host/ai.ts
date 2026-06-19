import type { AiChatMessage, AiDebugRecord } from "@tsian/contracts"

import {
  getBrowserAiConfig,
  parseBrowserAiCustomRequestParams,
  type BrowserAiConfig,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
} from "../config/ai"
import type { ToolSchema } from "../agent-runtime/tool-schemas"

export type { AiChatMessage, AiDebugRecord }

/**
 * A structured Runtime tool call parsed from a native function-calling
 * response. Carries the provider-assigned id so tool observations can be
 * threaded back via `tool_call_id` (OpenAI/Claude) or matched function parts
 * (Gemini).
 */
export interface NativeToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

/**
 * Internal structured message sequence used by the native tool loop. Unlike the
 * flat `AiChatMessage` (debug/transcript-facing), this carries structured tool
 * calls and tool observations so adapters can build each provider's native
 * request shape without re-encoding ids from text.
 */
export type RuntimeChatMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string; toolCalls?: NativeToolCall[] }
  | { role: "tool"; toolCallId: string; content: string }

/**
 * Structured result of one native model call. `text` is the user-visible
 * assistant content (without tool-call blocks); `toolCalls` holds parsed native
 * calls when the model wants to invoke tools; `raw` is the full original
 * response text for transcript records; `finishReason` tells the loop whether
 * to stop (`stop`) or execute tools (`tool_calls`).
 */
export interface ModelCallResult {
  text: string
  toolCalls: NativeToolCall[]
  raw: string
  finishReason: "stop" | "tool_calls"
}

export interface GenerateAssistantReplyOptions {
  debugLabel?: string
  config?: BrowserAiConfig | null
  signal?: AbortSignal
}

let aiDebugSequence = 0
const aiDebugRecords: AiDebugRecord[] = []
const MAX_AI_DEBUG_RECORDS = 20
const DEFAULT_CHAT_TIMEOUT_MS = 600_000

function pushAiDebugRecord(record: AiDebugRecord): void {
  aiDebugRecords.unshift(record)
  aiDebugRecords.splice(MAX_AI_DEBUG_RECORDS)
}

function updateAiDebugRecord(id: string, patch: Partial<AiDebugRecord>): void {
  const index = aiDebugRecords.findIndex((record) => record.id === id)
  if (index < 0) {
    return
  }

  aiDebugRecords[index] = {
    ...aiDebugRecords[index],
    ...patch,
  }
}

export function getAiDebugRecords(): AiDebugRecord[] {
  return aiDebugRecords.map((record) => ({
    ...record,
    messages: record.messages?.map((message) => ({ ...message })),
    input: record.input ? [...record.input] : undefined,
  }))
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "***"
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function previewText(value: string, maxLength = 1600): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}\n...[truncated ${normalized.length - maxLength} chars]`
}

function logDebugGroup(
  title: string,
  payload: Record<string, unknown>,
): void {
  console.groupCollapsed(title)
  console.debug(payload)
  console.groupEnd()
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

async function readJsonPayload(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return null
  }
}

function createTimedAbortSignal(input: {
  signal?: AbortSignal
  timeoutMs: number
  timeoutMessage: string
}): {
  signal: AbortSignal
  cleanup: () => void
  timedOut: () => boolean
} {
  const controller = new AbortController()
  let didTimeout = false

  const abortFromParent = () => {
    controller.abort(input.signal?.reason)
  }

  if (input.signal?.aborted) {
    abortFromParent()
  } else if (input.signal) {
    input.signal.addEventListener("abort", abortFromParent, { once: true })
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true
    controller.abort(new Error(input.timeoutMessage))
  }, input.timeoutMs)

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId)
      input.signal?.removeEventListener("abort", abortFromParent)
    },
    timedOut() {
      return didTimeout
    },
  }
}

async function fetchJsonWithTimeout(input: {
  url: string
  init: RequestInit
  signal?: AbortSignal
  timeoutMs: number
  timeoutMessage: string
}): Promise<{ response: Response; payload: unknown }> {
  const timed = createTimedAbortSignal({
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    timeoutMessage: input.timeoutMessage,
  })

  try {
    const response = await fetch(input.url, {
      ...input.init,
      signal: timed.signal,
    })
    const payload = await readJsonPayload(response)
    return { response, payload }
  } catch (error) {
    if (timed.timedOut()) {
      throw new Error(input.timeoutMessage)
    }
    throw error
  } finally {
    timed.cleanup()
  }
}

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`
}

function putOptionalNumber(
  target: Record<string, unknown>,
  key: string,
  value: number | null,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value
  }
}

function buildChatCompletionsRequestBody(input: {
  model: string
  messages: AiChatMessage[]
  parameters: BrowserAiModelParameters
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  }

  putOptionalNumber(body, "max_tokens", input.parameters.maxOutputTokens)
  putOptionalNumber(body, "temperature", input.parameters.temperature)
  putOptionalNumber(body, "top_p", input.parameters.topP)
  putOptionalNumber(body, "frequency_penalty", input.parameters.frequencyPenalty)
  putOptionalNumber(body, "presence_penalty", input.parameters.presencePenalty)

  if (input.parameters.reasoningEffort) {
    body.reasoning_effort = input.parameters.reasoningEffort
  }

  return {
    ...body,
    ...parseBrowserAiCustomRequestParams(input.parameters.customRequestParamsText),
    model: input.model,
    messages: input.messages,
  }
}

function extractUsageFromPayload(
  payload: unknown,
): { input?: number; output?: number; total?: number } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined
  const usage = (payload as { usage?: unknown }).usage
  if (typeof usage !== "object" || usage === null) return undefined

  const u = usage as Record<string, unknown>
  const pickNum = (key: string): number | undefined => {
    const v = u[key]
    return typeof v === "number" && Number.isFinite(v) ? v : undefined
  }

  const input = pickNum("prompt_tokens") ?? pickNum("input_tokens")
  const output = pickNum("completion_tokens") ?? pickNum("output_tokens")
  const total =
    pickNum("total_tokens") ??
    (typeof input === "number" && typeof output === "number" ? input + output : undefined)

  if (input === undefined && output === undefined && total === undefined) {
    return undefined
  }
  return { input, output, total }
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const error = (payload as { error?: unknown }).error
  if (typeof error !== "object" || error === null) {
    return undefined
  }

  const message = (error as { message?: unknown }).message
  return typeof message === "string" ? message : undefined
}

function extractAssistantText(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "choices" in payload &&
    Array.isArray(payload.choices) &&
    payload.choices.length > 0
  ) {
    const message = payload.choices[0]?.message
    const content = message?.content

    if (typeof content === "string") {
      return content
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (typeof item?.text === "string") {
            return item.text
          }
          return ""
        })
        .join("")
        .trim()
    }
  }

  throw new Error("AI response format is not supported.")
}

// ---------------------------------------------------------------------------
// Provider adapters — one per protocol kind. Each adapter knows how to build
// the chat-request URL/headers/body and parse the assistant text out of the
// response. The OpenAI adapter preserves the original behavior byte-for-byte;
// Gemini and Claude convert the internal OpenAI-style {role, content} messages
// to their native shapes.
// ---------------------------------------------------------------------------

interface ProviderAdapter {
  buildUrl(config: BrowserAiConfig): string
  buildHeaders(config: BrowserAiConfig): Record<string, string>
  buildRequestBody(config: BrowserAiConfig, messages: AiChatMessage[]): Record<string, unknown>
  extractText(payload: unknown): string
  /**
   * Build a request body that injects native `tools` (function-calling schemas)
   * and serializes `RuntimeChatMessage[]` — including the assistant `toolCalls`
   * and `tool` observation role — into this provider's native message format.
   * Returns the full request body (merged with model parameters + custom params).
   */
  buildNativeRequestBody(
    config: BrowserAiConfig,
    messages: RuntimeChatMessage[],
    tools: ToolSchema[],
  ): Record<string, unknown>
  /**
   * Parse a complete (non-streaming) native response into a structured
   * `ModelCallResult`, splitting text from tool calls and reporting the
   * provider's finish reason.
   */
  extractNativeResult(payload: unknown): ModelCallResult
}

const openaiAdapter: ProviderAdapter = {
  buildUrl(config) {
    return buildChatCompletionsUrl(config.baseUrl)
  },
  buildHeaders(config) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    }
  },
  buildRequestBody(config, messages) {
    return buildChatCompletionsRequestBody({
      model: config.model,
      messages,
      parameters: config.parameters,
    })
  },
  extractText: extractAssistantText,
  buildNativeRequestBody(config, messages, tools) {
    const body = buildChatCompletionsRequestBody({
      model: config.model,
      messages: [],
      parameters: config.parameters,
    })
    body.messages = messages.map((message) => {
      if (message.role === "tool") {
        return {
          role: "tool",
          tool_call_id: message.toolCallId,
          content: message.content,
        }
      }
      if (message.role === "assistant") {
        const entry: Record<string, unknown> = {
          role: "assistant",
          content: message.content,
        }
        if (message.toolCalls && message.toolCalls.length > 0) {
          entry.tool_calls = message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
          }))
        }
        return entry
      }
      return { role: message.role, content: message.content }
    })
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
    return body
  },
  extractNativeResult(payload) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { choices?: unknown }).choices) ||
      (payload as { choices: unknown[] }).choices.length === 0
    ) {
      throw new Error("AI response format is not supported.")
    }
    const choice = (payload as { choices: Array<Record<string, unknown>> }).choices[0]
    const message = (choice?.message ?? {}) as {
      content?: string | Array<{ text?: string }>
      tool_calls?: Array<{
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    const text =
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .map((item) => (typeof item?.text === "string" ? item.text : ""))
              .join("")
              .trim()
          : ""
    const toolCalls: NativeToolCall[] = []
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const name = call.function?.name
        const id = call.id
        if (!name || !id) {
          continue
        }
        let args: Record<string, unknown> = {}
        const rawArgs = call.function?.arguments
        if (typeof rawArgs === "string") {
          try {
            const parsed = JSON.parse(rawArgs)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>
            }
          } catch {
            // Leave empty arguments; runtime surfaces a structured error.
          }
        } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
          args = rawArgs as Record<string, unknown>
        }
        toolCalls.push({ id, name, arguments: args })
      }
    }
    const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : ""
    return {
      text,
      toolCalls,
      raw: text,
      finishReason: toolCalls.length > 0 || finishReason === "tool_calls" ? "tool_calls" : "stop",
    }
  },
}

/** Split OpenAI-style messages into a system prompt + non-system messages. */
function splitSystemMessage(messages: AiChatMessage[]): { system: string | undefined; rest: AiChatMessage[] } {
  const systemParts: string[] = []
  const rest: AiChatMessage[] = []
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(message.content)
      }
    } else {
      rest.push(message)
    }
  }
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, rest }
}

/**
 * Split structured `RuntimeChatMessage[]` into a system prompt + the
 * non-system sequence (user/assistant/tool), preserving tool-call and tool-
 * observation payloads. Used by native adapters that carry a separate system
 * field (Gemini, Claude).
 */
function splitSystemMessages(
  messages: RuntimeChatMessage[],
): { system: string | undefined; rest: RuntimeChatMessage[] } {
  const systemParts: string[] = []
  const rest: RuntimeChatMessage[] = []
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(message.content)
      }
    } else {
      rest.push(message)
    }
  }
  return { system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, rest }
}

/** Serialize one `RuntimeChatMessage` into a Gemini `content` entry. */
function buildGeminiNativeContent(message: RuntimeChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    // Gemini threads tool observations back as a user turn carrying a
    // functionResponse part keyed by the originating call id.
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            id: message.toolCallId,
            name: message.toolCallId,
            response: { result: message.content },
          },
        },
      ],
    }
  }
  if (message.role === "assistant") {
    const parts: Array<Record<string, unknown>> = []
    if (message.content) {
      parts.push({ text: message.content })
    }
    if (message.toolCalls) {
      for (const call of message.toolCalls) {
        parts.push({
          functionCall: { id: call.id, name: call.name, args: call.arguments },
        })
      }
    }
    return { role: "model", parts }
  }
  return { role: "user", parts: [{ text: message.content }] }
}

/** Serialize one `RuntimeChatMessage` into a Claude `messages` entry. */
function buildClaudeNativeMessage(message: RuntimeChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    // Claude threads tool observations back as a user turn carrying a
    // tool_result block keyed by the originating tool_use id.
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: message.content,
        },
      ],
    }
  }
  if (message.role === "assistant") {
    const content: Array<Record<string, unknown>> = []
    if (message.content) {
      content.push({ type: "text", text: message.content })
    }
    if (message.toolCalls) {
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments,
        })
      }
    }
    return { role: "assistant", content }
  }
  return { role: "user", content: message.content }
}

const geminiAdapter: ProviderAdapter = {
  buildUrl(config) {
    const base = config.baseUrl.replace(/\/+$/, "")
    // model goes in the path; key is sent via header.
    return `${base}/models/${encodeURIComponent(config.model)}:generateContent`
  },
  buildHeaders(config) {
    return {
      "Content-Type": "application/json",
      "x-goog-api-key": config.apiKey,
    }
  },
  buildRequestBody(config, messages) {
    const { system, rest } = splitSystemMessage(messages)
    const generationConfig: Record<string, unknown> = {}
    putOptionalNumber(generationConfig, "maxOutputTokens", config.parameters.maxOutputTokens)
    putOptionalNumber(generationConfig, "temperature", config.parameters.temperature)
    putOptionalNumber(generationConfig, "topP", config.parameters.topP)
    putOptionalNumber(generationConfig, "frequencyPenalty", config.parameters.frequencyPenalty)
    putOptionalNumber(generationConfig, "presencePenalty", config.parameters.presencePenalty)

    const body: Record<string, unknown> = {
      contents: rest.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig,
    }
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] }
    }
    // reasoning_effort is forwarded as-is for all provider kinds; providers that
    // don't support it should be left on "do not send" and tuned via custom params.
    if (config.parameters.reasoningEffort) {
      body.generationConfig = { ...generationConfig, reasoning_effort: config.parameters.reasoningEffort }
    }
    return {
      ...body,
      ...parseBrowserAiCustomRequestParams(config.parameters.customRequestParamsText),
      ...body,
    }
  },
  extractText(payload) {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "candidates" in payload &&
      Array.isArray(payload.candidates) &&
      payload.candidates.length > 0
    ) {
      const parts = payload.candidates[0]?.content?.parts
      if (Array.isArray(parts)) {
        return parts
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .join("")
          .trim()
      }
    }
    throw new Error("Gemini response format is not supported.")
  },
  buildNativeRequestBody(config, messages, tools) {
    const { system, rest } = splitSystemMessages(messages)
    const generationConfig: Record<string, unknown> = {}
    putOptionalNumber(generationConfig, "maxOutputTokens", config.parameters.maxOutputTokens)
    putOptionalNumber(generationConfig, "temperature", config.parameters.temperature)
    putOptionalNumber(generationConfig, "topP", config.parameters.topP)
    putOptionalNumber(generationConfig, "frequencyPenalty", config.parameters.frequencyPenalty)
    putOptionalNumber(generationConfig, "presencePenalty", config.parameters.presencePenalty)

    const body: Record<string, unknown> = {
      contents: rest.map((message) => buildGeminiNativeContent(message)),
      generationConfig,
      tools: [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ],
    }
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] }
    }
    if (config.parameters.reasoningEffort) {
      body.generationConfig = { ...generationConfig, reasoning_effort: config.parameters.reasoningEffort }
    }
    return {
      ...body,
      ...parseBrowserAiCustomRequestParams(config.parameters.customRequestParamsText),
      ...body,
    }
  },
  extractNativeResult(payload) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { candidates?: unknown }).candidates) ||
      (payload as { candidates: unknown[] }).candidates.length === 0
    ) {
      throw new Error("Gemini response format is not supported.")
    }
    const candidate = (payload as { candidates: Array<Record<string, unknown>> }).candidates[0]
    const parts = (candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts
    const textParts: string[] = []
    const toolCalls: NativeToolCall[] = []
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (typeof part.text === "string") {
          textParts.push(part.text)
        }
        const functionCall = part.functionCall as
          | { name?: string; id?: string; args?: Record<string, unknown> }
          | undefined
        if (functionCall && typeof functionCall.name === "string") {
          toolCalls.push({
            // Gemini functionCall ids are optional; synthesize a stable id when
            // absent so the tool observation can be threaded back via a matching
            // functionResponse.
            id: typeof functionCall.id === "string" && functionCall.id
              ? functionCall.id
              : `gemini-call-${toolCalls.length}`,
            name: functionCall.name,
            arguments: functionCall.args ?? {},
          })
        }
      }
    }
    const finishReason = typeof candidate.finishReason === "string" ? candidate.finishReason : ""
    const text = textParts.join("").trim()
    return {
      text,
      toolCalls,
      raw: text,
      // Gemini reports "STOP" for plain text and "TOOL_CODE" / similar when tools fire.
      finishReason:
        toolCalls.length > 0 || /tool/i.test(finishReason) ? "tool_calls" : "stop",
    }
  },
}

const claudeAdapter: ProviderAdapter = {
  buildUrl(config) {
    return `${config.baseUrl.replace(/\/+$/, "")}/messages`
  },
  buildHeaders(config) {
    return {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    }
  },
  buildRequestBody(config, messages) {
    const { system, rest } = splitSystemMessage(messages)
    const body: Record<string, unknown> = {
      model: config.model,
      messages: rest.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })),
      // Claude requires max_tokens; fall back to a sane default when unset.
      max_tokens: config.parameters.maxOutputTokens ?? 4096,
    }
    if (system) {
      body.system = system
    }
    putOptionalNumber(body, "temperature", config.parameters.temperature)
    putOptionalNumber(body, "top_p", config.parameters.topP)
    // reasoning_effort is forwarded as-is for all provider kinds; providers that
    // don't support it should be left on "do not send" and tuned via custom params.
    if (config.parameters.reasoningEffort) {
      body.reasoning_effort = config.parameters.reasoningEffort
    }
    return {
      ...body,
      ...parseBrowserAiCustomRequestParams(config.parameters.customRequestParamsText),
      model: config.model,
      messages: body.messages,
      max_tokens: body.max_tokens,
    }
  },
  extractText(payload) {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "content" in payload &&
      Array.isArray(payload.content)
    ) {
      return payload.content
        .map((block) => (typeof block?.text === "string" ? block.text : ""))
        .join("")
        .trim()
    }
    throw new Error("Claude response format is not supported.")
  },
  buildNativeRequestBody(config, messages, tools) {
    const { system, rest } = splitSystemMessages(messages)
    const body: Record<string, unknown> = {
      model: config.model,
      messages: rest.map((message) => buildClaudeNativeMessage(message)),
      // Claude requires max_tokens; fall back to a sane default when unset.
      max_tokens: config.parameters.maxOutputTokens ?? 4096,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      })),
    }
    if (system) {
      body.system = system
    }
    putOptionalNumber(body, "temperature", config.parameters.temperature)
    putOptionalNumber(body, "top_p", config.parameters.topP)
    if (config.parameters.reasoningEffort) {
      body.reasoning_effort = config.parameters.reasoningEffort
    }
    return {
      ...body,
      ...parseBrowserAiCustomRequestParams(config.parameters.customRequestParamsText),
      model: config.model,
      messages: body.messages,
      max_tokens: body.max_tokens,
      tools: body.tools,
    }
  },
  extractNativeResult(payload) {
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { content?: unknown }).content)
    ) {
      throw new Error("Claude response format is not supported.")
    }
    const blocks = (payload as { content: Array<Record<string, unknown>> }).content
    const textParts: string[] = []
    const toolCalls: NativeToolCall[] = []
    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text)
      }
      if (block.type === "tool_use") {
        const name = typeof block.name === "string" ? block.name : ""
        const id = typeof block.id === "string" ? block.id : ""
        if (!name || !id) {
          continue
        }
        const input =
          block.input && typeof block.input === "object" && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : {}
        toolCalls.push({ id, name, arguments: input })
      }
    }
    const stopReason = typeof (payload as { stop_reason?: unknown }).stop_reason === "string"
      ? (payload as { stop_reason: string }).stop_reason
      : ""
    const text = textParts.join("").trim()
    return {
      text,
      toolCalls,
      raw: text,
      // Claude reports "tool_use" when the model wants to call tools.
      finishReason:
        toolCalls.length > 0 || stopReason === "tool_use" ? "tool_calls" : "stop",
    }
  },
}

function selectAdapter(kind: BrowserAiProviderKind): ProviderAdapter {
  if (kind === "gemini") {
    return geminiAdapter
  }
  if (kind === "claude") {
    return claudeAdapter
  }
  // deepseek is OpenAI-compatible and reuses the openai adapter.
  return openaiAdapter
}

export async function generateAssistantReply(
  messages: AiChatMessage[],
  options: GenerateAssistantReplyOptions = {},
): Promise<string> {
  const config = options.config ?? getBrowserAiConfig()

  if (!config) {
    throw new Error(
      "AI config is missing. Please configure an OpenAI-compatible provider in Control Panel.",
    )
  }

  const requestId = `${options.debugLabel ?? "chat"}-${++aiDebugSequence}`
  const adapter = selectAdapter(config.kind)
  const url = adapter.buildUrl(config)
  const requestBody = adapter.buildRequestBody(config, messages)
  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat",
    model: config.model,
    createdAt: new Date().toISOString(),
    messages: messages.map((message) => ({ ...message })),
  })

  logDebugGroup(`[Tsian AI ${requestId}] request`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    requestKeys: Object.keys(requestBody),
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content: previewText(message.content),
    })),
  })

  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${DEFAULT_CHAT_TIMEOUT_MS} ms.`
  let response: Response
  let payload: unknown
  try {
    ;({ response, payload } = await fetchJsonWithTimeout({
      url,
      init: {
        method: "POST",
        headers: adapter.buildHeaders(config),
        body: JSON.stringify(requestBody),
      },
      signal: options.signal,
      timeoutMs: DEFAULT_CHAT_TIMEOUT_MS,
      timeoutMessage,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Tsian AI ${requestId}] error`, { error })
    updateAiDebugRecord(requestId, { error: message })
    throw error
  }

  if (!response.ok) {
    console.warn(`[Tsian AI ${requestId}] error`, {
      status: response.status,
      payload,
    })
    const message = extractErrorMessage(payload) ?? `AI request failed with status ${response.status}.`
    updateAiDebugRecord(requestId, { error: message })
    throw new Error(message)
  }

  const content = adapter.extractText(payload)
  const usage = extractUsageFromPayload(payload)
  updateAiDebugRecord(requestId, { responseText: content, usage })

  logDebugGroup(`[Tsian AI ${requestId}] response`, {
    content: previewText(content, 2400),
    payload,
  })

  return content
}

export interface GenerateAssistantReplyNativeOptions extends GenerateAssistantReplyOptions {
  /** Native tool schemas to advertise; empty means a native call without tools. */
  tools?: ToolSchema[]
}

/**
 * Native function-calling variant of `generateAssistantReply`. Sends the
 * provider's native `tools` field plus structured `RuntimeChatMessage[]`
 * (assistant tool calls + tool observations), and parses the structured
 * `ModelCallResult` (text / toolCalls / finishReason). Used by the Agent
 * Runtime native tool loop when `toolCallMode === "native"`.
 */
export async function generateAssistantReplyNative(
  messages: RuntimeChatMessage[],
  options: GenerateAssistantReplyNativeOptions = {},
): Promise<ModelCallResult> {
  const config = options.config ?? getBrowserAiConfig()

  if (!config) {
    throw new Error(
      "AI config is missing. Please configure an OpenAI-compatible provider in Control Panel.",
    )
  }

  const requestId = `${options.debugLabel ?? "chat-native"}-${++aiDebugSequence}`
  const adapter = selectAdapter(config.kind)
  const url = adapter.buildUrl(config)
  const tools = options.tools ?? []
  const requestBody = adapter.buildNativeRequestBody(config, messages, tools)

  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat-native",
    model: config.model,
    createdAt: new Date().toISOString(),
    messages: messages.map((message): AiChatMessage => {
      if (message.role === "tool") {
        // Debug/transcript uses the flat AiChatMessage shape; thread tool
        // observations back as a user turn carrying the observation text.
        return { role: "user", content: `[tool:${message.toolCallId}] ${message.content}` }
      }
      return { role: message.role, content: message.content }
    }),
  })

  logDebugGroup(`[Tsian AI ${requestId}] native request`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    requestKeys: Object.keys(requestBody),
    toolCount: tools.length,
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content:
        message.role === "tool"
          ? previewText(`[tool:${message.toolCallId}] ${message.content}`)
          : previewText(message.content),
    })),
  })

  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${DEFAULT_CHAT_TIMEOUT_MS} ms.`
  let response: Response
  let payload: unknown
  try {
    ;({ response, payload } = await fetchJsonWithTimeout({
      url,
      init: {
        method: "POST",
        headers: adapter.buildHeaders(config),
        body: JSON.stringify(requestBody),
      },
      signal: options.signal,
      timeoutMs: DEFAULT_CHAT_TIMEOUT_MS,
      timeoutMessage,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Tsian AI ${requestId}] error`, { error })
    updateAiDebugRecord(requestId, { error: message })
    throw error
  }

  if (!response.ok) {
    console.warn(`[Tsian AI ${requestId}] error`, {
      status: response.status,
      payload,
    })
    const message = extractErrorMessage(payload) ?? `AI request failed with status ${response.status}.`
    updateAiDebugRecord(requestId, { error: message })
    throw new Error(message)
  }

  const result = adapter.extractNativeResult(payload)
  const usage = extractUsageFromPayload(payload)
  updateAiDebugRecord(requestId, { responseText: result.raw, usage })

  logDebugGroup(`[Tsian AI ${requestId}] native response`, {
    text: previewText(result.text, 2400),
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
    payload,
  })

  return result
}
