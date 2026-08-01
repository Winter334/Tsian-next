// @vitest-environment happy-dom

import type { RemotePlayBridgeEventMessage } from "@tsian/contracts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createTsian, type ToolEvent } from "../src/tsian-api"

const CHANNEL = "tsian.play-bridge.v1"
const ORIGIN = "https://platform.example"
const SESSION_ID = "session-tool-events"

function dispatchBridgeMessage(data: unknown): void {
  window.dispatchEvent(new MessageEvent("message", {
    data,
    origin: ORIGIN,
    source: window.parent,
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("play-bridge ToolEvent", () => {
  it("exposes a non-empty display name and omits absent or invalid values", () => {
    vi.spyOn(window.parent, "postMessage").mockImplementation(() => {})
    const tsian = createTsian()
    dispatchBridgeMessage({
      channel: CHANNEL,
      kind: "ready",
      sessionId: SESSION_ID,
    })

    const received: ToolEvent[] = []
    tsian.onTool((event) => received.push(event))

    const emitTool = (callId: string, displayName?: unknown) => {
      const message: RemotePlayBridgeEventMessage = {
        channel: CHANNEL,
        kind: "event",
        sessionId: SESSION_ID,
        event: "turn-tool",
        payload: {
          agentId: "master",
          turn: 1,
          round: 0,
          callId,
          name: "read_entity",
          status: "loading",
          ...(displayName === undefined ? {} : { displayName: displayName as string }),
        },
      }
      dispatchBridgeMessage(message)
    }

    emitTool("call-title", "读取实体")
    emitTool("call-absent")
    emitTool("call-blank", "   ")

    expect(received).toHaveLength(3)
    expect(received[0]).toMatchObject({
      callId: "call-title",
      name: "read_entity",
      displayName: "读取实体",
    })
    expect(received[1]).not.toHaveProperty("displayName")
    expect(received[2]).not.toHaveProperty("displayName")
  })
})
