import {
  DEFAULT_CURVE_PROJECTION,
  projectCylindrical,
  type CurveProjectionConfig,
  type SpatialPoint,
  unprojectCylindrical,
} from "../projection"

export interface ClientRectLike {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface CssSize {
  readonly width: number
  readonly height: number
}

export interface ParallaxTransform {
  readonly offsetX: number
  readonly offsetY: number
  readonly scale: number
}

export const IDENTITY_PARALLAX = Object.freeze<ParallaxTransform>({
  offsetX: 0,
  offsetY: 0,
  scale: 1,
})

export type CoordinateMappingFailure =
  | "invalid-canvas-rect"
  | "outside-canvas"
  | "outside-curve"
  | "invalid-parallax"

export type ClientToPlanarResult =
  | {
      readonly ok: true
      readonly trustedClient: SpatialPoint
      readonly canvasCss: SpatialPoint
      readonly curvedNormalized: SpatialPoint
      readonly transformedPlanar: SpatialPoint
      readonly planarNormalized: SpatialPoint
      readonly planarClient: SpatialPoint
      readonly depth: number
    }
  | {
      readonly ok: false
      readonly reason: CoordinateMappingFailure
      readonly trustedClient: SpatialPoint
    }

export type PlanarToClientResult =
  | {
      readonly ok: true
      readonly planarClient: SpatialPoint
      readonly planarNormalized: SpatialPoint
      readonly transformedPlanar: SpatialPoint
      readonly curvedNormalized: SpatialPoint
      readonly visualClient: SpatialPoint
      readonly depth: number
    }
  | {
      readonly ok: false
      readonly reason: CoordinateMappingFailure
      readonly planarClient: SpatialPoint
    }

function validRect(rect: ClientRectLike): boolean {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
}

function validParallax(transform: ParallaxTransform): boolean {
  return Number.isFinite(transform.offsetX)
    && Number.isFinite(transform.offsetY)
    && Number.isFinite(transform.scale)
    && transform.scale > 0
}

export function clientToNormalized(point: SpatialPoint, rect: ClientRectLike): SpatialPoint {
  return {
    x: ((point.x - rect.left) / rect.width) * 2 - 1,
    y: 1 - ((point.y - rect.top) / rect.height) * 2,
  }
}

export function normalizedToClient(point: SpatialPoint, rect: ClientRectLike): SpatialPoint {
  return {
    x: rect.left + ((point.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - point.y) / 2) * rect.height,
  }
}

export function applyParallax(
  point: SpatialPoint,
  transform: ParallaxTransform,
): SpatialPoint {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  }
}

export function invertParallax(
  point: SpatialPoint,
  transform: ParallaxTransform,
): SpatialPoint {
  return {
    x: (point.x - transform.offsetX) / transform.scale,
    y: (point.y - transform.offsetY) / transform.scale,
  }
}

export function mapClientToPlanar(input: {
  readonly client: SpatialPoint
  readonly canvasRect: ClientRectLike
  readonly curve?: CurveProjectionConfig
  readonly parallax?: ParallaxTransform
}): ClientToPlanarResult {
  const { client, canvasRect } = input
  const parallax = input.parallax ?? IDENTITY_PARALLAX
  if (!validRect(canvasRect)) {
    return { ok: false, reason: "invalid-canvas-rect", trustedClient: client }
  }
  if (!validParallax(parallax)) {
    return { ok: false, reason: "invalid-parallax", trustedClient: client }
  }

  const canvasCss = {
    x: client.x - canvasRect.left,
    y: client.y - canvasRect.top,
  }
  if (canvasCss.x < 0 || canvasCss.y < 0
    || canvasCss.x > canvasRect.width || canvasCss.y > canvasRect.height) {
    return { ok: false, reason: "outside-canvas", trustedClient: client }
  }

  const curvedNormalized = clientToNormalized(client, canvasRect)
  const unprojected = unprojectCylindrical(
    curvedNormalized,
    input.curve ?? DEFAULT_CURVE_PROJECTION,
  )
  if (!unprojected.ok) {
    return { ok: false, reason: "outside-curve", trustedClient: client }
  }
  const transformedPlanar = unprojected.point
  const planarNormalized = invertParallax(transformedPlanar, parallax)
  if (Math.abs(planarNormalized.x) > 1 || Math.abs(planarNormalized.y) > 1) {
    return { ok: false, reason: "outside-curve", trustedClient: client }
  }

  return {
    ok: true,
    trustedClient: client,
    canvasCss,
    curvedNormalized,
    transformedPlanar,
    planarNormalized,
    planarClient: normalizedToClient(planarNormalized, canvasRect),
    depth: unprojected.depth,
  }
}

export function mapPlanarToClient(input: {
  readonly planarClient: SpatialPoint
  readonly canvasRect: ClientRectLike
  readonly curve?: CurveProjectionConfig
  readonly parallax?: ParallaxTransform
}): PlanarToClientResult {
  const { planarClient, canvasRect } = input
  const parallax = input.parallax ?? IDENTITY_PARALLAX
  if (!validRect(canvasRect)) {
    return { ok: false, reason: "invalid-canvas-rect", planarClient }
  }
  if (!validParallax(parallax)) {
    return { ok: false, reason: "invalid-parallax", planarClient }
  }

  const planarNormalized = clientToNormalized(planarClient, canvasRect)
  if (Math.abs(planarNormalized.x) > 1 || Math.abs(planarNormalized.y) > 1) {
    return { ok: false, reason: "outside-canvas", planarClient }
  }
  const transformedPlanar = applyParallax(planarNormalized, parallax)
  const projected = projectCylindrical(
    transformedPlanar,
    input.curve ?? DEFAULT_CURVE_PROJECTION,
  )
  if (!projected.ok) {
    return { ok: false, reason: "outside-curve", planarClient }
  }

  return {
    ok: true,
    planarClient,
    planarNormalized,
    transformedPlanar,
    curvedNormalized: projected.point,
    visualClient: normalizedToClient(projected.point, canvasRect),
    depth: projected.depth,
  }
}

export function computeBackingStoreSize(
  cssSize: CssSize,
  requestedDpr: number,
  maxDimension: number,
): { readonly width: number; readonly height: number; readonly effectiveDpr: number } {
  if (cssSize.width <= 0 || cssSize.height <= 0 || maxDimension <= 0) {
    return { width: 0, height: 0, effectiveDpr: 0 }
  }
  const dpr = Math.max(1, Math.min(2, Number.isFinite(requestedDpr) ? requestedDpr : 1))
  const requestedWidth = Math.max(1, Math.round(cssSize.width * dpr))
  const requestedHeight = Math.max(1, Math.round(cssSize.height * dpr))
  const scale = Math.min(1, maxDimension / Math.max(requestedWidth, requestedHeight))
  const width = Math.max(1, Math.floor(requestedWidth * scale))
  const height = Math.max(1, Math.floor(requestedHeight * scale))
  return {
    width,
    height,
    effectiveDpr: Math.min(width / cssSize.width, height / cssSize.height),
  }
}
