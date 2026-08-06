export interface SpatialRoutedDragState {
  readonly pointerId: number
  screenX: number
  screenY: number
}

type SpatialRoutedPointerEvent = Pick<
  PointerEvent,
  "button" | "clientX" | "clientY" | "isTrusted" | "pointerId"
> & {
  readonly spatialScreenClientX?: number
  readonly spatialScreenClientY?: number
}

export function isRoutedSpatialGestureEvent(
  event: Pick<PointerEvent, "isTrusted">,
): boolean {
  // Trusted input belongs to the full-screen input plane. Source gestures use
  // only router-generated events so visual and projected deltas cannot mix.
  return !event.isTrusted
}

export function beginRoutedSpatialDrag(
  event: SpatialRoutedPointerEvent,
): SpatialRoutedDragState | null {
  if (!isRoutedSpatialGestureEvent(event) || event.button !== 0) return null
  const screen = routedSpatialScreenPoint(event)
  return {
    pointerId: event.pointerId,
    screenX: screen.x,
    screenY: screen.y,
  }
}

export function moveRoutedSpatialDrag(
  state: SpatialRoutedDragState,
  event: SpatialRoutedPointerEvent,
): { x: number; y: number } | null {
  if (!isRoutedSpatialGestureEvent(event) || state.pointerId !== event.pointerId) return null
  const screen = routedSpatialScreenPoint(event)
  const delta = {
    x: screen.x - state.screenX,
    y: screen.y - state.screenY,
  }
  state.screenX = screen.x
  state.screenY = screen.y
  return delta
}

export function routedSpatialDragMatches(
  state: SpatialRoutedDragState | null,
  event: Pick<PointerEvent, "isTrusted" | "pointerId">,
): boolean {
  return isRoutedSpatialGestureEvent(event) && state?.pointerId === event.pointerId
}

function routedSpatialScreenPoint(
  event: SpatialRoutedPointerEvent,
): { x: number; y: number } {
  return {
    x: event.spatialScreenClientX ?? event.clientX,
    y: event.spatialScreenClientY ?? event.clientY,
  }
}
