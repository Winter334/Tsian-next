import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { localDb } from "./db"
import { getAssistantSessionMessages } from "./assistant-conversations"

beforeEach(async () => {
  await localDb.delete()
  await localDb.open()
})

afterEach(async () => {
  await localDb.delete()
})

describe("assistant conversation presentation persistence", () => {
  it("ignores legacy raw tool output while retaining a declared presentation", async () => {
    await localDb.meta.put({
      key: "assistant-session:session-1",
      value: JSON.stringify([{
        role: "assistant",
        content: "done",
        toolCalls: [{ observation: "raw secret" }],
        timeline: [{
          kind: "tool",
          id: "call-1",
          round: 0,
          name: "agent_call",
          status: "success",
          collapsed: true,
          output: "raw secret",
          presentation: {
            type: "agent_call",
            targetAgent: { id: "worker", title: "Worker" },
            response: "bounded answer",
            status: "completed",
          },
        }],
      }]),
    })

    const messages = await getAssistantSessionMessages("session-1")
    expect(JSON.stringify(messages)).not.toContain("raw secret")
    expect(messages[0]?.timeline?.[0]).toMatchObject({
      kind: "tool",
      presentation: { type: "agent_call", response: "bounded answer" },
    })
  })
})
