export const SPATIAL_SHELL_MENU_Z_INDEX = 999_980
export const SPATIAL_DESKTOP_INPUT_SOURCE_ID = "shell:desktop-input"
export const SPATIAL_DESKTOP_MENU_SOURCE_ID = "shell:desktop-menu"
export const SPATIAL_LAUNCHER_MENU_SOURCE_ID = "shell:launcher-menu"
export const SPATIAL_STATUS_MENU_SOURCE_ID = "shell:status-menu"
export const SPATIAL_SHELL_MENU_WIDTH = 184
export const SPATIAL_SHELL_MENU_ITEM_HEIGHT = 34
export const SPATIAL_SHELL_MENU_PADDING = 8
export const SPATIAL_SHELL_MENU_VIEWPORT_INSET = 12

export interface SpatialShellMenuPoint {
  readonly x: number
  readonly y: number
}

export interface SpatialShellMenuViewport {
  readonly width: number
  readonly height: number
}

export interface SpatialShellMenuLayout {
  readonly width: number
  readonly height: number
  readonly x: number
  readonly y: number
}

export interface SpatialShellMenuItem {
  readonly id: string
  readonly label: string
  readonly danger?: boolean
}

export function spatialShellMenuAnchorFromSourceClient(
  sourceRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  client: SpatialShellMenuPoint,
): SpatialShellMenuPoint {
  const localX = clamp(client.x - sourceRect.left, 0, sourceRect.width)
  const localY = clamp(client.y - sourceRect.top, 0, sourceRect.height)
  return {
    x: sourceRect.left + localX,
    y: sourceRect.top + localY,
  }
}

export function spatialShellMenuAnchorFromElement(
  elementRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): SpatialShellMenuPoint {
  return {
    x: elementRect.left + elementRect.width / 2,
    y: elementRect.top + elementRect.height / 2,
  }
}

export function spatialShellMenuLayout(
  viewport: SpatialShellMenuViewport,
  anchor: SpatialShellMenuPoint,
  itemCount: number,
): SpatialShellMenuLayout {
  const inset = SPATIAL_SHELL_MENU_VIEWPORT_INSET
  const width = Math.max(1, Math.min(
    SPATIAL_SHELL_MENU_WIDTH,
    Math.round(viewport.width - inset * 2),
  ))
  const height = Math.max(1, Math.min(
    SPATIAL_SHELL_MENU_PADDING * 2
      + Math.max(1, itemCount) * SPATIAL_SHELL_MENU_ITEM_HEIGHT,
    Math.round(viewport.height - inset * 2),
  ))
  const maxX = Math.max(inset, viewport.width - inset - width)
  const maxY = Math.max(inset, viewport.height - inset - height)
  return {
    width,
    height,
    x: Math.round(clamp(anchor.x + 8, inset, maxX)),
    y: Math.round(clamp(anchor.y + 8, inset, maxY)),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}
