import { describe, expect, it } from "vitest"
import {
  applyParallax,
  clientToNormalized,
  computeBackingStoreSize,
  invertParallax,
  normalizedToClient,
  type ClientRectLike,
} from "./coordinates"

const rects: ClientRectLike[] = [
  { left: 0, top: 0, width: 1920, height: 1080 },
  { left: 120, top: 64, width: 1366, height: 768 },
  { left: 40, top: 20, width: 1280, height: 800 },
]

describe("viewport coordinate primitives", () => {
  it("round trips CSS and normalized viewport coordinates", () => {
    for (const rect of rects) {
      for (const normalized of [
        { x: -1, y: -1 },
        { x: -0.35, y: 0.68 },
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]) {
        const restored = clientToNormalized(normalizedToClient(normalized, rect), rect)
        expect(restored.x).toBeCloseTo(normalized.x, 12)
        expect(restored.y).toBeCloseTo(normalized.y, 12)
      }
    }
  })

  it("round trips the independent parallax transform", () => {
    const point = { x: 0.42, y: -0.26 }
    const transform = { offsetX: 0.025, offsetY: -0.012, scale: 0.97 }
    expect(invertParallax(applyParallax(point, transform), transform)).toEqual(point)
  })

  it("uses CSS size for backing policy and clamps DPR with preserved aspect ratio", () => {
    expect(computeBackingStoreSize({ width: 1000, height: 500 }, 3, 1600)).toEqual({
      width: 1600,
      height: 800,
      effectiveDpr: 1.6,
    })
    expect(computeBackingStoreSize({ width: 1920, height: 1080 }, 1, 8192)).toEqual({
      width: 1920,
      height: 1080,
      effectiveDpr: 1,
    })
  })
})
