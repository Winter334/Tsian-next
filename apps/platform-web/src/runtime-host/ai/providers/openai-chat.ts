import { parseBrowserAiCustomRequestParams, providerParamsForKind, type BrowserAiModelParameters, type BrowserAiProviderKind, type BrowserDeepSeekModelParameters, type BrowserOpenAiCompatibleModelParameters } from "../../../config/ai"

import { buildOpenAiContent } from "../content"
import type { AiChatMessage, NativeToolCall, ProviderAdapter } from "../types"
import { enableOpenAiCompatibleStreamUsage, putOptionalNumber } from "./shared"

function buildChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`
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

export const openaiAdapter: ProviderAdapter = {
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
  buildNativeRequestBody(config, messages, tools, options) {
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
    if (options?.forceToolName) {
      body.tool_choice = {
        type: "function",
        function: { name: options.forceToolName },
      }
    }
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
  buildStreamRequestBody(config, messages, tools, options) {
    const body = this.buildNativeRequestBody(config, messages, tools, options)
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
