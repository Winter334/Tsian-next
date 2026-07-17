import type { AiChatMessage, AiDebugRecord, ContentPart } from "@tsian/contracts"

import type { ToolSchema } from "../../agent-runtime/tool-schemas"
import type { BrowserAiConfig } from "../../config/ai"

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

export interface NativeRequestBuildOptions {
  forceToolName?: string
}

export interface ProviderAdapter {
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
    options?: NativeRequestBuildOptions,
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
    options?: NativeRequestBuildOptions,
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
   * complete `functionCall` part at once; Claude emits `content_block_start`
   * (tool_use id/name) then `input_json_delta` chunks. The stream loop merges
   * these into `NativeToolCall[]` keyed by index/id.
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

export interface GenerateAssistantReplyNativeOptions extends GenerateAssistantReplyOptions {
  /** Native tool schemas to advertise; empty means a native call without tools. */
  tools?: ToolSchema[]
  /** Probe-only: ask the provider to force one specific native tool call. */
  forceToolName?: string
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

export interface NativeToolCallingProbeResult {
  ok: boolean
  message: string
}

export interface StreamAssistantReplyTextOptions extends GenerateAssistantReplyOptions {
  /**
   * Streaming text-delta callback for text-protocol mode. Invoked with raw
   * incremental content deltas and `kind: "content"` only — text protocol has
   * no separate reasoning stream; chain-of-thought lives in the content text as
   * <think>/<thought>/<thinking> blocks, stripped by stripForDisplay for display
   * and by stripThinkBlocks for the authoritative round-end parse.
   */
  onDelta?: (delta: string, round: number, kind: "reasoning" | "content") => void
  /** Tool-loop round index for this single stream call. Defaults to 0. */
  round?: number
}
