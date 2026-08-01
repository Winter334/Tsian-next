import { describe, expect, it } from "vitest"
import { createTurnTimelineCollector } from "./turn-timeline-collector"

describe("createTurnTimelineCollector tool display names", () => {
  it("persists a display name across a later status event that omits it", () => {
    const collector = createTurnTimelineCollector()

    collector.onTool("master", 2, "call-1", "read_entity", "loading", undefined, "读取实体")
    collector.onTool("master", 2, "call-1", "read_entity", "success", "done")

    expect(collector.getTimelineItems()).toEqual([
      {
        kind: "tool",
        id: "call-1",
        round: 2,
        agentId: "master",
        name: "read_entity",
        displayName: "读取实体",
        status: "success",
        output: "done",
        collapsed: true,
      },
    ])
  })

  it("fills a display name supplied by a later event", () => {
    const collector = createTurnTimelineCollector()

    collector.onTool("master", 1, "call-2", "roll_dice", "loading")
    collector.onTool("master", 1, "call-2", "roll_dice", "failed", "failed", "掷骰")

    expect(collector.getTimelineItems()[0]).toMatchObject({
      kind: "tool",
      id: "call-2",
      displayName: "掷骰",
      status: "failed",
    })
  })
})
