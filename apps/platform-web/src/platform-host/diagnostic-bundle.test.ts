import type {
  DiagnosticAiRequestRecord,
  DiagnosticFrontendErrorRecord,
  DiagnosticRecord,
  DiagnosticRecordQuery,
} from "@tsian/contracts"
import { DIAGNOSTIC_RECORD_SCHEMA_VERSION } from "@tsian/contracts"
import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import {
  buildDiagnosticBundleFiles,
  DIAGNOSTIC_BUNDLE_RECORD_LIMIT,
  selectDiagnosticBundleRecords,
  zipDiagnosticBundleFiles,
} from "./diagnostic-bundle"

function aiRecord(
  id: string,
  timestamp: number,
  overrides: Partial<DiagnosticAiRequestRecord> = {},
): DiagnosticAiRequestRecord {
  return {
    id,
    requestId: id,
    recordType: "ai-request",
    timestamp,
    updatedAt: timestamp,
    schemaVersion: DIAGNOSTIC_RECORD_SCHEMA_VERSION,
    sizeBytes: 0,
    operationId: "operation-1",
    sequence: timestamp,
    status: "succeeded",
    provider: "openai",
    model: "gpt-test",
    endpoint: "https://api.example.test/v1/chat",
    streaming: false,
    request: { messages: [{ role: "user", content: `message-${id}` }] },
    response: {
      text: `response-${id}`,
      usage: { input: 10, output: 5, total: 15, cached: 4 },
    },
    attempts: [{
      attempt: 1,
      maxAttempts: 1,
      startedAt: timestamp,
      endedAt: timestamp + 1,
      status: "succeeded",
    }],
    durationMs: 1,
    ...overrides,
  }
}

function frontendError(id: string, timestamp: number): DiagnosticFrontendErrorRecord {
  return {
    id,
    errorId: id,
    recordType: "frontend-error",
    kind: "runtime-error",
    message: `error-${id}`,
    timestamp,
    updatedAt: timestamp,
    schemaVersion: DIAGNOSTIC_RECORD_SCHEMA_VERSION,
    sizeBytes: 0,
  }
}

function queryRecords(records: DiagnosticRecord[], query: DiagnosticRecordQuery): DiagnosticRecord[] {
  return records
    .filter((record) => !query.recordType || record.recordType === query.recordType)
    .filter((record) => query.toTimestamp === undefined || record.timestamp <= query.toTimestamp)
    .filter((record) => record.recordType !== "ai-request" || !query.status || record.status === query.status)
    .sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id))
    .slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 50))
}

