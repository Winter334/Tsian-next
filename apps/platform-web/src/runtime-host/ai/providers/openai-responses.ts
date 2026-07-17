import { parseBrowserAiCustomRequestParams, providerParamsForKind, type BrowserAiModelParameters, type BrowserOpenAiResponsesModelParameters } from "../../../config/ai"
import type { ToolSchema } from "../../../agent-runtime/tool-schemas"

import { buildResponsesContent } from "../content"
import type { AiChatMessage, ModelCallResult, NativeToolCall, ProviderAdapter, RuntimeChatMessage } from "../types"
import { isRecord, putOptionalNumber } from "./shared"

function buildResponsesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/responses`
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
  toolChoice?: unknown
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

  if (input.toolChoice !== undefined) {
    result.tool_choice = input.toolChoice
  } else {
    delete result.tool_choice
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

export const responsesAdapter: ProviderAdapter = {
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
  buildNativeRequestBody(config, messages, tools, options) {
    const responseTools = buildResponsesTools(tools)
    return buildResponsesRequestBody({
      model: config.model,
      input: buildResponsesNativeInput(messages),
      parameters: config.parameters,
      ...(responseTools.length > 0 ? { tools: responseTools } : {}),
      ...(options?.forceToolName ? { toolChoice: { type: "function", name: options.forceToolName } } : {}),
    })
  },
  extractNativeResult: extractResponsesResult,
  buildStreamUrl(config) {
    return buildResponsesUrl(config.baseUrl)
  },
  buildStreamRequestBody(config, messages, tools, options) {
    const responseTools = buildResponsesTools(tools)
    return buildResponsesRequestBody({
      model: config.model,
      input: buildResponsesNativeInput(messages),
      parameters: config.parameters,
      ...(responseTools.length > 0 ? { tools: responseTools } : {}),
      ...(options?.forceToolName ? { toolChoice: { type: "function", name: options.forceToolName } } : {}),
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
