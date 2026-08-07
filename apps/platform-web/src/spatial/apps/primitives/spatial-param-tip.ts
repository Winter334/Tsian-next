export interface SpatialParamTipHorizontalLayout {
  readonly width: number
  readonly offsetX: number
}

interface HorizontalAnchorRect {
  readonly left: number
  readonly width: number
}

interface HorizontalBoundaryRect {
  readonly left: number
  readonly right: number
}

const DEFAULT_TIP_WIDTH = 260
const DEFAULT_BOUNDARY_GUTTER = 8

export function spatialParamTipHorizontalLayout(
  anchor: HorizontalAnchorRect,
  boundary: HorizontalBoundaryRect,
  preferredWidth = DEFAULT_TIP_WIDTH,
  gutter = DEFAULT_BOUNDARY_GUTTER,
): SpatialParamTipHorizontalLayout {
  const boundaryWidth = boundary.right - boundary.left
  if (
    !Number.isFinite(anchor.left)
    || !Number.isFinite(anchor.width)
    || !Number.isFinite(boundary.left)
    || !Number.isFinite(boundary.right)
    || boundaryWidth <= 0
  ) {
    return { width: DEFAULT_TIP_WIDTH, offsetX: 0 }
  }

  const normalizedWidth = Number.isFinite(preferredWidth) && preferredWidth > 0
    ? preferredWidth
    : DEFAULT_TIP_WIDTH
  const normalizedGutter = Number.isFinite(gutter) ? Math.max(0, gutter) : DEFAULT_BOUNDARY_GUTTER
  const safeGutter = Math.min(normalizedGutter, Math.max(0, (boundaryWidth - 1) / 2))
  const width = Math.min(normalizedWidth, Math.max(1, boundaryWidth - safeGutter * 2))
  const anchorCenter = anchor.left + Math.max(0, anchor.width) / 2
  const centeredLeft = anchorCenter - width / 2
  const minimumLeft = boundary.left + safeGutter
  const maximumLeft = boundary.right - safeGutter - width
  const clampedLeft = Math.min(maximumLeft, Math.max(minimumLeft, centeredLeft))

  return { width, offsetX: clampedLeft - centeredLeft }
}
