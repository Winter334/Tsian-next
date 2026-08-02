import { describe, expect, it } from "vitest"
import {
  buildToolPresentation,
  MAX_AGENT_OBSERVATION_CHAR_BUDGET,
  MAX_AGENT_READ_CONTENT_CHARS,
  MAX_UI_AGENT_CALL_RESPONSE_CHARS,
  projectToolObservationForAgent,
} from "./observations"

describe("Agent tool observation projection", () => {
  it("enforces a valid-JSON aggregate cap for pathological search results", () => {
    const result = Array.from({ length: 50 }, (_, fileIndex) => ({
      path: `docs/file-${fileIndex}.md`,
      name: `file-${fileIndex}.md`,
      updatedAt: fileIndex,
      score: 1,
      preview: "x".repeat(2_000),
      matches: Array.from({ length: 50 }, (_, matchIndex) => ({
        lineNumber: matchIndex + 1,
        line: "needle ".repeat(1_000),
        match: "needle",
        contextBefore: ["before".repeat(1_000)],
        contextAfter: ["after".repeat(1_000)],
      })),
      matchesTruncated: false,
    }))
    const projected = projectToolObservationForAgent(
      { name: "search", arguments: { query: "needle", path: "docs" } },
      { index: 0, name: "search", ok: true, result },
    )
    const json = JSON.stringify(projected)
    expect(() => JSON.parse(json)).not.toThrow()
    expect(json.length).toBeLessThanOrEqual(MAX_AGENT_OBSERVATION_CHAR_BUDGET)
    expect(json).toContain("truncated")
    expect(json).toContain("docs/file-0.md")
  })

  it("provides a character continuation for a huge single-line read", () => {
    const projected = projectToolObservationForAgent(
      { name: "read", arguments: { path: "docs/huge.txt" } },
      {
        index: 0,
        name: "read",
        ok: true,
        result: { path: "docs/huge.txt", content: "a".repeat(100_000), truncated: false },
      },
    )
    const result = projected.result as Record<string, unknown>
    expect((result.content as string).length).toBe(MAX_AGENT_READ_CONTENT_CHARS)
    expect(result.nextCharOffset).toBe(MAX_AGENT_READ_CONTENT_CHARS)
    expect(result.totalChars).toBe(100_000)
    expect(JSON.stringify(projected).length).toBeLessThanOrEqual(MAX_AGENT_OBSERVATION_CHAR_BUDGET)
  })

  it("emits UI payload only for agent_call and bounds its response", () => {
    expect(buildToolPresentation(
      { name: "read", arguments: { path: "x" } },
      { index: 0, name: "read", ok: true, result: { content: "secret" } },
    )).toBeUndefined()

    const presentation = buildToolPresentation(
      { name: "agent_call", arguments: { agentId: "worker" } },
      {
        index: 0,
        name: "agent_call",
        ok: true,
        result: {
          targetAgent: { id: "worker", title: "Worker" },
          response: "r".repeat(20_000),
        },
      },
    )
    expect(presentation?.response).toHaveLength(MAX_UI_AGENT_CALL_RESPONSE_CHARS)
    expect(presentation?.responseTruncated).toBe(true)
  })

  it("normalizes circular and exceptional values into bounded valid JSON", () => {
    const circular: Record<string, unknown> = { nested: { value: "x".repeat(10_000) } }
    circular.self = circular
    const projected = projectToolObservationForAgent(
      { name: "run_script", arguments: {} },
      { index: 0, name: "run_script", ok: true, result: circular },
      512,
    )
    const json = JSON.stringify(projected)
    expect(() => JSON.parse(json)).not.toThrow()
    expect(json.length).toBeLessThanOrEqual(512)
    expect(json).toContain("truncatedForModel")
  })
})
