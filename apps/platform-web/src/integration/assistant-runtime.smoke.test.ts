// @vitest-environment happy-dom

import "fake-indexeddb/auto"
import type {
  ConversationMessageRecord,
  DiagnosticAiRequestRecord,
  GameCardManifest,
} from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ASSISTANT_CONTEXT_AGENT_ID,
  ASSISTANT_CONTEXT_SCHEMA,
  agentContextPath,
  createEmptyAgentContext,
  parseAgentContext,
  serializeAgentContext,
} from "../agent-runtime/context-lifecycle"
import {
  createBrowserAiModelConfig,
  createBrowserAiProviderPreset,
  createBrowserAiProviderType,
  saveBrowserPlatformConfigDraft,
} from "../config/ai"
import { markPlatformHostReady } from "../platform-host/host-state"
import { invokeAgent } from "../platform-host/ai-invocation"
import { runAssistantChat } from "../platform-host/assistant-chat"
import {
  assistantContextPath,
  createAssistantSession,
  createLocalSaveFromGameCard,
  getAssistantSessionMessages,
  loadLocalAssistantFiles,
  putLocalGameCard,
  queryDiagnosticRecords,
  readWorkspaceFileForSave,
  saveAssistantSessionMessages,
  saveLocalAssistantFiles,
  setActiveGameCardId,
  setActiveSaveId,
  writeWorkspaceFileForSave,
} from "../storage"
import { localDb } from "../storage/db"

const CARD_ID = "assistant-runtime-smoke"
const MODEL_ID = "assistant-smoke-model"
const PROVIDER_ID = "assistant-smoke-provider"
const PROVIDER_CREDENTIAL = "assistant-provider-secret"
const WORKSPACE_PATH = "save/assistant-smoke.txt"
const WORKSPACE_BASELINE = "before"
const STAGED_VALUE = "same-turn-staged-value"
const SIDE_AGENT_ID = "world-architect"
const SIDE_CONTEXT_SLOT = "assistant-smoke-side"

interface OpenAiRequestBody {
  messages?: Array<{
    role?: string
    content?: unknown
    tool_call_id?: string
  }>
}

