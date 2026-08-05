import { describe, expect, it } from "vitest"
import type { SpatialSourceRoot } from "./input/target-resolver"
import {
  routedMouseEventDetail,
  sourceAllowsProjectedInput,
  sourcesAvailableForProjectedInput,
  sourcesAvailableForTextureCapture,
} from "./viewport-controller"

describe("Spatial viewport source availability", () => {
  it("keeps released and restoring sources from occluding projected input", () => {
    const sources = ["shell:launcher", "window:front", "window:behind"].map((sourceId) => ({
      sourceId,
      root: { getAttribute: () => null } as unknown as Element,
    })) satisfies SpatialSourceRoot[]

    expect(sourcesAvailableForProjectedInput(
      sources,
      new Set(["window:front"]),
    ).map((source) => source.sourceId)).toEqual(["shell:launcher", "window:behind"])
  })

  it("keeps input-only Sources in projected input while excluding them from texture capture", () => {
    const drawable = {
      getAttribute: (name: string) => name === "data-spatial-source" ? "global:confirm" : null,
    } as Element
    const inputOnly = {
      getAttribute: (name: string) => {
        if (name === "data-spatial-source") return "global:modal-shield"
        if (name === "data-spatial-render") return "none"
        return null
      },
    } as Element
    const sources = [drawable, inputOnly].map((root) => ({
      sourceId: root.getAttribute("data-spatial-source") ?? "unknown",
      root,
    })) satisfies SpatialSourceRoot[]

    expect(sourcesAvailableForProjectedInput(sources, new Set()).map(({ sourceId }) => sourceId))
      .toEqual(["global:confirm", "global:modal-shield"])
    expect(sourcesAvailableForTextureCapture([drawable, inputOnly])).toEqual([drawable])
  })

  it("applies data-spatial-input none to both new hits and captured-input availability", () => {
    const enabled = {
      getAttribute: () => null,
    } as unknown as Element
    const disabled = {
      getAttribute: (name: string) => name === "data-spatial-input" ? "none" : null,
    } as unknown as Element
    const sources = [
      { sourceId: "global:confirm", root: enabled },
      { sourceId: "global:dialog", root: disabled },
    ] satisfies SpatialSourceRoot[]

    expect(sourceAllowsProjectedInput(enabled)).toBe(true)
    expect(sourceAllowsProjectedInput(disabled)).toBe(false)
    expect(sourcesAvailableForProjectedInput(sources, new Set()).map(({ sourceId }) => sourceId))
      .toEqual(["global:confirm"])
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
