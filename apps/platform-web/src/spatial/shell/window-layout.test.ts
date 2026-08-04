import { describe, expect, it } from "vitest"
import { projectSurfacePoint } from "../engine/projection"
import {
  clampSpatialGeometry,
  defaultSpatialWindowSize,
  edgeProgressForGeometry,
  resizeSpatialGeometry,
  sideDepthForGeometry,
  sourceLocalDeltaToWorld,
  SPATIAL_WINDOW_PHYSICAL_CALIBRATION,
  windowGeometryToPose,
} from "./window-layout"

const viewport = { width: 1200, height: 800 }
const viewportRect = { left: 0, top: 0, ...viewport }

describe("Spatial window layout", () => {
  it("keeps the central band nearly front-facing and poses side windows smoothly", () => {
    const center = { worldX: 350, worldY: 200, width: 500, height: 400, sideDepth: 0 }
    const left = { ...center, worldX: -280 }
    const right = { ...center, worldX: 980 }
    expect(windowGeometryToPose(center, viewport)).toEqual({
      depth: 0,
      yaw: 0,
      pitch: 0,
      scale: 1,
      curveHalfAngle: SPATIAL_WINDOW_PHYSICAL_CALIBRATION.curveHalfAngle,
    })
    expect(sideDepthForGeometry(left, viewport)).toBeGreaterThan(0)
    expect(windowGeometryToPose(left, viewport)).toMatchObject({
      yaw: expect.any(Number),
      depth: expect.any(Number),
    })
    expect(windowGeometryToPose(left, viewport).yaw).toBeLessThan(0)
    expect(windowGeometryToPose(right, viewport).yaw).toBeGreaterThan(0)
    expect(windowGeometryToPose(left, viewport).scale).toBeGreaterThanOrEqual(0.955)
  })

  it("gives all four edge positions physical inward-facing perspective", () => {
    const largeViewport = { width: 1920, height: 1080 }
    const base = { worldY: 230, width: 760, height: 620, sideDepth: 0 }
    const center = { ...base, worldX: (largeViewport.width - base.width) / 2 }
    const minimums = { width: 320, height: 240 }
    const left = clampSpatialGeometry({ ...center, worldX: -5000 }, largeViewport, minimums)
    const right = clampSpatialGeometry({ ...center, worldX: 5000 }, largeViewport, minimums)
    const top = clampSpatialGeometry({ ...center, worldY: -5000 }, largeViewport, minimums)
    const bottom = clampSpatialGeometry({ ...center, worldY: 5000 }, largeViewport, minimums)
    const projectedEdgeSizes = (geometry: typeof left) => {
      const projection = {
        sourceRect: {
          left: geometry.worldX,
          top: geometry.worldY,
          width: geometry.width,
          height: geometry.height,
        },
        viewportRect: { left: 0, top: 0, ...largeViewport },
        pose: windowGeometryToPose(geometry, largeViewport),
      }
      const leftTop = projectSurfacePoint({ x: -1, y: -1 }, projection)
      const leftBottom = projectSurfacePoint({ x: -1, y: 1 }, projection)
      const rightTop = projectSurfacePoint({ x: 1, y: -1 }, projection)
      const rightBottom = projectSurfacePoint({ x: 1, y: 1 }, projection)
      expect(leftTop.ok && leftBottom.ok && rightTop.ok && rightBottom.ok).toBe(true)
      if (!leftTop.ok || !leftBottom.ok || !rightTop.ok || !rightBottom.ok) {
        return { leftHeight: 0, rightHeight: 0, topWidth: 0, bottomWidth: 0 }
      }
      const distance = (
        first: typeof leftTop.visualClient,
        second: typeof leftTop.visualClient,
      ) => Math.hypot(second.x - first.x, second.y - first.y)
      return {
        leftHeight: distance(leftTop.visualClient, leftBottom.visualClient),
        rightHeight: distance(rightTop.visualClient, rightBottom.visualClient),
        topWidth: distance(leftTop.visualClient, rightTop.visualClient),
        bottomWidth: distance(leftBottom.visualClient, rightBottom.visualClient),
      }
    }

    const leftEdges = projectedEdgeSizes(left)
    const rightEdges = projectedEdgeSizes(right)
    const topEdges = projectedEdgeSizes(top)
    const bottomEdges = projectedEdgeSizes(bottom)
    const centerEdges = projectedEdgeSizes(center)
    expect(leftEdges.leftHeight).toBeGreaterThan(leftEdges.rightHeight)
    expect(rightEdges.rightHeight).toBeGreaterThan(rightEdges.leftHeight)
    expect(topEdges.topWidth).toBeGreaterThan(topEdges.bottomWidth)
    expect(bottomEdges.bottomWidth).toBeGreaterThan(bottomEdges.topWidth)
    expect(centerEdges.leftHeight).toBeCloseTo(centerEdges.rightHeight, 8)
    expect(centerEdges.topWidth).toBeCloseTo(centerEdges.bottomWidth, 8)
    expect(windowGeometryToPose(center, largeViewport)).toMatchObject({ yaw: 0, pitch: 0 })
    expect(windowGeometryToPose(top, largeViewport).pitch).toBeGreaterThan(0)
    expect(windowGeometryToPose(bottom, largeViewport).pitch).toBeLessThan(0)
  })

  it("keeps local cylindrical inward wrap independent from rigid pose", () => {
    const largeViewport = { width: 1920, height: 1080 }
    const base = { worldY: 230, width: 760, height: 620, sideDepth: 0 }
    const center = { ...base, worldX: (largeViewport.width - base.width) / 2 }
    const left = clampSpatialGeometry(
      { ...center, worldX: -5000 },
      largeViewport,
      { width: 320, height: 240 },
    )
    const right = clampSpatialGeometry(
      { ...center, worldX: 5000 },
      largeViewport,
      { width: 320, height: 240 },
    )
    const edgeWrapDepth = (geometry: typeof center) => {
      const projection = {
        sourceRect: {
          left: geometry.worldX,
          top: geometry.worldY,
          width: geometry.width,
          height: geometry.height,
        },
        viewportRect: { left: 0, top: 0, ...largeViewport },
        pose: windowGeometryToPose(geometry, largeViewport),
      }
      const topLeft = projectSurfacePoint({ x: -1, y: -1 }, projection)
      const topCenter = projectSurfacePoint({ x: 0, y: -1 }, projection)
      const topRight = projectSurfacePoint({ x: 1, y: -1 }, projection)
      expect(topLeft.ok && topCenter.ok && topRight.ok).toBe(true)
      if (!topLeft.ok || !topCenter.ok || !topRight.ok) return 0
      expect(topCenter.localSurface.z).toBeCloseTo(0, 8)
      return topCenter.localSurface.z
        - (topLeft.localSurface.z + topRight.localSurface.z) / 2
    }
    const centerWrapDepth = edgeWrapDepth(center)
    expect(edgeWrapDepth(left)).toBeCloseTo(centerWrapDepth, 5)
    expect(edgeWrapDepth(right)).toBeCloseTo(centerWrapDepth, 5)
    expect(windowGeometryToPose(left, largeViewport).curveHalfAngle).toBe(
      windowGeometryToPose(center, largeViewport).curveHalfAngle,
    )
    expect(windowGeometryToPose(right, largeViewport).curveHalfAngle).toBe(
      windowGeometryToPose(center, largeViewport).curveHalfAngle,
    )
  })

  it("grows horizontal and vertical pose monotonically through ordinary viewport travel", () => {
    const largeViewport = { width: 1920, height: 1080 }
    const center = {
      worldX: (largeViewport.width - 760) / 2,
      worldY: (largeViewport.height - 620) / 2,
      width: 760,
      height: 620,
      sideDepth: 0,
    }
    const edges = {
      left: {
        ...center,
        worldX: center.worldX
          - largeViewport.width * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.horizontalResponseRange,
      },
      right: {
        ...center,
        worldX: center.worldX
          + largeViewport.width * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.horizontalResponseRange,
      },
      top: {
        ...center,
        worldY: center.worldY
          - largeViewport.height * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.verticalResponseRange,
      },
      bottom: {
        ...center,
        worldY: center.worldY
          + largeViewport.height * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.verticalResponseRange,
      },
    }
    const sample = (
      edge: typeof center,
      axis: "horizontal" | "vertical",
    ) => Array.from({ length: 11 }, (_, index) => {
      const progress = index / 10
      const geometry = {
        ...center,
        worldX: center.worldX + (edge.worldX - center.worldX) * progress,
        worldY: center.worldY + (edge.worldY - center.worldY) * progress,
      }
      return edgeProgressForGeometry(geometry, largeViewport)[axis]
    })
    const series = [
      sample(edges.left, "horizontal"),
      sample(edges.right, "horizontal"),
      sample(edges.top, "vertical"),
      sample(edges.bottom, "vertical"),
    ]
    for (const values of series) {
      expect(values[0]).toBe(0)
      expect(values[values.length - 1]).toBeCloseTo(1, 10)
      const increments = values.slice(1).map((value, index) => value - values[index])
      expect(increments.every((increment) => increment > 0)).toBe(true)
      expect(increments[0]).toBeGreaterThan(increments[increments.length - 1])
    }
    for (let index = 0; index < series[0].length; index += 1) {
      expect(series[0][index]).toBeCloseTo(series[1][index], 10)
      expect(series[2][index]).toBeCloseTo(series[3][index], 10)
    }
  })

  it.each([350, -280, 980])("uses already-inverted Source-local deltas at worldX=%s", (worldX) => {
    const geometry = { worldX, worldY: 100, width: 500, height: 400, sideDepth: 0 }
    const world = sourceLocalDeltaToWorld({ x: 44, y: 22 }, {
      sideDepth: sideDepthForGeometry(geometry, viewport),
    })
    expect(world).toEqual({ x: 44, y: 22 })
  })

  it("uses a readable viewport-relative default at 1920x1080", () => {
    expect(defaultSpatialWindowSize(
      { width: 760, height: 560 },
      { width: 1920, height: 1080 },
      { width: 480, height: 320 },
    )).toEqual({ width: 1114, height: 778 })
  })

  it("gives the default window physical cylindrical inward wrap", () => {
    const largeViewport = { width: 1920, height: 1080 }
    const size = defaultSpatialWindowSize(
      { width: 760, height: 560 },
      largeViewport,
      { width: 480, height: 320 },
    )
    const geometry = {
      worldX: (largeViewport.width - size.width) / 2,
      worldY: (largeViewport.height - size.height) / 2,
      ...size,
      sideDepth: 0,
    }
    const projection = {
      sourceRect: {
        left: geometry.worldX,
        top: geometry.worldY,
        width: geometry.width,
        height: geometry.height,
      },
      viewportRect: { left: 0, top: 0, ...largeViewport },
      pose: windowGeometryToPose(geometry, largeViewport),
    }
    const topLeft = projectSurfacePoint({ x: -1, y: -1 }, projection)
    const topCenter = projectSurfacePoint({ x: 0, y: -1 }, projection)
    const topRight = projectSurfacePoint({ x: 1, y: -1 }, projection)
    expect(topLeft.ok && topCenter.ok && topRight.ok).toBe(true)
    if (!topLeft.ok || !topCenter.ok || !topRight.ok) return
    const edgeWrapDepth = topCenter.localSurface.z
      - (topLeft.localSurface.z + topRight.localSurface.z) / 2
    expect(projection.pose.curveHalfAngle).toBe(
      SPATIAL_WINDOW_PHYSICAL_CALIBRATION.curveHalfAngle,
    )
    expect(edgeWrapDepth).toBeGreaterThan(0)
  })

  it("preserves app minimums and launcher/status recovery space", () => {
    expect(defaultSpatialWindowSize(
      { width: 760, height: 560 },
      { width: 1000, height: 700 },
      { width: 320, height: 240 },
    )).toEqual({ width: 760, height: 560 })
    expect(defaultSpatialWindowSize(
      { width: 760, height: 560 },
      { width: 720, height: 480 },
      { width: 640, height: 400 },
    )).toEqual({ width: 640, height: 400 })
  })

  it.each([
    [-5000, -5000],
    [-5000, 5000],
    [5000, -5000],
    [5000, 5000],
  ])("keeps a posed window visibly intersecting the viewport after clamp at %s/%s", (worldX, worldY) => {
    const geometry = clampSpatialGeometry({
      worldX,
      worldY,
      width: 500,
      height: 400,
      sideDepth: 0,
    }, viewport, { width: 320, height: 240 })
    const sourceRect = {
      left: geometry.worldX,
      top: geometry.worldY,
      width: geometry.width,
      height: geometry.height,
    }
    const pose = windowGeometryToPose(geometry, viewport)
    const corners = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
    ].map((local) => projectSurfacePoint(local, { sourceRect, viewportRect, pose }))
    expect(corners.every((corner) => corner.ok)).toBe(true)
    const visual = corners.flatMap((corner) => corner.ok ? [corner.visualClient] : [])
    const left = Math.min(...visual.map((point) => point.x))
    const right = Math.max(...visual.map((point) => point.x))
    const top = Math.min(...visual.map((point) => point.y))
    const bottom = Math.max(...visual.map((point) => point.y))
    expect(Math.min(right, viewport.width)).toBeGreaterThan(Math.max(left, 0))
    expect(Math.min(bottom, viewport.height)).toBeGreaterThan(Math.max(top, 0))
  })

  it.each([
    ["n", { worldX: 300, worldY: 230, width: 500, height: 370 }],
    ["ne", { worldX: 300, worldY: 230, width: 540, height: 370 }],
    ["e", { worldX: 300, worldY: 200, width: 540, height: 400 }],
    ["se", { worldX: 300, worldY: 200, width: 540, height: 430 }],
    ["s", { worldX: 300, worldY: 200, width: 500, height: 430 }],
    ["sw", { worldX: 340, worldY: 200, width: 460, height: 430 }],
    ["w", { worldX: 340, worldY: 200, width: 460, height: 400 }],
    ["nw", { worldX: 340, worldY: 230, width: 460, height: 370 }],
  ] as const)("resizes through the %s projected handle", (direction, expected) => {
    const resized = resizeSpatialGeometry({
      geometry: { worldX: 300, worldY: 200, width: 500, height: 400, sideDepth: 0 },
      direction,
      sourceLocalDelta: { x: 40, y: 30 },
      minimums: { width: 320, height: 240 },
      viewport,
    })
    expect(resized).toMatchObject(expected)
  })

  it("clamps projected resize to minimums", () => {
    const resized = resizeSpatialGeometry({
      geometry: { worldX: 200, worldY: 100, width: 500, height: 400, sideDepth: 0 },
      direction: "nw",
      sourceLocalDelta: { x: 800, y: 800 },
      minimums: { width: 320, height: 240 },
      viewport,
    })
    expect(resized.width).toBe(320)
    expect(resized.height).toBe(240)
  })
})
