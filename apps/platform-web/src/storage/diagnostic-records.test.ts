import "fake-indexeddb/auto"
import type { DiagnosticAiRequestRecord, DiagnosticFrontendErrorRecord } from "@tsian/contracts"
import Dexie from "dexie"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { localDb, TsianLocalDb } from "./db"
import {
  getDiagnosticRecord,
  getDiagnosticRelationClosure,
  initializeDiagnosticRecords,
  prepareDiagnosticRecord,
  pruneDiagnosticRecords,
  putDiagnosticRecord,
  queryDiagnosticRecords,
  queryDiagnosticRecordSummaries,
  sanitizeDiagnosticValue,
  updateDiagnosticRecord,
} from "./diagnostic-records"

const BASE_TIME = Date.now()

function aiRecord(overrides: Partial<DiagnosticAiRequestRecord> = {}): DiagnosticAiRequestRecord {
  return {
    id: "request-1",
    recordType: "ai-request",
    requestId: "request-1",
    operationId: "operation-1",
    sequence: 1,
    timestamp: BASE_TIME,
    updatedAt: BASE_TIME,
    schemaVersion: 1,
    sizeBytes: 0,
    status: "succeeded",
    provider: "openai-compatible",
    model: "model",
    endpoint: "https://example.test/chat/completions",
    streaming: false,
    request: { messages: [{ role: "user", content: "full request text" }] },
    response: { text: "full response text", finishReason: "stop" },
    attempts: [],
    ...overrides,
  }
}

function frontendRecord(id: string, timestamp: number, message = "failure"): DiagnosticFrontendErrorRecord {
  return {
    id,
    errorId: id,
    recordType: "frontend-error",
    kind: "runtime-error",
    timestamp,
    updatedAt: timestamp,
    schemaVersion: 1,
    sizeBytes: 0,
    message,
  }
}

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
})

afterEach(async () => {
  await localDb.delete()
})

