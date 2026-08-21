// @vitest-environment happy-dom

import "fake-indexeddb/auto"
import type {
  AgentContextToolMemory,
  ConversationMessageRecord,
  DiagnosticAiRequestRecord,
  GameCardManifest,
  WorkspaceOperationRequest,
  WorkspaceFile,
} from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ASSISTANT_CONTEXT_AGENT_ID,
  ASSISTANT_CONTEXT_SCHEMA,
  agentContextPath,
  agentInvocationTranscriptPath,
  compressContext,
  compressTaskContext,
  createEmptyAgentContext,
  parseAgentContext,
  serializeAgentContext,
  validateCompressionSummary,
} from "../agent-runtime/context-lifecycle"
import { assembleAgentContext } from "../agent-runtime/context"
import {
  parseAgentInvocationTranscript,
} from "../platform-host/history-turns"
import { projectAssistantReply } from "../platform-host/reply-projection"
import {
  applyTaskToolMemoryRetention,
  projectToolMemoryForContext,
} from "../agent-runtime/tool-memory"
import {
  createRuntimeWorkspaceToolSessionState,
  executeRuntimeWorkspaceToolCalls,
  type ParsedRuntimeWorkspaceToolCall,
} from "../agent-runtime/workspace-tools"
import {
  formatTextToolExecutionReport,
  formatTextToolProtocolError,
  TEXT_TOOL_CALLS_CLOSE_TAG,
  TEXT_TOOL_CALLS_OPEN_TAG,
} from "../agent-runtime/text-tool-protocol"
import { mergeConsecutiveRoleMessages } from "../agent-runtime/orchestration/message-formatting"
import { executeWorkspaceOperation } from "../agent-runtime/workspace-operations"
import { executeRunScript, parseActionDeclarations } from "../agent-runtime/workspace-tools/skill-actions"
import type { RuntimeChatMessage } from "../runtime-host/ai"
import cardReplyProjection from "../../../../cards/沉浸阅读器.tsian-card/workspace/config/reply-projection.json?raw"
import cardStorytellerAgent from "../../../../cards/沉浸阅读器.tsian-card/workspace/agents/storyteller/agent.json?raw"
import {
  createBrowserAiModelConfig,
  createBrowserAiProviderPreset,
  createBrowserAiProviderType,
  saveBrowserPlatformConfigDraft,
} from "../config/ai"
import { markPlatformHostReady } from "../platform-host/host-state"
import { toBrowserScriptReplyProjection } from "../platform-host/browser-skill-script-executor"
import { invokeAgent } from "../platform-host/ai-invocation"
import { runAssistantChat } from "../platform-host/assistant-chat"
import {
  WORLD_ARCHITECT_AGENT_FILES,
  WORLD_ARCHITECT_SKILL_FILES,
} from "../storage/workspace-templates/agents/world-architect"
import { DEFAULT_SAVE_RUNTIME_FILES } from "../storage/workspace-templates/files"
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
import {
  createOpeningControl,
  openingContinueMarker,
  isRecoverableOpeningModelState,
  parseOpeningAssistant,
  parseOpeningUser,
} from "../../../play-frontend-dev/src/lib/opening-interview"
import { formatTimelineBlock } from "../../../play-frontend-dev/src/lib/context-injection"
import { parseFrontier } from "../../../play-frontend-dev/src/lib/parse-frontier"
import { sourceSummaryState } from "../../../play-frontend-dev/src/lib/timeline-summary"
import type { SourceAnchor } from "../../../play-frontend-dev/src/lib/frontier-types"
import type { Runtime } from "../../../play-frontend-dev/src/lib/runtime-types"

const CARD_ID = "assistant-runtime-smoke"
const MODEL_ID = "assistant-smoke-model"
const PROVIDER_ID = "assistant-smoke-provider"
const PROVIDER_CREDENTIAL = "assistant-provider-secret"
const WORKSPACE_PATH = "save/assistant-smoke.txt"
const WORKSPACE_IMAGE_PATH = "save/assistant-smoke.png"
const LEGACY_REPLAY_PATH = "save/legacy-replay-must-not-run.txt"
const WORKSPACE_BASELINE = "before"
const STAGED_VALUE = "same-turn-staged-value"
const SIDE_AGENT_ID = "world-architect"
const SIDE_CONTEXT_SLOT = "assistant-smoke-side"
const BACKGROUND_CONTEXT_SLOT = "assistant-smoke-background"

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

function openAiTextToolResponse(name: string, args: Record<string, unknown>): Response {
  return openAiFinalResponse(
    `${TEXT_TOOL_CALLS_OPEN_TAG}${JSON.stringify([{ name, arguments: args }])}${TEXT_TOOL_CALLS_CLOSE_TAG}`,
  )
}

function requestBody(init?: RequestInit): OpenAiRequestBody {
  if (typeof init?.body !== "string") {
    throw new Error("Assistant smoke expected a JSON request body.")
  }
  return JSON.parse(init.body) as OpenAiRequestBody
}

function requestMessageText(body: OpenAiRequestBody): string {
  return (body.messages ?? [])
    .map((message) => typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""))
    .join("\n")
}

function textProtocolErrors(body: OpenAiRequestBody): Array<{
  code: string
  retryRemaining: number
}> {
  const matches = [...requestMessageText(body).matchAll(
    /<tsian-tool-protocol-error>([\s\S]*?)<\/tsian-tool-protocol-error>/g,
  )]
  return matches.flatMap((match) => {
    const payload = match[1]
    if (!payload) return []
    const parsed = JSON.parse(payload) as { code: string; retryRemaining: number }
    if (parsed.code.startsWith("TEXT_TOOL_PROTOCOL_")) {
      return [{ code: parsed.code, retryRemaining: parsed.retryRemaining }]
    }
    return []
  })
}

function latestTextProtocolError(body: OpenAiRequestBody): {
  code: string
  retryRemaining: number
} | undefined {
  const errors = textProtocolErrors(body)
  return errors[errors.length - 1]
}

function toolObservation(body: OpenAiRequestBody, callId: string): string {
  const value = body.messages?.find((message) => (
    message.role === "tool" && message.tool_call_id === callId
  ))?.content
  return typeof value === "string" ? value : JSON.stringify(value ?? "")
}

