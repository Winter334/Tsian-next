export const SPATIAL_MODAL_SHIELD_SOURCE_ID = "global:modal-shield"
export const SPATIAL_TOAST_SOURCE_ID = "global:toast"
export const SPATIAL_DIALOG_PANEL_SOURCE_ID = "global:dialog"
export const SPATIAL_ASSISTANT_CONFIG_SOURCE_ID = "global:assistant-config"
export const SPATIAL_CONFIRM_PANEL_SOURCE_ID = "global:confirm"

export const SPATIAL_TOAST_Z_INDEX = 999_990
export const SPATIAL_MODAL_SHIELD_Z_INDEX = 1_000_000
export const SPATIAL_ASSISTANT_CONFIG_Z_INDEX = 1_000_005
export const SPATIAL_DIALOG_PANEL_Z_INDEX = 1_000_010
export const SPATIAL_CONFIRM_PANEL_Z_INDEX = 1_000_020

export const SPATIAL_DIALOG_PANEL_PRESENTATION_ID = "global-dialog-panel"
export const SPATIAL_ASSISTANT_CONFIG_PRESENTATION_ID = "global-assistant-config"

export interface SpatialGlobalViewportSize {
  readonly width: number
  readonly height: number
}

export interface SpatialGlobalSurfaceLayout {
  readonly width: number
  readonly maxHeight: number
  readonly x: number
  readonly y: number
}

export interface SpatialGlobalSurfacePosition {
  readonly x: number
  readonly y: number
}

export class SpatialGlobalSurfacePositionController {
  private open = false
  private position: SpatialGlobalSurfacePosition | null = null

  setOpen(open: boolean): void {
    if (open === this.open) return
    this.open = open
    this.position = null
  }

  moveBy(delta: SpatialGlobalSurfacePosition): boolean {
    if (!this.open || !this.position) return false
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return false
    if (delta.x === 0 && delta.y === 0) return false
    this.position = {
      x: this.position.x + delta.x,
      y: this.position.y + delta.y,
    }
    return true
  }

  place(
    viewport: SpatialGlobalViewportSize,
    centeredLayout: SpatialGlobalSurfaceLayout,
    measuredHeight: number,
  ): SpatialGlobalSurfaceLayout {
    const layout = spatialGlobalSurfaceLayoutAtPosition(
      viewport,
      centeredLayout,
      measuredHeight,
      this.position ?? centeredLayout,
    )
    if (this.open) this.position = { x: layout.x, y: layout.y }
    return layout
  }
}

export function spatialDialogPreferredWidth(widthClass: string): number {
  if (widthClass.includes("max-w-lg")) return 640
  if (widthClass.includes("max-w-md")) return 560
  return 480
}

export function spatialDialogPanelLayout(
  viewport: SpatialGlobalViewportSize,
  measuredHeight: number,
  preferredWidth: number,
): SpatialGlobalSurfaceLayout {
  const horizontalInset = viewport.width >= 720 ? 48 : 24
  const verticalInset = viewport.height >= 620 ? 48 : 24
  const width = Math.round(Math.min(
    preferredWidth,
    Math.max(280, viewport.width - horizontalInset * 2),
  ))
  const maxHeight = Math.max(1, Math.round(viewport.height - verticalInset * 2))
  const visibleHeight = Math.min(
    Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 360,
    maxHeight,
  )
  return {
    width,
    maxHeight,
    x: Math.round((viewport.width - width) / 2),
    y: Math.round((viewport.height - visibleHeight) / 2),
  }
}

export function spatialGlobalSurfaceLayoutAtPosition(
  viewport: SpatialGlobalViewportSize,
  layout: SpatialGlobalSurfaceLayout,
  measuredHeight: number,
  position: SpatialGlobalSurfacePosition,
): SpatialGlobalSurfaceLayout {
  const visibleHeight = Math.min(
    Number.isFinite(measuredHeight) && measuredHeight > 0 ? measuredHeight : 360,
    layout.maxHeight,
  )
  const maxX = Math.max(0, viewport.width - layout.width)
  const maxY = Math.max(0, viewport.height - visibleHeight)
  return {
    ...layout,
    x: clampGlobalSurfaceCoordinate(position.x, maxX),
    y: clampGlobalSurfaceCoordinate(position.y, maxY),
  }
}

function clampGlobalSurfaceCoordinate(value: number, maximum: number): number {
  const finite = Number.isFinite(value) ? value : 0
  return Math.round(Math.min(maximum, Math.max(0, finite)))
}

export function spatialToastLayout(
  viewport: SpatialGlobalViewportSize,
): SpatialGlobalSurfaceLayout {
  const inset = viewport.width >= 720 ? 32 : 16
  const width = Math.round(Math.min(360, Math.max(280, viewport.width - inset * 2)))
  return {
    width,
    maxHeight: Math.max(1, Math.round(viewport.height - inset * 2)),
    x: Math.round(viewport.width - inset - width),
    y: inset,
  }
}

export function spatialGlobalModalTakesInput(
  previousSourceIds: ReadonlySet<string>,
  nextSourceIds: ReadonlySet<string>,
): boolean {
  function topModal(sourceIds: ReadonlySet<string>): string | null {
    if (sourceIds.has(SPATIAL_CONFIRM_PANEL_SOURCE_ID)) return SPATIAL_CONFIRM_PANEL_SOURCE_ID
    if (sourceIds.has(SPATIAL_DIALOG_PANEL_SOURCE_ID)) return SPATIAL_DIALOG_PANEL_SOURCE_ID
    if (sourceIds.has(SPATIAL_ASSISTANT_CONFIG_SOURCE_ID)) return SPATIAL_ASSISTANT_CONFIG_SOURCE_ID
    if (sourceIds.has(SPATIAL_MODAL_SHIELD_SOURCE_ID)) return SPATIAL_MODAL_SHIELD_SOURCE_ID
    return null
  }

  const next = topModal(nextSourceIds)
  return next !== null && next !== topModal(previousSourceIds)
}
