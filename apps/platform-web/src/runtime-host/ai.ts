import type { AiChatMessage, AiDebugRecord, ContentPart } from "@tsian/contracts"

import {
  getBrowserAiConfig,
  parseBrowserAiCustomRequestParams,
  type BrowserAiConfig,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
} from "../config/ai"
import type { ToolSchema } from "../agent-runtime/tool-schemas"

export type { AiChatMessage, AiDebugRecord }
export type { ContentPart }

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
 * flat `AiChatMessage` (debug-facing), this carries structured tool
 * calls and tool observations so adapters can build each provider's native
 * request shape without re-encoding ids from text.
 */
export type RuntimeChatMessage =
  | { role: "user" | "system"; content: string | ContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: NativeToolCall[] }
  | { role: "tool"; toolCallId: string; content: string }

/** 将 message content 安全转为文本 preview(debug/logging 用). ContentPart[] 时提取 text part,忽略 image. */
function contentToTextPreview(content: string | ContentPart[]): string {
  if (typeof content === "string") return content
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("")
}

/** Build OpenAI-native content: string → string, ContentPart[] → content blocks
 *  (text + image_url data URL). Used by openaiAdapter user/system branches. */
function buildOpenAiContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text }
    return { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
  })
}

/** Build Claude-native content: string → string, ContentPart[] → content blocks
 *  (text + image source base64). Used by claudeAdapter user branches. */
function buildClaudeContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map((part) => {
    if (part.type === "text") return { type: "text", text: part.text }
    return { type: "image", source: { type: "base64", media_type: part.mimeType, data: part.data } }
  })
}

/** Build Gemini-native parts: string → [{text}], ContentPart[] →
 *  [{text} | {inlineData}]. Used by geminiAdapter user branches. */
function buildGeminiParts(content: string | ContentPart[]): unknown[] {
  if (typeof content === "string") return [{ text: content }]
  return content.map((part) => {
    if (part.type === "text") return { text: part.text }
    return { inlineData: { mimeType: part.mimeType, data: part.data } }
  })
}

/**
 * Structured result of one native model call. `text` is the user-visible
 * assistant content (without tool-call blocks); `toolCalls` holds parsed native
 * calls when the model wants to invoke tools; `raw` is the full original
 * response text for debug records; `finishReason` tells the loop whether
 * to stop (`stop`) or execute tools (`tool_calls`).
 */
