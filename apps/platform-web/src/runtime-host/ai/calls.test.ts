import "fake-indexeddb/auto"
import type { DiagnosticAiRequestRecord } from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BrowserAiConfig } from "../../config/ai"
import { localDb } from "../../storage/db"
import { queryDiagnosticRecords } from "../../storage/diagnostic-records"
import { generateAssistantReply, streamAssistantReplyText } from "./calls"

const config: BrowserAiConfig = {
  kind: "openai-compatible",
  baseUrl: "https://example.test/v1",
  apiKey: "provider-secret",
  model: "test-model",
  toolCallMode: "text",
  streaming: true,
  parameters: {
    common: {
      contextWindow: null,
      maxOutputTokens: null,
      temperature: null,
      topP: null,
    },
    provider: {
      openaiCompatible: {
        frequencyPenalty: null,
        presencePenalty: null,
        reasoningEffort: "",
        customRequestParamsText: "",
      },
    },
  },
}

async function latestRequest(): Promise<DiagnosticAiRequestRecord> {
  const page = await queryDiagnosticRecords({ recordType: "ai-request", limit: 1 })
  return page.items[0] as DiagnosticAiRequestRecord
}

function sseResponse(events: string[]): Response {
  const body = events.map((event) => `data: ${event}\n\n`).join("")
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await localDb.delete()
})

describe("provider-boundary diagnostics", () => {
  it("records a successful request and recursively removes credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "complete response" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
    }), { status: 200, headers: { "content-type": "application/json" } })))

    await expect(generateAssistantReply([{ role: "user", content: "complete request" }], { config }))
      .resolves.toBe("complete response")
    const record = await latestRequest()
    expect(record).toMatchObject({ status: "succeeded", provider: "openai-compatible", model: "test-model" })
    expect(record.attempts.map((attempt) => attempt.status)).toEqual(["succeeded"])
    expect(record.response).toMatchObject({ text: "complete response", usage: { input: 4, output: 2, total: 6 } })
    expect(JSON.stringify(record)).not.toContain("provider-secret")
  })

  it("records HTTP and successful-response parse failures on their attempts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ error: { message: "bad request" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    )))
    await expect(generateAssistantReply([{ role: "user", content: "http" }], { config })).rejects.toThrow("bad request")
    expect(await latestRequest()).toMatchObject({
      status: "failed",
      error: { type: "http", status: 400 },
      attempts: [{ status: "failed", error: { type: "http", status: 400 } }],
    })

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not-json", { status: 200 })))
    await expect(generateAssistantReply([{ role: "user", content: "parse" }], { config })).rejects.toThrow("valid JSON")
    expect(await latestRequest()).toMatchObject({
      status: "failed",
      error: { type: "parse" },
      attempts: [{ status: "failed", error: { type: "parse" } }],
    })
  })

  it("preserves partial stream text when a later SSE event is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: "partial" } }] }),
      "not-json",
    ])))

    await expect(streamAssistantReplyText(
      [{ role: "user", content: "stream" }],
      { config, onDelta: () => undefined },
    )).rejects.toThrow("invalid JSON data event")
    expect(await latestRequest()).toMatchObject({
      status: "failed",
      streaming: true,
      error: { type: "parse" },
      response: { text: "partial" },
      attempts: [{ status: "failed", error: { type: "parse" } }],
    })
  })

  it("records provider stream errors and pre-request cancellation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse([
      JSON.stringify({ error: { message: "stream exploded" } }),
    ])))
    await expect(streamAssistantReplyText([{ role: "user", content: "stream error" }], { config }))
      .rejects.toThrow("stream exploded")
    expect(await latestRequest()).toMatchObject({ status: "failed", error: { type: "stream" } })

    const controller = new AbortController()
    controller.abort("user-cancelled")
    await expect(generateAssistantReply(
      [{ role: "user", content: "cancel" }],
      { config, signal: controller.signal },
    )).rejects.toBe("user-cancelled")
    expect(await latestRequest()).toMatchObject({ status: "aborted", error: { type: "abort" }, attempts: [] })
  })
})