async function configureProvider(toolCallMode: "native" | "text" = "native"): Promise<void> {
  const providerType = createBrowserAiProviderType("openai-compatible")
  providerType.presets.push(createBrowserAiProviderPreset({
    id: PROVIDER_ID,
    name: "Assistant smoke provider",
    baseUrl: "https://assistant-smoke.example/v1",
    apiKey: PROVIDER_CREDENTIAL,
    models: [createBrowserAiModelConfig({
      id: MODEL_ID,
      enabled: true,
      toolCallMode,
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
          platformTools: { enabled: ["workspace_read", "workspace_write"], disabled: [] },
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

const CHECKPOINT_SUMMARY = [
  "## 本轮目标\n继续任务",
  "## 已验证事实\n已有结果",
  "## 持久化效果\n见工作区",
  "## 当前未完成操作\n无",
  "## 最新有效错误\n无",
  "## 恢复动作\n继续",
].join("\n")

function nativeToolRound(
  index: number,
  input?: { name?: string; path?: string; failed?: boolean; content?: string; parallel?: boolean },
): RuntimeChatMessage[] {
  const name = input?.name ?? "read"
  const path = input?.path ?? `save/round-${index}.txt`
  const calls = [{ id: `call-${index}-a`, name, arguments: { path, ...(input?.content ? { content: input.content } : {}) } }]
  if (input?.parallel) calls.push({ id: `call-${index}-b`, name: "read", arguments: { path: `save/round-${index}-b.txt` } })
  return [
    { role: "assistant", content: "", toolCalls: calls },
    ...calls.map((call, callIndex): RuntimeChatMessage => ({
      role: "tool",
      toolCallId: call.id,
      content: input?.failed && callIndex === 0
        ? JSON.stringify({ code: "WRITE_FAILED", message: "retry the exact payload" })
        : JSON.stringify({ path: call.arguments.path, status: "ok" }),
    })),
  ]
}

function textToolRound(
  index: number,
  input?: {
    name?: string
    path?: string
    failed?: boolean
    content?: string
    parallel?: boolean
    reverseObservations?: boolean
  },
): RuntimeChatMessage[] {
  const name = input?.name ?? "read"
  const path = input?.path ?? `save/text-round-${index}.txt`
  const calls = [{ id: `text-${index}-a`, name, arguments: { path, ...(input?.content ? { content: input.content } : {}) } }]
  if (input?.parallel) {
    calls.push({ id: `text-${index}-b`, name: "read", arguments: { path: `save/text-round-${index}-b.txt` } })
  }
  const observations = calls.map((call, callIndex) => input?.failed && callIndex === 0
    ? { id: call.id, name: call.name, ok: false, error: { code: "WRITE_FAILED", message: "retry the exact payload" } }
    : { id: call.id, name: call.name, ok: true, result: { path: call.arguments.path, status: "ok" } })
  if (input?.reverseObservations) observations.reverse()
  return [
    {
      role: "user",
      content: [
        "Text Tool Protocol execution report:",
        `<tsian-executed-tools>\n${JSON.stringify(calls)}\n</tsian-executed-tools>`,
        `<tsian-tool-observations>\n${JSON.stringify(observations)}\n</tsian-tool-observations>`,
      ].join("\n"),
    },
  ]
}

describe("Agent context contracts smoke", () => {
  it("upgrades v1 context fields and retains only the newest unresolved semantic memory", () => {
    const parsed = parseAgentContext(JSON.stringify({
      schema: "tsian.agent.context.v1",
      turn: 8,
      recentTurns: [{ turn: 7, role: "assistant", content: "legacy" }],
      lastCompressedTurn: 6,
    }), "save-1")
    expect(parsed).toMatchObject({
      schema: "tsian.agent.context.v2",
      sequence: 8,
      lastCompressedSequence: 6,
      recentTurns: [{ sequence: 7, gameTurn: 7, content: "legacy" }],
    })

    const memory = (sequence: number, status: "success" | "failed", resolves?: string[]): AgentContextToolMemory => ({
      id: `memory-${sequence}`,
      sourceToolCallId: `call-${sequence}`,
      key: "workspace:save/result.json",
      sequence,
      toolName: "write",
      status,
      title: status,
      summary: status,
      ...(resolves ? { resolves } : {}),
    })
    const retained = applyTaskToolMemoryRetention([
      memory(1, "failed"),
      memory(2, "success", ["workspace:save/result.json"]),
      memory(3, "failed"),
    ])
    expect(retained).toEqual([expect.objectContaining({ sequence: 3, status: "failed" })])
    expect(applyTaskToolMemoryRetention(retained, 6)).toEqual([])
  })

  it("keeps text execution reports multimodal and provider-merge safe", () => {
    const multimodalReport = formatTextToolExecutionReport(
      [{ id: "text-r4-c0", name: "read", arguments: { path: WORKSPACE_IMAGE_PATH } }],
      [{
        index: 0,
        name: "read",
        ok: true,
        result: { path: WORKSPACE_IMAGE_PATH },
        imageParts: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" }],
      }],
    )
    expect(Array.isArray(multimodalReport)).toBe(true)
    if (!Array.isArray(multimodalReport)) throw new Error("Expected multimodal execution report content")
    expect(multimodalReport).toHaveLength(2)
    expect(multimodalReport[0]).toMatchObject({ type: "text" })
    expect(JSON.stringify(multimodalReport[0])).toContain("<tsian-executed-tools>")
    expect(JSON.stringify(multimodalReport[0])).toContain("<tsian-tool-observations>")
    expect(multimodalReport[1]).toEqual({ type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" })

    const mergedMultimodalCorrection = mergeConsecutiveRoleMessages([
      { role: "user", content: multimodalReport },
      {
        role: "user",
        content: formatTextToolProtocolError(
          { code: "TEXT_TOOL_PROTOCOL_INVALID_JSON", message: "rejected detail" },
          3,
        ),
      },
    ])
    expect(mergedMultimodalCorrection).toHaveLength(1)
    expect(mergedMultimodalCorrection[0]?.role).toBe("user")
    expect(Array.isArray(mergedMultimodalCorrection[0]?.content)).toBe(true)
    expect(JSON.stringify(mergedMultimodalCorrection[0]?.content)).toContain("TEXT_TOOL_PROTOCOL_INVALID_JSON")
    expect(JSON.stringify(mergedMultimodalCorrection[0]?.content)).toContain("iVBORw0KGgo=")
    expect(JSON.stringify(mergedMultimodalCorrection[0]?.content)).not.toContain("rejected detail")
  })

  it("keeps atomic native and text rounds and pins unresolved exact operations outside lossy compression", async () => {
    const messages: RuntimeChatMessage[] = [
      { role: "user", content: "framework" },
      ...nativeToolRound(0, { name: "write", path: "save/exact.json", failed: true, content: "EXACT-PAYLOAD" }),
      ...nativeToolRound(1, { parallel: true }),
      ...nativeToolRound(2),
      ...nativeToolRound(3),
      ...nativeToolRound(4),
      ...nativeToolRound(5),
      ...nativeToolRound(6),
    ]
    const compressor = vi.fn(async () => CHECKPOINT_SUMMARY)
    const result = await compressTaskContext(
      messages,
      { start: 1, end: messages.length },
      null,
      compressor,
      { debugLabel: "agent:compression-smoke" },
    )
    expect(result.compressed).toBe(true)
    expect(JSON.stringify(result.messages)).toContain("EXACT-PAYLOAD")
    expect(JSON.stringify(compressor.mock.calls)).not.toContain("EXACT-PAYLOAD")
    expect(JSON.stringify(compressor.mock.calls)).toContain("structuredToolCalls")
    expect(JSON.stringify(compressor.mock.calls)).toContain("call-1-a")
    expect(JSON.stringify(compressor.mock.calls)).toContain("call-1-b")
    expect(JSON.stringify(compressor.mock.calls)).toContain("消息 role 不是权威等级")

    const summaryIndex = result.messages.findIndex((message) =>
      typeof message.content === "string" && message.content.startsWith("任务恢复 checkpoint："))
    const pinnedAssistantIndex = result.messages.findIndex((message) =>
      message.role === "assistant" && message.toolCalls?.some((call) => call.id === "call-0-a"))
    const pinnedToolIndex = result.messages.findIndex((message) =>
      message.role === "tool" && message.toolCallId === "call-0-a")
    const recentAssistantIndex = result.messages.findIndex((message) =>
      message.role === "assistant" && message.toolCalls?.some((call) => call.id === "call-2-a"))
    expect(summaryIndex).toBeGreaterThan(0)
    expect(pinnedAssistantIndex).toBeGreaterThan(summaryIndex)
    expect(pinnedToolIndex).toBe(pinnedAssistantIndex + 1)
    expect(recentAssistantIndex).toBeGreaterThan(pinnedToolIndex)

    const resolvedMessages: RuntimeChatMessage[] = [
      { role: "user", content: "framework" },
      ...nativeToolRound(0, { name: "write", path: "save/exact.json", failed: true, content: "EXACT-PAYLOAD" }),
      ...nativeToolRound(1, { name: "write", path: "save/exact.json" }),
      ...nativeToolRound(2),
      ...nativeToolRound(3),
      ...nativeToolRound(4),
      ...nativeToolRound(5),
      ...nativeToolRound(6),
      ...nativeToolRound(7),
    ]
    const resolvedCompressor = vi.fn(async () => CHECKPOINT_SUMMARY)
    const resolved = await compressTaskContext(
      resolvedMessages,
      { start: 1, end: resolvedMessages.length },
      null,
      resolvedCompressor,
      { debugLabel: "agent:compression-unpin-smoke" },
    )
    expect(resolved.compressed).toBe(true)
    expect(JSON.stringify(resolved.messages)).not.toContain("EXACT-PAYLOAD")
    expect(JSON.stringify(resolvedCompressor.mock.calls)).toContain("call-0-a")

    const textMessages: RuntimeChatMessage[] = [
      { role: "user", content: "framework" },
      ...textToolRound(0, { name: "write", path: "save/text-exact.json", failed: true, content: "TEXT-EXACT-PAYLOAD" }),
      ...textToolRound(1, { parallel: true }),
      ...textToolRound(2),
      ...textToolRound(3),
      ...textToolRound(4),
      ...textToolRound(5),
      ...textToolRound(6),
    ]
    const textCompressor = vi.fn(async () => CHECKPOINT_SUMMARY)
    const textResult = await compressTaskContext(
      textMessages,
      { start: 1, end: textMessages.length },
      null,
      textCompressor,
      { debugLabel: "agent:text-compression-smoke" },
    )
    expect(textResult.compressed).toBe(true)
    expect(JSON.stringify(textCompressor.mock.calls)).not.toContain("TEXT-EXACT-PAYLOAD")
    expect(JSON.stringify(textCompressor.mock.calls)).toContain("text-1-a")
    expect(JSON.stringify(textCompressor.mock.calls)).toContain("text-1-b")
    const textSummaryIndex = textResult.messages.findIndex((message) =>
      typeof message.content === "string" && message.content.startsWith("任务恢复 checkpoint："))
    const textPinnedReportIndex = textResult.messages.findIndex((message) =>
      message.role === "user" && typeof message.content === "string" && message.content.includes("text-0-a"))
    const textRecentReportIndex = textResult.messages.findIndex((message) =>
      message.role === "user" && typeof message.content === "string" && message.content.includes("text-2-a"))
    expect(textSummaryIndex).toBeGreaterThan(0)
    expect(textPinnedReportIndex).toBeGreaterThan(textSummaryIndex)
    expect(textRecentReportIndex).toBeGreaterThan(textPinnedReportIndex)
    expect(textResult.messages.filter((message) =>
      typeof message.content === "string" && message.content.includes("text-0-a"))).toHaveLength(1)

    const idAlignedResolvedMessages: RuntimeChatMessage[] = [
      { role: "user", content: "framework" },
      ...textToolRound(0, {
        name: "write",
        path: "save/text-id-aligned.json",
        failed: true,
        content: "TEXT-ID-ALIGNED-PAYLOAD",
        parallel: true,
        reverseObservations: true,
      }),
      ...textToolRound(1, { name: "write", path: "save/text-id-aligned.json" }),
      ...textToolRound(2),
      ...textToolRound(3),
      ...textToolRound(4),
      ...textToolRound(5),
      ...textToolRound(6),
      ...textToolRound(7),
    ]
    const idAlignedCompressor = vi.fn(async () => CHECKPOINT_SUMMARY)
    const idAlignedResolved = await compressTaskContext(
      idAlignedResolvedMessages,
      { start: 1, end: idAlignedResolvedMessages.length },
      null,
      idAlignedCompressor,
      { debugLabel: "agent:text-compression-id-alignment-smoke" },
    )
    expect(idAlignedResolved.compressed).toBe(true)
    expect(JSON.stringify(idAlignedCompressor.mock.calls)).toContain("TEXT-ID-ALIGNED-PAYLOAD")
    expect(JSON.stringify(idAlignedResolved.messages)).not.toContain("TEXT-ID-ALIGNED-PAYLOAD")
  })

  it("validates all fixed compression contracts and repairs one malformed checkpoint", async () => {
    const continuation = ["当前目标", "有效约束", "已确认决策", "权威状态与产物", "已完成结果", "当前工作点", "未解决问题", "下一步"]
      .map((heading) => `## ${heading}\n有内容`).join("\n")
    const narrative = ["当前场景", "关键因果经过", "玩家选择", "角色与关系变化", "线索与未决事项", "紧接续点"]
      .map((heading) => `## ${heading}\n有内容`).join("\n")
    expect(validateCompressionSummary("task-continuation", continuation)).toEqual([])
    expect(validateCompressionSummary("task-checkpoint", CHECKPOINT_SUMMARY)).toEqual([])
    expect(validateCompressionSummary("narrative-continuity", narrative)).toEqual([])
    expect(validateCompressionSummary("task-checkpoint", "## 本轮目标\n")).not.toEqual([])

    const messages: RuntimeChatMessage[] = [
      { role: "user", content: "framework" },
      ...nativeToolRound(0),
      ...nativeToolRound(1),
      ...nativeToolRound(2),
      ...nativeToolRound(3),
      ...nativeToolRound(4),
      ...nativeToolRound(5),
    ]
    const compressor = vi.fn()
      .mockResolvedValueOnce("malformed")
      .mockResolvedValueOnce(CHECKPOINT_SUMMARY)
    await expect(compressTaskContext(
      messages,
      { start: 1, end: messages.length },
      null,
      compressor,
      { debugLabel: "agent:compression-repair-smoke" },
    )).resolves.toMatchObject({ compressed: true, summary: CHECKPOINT_SUMMARY })
    expect(compressor).toHaveBeenCalledTimes(2)

    const narrativeContext = {
      ...createEmptyAgentContext("save-narrative"),
      sequence: 6,
      recentTurns: Array.from({ length: 6 }, (_, index) => [
        { sequence: index + 1, gameTurn: index + 1, role: "user" as const, content: `user-${index + 1}` },
        { sequence: index + 1, gameTurn: index + 1, role: "assistant" as const, content: `assistant-${index + 1}` },
      ]).flat(),
      toolMemories: [{
        id: "narrative-memory-1",
        sourceToolCallId: "narrative-call-1",
        key: "opening-progress:fixture",
        sequence: 1,
        gameTurn: 1,
        toolName: "run_script",
        status: "success" as const,
        title: "Opening progress advanced",
        summary: "Revision advanced without replaying the raw script output.",
        exact: { revision: 2 },
      }],
    }
    const narrativeCompressor = vi.fn(async () => narrative)
    const compressedNarrative = await compressContext(
      narrativeContext,
      1,
      narrativeCompressor,
      { debugLabel: "agent:narrative-memory-smoke" },
    )
    expect(JSON.stringify(narrativeCompressor.mock.calls)).toContain("Opening progress advanced")
    expect(JSON.stringify(narrativeCompressor.mock.calls)).toContain('\\"revision\\":2')
    expect(compressedNarrative.lastCompressedSequence).toBe(1)
    expect(compressedNarrative.toolMemories).toBeUndefined()
  })

  it("runs visible Skill actions with loop-local result refs and omits transient/source bodies from Tool Memory", async () => {
    const file = (path: string, content: string): WorkspaceFile => ({ path, content, createdAt: 0, updatedAt: 0 })
    const skillContent = [
      "---",
      "name: demo",
      "description: Direct action smoke",
      "---",
      "# Demo",
      "```json tsian-actions",
      JSON.stringify([{ name: "publish_opening", description: "Publish", inputSchema: { type: "object", required: ["openingReply"], properties: { openingReply: { type: "string" } } }, outputSchema: { type: "object" }, executor: { type: "browser_script", path: "scripts/commit.js" } }]),
      "```",
    ].join("\n")
    const workspaceFiles = [
      file("agents/demo-agent/agent.json", JSON.stringify({ id: "demo-agent", skills: { enabled: ["agents/demo-agent/skills/demo/SKILL.md"], disabled: [] } })),
      file("agents/demo-agent/AGENT.md", "# Demo Agent"),
      file("agents/demo-agent/skills/demo/SKILL.md", skillContent),
      file("agents/demo-agent/skills/demo/scripts/commit.js", "return { receipt: 'r1' };"),
    ]
    const agentContext = assembleAgentContext(workspaceFiles, { agentId: "demo-agent", workspaceTrustBoundary: "trusted-authoring" })
    expect(agentContext).not.toBeNull()
    const executedInputs: Record<string, unknown>[] = []
    const runBrowserScript = vi.fn(async (request: { input: Record<string, unknown> }) => {
      executedInputs.push(request.input)
      return { ok: true as const, item: { receipt: "r1" } }
    })
    const sessionState = createRuntimeWorkspaceToolSessionState()
    await expect(executeRunScript({
      workspaceFiles,
      agentContext: agentContext!,
      sessionState,
      runBrowserScript,
    }, { skill: "demo", script: "publish_opening", input: { openingReply: "direct" } })).resolves.toMatchObject({
      result: { status: "executed", output: { receipt: "r1" } },
    })
    expect(runBrowserScript).toHaveBeenCalledOnce()

    const openingReply = "晨光照进客栈，掌柜说：\"醒了？\"\n\n[[选项]]\n- 起身查看窗外\n- 继续装睡\n[[/选项]]"
    const runAgentCall = vi.fn(async () => ({
      status: "completed",
      targetAgent: { id: "storyteller", title: "Storyteller" },
      response: openingReply,
    }))
    const referencedCalls: ParsedRuntimeWorkspaceToolCall[] = [{
      raw: "agent_call",
      call: { id: "agent-1", name: "agent_call", arguments: { agentId: "storyteller", request: "Write the opening." } },
    }, {
      raw: "run_script",
      call: { id: "commit-1", name: "run_script", arguments: { skill: "demo", script: "publish_opening", input: {}, inputRefs: { openingReply: "tool-result-0" } } },
    }, {
      raw: "run_script-again",
      call: { id: "commit-2", name: "run_script", arguments: { skill: "demo", script: "publish_opening", input: {}, inputRefs: { openingReply: "tool-result-0" } } },
    }]
    const referencedObservations = await executeRuntimeWorkspaceToolCalls({
      workspaceFiles,
      agentContext: agentContext!,
      sessionState,
      runAgentCall,
      runBrowserScript,
    }, referencedCalls)
    expect(referencedObservations).toMatchObject([
      { ok: true, result: { response: openingReply, responseRef: "tool-result-0" } },
      { ok: true, result: { status: "executed" } },
      { ok: true, result: { status: "executed" } },
    ])
    expect(executedInputs.slice(-2)).toEqual([
      { openingReply },
      { openingReply },
    ])
    expect(sessionState.toolResultRefs.get("tool-result-0")).toBe(openingReply)
    expect(sessionState.nextToolResultRefIndex).toBe(1)
    const delegatedMemory = projectToolMemoryForContext({
      sequence: 1,
      call: referencedCalls[0]!.call!,
      observation: referencedObservations[0]!,
      sourceIndex: 0,
    })
    expect(delegatedMemory?.exact).toEqual({ status: "completed" })

    const workspaceBeforeRejectedRef = JSON.stringify(workspaceFiles)
    const callsBeforeRejectedRef = runBrowserScript.mock.calls.length
    const isolatedObservations = await executeRuntimeWorkspaceToolCalls({
      workspaceFiles,
      agentContext: agentContext!,
      sessionState: createRuntimeWorkspaceToolSessionState(),
      runBrowserScript,
    }, [{
      raw: "isolated-run-script",
      call: { id: "commit-isolated", name: "run_script", arguments: { skill: "demo", script: "publish_opening", input: {}, inputRefs: { openingReply: "tool-result-0" } } },
    }])
    expect(isolatedObservations[0]).toMatchObject({
      ok: false,
      error: { code: "TOOL_RESULT_REF_NOT_FOUND" },
    })
    expect(runBrowserScript).toHaveBeenCalledTimes(callsBeforeRejectedRef)
    expect(JSON.stringify(workspaceFiles)).toBe(workspaceBeforeRejectedRef)

    const oversizedSession = createRuntimeWorkspaceToolSessionState()
    const oversizedObservations = await executeRuntimeWorkspaceToolCalls({
      workspaceFiles,
      agentContext: agentContext!,
      sessionState: oversizedSession,
      runAgentCall: vi.fn(async () => ({
        status: "completed",
        targetAgent: { id: "storyteller", title: "Storyteller" },
        response: "x".repeat(33_000),
      })),
      runBrowserScript,
    }, [{
      raw: "oversized-agent-call",
      call: { id: "agent-oversized", name: "agent_call", arguments: { agentId: "storyteller", request: "Write too much." } },
    }, {
      raw: "oversized-ref-run-script",
      call: { id: "commit-oversized", name: "run_script", arguments: { skill: "demo", script: "publish_opening", input: {}, inputRefs: { openingReply: "tool-result-0" } } },
    }])
    expect(oversizedObservations).toMatchObject([
      { ok: false, error: { code: "TOOL_OBSERVATION_TOO_LARGE" } },
      { ok: false, error: { code: "TOOL_RESULT_REF_NOT_FOUND" } },
    ])
    expect(oversizedSession.toolResultRefs.size).toBe(0)
    expect(oversizedSession.nextToolResultRefIndex).toBe(0)
    expect(runBrowserScript).toHaveBeenCalledTimes(callsBeforeRejectedRef)
    expect(JSON.stringify(workspaceFiles)).toBe(workspaceBeforeRejectedRef)

    const skillFile = workspaceFiles.find((entry) => entry.path.endsWith("/SKILL.md"))!
    skillFile.content = "---\nname: demo\n---\n# Demo without actions\n"
    await expect(executeRunScript({
      workspaceFiles,
      agentContext: agentContext!,
      sessionState,
      runBrowserScript,
    }, { skill: "demo", script: "publish_opening", input: {} })).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" })
    expect(runBrowserScript).toHaveBeenCalledTimes(callsBeforeRejectedRef)

    const disabledFiles = workspaceFiles.map((entry) => entry.path === "agents/demo-agent/agent.json"
      ? file(entry.path, JSON.stringify({ id: "demo-agent", skills: { enabled: [], disabled: ["agents/demo-agent/skills/demo/SKILL.md"] } }))
      : entry)
    const disabledContext = assembleAgentContext(disabledFiles, { agentId: "demo-agent", workspaceTrustBoundary: "trusted-authoring" })
    await expect(executeRunScript({
      workspaceFiles: disabledFiles,
      agentContext: disabledContext!,
      sessionState: createRuntimeWorkspaceToolSessionState(),
      runBrowserScript,
    }, { skill: "demo", script: "publish_opening", input: {} })).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" })

    expect(projectToolMemoryForContext({
      sequence: 1,
      call: { id: "use-1", name: "use_skill", arguments: { name: "demo" } },
      observation: { index: 0, name: "use_skill", ok: true, result: { content: "FULL-SKILL-BODY" } },
      sourceIndex: 0,
    })).toBeNull()
    expect(projectToolMemoryForContext({
      sequence: 1,
      call: { id: "read-1", name: "read", arguments: { path: "source/chapter.txt" } },
      observation: { index: 0, name: "read", ok: true, result: { content: "FULL-SOURCE-BODY" } },
      sourceIndex: 0,
    })).toBeNull()
  })

  it("keeps the world architect template synchronized and its resident context minimal", () => {
    const agentFile = WORLD_ARCHITECT_AGENT_FILES.find((file) => file.path === "agents/world-architect/agent.json")
    const config = JSON.parse(agentFile?.content ?? "null") as { contextPaths?: Array<{ path?: string }> }
    expect(config.contextPaths?.map((entry) => entry.path)).toEqual([
      "save/source/manifest.json",
      "save/schema/current.md",
      "save/playthrough/frontier.json",
    ])
    expect(WORLD_ARCHITECT_SKILL_FILES.map((file) => file.path)).toEqual(expect.arrayContaining([
      "agents/world-architect/skills/开局建模/scripts/inspect-source-opening.js",
      "agents/world-architect/skills/开局建模/scripts/read-opening-slice.js",
      "agents/world-architect/skills/开局建模/scripts/commit-opening-entities.js",
      "agents/world-architect/skills/开局建模/scripts/commit-opening-graph.js",
      "agents/world-architect/skills/开局建模/scripts/commit-opening-state.js",
      "agents/world-architect/skills/开局建模/scripts/publish-opening.js",
    ]))
    const openingTemplatePaths = WORLD_ARCHITECT_SKILL_FILES.map((file) => file.path)
    expect(openingTemplatePaths).not.toContain("agents/world-architect/skills/开局建模/scripts/_progress.js")
    expect(openingTemplatePaths).not.toContain("agents/world-architect/skills/开局建模/scripts/read-opening-progress.js")
    expect(openingTemplatePaths).not.toContain("agents/world-architect/skills/开局建模/scripts/advance-opening-progress.js")
    const openingSkill = WORLD_ARCHITECT_SKILL_FILES.find((file) => file.path.endsWith("开局建模/SKILL.md"))?.content ?? ""
    expect(openingTemplatePaths).not.toContain("agents/world-architect/skills/开局建模/scripts/commit-opening.js")
    expect(openingSkill).toContain("run_script.inputRefs.openingReply")
    expect(openingSkill).toContain("responseRef")
    expect(openingSkill).toContain("opening-interview:continue:<sessionId>")
    expect(openingSkill).toContain("不复制已在 workspace 中的实体、场景、关系或 runtime 全文")
    expect(openingSkill).not.toContain("阶段 7 成功前")
    expect(openingSkill).not.toContain("完整 storyteller brief")
    const openingActions = parseActionDeclarations(openingSkill)
    expect(openingActions.errors).toEqual([])
    expect(openingActions.actions.map(action => action.name)).toEqual([
      "inspect_source_opening",
      "read_opening_slice",
      "commit_opening_entities",
      "commit_opening_graph",
      "commit_opening_state",
      "publish_opening",
    ])
    const publishAction = openingActions.actions.find(action => action.name === "publish_opening")
    expect(Object.keys(publishAction?.inputSchema?.properties ?? {})).toEqual(["openingReply"])
    const storytellerConfig = JSON.parse(cardStorytellerAgent) as { platformTools?: { enabled?: string[] } }
    expect(storytellerConfig.platformTools?.enabled).toContain("workspace_read")
    const currentSchema = DEFAULT_SAVE_RUNTIME_FILES.find((file) => file.path === "save/schema/current.md")?.content ?? ""
    expect(currentSchema.length).toBeLessThan(1_000)
    expect(currentSchema).toContain("save-specific")
  })

  it("keeps staged opening recovery, publication, and source summaries executable", async () => {
    expect(parseOpeningAssistant("你想从哪里开始？\n[[开局选项]]\n- 城门\n- 客栈")).toEqual({
      displayContent: "你想从哪里开始？",
      choices: ["城门", "客栈"],
      openingContinue: false,
    })
    expect(parseOpeningAssistant("资料已保存。\n[[开局继续]]")).toEqual({
      displayContent: "资料已保存。",
      choices: [],
      openingContinue: true,
    })
    expect(parseOpeningAssistant("资料已保存。", { openingContinue: "[[开局继续]]" })).toMatchObject({ openingContinue: true })
    const projectedContinuation = projectAssistantReply("资料已保存。\n[[开局继续]]", [
      { path: "config/reply-projection.json", content: cardReplyProjection, createdAt: 0, updatedAt: 0 },
    ])
    expect(projectedContinuation.content).not.toContain("[[开局继续]]")
    expect(projectedContinuation.displayContent ?? projectedContinuation.content).not.toContain("[[开局继续]]")
    expect(projectedContinuation.projections).toEqual({ openingContinue: "[[开局继续]]" })
    expect(parseOpeningAssistant(projectedContinuation.content, projectedContinuation.projections)).toMatchObject({
      displayContent: "资料已保存。",
      openingContinue: true,
    })
    expect(parseOpeningUser(openingContinueMarker("opening-1234abcd"))).toEqual({
      kind: "continue",
      sessionId: "opening-1234abcd",
    })
    const recoveryManifest = {
      version: 1,
      status: "ready",
      title: "测试小说",
      sourceFormat: "txt",
      importMode: "paste",
      recommendedExtractionMode: "frontier",
      chapterDetection: "heuristic",
      chapterDetectionConfidence: "strong",
      importedAt: "2026-08-12T00:00:00.000Z",
      normalizationVersion: "test-v1",
      totalCharacters: 20,
      chapterCount: 2,
      files: { chaptersIndex: "save/source/chapters.index.json" },
    } as const
    const recoveryControl = createOpeningControl(recoveryManifest, "canon")
    expect(isRecoverableOpeningModelState({
      manifest: recoveryManifest,
      control: recoveryControl,
      setupStatus: "pending",
      hasOpeningNotes: true,
      runtimeRecoverable: true,
      frontierRecoverable: true,
    })).toBe(true)
    expect(isRecoverableOpeningModelState({
      manifest: recoveryManifest,
      control: recoveryControl,
      setupStatus: "pending",
      hasOpeningNotes: false,
      runtimeRecoverable: true,
      frontierRecoverable: true,
    })).toBe(false)
    expect(parseOpeningAssistant("问题\n[[开局选项]]\n- A\n[[/开局选项]]\n[[开局选项]]\n- B")).toBeNull()

    const parsedFrontier = parseFrontier({
      sourceWindow: { start: 1, end: 2 },
      extractedThrough: "source:chapter-0002",
      timeline: [
        { kind: "source", order: 1, chapter: 1, time: "清晨", label: "醒来", summary: "主角在客栈醒来并确认处境。" },
        { kind: "source", order: 2, chapter: 2, time: "午后", label: "出门" },
      ],
    })
    const runtimeForTimeline = {
      turn: 0,
      worldTime: "清晨",
      plotOrder: 1,
      location: null,
      weather: "",
      activeSceneRefs: [],
      protagonistRef: null,
      extensions: {},
      updatedAtTurn: 0,
      updatedBy: null,
    } as Runtime
    expect(formatTimelineBlock(runtimeForTimeline, parsedFrontier.frontier!)).toContain("梗概：主角在客栈醒来并确认处境。")
    const currentSource = parsedFrontier.frontier!.timeline.find(anchor => anchor.kind === "source") as SourceAnchor
    const futureSource: SourceAnchor = { kind: "source", order: 2, chapter: 2, time: "午后", label: "出门", summary: "主角离开客栈。" }
    expect(sourceSummaryState(currentSource, 1, new Set())).toBe("visible")
    expect(sourceSummaryState(futureSource, 1, new Set())).toBe("spoiler")
    expect(sourceSummaryState(futureSource, 1, new Set([2]))).toBe("visible")
    expect(sourceSummaryState({ ...futureSource, summary: undefined }, 1, new Set())).toBe("hidden")

    const scriptContent = (suffix: string): string => {
      const file = WORLD_ARCHITECT_SKILL_FILES.find((entry) => entry.path.endsWith(suffix))
      if (!file) throw new Error(`Missing opening script: ${suffix}`)
      return file.content
    }
    type OpeningRunner = (
      input: Record<string, unknown>,
      tsian: Record<string, unknown>,
      signal: { throwIfAborted(): void },
    ) => Promise<Record<string, unknown>>
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => OpeningRunner
    const compileOpening = (script: string): OpeningRunner => new AsyncFunction(
      "input",
      "tsian",
      "signal",
      `${scriptContent("开局建模/scripts/_common.js")}\n${scriptContent("开局建模/scripts/_validation.js")}\n${scriptContent("开局建模/scripts/_opening-workflow.js")}\n${scriptContent(script)}`,
    )
    const runEntities = compileOpening("开局建模/scripts/commit-opening-entities.js")
    const runGraph = compileOpening("开局建模/scripts/commit-opening-graph.js")
    const runState = compileOpening("开局建模/scripts/commit-opening-state.js")
    const runPublish = compileOpening("开局建模/scripts/publish-opening.js")

    const hashText = (input: string): string => {
      let hash = 0x811c9dc5
      for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
      }
      return (hash >>> 0).toString(16).padStart(8, "0")
    }
    const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`
    const makeFiles = (): Map<string, string> => {
      const source = { importedAt: "2026-08-12T00:00:00.000Z", normalizationVersion: "test-v1", title: "测试小说", chapterCount: 2 }
      const sourceHash = hashText(JSON.stringify(source))
      return new Map<string, string>([
        ["save/source/manifest.json", json({ ...source, status: "ready" })],
        ["save/source/chapters.index.json", json({
          version: 2,
          chapters: [1, 2].map((index) => ({
            index,
            title: `第${index}章`,
            ref: `source:chapter-${String(index).padStart(4, "0")}`,
            source: { kind: "shard", shardId: "s1", path: "save/source/shards/s1.txt", start: 0, end: 10 },
          })),
        })],
        ["save/playthrough/opening-interview.json", json({
          schema: "novel-airp.opening-interview.v2",
          source: { ...source, hash: sourceHash },
          session: { id: `opening-${sourceHash}`, slot: `opening-interview-${sourceHash}` },
          branch: "canon",
        })],
        ["save/playthrough/opening-notes.md", "# 开局建模工作笔记\n\n## 已确认\n- 主角与切入点\n"],
        ["save/playthrough/runtime.json", json({ turn: 0, worldTime: "", plotOrder: 1, location: null, weather: "", activeSceneRefs: [], protagonistRef: null, extensions: {}, updatedAtTurn: 0, updatedBy: null })],
        ["save/playthrough/frontier.json", json({ sourceWindow: { start: null, end: null }, extractedThrough: null, timeline: [{ kind: "source", order: 1, chapter: 1, time: "元年", label: "开局" }], notes: "" })],
        ["save/playthrough/understanding-summary.json", json({ status: "pending", title: null, candidateCharacters: [] })],
        ["save/playthrough/setup-summary.json", json({ status: "pending", summary: null })],
        ["config/reply-projection.json", json({
          schema: "tsian.reply-projection.v1",
          rules: [{ id: "choices", match: "/\\[\\[选项\\]\\]([\\s\\S]*?)\\[\\[\\/选项\\]\\]/g", text: "", project: { choices: "$1|lines|stripList" } }],
        })],
        ["game-card.json", json({ runtime: { entrypoints: { playerTurn: "storyteller" } } })],
        ["agents/storyteller/agent.json", json({ id: "storyteller" })],
        ["agents/storyteller/AGENT.md", "# Storyteller\n"],
      ])
    }
    const makeRuntime = (files = makeFiles(), options?: { exposeRead?: boolean }) => {
      const writes: string[] = []
      const workspaceFiles = (): WorkspaceFile[] =>
        Array.from(files, ([path, content]): WorkspaceFile => ({ path, content, createdAt: 0, updatedAt: 0 }))
      const project = vi.fn(async (content: string) => toBrowserScriptReplyProjection(projectAssistantReply(content, workspaceFiles())))
      const read = vi.fn(async (request: Omit<WorkspaceOperationRequest, "operation">) =>
        executeWorkspaceOperation(
          { ...request, operation: "read" },
          { workspaceFiles: workspaceFiles(), actorLevel: 1, exposedOperations: options?.exposeRead === false ? [] : ["read"] },
        ))
      const glob = vi.fn(async ({ pattern }: { pattern: string }) => {
        const matches = Array.from(files.keys()).filter((path) => {
          if (pattern === "save/entities/*/*.json") return path.startsWith("save/entities/") && path.split("/").length === 4 && path.endsWith(".json")
          if (pattern === "save/scenes/*.json") return path.startsWith("save/scenes/") && path.split("/").length === 3 && path.endsWith(".json")
          if (pattern === "save/relationships/*.json") return path.startsWith("save/relationships/") && path.split("/").length === 3 && path.endsWith(".json")
          if (pattern === "save/history/turns/turn-*.json") return path.startsWith("save/history/turns/turn-") && path.endsWith(".json")
          if (pattern.startsWith("save/agents/") && pattern.endsWith("/context*.json")) {
            const prefix = pattern.slice(0, -14)
            return path.startsWith(prefix + "/context") && path.endsWith(".json")
          }
          return false
        })
        return { matches: matches.sort(), truncated: false }
      })
      const tsian = {
        workspace: {
          read,
          write: vi.fn(async ({ path, content }: { path: string; content: string }) => {
            files.set(path, content)
            writes.push(path)
            return { path, content }
          }),
          glob,
          list: vi.fn(async () => ({ entries: [] })),
        },
        reply: { project },
        trace: vi.fn(),
        memory: { set: vi.fn() },
      }
      return { files, writes, project, read, glob, tsian }
    }
    const entitiesPayload = {
      entities: [
        { id: "character:hero", name: "主角", brief: "测试主角" },
        { id: "character:friend", name: "同伴", brief: "开局同伴" },
        { id: "location:inn", name: "客栈", brief: "开局地点" },
        { id: "container:bag", name: "行囊", brief: "主角的行囊" },
      ],
    }
    const graphPayload = {
      scenes: [{ id: "scene:opening", name: "客栈清晨", location: { ref: "location:inn" }, present: [{ ref: "character:hero" }] }],
      relationships: [{ subject: "character:hero", edges: [{ to: "character:friend", type: "同伴" }] }],
    }
    const statePayload = {
      runtime: { protagonistRef: { ref: "character:hero" }, location: { ref: "location:inn" }, activeSceneRefs: [{ ref: "scene:opening" }] },
      frontier: {
        sourceWindow: { startIndex: 1, endIndex: 2 },
        timeline: [{ chapter: 1, time: "清晨", label: "醒来", summary: "主角在客栈醒来并确认处境。" }],
      },
      summary: "主角在客栈醒来。",
    }
    const openingReply = "晨光照进客栈。\n[[选项]]\n- 起身\n[[/选项]]"
    const signal = { throwIfAborted() {} }
    const stageModel = async (runtime: ReturnType<typeof makeRuntime>) => {
      await expect(runEntities(entitiesPayload, runtime.tsian, signal)).resolves.toMatchObject({ status: "ready", phase: "entities" })
      runtime.files.set("save/playthrough/opening-notes.md", "# 开局建模工作笔记\n\n## 已完成\n- 实体\n")
      await expect(runGraph(graphPayload, runtime.tsian, signal)).resolves.toMatchObject({ status: "ready", phase: "graph" })
      runtime.files.set("save/playthrough/opening-notes.md", "# 开局建模工作笔记\n\n## 已完成\n- 实体\n- 场景与关系\n")
      await expect(runState(statePayload, runtime.tsian, signal)).resolves.toMatchObject({ status: "ready", phase: "state" })
      runtime.files.set("save/playthrough/opening-notes.md", "# 开局建模工作笔记\n\n## 已完成\n- 世界模型\n\n## 下一步\n- 正文与发布\n")
    }

    const success = makeRuntime()
    await stageModel(success)
    expect(JSON.parse(success.files.get("save/entities/container/bag.json") ?? "null")).toMatchObject({
      id: "container:bag",
      type: "container",
      contents: [],
    })
    expect(JSON.parse(success.files.get("save/playthrough/setup-summary.json") ?? "null")).toEqual({ status: "pending", summary: "主角在客栈醒来。" })
    expect(JSON.parse(success.files.get("save/playthrough/runtime.json") ?? "null").protagonistRef).toEqual({ ref: "character:hero", name: "主角" })
    expect(JSON.parse(success.files.get("save/playthrough/frontier.json") ?? "null").timeline[0]).toMatchObject({
      kind: "source",
      order: 1,
      summary: "主角在客栈醒来并确认处境。",
    })
    await expect(runEntities(entitiesPayload, success.tsian, signal)).resolves.toMatchObject({ alreadyComplete: true })
    await expect(runGraph(graphPayload, success.tsian, signal)).resolves.toMatchObject({ alreadyComplete: true })
    const writesBeforeStateRepeat = success.writes.length
    await expect(runState(statePayload, success.tsian, signal)).resolves.toMatchObject({ alreadyComplete: true, phase: "state" })
    expect(success.writes).toHaveLength(writesBeforeStateRepeat)
    await expect(runPublish({ openingReply }, success.tsian, signal)).resolves.toMatchObject({ status: "complete" })
    const turn0Assistant = JSON.parse(success.files.get("save/history/turns/turn-000000.json") ?? "null").timeline[0]
    expect(turn0Assistant).toEqual({ kind: "assistant", content: "晨光照进客栈。\n", projections: { choices: ["起身"] } })
    expect(JSON.parse(success.files.get("save/agents/storyteller/context.json") ?? "null").recentTurns[0].content).toBe("晨光照进客栈。\n")
    const writesBeforeRepeat = success.writes.length
    await expect(runPublish({ openingReply }, success.tsian, signal)).resolves.toMatchObject({ alreadyComplete: true })
    expect(success.writes).toHaveLength(writesBeforeRepeat)

    const unsafeEntity = makeRuntime()
    const unsafePayload = JSON.parse(JSON.stringify(entitiesPayload)) as typeof entitiesPayload
    unsafePayload.entities[0]!.id = "character:../hero"
    await expect(runEntities(unsafePayload, unsafeEntity.tsian, signal)).rejects.toMatchObject({ code: "OPENING_ENTITY_ID_INVALID" })
    expect(unsafeEntity.writes).toEqual([])

    const badGraph = makeRuntime()
    await runEntities(entitiesPayload, badGraph.tsian, signal)
    const entityWrites = badGraph.writes.slice()
    const missingGraph = JSON.parse(JSON.stringify(graphPayload)) as typeof graphPayload
    missingGraph.scenes[0]!.location.ref = "location:missing"
    await expect(runGraph(missingGraph, badGraph.tsian, signal)).rejects.toMatchObject({ code: "OPENING_REF_UNKNOWN" })
    expect(badGraph.writes).toEqual(entityWrites)
    expect(badGraph.files.has("save/scenes/opening.json")).toBe(false)

    const badState = makeRuntime()
    await runEntities(entitiesPayload, badState.tsian, signal)
    await runGraph(graphPayload, badState.tsian, signal)
    const graphWrites = badState.writes.slice()
    const missingState = JSON.parse(JSON.stringify(statePayload)) as typeof statePayload
    missingState.runtime.activeSceneRefs[0]!.ref = "scene:missing"
    await expect(runState(missingState, badState.tsian, signal)).rejects.toMatchObject({ code: "OPENING_REF_UNKNOWN" })
    expect(badState.writes).toEqual(graphWrites)
    expect(JSON.parse(badState.files.get("save/playthrough/setup-summary.json") ?? "null").summary).toBeNull()

    const badPublish = makeRuntime()
    await stageModel(badPublish)
    const stagedModel = new Map(Array.from(badPublish.files).filter(([path]) =>
      path.startsWith("save/entities/")
      || path.startsWith("save/scenes/")
      || path.startsWith("save/relationships/")
      || path === "save/playthrough/runtime.json"
      || path === "save/playthrough/frontier.json"))
    const writesBeforePublish = badPublish.writes.length
    await expect(runPublish({ openingReply: "晨光照进客栈。" }, badPublish.tsian, signal)).rejects.toMatchObject({
      code: "OPENING_REPLY_PROJECTION_FAILED",
      details: { issues: expect.arrayContaining([expect.objectContaining({ code: "choices.missing" })]) },
    })
    expect(badPublish.writes).toHaveLength(writesBeforePublish)
    expect(badPublish.files.has("save/history/turns/turn-000000.json")).toBe(false)
    for (const [path, content] of stagedModel) expect(badPublish.files.get(path)).toBe(content)

    const readUnavailable = makeRuntime(makeFiles(), { exposeRead: false })
    await expect(runEntities(entitiesPayload, readUnavailable.tsian, signal)).rejects.toMatchObject({ code: "WORKSPACE_OPERATION_NOT_EXPOSED" })
    expect(readUnavailable.writes).toEqual([])

    const startedFiles = makeFiles()
    startedFiles.set("save/playthrough/setup-summary.json", json({ status: "complete", summary: "完成", enteredPlay: true }))
    startedFiles.set("save/playthrough/runtime.json", json({ turn: 1, worldTime: "次日", weather: "晴", activeSceneRefs: [], extensions: {} }))
    const started = makeRuntime(startedFiles)
    await expect(runPublish({ openingReply }, started.tsian, signal)).rejects.toMatchObject({ code: "OPENING_PLAY_ALREADY_STARTED" })
    expect(started.writes).toEqual([])

    const oldAtomicHandoff = { ...entitiesPayload, ...graphPayload, ...statePayload, openingReply }
    const publishHandoff = { skill: "开局建模", script: "publish_opening", input: {}, inputRefs: { openingReply: "tool-result-0" } }
    const oldAtomicCharacters = JSON.stringify(oldAtomicHandoff).length
    const publishCharacters = JSON.stringify(publishHandoff).length
    expect(publishCharacters).toBeLessThan(oldAtomicCharacters * 0.25)
    expect(Object.keys(publishHandoff.input)).toEqual([])
    expect(JSON.stringify(publishHandoff)).not.toContain("entities")
    expect(JSON.stringify(publishHandoff)).not.toContain("frontier")
  })
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
        return openAiToolResponse("side-write-1", "write", { path: WORKSPACE_PATH, content: STAGED_VALUE })
      }
      if (requests.length === 5) {
        expect(toolObservation(body, "side-write-1")).toContain(WORKSPACE_PATH)
        return openAiFinalResponse("Side invocation recorded")
      }
      if (requests.length === 6) {
        expect(JSON.stringify(body.messages)).toContain("已保留的语义工具结果")
        expect(JSON.stringify(body.messages)).toContain(WORKSPACE_PATH)
        return openAiFinalResponse("Side invocation resumed")
      }
      return openAiFinalResponse("Background invocation completed")
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
      transcript: { mode: "full", audience: "player" },
    })).resolves.toMatchObject({ response: "Side invocation recorded" })

    const sideContextPath = agentContextPath(SIDE_AGENT_ID, SIDE_CONTEXT_SLOT)
    const firstSideContextRaw = JSON.parse(
      (await readWorkspaceFileForSave(seeded.saveId, sideContextPath))?.content ?? "null",
    )
    expect(firstSideContextRaw).toMatchObject({
      schema: "tsian.agent.context.v2",
      agentId: SIDE_AGENT_ID,
      sequence: 1,
    })
    const firstSideContext = parseAgentContext(
      JSON.stringify(firstSideContextRaw),
      seeded.saveId,
      { agentId: SIDE_AGENT_ID },
    )
    expect(firstSideContext?.toolMemories).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceToolCallId: "side-write-1",
        toolName: "write",
        status: "success",
      }),
    ]))
    expect(firstSideContext.sequence).toBe(1)
    const transcriptPath = agentInvocationTranscriptPath(SIDE_AGENT_ID, SIDE_CONTEXT_SLOT)
    const firstTranscript = JSON.parse((await readWorkspaceFileForSave(seeded.saveId, transcriptPath))?.content ?? "null")
    expect(firstTranscript).toMatchObject({ lastSequence: 1, entries: [{ sequence: 1, request: "Read the smoke workspace file." }] })
    expect(parseAgentInvocationTranscript(JSON.stringify(firstTranscript), SIDE_AGENT_ID, SIDE_CONTEXT_SLOT)?.entries).toHaveLength(1)
    expect(parseAgentInvocationTranscript(JSON.stringify({ ...firstTranscript, unknown: true }), SIDE_AGENT_ID, SIDE_CONTEXT_SLOT)).toBeNull()

    await expect(invokeAgent({
      agentId: SIDE_AGENT_ID,
      input: "Continue using the previous work record.",
      contextSlot: SIDE_CONTEXT_SLOT,
      persist: true,
      transcript: { mode: "full", audience: "player" },
    })).resolves.toMatchObject({ response: "Side invocation resumed" })
    const finalSideContext = parseAgentContext(
      (await readWorkspaceFileForSave(seeded.saveId, sideContextPath))?.content ?? "",
      seeded.saveId,
      { agentId: SIDE_AGENT_ID },
    )
    expect(finalSideContext.sequence).toBe(2)
    const finalTranscript = JSON.parse((await readWorkspaceFileForSave(seeded.saveId, transcriptPath))?.content ?? "null")
    expect(finalTranscript.lastSequence).toBe(2)
    expect(finalTranscript.entries).toHaveLength(2)
    await expect(invokeAgent({
      agentId: SIDE_AGENT_ID,
      input: "Run a background persistent task without a player archive.",
      contextSlot: BACKGROUND_CONTEXT_SLOT,
      persist: true,
    })).resolves.toMatchObject({ response: "Background invocation completed" })
    expect(await readWorkspaceFileForSave(
      seeded.saveId,
      agentInvocationTranscriptPath(SIDE_AGENT_ID, BACKGROUND_CONTEXT_SLOT),
    )).toBeNull()
    expect(requests).toHaveLength(7)

    const diagnostics = await diagnosticRequests("succeeded")
    expect(diagnostics).toHaveLength(7)
    expect(diagnostics.every((record) => record.attempts.length === 1)).toBe(true)
    expect(JSON.stringify(diagnostics)).not.toContain(PROVIDER_CREDENTIAL)

    await configureProvider("text")
    const textSeeded = await seedRuntime({ contextMarker: "text-protocol-success-baseline" })
    const textRequests: OpenAiRequestBody[] = []
    const completedTextWriteIds: string[] = []
    const quotedUserProtocolText = '<tsian-tool-protocol-error>{"code":"USER_QUOTED_TAG","message":"preserve this user text","retryRemaining":999}</tsian-tool-protocol-error>'
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init)
      textRequests.push(body)
      if (textRequests.length === 1) {
        return openAiFinalResponse(
          `${TEXT_TOOL_CALLS_OPEN_TAG}[{"name":"write","arguments":{"path":"${LEGACY_REPLAY_PATH}","content":"invalid",}}]${TEXT_TOOL_CALLS_CLOSE_TAG}`,
        )
      }
      if (textRequests.length === 2) {
        return openAiFinalResponse(
          `<tool_call>[{"name":"write","arguments":{"path":"${LEGACY_REPLAY_PATH}","content":"must-not-run"}}]</tool_call>`,
        )
      }
      if (textRequests.length === 3) {
        return openAiFinalResponse(
          `${TEXT_TOOL_CALLS_OPEN_TAG}[{"name":"write","arguments":{"path":"${LEGACY_REPLAY_PATH}","content":"invalid-again",}}]${TEXT_TOOL_CALLS_CLOSE_TAG}`,
        )
      }
      if (textRequests.length === 4) {
        return openAiFinalResponse(
          `${TEXT_TOOL_CALLS_OPEN_TAG}[{"name":"write","arguments":{"path":"${WORKSPACE_PATH}","content":"${STAGED_VALUE}"}}]`,
        )
      }
      if (textRequests.length === 5) {
        return openAiFinalResponse(
          `${TEXT_TOOL_CALLS_OPEN_TAG}[{"name":"read","arguments":{"path":"${WORKSPACE_PATH}",}}]${TEXT_TOOL_CALLS_CLOSE_TAG}`,
        )
      }
      return openAiFinalResponse("Text protocol correction completed")
    }))

    await expect(runAssistantChat({
      message: `Recover from protocol mistakes, write once, and finish. Quoted protocol text: ${quotedUserProtocolText}`,
      sessionId: textSeeded.sessionId,
      history: textSeeded.baselineMessages,
      onTool: (_agentId, _round, callId, name, status) => {
        if (name === "write" && status === "success") completedTextWriteIds.push(callId)
      },
    })).resolves.toMatchObject({ replyText: "Text protocol correction completed" })

    expect(textRequests).toHaveLength(6)
    expect(completedTextWriteIds).toHaveLength(1)
    expect((await readWorkspaceFileForSave(textSeeded.saveId, WORKSPACE_PATH))?.content).toBe(STAGED_VALUE)
    expect(await readWorkspaceFileForSave(textSeeded.saveId, LEGACY_REPLAY_PATH)).toBeNull()

    const initialPrompt = requestMessageText({
      messages: textRequests[0]!.messages?.filter((message) => message.role === "system"),
    })
    expect(initialPrompt.match(
      /<tsian-tool-calls>\s*\[\s*\{\s*"name"\s*:\s*"TOOL_NAME"\s*,\s*"arguments"\s*:\s*\{\s*\}\s*\}\s*\]\s*<\/tsian-tool-calls>/g,
    )).toHaveLength(1)
    expect(initialPrompt).not.toContain("<tsian-tool-call-records>")
    expect(initialPrompt).not.toContain("<tsian-tool-protocol-error>")

    expect(textRequests.map((request) => latestTextProtocolError(request))).toEqual([
      undefined,
      { code: "TEXT_TOOL_PROTOCOL_INVALID_JSON", retryRemaining: 3 },
      { code: "TEXT_TOOL_PROTOCOL_NON_EXECUTABLE_TAG", retryRemaining: 3 },
      { code: "TEXT_TOOL_PROTOCOL_INVALID_JSON", retryRemaining: 2 },
      undefined,
      { code: "TEXT_TOOL_PROTOCOL_INVALID_JSON", retryRemaining: 3 },
    ])
    expect(textRequests.every((request) => textProtocolErrors(request).length <= 1)).toBe(true)
    expect(textRequests.slice(1).every((request) => (
      requestMessageText(request).includes(quotedUserProtocolText)
    ))).toBe(true)

    const providerMessages = textRequests.flatMap((request) => request.messages ?? [])
    const reportMessages = providerMessages.filter((message) => (
      JSON.stringify(message.content ?? "").includes("<tsian-executed-tools>")
      && JSON.stringify(message.content ?? "").includes("</tsian-executed-tools>")
    ))
    expect(reportMessages.length).toBeGreaterThan(0)
    expect(reportMessages.every((message) => message.role === "user")).toBe(true)
    expect(providerMessages.some((message) => (
      message.role === "assistant"
      && JSON.stringify(message.content ?? "").includes("<tsian-tool-call-records>")
    ))).toBe(false)
    expect(requestMessageText(textRequests[4]!).match(
      /<tsian-executed-tools>[\s\S]*?<\/tsian-executed-tools>/g,
    )).toHaveLength(1)
    expect(latestTextProtocolError(textRequests[4]!)).toBeUndefined()

    const textMessages = await getAssistantSessionMessages(textSeeded.sessionId)
    expect(textMessages).toMatchObject([
      { role: "user", content: `Recover from protocol mistakes, write once, and finish. Quoted protocol text: ${quotedUserProtocolText}` },
      { role: "assistant", content: "Text protocol correction completed" },
    ])
    expect(JSON.stringify(textMessages)).not.toContain("tsian-executed-tools")
    expect(JSON.stringify(textMessages)).not.toContain(STAGED_VALUE)
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

    await configureProvider("text")
    const textSeeded = await seedRuntime({
      baselineMessages,
      contextMarker: "text-protocol-failure-baseline",
    })
    const exhaustionRequests: OpenAiRequestBody[] = []
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = requestBody(init)
      exhaustionRequests.push(body)
      if (exhaustionRequests.length === 1) {
        return openAiTextToolResponse("write", { path: WORKSPACE_PATH, content: STAGED_VALUE })
      }
      if (exhaustionRequests.length % 2 === 0) {
        return openAiFinalResponse(
          `${TEXT_TOOL_CALLS_OPEN_TAG}{"name":"read","arguments":{}}${TEXT_TOOL_CALLS_CLOSE_TAG}`,
        )
      }
      return openAiFinalResponse(`${TEXT_TOOL_CALLS_OPEN_TAG}[]${TEXT_TOOL_CALLS_CLOSE_TAG}`)
    }))

    await expect(runAssistantChat({
      message: "Stage a text-protocol write, then exhaust protocol correction.",
      sessionId: textSeeded.sessionId,
      history: baselineMessages,
    })).rejects.toThrow("TEXT_TOOL_PROTOCOL_CALLS_NOT_ARRAY")

    expect(exhaustionRequests).toHaveLength(8)
    expect(exhaustionRequests.slice(2).map((request) => latestTextProtocolError(request))).toEqual([
      { code: "TEXT_TOOL_PROTOCOL_CALLS_NOT_ARRAY", retryRemaining: 3 },
      { code: "TEXT_TOOL_PROTOCOL_CALLS_EMPTY", retryRemaining: 3 },
      { code: "TEXT_TOOL_PROTOCOL_CALLS_NOT_ARRAY", retryRemaining: 2 },
      { code: "TEXT_TOOL_PROTOCOL_CALLS_EMPTY", retryRemaining: 2 },
      { code: "TEXT_TOOL_PROTOCOL_CALLS_NOT_ARRAY", retryRemaining: 1 },
      { code: "TEXT_TOOL_PROTOCOL_CALLS_EMPTY", retryRemaining: 1 },
    ])
    expect(exhaustionRequests.every((request) => textProtocolErrors(request).length <= 1)).toBe(true)
    expect((await readWorkspaceFileForSave(textSeeded.saveId, WORKSPACE_PATH))?.content)
      .toBe(WORKSPACE_BASELINE)
    expect(await getAssistantSessionMessages(textSeeded.sessionId)).toEqual(baselineMessages)
    expect(await assistantContextContent(textSeeded.sessionId)).toBe(textSeeded.baselineContext)
    expect((exhaustionRequests[1]?.messages ?? []).some((message) => (
      message.role === "user"
      && (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""))
        .includes("<tsian-executed-tools>")
      && (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""))
        .includes('"name":"write"')
    ))).toBe(true)
  })
})
