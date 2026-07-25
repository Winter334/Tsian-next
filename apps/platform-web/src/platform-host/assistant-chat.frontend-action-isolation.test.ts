import type {
  AgentConfig,
  WorkspaceFile,
} from "@tsian/contracts"
import type {
  ModelCallResult,
  RuntimeChatMessage,
} from "../runtime-host/ai"
import type { ToolSchema } from "../agent-runtime/tool-schemas"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  callModelNative: vi.fn(),
  commitWorkspaceChangesForSave: vi.fn(),
  createBrowserScriptRunners: vi.fn(() => ({})),
  createFrontendInspector: vi.fn(),
  deleteCardContentPathForActiveCard: vi.fn(),
  deleteFrontendPathForActiveCard: vi.fn(),
  deleteLocalAssistantPath: vi.fn(),
  emitInteractionRequest: vi.fn(),
  emitTurnDebugReady: vi.fn(),
  executeWorkspaceMutation: vi.fn(),
  getActiveSaveId: vi.fn(),
  getAssistantAttachmentBase64: vi.fn(),
  getBrowserAiConfig: vi.fn(),
  getLocalGameCard: vi.fn(),
  getPlatformActiveGameCard: vi.fn(),
  listAttachmentsBySession: vi.fn(),
  listEffectiveWorkspaceFilesForActiveSave: vi.fn(),
  loadLocalAssistantFiles: vi.fn(),
  normalizeMessageContent: vi.fn((value: string) => value.trim()),
  readTextAttachment: vi.fn(),
  rejectAllInteractionRequests: vi.fn(),
  resolveAgentModelConfig: vi.fn(),
  resolveBrowserAiConfigForModel: vi.fn(),
  saveAssistantSessionMessages: vi.fn(),
  saveLocalAssistantFiles: vi.fn(),
  triggerFrontendRebuild: vi.fn(),
  waitForPlatformHostReady: vi.fn(),
  writeCardContentFileForActiveCard: vi.fn(),
  writeFrontendFileForActiveCard: vi.fn(),
  writeLocalGameCardContentFile: vi.fn(),
}))

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>()
  return {
    ...actual,
    deleteLocalAssistantPath: mocks.deleteLocalAssistantPath,
    getActiveSaveId: mocks.getActiveSaveId,
    getAssistantAttachmentBase64: mocks.getAssistantAttachmentBase64,
    getLocalGameCard: mocks.getLocalGameCard,
    listAttachmentsBySession: mocks.listAttachmentsBySession,
    loadLocalAssistantFiles: mocks.loadLocalAssistantFiles,
    readTextAttachment: mocks.readTextAttachment,
    saveAssistantSessionMessages: mocks.saveAssistantSessionMessages,
    saveLocalAssistantFiles: mocks.saveLocalAssistantFiles,
    writeLocalGameCardContentFile: mocks.writeLocalGameCardContentFile,
  }
})

vi.mock("../runtime-host/ai", () => ({
  generateAssistantReply: vi.fn(),
  generateAssistantReplyNative: mocks.callModelNative,
  streamAssistantReplyNative: vi.fn(),
  streamAssistantReplyText: vi.fn(),
}))

vi.mock("../config/ai", () => ({
  DEFAULT_BROWSER_AI_STREAMING: false,
  DEFAULT_BROWSER_AI_TOOL_CALL_MODE: "native",
  getBrowserAiConfig: mocks.getBrowserAiConfig,
  resolveBrowserAiConfigForModel: mocks.resolveBrowserAiConfigForModel,
}))

vi.mock("../interaction-events", () => ({
  emitInteractionRequest: mocks.emitInteractionRequest,
  rejectAllInteractionRequests: mocks.rejectAllInteractionRequests,
}))

vi.mock("../debug-events", () => ({
  emitTurnDebugReady: mocks.emitTurnDebugReady,
}))

vi.mock("./browser-skill-script-executor", () => ({
  createBrowserScriptRunners: mocks.createBrowserScriptRunners,
}))

vi.mock("./frontend-inspector", () => ({
  createFrontendInspector: mocks.createFrontendInspector,
}))

