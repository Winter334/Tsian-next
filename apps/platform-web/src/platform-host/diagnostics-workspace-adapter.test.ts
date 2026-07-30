import "fake-indexeddb/auto"
import type {
  DiagnosticAiRequestRecord,
  DiagnosticFrontendErrorRecord,
  DiagnosticRecord,
  WorkspaceFile,
  WorkspaceListResult,
  WorkspaceOperationRequest,
  WorkspaceReadResult,
  WorkspaceSearchResult,
} from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { executeWorkspaceOperation } from "../agent-runtime/workspace-operations"
import { localDb } from "../storage/db"
import {
  getDiagnosticRecord,
  putDiagnosticRecord,
  scanDiagnosticRecords,
} from "../storage/diagnostic-records"
import {
  createDiagnosticsWorkspaceAdapter,
  DIAGNOSTICS_FRONTEND_ERRORS_PATH,
  DIAGNOSTICS_INDEX_PATH,
  DIAGNOSTICS_REQUESTS_PATH,
  DIAGNOSTICS_WORKSPACE_ROOT,
} from "./diagnostics-workspace-adapter"

const BASE_TIME = 1_800_000_000_000

function aiRecord(
  id: string,
  timestamp = BASE_TIME,
  text = "full diagnostic request needle",
): DiagnosticAiRequestRecord {
  return {
    id,
    requestId: id,
    recordType: "ai-request",
    operationId: "operation-1",
    sequence: 1,
    timestamp,
    updatedAt: timestamp,
    schemaVersion: 1,
    sizeBytes: 0,
    status: "succeeded",
    provider: "openai-compatible",
    model: "model",
    endpoint: "https://example.test/chat/completions",
    streaming: false,
    request: { messages: [{ role: "user", content: text }] },
    response: { text: "complete response", finishReason: "stop" },
    attempts: [],
  }
}

function frontendRecord(id: string, timestamp = BASE_TIME + 1): DiagnosticFrontendErrorRecord {
  return {
    id,
    errorId: id,
    recordType: "frontend-error",
    kind: "runtime-error",
    timestamp,
    updatedAt: timestamp,
    schemaVersion: 1,
    sizeBytes: 0,
    message: "frontend exploded needle",
  }
}

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 2 }
}

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
})

afterEach(async () => {
  await localDb.delete()
})