export interface ModelCallResult {
  text: string
  toolCalls: NativeToolCall[]
  raw: string
  finishReason: "stop" | "tool_calls"
  /**
   * Provider-reported token usage for this call (when available).
   * `input` = prompt_tokens (current context size sent to the model),
   * `output` = completion_tokens, `total` = sum or provider-reported total.
   * Surface for context-window visualization; undefined when the provider
   * omits usage or the streaming path couldn't extract it.
   */
  usage?: { input?: number; output?: number; total?: number }
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
  /**
   * Build the SSE endpoint URL. OpenAI/Claude reuse `buildUrl`; Gemini switches
   * `generateContent` → `streamGenerateContent?alt=sse` (streaming is opt-in via
   * the URL rather than a request-body flag).
   */
  buildStreamUrl(config: BrowserAiConfig): string
  /**
   * Build a streaming request body. OpenAI/Claude inject `stream: true` into
   * the native body; Gemini reuses the native body unchanged (streaming is
   * controlled by the URL). `stream: true` is assigned after the custom-params
   * merge so a user `stream` value cannot override the adapter's setting.
   */
  buildStreamRequestBody(
    config: BrowserAiConfig,
    messages: RuntimeChatMessage[],
    tools: ToolSchema[],
  ): Record<string, unknown>
  /**
   * Extract the visible text delta (the assistant's reply content, not its
   * chain-of-thought) from one parsed SSE `data:` payload. Returns `undefined`
   * when this chunk carries no content delta. Reasoning/thinking deltas are
   * extracted separately via `extractStreamReasoningDelta` so callers can route
   * them to a distinct (typically collapsed) UI region and keep `result.text`
   * free of chain-of-thought text.
   */
  extractStreamDelta(data: unknown): string | undefined
  /**
   * Extract the reasoning/thinking delta from one parsed SSE `data:` payload.
   * OpenAI-compatible reasoning models (DeepSeek-R1 等) stream this as
   * `delta.reasoning_content`; Claude streams it as `content_block_delta` with
   * `delta.type === "thinking_delta"`. Returns `undefined` when this chunk
   * carries no reasoning delta or the provider has no separate reasoning
   * stream (Gemini). Optional — adapters without a reasoning field omit it.
   */
  extractStreamReasoningDelta?(data: unknown): string | undefined
  /**
   * Extract tool-call deltas from one parsed SSE payload. OpenAI streams
   * `tool_calls` arguments incrementally (keyed by `index`); Gemini emits a
     complete `functionCall` part at once; Claude emits `content_block_start`
     (tool_use id/name) then `input_json_delta` chunks. The stream loop merges
     these into `NativeToolCall[]` keyed by index/id.
   */
  extractStreamToolCalls(
    data: unknown,
    context: { event?: string; accumulator: Map<number, { id: string; name: string; args: string }> },
  ): void
  /**
   * Extract the finish reason from one parsed SSE payload. Returns `undefined`
   * until the terminating chunk arrives.
   */
  extractStreamFinish(data: unknown): "stop" | "tool_calls" | undefined
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
      return { role: message.role, content: buildOpenAiContent(message.content) }
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
  buildStreamUrl(config) {
    return buildChatCompletionsUrl(config.baseUrl)
  },
  buildStreamRequestBody(config, messages, tools) {
    const body = this.buildNativeRequestBody(config, messages, tools)
    body.stream = true
    return body
  },
  extractStreamDelta(data) {
    if (typeof data !== "object" || data === null) return undefined
    const choices = (data as { choices?: Array<Record<string, unknown>> }).choices
    if (!Array.isArray(choices) || choices.length === 0) return undefined
    const delta = (choices[0]?.delta ?? {}) as {
      content?: string | Array<{ text?: string }>
    }
    if (typeof delta.content === "string") return delta.content
    if (Array.isArray(delta.content)) {
      const joined = delta.content
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .join("")
      return joined.length > 0 ? joined : undefined
    }
    return undefined
  },
  extractStreamReasoningDelta(data) {
    // OpenAI-compatible reasoning models (DeepSeek-R1 等) stream chain-of-thought
    // as `delta.reasoning_content`. Distinct from `delta.content` (the reply) so
    // callers can route it to a collapsed "思考" region without polluting result.text.
    if (typeof data !== "object" || data === null) return undefined
    const choices = (data as { choices?: Array<Record<string, unknown>> }).choices
    if (!Array.isArray(choices) || choices.length === 0) return undefined
    const delta = (choices[0]?.delta ?? {}) as { reasoning_content?: string }
    return typeof delta.reasoning_content === "string" ? delta.reasoning_content : undefined
  },
  extractStreamToolCalls(data, context) {
    if (typeof data !== "object" || data === null) return
    const choices = (data as { choices?: Array<Record<string, unknown>> }).choices
    if (!Array.isArray(choices) || choices.length === 0) return
    const delta = (choices[0]?.delta ?? {}) as {
      tool_calls?: Array<{
        index?: number
        id?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    if (!Array.isArray(delta.tool_calls)) return
    for (const call of delta.tool_calls) {
      const index = typeof call.index === "number" ? call.index : context.accumulator.size
      const existing = context.accumulator.get(index)
      if (existing) {
        if (typeof call.function?.arguments === "string") {
          existing.args += call.function.arguments
        }
      } else {
        const id = typeof call.id === "string" ? call.id : `openai-call-${index}`
        const name = typeof call.function?.name === "string" ? call.function.name : ""
        const args = typeof call.function?.arguments === "string" ? call.function.arguments : ""
        context.accumulator.set(index, { id, name, args })
      }
    }
  },
  extractStreamFinish(data) {
    if (typeof data !== "object" || data === null) return undefined
    const choices = (data as { choices?: Array<Record<string, unknown>> }).choices
    if (!Array.isArray(choices) || choices.length === 0) return undefined
    const reason = choices[0]?.finish_reason
    if (typeof reason !== "string" || !reason) return undefined
    return reason === "tool_calls" ? "tool_calls" : "stop"
  },
}

/** Split OpenAI-style messages into a system prompt + non-system messages. */
function splitSystemMessage(messages: AiChatMessage[]): { system: string | undefined; rest: AiChatMessage[] } {
  const systemParts: string[] = []
  const rest: AiChatMessage[] = []
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content) {
        systemParts.push(contentToTextPreview(message.content))
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
        systemParts.push(contentToTextPreview(message.content))
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
  return { role: "user", parts: buildGeminiParts(message.content) }
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
  return { role: "user", content: buildClaudeContent(message.content) }
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
        parts: buildGeminiParts(message.content),
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
  buildStreamUrl(config) {
    const base = config.baseUrl.replace(/\/+$/, "")
    return `${base}/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`
  },
  buildStreamRequestBody(config, messages, tools) {
    // Gemini controls streaming via the URL; the body is the native shape.
    return this.buildNativeRequestBody(config, messages, tools)
  },
  extractStreamDelta(data) {
    if (typeof data !== "object" || data === null) return undefined
    const candidates = (data as { candidates?: Array<Record<string, unknown>> }).candidates
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    const parts = (candidates[0]?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts
    if (!Array.isArray(parts)) return undefined
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("")
    return text.length > 0 ? text : undefined
  },
  extractStreamToolCalls(data, context) {
    if (typeof data !== "object" || data === null) return
    const candidates = (data as { candidates?: Array<Record<string, unknown>> }).candidates
    if (!Array.isArray(candidates) || candidates.length === 0) return
    const parts = (candidates[0]?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts
    if (!Array.isArray(parts)) return
    for (const part of parts) {
      const functionCall = part.functionCall as
        | { name?: string; id?: string; args?: Record<string, unknown> }
        | undefined
      if (functionCall && typeof functionCall.name === "string") {
        const index = context.accumulator.size
        const id = typeof functionCall.id === "string" && functionCall.id
          ? functionCall.id
          : `gemini-call-${index}`
        // Gemini emits a complete functionCall at once (no incremental args).
        context.accumulator.set(index, {
          id,
          name: functionCall.name,
          args: JSON.stringify(functionCall.args ?? {}),
        })
      }
    }
  },
  extractStreamFinish(data) {
    if (typeof data !== "object" || data === null) return undefined
    const candidates = (data as { candidates?: Array<Record<string, unknown>> }).candidates
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined
    const reason = candidates[0]?.finishReason
    if (typeof reason !== "string" || !reason) return undefined
    return /tool/i.test(reason) ? "tool_calls" : "stop"
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
        content: message.role === "assistant" ? message.content : buildClaudeContent(message.content),
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
  buildStreamUrl(config) {
    return `${config.baseUrl.replace(/\/+$/, "")}/messages`
  },
  buildStreamRequestBody(config, messages, tools) {
    const body = this.buildNativeRequestBody(config, messages, tools)
    body.stream = true
    return body
  },
  extractStreamDelta(data) {
    if (typeof data !== "object" || data === null) return undefined
    const delta = (data as { delta?: { text?: string } }).delta
    return typeof delta?.text === "string" ? delta.text : undefined
  },
  extractStreamReasoningDelta(data) {
    // Claude extended thinking streams as `content_block_delta` with
    // `delta.type === "thinking_delta"` and the text in `delta.thinking`.
    // `delta.text` (the reply) is carried by `text_delta` blocks, already
    // handled by extractStreamDelta above.
    if (typeof data !== "object" || data === null) return undefined
    const delta = (data as { delta?: { type?: string; thinking?: string } }).delta
    if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
      return delta.thinking
    }
    return undefined
  },
  extractStreamToolCalls(data, context) {
    if (typeof data !== "object" || data === null) return
    const event = context.event
    if (event === "content_block_start") {
      const block = (data as { index?: number; content_block?: { type?: string; id?: string; name?: string } })
        .content_block
      if (block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
        const index = typeof (data as { index?: number }).index === "number"
          ? (data as { index: number }).index
          : context.accumulator.size
        context.accumulator.set(index, { id: block.id, name: block.name, args: "" })
      }
    } else if (event === "content_block_delta") {
      const delta = (data as { index?: number; delta?: { type?: string; partial_json?: string } }).delta
      if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const index = typeof (data as { index?: number }).index === "number"
          ? (data as { index: number }).index
          : -1
        const existing = index >= 0 ? context.accumulator.get(index) : undefined
        if (existing) {
          existing.args += delta.partial_json
        }
      }
    }
  },
  extractStreamFinish(data) {
    if (typeof data !== "object" || data === null) return undefined
    // Claude emits `message_delta` carrying the final `stop_reason`.
    const delta = (data as { delta?: { stop_reason?: string } }).delta
    if (typeof delta?.stop_reason !== "string" || !delta.stop_reason) return undefined
    return delta.stop_reason === "tool_use" ? "tool_calls" : "stop"
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
      content: previewText(contentToTextPreview(message.content)),
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

export interface StreamAssistantReplyNativeOptions extends GenerateAssistantReplyNativeOptions {
  /**
   * Streaming text-delta callback. Invoked for every text chunk with its
   * `kind`: `"content"` (the visible reply) or `"reasoning"` (chain-of-thought
   * from reasoning models — DeepSeek `reasoning_content` / Claude
   * `thinking_delta`). Callers route reasoning to a collapsed "思考" region and
   * content to the reply. `round` is the tool-loop round index so the caller
   * can label thought vs final.
   */
  onDelta?: (delta: string, round: number, kind: "reasoning" | "content") => void
  /**
   * Tool-loop round index for this single stream call. Threaded into `onDelta`
   * so the caller can label thought vs final rounds. Defaults to 0.
   */
  round?: number
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
        // Debug uses the flat AiChatMessage shape; thread tool
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
          : previewText(contentToTextPreview(message.content)),
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

  return { ...result, usage }
}

/**
 * Split a raw SSE chunk buffer into complete lines plus a trailing partial
 * line. `data:` payloads are returned decoded; `event:` lines surface the
 * current event type (Claude pairs `event:` with the following `data:`).
 * Comment/keep-alive lines (`:`) are dropped. Returns the list of parsed
 * lines and the leftover partial string to prepend to the next chunk.
 */
function parseSseChunk(
  buffer: string,
): { lines: Array<{ kind: "data"; value: string } | { kind: "event"; value: string }>; rest: string } {
  const lines: Array<{ kind: "data"; value: string } | { kind: "event"; value: string }> = []
  const segments = buffer.split("\n")
  const rest = segments.pop() ?? ""
  for (const rawLine of segments) {
    const line = rawLine.replace(/\r$/, "")
    if (line.startsWith(":")) continue
    if (line.startsWith("data:")) {
      lines.push({ kind: "data", value: line.slice(5).replace(/^ /, "") })
    } else if (line.startsWith("event:")) {
      lines.push({ kind: "event", value: line.slice(6).replace(/^ /, "") })
    }
  }
  return { lines, rest }
}

function finalizeStreamedToolCalls(
  accumulator: Map<number, { id: string; name: string; args: string }>,
): NativeToolCall[] {
  const calls: NativeToolCall[] = []
  const indices = [...accumulator.keys()].sort((a, b) => a - b)
  for (const index of indices) {
    const entry = accumulator.get(index)!
    let argumentsRecord: Record<string, unknown> = {}
    if (entry.args) {
      try {
        const parsed = JSON.parse(entry.args)
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          argumentsRecord = parsed as Record<string, unknown>
        }
      } catch {
        // Leave empty arguments; runtime surfaces a structured error.
      }
    }
    calls.push({ id: entry.id, name: entry.name, arguments: argumentsRecord })
  }
  return calls
}

/**
 * Streaming variant of `generateAssistantReplyNative`. Reads the SSE stream
 * chunk-by-chunk, pushes every text delta to `onDelta` (thought-round text is
 * streamed too — no onReset), accumulates tool-call deltas in the background,
 * and resolves to a `ModelCallResult` once the stream closes. Falls back to a
 * one-shot JSON parse when the endpoint does not answer with `text/event-stream`.
 */
export async function streamAssistantReplyNative(
  messages: RuntimeChatMessage[],
  options: StreamAssistantReplyNativeOptions = {},
): Promise<ModelCallResult> {
  const config = options.config ?? getBrowserAiConfig()

  if (!config) {
    throw new Error(
      "AI config is missing. Please configure an OpenAI-compatible provider in Control Panel.",
    )
  }

  const round = options.round ?? 0
  const requestId = `${options.debugLabel ?? "chat-stream"}-${++aiDebugSequence}`
  const adapter = selectAdapter(config.kind)
  const url = adapter.buildStreamUrl(config)
  const tools = options.tools ?? []
  const requestBody = adapter.buildStreamRequestBody(config, messages, tools)

  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat-stream",
    model: config.model,
    createdAt: new Date().toISOString(),
    messages: messages.map((message): AiChatMessage => {
      if (message.role === "tool") {
        return { role: "user", content: `[tool:${message.toolCallId}] ${message.content}` }
      }
      return { role: message.role, content: message.content }
    }),
  })

  logDebugGroup(`[Tsian AI ${requestId}] stream request`, {
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
          : previewText(contentToTextPreview(message.content)),
    })),
  })

  const timed = createTimedAbortSignal({
    signal: options.signal,
    timeoutMs: DEFAULT_CHAT_TIMEOUT_MS,
    timeoutMessage: `[Tsian AI ${requestId}] request timed out after ${DEFAULT_CHAT_TIMEOUT_MS} ms.`,
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: adapter.buildHeaders(config),
      body: JSON.stringify(requestBody),
      signal: timed.signal,
    })
  } catch (error) {
    timed.cleanup()
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Tsian AI ${requestId}] error`, { error })
    updateAiDebugRecord(requestId, { error: message })
    throw error
  }

  if (!response.ok) {
    timed.cleanup()
    const payload = await readJsonPayload(response)
    console.warn(`[Tsian AI ${requestId}] error`, { status: response.status, payload })
    const message = extractErrorMessage(payload) ?? `AI request failed with status ${response.status}.`
    updateAiDebugRecord(requestId, { error: message })
    throw new Error(message)
  }

  // Non-SSE fallback: endpoint answered with a regular JSON body.
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/event-stream")) {
    try {
      const payload = await readJsonPayload(response)
      const result = adapter.extractNativeResult(payload)
      const usage = extractUsageFromPayload(payload)
      updateAiDebugRecord(requestId, { responseText: result.raw, usage })
      logDebugGroup(`[Tsian AI ${requestId}] stream non-SSE fallback`, {
        text: previewText(result.text, 2400),
        toolCalls: result.toolCalls,
        finishReason: result.finishReason,
        payload,
      })
      return { ...result, usage }
    } finally {
      timed.cleanup()
    }
  }

  if (!response.body) {
    timed.cleanup()
    throw new Error("Streaming response has no body.")
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let lineBuffer = ""
  let textBuffer = ""
  let isToolRound = false
  let finishReason: "stop" | "tool_calls" | undefined
  const toolAccumulator = new Map<number, { id: string; name: string; args: string }>()
  let currentEvent = ""
  let streamEnded = false
  let streamUsage: { input?: number; output?: number; total?: number } | undefined
  const isClaude = config.kind === "claude"

  try {
    while (!streamEnded) {
      const { done, value } = await reader.read()
      if (done) {
        streamEnded = true
        break
      }
      lineBuffer += decoder.decode(value, { stream: true })
      const parsed = parseSseChunk(lineBuffer)
      lineBuffer = parsed.rest

      for (const line of parsed.lines) {
        if (line.kind === "event") {
          currentEvent = line.value
          // Claude `message_stop` ends the stream.
          if (isClaude && line.value === "message_stop") {
            streamEnded = true
          }
          continue
        }

        // line.kind === "data"
        const dataRaw = line.value
        // OpenAI terminator.
        if (dataRaw === "[DONE]") {
          streamEnded = true
          continue
        }

        let data: unknown
        try {
          data = JSON.parse(dataRaw)
        } catch {
          // Skip malformed/keep-alive data lines.
          continue
        }

        // Provider usage arrives in the terminating chunk (OpenAI with
        // include_usage, Claude message_delta, Gemini usageMetadata). Extract
        // on every chunk; the last non-undefined one wins (usage only appears
        // once, near the end).
        const chunkUsage = extractUsageFromPayload(data)
        if (chunkUsage) {
          streamUsage = chunkUsage
        }

        const delta = adapter.extractStreamDelta(data)
        if (delta !== undefined && delta !== "") {
          textBuffer += delta
          options.onDelta?.(delta, round, "content")
        }

        // Reasoning/chain-of-thought deltas are extracted separately and routed
        // with kind "reasoning"; they never enter textBuffer (result.text stays
        // the visible reply only).
        const reasoningDelta = adapter.extractStreamReasoningDelta?.(data)
        if (reasoningDelta !== undefined && reasoningDelta !== "") {
          options.onDelta?.(reasoningDelta, round, "reasoning")
        }

        adapter.extractStreamToolCalls(data, { event: currentEvent, accumulator: toolAccumulator })
        if (toolAccumulator.size > 0) {
          isToolRound = true
        }

        const finish = adapter.extractStreamFinish(data)
        if (finish) {
          finishReason = finish
        }
      }
    }
  } finally {
    timed.cleanup()
    try {
      reader.releaseLock()
    } catch {
      // Reader already released.
    }
  }

  const toolCalls = finalizeStreamedToolCalls(toolAccumulator)
  const resolvedFinish: "stop" | "tool_calls" =
    finishReason ?? (isToolRound || toolCalls.length > 0 ? "tool_calls" : "stop")

  const result: ModelCallResult = {
    text: resolvedFinish === "tool_calls" ? "" : textBuffer,
    toolCalls,
    raw: textBuffer,
    finishReason: resolvedFinish,
    ...(streamUsage ? { usage: streamUsage } : {}),
  }

  updateAiDebugRecord(requestId, { responseText: result.raw, usage: streamUsage })
  logDebugGroup(`[Tsian AI ${requestId}] stream response`, {
    text: previewText(result.text, 2400),
    toolCalls: result.toolCalls,
    finishReason: result.finishReason,
    isToolRound,
  })

  return result
}