vi.mock("./internal", () => ({
  buildAgentProviderPresetMap: () => new Map<string, string>(),
  cardContentFilesToWorkspaceFiles: vi.fn(),
  deleteCardContentPathForActiveCard: mocks.deleteCardContentPathForActiveCard,
  deleteFrontendPathForActiveCard: mocks.deleteFrontendPathForActiveCard,
  getPlatformActiveGameCard: mocks.getPlatformActiveGameCard,
  listEffectiveWorkspaceFilesForActiveSave: mocks.listEffectiveWorkspaceFilesForActiveSave,
  normalizeMessageContent: mocks.normalizeMessageContent,
  resolveAgentModelConfig: mocks.resolveAgentModelConfig,
  writeCardContentFileForActiveCard: mocks.writeCardContentFileForActiveCard,
  writeFrontendFileForActiveCard: mocks.writeFrontendFileForActiveCard,
}))

vi.mock("./host-state", () => ({
  waitForPlatformHostReady: mocks.waitForPlatformHostReady,
}))

vi.mock("./workspace-volumes", () => ({
  cardFrontendVolume: { enumerate: vi.fn() },
  executeWorkspaceMutation: mocks.executeWorkspaceMutation,
}))

vi.mock("../frontend-build/trigger", () => ({
  triggerFrontendRebuild: mocks.triggerFrontendRebuild,
}))

import { runAgentRuntimeTurn } from "../agent-runtime"
import { runAssistantChat } from "./assistant-chat"

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 2 }
}

function agentConfig(input: {
  id: string
  title: string
  contacts?: string[]
  contextPaths?: string[]
  workspaceLevel: number
}): string {
  const config: AgentConfig = {
    id: input.id,
    title: input.title,
    summary: `${input.title} fixture`,
    contacts: input.contacts ?? [],
    contextPaths: input.contextPaths ?? [],
    skills: { enabled: [], disabled: [] },
    platformTools: {
      enabled: ["agent_call", "workspace_read"],
      disabled: [],
    },
    workspaceAccess: { level: input.workspaceLevel },
  }
  return JSON.stringify(config)
}

function assistantFiles(): WorkspaceFile[] {
  return [
    file(".tsian/local/assistant/agent.json", agentConfig({
      id: "assistant",
      title: "Desktop Assistant",
      contacts: ["runtime"],
      workspaceLevel: 4,
    })),
    file(".tsian/local/assistant/AGENT.md", "Trusted assistant instructions"),
  ]
}

function cardFiles(): WorkspaceFile[] {
  return [
    file("agents/runtime/agent.json", agentConfig({
      id: "runtime",
      title: "Runtime Agent",
      contextPaths: ["frontend-actions/use-item/context.md"],
      workspaceLevel: 1,
    })),
    file("agents/runtime/AGENT.md", "Runtime instructions"),
    file("frontend-actions/use-item/run.js", "FRONTEND_ACTION_SECRET"),
    file("frontend-actions/use-item/context.md", "HIDDEN_CONTEXT_SECRET"),
  ]
}

function nativeResult(
  finishReason: ModelCallResult["finishReason"],
  text: string,
  toolCalls: ModelCallResult["toolCalls"] = [],
): ModelCallResult {
  return { finishReason, text, toolCalls, raw: text }
}

function modelMessagesContain(
  messages: RuntimeChatMessage[],
  needle: string,
): boolean {
  return messages.some((message) => {
    if (typeof message.content === "string") return message.content.includes(needle)
    return message.content.some((part) => part.type === "text" && part.text.includes(needle))
  })
}

function toolObservation(messages: RuntimeChatMessage[], callId: string): string {
  const content = messages.find(
    (message) => message.role === "tool" && message.toolCallId === callId,
  )?.content
  return typeof content === "string" ? content : ""
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.waitForPlatformHostReady.mockResolvedValue(undefined)
  mocks.getPlatformActiveGameCard.mockResolvedValue({ id: "card-1" })
  mocks.getActiveSaveId.mockResolvedValue("save-1")
  mocks.listEffectiveWorkspaceFilesForActiveSave.mockResolvedValue(cardFiles())
  mocks.loadLocalAssistantFiles.mockResolvedValue(assistantFiles())
  mocks.listAttachmentsBySession.mockResolvedValue([])
  mocks.getBrowserAiConfig.mockReturnValue({
    streaming: false,
    toolCallMode: "native",
  })
  mocks.resolveAgentModelConfig.mockReturnValue({
    streaming: false,
    toolCallMode: "native",
    parameters: { common: { contextWindow: 256_000 } },
  })
  mocks.callModelNative.mockResolvedValue(nativeResult("stop", "done"))
  mocks.saveAssistantSessionMessages.mockResolvedValue(undefined)
  mocks.saveLocalAssistantFiles.mockResolvedValue(undefined)
})

