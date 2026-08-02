import { describe, expect, it } from "vitest"
import type { SpatialSourceRoot } from "./input/target-resolver"
import { sourcesAvailableForProjectedInput } from "./viewport-controller"

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
