import { describe, expect, it, vi } from "vitest"
import type { RuntimeWorkspaceToolExecutionContext } from "../workspace-tools-types"
import { executeRuntimeWorkspaceToolCalls } from "./tool-execution"

describe("Tool execution observation acceptance", () => {
  it("routes parse-error slots through the strict acceptance gate and terminal event", async () => {
    const onTool = vi.fn()
    const context: RuntimeWorkspaceToolExecutionContext = {
      workspaceFiles: [],
      onTool,
    }
    const observations = await executeRuntimeWorkspaceToolCalls(context, [{
      raw: "invalid",
      error: {
        code: "PARSE_FAILED",
        message: "parse failed",
        details: { body: "x".repeat(40_000) },
      },
    }])

    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      index: 0,
      name: "invalid",
      ok: false,
      error: {
        code: "TOOL_OBSERVATION_TOO_LARGE",
        details: { toolName: "invalid" },
      },
    })
    expect(JSON.stringify(observations[0])).not.toContain("\"body\"")
    expect(onTool).toHaveBeenCalledWith("tool-0", "invalid", "failed")
  })

  it("uses an accepted failure consistently for terminal UI status and trace", async () => {
    const onTool = vi.fn()
    const emitTrace = vi.fn()
    const context: RuntimeWorkspaceToolExecutionContext = {
      workspaceFiles: [],
      agentContext: {
        agent: { id: "caller" },
      } as RuntimeWorkspaceToolExecutionContext["agentContext"],
      runAgentCall: vi.fn(async () => ({
        targetAgent: { id: "worker", title: "Worker" },
        response: "private-response".repeat(4_000),
      })),
      onTool,
      emitTrace,
    }
    const observations = await executeRuntimeWorkspaceToolCalls(context, [{
      raw: "agent_call",
      call: {
        id: "call-1",
        name: "agent_call",
        arguments: { agentId: "worker", request: "summarize" },
      },
    }])

    expect(observations[0]).toMatchObject({
      ok: false,
      error: { code: "TOOL_OBSERVATION_TOO_LARGE" },
    })
    expect(onTool).toHaveBeenLastCalledWith(
      "call-1",
      "agent_call",
      "failed",
      expect.objectContaining({
        type: "agent_call",
        status: "failed",
        response: "",
        error: expect.objectContaining({ code: "TOOL_OBSERVATION_TOO_LARGE" }),
      }),
      undefined,
    )
    expect(emitTrace).toHaveBeenCalledWith(expect.objectContaining({
      type: "tool_projected",
      ok: false,
      data: expect.objectContaining({
        accepted: false,
        rejectionCode: "TOOL_OBSERVATION_TOO_LARGE",
      }),
    }))
    expect(JSON.stringify(emitTrace.mock.calls)).not.toContain("private-response")
  })
})
