import { describe, expect, it } from "vitest"
import {
  buildStoredAssistantTurn,
  chatToStoredMessages,
  mapStoredMessagesToChat,
} from "./assistant-message-mappers"

describe("assistant message presentation persistence", () => {
  it("stores ordinary tools as identity/status only", () => {
    const stored = chatToStoredMessages([{
      role: "assistant",
      content: "done",
      timeline: [{
        type: "tool",
        id: "call-1",
        round: 0,
        name: "search",
        displayName: "搜索资料",
        status: "success",
        collapsed: true,
      }],
    }])
    const json = JSON.stringify(stored)
    expect(json).not.toContain("toolCalls")
    expect(json).not.toContain("observation")
    expect(mapStoredMessagesToChat(stored)[0]?.timeline?.[0]).toMatchObject({
      type: "tool",
      id: "call-1",
      name: "search",
      displayName: "搜索资料",
      status: "success",
    })
    expect(mapStoredMessagesToChat(stored)[0]?.processCollapsed).toBe(true)
  })

  it("round-trips the bounded agent_call presentation", () => {
    const presentation = {
      type: "agent_call" as const,
      targetAgent: { id: "worker", title: "Worker" },
      response: "bounded response",
      status: "completed" as const,
    }
    const stored = chatToStoredMessages([{
      role: "assistant",
      content: "done",
      timeline: [{
        type: "tool",
        id: "call-agent",
        round: 1,
        name: "agent_call",
        status: "success",
        collapsed: true,
        presentation,
      }],
    }])

    expect(stored[0]?.timeline?.[0]).toMatchObject({ presentation })
    expect(mapStoredMessagesToChat(stored)[0]?.timeline?.[0]).toMatchObject({ presentation })
  })

  it("preserves historical process metadata and the current read-only ask record", () => {
    const history = chatToStoredMessages([{
      role: "assistant",
      content: "previous",
      timeline: [{
        type: "tool",
        id: "previous-tool",
        round: 0,
        name: "search",
        displayName: "搜索资料",
        status: "success",
        collapsed: true,
      }],
    }])
    const stored = buildStoredAssistantTurn(
      history,
      { role: "user", content: "continue" },
      {
        role: "assistant",
        content: "done",
        timeline: [{
          type: "ask",
          id: "ask-1",
          round: 1,
          requestId: "ask-1",
          question: "Choose",
          options: ["A"],
          allowCustom: true,
          answer: "A",
          cancelled: false,
          collapsed: true,
        }],
      },
    )

    expect(stored[0]?.timeline?.[0]).toMatchObject({
      kind: "tool",
      displayName: "搜索资料",
    })
    expect(stored[2]?.timeline?.[0]).toMatchObject({
      kind: "interim",
      text: "**提问**: Choose\n**回答**: A",
    })
  })
})
