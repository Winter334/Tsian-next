import { describe, expect, it } from "vitest"
import type { AssistantTimelineNode } from "@/composables/useAssistantTimeline"
import {
  assistantContentSegments,
  assistantProcessStatusLabel,
  assistantToolLabel,
  assistantToolStatusLabel,
  summarizeAssistantProcess,
} from "./process-presentation"

function tool(
  id: string,
  status: Extract<AssistantTimelineNode, { type: "tool" }>["status"],
  displayName?: string,
): Extract<AssistantTimelineNode, { type: "tool" }> {
  return {
    type: "tool",
    id,
    round: 0,
    name: `tool-${id}`,
    status,
    collapsed: true,
    ...(displayName ? { displayName } : {}),
  }
}

describe("assistant process presentation", () => {
  it("summarizes tools without changing timeline order or identity", () => {
    const timeline: AssistantTimelineNode[] = [
      { type: "interim", id: "before", round: 0, text: "working", collapsed: false },
      tool("a", "success", "Readable A"),
      tool("b", "failed"),
    ]

    expect(summarizeAssistantProcess(timeline)).toEqual({ toolCount: 2, status: "failed" })
    expect(timeline.map((node) => node.id)).toEqual(["before", "a", "b"])
    expect(assistantToolLabel(timeline[1] as Extract<AssistantTimelineNode, { type: "tool" }>)).toBe("Readable A")
    expect(assistantToolLabel(timeline[2] as Extract<AssistantTimelineNode, { type: "tool" }>)).toBe("tool-b")
  })

  it("prioritizes running state and exposes stable status labels", () => {
    expect(summarizeAssistantProcess([tool("a", "failed"), tool("b", "running")])).toEqual({
      toolCount: 2,
      status: "running",
    })
    expect(summarizeAssistantProcess([])).toEqual({ toolCount: 0, status: "idle" })
    expect(summarizeAssistantProcess([tool("a", "success")])).toEqual({
      toolCount: 1,
      status: "success",
    })
    expect(assistantToolStatusLabel("loading")).toBe("运行中")
    expect(assistantToolStatusLabel("success")).toBe("成功")
    expect(assistantToolStatusLabel("failed")).toBe("失败")
    expect(assistantProcessStatusLabel("idle")).toBe("")
  })

  it("shares settled-response thought segmentation across presentations", () => {
    expect(assistantContentSegments("before <think>reason</think> after")).toEqual([
      { kind: "text", text: "before" },
      { kind: "thought", text: "reason" },
      { kind: "text", text: "after" },
    ])
  })
})
