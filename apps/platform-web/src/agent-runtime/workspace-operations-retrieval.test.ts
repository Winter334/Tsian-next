import type { WorkspaceFile } from "@tsian/contracts"
import { describe, expect, it } from "vitest"
import { executeWorkspaceOperation } from "./workspace-operations"
import { MAX_AGENT_READ_CONTENT_CHARS, projectToolObservationForAgent } from "./workspace-tools/observations"

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

  it("keeps an exact character continuation when a line-range projection is capped", async () => {
    const raw = await executeWorkspaceOperation(
      { operation: "read", path: "docs/huge.txt", offset: 2, limit: 1 },
      { workspaceFiles: files, actorLevel: 4 },
    ) as Record<string, unknown>
    expect(raw.charOffset).toBe(7)
    const projected = projectToolObservationForAgent(
      { name: "read", arguments: { path: "docs/huge.txt", offset: 2, limit: 1 } },
      { index: 0, name: "read", ok: true, result: raw },
    ).result as Record<string, unknown>
    expect(projected.nextCharOffset).toBe(7 + MAX_AGENT_READ_CONTENT_CHARS)
    expect(projected.totalChars).toBe(100_007)
  })
})
