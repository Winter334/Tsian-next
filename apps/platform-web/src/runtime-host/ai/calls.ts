import { getBrowserAiConfig } from "../../config/ai"

import { contentToTextPreview } from "./content"
import {
  buildDebugMessageSegments,
  getChatTimeoutMs,
  logDebugGroup,
  maskSecret,
  previewText,
} from "./debug-records"
import {
  AiHttpStatusError,
  AiResponseParseError,
  AiStreamResponseError,
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
import { beginAiRequestTrace } from "./trace-recorder"
import type {
  AiChatMessage,
  GenerateAssistantReplyNativeOptions,
  GenerateAssistantReplyOptions,
  ModelCallResult,
  NativeToolCall,
  RuntimeChatMessage,
  StreamAssistantReplyNativeOptions,
  StreamAssistantReplyTextOptions,
} from "./types"

function createAiHttpStatusError(response: Response, payload: unknown): AiHttpStatusError {
  const message = extractErrorMessage(payload) ?? `AI request failed with status ${response.status}.`
  return new AiHttpStatusError(response.status, payload, message)
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

function throwFinalAiError(requestId: string, error: unknown): never {
  const publicError = toPublicAiRequestError(error)
  logFinalAiError(requestId, error)
  throw publicError
}

function parseProviderResponse<T>(extract: () => T): T {
  try {
    return extract()
  } catch (error) {
    if (error instanceof AiResponseParseError) throw error
    const parseError = new AiResponseParseError(
      error instanceof Error ? error.message : "AI response format is not supported.",
    )
    ;(parseError as Error & { cause?: unknown }).cause = error
    throw parseError
  }
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

  const adapter = selectAdapter(config.kind)
  const url = adapter.buildUrl(config)
  const requestBody = adapter.buildRequestBody(config, messages)
  const requestHeaders = adapter.buildHeaders(config)
  const trace = await beginAiRequestTrace({
    context: options.traceContext,
    provider: config.kind,
    model: config.model,
    endpoint: url,
    streaming: false,
    parameters: config.parameters,
    messages,
    headers: requestHeaders,
    body: requestBody,
  })
  const requestId = trace.requestId
  const messageSegments = buildDebugMessageSegments(messages)

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
  try {
    const result = await withAiRequestRetry({
      requestId,
      operation: "request",
      signal: options.signal,
      onAttempt: trace.onAttempt,
      attempt: async () => {
        const attemptResult = await fetchJsonWithTimeout({
          url,
          init: {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
          },
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        if (!attemptResult.response.ok) {
          throw createAiHttpStatusError(attemptResult.response, attemptResult.payload)
        }
        const content = parseProviderResponse(() => adapter.extractText(attemptResult.payload))
        return {
          ...attemptResult,
          content,
          usage: extractUsageFromPayload(attemptResult.payload, config.kind),
        }
      },
    })
    const payload = result.payload
    const { content, usage } = result
    await trace.succeed({ text: content, finishReason: "stop", usage, providerPayload: payload })

    logDebugGroup(`[Tsian AI ${requestId}] response`, {
      content: previewText(content, 2400),
      payload,
    })

    return content
  } catch (error) {
    await trace.fail(error, { signal: options.signal })
    throwFinalAiError(requestId, error)
  }
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

  const adapter = selectAdapter(config.kind)
  const url = adapter.buildUrl(config)
  const tools = options.tools ?? []
  const requestBody = adapter.buildNativeRequestBody(config, messages, tools, { forceToolName: options.forceToolName })
  const requestHeaders = adapter.buildHeaders(config)
  const trace = await beginAiRequestTrace({
    context: options.traceContext,
    provider: config.kind,
    model: config.model,
    endpoint: url,
    streaming: false,
    parameters: config.parameters,
    messages,
    tools,
    headers: requestHeaders,
    body: requestBody,
  })
  const requestId = trace.requestId
  const messageSegments = buildDebugMessageSegments(messages)

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
  try {
    const result = await withAiRequestRetry({
      requestId,
      operation: "native request",
      signal: options.signal,
      onAttempt: trace.onAttempt,
      attempt: async () => {
        const attemptResult = await fetchJsonWithTimeout({
          url,
          init: {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
          },
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        if (!attemptResult.response.ok) {
          throw createAiHttpStatusError(attemptResult.response, attemptResult.payload)
        }
        const modelResult = parseProviderResponse(() => adapter.extractNativeResult(attemptResult.payload))
        return {
          ...attemptResult,
          modelResult,
          usage: extractUsageFromPayload(attemptResult.payload, config.kind),
        }
      },
    })
    const payload = result.payload
    const { modelResult, usage } = result
    await trace.succeed({
      text: modelResult.raw,
      toolCalls: modelResult.toolCalls,
      finishReason: modelResult.finishReason,
      usage,
      providerPayload: payload,
    })

    logDebugGroup(`[Tsian AI ${requestId}] native response`, {
      text: previewText(modelResult.text, 2400),
      toolCalls: modelResult.toolCalls,
      finishReason: modelResult.finishReason,
      payload,
    })

    return { ...modelResult, usage }
  } catch (error) {
    await trace.fail(error, { signal: options.signal })
    throwFinalAiError(requestId, error)
  }
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
  const adapter = selectAdapter(config.kind)
  const url = adapter.buildStreamUrl(config)
  const tools = options.tools ?? []
  const requestBody = adapter.buildStreamRequestBody(config, messages, tools, { forceToolName: options.forceToolName })
  const requestHeaders = adapter.buildHeaders(config)
  const trace = await beginAiRequestTrace({
    context: options.traceContext,
    provider: config.kind,
    model: config.model,
    endpoint: url,
    streaming: true,
    parameters: config.parameters,
    messages,
    tools,
    headers: requestHeaders,
    body: requestBody,
  })
  const requestId = trace.requestId
  const messageSegments = buildDebugMessageSegments(messages)

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
  let providerPayload: unknown
  let partialText = ""
  let partialToolCalls: NativeToolCall[] = []
  let partialUsage: ModelCallResult["usage"]
  let partialFinishReason: ModelCallResult["finishReason"] | undefined
  const emitDelta = (delta: string, kind: "reasoning" | "content") => {
    if (!options.onDelta) return
    emittedDelta = true
    options.onDelta(delta, round, kind)
  }

  try {
    const result = await withAiRequestRetry({
      requestId,
      operation: "stream request",
      signal: options.signal,
      onAttempt: trace.onAttempt,
      canRetryAfterError: () => !emittedDelta,
      attempt: async () => {
        partialText = ""
        partialToolCalls = []
        partialUsage = undefined
        partialFinishReason = undefined
        const timed = createTimedAbortSignal({
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal: timed.signal,
          })

          if (!response.ok) {
            const payload = await readJsonPayload(response, timed.signal, true)
            throw createAiHttpStatusError(response, payload)
          }

          // Non-SSE fallback: endpoint answered with a regular JSON body.
          const contentType = response.headers.get("content-type") ?? ""
          if (!contentType.includes("text/event-stream")) {
            const payload = await readJsonPayload(response, timed.signal)
            providerPayload = payload
            const result = parseProviderResponse(() => adapter.extractNativeResult(payload))
            const usage = extractUsageFromPayload(payload, config.kind)
            partialText = result.raw
            partialToolCalls = result.toolCalls
            partialUsage = usage
            partialFinishReason = result.finishReason
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
              } catch (error) {
                const parseError = new AiResponseParseError("AI stream contained an invalid JSON data event.")
                ;(parseError as Error & { cause?: unknown }).cause = error
                throw parseError
              }

              const streamError = adapter.extractStreamError?.(data) ?? extractErrorMessage(data)
              if (streamError) {
                throw new AiStreamResponseError(streamError)
              }

              // Provider usage arrives in the terminating chunk (OpenAI with
              // include_usage, Claude message_delta, Gemini usageMetadata). Extract
              // on every chunk; the last non-undefined one wins (usage only appears
              // once, near the end).
              const chunkUsage = extractUsageFromPayload(data, config.kind)
              if (chunkUsage) {
                streamUsage = chunkUsage
                partialUsage = chunkUsage
              }

              const delta = adapter.extractStreamDelta(data)
              if (delta !== undefined && delta !== "") {
                textBuffer += delta
                partialText = textBuffer
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
              partialToolCalls = finalizeStreamedToolCalls(toolAccumulator)
              if (toolAccumulator.size > 0) {
                isToolRound = true
              }

              const finish = adapter.extractStreamFinish(data)
              if (finish) {
                finishReason = finish
                partialFinishReason = finish
              }
            }
          }

          const toolCalls = finalizeStreamedToolCalls(toolAccumulator)
          partialText = textBuffer
          partialToolCalls = toolCalls
          const resolvedFinish: "stop" | "tool_calls" =
            finishReason ?? (isToolRound || toolCalls.length > 0 ? "tool_calls" : "stop")

          const result: ModelCallResult = {
            text: resolvedFinish === "tool_calls" ? "" : textBuffer,
            toolCalls,
            raw: textBuffer,
            finishReason: resolvedFinish,
            ...(streamUsage ? { usage: streamUsage } : {}),
          }

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
    await trace.succeed({
      text: result.raw,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      usage: result.usage,
      ...(providerPayload !== undefined ? { providerPayload } : {}),
    })
    return result
  } catch (error) {
    await trace.fail(error, {
      signal: options.signal,
      ...(partialText
        || partialToolCalls.length > 0
        || partialUsage
        || partialFinishReason
        || providerPayload !== undefined
        ? {
            response: {
              text: partialText,
              toolCalls: partialToolCalls,
              ...(partialFinishReason ? { finishReason: partialFinishReason } : {}),
              ...(partialUsage ? { usage: partialUsage } : {}),
              ...(providerPayload !== undefined ? { providerPayload } : {}),
            },
          }
        : {}),
    })
    throwFinalAiError(requestId, error)
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
  const adapter = selectAdapter(config.kind)
  // Use the non-stream URL builder + body builder (text protocol uses plain
  // AiChatMessage[], not RuntimeChatMessage[]). We inject stream:true after.
  const url = adapter.buildStreamUrl(config)
  const requestBody = adapter.buildRequestBody(config, messages)
  ;(requestBody as Record<string, unknown>).stream = true
  enableOpenAiCompatibleStreamUsage(requestBody, config.kind)
  const requestHeaders = adapter.buildHeaders(config)
  const trace = await beginAiRequestTrace({
    context: options.traceContext,
    provider: config.kind,
    model: config.model,
    endpoint: url,
    streaming: true,
    parameters: config.parameters,
    messages,
    headers: requestHeaders,
    body: requestBody,
  })
  const requestId = trace.requestId
  const messageSegments = buildDebugMessageSegments(messages)

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
  let providerPayload: unknown
  let finalUsage: ModelCallResult["usage"]
  let finalFinishReason: ModelCallResult["finishReason"] | undefined
  let partialText = ""
  const emitDelta = (delta: string) => {
    if (!options.onDelta) return
    emittedDelta = true
    options.onDelta(delta, round, "content")
  }

  try {
    const text = await withAiRequestRetry({
      requestId,
      operation: "text stream request",
      signal: options.signal,
      onAttempt: trace.onAttempt,
      canRetryAfterError: () => !emittedDelta,
      attempt: async () => {
        partialText = ""
        finalUsage = undefined
        finalFinishReason = undefined
        const timed = createTimedAbortSignal({
          signal: options.signal,
          timeoutMs,
          timeoutMessage,
        })
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal: timed.signal,
          })

          if (!response.ok) {
            const payload = await readJsonPayload(response, timed.signal, true)
            throw createAiHttpStatusError(response, payload)
          }

          // Non-SSE fallback: endpoint answered with a regular JSON body. Use the
          // non-stream adapter's extractText (text protocol, not native extractResult).
          const contentType = response.headers.get("content-type") ?? ""
          if (!contentType.includes("text/event-stream")) {
            const payload = await readJsonPayload(response, timed.signal)
            providerPayload = payload
            const content = parseProviderResponse(() => adapter.extractText(payload))
            const usage = extractUsageFromPayload(payload, config.kind)
            finalUsage = usage
            partialText = content
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
              } catch (error) {
                const parseError = new AiResponseParseError("AI stream contained an invalid JSON data event.")
                ;(parseError as Error & { cause?: unknown }).cause = error
                throw parseError
              }

              const streamError = adapter.extractStreamError?.(data) ?? extractErrorMessage(data)
              if (streamError) {
                throw new AiStreamResponseError(streamError)
              }

              // Provider usage arrives in the terminating chunk.
              const chunkUsage = extractUsageFromPayload(data, config.kind)
              if (chunkUsage) {
                streamUsage = chunkUsage
                finalUsage = chunkUsage
              }

              // Text protocol: only extract content deltas. Tool calls and
              // reasoning are embedded in the content text, not structured SSE
              // fields — they are parsed/stripped post-hoc by the runtime layer.
              const delta = adapter.extractStreamDelta(data)
              if (delta !== undefined && delta !== "") {
                textBuffer += delta
                partialText = textBuffer
                // Emit the raw incremental delta. The UI accumulates this into
                // streamingText; the render layer applies stripForDisplay at display
                // time (closed blocks hidden, unclosed tail blocks visible). This
                // keeps the delta stream compatible with the native-mode onDelta
                // contract (incremental, accumulative).
                emitDelta(delta)
              }

              const finish = adapter.extractStreamFinish(data)
              if (finish) finalFinishReason = finish

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
          finalUsage = streamUsage
          partialText = textBuffer
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
    await trace.succeed({
      text,
      finishReason: finalFinishReason ?? "stop",
      usage: finalUsage,
      ...(providerPayload !== undefined ? { providerPayload } : {}),
    })
    return text
  } catch (error) {
    await trace.fail(error, {
      signal: options.signal,
      ...(partialText || finalUsage || finalFinishReason || providerPayload !== undefined
        ? {
            response: {
              text: partialText,
              ...(finalFinishReason ? { finishReason: finalFinishReason } : {}),
              ...(finalUsage ? { usage: finalUsage } : {}),
              ...(providerPayload !== undefined ? { providerPayload } : {}),
            },
          }
        : {}),
    })
    throwFinalAiError(requestId, error)
  }
}
