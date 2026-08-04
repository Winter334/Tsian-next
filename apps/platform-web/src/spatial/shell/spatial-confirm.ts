export const SPATIAL_CONFIRM_SHIELD_SOURCE_ID = "global:modal-shield"
export const SPATIAL_CONFIRM_PANEL_SOURCE_ID = "global:confirm"
export const SPATIAL_CONFIRM_SHIELD_Z_INDEX = 1_000_000
export const SPATIAL_CONFIRM_PANEL_Z_INDEX = SPATIAL_CONFIRM_SHIELD_Z_INDEX + 10
export const SPATIAL_CONFIRM_PANEL_PRESENTATION_ID = "global-confirm-panel"

export const SPATIAL_CONFIRM_SOURCE_IDS = Object.freeze([
  SPATIAL_CONFIRM_SHIELD_SOURCE_ID,
  SPATIAL_CONFIRM_PANEL_SOURCE_ID,
] as const)

export interface SpatialConfirmViewportSize {
  readonly width: number
  readonly height: number
}

export interface SpatialConfirmPanelLayout {
  readonly width: number
  readonly maxHeight: number
  readonly x: number
  readonly y: number
}

export function spatialConfirmPanelLayout(
  viewport: SpatialConfirmViewportSize,
  measuredHeight: number,
): SpatialConfirmPanelLayout {
  const horizontalInset = viewport.width >= 720 ? 48 : 24
  const verticalInset = viewport.height >= 620 ? 48 : 24
  const availableWidth = Math.max(280, viewport.width - horizontalInset * 2)
  const width = Math.round(Math.min(
    520,
    availableWidth,
    Math.max(380, viewport.width * 0.38),
  ))
  const maxHeight = Math.max(1, Math.round(viewport.height - verticalInset * 2))
  const visibleHeight = Math.min(
    Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 220,
    maxHeight,
  )
  return {
    width,
    maxHeight,
    x: Math.round((viewport.width - width) / 2),
    y: Math.round((viewport.height - visibleHeight) / 2),
  }
}
