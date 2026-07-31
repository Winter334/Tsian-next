import { describe, expect, it } from "vitest"
import {
  DEFAULT_CURVE_PROJECTION,
  PROJECTION_ROUND_TRIP_TOLERANCE,
  projectCylindrical,
  unprojectCylindrical,
} from "./projection"

describe("cylindrical projection", () => {
  it("round trips a dense center-to-edge grid", () => {
    for (let xIndex = 0; xIndex <= 40; xIndex += 1) {
      for (let yIndex = 0; yIndex <= 40; yIndex += 1) {
        const input = { x: -1 + xIndex / 20, y: -1 + yIndex / 20 }
        const projected = projectCylindrical(input)
        expect(projected.ok).toBe(true)
        if (!projected.ok) continue
        const restored = unprojectCylindrical(projected.point)
        expect(restored.ok).toBe(true)
        if (!restored.ok) continue
        expect(Math.abs(restored.point.x - input.x)).toBeLessThanOrEqual(PROJECTION_ROUND_TRIP_TOLERANCE)
        expect(Math.abs(restored.point.y - input.y)).toBeLessThanOrEqual(PROJECTION_ROUND_TRIP_TOLERANCE)
      }
    }
  })

  it("recesses the center and expands the side wings toward the viewer", () => {
    const center = projectCylindrical({ x: 0, y: 0.75 })
    const middle = projectCylindrical({ x: 0.5, y: 0.75 })
    const edge = projectCylindrical({ x: 1, y: 0.75 })
    expect(center).toMatchObject({
      ok: true,
      point: { x: 0, y: 0.75 * DEFAULT_CURVE_PROJECTION.minCenterScale },
      depth: 0,
    })
    expect(middle.ok && middle.point.x).toBeLessThan(0.5)
    expect(middle.ok && middle.point.y).toBeGreaterThan(0.75 * DEFAULT_CURVE_PROJECTION.minCenterScale)
    expect(edge.ok && edge.point.x).toBeCloseTo(1, 8)
    expect(edge.ok && edge.point.y).toBeCloseTo(0.75, 8)
    expect(edge.ok && edge.depth).toBeCloseTo(1, 8)
  })

  it("bows the silhouette smoothly through the center without a linear cusp", () => {
    const center = projectCylindrical({ x: 0, y: 1 })
    const near = projectCylindrical({ x: 0.002, y: 1 })
    const nearer = projectCylindrical({ x: 0.001, y: 1 })
    const mirrored = projectCylindrical({ x: -0.002, y: 1 })
    expect(center.ok && near.ok && nearer.ok && mirrored.ok).toBe(true)
    if (!center.ok || !near.ok || !nearer.ok || !mirrored.ok) return

    const nearSlope = Math.abs((near.point.y - center.point.y) / 0.002)
    const nearerSlope = Math.abs((nearer.point.y - center.point.y) / 0.001)
    expect(nearerSlope).toBeLessThan(nearSlope * 0.51)
    expect(mirrored.point.y).toBeCloseTo(near.point.y, 12)
  })

  it("rejects planar and curved points outside the visible domain", () => {
    expect(projectCylindrical({ x: 1.01, y: 0 })).toMatchObject({ ok: false, reason: "outside-domain" })
    expect(unprojectCylindrical({ x: 0, y: 0.95 })).toMatchObject({ ok: false, reason: "outside-domain" })
  })

  it("rejects invalid curve configurations without producing NaN", () => {
    expect(projectCylindrical(
      { x: 0, y: 0 },
      { maxAngleRadians: 0, minCenterScale: 1 },
    )).toMatchObject({ ok: false, reason: "invalid-config" })
  })
})
