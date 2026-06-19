import type { AiChatMessage, AiDebugRecord } from "@tsian/contracts"

import {
  getBrowserAiConfig,
  parseBrowserAiCustomRequestParams,
  type BrowserAiConfig,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
} from "../config/ai"

export type { AiChatMessage, AiDebugRecord }

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
