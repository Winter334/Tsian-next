import { describe, expect, it } from "vitest"
import type { ChatMessage } from "./useAssistantTimeline"
import { useAssistantTimeline } from "./useAssistantTimeline"

describe("useAssistantTimeline tool metadata", () => {
  it("fills display metadata and does not erase it on later status updates", () => {
    const message: ChatMessage = { role: "assistant", content: "", timeline: [] }
    const { onTool } = useAssistantTimeline(message)
    const presentation = {
      type: "agent_call" as const,
      targetAgent: { id: "worker", title: "Worker" },
      response: "done",
      status: "completed" as const,
    }

    onTool("assistant", 0, "call-1", "agent_call", "loading", presentation, "咨询 Worker")
    onTool("assistant", 0, "call-1", "agent_call", "success")

    expect(message.timeline).toHaveLength(1)
    expect(message.timeline?.[0]).toMatchObject({
      type: "tool",
      id: "call-1",
      name: "agent_call",
      displayName: "咨询 Worker",
      status: "success",
      presentation,
    })
  })
})