describe("diagnostics workspace projection", () => {
  it("lists the virtual tree and pages the newest-first JSONL index", async () => {
    await putDiagnosticRecord(aiRecord("request-1"))
    await putDiagnosticRecord(frontendRecord("error-1"))
    const context = {
      workspaceFiles: [file(".tsian/local/assistant/agent.json", "{}")],
      actorLevel: 4,
      exposedOperations: ["list", "read"] as const,
      virtualReads: createDiagnosticsWorkspaceAdapter(),
    }

    const local = await executeWorkspaceOperation({
      operation: "list",
      scope: "effective",
      path: ".tsian/local",
    }, context) as WorkspaceListResult
    expect(local.entries.map((entry) => entry.path)).toEqual([
      ".tsian/local/assistant",
      DIAGNOSTICS_WORKSPACE_ROOT,
    ])

    const diagnostics = await executeWorkspaceOperation({
      operation: "list",
      scope: "platform-meta",
      path: DIAGNOSTICS_WORKSPACE_ROOT,
    }, context) as WorkspaceListResult
    expect(diagnostics.entries.map((entry) => entry.path)).toEqual([
      DIAGNOSTICS_FRONTEND_ERRORS_PATH,
      DIAGNOSTICS_REQUESTS_PATH,
      DIAGNOSTICS_INDEX_PATH,
    ])

    const first = await executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: DIAGNOSTICS_INDEX_PATH,
      offset: 1,
      limit: 1,
    }, context) as WorkspaceReadResult
    expect(JSON.parse(first.content)).toMatchObject({ id: "error-1", recordType: "frontend-error" })
    expect(first).toMatchObject({ returnedLines: 1, offset: 1, truncated: true })

    const second = await executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: DIAGNOSTICS_INDEX_PATH,
      offset: 2,
      limit: 1,
    }, context) as WorkspaceReadResult
    expect(JSON.parse(second.content)).toMatchObject({ id: "request-1", recordType: "ai-request" })
    expect(second.truncated).toBe(false)
  })

  it("reads one authoritative record by id and searches full diagnostic bodies", async () => {
    await putDiagnosticRecord(aiRecord("request-1"))
    await putDiagnosticRecord(frontendRecord("error-1"))
    const context = {
      workspaceFiles: [file("world/note.md", "ordinary needle")],
      actorLevel: 4,
      exposedOperations: ["read", "search"] as const,
      virtualReads: createDiagnosticsWorkspaceAdapter(),
    }

    const persisted = await getDiagnosticRecord("request-1")
    const request = await executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: `${DIAGNOSTICS_REQUESTS_PATH}/request-1.json`,
    }, context) as WorkspaceReadResult
    expect(JSON.parse(request.content)).toEqual(persisted)

    const error = await executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: `${DIAGNOSTICS_FRONTEND_ERRORS_PATH}/error-1.json`,
    }, context) as WorkspaceReadResult
    expect(JSON.parse(error.content)).toEqual(await getDiagnosticRecord("error-1"))

    const searched = await executeWorkspaceOperation({
      operation: "search",
      scope: "effective",
      query: "frontend exploded",
      limit: 5,
      contextLines: 1,
    }, context) as WorkspaceSearchResult[]
    expect(searched).toEqual([
      expect.objectContaining({
        path: `${DIAGNOSTICS_FRONTEND_ERRORS_PATH}/error-1.json`,
        matches: [expect.objectContaining({ line: expect.stringContaining("frontend exploded") })],
      }),
    ])
  })

  it("does not query diagnostics until a virtual path is explicitly read or searched", async () => {
    const record = aiRecord("lazy-request")
    const getRecord = vi.fn(async () => record as DiagnosticRecord)
    const querySummaries = vi.fn(async () => ({ items: [], hasMore: false }))
    const scanRecords = vi.fn(async () => [] as DiagnosticRecord[])
    const adapter = createDiagnosticsWorkspaceAdapter({ getRecord, querySummaries, scanRecords })

    expect(getRecord).not.toHaveBeenCalled()
    expect(querySummaries).not.toHaveBeenCalled()
    expect(scanRecords).not.toHaveBeenCalled()
    await adapter.list({ scope: "effective", path: ".tsian/local", actorLevel: 4 })
    expect(getRecord).not.toHaveBeenCalled()
    expect(querySummaries).not.toHaveBeenCalled()
    expect(scanRecords).not.toHaveBeenCalled()

    await adapter.read({
      scope: "effective",
      path: `${DIAGNOSTICS_REQUESTS_PATH}/lazy-request.json`,
      actorLevel: 4,
    })
    expect(getRecord).toHaveBeenCalledTimes(1)
    expect(querySummaries).not.toHaveBeenCalled()
    expect(scanRecords).not.toHaveBeenCalled()
  })

  it("keeps diagnostics invisible without the desktop-only adapter", async () => {
    await putDiagnosticRecord(aiRecord("request-1"))
    const collision = file(`${DIAGNOSTICS_REQUESTS_PATH}/request-1.json`, "snapshot collision")
    await expect(executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: `${DIAGNOSTICS_REQUESTS_PATH}/request-1.json`,
    }, {
      workspaceFiles: [collision],
      actorLevel: 4,
      exposedOperations: ["read"],
    })).rejects.toMatchObject({ code: "WORKSPACE_FILE_NOT_FOUND" })

    expect(await executeWorkspaceOperation({
      operation: "search",
      scope: "effective",
      query: "snapshot collision",
    }, {
      workspaceFiles: [collision],
      actorLevel: 4,
      exposedOperations: ["search"],
    })).toEqual([])

    await expect(executeWorkspaceOperation({
      operation: "write",
      path: `${DIAGNOSTICS_REQUESTS_PATH}/request-1.json`,
      content: "{}",
    }, {
      workspaceFiles: [],
      actorLevel: 4,
      exposedOperations: ["write"],
      mutations: {
        write: async () => file("never", ""),
        delete: async () => ({ scope: "platform-meta", deletedPaths: [] }),
      },
    })).rejects.toMatchObject({ code: "WORKSPACE_VIRTUAL_READ_ONLY" })
  })

  it("rejects every mutation touching diagnostics before calling storage", async () => {
    const write = vi.fn(async (input: { path: string; content?: string }) =>
      file(input.path, input.content ?? ""))
    const deletePath = vi.fn(async () => ({ scope: "platform-meta" as const, deletedPaths: [] }))
    const context = {
      workspaceFiles: [file("world/source.md", "source")],
      actorLevel: 4,
      exposedOperations: ["write", "edit", "copy", "move", "delete"] as const,
      virtualReads: createDiagnosticsWorkspaceAdapter(),
      mutations: { write, delete: deletePath },
    }
    const requests: WorkspaceOperationRequest[] = [
      { operation: "write", path: `${DIAGNOSTICS_REQUESTS_PATH}/new.json`, content: "{}" },
      {
        operation: "write",
        path: `safe/../../${DIAGNOSTICS_REQUESTS_PATH}\\traversed.json`,
        content: "{}",
      },
      { operation: "edit", path: DIAGNOSTICS_INDEX_PATH, oldString: "x", newString: "y" },
      { operation: "delete", path: DIAGNOSTICS_WORKSPACE_ROOT },
      { operation: "copy", path: `${DIAGNOSTICS_REQUESTS_PATH}/source.json`, targetPath: "world/copy.json" },
      { operation: "move", path: "world/source.md", targetPath: `${DIAGNOSTICS_REQUESTS_PATH}/moved.json` },
    ]
    for (const request of requests) {
      await expect(executeWorkspaceOperation(request, context)).rejects.toMatchObject({
        code: "WORKSPACE_VIRTUAL_READ_ONLY",
      })
    }
    expect(write).not.toHaveBeenCalled()
    expect(deletePath).not.toHaveBeenCalled()

    for (const path of [
      "world/real.md",
      "save/real.json",
      "frontend/src/real.ts",
      `${DIAGNOSTICS_WORKSPACE_ROOT}-notes/real.md`,
    ]) {
      await executeWorkspaceOperation({
        operation: "write",
        path,
        content: "still editable",
      }, context)
    }
    expect(write).toHaveBeenCalledTimes(4)
  })

  it("keeps the reserved namespace authoritative and hidden below platform-meta level", async () => {
    const record = aiRecord("request-1")
    const getRecord = vi.fn(async () => record as DiagnosticRecord)
    const querySummaries = vi.fn(async () => ({ items: [], hasMore: false }))
    const scanRecords = vi.fn(async () => [] as DiagnosticRecord[])
    const adapter = createDiagnosticsWorkspaceAdapter({ getRecord, querySummaries, scanRecords })
    const collision = file(`${DIAGNOSTICS_WORKSPACE_ROOT}/private-copy.json`, "not authoritative")

    const listed = await executeWorkspaceOperation({
      operation: "list",
      scope: "effective",
      path: DIAGNOSTICS_WORKSPACE_ROOT,
    }, {
      workspaceFiles: [collision],
      actorLevel: 4,
      exposedOperations: ["list", "read", "search"],
      virtualReads: adapter,
    }) as WorkspaceListResult
    expect(listed.entries.map((entry) => entry.path)).not.toContain(collision.path)

    await expect(executeWorkspaceOperation({
      operation: "read",
      scope: "effective",
      path: collision.path,
    }, {
      workspaceFiles: [collision],
      actorLevel: 4,
      exposedOperations: ["read"],
      virtualReads: adapter,
    })).rejects.toMatchObject({ code: "WORKSPACE_FILE_NOT_FOUND" })

    const lowPrivilegeContext = {
      workspaceFiles: [],
      actorLevel: 3,
      exposedOperations: ["list", "search"] as const,
      virtualReads: adapter,
    }
    expect(await executeWorkspaceOperation({
      operation: "list",
      scope: "effective",
      path: ".tsian/local",
    }, lowPrivilegeContext)).toEqual({ path: ".tsian/local", entries: [] })
    expect(await executeWorkspaceOperation({
      operation: "search",
      scope: "effective",
      query: "needle",
    }, lowPrivilegeContext)).toEqual([])
    expect(getRecord).not.toHaveBeenCalled()
    expect(querySummaries).not.toHaveBeenCalled()
    expect(scanRecords).not.toHaveBeenCalled()
  })

  it("stops the IndexedDB scan when the requested match limit is reached", async () => {
    await localDb.diagnosticRecords.bulkPut([
      aiRecord("request-1", BASE_TIME + 1),
      aiRecord("request-2", BASE_TIME + 2),
      aiRecord("request-3", BASE_TIME + 3),
    ])
    let inspected = 0
    const records = await scanDiagnosticRecords(() => {
      inspected += 1
      return true
    }, 1)
    expect(records).toHaveLength(1)
    expect(inspected).toBe(1)
  })
})
