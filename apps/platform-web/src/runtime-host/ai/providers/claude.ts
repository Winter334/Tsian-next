import { providerParamsForKind, type BrowserAiConfig, type BrowserAiModelParameters, type BrowserClaudeModelParameters } from "../../../config/ai"
import type { ToolSchema } from "../../../agent-runtime/tool-schemas"

import { buildClaudeContent, splitSystemMessage, splitSystemMessages } from "../content"
import type { NativeToolCall, ProviderAdapter, RuntimeChatMessage } from "../types"
import { mergeProviderCustomParams, putOptionalNumber, putOptionalStringArray } from "./shared"

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
  forceToolName?: string
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
    if (input.forceToolName) {
      body.tool_choice = {
        type: "tool",
        name: input.forceToolName,
        disable_parallel_tool_use: true,
      }
    }
  }
  return mergeProviderCustomParams(body, provider.customRequestParamsText)
}

export const claudeAdapter: ProviderAdapter = {
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
  buildNativeRequestBody(config, messages, tools, options) {
    const { system, rest } = splitSystemMessages(messages)
    return buildClaudeRequestBody({
      config,
      system,
      messages: rest.map((message) => buildClaudeNativeMessage(message)),
      tools,
      forceToolName: options?.forceToolName,
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
  buildStreamRequestBody(config, messages, tools, options) {
    const body = this.buildNativeRequestBody(config, messages, tools, options)
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
