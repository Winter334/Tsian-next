import { describe, expect, it, vi } from "vitest"
import {
  emitInteractionRequest,
  resolveInteractionRequest,
  subscribeInteractionRequest,
} from "../../interaction-events"
import type { RuntimeWorkspaceToolExecutionContext } from "../workspace-tools-types"
import { executeRuntimeWorkspaceToolCalls } from "./tool-execution"

describe("Tool execution observation acceptance", () => {
  it("defaults ask_user custom input on while preserving explicit false", async () => {
    const onAskUser = vi.fn(async () => ({ answer: "A" }))
    const context: RuntimeWorkspaceToolExecutionContext = {
      workspaceFiles: [],
      onAskUser,
    }

    await executeRuntimeWorkspaceToolCalls(context, [{
      raw: "ask_user",
      call: {
        id: "ask-default",
        name: "ask_user",
        arguments: { question: "Choose", options: ["A", "B"] },
      },
    }])
    expect(onAskUser).toHaveBeenLastCalledWith(expect.any(String), {
      question: "Choose",
      options: ["A", "B"],
      allowCustom: true,
    })

    await executeRuntimeWorkspaceToolCalls(context, [{
      raw: "ask_user",
      call: {
        id: "ask-open",
        name: "ask_user",
        arguments: { question: "Tell me more" },
      },
    }])
    expect(onAskUser).toHaveBeenLastCalledWith(expect.any(String), {
      question: "Tell me more",
      allowCustom: true,
    })

    await executeRuntimeWorkspaceToolCalls(context, [{
      raw: "ask_user",
      call: {
        id: "ask-options-only",
        name: "ask_user",
        arguments: { question: "Choose", options: ["A"], allowCustom: false },
      },
    }])
    expect(onAskUser).toHaveBeenLastCalledWith(expect.any(String), {
      question: "Choose",
      options: ["A"],
      allowCustom: false,
    })
  })

  it("rejects an invalid ask_user allowCustom value", async () => {
    const onAskUser = vi.fn(async () => ({ answer: "unused" }))
    const observations = await executeRuntimeWorkspaceToolCalls({
      workspaceFiles: [],
      onAskUser,
    }, [{
      raw: "ask_user",
      call: {
        id: "ask-invalid",
        name: "ask_user",
        arguments: { question: "Choose", allowCustom: "yes" },
      },
    }])

    expect(observations[0]).toMatchObject({
      ok: false,
      error: { code: "ASK_USER_ALLOW_CUSTOM_INVALID" },
    })
    expect(onAskUser).not.toHaveBeenCalled()
  })

  it("accepts answered, custom, and cancelled interaction results as strict JSON", async () => {
    const cases = [
      { label: "option answer", answer: "A", expected: { answer: "A" } },
      { label: "custom answer", answer: "Something else", expected: { answer: "Something else" } },
      { label: "cancelled", answer: "", cancelled: true, expected: { answer: "", cancelled: true } },
      { label: "explicit false", answer: "A", cancelled: false, expected: { answer: "A", cancelled: false } },
    ]

    for (const testCase of cases) {
      let emittedRequestId = ""
      let resolutionAccepted = false
      const unsubscribe = subscribeInteractionRequest((requestId) => {
        emittedRequestId = requestId
        resolutionAccepted = resolveInteractionRequest(
          requestId,
          testCase.answer,
          testCase.cancelled,
        )
      })
      try {
        const observations = await executeRuntimeWorkspaceToolCalls({
          workspaceFiles: [],
          onAskUser: (requestId, request) => emitInteractionRequest(
            requestId,
            request.question,
            request.options,
            request.allowCustom,
          ),
        }, [{
          raw: "ask_user",
          call: {
            id: `ask-${testCase.label}`,
            name: "ask_user",
            arguments: { question: "Choose", options: ["A"] },
          },
        }])

        expect(observations[0], testCase.label).toEqual({
          index: 0,
          name: "ask_user",
          ok: true,
          result: testCase.expected,
        })
        expect(
          Reflect.ownKeys(observations[0]?.result as object),
          `${testCase.label} should not retain undefined optional fields`,
        ).toEqual(Reflect.ownKeys(testCase.expected))
        expect(resolutionAccepted, `${testCase.label} should resolve the pending request`).toBe(true)
        expect(
          resolveInteractionRequest(emittedRequestId, "late answer"),
          `${testCase.label} should remove the resolved pending request`,
        ).toBe(false)
      } finally {
        unsubscribe()
      }
    }
  })

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
