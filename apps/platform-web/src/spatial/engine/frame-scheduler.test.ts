import { describe, expect, it } from "vitest"
import { FrameScheduler, type FrameReason } from "./frame-scheduler"
import { SpatialMetrics } from "./metrics"

function createHarness(render: ConstructorParameters<typeof FrameScheduler>[0]) {
  const callbacks = new Map<number, FrameRequestCallback>()
  const canceled: number[] = []
  let nextHandle = 0
  let now = 0
  const metrics = new SpatialMetrics()
  const scheduler = new FrameScheduler(render, {
    requestAnimationFrame: (callback) => {
      nextHandle += 1
      callbacks.set(nextHandle, callback)
      return nextHandle
    },
    cancelAnimationFrame: (handle) => {
      canceled.push(handle)
      callbacks.delete(handle)
    },
    now: () => now++,
    metrics,
  })
  return {
    scheduler,
    callbacks,
    canceled,
    metrics,
    flush(timestamp = 16) {
      const first = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined
      if (!first) throw new Error("No queued frame.")
      callbacks.delete(first[0])
      first[1](timestamp)
    },
  }
}

describe("FrameScheduler", () => {
  it("deduplicates requests and stops after a settled frame", () => {
    const seen: FrameReason[][] = []
    const harness = createHarness((frame) => { seen.push([...frame.reasons]) })
    harness.scheduler.request("dirty")
    harness.scheduler.request("dirty")
    expect(harness.callbacks.size).toBe(1)
    harness.flush()
    expect(seen).toEqual([["dirty"]])
    expect(harness.callbacks.size).toBe(0)
    expect(harness.metrics.snapshot().frameCount).toBe(1)
  })

  it("continues only requested reasons", () => {
    let frames = 0
    const harness = createHarness(() => {
      frames += 1
      return frames < 3 ? { continueReasons: ["parallax"] } : undefined
    })
    harness.scheduler.request("parallax")
    harness.flush()
    expect(harness.callbacks.size).toBe(1)
    harness.flush()
    harness.flush()
    expect(frames).toBe(3)
    expect(harness.callbacks.size).toBe(0)
  })

  it("snaps motion continuations under reduced motion", () => {
    const harness = createHarness(() => ({
      continueReasons: ["parallax", "particles", "animated-background", "animated-source", "dirty"],
    }))
    harness.scheduler.setReducedMotion(true)
    harness.scheduler.request("parallax")
    harness.flush()
    expect(harness.scheduler.reasons()).toEqual(["dirty"])
  })

  it("keeps user-controlled animated media eligible under reduced motion", () => {
    const harness = createHarness(() => ({ continueReasons: ["animated-media"] }))
    harness.scheduler.setReducedMotion(true)
    harness.scheduler.request("animated-media")
    harness.flush()
    expect(harness.scheduler.reasons()).toEqual(["animated-media"])
  })

  it("releases the visible particle loop without canceling unrelated work", () => {
    const harness = createHarness(() => undefined)
    harness.scheduler.request("particles")
    harness.scheduler.request("dirty")
    harness.scheduler.release("particles")
    expect(harness.scheduler.reasons()).toEqual(["dirty"])
    expect(harness.callbacks.size).toBe(1)
  })

  it("cancels a particle-only frame when the document hides", () => {
    const harness = createHarness(() => undefined)
    harness.scheduler.request("particles")
    harness.scheduler.release("particles")
    expect(harness.callbacks.size).toBe(0)
    expect(harness.canceled).toEqual([1])
  })

  it("cancels a queued frame on dispose", () => {
    const harness = createHarness(() => undefined)
    harness.scheduler.request("dirty")
    harness.scheduler.dispose()
    expect(harness.callbacks.size).toBe(0)
    expect(harness.canceled).toEqual([1])
  })
})
