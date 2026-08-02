import { describe, expect, it } from "vitest"
import {
  projectSurfacePoint,
  SURFACE_FOCAL_LENGTH_FACTOR,
  SURFACE_MESH_COLUMNS,
  SURFACE_MESH_ROWS,
  surfacePoseShaderUniforms,
  unprojectSurfacePoint,
  type SpatialSurfacePose,
} from "./projection"

const viewportRect = { left: 40, top: 20, width: 1440, height: 900 }
const sourceRect = { left: 260, top: 130, width: 860, height: 620 }
const centerPose: SpatialSurfacePose = {
  depth: 0,
  yaw: 0,
  pitch: 0,
  scale: 1,
  curveHalfAngle: 7 * Math.PI / 180,
}
const sidePose: SpatialSurfacePose = {
  depth: 68,
  yaw: 0.05,
  pitch: -0.04,
  scale: 0.958,
  curveHalfAngle: 7 * Math.PI / 180,
}

describe("per-surface ruled-patch projection", () => {
  it.each([
    { name: "center", pose: centerPose },
    { name: "side", pose: sidePose },
  ])("round trips a dense Source-local grid for the $name pose", ({ pose }) => {
    const projection = {
      sourceRect,
      viewportRect,
      pose,
      parallax: { x: 0.018, y: -0.009 },
    }
    for (let xIndex = 0; xIndex <= 20; xIndex += 1) {
      for (let yIndex = 0; yIndex <= 20; yIndex += 1) {
        const local = { x: -1 + xIndex / 10, y: -1 + yIndex / 10 }
        const projected = projectSurfacePoint(local, projection)
        expect(projected.ok).toBe(true)
        if (!projected.ok) continue
        const restored = unprojectSurfacePoint(projected.visualClient, projection)
        expect(restored.ok).toBe(true)
        if (!restored.ok) continue
        expect(restored.localNormalized.x).toBeCloseTo(local.x, 5)
        expect(restored.localNormalized.y).toBeCloseTo(local.y, 5)
        expect(restored.localClient.x).toBeCloseTo(
          sourceRect.left + (local.x + 1) * sourceRect.width / 2,
          3,
        )
      }
    }
  })

  it("wraps both cylindrical edges toward the viewer for an inward curve", () => {
    const projection = { sourceRect, viewportRect, pose: centerPose }
    const topLeft = projectSurfacePoint({ x: -1, y: -1 }, projection)
    const topCenter = projectSurfacePoint({ x: 0, y: -1 }, projection)
    const topRight = projectSurfacePoint({ x: 1, y: -1 }, projection)
    const bottomLeft = projectSurfacePoint({ x: -1, y: 1 }, projection)
    const bottomCenter = projectSurfacePoint({ x: 0, y: 1 }, projection)
    const bottomRight = projectSurfacePoint({ x: 1, y: 1 }, projection)
    expect(topLeft.ok && topCenter.ok && topRight.ok
      && bottomLeft.ok && bottomCenter.ok && bottomRight.ok).toBe(true)
    if (!topLeft.ok || !topCenter.ok || !topRight.ok
      || !bottomLeft.ok || !bottomCenter.ok || !bottomRight.ok) return
    expect(topCenter.visualClient.y).toBeGreaterThan(topLeft.visualClient.y)
    expect(topCenter.visualClient.y).toBeGreaterThan(topRight.visualClient.y)
    expect(bottomCenter.visualClient.y).toBeLessThan(bottomLeft.visualClient.y)
    expect(bottomCenter.visualClient.y).toBeLessThan(bottomRight.visualClient.y)
    expect(topLeft.localSurface.z).toBeLessThan(topCenter.localSurface.z)
    expect(topRight.localSurface.z).toBeCloseTo(topLeft.localSurface.z, 8)
    expect(topLeft.depth).toBeLessThan(topCenter.depth)
    expect(topLeft.clipW).toBeLessThan(topCenter.clipW)
  })

  it("keeps captured gestures invertible beyond the visible panel edge", () => {
    const projection = { sourceRect, viewportRect, pose: sidePose }
    const projected = projectSurfacePoint({ x: 1.35, y: -1.18 }, projection, { allowOutside: true })
    expect(projected.ok).toBe(true)
    if (!projected.ok) return
    const restored = unprojectSurfacePoint(
      projected.visualClient,
      projection,
      { allowOutside: true },
    )
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.localNormalized.x).toBeCloseTo(1.35, 6)
    expect(restored.localNormalized.y).toBeCloseTo(-1.18, 6)
    expect(unprojectSurfacePoint(projected.visualClient, projection)).toMatchObject({
      ok: false,
      reason: "outside-surface",
    })
  })

  it("keeps mapping derivatives continuous across representative grid diagonals", () => {
    const projection = { sourceRect, viewportRect, pose: sidePose }
    const horizontal = 0.37
    const vertical = 1 - horizontal
    const epsilon = 1e-5
    for (const [column, row] of [[3, 2], [17, 8], [31, 15], [44, 21]]) {
      const x = -1 + (column + horizontal) * 2 / SURFACE_MESH_COLUMNS
      const boundaryY = -1 + (row + vertical) * 2 / SURFACE_MESH_ROWS
      const before = projectSurfacePoint({ x, y: boundaryY - epsilon }, projection)
      const boundary = projectSurfacePoint({ x, y: boundaryY }, projection)
      const after = projectSurfacePoint({ x, y: boundaryY + epsilon }, projection)
      expect(before.ok && boundary.ok && after.ok).toBe(true)
      if (!before.ok || !boundary.ok || !after.ok) continue
      const upperDerivative = {
        x: (boundary.visualClient.x - before.visualClient.x) / epsilon,
        y: (boundary.visualClient.y - before.visualClient.y) / epsilon,
      }
      const lowerDerivative = {
        x: (after.visualClient.x - boundary.visualClient.x) / epsilon,
        y: (after.visualClient.y - boundary.visualClient.y) / epsilon,
      }
      expect(Math.abs(lowerDerivative.x - upperDerivative.x)).toBeLessThan(0.5)
      expect(Math.abs(lowerDerivative.y - upperDerivative.y)).toBeLessThan(0.5)
    }
  })

  it("keeps contour and horizontal mapping slopes monotonic across strip boundaries", () => {
    const projection = { sourceRect, viewportRect, pose: centerPose }
    const top: Array<{ x: number; y: number }> = []
    const middle: Array<{ x: number; y: number }> = []
    for (let column = 0; column <= SURFACE_MESH_COLUMNS / 2; column += 1) {
      const x = -1 + column * 2 / SURFACE_MESH_COLUMNS
      const topPoint = projectSurfacePoint({ x, y: -1 }, projection)
      const middlePoint = projectSurfacePoint({ x, y: 0 }, projection)
      expect(topPoint.ok && middlePoint.ok).toBe(true)
      if (!topPoint.ok || !middlePoint.ok) continue
      top.push(topPoint.visualClient)
      middle.push(middlePoint.visualClient)
    }
    const contourSlopes = top.slice(1).map((point, index) => point.y - top[index].y)
    const mappingSlopes = middle.slice(1).map((point, index) => point.x - middle[index].x)
    expect(contourSlopes.every((slope) => slope > 0)).toBe(true)
    expect(mappingSlopes.every((slope) => slope > 0)).toBe(true)
    expect(Math.max(...mappingSlopes) - Math.min(...mappingSlopes)).toBeGreaterThan(1e-4)
  })

  it("shares pose and focal constants with the vertex shader boundary", () => {
    expect(surfacePoseShaderUniforms(sidePose, viewportRect)).toEqual({
      ...sidePose,
      focalLength: viewportRect.width * SURFACE_FOCAL_LENGTH_FACTOR,
    })
  })

  it("rejects malformed poses and Source points outside the visible domain", () => {
    expect(projectSurfacePoint({ x: 1.01, y: 0 }, {
      sourceRect,
      viewportRect,
      pose: centerPose,
    })).toMatchObject({ ok: false, reason: "outside-surface" })
    expect(projectSurfacePoint({ x: 0, y: 0 }, {
      sourceRect,
      viewportRect,
      pose: { ...centerPose, scale: 0 },
    })).toMatchObject({ ok: false, reason: "invalid-projection" })
  })
})
