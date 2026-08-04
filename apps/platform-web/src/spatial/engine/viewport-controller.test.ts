import { describe, expect, it } from "vitest"
import type { SpatialSourceRoot } from "./input/target-resolver"
import {
  routedMouseEventDetail,
  sourcesAvailableForProjectedInput,
} from "./viewport-controller"

describe("Spatial viewport source availability", () => {
  it("keeps released and restoring sources from occluding projected input", () => {
    const sources = ["shell:launcher", "window:front", "window:behind"].map((sourceId) => ({
      sourceId,
      root: {} as Element,
    })) satisfies SpatialSourceRoot[]

    expect(sourcesAvailableForProjectedInput(
      sources,
      new Set(["window:front"]),
    ).map((source) => source.sourceId)).toEqual(["shell:launcher", "window:behind"])
  })
})

describe("Spatial routed compatibility mouse events", () => {
  it("normalizes PointerEvent detail zero into a single-click mouse detail", () => {
    expect(routedMouseEventDetail("mousedown", 0)).toBe(1)
    expect(routedMouseEventDetail("mouseup", 0)).toBe(1)
    expect(routedMouseEventDetail("click", 0)).toBe(1)
    expect(routedMouseEventDetail("mousemove", 0)).toBe(0)
    expect(routedMouseEventDetail("dblclick", 2)).toBe(2)
  })
})
