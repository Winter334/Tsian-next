import { describe, expect, it } from "vitest"
import {
  computeEnvironmentCoverUvScale,
  StaticProceduralEnvironmentBase,
} from "./environment-base"

describe("StaticProceduralEnvironmentBase", () => {
  it("returns one stable procedural frame and owns no animation reason", () => {
    const provider = new StaticProceduralEnvironmentBase()
    expect(provider.frameDemand).toBe("static")
    expect(provider.frame(0)).toBe(provider.frame(10_000))
    expect(provider.frame(0)).toEqual({ kind: "procedural" })
  })

  it("computes overscanned cover UVs without stretching media", () => {
    expect(computeEnvironmentCoverUvScale(
      { width: 1000, height: 1000 },
      { width: 2000, height: 1000 },
    )).toEqual({ x: 0.94, y: 0.47 })
    expect(computeEnvironmentCoverUvScale(
      { width: 2000, height: 1000 },
      { width: 1000, height: 1000 },
    )).toEqual({ x: 0.47, y: 0.94 })
  })
})
