import type { WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import { executeWorkspaceOperation } from "./workspace-operations"
import {
  deliverWorkspaceOperationResultToAgent,
  MAX_AGENT_READ_CONTENT_CHARS,
  workspaceOperationRequestFromAgentTool,
} from "./workspace-tools/workspace-delivery"

function file(path: string, content: string): WorkspaceFile {
  return { path, content, createdAt: 1, updatedAt: 1 }
}

const files = [
  file("docs/a.md", "shared needle"),
  file("docs/nested/b.md", "nested needle"),
  file("other/c.md", "sibling needle"),
  file("docs/huge.txt", `prefix\n${"x".repeat(100_000)}`),
  file(".tsian/local/diagnostics/requests/private.json", "needle diagnostic body"),
]

describe("workspace retrieval boundaries", () => {
  it("scopes ordinary search to a normalized directory root", async () => {
    const result = await executeWorkspaceOperation(
      { operation: "search", path: "docs", query: "needle" },
      { workspaceFiles: files, actorLevel: 4 },
    ) as Array<{ path: string }>
    expect(result.map((item) => item.path)).toEqual(["docs/a.md", "docs/nested/b.md"])
  })

  it("never exposes built-in diagnostics through ordinary search", async () => {
    const result = await executeWorkspaceOperation(
      { operation: "search", query: "diagnostic body" },
      { workspaceFiles: files, actorLevel: 4 },
    ) as Array<{ path: string }>
    expect(result).toEqual([])
  })

  it("reads a recoverable character range and rejects mixed range modes", async () => {
    const result = await executeWorkspaceOperation(
      { operation: "read", path: "docs/a.md", charOffset: 7, charLimit: 6 },
      { workspaceFiles: files, actorLevel: 4 },
    ) as Record<string, unknown>
    expect(result).toMatchObject({
      content: "needle",
      totalChars: 13,
      returnedChars: 6,
      charOffset: 7,
    })
    await expect(executeWorkspaceOperation(
      { operation: "read", path: "docs/a.md", offset: 1, charOffset: 0 },
      { workspaceFiles: files, actorLevel: 4 },
    )).rejects.toMatchObject({ code: "WORKSPACE_READ_RANGE_MUTEX" })
  })

  it("keeps the shared no-range read complete for direct consumers", async () => {
    const result = await executeWorkspaceOperation(
      { operation: "read", path: "docs/huge.txt" },
      { workspaceFiles: files, actorLevel: 4 },
    ) as Record<string, unknown>
    expect((result.content as string).length).toBe(100_007)
    expect(result.truncated).toBe(false)
  })

  it("keeps an exact character continuation when an Agent line range is capped", async () => {
    const call = { name: "read", arguments: { path: "docs/huge.txt", offset: 2, limit: 1 } }
    const raw = await executeWorkspaceOperation(
      workspaceOperationRequestFromAgentTool(call),
      { workspaceFiles: files, actorLevel: 4 },
    ) as Record<string, unknown>
    expect(raw.charOffset).toBe(7)
    const delivered = deliverWorkspaceOperationResultToAgent(call, raw) as Record<string, unknown>
    expect((delivered.content as string).length).toBe(MAX_AGENT_READ_CONTENT_CHARS)
    expect(delivered.nextCharOffset).toBe(7 + MAX_AGENT_READ_CONTENT_CHARS)
    expect(delivered.totalChars).toBe(100_007)
  })

  it("bounds an Agent no-range read before the shared operation returns", async () => {
    const call = { name: "read", arguments: { path: "docs/huge.txt" } }
    const raw = await executeWorkspaceOperation(
      workspaceOperationRequestFromAgentTool(call),
      { workspaceFiles: files, actorLevel: 4 },
    )
    const delivered = deliverWorkspaceOperationResultToAgent(call, raw) as Record<string, unknown>
    expect((delivered.content as string).length).toBe(MAX_AGENT_READ_CONTENT_CHARS)
    expect(delivered.nextCharOffset).toBe(MAX_AGENT_READ_CONTENT_CHARS)
    expect(delivered.totalChars).toBe(100_007)
  })
})