function openAiToolResponse(
  id: string,
  name: string,
  args: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify({
    choices: [{
      message: {
        content: "",
        tool_calls: [{
          id,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
      finish_reason: "tool_calls",
    }],
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function openAiFinalResponse(content: string): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 },
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

function requestBody(init?: RequestInit): OpenAiRequestBody {
  if (typeof init?.body !== "string") {
    throw new Error("Assistant smoke expected a JSON request body.")
  }
  return JSON.parse(init.body) as OpenAiRequestBody
}

function toolObservation(body: OpenAiRequestBody, callId: string): string {
  const value = body.messages?.find((message) => (
    message.role === "tool" && message.tool_call_id === callId
  ))?.content
  return typeof value === "string" ? value : JSON.stringify(value ?? "")
}

async function configureProvider(): Promise<void> {
  const providerType = createBrowserAiProviderType("openai-compatible")
  providerType.presets.push(createBrowserAiProviderPreset({
    id: PROVIDER_ID,
    name: "Assistant smoke provider",
    baseUrl: "https://assistant-smoke.example/v1",
    apiKey: PROVIDER_CREDENTIAL,
    models: [createBrowserAiModelConfig({
      id: MODEL_ID,
      enabled: true,
      toolCallMode: "native",
      streaming: false,
    })],
    fallbackStrategy: "primary-only",
  }))
  await saveBrowserPlatformConfigDraft({
    activeProviderId: PROVIDER_ID,
    providerTypes: [providerType],
    embeddingConfig: {
      enabled: false,
      baseUrl: "",
      apiKey: "",
      model: "",
      dimensions: 0,
    },
  })
}

async function seedRuntime(input: {
  baselineMessages?: ConversationMessageRecord[]
  contextMarker: string
}): Promise<{
  saveId: string
  sessionId: string
  baselineMessages: ConversationMessageRecord[]
  baselineContext: string
}> {
  const manifest: GameCardManifest = {
    schema: "tsian.game-card.v1",
    id: CARD_ID,
    name: "Assistant Runtime Smoke",
    version: "1.0.0",
    summary: "Cross-layer Assistant transaction fixture",
  }
  const card = await putLocalGameCard({
    manifest,
    source: "local",
    contentFiles: [
      {
        path: `agents/${SIDE_AGENT_ID}/agent.json`,
        content: JSON.stringify({
          id: SIDE_AGENT_ID,
          title: "Smoke side Agent",
          summary: "Persistent task-mode side invocation fixture",
          contacts: [],
          contextPaths: [],
          skills: { enabled: [], disabled: [] },
          tools: { enabled: [], disabled: [] },
          platformTools: { enabled: ["workspace_read"], disabled: [] },
          workspaceAccess: { level: 1 },
        }, null, 2),
      },
      {
        path: `agents/${SIDE_AGENT_ID}/AGENT.md`,
        content: "# Smoke side Agent\n\nFollow the current request and use available workspace tools.\n",
      },
    ],
  })
  const save = await createLocalSaveFromGameCard(card, { name: "Assistant smoke" })
  await setActiveGameCardId(card.id)
  await setActiveSaveId(save.id)
  await writeWorkspaceFileForSave(save.id, {
    path: WORKSPACE_PATH,
    content: WORKSPACE_BASELINE,
  })

  const session = await createAssistantSession("local")
  const baselineMessages = input.baselineMessages ?? []
  await saveAssistantSessionMessages("local", session.id, baselineMessages)
  await loadLocalAssistantFiles()
  const context = {
    ...createEmptyAgentContext(session.id, {
      schema: ASSISTANT_CONTEXT_SCHEMA,
      agentId: ASSISTANT_CONTEXT_AGENT_ID,
    }),
    summary: input.contextMarker,
  }
  const baselineContext = serializeAgentContext(context)
  await saveLocalAssistantFiles([{
    path: assistantContextPath(session.id),
    content: baselineContext,
    createdAt: 0,
    updatedAt: 0,
  }])
  return {
    saveId: save.id,
    sessionId: session.id,
    baselineMessages,
    baselineContext,
  }
}

async function assistantContextContent(sessionId: string): Promise<string> {
  const path = assistantContextPath(sessionId)
  const file = (await loadLocalAssistantFiles()).find((entry) => entry.path === path)
  if (!file) throw new Error(`Assistant context fixture is missing: ${path}`)
  return file.content
}

async function diagnosticRequests(
  status: "succeeded" | "failed",
): Promise<DiagnosticAiRequestRecord[]> {
  const page = await queryDiagnosticRecords({
    recordType: "ai-request",
    status,
    limit: 20,
  })
  return page.items as DiagnosticAiRequestRecord[]
}

beforeEach(async () => {
  markPlatformHostReady()
  await localDb.delete()
  await localDb.open()
  await configureProvider()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await localDb.delete()
})

describe("Assistant Runtime transaction smoke", () => {
  it("commits staged Tool work, conversation/context, and sanitized diagnostics", async () => {
    const seeded = await seedRuntime({ contextMarker: "success-context-baseline" })
    const requests: OpenAiRequestBody[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init)
      requests.push(body)
      if (requests.length === 1) {
        return openAiToolResponse("write-1", "write", {
          path: WORKSPACE_PATH,
          content: STAGED_VALUE,
        })
      }
      if (requests.length === 2) {
        expect(toolObservation(body, "write-1")).toContain(WORKSPACE_PATH)
        return openAiToolResponse("read-1", "read", { path: WORKSPACE_PATH })
      }
      if (requests.length === 3) {
        expect(toolObservation(body, "read-1")).toContain(STAGED_VALUE)
        return openAiFinalResponse("Assistant smoke completed")
      }
      if (requests.length === 4) {
        return openAiToolResponse("side-read-1", "read", { path: WORKSPACE_PATH })
      }
      if (requests.length === 5) {
        expect(toolObservation(body, "side-read-1")).toContain(STAGED_VALUE)
        return openAiFinalResponse("Side invocation recorded")
      }
      expect(JSON.stringify(body.messages)).toContain("最近工具工作记录")
      expect(JSON.stringify(body.messages)).toContain(WORKSPACE_PATH)
      return openAiFinalResponse("Side invocation resumed")
    }))

    await expect(runAssistantChat({
      message: "Update the Assistant smoke file and verify the staged result.",
      sessionId: seeded.sessionId,
      history: seeded.baselineMessages,
    })).resolves.toMatchObject({ replyText: "Assistant smoke completed" })

    expect(requests).toHaveLength(3)
    expect((await readWorkspaceFileForSave(seeded.saveId, WORKSPACE_PATH))?.content)
      .toBe(STAGED_VALUE)

    const messages = await getAssistantSessionMessages(seeded.sessionId)
    expect(messages).toHaveLength(2)
    expect(messages).toMatchObject([
      { role: "user", content: "Update the Assistant smoke file and verify the staged result." },
      { role: "assistant", content: "Assistant smoke completed" },
    ])
    expect(JSON.stringify(messages)).not.toContain(STAGED_VALUE)

    const persistedContext = parseAgentContext(
      await assistantContextContent(seeded.sessionId),
      seeded.sessionId,
      { schema: ASSISTANT_CONTEXT_SCHEMA, agentId: ASSISTANT_CONTEXT_AGENT_ID },
    )
    expect(persistedContext.summary).toBe("success-context-baseline")
    expect(persistedContext.recentTurns.slice(-2)).toMatchObject([
      { role: "user", content: "Update the Assistant smoke file and verify the staged result." },
      { role: "assistant", content: "Assistant smoke completed" },
    ])

    await expect(invokeAgent({
      agentId: SIDE_AGENT_ID,
      input: "Read the smoke workspace file.",
      contextSlot: SIDE_CONTEXT_SLOT,
      persist: true,
    })).resolves.toMatchObject({ response: "Side invocation recorded" })

    const sideContextPath = agentContextPath(SIDE_AGENT_ID, SIDE_CONTEXT_SLOT)
    const firstSideContext = parseAgentContext(
      (await readWorkspaceFileForSave(seeded.saveId, sideContextPath))?.content ?? "",
      seeded.saveId,
      { agentId: SIDE_AGENT_ID },
    )
    expect(firstSideContext?.toolMemories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceToolCallId: "side-read-1",
        toolName: "read",
        status: "success",
      }),
    ]))

    await expect(invokeAgent({
      agentId: SIDE_AGENT_ID,
      input: "Continue using the previous work record.",
      contextSlot: SIDE_CONTEXT_SLOT,
      persist: true,
    })).resolves.toMatchObject({ response: "Side invocation resumed" })
    expect(requests).toHaveLength(6)

    const diagnostics = await diagnosticRequests("succeeded")
    expect(diagnostics).toHaveLength(6)
    expect(diagnostics.every((record) => record.attempts.length === 1)).toBe(true)
    expect(JSON.stringify(diagnostics)).not.toContain(PROVIDER_CREDENTIAL)
  })

  it("rolls back workspace, session, and context while retaining failed diagnostics", async () => {
    const baselineMessages: ConversationMessageRecord[] = [
      { role: "user", content: "baseline user" },
      { role: "assistant", content: "baseline assistant" },
    ]
    const seeded = await seedRuntime({
      baselineMessages,
      contextMarker: "failure-context-baseline",
    })
    let requestCount = 0
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount += 1
      requestBody(init)
      if (requestCount === 1) {
        return openAiToolResponse("write-before-failure", "write", {
          path: WORKSPACE_PATH,
          content: STAGED_VALUE,
        })
      }
      return new Response(JSON.stringify({ error: { message: "smoke provider rejected" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }))
    vi.spyOn(console, "warn").mockImplementation(() => undefined)

    await expect(runAssistantChat({
      message: "Stage a write, then encounter a provider failure.",
      sessionId: seeded.sessionId,
      history: baselineMessages,
    })).rejects.toThrow("smoke provider rejected")

    expect(requestCount).toBe(2)
    expect((await readWorkspaceFileForSave(seeded.saveId, WORKSPACE_PATH))?.content)
      .toBe(WORKSPACE_BASELINE)
    expect(await getAssistantSessionMessages(seeded.sessionId)).toEqual(baselineMessages)
    expect(await assistantContextContent(seeded.sessionId)).toBe(seeded.baselineContext)

    const failedDiagnostics = await diagnosticRequests("failed")
    expect(failedDiagnostics).toHaveLength(1)
    expect(failedDiagnostics[0]).toMatchObject({
      status: "failed",
      error: { type: "http", status: 400 },
      attempts: [{ status: "failed", error: { type: "http", status: 400 } }],
    })
    expect(JSON.stringify(failedDiagnostics)).not.toContain(PROVIDER_CREDENTIAL)
  })
})
