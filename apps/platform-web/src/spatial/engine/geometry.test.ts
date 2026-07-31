import { describe, expect, it } from "vitest"
import {
  clientPointToSourceUv,
  intersectRayWithQuad,
  softSnapPointToCylinder,
} from "./geometry"

describe("spatial geometry", () => {
  const quad = {
    origin: { x: -2, y: -1, z: -5 },
    axisU: { x: 4, y: 0, z: 0 },
    axisV: { x: 0, y: 2, z: 0 },
  }

  it("intersects a window quad and returns stable UV coordinates", () => {
    const hit = intersectRayWithQuad({
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: -1 },
    }, quad)
    expect(hit).toMatchObject({ hit: true, distance: 5, uv: { x: 0.5, y: 0.5 } })
  })

  it("classifies parallel, behind and outside intersections", () => {
    expect(intersectRayWithQuad({
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: 0 },
    }, quad)).toEqual({ hit: false, reason: "parallel" })
    expect(intersectRayWithQuad({
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: 0, z: 1 },
    }, quad)).toEqual({ hit: false, reason: "behind" })
    expect(intersectRayWithQuad({
      origin: { x: 0, y: 0, z: 0 },
      direction: { x: 1, y: 0, z: -1 },
    }, quad)).toEqual({ hit: false, reason: "outside" })
  })

  it("maps planar source points to bounded UV", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }
    expect(clientPointToSourceUv({ x: 300, y: 100 }, rect))
      .toEqual({ ok: true, uv: { x: 0.5, y: 0.25 } })
    expect(clientPointToSourceUv({ x: 99, y: 100 }, rect)).toEqual({ ok: false })
  })

  it("soft-snaps only points within a cylindrical threshold", () => {
    const near = softSnapPointToCylinder({ x: 9.5, y: 2, z: 0 }, 10, 1)
    expect(near.snapped).toBe(true)
    expect(near.point.y).toBe(2)
    expect(Math.hypot(near.point.x, near.point.z)).toBeGreaterThan(9.5)
    expect(softSnapPointToCylinder({ x: 7, y: 0, z: 0 }, 10, 1))
      .toMatchObject({ snapped: false, strength: 0 })
  })
})
