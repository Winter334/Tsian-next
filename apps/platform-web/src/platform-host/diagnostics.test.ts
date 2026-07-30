import type { DiagnosticRecordSummary } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import { buildDiagnosticFacets, buildDiagnosticOverview } from "./diagnostics"

function aiSummary(
  id: string,
  timestamp: number,
  overrides: Partial<DiagnosticRecordSummary> = {},
): DiagnosticRecordSummary {
  return {
    id,
    recordType: "ai-request",
    timestamp,
    updatedAt: timestamp,
    sizeBytes: 100,
    status: "succeeded",
    provider: "openai",
    model: "gpt-test",
    retryCount: 0,
    usage: { input: 10, output: 5, total: 15, cached: 4 },
    ...overrides,
  }
}

describe("diagnostic monitor aggregates", () => {
  it("derives facets, usage, provider stats, retries, and the latest failure from unified summaries", () => {
    const summaries: DiagnosticRecordSummary[] = [
      aiSummary("success", 10),
      aiSummary("failed", 20, {
        status: "failed",
        provider: "anthropic",
        model: "claude-test",
        retryCount: 1,
      }),
      {
        id: "frontend",
        recordType: "frontend-error",
        timestamp: 30,
        updatedAt: 30,
        sizeBytes: 100,
        message: "broken",
      },
    ]

    const facets = buildDiagnosticFacets(summaries)
    const overview = buildDiagnosticOverview(summaries)
    expect(facets.providers).toEqual(["anthropic", "openai"])
    expect(facets.models).toEqual(["claude-test", "gpt-test"])
    expect(overview).toMatchObject({
      totalRecords: 3,
      aiRequestCount: 2,
      frontendErrorCount: 1,
      succeededCount: 1,
      failedCount: 1,
      retriedRequestCount: 1,
      latestFailureId: "frontend",
      usage: { input: 20, output: 10, total: 30, cached: 8 },
    })
    expect(overview.providers).toHaveLength(2)
  })
})