describe("assistant-chat Frontend Action workspace boundary", () => {
  it("lets the real desktop assistant tool loop read Frontend Action files", async () => {
    mocks.callModelNative
      .mockResolvedValueOnce(nativeResult("tool_calls", "reading", [{
        id: "read-action",
        name: "read",
        arguments: {
          scope: "effective",
          path: "frontend-actions/use-item/run.js",
        },
      }]))
      .mockImplementationOnce(async (messages: RuntimeChatMessage[]) => {
        expect(toolObservation(messages, "read-action")).toContain("FRONTEND_ACTION_SECRET")
        return nativeResult("stop", "assistant read action")
      })

    await expect(runAssistantChat({
      message: "Read the action source",
      sessionId: "session-1",
    })).resolves.toMatchObject({ replyText: "assistant read action" })
  })

  it("keeps the runtime entry context and tool loop isolated", async () => {
    const calls: RuntimeChatMessage[][] = []
    const result = await runAgentRuntimeTurn({
      agentId: "runtime",
      userInput: "Find the action",
      recentHistory: [],
      turn: 0,
      workspaceFiles: cardFiles(),
      workspaceTrustBoundary: "runtime-game-agent",
    }, {
      toolCallMode: "native",
      callModel: vi.fn(),
      callModelNative: vi.fn(async (messages, _options, _tools: ToolSchema[]) => {
        calls.push(messages)
        if (calls.length === 1) {
          expect(modelMessagesContain(messages, "HIDDEN_CONTEXT_SECRET")).toBe(false)
          return nativeResult("tool_calls", "reading", [{
            id: "runtime-read",
            name: "read",
            arguments: {
              scope: "effective",
              path: "frontend-actions/use-item/run.js",
            },
          }])
        }
        expect(toolObservation(messages, "runtime-read")).toContain("WORKSPACE_FILE_NOT_FOUND")
        expect(toolObservation(messages, "runtime-read")).not.toContain("FRONTEND_ACTION_SECRET")
        return nativeResult("stop", "runtime blocked")
      }),
    })

    expect(result.replyText).toBe("runtime blocked")
  })

  it("downgrades an Agent delegated by the trusted assistant entry", async () => {
    mocks.callModelNative.mockImplementation(
      async (messages: RuntimeChatMessage[], options): Promise<ModelCallResult> => {
        if (options.debugLabel === "agent:runtime") {
          const readObservation = toolObservation(messages, "delegated-read")
          if (!readObservation) {
            expect(modelMessagesContain(messages, "HIDDEN_CONTEXT_SECRET")).toBe(false)
            return nativeResult("tool_calls", "reading", [{
              id: "delegated-read",
              name: "read",
              arguments: {
                scope: "effective",
                path: "frontend-actions/use-item/run.js",
              },
            }])
          }
          expect(readObservation).toContain("WORKSPACE_FILE_NOT_FOUND")
          expect(readObservation).not.toContain("FRONTEND_ACTION_SECRET")
          return nativeResult("stop", "delegated blocked")
        }

        const delegatedObservation = toolObservation(messages, "delegate-runtime")
        if (!delegatedObservation) {
          return nativeResult("tool_calls", "delegating", [{
            id: "delegate-runtime",
            name: "agent_call",
            arguments: {
              agentId: "runtime",
              request: "Read frontend-actions/use-item/run.js",
              historyMode: "minimal",
            },
          }])
        }
        expect(delegatedObservation).toContain("delegated blocked")
        return nativeResult("stop", "assistant received safe result")
      },
    )

    await expect(runAssistantChat({
      message: "Ask the runtime Agent to inspect the action",
      sessionId: "session-2",
    })).resolves.toMatchObject({ replyText: "assistant received safe result" })
  })
})
