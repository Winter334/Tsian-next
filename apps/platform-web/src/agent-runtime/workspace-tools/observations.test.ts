import { describe, expect, it } from "vitest"
import {
  acceptToolObservationForAgent,
  buildToolPresentation,
  MAX_AGENT_OBSERVATION_CHARS,
  MAX_UI_AGENT_CALL_RESPONSE_CHARS,
} from "./observations"

describe("Agent tool observation acceptance", () => {
  it("accepts a JSON-safe bounded observation without rewriting it", () => {
    const observation = {
      index: 0,
      name: "custom_tool",
      ok: true,
      result: {
        nested: [1, true, null, { value: "unchanged" }],
      },
    }

    const accepted = acceptToolObservationForAgent(
      { name: "custom_tool", arguments: {} },
      observation,
    )

    expect(accepted).toBe(observation)
    expect(accepted.result).toEqual(observation.result)
  })

  it("fails loud when the serialized observation exceeds the fixed cap", () => {
    const rejected = acceptToolObservationForAgent(
      { name: "custom_tool", arguments: {} },
      {
        index: 3,
        name: "custom_tool",
        ok: true,
        result: { body: `sensitive-payload-${"x".repeat(MAX_AGENT_OBSERVATION_CHARS)}` },
      },
    )

    expect(rejected).toMatchObject({
      index: 3,
      name: "custom_tool",
      ok: false,
      error: {
        code: "TOOL_OBSERVATION_TOO_LARGE",
        details: {
          toolName: "custom_tool",
          maxChars: MAX_AGENT_OBSERVATION_CHARS,
        },
      },
    })
    expect((rejected.error?.details as { actualChars: number }).actualChars)
      .toBeGreaterThan(MAX_AGENT_OBSERVATION_CHARS)
    expect(JSON.stringify(rejected)).not.toContain("sensitive-payload")
    expect(JSON.stringify(rejected)).not.toContain("truncatedForModel")
    expect(JSON.stringify(rejected)).not.toContain("preview")
  })

  it("rejects circular and non-JSON values without normalizing them", () => {
    const circular: Record<string, unknown> = { value: "secret-value" }
    circular.self = circular
    const rejected = acceptToolObservationForAgent(
      { name: "run_script", arguments: {} },
      { index: 0, name: "run_script", ok: true, result: circular },
    )

    expect(rejected).toMatchObject({
      ok: false,
      error: {
        code: "TOOL_OBSERVATION_INVALID",
        details: { toolName: "run_script", reason: "circular-reference" },
      },
    })
    expect(JSON.stringify(rejected)).not.toContain("secret-value")
  })

  it("keeps the independent agent_call UI response cap", () => {
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
})
