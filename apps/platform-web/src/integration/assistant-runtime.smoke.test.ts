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
} from "../agent-runtime/workspace-tools"
import { executeWorkspaceOperation } from "../agent-runtime/workspace-operations"
import { executeRunScript } from "../agent-runtime/workspace-tools/skill-actions"
import type { RuntimeChatMessage } from "../runtime-host/ai"
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
import { parseOpeningAssistant } from "../../../play-frontend-dev/src/lib/opening-interview"

const CARD_ID = "assistant-runtime-smoke"
const MODEL_ID = "assistant-smoke-model"
const PROVIDER_ID = "assistant-smoke-provider"
const PROVIDER_CREDENTIAL = "assistant-provider-secret"
const WORKSPACE_PATH = "save/assistant-smoke.txt"
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
  input?: { name?: string; path?: string; failed?: boolean; content?: string },
): RuntimeChatMessage[] {
  const name = input?.name ?? "read"
  const path = input?.path ?? `save/text-round-${index}.txt`
  const id = `text-${index}-a`
  const call = { id, name, arguments: { path, ...(input?.content ? { content: input.content } : {}) } }
  const observation = input?.failed
    ? { id, name, ok: false, error: { code: "WRITE_FAILED", message: "retry the exact payload" } }
    : { id, name, ok: true, result: { path, status: "ok" } }
  return [
    {
      role: "assistant",
      content: `<tsian-tool-call-records>\n${JSON.stringify([call])}\n</tsian-tool-call-records>`,
    },
    {
      role: "user",
      content: `<tsian-tool-observations>\n${JSON.stringify([observation])}\n</tsian-tool-observations>`,
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
      ...textToolRound(1),
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
    const textSummaryIndex = textResult.messages.findIndex((message) =>
      typeof message.content === "string" && message.content.startsWith("任务恢复 checkpoint："))
    const textPinnedAssistantIndex = textResult.messages.findIndex((message) =>
      message.role === "assistant" && typeof message.content === "string" && message.content.includes("text-0-a"))
    const textPinnedObservationIndex = textResult.messages.findIndex((message) =>
      message.role === "user" && typeof message.content === "string" && message.content.includes("text-0-a"))
    const textRecentAssistantIndex = textResult.messages.findIndex((message) =>
      message.role === "assistant" && typeof message.content === "string" && message.content.includes("text-2-a"))
    expect(textSummaryIndex).toBeGreaterThan(0)
    expect(textPinnedAssistantIndex).toBeGreaterThan(textSummaryIndex)
    expect(textPinnedObservationIndex).toBe(textPinnedAssistantIndex + 1)
    expect(textRecentAssistantIndex).toBeGreaterThan(textPinnedObservationIndex)
    expect(textResult.messages.filter((message) =>
      typeof message.content === "string" && message.content.includes("text-0-a"))).toHaveLength(2)
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

  it("runs a visible Skill action without use_skill and omits source/read bodies from Tool Memory", async () => {
    const file = (path: string, content: string): WorkspaceFile => ({ path, content, createdAt: 0, updatedAt: 0 })
    const skillContent = [
      "---",
      "name: demo",
      "description: Direct action smoke",
      "---",
      "# Demo",
      "```json tsian-actions",
      JSON.stringify([{ name: "commit_demo", description: "Commit", inputSchema: { type: "object" }, outputSchema: { type: "object" }, executor: { type: "browser_script", path: "scripts/commit.js" } }]),
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
    const runBrowserScript = vi.fn(async () => ({ ok: true as const, item: { receipt: "r1" } }))
    const sessionState = createRuntimeWorkspaceToolSessionState()
    await expect(executeRunScript({
      workspaceFiles,
      agentContext: agentContext!,
      sessionState,
      runBrowserScript,
    }, { skill: "demo", script: "commit_demo", input: {} })).resolves.toMatchObject({
      result: { status: "executed", output: { receipt: "r1" } },
    })
    expect(runBrowserScript).toHaveBeenCalledOnce()

    const skillFile = workspaceFiles.find((entry) => entry.path.endsWith("/SKILL.md"))!
    skillFile.content = "---\nname: demo\n---\n# Demo without actions\n"
    await expect(executeRunScript({
      workspaceFiles,
      agentContext: agentContext!,
      sessionState,
      runBrowserScript,
    }, { skill: "demo", script: "commit_demo", input: {} })).rejects.toMatchObject({ code: "ACTION_NOT_FOUND" })
    expect(runBrowserScript).toHaveBeenCalledOnce()

    const disabledFiles = workspaceFiles.map((entry) => entry.path === "agents/demo-agent/agent.json"
      ? file(entry.path, JSON.stringify({ id: "demo-agent", skills: { enabled: [], disabled: ["agents/demo-agent/skills/demo/SKILL.md"] } }))
      : entry)
    const disabledContext = assembleAgentContext(disabledFiles, { agentId: "demo-agent", workspaceTrustBoundary: "trusted-authoring" })
    await expect(executeRunScript({
      workspaceFiles: disabledFiles,
      agentContext: disabledContext!,
      sessionState: createRuntimeWorkspaceToolSessionState(),
      runBrowserScript,
    }, { skill: "demo", script: "commit_demo", input: {} })).rejects.toMatchObject({ code: "SKILL_NOT_FOUND" })

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
      "agents/world-architect/skills/开局建模/scripts/commit-opening.js",
    ]))
    const openingTemplatePaths = WORLD_ARCHITECT_SKILL_FILES.map((file) => file.path)
    expect(openingTemplatePaths).not.toContain("agents/world-architect/skills/开局建模/scripts/_progress.js")
    expect(openingTemplatePaths).not.toContain("agents/world-architect/skills/开局建模/scripts/read-opening-progress.js")
    expect(openingTemplatePaths).not.toContain("agents/world-architect/skills/开局建模/scripts/advance-opening-progress.js")
    const currentSchema = DEFAULT_SAVE_RUNTIME_FILES.find((file) => file.path === "save/schema/current.md")?.content ?? ""
    expect(currentSchema.length).toBeLessThan(1_000)
    expect(currentSchema).toContain("save-specific")
  })

  it("keeps simplified opening recovery and commit boundaries executable", async () => {
    expect(parseOpeningAssistant("你想从哪里开始？\n[[开局选项]]\n- 城门\n- 客栈")).toEqual({
      displayContent: "你想从哪里开始？",
      choices: ["城门", "客栈"],
    })
    expect(parseOpeningAssistant("问题\n[[开局选项]]\n- A\n[[/开局选项]]\n[[开局选项]]\n- B")).toBeNull()

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
    const runOpening = new AsyncFunction(
      "input",
      "tsian",
      "signal",
      `${scriptContent("开局建模/scripts/_common.js")}\n${scriptContent("开局建模/scripts/_validation.js")}\n${scriptContent("开局建模/scripts/commit-opening.js")}`,
    )
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
      const source = {
        importedAt: "2026-08-12T00:00:00.000Z",
        normalizationVersion: "test-v1",
        title: "测试小说",
        chapterCount: 2,
      }
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
        ["save/playthrough/runtime.json", json({ turn: 0, worldTime: "", plotOrder: 1, location: null, weather: "", activeSceneRefs: [], protagonistRef: null, extensions: {}, updatedAtTurn: 0, updatedBy: null })],
        ["save/playthrough/frontier.json", json({ sourceWindow: { start: null, end: null }, extractedThrough: null, timeline: [{ kind: "source", order: 1, chapter: 1, time: "元年", label: "开局" }], notes: "" })],
        ["save/playthrough/understanding-summary.json", json({ status: "pending", title: null, candidateCharacters: [] })],
        ["save/playthrough/setup-summary.json", json({ status: "pending", summary: null })],
        ["config/reply-projection.json", json({
          schema: "tsian.reply-projection.v1",
          rules: [{
            id: "choices",
            match: "/\\[\\[选项\\]\\]([\\s\\S]*?)\\[\\[\\/选项\\]\\]/g",
            text: "",
            project: { choices: "$1|lines|stripList" },
          }],
        })],
        ["game-card.json", json({ runtime: { entrypoints: { playerTurn: "storyteller" } } })],
        ["agents/storyteller/agent.json", json({ id: "storyteller" })],
        ["agents/storyteller/AGENT.md", "# Storyteller\n"],
      ])
    }
    const makeRuntime = (files = makeFiles(), options?: { exposeRead?: boolean }) => {
      const writes: string[] = []
      const workspaceFiles = (): WorkspaceFile[] =>
        Array.from(files, ([path, fileContent]): WorkspaceFile => ({
          path,
          content: fileContent,
          createdAt: 0,
          updatedAt: 0,
        }))
      const project = vi.fn(async (content: string) => toBrowserScriptReplyProjection(
        projectAssistantReply(content, workspaceFiles()),
      ))
      const read = vi.fn(async (request: Omit<WorkspaceOperationRequest, "operation">) =>
        executeWorkspaceOperation(
          { ...request, operation: "read" },
          {
            workspaceFiles: workspaceFiles(),
            actorLevel: 1,
            exposedOperations: options?.exposeRead === false ? [] : ["read"],
          },
        ))
      const tsian = {
        workspace: {
          read,
          write: vi.fn(async ({ path, content }: { path: string; content: string }) => {
            files.set(path, content)
            writes.push(path)
            return { path, content }
          }),
          glob: vi.fn(async () => ({ matches: [], truncated: false })),
          list: vi.fn(async () => ({ entries: [] })),
        },
        reply: { project },
        trace: vi.fn(),
        memory: { set: vi.fn() },
      }
      return { files, writes, project, read, tsian }
    }
    const payload = (): Record<string, unknown> => ({
      entities: [
        { id: "character:hero", name: "主角", brief: "测试主角" },
        { id: "location:inn", name: "客栈", brief: "开局地点" },
      ],
      scenes: [{ id: "scene:opening", name: "客栈清晨", location: { ref: "location:inn", name: "错误名称" }, present: [{ ref: "character:hero" }] }],
      relationships: [],
      runtime: { protagonistRef: { ref: "character:hero", name: "错误名称" }, location: { ref: "location:inn" }, activeSceneRefs: [{ ref: "scene:opening" }] },
      frontier: { sourceWindow: { startIndex: 1, endIndex: 2 }, timeline: [{ chapter: 1, time: "清晨", label: "醒来" }] },
      summary: "主角在客栈醒来。",
      openingReply: "晨光照进客栈。\n[[选项]]\n- 起身\n[[/选项]]",
    })
    const signal = { throwIfAborted() {} }

    const success = makeRuntime()
    await expect(runOpening(payload(), success.tsian, signal)).resolves.toMatchObject({ status: "complete" })
    const successProjection = await success.project.mock.results[0]!.value
    expect(successProjection).toMatchObject({
      kind: "assistant",
      content: "晨光照进客栈。\n",
      projections: { choices: ["起身"] },
      diagnostics: [],
      configPresent: true,
      ruleCount: 1,
      appliedRuleCount: 1,
    })
    expect(successProjection).not.toHaveProperty("displayContent")
    expect(JSON.parse(success.files.get("save/playthrough/runtime.json") ?? "null").protagonistRef).toEqual({ ref: "character:hero", name: "主角" })
    expect(JSON.parse(success.files.get("save/playthrough/frontier.json") ?? "null").timeline[0]).toEqual({ kind: "source", order: 1, chapter: 1, time: "清晨", label: "醒来" })
    const turn0Assistant = JSON.parse(success.files.get("save/history/turns/turn-000000.json") ?? "null").timeline[0]
    expect(turn0Assistant).toEqual({
      kind: "assistant",
      content: "晨光照进客栈。\n",
      projections: { choices: ["起身"] },
    })
    expect(turn0Assistant).not.toHaveProperty("displayContent")
    expect(JSON.parse(success.files.get("save/agents/storyteller/context.json") ?? "null").recentTurns[0].content).toBe("晨光照进客栈。\n")
    expect(success.read).toHaveBeenCalledWith({
      scope: "effective",
      path: "save/agents/world-architect/context-understanding.json",
    })

    const diagnosticSuccess = makeRuntime()
    diagnosticSuccess.files.set("config/reply-projection.json", json({
      schema: "tsian.reply-projection.v1",
      rules: [
        {
          id: "choices",
          match: "/\\[\\[选项\\]\\]([\\s\\S]*?)\\[\\[\\/选项\\]\\]/g",
          text: "",
          project: { choices: "$1|lines|stripList" },
        },
        { id: "broken", match: "/[/", text: "" },
      ],
    }))
    await expect(runOpening(payload(), diagnosticSuccess.tsian, signal)).resolves.toMatchObject({ status: "complete" })
    const diagnosticProjection = await diagnosticSuccess.project.mock.results[0]!.value
    expect(diagnosticProjection).toMatchObject({
      diagnostics: [expect.objectContaining({
        scope: "rule",
        code: "REPLY_PROJECTION_REGEX_INVALID",
        path: "config/reply-projection.json",
        ruleId: "broken",
        ruleIndex: 1,
      })],
      configPresent: true,
      ruleCount: 2,
      appliedRuleCount: 1,
    })

    const missingTarget = makeRuntime()
    const missingPayload = payload()
    ;(missingPayload.runtime as { protagonistRef: { ref: string } }).protagonistRef.ref = "character:missing"
    await expect(runOpening(missingPayload, missingTarget.tsian, signal)).rejects.toMatchObject({ code: "OPENING_REF_UNKNOWN" })
    expect(missingTarget.writes).toEqual([])

    const unsafeId = makeRuntime()
    const unsafePayload = payload()
    ;(unsafePayload.entities as Array<{ id: string }>)[0]!.id = "character:../hero"
    await expect(runOpening(unsafePayload, unsafeId.tsian, signal)).rejects.toMatchObject({ code: "OPENING_ENTITY_ID_INVALID" })
    expect(unsafeId.writes).toEqual([])

    const unprojectable = makeRuntime()
    const invalidProjectionRules = Array.from({ length: 21 }, (_, index) => ({
      id: `broken-${index}`,
      match: `/${"a".repeat(600)}[/`,
    }))
    unprojectable.files.set("config/reply-projection.json", json({
      schema: "tsian.reply-projection.v1",
      rules: [
        {
          id: "choices",
          match: "/\\[\\[选项\\]\\]([\\s\\S]*?)\\[\\[\\/选项\\]\\]/g",
          text: "",
          project: { choices: "$1|lines|stripList" },
        },
        ...invalidProjectionRules,
      ],
    }))
    const unprojectablePayload = payload()
    unprojectablePayload.openingReply = "晨光照进客栈。"
    await expect(runOpening(unprojectablePayload, unprojectable.tsian, signal)).rejects.toMatchObject({
      code: "OPENING_REPLY_PROJECTION_FAILED",
      details: {
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "choices.missing", path: "projections.choices" }),
        ]),
        projection: expect.objectContaining({
          displayContent: "omitted",
          choiceCount: null,
          configPresent: true,
          ruleCount: 22,
          appliedRuleCount: 0,
        }),
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            scope: "rule",
            code: "REPLY_PROJECTION_REGEX_INVALID",
            path: "config/reply-projection.json",
            ruleId: "broken-0",
            ruleIndex: 1,
          }),
        ]),
      },
    })
    expect(unprojectable.project).toHaveBeenCalledOnce()
    const unprojectableProjection = await unprojectable.project.mock.results[0]!.value
    expect(unprojectableProjection.diagnostics).toHaveLength(20)
    expect(unprojectableProjection.diagnostics[0]?.message).toHaveLength(500)
    expect(JSON.stringify(unprojectableProjection.diagnostics)).not.toContain("晨光照进客栈")
    expect(unprojectable.writes).toEqual([])

    const readUnavailable = makeRuntime(makeFiles(), { exposeRead: false })
    await expect(runOpening(payload(), readUnavailable.tsian, signal)).rejects.toMatchObject({
      code: "WORKSPACE_OPERATION_NOT_EXPOSED",
    })
    expect(readUnavailable.writes).toEqual([])

    const completeFiles = makeFiles()
    completeFiles.set("save/playthrough/setup-summary.json", json({ status: "complete", summary: "完成", enteredPlay: false }))
    const complete = makeRuntime(completeFiles)
    await expect(runOpening(payload(), complete.tsian, signal)).resolves.toMatchObject({ status: "complete", alreadyComplete: true })
    expect(complete.writes).toEqual([])

    const startedFiles = makeFiles()
    startedFiles.set("save/playthrough/setup-summary.json", json({ status: "complete", summary: "完成", enteredPlay: false }))
    startedFiles.set("save/playthrough/runtime.json", json({ turn: 1, worldTime: "次日", weather: "晴", activeSceneRefs: [], extensions: {} }))
    const started = makeRuntime(startedFiles)
    await expect(runOpening(payload(), started.tsian, signal)).rejects.toMatchObject({ code: "OPENING_PLAY_ALREADY_STARTED" })
    expect(started.writes).toEqual([])
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
