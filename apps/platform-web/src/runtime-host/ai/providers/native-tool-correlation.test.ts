import { describe, expect, it } from "vitest"
import {
  createDefaultBrowserAiModelParameters,
  type BrowserAiConfig,
  type BrowserAiProviderKind,
} from "../../../config/ai"
import type { RuntimeChatMessage } from "../types"
import { claudeAdapter } from "./claude"
import { geminiAdapter } from "./gemini"
import { openaiAdapter } from "./openai-chat"
import { responsesAdapter } from "./openai-responses"

const messages: RuntimeChatMessage[] = [
  {
    role: "assistant",
    content: "",
    toolCalls: [
      { id: "call-a", name: "read", arguments: { path: "a" } },
      { id: "call-b", name: "search", arguments: { query: "b" } },
    ],
  },
  { role: "tool", toolCallId: "call-a", content: "A" },
  { role: "tool", toolCallId: "call-b", content: "B" },
]

function config(kind: BrowserAiProviderKind): BrowserAiConfig {
  return {
    kind,
    baseUrl: "https://example.test",
    apiKey: "",
    model: "model",
    toolCallMode: "native",
    streaming: false,
    parameters: createDefaultBrowserAiModelParameters(),
  }
}

describe("provider native parallel tool correlation", () => {
  it("keeps OpenAI Chat tool_call_id values independent", () => {
    const body = openaiAdapter.buildNativeRequestBody!(config("openai-compatible"), messages, []) as {
      messages: Array<Record<string, unknown>>
    }
    expect(body.messages.slice(-2).map((item) => item.tool_call_id)).toEqual(["call-a", "call-b"])
  })

  it("keeps OpenAI Responses call_id values independent", () => {
    const body = responsesAdapter.buildNativeRequestBody!(config("openai-responses"), messages, []) as {
      input: Array<Record<string, unknown>>
    }
    expect(body.input.filter((item) => item.type === "function_call_output").map((item) => item.call_id))
      .toEqual(["call-a", "call-b"])
  })

  it("groups Claude tool_result blocks in one user message without losing ids", () => {
    const body = claudeAdapter.buildNativeRequestBody!(config("claude"), messages, []) as {
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>
    }
    const lastMessage = body.messages[body.messages.length - 1]
    const toolResults = lastMessage?.content ?? []
    expect(lastMessage?.role).toBe("user")
    expect(toolResults.map((item) => item.tool_use_id)).toEqual(["call-a", "call-b"])
  })

  it("groups Gemini functionResponse parts without losing ids", () => {
    const body = geminiAdapter.buildNativeRequestBody!(config("gemini"), messages, []) as {
      contents: Array<{ role: string; parts: Array<{ functionResponse?: { id?: string; name?: string } }> }>
    }
    const lastContent = body.contents[body.contents.length - 1]
    const parts = lastContent?.parts ?? []
    expect(lastContent?.role).toBe("user")
    expect(parts.map((part) => part.functionResponse?.id)).toEqual(["call-a", "call-b"])
    expect(parts.map((part) => part.functionResponse?.name)).toEqual(["read", "search"])
  })
})
