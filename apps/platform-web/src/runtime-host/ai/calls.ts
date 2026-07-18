import { getBrowserAiConfig } from "../../config/ai"

import { contentToTextPreview } from "./content"
import {
  buildDebugMessageSegments,
  createAiDebugRequestId,
  getChatTimeoutMs,
  logDebugGroup,
  maskSecret,
  previewText,
  pushAiDebugRecord,
  updateAiDebugRecord,
} from "./debug-records"
import {
  AiHttpStatusError,
  createAiRequestTimeoutError,
  createTimedAbortSignal,
  fetchJsonWithTimeout,
  parseSseChunk,
  readJsonPayload,
  withAiRequestRetry,
} from "./fetch"
import { selectAdapter } from "./providers"
import { enableOpenAiCompatibleStreamUsage, extractErrorMessage, extractUsageFromPayload } from "./providers/shared"
import { finalizeStreamedToolCalls } from "./tool-calls"
import type {
  AiChatMessage,
  GenerateAssistantReplyNativeOptions,
  GenerateAssistantReplyOptions,
  ModelCallResult,
  RuntimeChatMessage,
  StreamAssistantReplyNativeOptions,
  StreamAssistantReplyTextOptions,
} from "./types"

function createAiHttpStatusError(response: Response, payload: unknown): AiHttpStatusError {
  const message = extractErrorMessage(payload) ?? `AI request failed with status ${response.status}.`
  return new AiHttpStatusError(response.status, payload, message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toPublicAiRequestError(error: unknown): unknown {
  if (!(error instanceof AiHttpStatusError)) {
    return error
  }
  const publicError = new Error(error.message)
  ;(publicError as Error & { cause?: unknown }).cause = error
  return publicError
}

function logFinalAiError(requestId: string, error: unknown): void {
  if (error instanceof AiHttpStatusError) {
    console.warn(`[Tsian AI ${requestId}] error`, {
      status: error.status,
      payload: error.payload,
    })
    return
  }
  console.warn(`[Tsian AI ${requestId}] error`, { error })
}

function updateAndThrowFinalAiError(requestId: string, error: unknown): never {
  const publicError = toPublicAiRequestError(error)
  const message = errorMessage(publicError)
  logFinalAiError(requestId, error)
  updateAiDebugRecord(requestId, { error: message })
  throw publicError
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

  const requestId = createAiDebugRequestId(options.debugLabel ?? "chat")
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

  const timeoutMs = getChatTimeoutMs()
  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${timeoutMs} ms.`
  let payload: unknown
  try {
    const result = await withAiRequestRetry({
      requestId,
      operation: "request",
      signal: options.signal,
      attempt: async () => {
        const attemptResult = await fetchJsonWithTimeout({
          url,
          init: {
            method: "POST",
            headers: adapter.buildHeaders(config),
            body: JSON.stringify(requestBody),
          },
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        if (!attemptResult.response.ok) {
          throw createAiHttpStatusError(attemptResult.response, attemptResult.payload)
        }
        return attemptResult
      },
    })
    payload = result.payload
  } catch (error) {
    updateAndThrowFinalAiError(requestId, error)
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

  const requestId = createAiDebugRequestId(options.debugLabel ?? "chat-native")
  const adapter = selectAdapter(config.kind)
  const url = adapter.buildUrl(config)
  const tools = options.tools ?? []
  const requestBody = adapter.buildNativeRequestBody(config, messages, tools, { forceToolName: options.forceToolName })
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

  const timeoutMs = getChatTimeoutMs()
  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${timeoutMs} ms.`
  let payload: unknown
  try {
    const result = await withAiRequestRetry({
      requestId,
      operation: "native request",
      signal: options.signal,
      attempt: async () => {
        const attemptResult = await fetchJsonWithTimeout({
          url,
          init: {
            method: "POST",
            headers: adapter.buildHeaders(config),
            body: JSON.stringify(requestBody),
          },
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        if (!attemptResult.response.ok) {
          throw createAiHttpStatusError(attemptResult.response, attemptResult.payload)
        }
        return attemptResult
      },
    })
    payload = result.payload
  } catch (error) {
    updateAndThrowFinalAiError(requestId, error)
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
  const requestId = createAiDebugRequestId(options.debugLabel ?? "chat-stream")
  const adapter = selectAdapter(config.kind)
  const url = adapter.buildStreamUrl(config)
  const tools = options.tools ?? []
  const requestBody = adapter.buildStreamRequestBody(config, messages, tools, { forceToolName: options.forceToolName })
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

  const timeoutMs = getChatTimeoutMs()
  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${timeoutMs} ms.`
  let emittedDelta = false
  const emitDelta = (delta: string, kind: "reasoning" | "content") => {
    if (!options.onDelta) return
    emittedDelta = true
    options.onDelta(delta, round, kind)
  }

  try {
    return await withAiRequestRetry({
      requestId,
      operation: "stream request",
      signal: options.signal,
      canRetryAfterError: () => !emittedDelta,
      attempt: async () => {
        const timed = createTimedAbortSignal({
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: adapter.buildHeaders(config),
            body: JSON.stringify(requestBody),
            signal: timed.signal,
          })

          if (!response.ok) {
            const payload = await readJsonPayload(response, timed.signal)
            throw createAiHttpStatusError(response, payload)
          }

          // Non-SSE fallback: endpoint answered with a regular JSON body.
          const contentType = response.headers.get("content-type") ?? ""
          if (!contentType.includes("text/event-stream")) {
            const payload = await readJsonPayload(response, timed.signal)
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
          }

          if (!response.body) {
            throw new Error("Streaming response has no body.")
          }

          reader = response.body.getReader()
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
                emitDelta(delta, "content")
              }

              // Reasoning/chain-of-thought deltas are extracted separately and routed
              // with kind "reasoning"; they never enter textBuffer (result.text stays
              // the visible reply only).
              const reasoningDelta = adapter.extractStreamReasoningDelta?.(data)
              if (reasoningDelta !== undefined && reasoningDelta !== "") {
                emitDelta(reasoningDelta, "reasoning")
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
        } catch (error) {
          if (timed.timedOut()) {
            throw createAiRequestTimeoutError(timeoutMessage, error)
          }
          throw error
        } finally {
          timed.cleanup()
          if (reader) {
            try {
              reader.releaseLock()
            } catch {
              // Reader already released.
            }
          }
        }
      },
    })
  } catch (error) {
    updateAndThrowFinalAiError(requestId, error)
  }
}

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
  const requestId = createAiDebugRequestId(options.debugLabel ?? "chat-stream-text")
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

  const timeoutMs = getChatTimeoutMs()
  const timeoutMessage = `[Tsian AI ${requestId}] request timed out after ${timeoutMs} ms.`
  let emittedDelta = false
  const emitDelta = (delta: string) => {
    if (!options.onDelta) return
    emittedDelta = true
    options.onDelta(delta, round, "content")
  }

  try {
    return await withAiRequestRetry({
      requestId,
      operation: "text stream request",
      signal: options.signal,
      canRetryAfterError: () => !emittedDelta,
      attempt: async () => {
        const timed = createTimedAbortSignal({
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: adapter.buildHeaders(config),
            body: JSON.stringify(requestBody),
            signal: timed.signal,
          })

          if (!response.ok) {
            const payload = await readJsonPayload(response, timed.signal)
            throw createAiHttpStatusError(response, payload)
          }

          // Non-SSE fallback: endpoint answered with a regular JSON body. Use the
          // non-stream adapter's extractText (text protocol, not native extractResult).
          const contentType = response.headers.get("content-type") ?? ""
          if (!contentType.includes("text/event-stream")) {
            const payload = await readJsonPayload(response, timed.signal)
            const content = adapter.extractText(payload)
            const usage = extractUsageFromPayload(payload, config.kind)
            updateAiDebugRecord(requestId, { responseText: content, usage })
            logDebugGroup(`[Tsian AI ${requestId}] text stream non-SSE fallback`, {
              content: previewText(content, 2400),
              payload,
            })
            // Emit one delta for the complete text so the UI shows it.
            if (content) {
              emitDelta(content)
            }
            return content
          }

          if (!response.body) {
            throw new Error("Streaming response has no body.")
          }

          reader = response.body.getReader()
          const decoder = new TextDecoder()
          let lineBuffer = ""
          let textBuffer = ""
          let streamEnded = false
          let streamUsage: { input?: number; output?: number; total?: number } | undefined
          const isClaude = config.kind === "claude"
          let currentEvent = ""

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
                emitDelta(delta)
              }

              // We do NOT call extractStreamToolCalls or extractStreamReasoningDelta
              // here — text protocol has no structured tool-call or reasoning
              // fields. The finish reason is also not needed; the runtime layer
              // determines tool_calls vs stop by parsing the full buffer at round
              // end: the Agent Runtime classifies the round by parsing the full
              // Text Tool Protocol v2 buffer after streaming completes.
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
        } catch (error) {
          if (timed.timedOut()) {
            throw createAiRequestTimeoutError(timeoutMessage, error)
          }
          throw error
        } finally {
          timed.cleanup()
          if (reader) {
            try {
              reader.releaseLock()
            } catch {
              // Reader already released.
            }
          }
        }
      },
    })
  } catch (error) {
    updateAndThrowFinalAiError(requestId, error)
  }
}
