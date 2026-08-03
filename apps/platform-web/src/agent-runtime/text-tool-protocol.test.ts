import { describe, expect, it } from "vitest"
import { formatTextToolObservations } from "./text-tool-protocol"

describe("Text Tool Protocol observation formatting", () => {
  it("serializes accepted observations without a second compaction pass", () => {
    const longValue = "x".repeat(24_000)
    const formatted = formatTextToolObservations(
      [
        { id: "text-r1-c0", name: "custom_tool", arguments: {} },
        { id: "text-r1-c1", name: "read", arguments: { path: "docs/a.md" } },
      ],
      [
        { index: 0, name: "custom_tool", ok: true, result: { longValue } },
        { index: 1, name: "read", ok: false, error: { code: "NOPE", message: "failed" } },
      ],
    )
    const payload = /<tsian-tool-observations>([\s\S]*?)<\/tsian-tool-observations>/
      .exec(formatted.text)?.[1]
    const records = JSON.parse(payload ?? "[]") as Array<Record<string, unknown>>

    expect(records).toHaveLength(2)
    expect(records[0]).toEqual({
      id: "text-r1-c0",
      name: "custom_tool",
      ok: true,
      result: { longValue },
    })
    expect(records[1]).toMatchObject({
      id: "text-r1-c1",
      name: "read",
      ok: false,
      error: { code: "NOPE", message: "failed" },
    })
    expect(formatted.text).not.toContain("truncatedForModel")
  })
})