describe("diagnostic bundle", () => {
  it("selects 50 records from the failure anchor backwards and adds its relation closure", async () => {
    const anchor = aiRecord("anchor", 100, { status: "failed" })
    const relatedNewer = aiRecord("related-newer", 120, {
      parentRequestId: anchor.id,
      status: "failed",
    })
    const unrelatedNewer = frontendError("unrelated-newer", 130)
    const older = Array.from({ length: 60 }, (_, index) =>
      frontendError(`older-${index.toString().padStart(2, "0")}`, 99 - index))
    const records: DiagnosticRecord[] = [unrelatedNewer, relatedNewer, anchor, ...older]

    const selection = await selectDiagnosticBundleRecords(anchor.id, {
      async getRecord(id) {
        return records.find((record) => record.id === id)
      },
      async query(query) {
        const items = queryRecords(records, query)
        return {
          items,
          offset: query.offset ?? 0,
          limit: query.limit ?? 50,
          hasMore: false,
        }
      },
      async relationClosure() {
        return [anchor, relatedNewer]
      },
    })

    expect(selection.anchor.id).toBe("anchor")
    expect(selection.records).toHaveLength(DIAGNOSTIC_BUNDLE_RECORD_LIMIT + 1)
    expect(selection.records.map((record) => record.id)).toContain("related-newer")
    expect(selection.records.map((record) => record.id)).not.toContain("unrelated-newer")
    expect(selection.records.map((record) => record.id)).not.toContain("older-49")
  })

  it("fails clearly when no failure anchor exists", async () => {
    const records = [aiRecord("success", 1)]
    await expect(selectDiagnosticBundleRecords(undefined, {
      async getRecord() { return undefined },
      async query(query) {
        return { items: queryRecords(records, query), offset: 0, limit: 1, hasMore: false }
      },
      async relationClosure() { return [] },
    })).rejects.toThrow("没有可作为诊断包锚点")
  })

  it("prefers a selected failure and otherwise anchors the latest failure", async () => {
    const selectedFailure = aiRecord("selected-failure", 10, { status: "failed" })
    const latestFailure = frontendError("latest-failure", 30)
    const success = aiRecord("success", 40)
    const records: DiagnosticRecord[] = [success, latestFailure, selectedFailure]
    const dependencies = {
      async getRecord(id: string) {
        return records.find((record) => record.id === id)
      },
      async query(query: DiagnosticRecordQuery) {
        const items = queryRecords(records, query)
        return { items, offset: query.offset ?? 0, limit: query.limit ?? 50, hasMore: false }
      },
      async relationClosure(anchorId: string) {
        return records.filter((record) => record.id === anchorId)
      },
    }

    expect((await selectDiagnosticBundleRecords(selectedFailure.id, dependencies)).anchor.id)
      .toBe(selectedFailure.id)
    expect((await selectDiagnosticBundleRecords(undefined, dependencies)).anchor.id)
      .toBe(latestFailure.id)
    expect((await selectDiagnosticBundleRecords(success.id, dependencies)).anchor.id)
      .toBe(latestFailure.id)
  })

  it("builds the stable zip layout with complete text and redacts credentials again", async () => {
    const anchor = aiRecord("request/secret", 100, {
      status: "failed",
      endpoint: "https://user:pass@example.test/v1?api_key=secret",
      parameters: { temperature: 0.7, apiKey: "do-not-export" },
      request: {
        messages: [{
          role: "user",
          content: "full request body\nAuthorization: Bearer message-secret\nCookie=sessionid=cookie-secret",
        }],
        headers: { Authorization: "Bearer secret" },
      },
      response: { text: "full response body\napi_key=response-secret" },
    })
    const files = buildDiagnosticBundleFiles({
      anchor,
      records: [anchor, frontendError("frontend-1", 90)],
      generatedAt: Date.parse("2026-07-30T10:00:00.000Z"),
      reproductionSteps: "1. Open the monitor\n2. Trigger the request with password=repro-secret",
      platform: {
        appVersion: "0.0.0",
        buildMode: "test",
        userAgent: "vitest",
        platform: "test",
        locale: "zh-CN",
        timezone: "Asia/Shanghai",
      },
    })

    expect(Object.keys(files)).toEqual([
      "configuration.json",
      "manifest.json",
      "platform.json",
      "records/frontend-errors/frontend-1.json",
      "records/index.jsonl",
      "records/requests/request_secret.json",
      "reproduction.md",
      "summary.md",
    ])
    expect(files["records/requests/request_secret.json"]).toContain("full request body")
    expect(files["records/requests/request_secret.json"]).toContain("full response body")
    expect(JSON.stringify(files)).not.toContain("do-not-export")
    expect(JSON.stringify(files)).not.toContain("Bearer secret")
    expect(JSON.stringify(files)).not.toContain("user:pass")
    expect(JSON.stringify(files)).not.toContain("api_key=secret")
    expect(JSON.stringify(files)).not.toContain("message-secret")
    expect(JSON.stringify(files)).not.toContain("cookie-secret")
    expect(JSON.stringify(files)).not.toContain("response-secret")
    expect(JSON.stringify(files)).not.toContain("repro-secret")

    const zip = zipDiagnosticBundleFiles(files)
    const entries = unzipSync(new Uint8Array(await zip.arrayBuffer()))
    expect(Object.keys(entries).sort()).toEqual(Object.keys(files))
    expect(strFromU8(entries["reproduction.md"])).toContain("Trigger the request")
  })
})