describe("diagnostic record storage", () => {
  it("round-trips union records, paginates newest first, and resolves relationships", async () => {
    await putDiagnosticRecord(aiRecord())
    await putDiagnosticRecord(aiRecord({
      id: "request-2",
      requestId: "request-2",
      parentRequestId: "request-1",
      previousRequestId: "request-1",
      sequence: 2,
      timestamp: BASE_TIME + 1,
      updatedAt: BASE_TIME + 1,
    }))
    await putDiagnosticRecord(frontendRecord("frontend-1", BASE_TIME + 2))

    expect((await getDiagnosticRecord("request-1"))?.sizeBytes).toBeGreaterThan(0)
    const page = await queryDiagnosticRecords({ offset: 0, limit: 2 })
    expect(page.items.map((record) => record.id)).toEqual(["frontend-1", "request-2"])
    expect(page.hasMore).toBe(true)
    expect((await queryDiagnosticRecordSummaries({ recordType: "ai-request" })).items[0])
      .toMatchObject({ id: "request-2", provider: "openai-compatible", operationId: "operation-1" })
    expect((await getDiagnosticRelationClosure("request-2")).map((record) => record.id))
      .toEqual(["request-1", "request-2"])
  })

  it("recursively removes credentials and replaces inline binary data before persistence", async () => {
    const sanitized = sanitizeDiagnosticValue({
      Authorization: "Bearer secret",
      nested: {
        api_key: "secret",
        headers: [["X-Auth-Token", "tuple-secret"], ["Accept", "application/json"]],
        url: "https://user:pass@example.test/path?key=secret&safe=yes",
        image: "data:image/png;base64,AAAA",
        untypedImage: "data:;base64,AAAA",
        inlineData: { mimeType: "image/png", data: "AAAA" },
        text: "complete conversation text",
      },
    }) as Record<string, unknown>

    expect(sanitized).not.toHaveProperty("Authorization")
    expect(sanitized.nested).not.toHaveProperty("api_key")
    expect(JSON.stringify(sanitized)).not.toContain("secret")
    expect(JSON.stringify(sanitized)).not.toContain("user:pass")
    expect(JSON.stringify(sanitized)).not.toContain("tuple-secret")
    expect(JSON.stringify(sanitized)).toContain("complete conversation text")
    expect(JSON.stringify(sanitized)).toContain("encodedBytes")

    await putDiagnosticRecord(aiRecord({
      request: {
        messages: [{ role: "user", content: "complete conversation text" }],
        headers: { Authorization: "Bearer persisted-secret" },
        body: { image: "data:image/png;base64,AAAA" },
      },
    }))
    const persisted = await getDiagnosticRecord("request-1")
    expect(JSON.stringify(persisted)).not.toContain("persisted-secret")
    expect(JSON.stringify(persisted)).toContain("encodedBytes")
  })

  it("expires oldest completed records by age/size while preserving running requests", async () => {
    const now = 10_000
    await localDb.diagnosticRecords.bulkPut([
      prepareDiagnosticRecord(frontendRecord("old", 1_000, "x".repeat(200))),
      prepareDiagnosticRecord(frontendRecord("new", 9_000, "x".repeat(200))),
      prepareDiagnosticRecord(aiRecord({
        id: "running",
        requestId: "running",
        status: "running",
        timestamp: 500,
        updatedAt: 500,
      })),
    ])

    await pruneDiagnosticRecords({ now, maxAgeMs: 5_000, maxBytes: 1 })
    expect(await localDb.diagnosticRecords.get("old")).toBeUndefined()
    expect(await localDb.diagnosticRecords.get("new")).toBeUndefined()
    expect((await localDb.diagnosticRecords.get("running"))?.recordType).toBe("ai-request")

    await updateDiagnosticRecord("running", { status: "succeeded", updatedAt: now })
    await pruneDiagnosticRecords({ now, maxAgeMs: 20_000, maxBytes: 1 })
    expect(await localDb.diagnosticRecords.get("running")).toBeUndefined()
  })

  it("marks abandoned running requests interrupted on startup", async () => {
    await localDb.diagnosticRecords.put(prepareDiagnosticRecord(aiRecord({ status: "running" })))
    await initializeDiagnosticRecords(BASE_TIME + 4_000)
    const restored = await localDb.diagnosticRecords.get("request-1") as DiagnosticAiRequestRecord
    expect(restored.status).toBe("interrupted")
    expect(restored.durationMs).toBe(4_000)
    expect(restored.error?.type).toBe("interrupted")
  })
})

describe("diagnostic Dexie schema upgrade", () => {
  it("adds the table without clearing existing stores", async () => {
    const name = `tsian-diagnostic-upgrade-${Date.now()}-${Math.random()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({
      meta: "&key",
      gameCards: "&id, source, updatedAt",
      gameCardContentFiles: "&id, gameCardId, path, updatedAt",
      gameCardFrontendFiles: "&id, gameCardId, path, updatedAt",
      saves: "&id, updatedAt",
      checkpoints: "&id, saveId, createdAt, turn",
      workspaceFiles: "&id, saveId, path, updatedAt",
      blobs: "&[hash+ownerSaveId], ownerSaveId",
      assistantAttachments: "&id, sessionId, path, createdAt",
      skillConfigs: "&skillPath, updatedAt",
      embeddingIndex: "&id, [scope+ownerId], path, type, updatedAt",
    })
    await legacy.open()
    await legacy.table("meta").put({ key: "preserved", value: "yes" })
    legacy.close()

    const upgraded = new TsianLocalDb(name)
    await upgraded.open()
    expect(await upgraded.meta.get("preserved")).toEqual({ key: "preserved", value: "yes" })
    await upgraded.diagnosticRecords.put(prepareDiagnosticRecord(frontendRecord("upgrade-error", 1)))
    expect(await upgraded.diagnosticRecords.get("upgrade-error")).toBeDefined()
    upgraded.close()
    await Dexie.delete(name)
  })
})
