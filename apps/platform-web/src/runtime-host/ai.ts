import type { AiChatMessage, AiDebugMessageSegment, AiDebugRecord, ContentPart } from "@tsian/contracts"

import {
  getBrowserAiConfig,
  parseBrowserAiCustomRequestParams,
  providerParamsForKind,
  type BrowserAiConfig,
  type BrowserAiModelParameters,
  type BrowserAiProviderKind,
  type BrowserClaudeModelParameters,
  type BrowserDeepSeekModelParameters,
  type BrowserGeminiModelParameters,
  type BrowserOpenAiCompatibleModelParameters,
  type BrowserOpenAiResponsesModelParameters,
} from "../config/ai"
import { getPlatformConfig } from "../config/platform-config"
import type { ToolSchema } from "../agent-runtime/tool-schemas"
import {
  appendAiDebugRecord,
  readAiDebugRecords,
  AI_DEBUG_RECORDS_KEY,
} from "../storage/ai-debug-records"
import { localDb } from "../storage/db"

export type { AiChatMessage, AiDebugRecord }
export type { ContentPart }

/**
 * A structured Runtime tool call parsed from a native function-calling
 * response. Carries the provider-assigned id so tool observations can be
 * threaded back via `tool_call_id` (OpenAI Chat Completions), `call_id`
 * (OpenAI Responses), `tool_use_id` (Claude), or matched function parts
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

function contentImagePartCount(content: string | ContentPart[]): number {
  if (typeof content === "string") return 0
  return content.filter((part) => part.type === "image").length
}

function inferMessageSegmentLabel(text: string, role: RuntimeChatMessage["role"] | AiChatMessage["role"]): string {
  if (role === "system") return "system.agent"
  if (role === "tool") return "tool.observation"
  if (text.startsWith("Workspace Agent 上下文（元信息）") || text.startsWith("目标 Agent 上下文（元信息）")) return "workspace.meta"
  // contextInjectionsToMessages 产出的注入消息用 `<!-- source: xxx -->` 注释前缀。
  // 覆盖 workspace-context / before-history / after-input / tail 各 position 的注入。
  if (text.startsWith("<!-- source:")) return "workspace.file"
  if (text.startsWith("Workspace 注入 ")) return "workspace.file"
  if (text.startsWith("早期任务摘要：") || text.startsWith("早期剧情摘要：") || text.startsWith("最近对话：") || text.startsWith("最近对话窗口：") || text === "（暂无历史对话）") return "history"
  if (text.startsWith("当前问答轮次：") || text.startsWith("当前回合：")) return "turn.runtime"
  if (text.startsWith("用户本轮提问：") || text.startsWith("玩家本轮输入：")) return "turn.input"
  if (text.startsWith("调用请求：")) return "agent-call.request"
  if (text.startsWith("下面是已激活 Skill")) return "skill.injected"
  if (text.startsWith("Workspace tool observations:")) return "tool.observation"
  if (role === "assistant") return "assistant.response"
  return "message"
}

function segmentStability(label: string): AiDebugMessageSegment["stability"] {
  if (label === "system.agent") return "stable"
  if (label === "history" || label === "assistant.response") return "semi-stable"
  // workspace.context 拆分后（任务 06-30-workspace-context-cache-split）：
  // workspace.meta（header/skillIndex 等）和 workspace.file（各 contextFile 独立一条）
  // 标 semi-stable——理论可变（agent 写 runtime.json），但希望多数轮次命中前缀缓存。
  // 与 history 同语义。稳定的文件自然命中、动态的单独 miss 互不拖累。
  if (label === "workspace.meta" || label === "workspace.file") return "semi-stable"
  return "dynamic"
}

function buildDebugMessageSegments(messages: RuntimeChatMessage[] | AiChatMessage[]): AiDebugMessageSegment[] {
  return messages.map((message, index) => {
    const text = message.role === "tool"
      ? `[tool:${message.toolCallId}] ${message.content}`
      : contentToTextPreview(message.content)
    const label = inferMessageSegmentLabel(text, message.role)
    const imagePartCount = message.role === "tool" ? 0 : contentImagePartCount(message.content)
    return {
      index,
      role: message.role,
      label,
      stability: segmentStability(label),
      charLength: text.length,
      preview: previewText(text, 180),
      ...(imagePartCount > 0 ? { imagePartCount } : {}),
    }
  })
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
  usage?: { input?: number; output?: number; total?: number; cached?: number; cacheCreation?: number }
}

export interface GenerateAssistantReplyOptions {
  debugLabel?: string
  config?: BrowserAiConfig | null
  signal?: AbortSignal
}

let aiDebugSequence = 0
/**
 * In-memory write buffer for AI debug records. Pushed records land here
 * synchronously (so same-session reads see them immediately) and are
 * fire-and-forget persisted to Dexie (`storage/ai-debug-records.ts`). Reads
 * always hydrate from Dexie and merge this buffer, so a card-switch clear
 * (which deletes the Dexie key) is naturally reflected on the next read
 * without any cross-layer cache-reset call.
 */
const aiDebugRecordBuffer: AiDebugRecord[] = []

