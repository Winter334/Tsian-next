import { describe, expect, it } from "vitest"
import {
  shouldQueueNextSourceTexturePaint,
  sourceTextureAnimationSettlementAction,
  SourceTextureAnimationTracker,
} from "./source-texture-animation"

describe("SourceTextureAnimationTracker", () => {
  it("queues the next capture only after the previous dirty frame uploaded", () => {
    expect(shouldQueueNextSourceTexturePaint({ dirty: false, released: false })).toBe(true)
    expect(shouldQueueNextSourceTexturePaint({ dirty: true, released: false })).toBe(false)
    expect(shouldQueueNextSourceTexturePaint({ dirty: false, released: true })).toBe(false)
  })

  it("preserves an outstanding frame before requesting and completing the final capture", () => {
    expect(sourceTextureAnimationSettlementAction(
      { dirty: true, released: false },
      false,
    )).toBe("wait")
    expect(sourceTextureAnimationSettlementAction(
      { dirty: false, released: false },
      false,
    )).toBe("request-final")
    expect(sourceTextureAnimationSettlementAction(
      { dirty: false, released: false },
      true,
    )).toBe("complete")
    expect(sourceTextureAnimationSettlementAction(
      { dirty: false, released: true },
      true,
    )).toBe("drop")
  })

  it("keeps a source active until every CSS transition settles", () => {
    const tracker = new SourceTextureAnimationTracker(500)
    tracker.begin("window:market", 10)
    tracker.begin("window:market", 20)

    expect(tracker.end("window:market")).toBe(true)
    expect(tracker.frame(100)).toEqual({
      activeSourceIds: ["window:market"],
      expiredSourceIds: [],
    })
    expect(tracker.end("window:market")).toBe(false)
    expect(tracker.frame(101)).toEqual({ activeSourceIds: [], expiredSourceIds: [] })
  })

  it("expires a source when a transition end event is lost", () => {
    const tracker = new SourceTextureAnimationTracker(300)
    tracker.begin("window:detail", 100)

    expect(tracker.frame(399).activeSourceIds).toEqual(["window:detail"])
    expect(tracker.frame(400)).toEqual({
      activeSourceIds: [],
      expiredSourceIds: ["window:detail"],
    })
    expect(tracker.has("window:detail")).toBe(false)
  })

  it("does not let later transition properties extend one active batch past its hard bound", () => {
    const tracker = new SourceTextureAnimationTracker(300)
    tracker.begin("window:market", 100)
    tracker.begin("window:market", 250)

    expect(tracker.frame(399)).toEqual({
      activeSourceIds: ["window:market"],
      expiredSourceIds: [],
    })
    expect(tracker.frame(400)).toEqual({
      activeSourceIds: [],
      expiredSourceIds: ["window:market"],
    })
  })

  it("settles all sources for reduced motion and drops removed sources", () => {
    const tracker = new SourceTextureAnimationTracker()
    tracker.begin("window:market", 0)
    tracker.begin("window:detail", 0)
    tracker.retain(new Set(["window:detail"]))

    expect(tracker.settleAll()).toEqual(["window:detail"])
    expect(tracker.frame(1)).toEqual({ activeSourceIds: [], expiredSourceIds: [] })
  })
})
