import type { SpatialPoint } from "../projection"

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
