import type { SpatialPoint, SpatialSurfacePose } from "../engine/projection"
import { projectPhysicalSurfaceBounds } from "../engine/physical-surface"

export interface SpatialViewportSize {
  readonly width: number
  readonly height: number
}

export interface SpatialWindowGeometry {
  worldX: number
  worldY: number
  width: number
  height: number
  sideDepth: number
}

export type SpatialResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"

const DEGREES_TO_RADIANS = Math.PI / 180

export const SPATIAL_WINDOW_PHYSICAL_CALIBRATION = Object.freeze({
  maxDepthPx: 200,
  maxYaw: 18 * DEGREES_TO_RADIANS,
  maxPitch: 8 * DEGREES_TO_RADIANS,
  curveHalfAngle: 30 * DEGREES_TO_RADIANS,
  horizontalResponseRange: 0.32,
  verticalResponseRange: 0.34,
  responseExponent: 1.65,
})

const RECOVERABLE_SURFACE_EDGE = 56
const RECOVERABLE_TITLE_WIDTH = 72
const RECOVERABLE_CONTROL_WIDTH = 34
const RECOVERABLE_CHROME_HEIGHT = 24
const TOP_CHROME_HEIGHT = 34
const TOP_CHROME_RECOVERY_HEIGHT = 48
const DEFAULT_WIDTH_RATIO = 0.58
const DEFAULT_HEIGHT_RATIO = 0.72
const DEFAULT_HORIZONTAL_RECOVERY_SPACE = RECOVERABLE_SURFACE_EDGE * 2
const DEFAULT_VERTICAL_RECOVERY_SPACE = TOP_CHROME_RECOVERY_HEIGHT * 2

export function effectiveSpatialWindowGeometry(
  geometry: SpatialWindowGeometry,
  maximized: boolean,
  viewport: SpatialViewportSize,
): SpatialWindowGeometry {
  if (!maximized) return { ...geometry }
  return {
    worldX: 0,
    worldY: 0,
    width: viewport.width,
    height: viewport.height,
    sideDepth: 0,
  }
}

export function defaultSpatialWindowSize(
  preferred: { readonly width: number; readonly height: number },
  viewport: SpatialViewportSize,
  minimums: { readonly width: number; readonly height: number },
): { readonly width: number; readonly height: number } {
  const maxWidth = Math.max(minimums.width, viewport.width - DEFAULT_HORIZONTAL_RECOVERY_SPACE)
  const maxHeight = Math.max(minimums.height, viewport.height - DEFAULT_VERTICAL_RECOVERY_SPACE)
  return {
    width: clamp(
      Math.max(preferred.width, Math.round(viewport.width * DEFAULT_WIDTH_RATIO)),
      minimums.width,
      maxWidth,
    ),
    height: clamp(
      Math.max(preferred.height, Math.round(viewport.height * DEFAULT_HEIGHT_RATIO)),
      minimums.height,
      maxHeight,
    ),
  }
}

export function sideDepthForGeometry(
  geometry: Pick<SpatialWindowGeometry, "worldX" | "worldY" | "width" | "height">,
  viewport: SpatialViewportSize,
): number {
  const { horizontal, vertical } = edgeProgressForGeometry(geometry, viewport)
  return 1 - (1 - horizontal) * (1 - vertical)
}

export function edgeProgressForGeometry(
  geometry: Pick<SpatialWindowGeometry, "worldX" | "worldY" | "width" | "height">,
  viewport: SpatialViewportSize,
): { readonly horizontal: number; readonly vertical: number } {
  const centerX = geometry.worldX + geometry.width / 2
  const centerY = geometry.worldY + geometry.height / 2
  const horizontalOffset = centerX - viewport.width / 2
  const verticalOffset = centerY - viewport.height / 2
  const horizontalTravel = Math.max(
    1,
    viewport.width * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.horizontalResponseRange,
  )
  const verticalTravel = Math.max(
    1,
    viewport.height * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.verticalResponseRange,
  )
  return {
    horizontal: poseResponse(Math.abs(horizontalOffset) / horizontalTravel),
    vertical: poseResponse(Math.abs(verticalOffset) / verticalTravel),
  }
}

export function sideScale(sideDepth: number): number {
  void sideDepth
  return 1
}

export function windowGeometryToPose(
  geometry: SpatialWindowGeometry,
  viewport: SpatialViewportSize,
): SpatialSurfacePose {
  const sideDepth = sideDepthForGeometry(geometry, viewport)
  const progress = edgeProgressForGeometry(geometry, viewport)
  const centerX = geometry.worldX + geometry.width / 2
  const centerY = geometry.worldY + geometry.height / 2
  const horizontalDirection = Math.sign(centerX - viewport.width / 2)
  const verticalDirection = Math.sign(centerY - viewport.height / 2)
  return {
    depth: sideDepth * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.maxDepthPx,
    yaw: horizontalDirection
      * progress.horizontal * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.maxYaw,
    pitch: verticalDirection === 0
      ? 0
      : -verticalDirection
        * progress.vertical * SPATIAL_WINDOW_PHYSICAL_CALIBRATION.maxPitch,
    scale: sideScale(sideDepth),
    curveHalfAngle: SPATIAL_WINDOW_PHYSICAL_CALIBRATION.curveHalfAngle,
  }
}