/** 读平台配置 ai.chatTimeoutMs(默认 600000).同步读 cache. */
function getChatTimeoutMs(): number {
  return getPlatformConfig().ai.chatTimeoutMs
}

function pushAiDebugRecord(record: AiDebugRecord): void {
  // Sync buffer so same-session reads see the new record immediately, plus
  // fire-and-forget async persist to Dexie (survives refresh, 7-day TTL,
  // cleared on card switch). Diagnostics are non-critical — a failed write
  // is silently dropped; the record still lives in the buffer for this session.
  aiDebugRecordBuffer.unshift(record)
  void appendAiDebugRecord(record).catch(() => { /* ignore: diagnostics persist */ })
}

function updateAiDebugRecord(id: string, patch: Partial<AiDebugRecord>): void {
  // Update the in-memory buffer entry (source of truth for current session).
  const index = aiDebugRecordBuffer.findIndex((record) => record.id === id)
  if (index < 0) {
    return
  }
  aiDebugRecordBuffer[index] = {
    ...aiDebugRecordBuffer[index],
    ...patch,
  }
  // Persist the patched record (fire-and-forget). Re-read + re-write so the
  // Dexie copy reflects the patch; the buffer is the session source of truth.
  void persistPatchedRecord(id, patch).catch(() => { /* ignore: diagnostics persist */ })
}

/** Best-effort: re-read Dexie, apply patch to the matching record, write back. */
async function persistPatchedRecord(id: string, patch: Partial<AiDebugRecord>): Promise<void> {
  const persisted = await readAiDebugRecords()
  const idx = persisted.findIndex((r) => r.id === id)
  if (idx < 0) return
  persisted[idx] = { ...persisted[idx], ...patch }
  await localDb.meta.put({
    key: AI_DEBUG_RECORDS_KEY,
    value: JSON.stringify(persisted),
  })
}

