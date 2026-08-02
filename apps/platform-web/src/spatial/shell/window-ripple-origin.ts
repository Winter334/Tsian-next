import type { SpatialPoint } from "../engine/projection"

export const SPATIAL_MINIMIZE_CONTROL_SELECTOR = "[data-spatial-minimize-control]"
export const DEFAULT_MINIMIZE_ORIGIN_UV: Readonly<SpatialPoint> = Object.freeze({
  x: 0.95,
  y: 0.035,
})

interface RectLike {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function validRect(rect: RectLike | null | undefined): rect is RectLike {
  return Boolean(rect
    && Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0)
}

export function minimizeControlFallbackUv(sourceRect?: RectLike | null): SpatialPoint {
  if (!validRect(sourceRect)) return { ...DEFAULT_MINIMIZE_ORIGIN_UV }
  return {
    // The control tab has 7px outer padding, a 24px close button, a 5px gap,
    // then the 24px minimize button. Its center is therefore 48px from right.
    x: clampUnit(1 - 48 / sourceRect.width),
    y: clampUnit(17 / sourceRect.height),
  }
}

export function sourceLocalControlCenterUv(
  sourceRect: RectLike | null | undefined,
  controlRect: RectLike | null | undefined,
): SpatialPoint {
  const fallback = minimizeControlFallbackUv(sourceRect)
  if (!validRect(sourceRect) || !validRect(controlRect)) return fallback
  return {
    x: clampUnit((controlRect.left + controlRect.width * 0.5 - sourceRect.left) / sourceRect.width),
    y: clampUnit((controlRect.top + controlRect.height * 0.5 - sourceRect.top) / sourceRect.height),
  }
}

export function resolveWindowMinimizeOriginUv(sourceRoot: Element | null): SpatialPoint {
  if (!sourceRoot) return { ...DEFAULT_MINIMIZE_ORIGIN_UV }
  const sourceRect = sourceRoot.getBoundingClientRect()
  const control = sourceRoot.querySelector(SPATIAL_MINIMIZE_CONTROL_SELECTOR)
  return sourceLocalControlCenterUv(sourceRect, control?.getBoundingClientRect())
}
