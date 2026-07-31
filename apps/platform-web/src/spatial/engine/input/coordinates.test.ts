import { describe, expect, it } from "vitest"
import {
  computeBackingStoreSize,
  mapClientToPlanar,
  mapPlanarToClient,
  type ClientRectLike,
} from "./coordinates"

const rects: ClientRectLike[] = [
  { left: 0, top: 0, width: 1920, height: 1080 },
  { left: 120, top: 64, width: 1366, height: 768 },
  { left: 40, top: 20, width: 1280, height: 800 },
]

describe("projected client coordinates", () => {
  it("round trips CSS coordinates across aspect ratios with parallax", () => {
    for (const canvasRect of rects) {
      for (const normalized of [-0.95, -0.5, 0, 0.5, 0.95]) {
        const planarClient = {
          x: canvasRect.left + ((normalized + 1) / 2) * canvasRect.width,
          y: canvasRect.top + canvasRect.height * 0.5,
        }
        const forward = mapPlanarToClient({
          planarClient,
          canvasRect,
          parallax: { offsetX: 0.025, offsetY: -0.015, scale: 0.98 },
        })
        expect(forward.ok).toBe(true)
        if (!forward.ok) continue
        const inverse = mapClientToPlanar({
          client: forward.visualClient,
          canvasRect,
          parallax: { offsetX: 0.025, offsetY: -0.015, scale: 0.98 },
        })
        expect(inverse.ok).toBe(true)
        if (!inverse.ok) continue
        expect(inverse.planarClient.x).toBeCloseTo(planarClient.x, 5)
        expect(inverse.planarClient.y).toBeCloseTo(planarClient.y, 5)
      }
    }
  })

  it("uses CSS size for pointer mapping regardless of device-pixel size", () => {
    const canvasRect = rects[0]
    const point = { x: 960, y: 540 }
    for (const dpr of [1, 2]) {
      const backing = computeBackingStoreSize(canvasRect, dpr, 8192)
      expect(backing.width).toBe(canvasRect.width * dpr)
      const mapped = mapClientToPlanar({ client: point, canvasRect })
      expect(mapped.ok && mapped.planarClient).toEqual(point)
    }
  })

  it("clamps DPR and texture dimensions with preserved aspect ratio", () => {
    expect(computeBackingStoreSize({ width: 1000, height: 500 }, 3, 1600)).toEqual({
      width: 1600,
      height: 800,
      effectiveDpr: 1.6,
    })
  })

  it("fails outside the canvas and outside the curved silhouette", () => {
    const canvasRect = rects[2]
    expect(mapClientToPlanar({ client: { x: 0, y: 0 }, canvasRect }))
      .toMatchObject({ ok: false, reason: "outside-canvas" })
    expect(mapClientToPlanar({
      client: { x: canvasRect.left + canvasRect.width / 2, y: canvasRect.top + 10 },
      canvasRect,
    })).toMatchObject({ ok: false, reason: "outside-curve" })
  })
})
