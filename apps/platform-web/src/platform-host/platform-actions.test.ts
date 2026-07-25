import type { PlatformActionRequest } from "@tsian/contracts"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WORKSPACE_OPERATION_NAMES } from "../agent-runtime/workspace-operations-types"

const mocks = vi.hoisted(() => ({
  createCheckpointForSave: vi.fn(),
  deleteCheckpointForSave: vi.fn(),
  emitTurnDebugReady: vi.fn(),
  executeWorkspaceOperationForActiveSave: vi.fn(),
  getActiveSaveId: vi.fn(),
  getFrontendDebugSession: vi.fn(),
  listCheckpointsForSave: vi.fn(),
  listEffectiveWorkspaceFilesForActiveSave: vi.fn(),
  overwriteCheckpointForSave: vi.fn(),
  projectAssistantReply: vi.fn(),
  resolveLocalAssistantActorLevel: vi.fn(),
  restoreCheckpointForSave: vi.fn(),
  updateCheckpointForSave: vi.fn(),
}))

vi.mock("../debug-events", () => ({
  emitTurnDebugReady: mocks.emitTurnDebugReady,
}))

vi.mock("../storage", () => ({
  createCheckpointForSave: mocks.createCheckpointForSave,
  deleteCheckpointForSave: mocks.deleteCheckpointForSave,
  getActiveSaveId: mocks.getActiveSaveId,
  getFrontendDebugSession: mocks.getFrontendDebugSession,
  listCheckpointsForSave: mocks.listCheckpointsForSave,
  overwriteCheckpointForSave: mocks.overwriteCheckpointForSave,
  restoreCheckpointForSave: mocks.restoreCheckpointForSave,
  updateCheckpointForSave: mocks.updateCheckpointForSave,
  WorkspaceStorageError: class WorkspaceStorageError extends Error {
    code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

vi.mock("./internal", () => ({
  isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  },
  listEffectiveWorkspaceFilesForActiveSave: mocks.listEffectiveWorkspaceFilesForActiveSave,
}))

vi.mock("./reply-projection", () => ({
  projectAssistantReply: mocks.projectAssistantReply,
}))

vi.mock("./local-assistant", () => ({
  resolveLocalAssistantActorLevel: mocks.resolveLocalAssistantActorLevel,
}))

vi.mock("./workspace-actions", () => ({
  executeWorkspaceOperationForActiveSave: mocks.executeWorkspaceOperationForActiveSave,
  normalizeWorkspaceActionRequest(request: PlatformActionRequest) {
    if (!request.action.startsWith("workspace.")) {
      return null
    }
    return {
      ...request.params,
      operation: request.action.slice("workspace.".length),
      scope: request.params?.scope ?? "effective",
    }
  },
}))

import {
  executePlatformAction,
  executePlatformActionForPlayFrontend,
} from "./platform-actions"

const allowedRequests: PlatformActionRequest[] = [
  { action: "reply-project", params: { text: "hello" } },
  { action: "restore-checkpoint", params: { checkpointId: "checkpoint-1" } },
  { action: "create-checkpoint", params: {} },
  { action: "update-checkpoint", params: { checkpointId: "checkpoint-1" } },
  { action: "overwrite-checkpoint", params: { checkpointId: "checkpoint-1" } },
  { action: "delete-checkpoint", params: { checkpointId: "checkpoint-1" } },
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getActiveSaveId.mockResolvedValue("save-1")
  mocks.getFrontendDebugSession.mockResolvedValue({ status: "missing" })
  mocks.listCheckpointsForSave.mockResolvedValue([])
  mocks.listEffectiveWorkspaceFilesForActiveSave.mockResolvedValue([])
  mocks.projectAssistantReply.mockReturnValue({ content: "hello" })
  mocks.restoreCheckpointForSave.mockResolvedValue({ id: "checkpoint-1", turn: 1 })
  mocks.createCheckpointForSave.mockResolvedValue({ id: "checkpoint-1", turn: 1 })
  mocks.updateCheckpointForSave.mockResolvedValue({ id: "checkpoint-1", turn: 1 })
  mocks.overwriteCheckpointForSave.mockResolvedValue({ id: "checkpoint-1", turn: 1 })
  mocks.deleteCheckpointForSave.mockResolvedValue("deleted")
  mocks.resolveLocalAssistantActorLevel.mockResolvedValue(4)
  mocks.executeWorkspaceOperationForActiveSave.mockResolvedValue({ path: "docs/readme.md" })
})

describe("play-frontend platform action isolation", () => {
  it.each(allowedRequests)("allows the audited semantic action $action", async (request) => {
    const result = await executePlatformActionForPlayFrontend(request)

    expect(result.ok).toBe(true)
    expect(mocks.resolveLocalAssistantActorLevel).not.toHaveBeenCalled()
    expect(mocks.executeWorkspaceOperationForActiveSave).not.toHaveBeenCalled()
  })

  it.each([
    ...Object.values(WORKSPACE_OPERATION_NAMES).map((operation) => `workspace.${operation}`),
    "unknown-action",
    "future-platform-action",
  ])("rejects %s before local assistant privilege resolution", async (action) => {
    const result = await executePlatformActionForPlayFrontend({
      action,
      params: {
        actorLevel: 4,
        caller: "trusted",
        scope: "platform-meta",
        saveId: "forged-save",
        sessionId: "forged-session",
      },
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "PLATFORM_ACTION_FORBIDDEN",
        details: { action },
      },
    })
    expect(mocks.resolveLocalAssistantActorLevel).not.toHaveBeenCalled()
    expect(mocks.executeWorkspaceOperationForActiveSave).not.toHaveBeenCalled()
  })

  it("keeps trusted Workspace actions on the local assistant actor path", async () => {
    const result = await executePlatformAction({
      action: "workspace.read",
      params: {
        path: "docs/readme.md",
        actorLevel: 1,
        caller: "play-frontend",
        saveId: "forged-save",
      },
    })

    expect(result).toEqual({
      ok: true,
      item: { path: "docs/readme.md" },
    })
    expect(mocks.resolveLocalAssistantActorLevel).toHaveBeenCalledTimes(1)
    expect(mocks.executeWorkspaceOperationForActiveSave).toHaveBeenCalledWith(
      "save-1",
      expect.objectContaining({
        operation: "read",
        path: "docs/readme.md",
      }),
      { actorLevel: 4 },
    )
  })

  it("keeps the default trusted semantic behavior", async () => {
    const result = await executePlatformAction({
      action: "reply-project",
      params: { text: "hello" },
    })

    expect(result).toMatchObject({
      ok: true,
      item: { kind: "assistant", content: "hello" },
    })
  })
})