export async function getAiDebugRecords(): Promise<AiDebugRecord[]> {
  // Always hydrate from Dexie (handles card-switch clear naturally) and merge
  // any buffer records not yet persisted or added this session.
  const persisted = await readAiDebugRecords()
  const persistedIds = new Set(persisted.map((r) => r.id))
  const merged = [
    ...aiDebugRecordBuffer.filter((r) => !persistedIds.has(r.id)),
    ...persisted,
  ]
  return merged.map((record) => ({
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
  kind: BrowserAiProviderKind
}): Record<string, unknown> {
  const common = input.parameters.common
  const provider = input.kind === "deepseek"
    ? providerParamsForKind(input.parameters, "deepseek") as BrowserDeepSeekModelParameters
    : providerParamsForKind(input.parameters, "openai-compatible") as BrowserOpenAiCompatibleModelParameters
  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
  }

  putOptionalNumber(body, "max_tokens", common.maxOutputTokens)
  putOptionalNumber(body, "temperature", common.temperature)
  putOptionalNumber(body, "top_p", common.topP)
  putOptionalNumber(body, "frequency_penalty", provider.frequencyPenalty)
  putOptionalNumber(body, "presence_penalty", provider.presencePenalty)

  if (provider.reasoningEffort) {
    body.reasoning_effort = provider.reasoningEffort
  }

  return {
    ...body,
    ...parseBrowserAiCustomRequestParams(provider.customRequestParamsText),
    model: input.model,
    messages: input.messages,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function enableOpenAiCompatibleStreamUsage(body: Record<string, unknown>, kind: BrowserAiProviderKind): void {
  if (kind !== "openai-compatible") return
  const streamOptions = isRecord(body.stream_options) ? { ...body.stream_options } : {}
  streamOptions.include_usage = true
  body.stream_options = streamOptions
}

function parseOptionalJsonObjectText(input: string, label: string): Record<string, unknown> | undefined {
  const trimmed = input.trim()
  if (!trimmed) {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`${label} must be valid JSON.`)
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed
}

function putOptionalStringArray(
  target: Record<string, unknown>,
  key: string,
  value: string[],
): void {
  const normalized = value.map((item) => item.trim()).filter(Boolean)
  if (normalized.length > 0) {
    target[key] = normalized
  }
}

function buildResponsesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/responses`
}

/** Build OpenAI Responses-native content blocks from Tsian text/image parts. */
function buildResponsesContent(content: string | ContentPart[]): unknown {
  if (typeof content === "string") return content
  return content.map((part) => {
    if (part.type === "text") return { type: "input_text", text: part.text }
    return {
      type: "input_image",
      image_url: `data:${part.mimeType};base64,${part.data}`,
      detail: "auto",
    }
  })
}

function buildResponsesMessage(message: AiChatMessage): Record<string, unknown> {
  return {
    type: "message",
    role: message.role,
    content: buildResponsesContent(message.content),
  }
}

function buildResponsesNativeInput(messages: RuntimeChatMessage[]): unknown[] {
  const input: unknown[] = []
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
        status: "completed",
      })
      continue
    }

    if (message.role === "assistant") {
      if (message.content) {
        input.push({ type: "message", role: "assistant", content: message.content })
      }
      if (message.toolCalls) {
        for (const call of message.toolCalls) {
          input.push({
            type: "function_call",
            call_id: call.id,
            name: call.name,
            arguments: JSON.stringify(call.arguments),
            status: "completed",
          })
        }
      }
      continue
    }

    input.push({
      type: "message",
      role: message.role,
      content: buildResponsesContent(message.content),
    })
  }
  return input
}

function buildResponsesTools(tools: ToolSchema[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

function buildResponsesRequestBody(input: {
  model: string
  input: unknown[]
  parameters: BrowserAiModelParameters
  tools?: unknown[]
  stream?: boolean
}): Record<string, unknown> {
  const common = input.parameters.common
  const provider = providerParamsForKind(input.parameters, "openai-responses") as BrowserOpenAiResponsesModelParameters
  const body: Record<string, unknown> = {
    model: input.model,
    input: input.input,
    store: false,
  }

  putOptionalNumber(body, "max_output_tokens", common.maxOutputTokens)
  putOptionalNumber(body, "temperature", common.temperature)
  putOptionalNumber(body, "top_p", common.topP)

  if (provider.reasoningEffort) {
    body.reasoning = { effort: provider.reasoningEffort }
  }

  const result: Record<string, unknown> = {
    ...body,
    ...parseBrowserAiCustomRequestParams(provider.customRequestParamsText),
    model: input.model,
    input: input.input,
    store: false,
  }

  delete result.previous_response_id
  delete result.conversation

  if (input.tools) {
    result.tools = input.tools
  } else {
    delete result.tools
  }

  if (input.stream) {
    result.stream = true
  } else {
    delete result.stream
  }

  return result
}

function responsePayloadRecord(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  const response = payload.response
  if (isRecord(response)) return response
  return payload
}

function extractResponsesError(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  if (payload.type === "error") {
    return typeof payload.message === "string" ? payload.message : "AI response stream failed."
  }

  const response = responsePayloadRecord(payload)
  if (!response) return undefined

  const error = response.error
  if (isRecord(error) && typeof error.message === "string") {
    return error.message
  }

  const status = typeof response.status === "string" ? response.status : ""
  if (status === "failed") {
    return "AI response failed."
  }
  if (status === "incomplete") {
    const details = response.incomplete_details
    const reason = isRecord(details) && typeof details.reason === "string" ? details.reason : "unknown reason"
    return `AI response incomplete: ${reason}.`
  }

  return undefined
}

function collectResponsesText(response: Record<string, unknown>): string {
  if (typeof response.output_text === "string") {
    return response.output_text
  }

  const textParts: string[] = []
  const output = response.output
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!isRecord(item) || item.type !== "message") continue
      const content = item.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (!isRecord(block)) continue
        if (block.type === "output_text" && typeof block.text === "string") {
          textParts.push(block.text)
        } else if (block.type === "refusal" && typeof block.refusal === "string") {
          textParts.push(block.refusal)
        }
      }
    }
  }
  return textParts.join("").trim()
}

function collectResponsesToolCalls(response: Record<string, unknown>): NativeToolCall[] {
  const output = response.output
  if (!Array.isArray(output)) return []

  const toolCalls: NativeToolCall[] = []
  for (const item of output) {
    if (!isRecord(item) || item.type !== "function_call") continue
    const id = typeof item.call_id === "string" ? item.call_id : ""
    const name = typeof item.name === "string" ? item.name : ""
    if (!id || !name) continue

    let args: Record<string, unknown> = {}
    const rawArgs = item.arguments
    if (typeof rawArgs === "string") {
      try {
        const parsed = JSON.parse(rawArgs)
        if (isRecord(parsed)) {
          args = parsed
        }
      } catch {
        // Leave empty arguments; runtime surfaces a structured error.
      }
    } else if (isRecord(rawArgs)) {
      args = rawArgs
    }

    toolCalls.push({ id, name, arguments: args })
  }
  return toolCalls
}

function extractResponsesText(payload: unknown): string {
  const error = extractResponsesError(payload)
  if (error) {
    throw new Error(error)
  }

  const response = responsePayloadRecord(payload)
  if (!response) {
    throw new Error("OpenAI Responses response format is not supported.")
  }

  if (typeof response.output_text === "string" || Array.isArray(response.output)) {
    return collectResponsesText(response)
  }

  throw new Error("OpenAI Responses response format is not supported.")
}

function extractResponsesResult(payload: unknown): ModelCallResult {
  const error = extractResponsesError(payload)
  if (error) {
    throw new Error(error)
  }

  const response = responsePayloadRecord(payload)
  if (!response) {
    throw new Error("OpenAI Responses response format is not supported.")
  }

  const text = collectResponsesText(response)
  const toolCalls = collectResponsesToolCalls(response)
  if (typeof response.output_text !== "string" && !Array.isArray(response.output)) {
    throw new Error("OpenAI Responses response format is not supported.")
  }

  return {
    text,
    toolCalls,
    raw: text,
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
  }
}

function responsesOutputIndex(data: Record<string, unknown>): number {
  return typeof data.output_index === "number" ? data.output_index : -1
}

function upsertResponsesStreamToolCall(
  accumulator: Map<number, { id: string; name: string; args: string }>,
  index: number,
  patch: Partial<{ id: string; name: string; args: string; appendArgs: string }>,
): void {
  const resolvedIndex = index >= 0 ? index : accumulator.size
  const existing = accumulator.get(resolvedIndex)
  if (existing) {
    if (patch.id) existing.id = patch.id
    if (patch.name) existing.name = patch.name
    if (patch.args !== undefined) existing.args = patch.args
    if (patch.appendArgs) existing.args += patch.appendArgs
    return
  }

  accumulator.set(resolvedIndex, {
    id: patch.id ?? `responses-call-${resolvedIndex}`,
    name: patch.name ?? "",
    args: patch.args ?? patch.appendArgs ?? "",
  })
}

function collectResponsesStreamToolCalls(
  data: unknown,
  accumulator: Map<number, { id: string; name: string; args: string }>,
): void {
  if (!isRecord(data)) return

  if (data.type === "response.output_item.added" || data.type === "response.output_item.done") {
    const item = data.item
    if (!isRecord(item) || item.type !== "function_call") return
    const callId = typeof item.call_id === "string" ? item.call_id : ""
    const name = typeof item.name === "string" ? item.name : ""
    const args = typeof item.arguments === "string" ? item.arguments : undefined
    const shouldSetArgs = data.type === "response.output_item.done" || Boolean(args)
    upsertResponsesStreamToolCall(accumulator, responsesOutputIndex(data), {
      ...(callId ? { id: callId } : {}),
      ...(name ? { name } : {}),
      ...(shouldSetArgs && args !== undefined ? { args } : {}),
    })
    return
  }

  if (data.type === "response.function_call_arguments.delta") {
    const delta = typeof data.delta === "string" ? data.delta : ""
    if (delta) {
      upsertResponsesStreamToolCall(accumulator, responsesOutputIndex(data), {
        appendArgs: delta,
      })
    }
    return
  }

  if (data.type === "response.function_call_arguments.done") {
    const name = typeof data.name === "string" ? data.name : ""
    const args = typeof data.arguments === "string" ? data.arguments : ""
    upsertResponsesStreamToolCall(accumulator, responsesOutputIndex(data), {
      ...(name ? { name } : {}),
      args,
    })
    return
  }

  if (data.type === "response.completed") {
    const response = responsePayloadRecord(data)
    const output = response?.output
    if (!Array.isArray(output)) return
    output.forEach((item, index) => {
      if (!isRecord(item) || item.type !== "function_call") return
      const callId = typeof item.call_id === "string" ? item.call_id : ""
      const name = typeof item.name === "string" ? item.name : ""
      const args = typeof item.arguments === "string" ? item.arguments : ""
      upsertResponsesStreamToolCall(accumulator, index, {
        ...(callId ? { id: callId } : {}),
        ...(name ? { name } : {}),
        args,
      })
    })
  }
}

/**
 * Extract token usage (input/output/total + cache hit/creation) from a provider
 * response payload. Paths differ per provider:
 *
 * - OpenAI / DeepSeek / Claude: usage lives at `payload.usage`.
 * - OpenAI Responses: usage lives at `payload.usage` or
 *   `payload.response.usage` for streaming completed events.
 * - Gemini: usage lives at `payload.usageMetadata` (different key, different
 *   field names). Without this branch Gemini's native API usage is never
 *   extracted — a pre-existing defect this function now fixes.
 *
 * Cache fields (all optional, omitted when the provider doesn't report them):
 * - OpenAI: `usage.prompt_tokens_details.cached_tokens`
 * - OpenAI Responses: `usage.input_tokens_details.cached_tokens`
 * - DeepSeek: `usage.prompt_cache_hit_tokens`
 * - Claude: `usage.cache_read_input_tokens` (+ `cache_creation_input_tokens`)
 * - Gemini: `usageMetadata.cachedContentTokenCount`
 *
 * `kind` is optional for back-compat with any caller that doesn't have it; when
 * omitted, cache fields are not extracted (only input/output/total).
 */
function extractUsageFromPayload(
  payload: unknown,
  kind?: BrowserAiProviderKind,
): { input?: number; output?: number; total?: number; cached?: number; cacheCreation?: number } | undefined {
  if (typeof payload !== "object" || payload === null) return undefined

  const pickNum = (obj: Record<string, unknown>, key: string): number | undefined => {
    const v = obj[key]
    return typeof v === "number" && Number.isFinite(v) ? v : undefined
  }

  // OpenAI Responses streaming terminal events wrap the final response under
  // `response`; non-streaming responses expose the same usage at top level.
  const response = isRecord(payload) && isRecord(payload.response) ? payload.response : payload
  if (!isRecord(response)) return undefined

  // Gemini: usage lives at payload.usageMetadata with different field names.
  if (kind === "gemini") {
    const um = (payload as { usageMetadata?: unknown }).usageMetadata
    if (typeof um !== "object" || um === null) return undefined
    const u = um as Record<string, unknown>
    const input = pickNum(u, "promptTokenCount")
    const output = pickNum(u, "candidatesTokenCount")
    const total = pickNum(u, "totalTokenCount")
    const cached = pickNum(u, "cachedContentTokenCount")
    if (input === undefined && output === undefined && total === undefined && cached === undefined) {
      return undefined
    }
    return { input, output, total, ...(cached !== undefined ? { cached } : {}) }
  }

  // OpenAI / DeepSeek / Claude: usage at payload.usage.
  const usage = (response as { usage?: unknown }).usage
  if (typeof usage !== "object" || usage === null) return undefined
  const u = usage as Record<string, unknown>

  const input = pickNum(u, "prompt_tokens") ?? pickNum(u, "input_tokens")
  const output = pickNum(u, "completion_tokens") ?? pickNum(u, "output_tokens")
  const total =
    pickNum(u, "total_tokens") ??
    (typeof input === "number" && typeof output === "number" ? input + output : undefined)

  // Cache fields differ per provider kind.
  let cached: number | undefined
  let cacheCreation: number | undefined
  if (kind === "openai-responses") {
    const details = u["input_tokens_details"]
    if (isRecord(details)) {
      cached = pickNum(details, "cached_tokens")
    }
  } else if (kind === "openai-compatible") {
    // OpenAI Chat Completions: nested in prompt_tokens_details.cached_tokens.
    const details = u["prompt_tokens_details"]
    if (isRecord(details)) {
      cached = pickNum(details, "cached_tokens")
    }
  } else if (kind === "deepseek") {
    cached = pickNum(u, "prompt_cache_hit_tokens")
  } else if (kind === "claude") {
    cached = pickNum(u, "cache_read_input_tokens")
    cacheCreation = pickNum(u, "cache_creation_input_tokens")
  }

  if (input === undefined && output === undefined && total === undefined && cached === undefined && cacheCreation === undefined) {
    return undefined
  }
  const result: { input?: number; output?: number; total?: number; cached?: number; cacheCreation?: number } = { input, output, total }
  if (cached !== undefined) result.cached = cached
  if (cacheCreation !== undefined) result.cacheCreation = cacheCreation
  return result
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
   * Extract a provider-specific stream error from one parsed SSE payload.
   * Adapters return `undefined` for normal chunks; the shared stream loops throw
   * when a message is returned so failed/incomplete streams never look like an
   * empty successful response.
   */
  extractStreamError?(data: unknown): string | undefined
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
      kind: config.kind,
    })
  },
  extractText: extractAssistantText,
  buildNativeRequestBody(config, messages, tools) {
    const body = buildChatCompletionsRequestBody({
      model: config.model,
      messages: [],
      parameters: config.parameters,
      kind: config.kind,
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
    enableOpenAiCompatibleStreamUsage(body, config.kind)
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

const responsesAdapter: ProviderAdapter = {
  buildUrl(config) {
    return buildResponsesUrl(config.baseUrl)
  },
  buildHeaders(config) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    }
  },
  buildRequestBody(config, messages) {
    return buildResponsesRequestBody({
      model: config.model,
      input: messages.map((message) => buildResponsesMessage(message)),
      parameters: config.parameters,
    })
  },
  extractText: extractResponsesText,
  buildNativeRequestBody(config, messages, tools) {
    const responseTools = buildResponsesTools(tools)
    return buildResponsesRequestBody({
      model: config.model,
      input: buildResponsesNativeInput(messages),
      parameters: config.parameters,
      ...(responseTools.length > 0 ? { tools: responseTools } : {}),
    })
  },
  extractNativeResult: extractResponsesResult,
  buildStreamUrl(config) {
    return buildResponsesUrl(config.baseUrl)
  },
  buildStreamRequestBody(config, messages, tools) {
    const responseTools = buildResponsesTools(tools)
    return buildResponsesRequestBody({
      model: config.model,
      input: buildResponsesNativeInput(messages),
      parameters: config.parameters,
      ...(responseTools.length > 0 ? { tools: responseTools } : {}),
      stream: true,
    })
  },
  extractStreamDelta(data) {
    if (!isRecord(data)) return undefined
    return data.type === "response.output_text.delta" && typeof data.delta === "string"
      ? data.delta
      : undefined
  },
  extractStreamError(data) {
    return extractResponsesError(data)
  },
  extractStreamToolCalls(data, context) {
    collectResponsesStreamToolCalls(data, context.accumulator)
  },
  extractStreamFinish(data) {
    if (!isRecord(data) || data.type !== "response.completed") return undefined
    const response = responsePayloadRecord(data)
    if (!response) return "stop"
    return collectResponsesToolCalls(response).length > 0 ? "tool_calls" : "stop"
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

function buildGeminiGenerationConfig(parameters: BrowserAiModelParameters): Record<string, unknown> {
  const common = parameters.common
  const provider = providerParamsForKind(parameters, "gemini") as BrowserGeminiModelParameters
  const generationConfig: Record<string, unknown> = {}
  putOptionalNumber(generationConfig, "maxOutputTokens", common.maxOutputTokens)
  putOptionalNumber(generationConfig, "temperature", common.temperature)
  putOptionalNumber(generationConfig, "topP", common.topP)
  putOptionalNumber(generationConfig, "topK", provider.topK)
  putOptionalNumber(generationConfig, "frequencyPenalty", provider.frequencyPenalty)
  putOptionalNumber(generationConfig, "presencePenalty", provider.presencePenalty)
  putOptionalStringArray(generationConfig, "stopSequences", provider.stopSequences)
  if (provider.responseMimeType.trim()) {
    generationConfig.responseMimeType = provider.responseMimeType.trim()
  }
  const responseSchema = parseOptionalJsonObjectText(provider.responseSchemaText, "Gemini responseSchema")
  if (responseSchema) {
    generationConfig.responseSchema = responseSchema
  }
  const thinkingConfig: Record<string, unknown> = {}
  putOptionalNumber(thinkingConfig, "thinkingBudget", provider.thinkingBudget)
  if (provider.includeThoughts) {
    thinkingConfig.includeThoughts = true
  }
  if (Object.keys(thinkingConfig).length > 0) {
    generationConfig.thinkingConfig = thinkingConfig
  }
  return generationConfig
}

function mergeProviderCustomParams(
  body: Record<string, unknown>,
  customRequestParamsText: string,
): Record<string, unknown> {
  return {
    ...parseBrowserAiCustomRequestParams(customRequestParamsText),
    ...body,
  }
}

function buildGeminiRequestBody(input: {
  config: BrowserAiConfig
  contents: Record<string, unknown>[]
  system?: string
  tools?: ToolSchema[]
}): Record<string, unknown> {
  const provider = providerParamsForKind(input.config.parameters, "gemini") as BrowserGeminiModelParameters
  const body: Record<string, unknown> = {
    contents: input.contents,
    generationConfig: buildGeminiGenerationConfig(input.config.parameters),
  }
  if (input.system) {
    body.systemInstruction = { parts: [{ text: input.system }] }
  }
  if (input.tools && input.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
      },
    ]
  }
  return mergeProviderCustomParams(body, provider.customRequestParamsText)
}

function buildClaudeThinking(
  common: BrowserAiModelParameters["common"],
  provider: BrowserClaudeModelParameters,
): Record<string, unknown> | undefined {
  if (provider.thinkingMode === "disabled") {
    return undefined
  }
  if (provider.thinkingMode === "adaptive") {
    return { type: "adaptive", display: provider.thinkingDisplay }
  }
  if (provider.thinkingBudgetTokens === null || provider.thinkingBudgetTokens < 1024) {
    throw new Error("Claude thinking.budget_tokens must be at least 1024 when thinking is enabled.")
  }
  if (common.maxOutputTokens !== null && provider.thinkingBudgetTokens >= common.maxOutputTokens) {
    throw new Error("Claude thinking.budget_tokens must be smaller than max output tokens.")
  }
  return {
    type: "enabled",
    budget_tokens: provider.thinkingBudgetTokens,
    display: provider.thinkingDisplay,
  }
}

function applyClaudeModelParameters(body: Record<string, unknown>, config: BrowserAiConfig): void {
  const common = config.parameters.common
  const provider = providerParamsForKind(config.parameters, "claude") as BrowserClaudeModelParameters
  body.max_tokens = common.maxOutputTokens ?? 4096
  putOptionalNumber(body, "temperature", common.temperature)
  putOptionalNumber(body, "top_p", common.topP)
  putOptionalNumber(body, "top_k", provider.topK)
  putOptionalStringArray(body, "stop_sequences", provider.stopSequences)
  if (provider.serviceTier) {
    body.service_tier = provider.serviceTier
  }
  const thinking = buildClaudeThinking(common, provider)
  if (thinking) {
    body.thinking = thinking
  }
}

function buildClaudeRequestBody(input: {
  config: BrowserAiConfig
  messages: Record<string, unknown>[]
  system?: string
  tools?: ToolSchema[]
}): Record<string, unknown> {
  const provider = providerParamsForKind(input.config.parameters, "claude") as BrowserClaudeModelParameters
  const body: Record<string, unknown> = {
    model: input.config.model,
    messages: input.messages,
  }
  applyClaudeModelParameters(body, input.config)
  if (input.system) {
    body.system = input.system
  }
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }))
  }
  return mergeProviderCustomParams(body, provider.customRequestParamsText)
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
    return buildGeminiRequestBody({
      config,
      system,
      contents: rest.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: buildGeminiParts(message.content),
      })),
    })
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
    return buildGeminiRequestBody({
      config,
      system,
      contents: rest.map((message) => buildGeminiNativeContent(message)),
      tools,
    })
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
    return buildClaudeRequestBody({
      config,
      system,
      messages: rest.map((message) => ({
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.role === "assistant" ? message.content : buildClaudeContent(message.content),
      })),
    })
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
    return buildClaudeRequestBody({
      config,
      system,
      messages: rest.map((message) => buildClaudeNativeMessage(message)),
      tools,
    })
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
  if (kind === "openai-responses") {
    return responsesAdapter
  }
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
  const messageSegments = buildDebugMessageSegments(messages)
  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat",
    model: config.model,
    providerKind: config.kind,
    createdAt: new Date().toISOString(),
    messages: messages.map((message) => ({ ...message })),
    messageSegments,
  })

  logDebugGroup(`[Tsian AI ${requestId}] request`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    requestKeys: Object.keys(requestBody),
    messageSegments,
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content: previewText(contentToTextPreview(message.content)),
    })),
  })

  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${getChatTimeoutMs()} ms.`
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
      timeoutMs: getChatTimeoutMs(),
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
  const usage = extractUsageFromPayload(payload, config.kind)
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
  const messageSegments = buildDebugMessageSegments(messages)

  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat-native",
    model: config.model,
    providerKind: config.kind,
    createdAt: new Date().toISOString(),
    messages: messages.map((message): AiChatMessage => {
      if (message.role === "tool") {
        // Debug uses the flat AiChatMessage shape; thread tool
        // observations back as a user turn carrying the observation text.
        return { role: "user", content: `[tool:${message.toolCallId}] ${message.content}` }
      }
      return { role: message.role, content: message.content }
    }),
    messageSegments,
  })

  logDebugGroup(`[Tsian AI ${requestId}] native request`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    requestKeys: Object.keys(requestBody),
    toolCount: tools.length,
    messageSegments,
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content:
        message.role === "tool"
          ? previewText(`[tool:${message.toolCallId}] ${message.content}`)
          : previewText(contentToTextPreview(message.content)),
    })),
  })

  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${getChatTimeoutMs()} ms.`
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
      timeoutMs: getChatTimeoutMs(),
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
  const usage = extractUsageFromPayload(payload, config.kind)
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
  const messageSegments = buildDebugMessageSegments(messages)

  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat-stream",
    model: config.model,
    providerKind: config.kind,
    createdAt: new Date().toISOString(),
    messages: messages.map((message): AiChatMessage => {
      if (message.role === "tool") {
        return { role: "user", content: `[tool:${message.toolCallId}] ${message.content}` }
      }
      return { role: message.role, content: message.content }
    }),
    messageSegments,
  })

  logDebugGroup(`[Tsian AI ${requestId}] stream request`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    requestKeys: Object.keys(requestBody),
    toolCount: tools.length,
    messageSegments,
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
    timeoutMs: getChatTimeoutMs(),
    timeoutMessage: `[Tsian AI ${requestId}] request timed out after ${getChatTimeoutMs()} ms.`,
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
      const usage = extractUsageFromPayload(payload, config.kind)
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

        const streamError = adapter.extractStreamError?.(data)
        if (streamError) {
          updateAiDebugRecord(requestId, { error: streamError })
          throw new Error(streamError)
        }

        // Provider usage arrives in the terminating chunk (OpenAI with
        // include_usage, Claude message_delta, Gemini usageMetadata). Extract
        // on every chunk; the last non-undefined one wins (usage only appears
        // once, near the end).
        const chunkUsage = extractUsageFromPayload(data, config.kind)
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

// ─────────────────────────────────────────────────────────────────────────
// Text-protocol streaming (task 06-26-text-protocol-and-agent-entry)
//
// Mirrors streamAssistantReplyNative but for the <tsian-tool-call> text-
// embedding protocol. Uses AiChatMessage[] (not RuntimeChatMessage[]), sends
// stream:true via buildRequestBody (not buildStreamRequestBody which expects
// native message shape), and does NOT extract tool calls or reasoning from
// structured SSE fields — tool calls live in the content text as
// <tsian-tool-call> blocks, parsed post-hoc by the runtime layer at round
// end. The onDelta callback receives a display-stripped buffer (closed
// tool-call/think blocks hidden, unclosed tail blocks still visible) so the
// UI doesn't show raw XML tags during streaming.
// ─────────────────────────────────────────────────────────────────────────

// Display-only patterns mirror the authoritative THINK_BLOCK_PATTERNS in
// agent-runtime/workspace-tools.ts. Duplicated intentionally: runtime-host
// display strip is best-effort (render aid), while agent-runtime's
// stripThinkBlocks is the authoritative parse (model-boundary contract).
// Same precedent as registry.ts mirroring tsian-actions fence patterns.
const DISPLAY_TOOL_CALL_PATTERN = /<tsian-tool-call>\s*[\s\S]*?\s*<\/tsian-tool-call>/g
const DISPLAY_THINK_PATTERNS = [
  /<thought>\s*[\s\S]*?\s*<\/thought>/g,
  /<thinking>\s*[\s\S]*?\s*<\/thinking>/g,
  /<think>\s*[\s\S]*?\s*<\/think>/g,
]

export function stripForDisplay(text: string): string {
  let result = text.replace(DISPLAY_TOOL_CALL_PATTERN, "")
  for (const pattern of DISPLAY_THINK_PATTERNS) {
    result = result.replace(pattern, "")
  }
  return result
}

export interface StreamAssistantReplyTextOptions extends GenerateAssistantReplyOptions {
  /**
   * Streaming text-delta callback for text-protocol mode. Invoked with the
   * display-stripped accumulated buffer (not incremental deltas) and
   * `kind: "content"` only — text protocol has no separate reasoning stream;
   * chain-of-thought lives in the content text as <think>/<thought>/
   * <thinking> blocks, stripped by stripForDisplay for display and by
   * stripThinkBlocks for the authoritative round-end parse.
   */
  onDelta?: (delta: string, round: number, kind: "reasoning" | "content") => void
  /** Tool-loop round index for this single stream call. Defaults to 0. */
  round?: number
}

/**
 * Text-protocol streaming variant of `generateAssistantReply`. Sends
 * `stream: true` to the provider's chat endpoint and accumulates the full
 * response via SSE. Unlike `streamAssistantReplyNative`, this returns
 * `Promise<string>` (the raw full text, NOT a `ModelCallResult`) because
 * text-protocol tool calls are embedded in the content and parsed by the
 * runtime layer post-hoc. The `onDelta` callback receives the
 * display-stripped buffer on every content chunk. Falls back to one-shot
 * `generateAssistantReply` when the endpoint does not answer with
 * `text/event-stream`.
 */
export async function streamAssistantReplyText(
  messages: AiChatMessage[],
  options: StreamAssistantReplyTextOptions = {},
): Promise<string> {
  const config = options.config ?? getBrowserAiConfig()

  if (!config) {
    throw new Error(
      "AI config is missing. Please configure an OpenAI-compatible provider in Control Panel.",
    )
  }

  const round = options.round ?? 0
  const requestId = `${options.debugLabel ?? "chat-stream-text"}-${++aiDebugSequence}`
  const adapter = selectAdapter(config.kind)
  // Use the non-stream URL builder + body builder (text protocol uses plain
  // AiChatMessage[], not RuntimeChatMessage[]). We inject stream:true after.
  const url = adapter.buildStreamUrl(config)
  const requestBody = adapter.buildRequestBody(config, messages)
  ;(requestBody as Record<string, unknown>).stream = true
  enableOpenAiCompatibleStreamUsage(requestBody, config.kind)
  const messageSegments = buildDebugMessageSegments(messages)

  pushAiDebugRecord({
    id: requestId,
    kind: "chat",
    label: options.debugLabel ?? "chat-stream-text",
    model: config.model,
    providerKind: config.kind,
    createdAt: new Date().toISOString(),
    messages: messages.map((message) => ({ ...message })),
    messageSegments,
  })

  logDebugGroup(`[Tsian AI ${requestId}] text stream request`, {
    url,
    model: config.model,
    apiKey: maskSecret(config.apiKey),
    requestKeys: Object.keys(requestBody),
    messageSegments,
    messages: messages.map((message, index) => ({
      index,
      role: message.role,
      content: previewText(contentToTextPreview(message.content)),
    })),
  })

  const timed = createTimedAbortSignal({
    signal: options.signal,
    timeoutMs: getChatTimeoutMs(),
    timeoutMessage: `[Tsian AI ${requestId}] request timed out after ${getChatTimeoutMs()} ms.`,
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

  // Non-SSE fallback: endpoint answered with a regular JSON body. Use the
  // non-stream adapter's extractText (text protocol, not native extractResult).
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/event-stream")) {
    try {
      const payload = await readJsonPayload(response)
      const content = adapter.extractText(payload)
      const usage = extractUsageFromPayload(payload, config.kind)
      updateAiDebugRecord(requestId, { responseText: content, usage })
      logDebugGroup(`[Tsian AI ${requestId}] text stream non-SSE fallback`, {
        content: previewText(content, 2400),
        payload,
      })
      // Emit one delta for the complete text so the UI shows it.
      if (options.onDelta && content) {
        options.onDelta(content, round, "content")
      }
      return content
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
  let streamEnded = false
  let streamUsage: { input?: number; output?: number; total?: number } | undefined
  const isClaude = config.kind === "claude"
  let currentEvent = ""

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

        const streamError = adapter.extractStreamError?.(data)
        if (streamError) {
          updateAiDebugRecord(requestId, { error: streamError })
          throw new Error(streamError)
        }

        // Provider usage arrives in the terminating chunk.
        const chunkUsage = extractUsageFromPayload(data, config.kind)
        if (chunkUsage) {
          streamUsage = chunkUsage
        }

        // Text protocol: only extract content deltas. Tool calls and
        // reasoning are embedded in the content text, not structured SSE
        // fields — they are parsed/stripped post-hoc by the runtime layer.
        const delta = adapter.extractStreamDelta(data)
        if (delta !== undefined && delta !== "") {
          textBuffer += delta
          // Emit the raw incremental delta. The UI accumulates this into
          // streamingText; the render layer applies stripForDisplay at display
          // time (closed blocks hidden, unclosed tail blocks visible). This
          // keeps the delta stream compatible with the native-mode onDelta
          // contract (incremental, accumulative).
          options.onDelta?.(delta, round, "content")
        }

        // We do NOT call extractStreamToolCalls or extractStreamReasoningDelta
        // here — text protocol has no structured tool-call or reasoning
        // fields. The finish reason is also not needed; the runtime layer
        // determines tool_calls vs stop by parsing the full buffer at round
        // end (parseRuntimeWorkspaceToolCalls returns empty → stop).
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

  // Return the raw full text — the runtime layer will parse tool-call blocks
  // and strip think blocks post-hoc. Do NOT strip here; the authoritative
  // parse happens in the tool loop.
  updateAiDebugRecord(requestId, { responseText: textBuffer, usage: streamUsage })
  logDebugGroup(`[Tsian AI ${requestId}] text stream response`, {
    text: previewText(textBuffer, 2400),
    usage: streamUsage,
  })

  return textBuffer
}
