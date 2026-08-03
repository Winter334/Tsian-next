import { describe, expect, it } from "vitest"
import { buildEnabledToolSchemas } from "../tool-schemas"
import { acceptToolObservationForAgent } from "./observations"
import {
  deliverWorkspaceOperationResultToAgent,
  MAX_AGENT_SEARCH_CONTEXT_LINES,
  MAX_AGENT_SEARCH_DELIVERY_CHARS,
  MAX_AGENT_SEARCH_MATCHES_PER_FILE,
  MAX_AGENT_SEARCH_SNIPPET_CHARS,
  workspaceOperationRequestFromAgentTool,
} from "./workspace-delivery"

describe("Agent workspace Tool delivery", () => {
  it("delivers an exact bounded list page", () => {
    const entries = Array.from({ length: 120 }, (_, index) => ({
      path: `docs/${index}.md`,
      name: `${index}.md`,
      kind: "file",
    }))
    const call = { name: "list", arguments: { path: "docs", offset: 50, limit: 20 } }
    const delivered = deliverWorkspaceOperationResultToAgent(call, {
      path: "docs",
      entries,
    }) as Record<string, unknown>

    expect((delivered.entries as unknown[])).toHaveLength(20)
    expect(delivered).toMatchObject({
      offset: 50,
      limit: 20,
      totalEntries: 120,
      returnedEntries: 20,
      truncated: true,
      nextOffset: 70,
    })
  })

  it("uses one search look-ahead file and reports bounded omissions honestly", () => {
    const call = {
      name: "search",
      arguments: { query: "needle", path: "docs", contextLines: 10_000 },
    }
    expect(workspaceOperationRequestFromAgentTool(call)).toMatchObject({
      contextLines: MAX_AGENT_SEARCH_CONTEXT_LINES,
      limit: 11,
    })
    const source = Array.from({ length: 11 }, (_, fileIndex) => ({
      path: `docs/${fileIndex}.md`,
      name: `${fileIndex}.md`,
      updatedAt: fileIndex,
      score: 1,
      preview: "p".repeat(1_000),
      matches: Array.from({ length: 8 }, (_, matchIndex) => ({
        lineNumber: matchIndex + 1,
        line: "l".repeat(1_000),
        match: "needle",
        contextBefore: ["before".repeat(200), "older"],
        contextAfter: ["after".repeat(200), "later"],
      })),
      matchesTruncated: true,
    }))

    const delivered = deliverWorkspaceOperationResultToAgent(call, source) as Record<string, unknown>
    const items = delivered.items as Array<Record<string, unknown>>
    const first = items[0]!
    expect(items.length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(10)
    expect(delivered).toMatchObject({ fileLimit: 10, hasMoreFiles: true })
    expect(delivered.returnedFiles).toBe(items.length)
    expect(JSON.stringify(delivered).length).toBeLessThanOrEqual(MAX_AGENT_SEARCH_DELIVERY_CHARS)
    expect(acceptToolObservationForAgent(
      call,
      { index: 0, name: "search", ok: true, result: delivered },
    ).ok).toBe(true)
    expect(first.matches).toHaveLength(MAX_AGENT_SEARCH_MATCHES_PER_FILE)
    expect(first).toMatchObject({
      returnedMatches: MAX_AGENT_SEARCH_MATCHES_PER_FILE,
      matchesTruncated: true,
      omittedMatchesAtLeast: 4,
      previewTruncated: true,
    })
    expect(((first.matches as Array<Record<string, string>>)[0]!.line)).toHaveLength(
      MAX_AGENT_SEARCH_SNIPPET_CHARS,
    )
    expect(delivered).not.toHaveProperty("totalFiles")
  })

  it("omits large diff bodies and points back to authoritative read", () => {
    const call = { name: "diff", arguments: { path: "docs/large.md", expectedContent: "next" } }
    const delivered = deliverWorkspaceOperationResultToAgent(call, {
      path: "docs/large.md",
      scope: "card-content",
      currentContent: "a".repeat(10_000),
      nextContent: "b".repeat(10_000),
      changed: true,
      currentSize: 10_000,
      nextSize: 10_000,
    }) as Record<string, unknown>

    expect(delivered).toMatchObject({
      path: "docs/large.md",
      changed: true,
      contentOmitted: true,
      continuation: { operation: "read", path: "docs/large.md", charOffset: 0 },
    })
    expect(delivered).not.toHaveProperty("currentContent")
    expect(delivered).not.toHaveProperty("nextContent")
  })

  it("returns mutation metadata without file bodies and bounds path samples", () => {
    const write = deliverWorkspaceOperationResultToAgent(
      { name: "write", arguments: { path: "save/state.json", content: "secret" } },
      {
        path: "save/state.json",
        scope: "save-runtime",
        changed: true,
        file: {
          path: "save/state.json",
          content: "secret",
          createdAt: 1,
          updatedAt: 2,
        },
      },
    ) as Record<string, unknown>
    expect(write).not.toHaveProperty("file.content")
    expect(write).toMatchObject({ file: { path: "save/state.json", size: 6 } })

    const copiedPaths = Array.from({ length: 30 }, (_, index) => `save/copy/${index}.json`)
    const copy = deliverWorkspaceOperationResultToAgent(
      { name: "copy", arguments: { path: "save/source", targetPath: "save/copy" } },
      {
        fromScope: "save-runtime",
        toScope: "save-runtime",
        fromPath: "save/source",
        toPath: "save/copy",
        copiedPaths,
      },
    ) as Record<string, unknown>
    expect(copy).toMatchObject({
      copiedCount: 30,
      pathsTruncated: true,
      omittedPaths: 10,
      targetRoot: "save/copy",
    })
    expect(copy.copiedPaths).toHaveLength(20)
  })

  it("bounds glob at the Agent producer and provides narrowing guidance", () => {
    const call = { name: "glob", arguments: { pattern: "**/*.md", limit: 500 } }
    expect(workspaceOperationRequestFromAgentTool(call).limit).toBe(50)
    const delivered = deliverWorkspaceOperationResultToAgent(call, {
      scope: "effective",
      pattern: "**/*.md",
      matches: ["a.md"],
      truncated: true,
    }) as Record<string, unknown>
    expect(delivered).toMatchObject({
      returnedMatches: 1,
      continuation: { hint: expect.stringContaining("Narrow") },
    })
  })

  it("keeps search and glob schemas aligned with Agent producer caps", () => {
    const schemas = buildEnabledToolSchemas({
      enabledPlatformTools: ["workspace_read"],
      allowAgentCall: false,
      visibleContacts: [],
    })
    const search = schemas.find((schema) => schema.name === "search")
    const glob = schemas.find((schema) => schema.name === "glob")
    const searchProperties = search?.parameters.properties as
      | Record<string, Record<string, unknown>>
      | undefined
    const globProperties = glob?.parameters.properties as
      | Record<string, Record<string, unknown>>
      | undefined

    expect(searchProperties?.contextLines).toMatchObject({
      minimum: 0,
      maximum: MAX_AGENT_SEARCH_CONTEXT_LINES,
    })
    expect(globProperties?.limit).toMatchObject({
      minimum: 1,
      maximum: 50,
    })
  })
})
