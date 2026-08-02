import type { RuntimeChatMessage } from "../../runtime-host/ai"
import { describe, expect, it } from "vitest"
import { mergeConsecutiveRoleMessages } from "./message-formatting"

describe("mergeConsecutiveRoleMessages", () => {
  it("keeps parallel native tool results independently correlated", () => {
    const messages: RuntimeChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "call-a", name: "read", arguments: { path: "a" } },
          { id: "call-b", name: "read", arguments: { path: "b" } },
        ],
      },
      { role: "tool", toolCallId: "call-a", content: "A" },
      { role: "tool", toolCallId: "call-b", content: "B" },
    ]
    expect(mergeConsecutiveRoleMessages(messages)).toEqual(messages)
  })

  it("still merges ordinary string messages", () => {
    expect(mergeConsecutiveRoleMessages([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
    ])).toEqual([{ role: "user", content: "one\n\ntwo" }])
  })
})