export function sourceLocalDeltaToWorld(
  delta: SpatialPoint,
  _geometry: Pick<SpatialWindowGeometry, "sideDepth">,
): SpatialPoint {
  // Resize input is already inverse-projected into Source-local CSS pixels,
  // so applying pose or perspective compensation here would do it twice.
  return { ...delta }
}

export function clampSpatialGeometry(
  geometry: SpatialWindowGeometry,
  viewport: SpatialViewportSize,
  minimums: { readonly width: number; readonly height: number },
): SpatialWindowGeometry {
  const width = clamp(geometry.width, minimums.width, Math.max(minimums.width, viewport.width - 24))
  const height = clamp(geometry.height, minimums.height, Math.max(minimums.height, viewport.height - 24))
  const result = {
    ...geometry,
    width,
    height,
  }

  // Pose changes as the center moves, so solve recovery against the projected
  // physical mesh and both top chrome regions over a few converging passes.
  for (let pass = 0; pass < 8; pass += 1) {
    const projection = physicalProjectionForGeometry(result, viewport)
    const surface = projectPhysicalSurfaceBounds(projection)
    const title = projectPhysicalSurfaceBounds(
      projection,
      titleLocalBounds(result.width, result.height),
      12,
    )
    const controls = projectPhysicalSurfaceBounds(
      projection,
      controlLocalBounds(result.width, result.height),
      12,
    )
    if (!surface || !title || !controls) break
    const chrome = {
      top: Math.min(title.top, controls.top),
      bottom: Math.max(title.bottom, controls.bottom),
    }
    const minimumX = Math.max(
      RECOVERABLE_SURFACE_EDGE - surface.right,
      RECOVERABLE_CONTROL_WIDTH - controls.right,
    )
    const maximumX = Math.min(
      viewport.width - RECOVERABLE_SURFACE_EDGE - surface.left,
      viewport.width - RECOVERABLE_TITLE_WIDTH - title.left,
    )
    const minimumY = Math.max(
      RECOVERABLE_SURFACE_EDGE - surface.bottom,
      RECOVERABLE_CHROME_HEIGHT - chrome.bottom,
    )
    const maximumY = Math.min(
      viewport.height - RECOVERABLE_SURFACE_EDGE - surface.top,
      viewport.height - RECOVERABLE_CHROME_HEIGHT - chrome.top,
    )
    const correctionX = minimumX > 0 ? minimumX : maximumX < 0 ? maximumX : 0
    const correctionY = minimumY > 0 ? minimumY : maximumY < 0 ? maximumY : 0
    result.worldX += correctionX
    result.worldY += correctionY
    if (Math.abs(correctionX) < 0.05 && Math.abs(correctionY) < 0.05) break
  }
  result.sideDepth = sideDepthForGeometry(result, viewport)
  return result
}

export function resizeSpatialGeometry(input: {
  readonly geometry: SpatialWindowGeometry
  readonly direction: SpatialResizeDirection
  readonly sourceLocalDelta: SpatialPoint
  readonly minimums: { readonly width: number; readonly height: number }
  readonly viewport: SpatialViewportSize
}): SpatialWindowGeometry {
  const delta = sourceLocalDeltaToWorld(input.sourceLocalDelta, input.geometry)
  const west = input.direction.includes("w")
  const east = input.direction.includes("e")
  const north = input.direction.includes("n")
  const south = input.direction.includes("s")
  let left = input.geometry.worldX
  let top = input.geometry.worldY
  let right = left + input.geometry.width
  let bottom = top + input.geometry.height

  if (west) left += delta.x
  if (east) right += delta.x
  if (north) top += delta.y
  if (south) bottom += delta.y

  if (right - left < input.minimums.width) {
    if (west) left = right - input.minimums.width
    else right = left + input.minimums.width
  }
  if (bottom - top < input.minimums.height) {
    if (north) top = bottom - input.minimums.height
    else bottom = top + input.minimums.height
  }

  return clampSpatialGeometry({
    ...input.geometry,
    worldX: left,
    worldY: top,
    width: right - left,
    height: bottom - top,
  }, input.viewport, input.minimums)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function poseResponse(value: number): number {
  const normalized = clamp(value, 0, 1)
  return 1 - Math.pow(1 - normalized, SPATIAL_WINDOW_PHYSICAL_CALIBRATION.responseExponent)
}

function physicalProjectionForGeometry(
  geometry: SpatialWindowGeometry,
  viewport: SpatialViewportSize,
) {
  return {
    sourceRect: {
      left: geometry.worldX,
      top: geometry.worldY,
      width: geometry.width,
      height: geometry.height,
    },
    viewportRect: { left: 0, top: 0, width: viewport.width, height: viewport.height },
    pose: windowGeometryToPose(geometry, viewport),
  }
}

function titleLocalBounds(width: number, height: number) {
  const titleWidth = Math.max(190, Math.min(width * 0.44, 320))
  return {
    left: -1,
    top: -1,
    right: clamp(-1 + titleWidth * 2 / width, -1, 1),
    bottom: clamp(-1 + TOP_CHROME_HEIGHT * 2 / height, -1, 1),
  }
}

function controlLocalBounds(width: number, height: number) {
  const controlWidth = 96
  return {
    left: clamp(1 - controlWidth * 2 / width, -1, 1),
    top: -1,
    right: 1,
    bottom: clamp(-1 + TOP_CHROME_HEIGHT * 2 / height, -1, 1),
  }
}
