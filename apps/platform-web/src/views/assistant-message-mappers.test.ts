import { describe, expect, it } from "vitest"
import { chatToStoredMessages, mapStoredMessagesToChat } from "./assistant-message-mappers"

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
      status: "success",
    })
  })
})
