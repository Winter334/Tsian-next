import "fake-indexeddb/auto"
import type { DiagnosticAiRequestRecord } from "@tsian/contracts"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { localDb } from "../storage/db"
import { prepareDiagnosticRecord } from "../storage/diagnostic-records"
import { createDiagnosticsQueryRunner } from "./diagnostics-query"

function record(index: number): DiagnosticAiRequestRecord {
  const timestamp = Date.now() + index
  return prepareDiagnosticRecord({
    id: `request-${index}`,
    requestId: `request-${index}`,
    operationId: `operation-${Math.floor(index / 2)}`,
    sequence: index,
    recordType: "ai-request",
    timestamp,
    updatedAt: timestamp,
    schemaVersion: 1,
    sizeBytes: 0,
    status: "succeeded",
    provider: "test-provider",
    model: "test-model",
    endpoint: "https://example.test",
    streaming: false,
    request: {
      messages: [{ role: "user", content: `shared-keyword ${"body ".repeat(10_000)}` }],
    },
    response: { text: "ok" },
    attempts: [],
  }) as DiagnosticAiRequestRecord
}

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
  await localDb.diagnosticRecords.bulkPut(Array.from({ length: 50 }, (_, index) => record(index)))
})

afterEach(async () => {
  await localDb.delete()
})

describe("query_diagnostics controlled runner", () => {
  it("returns bounded snippets and record continuations for a large corpus", async () => {
    const runner = createDiagnosticsQueryRunner()
    const result = await runner({ operation: "search", query: "shared-keyword", limit: 20 }) as {
      items: Array<{ id: string; snippets: string[] }>
      truncated: boolean
    }
    expect(result.items).toHaveLength(20)
    expect(result.truncated).toBe(true)
    expect(result.items.every((item) => item.id && item.snippets.length <= 3)).toBe(true)
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(30 * 1024)
  })

  it("bounds oversized summary fields before returning list results", async () => {
    const oversized = record(100)
    oversized.error = { type: "error", message: "failure ".repeat(20_000) }
    await localDb.diagnosticRecords.put(prepareDiagnosticRecord(oversized))
    const runner = createDiagnosticsQueryRunner()
    const result = await runner({ operation: "list", limit: 20 }) as {
      items: Array<{ message?: string }>
    }
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(30 * 1024)
    expect(result.items[0]?.message?.length).toBeLessThanOrEqual(320)
  })

  it("pages an explicitly selected request section", async () => {
    const runner = createDiagnosticsQueryRunner()
    const result = await runner({
      operation: "read",
      id: "request-1",
      section: "request",
      offset: 0,
      limit: 50_000,
    }) as Record<string, unknown>
    expect((result.content as string).length).toBe(16 * 1024)
    expect(result.truncated).toBe(true)
    expect(result.nextOffset).toBe(16 * 1024)
    expect(result.id).toBe("request-1")
  })
})
