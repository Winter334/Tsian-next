import type { ClientRectLike } from "./coordinates"
import type { SpatialPoint } from "../projection"

export type ParallaxResetTrigger =
  | "curve-domain-leave"
  | "viewport-leave"
  | "window-blur"
  | "document-hidden"
  | "explicit"

export function shouldRecenterParallax(trigger: ParallaxResetTrigger): boolean {
  return trigger === "window-blur" || trigger === "document-hidden" || trigger === "explicit"
}

export function viewportParallaxTarget(
  point: SpatialPoint,
  viewport: ClientRectLike,
  limits: SpatialPoint = { x: 0.025, y: 0.012 },
): SpatialPoint {
  if (viewport.width <= 0 || viewport.height <= 0) return { x: 0, y: 0 }
  const normalizedX = ((point.x - viewport.left) / viewport.width) * 2 - 1
  const normalizedY = 1 - ((point.y - viewport.top) / viewport.height) * 2
  return {
    x: Math.max(-1, Math.min(1, normalizedX)) * limits.x,
    y: Math.max(-1, Math.min(1, normalizedY)) * limits.y,
  }
}
