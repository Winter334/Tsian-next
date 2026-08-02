import { providerParamsForKind, type BrowserAiConfig, type BrowserAiModelParameters, type BrowserGeminiModelParameters } from "../../../config/ai"
import type { ToolSchema } from "../../../agent-runtime/tool-schemas"

import { buildGeminiParts, splitSystemMessage, splitSystemMessages } from "../content"
import type { NativeToolCall, ProviderAdapter, RuntimeChatMessage } from "../types"
import { isRecord, mergeProviderCustomParams, parseOptionalJsonObjectText, putOptionalNumber, putOptionalStringArray } from "./shared"

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

function buildGeminiNativeContents(messages: RuntimeChatMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = []
  const toolNamesById = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== "assistant") continue
    for (const call of message.toolCalls ?? []) {
      toolNamesById.set(call.id, call.name)
    }
  }
  for (let index = 0; index < messages.length;) {
    const message = messages[index]!
    if (message.role !== "tool") {
      result.push(buildGeminiNativeContent(message))
      index += 1
      continue
    }
    const parts: Array<Record<string, unknown>> = []
    while (index < messages.length && messages[index]!.role === "tool") {
      const toolMessage = messages[index] as Extract<RuntimeChatMessage, { role: "tool" }>
      parts.push({
        functionResponse: {
          id: toolMessage.toolCallId,
          name: toolNamesById.get(toolMessage.toolCallId) ?? toolMessage.toolCallId,
          response: { result: toolMessage.content },
        },
      })
      index += 1
    }
    result.push({ role: "user", parts })
  }
  return result
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

function buildGeminiRequestBody(input: {
  config: BrowserAiConfig
  contents: Record<string, unknown>[]
  system?: string
  tools?: ToolSchema[]
  forceToolName?: string
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
    if (input.forceToolName) {
      body.toolConfig = {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [input.forceToolName],
        },
      }
    }
  }
  return mergeProviderCustomParams(body, provider.customRequestParamsText)
}

export const geminiAdapter: ProviderAdapter = {
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
  buildNativeRequestBody(config, messages, tools, options) {
    const { system, rest } = splitSystemMessages(messages)
    return buildGeminiRequestBody({
      config,
      system,
      contents: buildGeminiNativeContents(rest),
      tools,
      forceToolName: options?.forceToolName,
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
  buildStreamRequestBody(config, messages, tools, options) {
    // Gemini controls streaming via the URL; the body is the native shape.
    return this.buildNativeRequestBody(config, messages, tools, options)
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
