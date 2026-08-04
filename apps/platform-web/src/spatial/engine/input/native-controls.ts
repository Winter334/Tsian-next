import type { SpatialPoint } from "../projection"

export interface ScrollPosition {
  readonly left: number
  readonly top: number
}

export type ScrollbarDragAxis = "horizontal" | "vertical"

export interface ScrollbarThumbGeometry {
  readonly axis: ScrollbarDragAxis
  readonly gutter: {
    readonly left: number
    readonly top: number
    readonly width: number
    readonly height: number
  }
  readonly trackStart: number
  readonly trackLength: number
  readonly thumbStart: number
  readonly thumbLength: number
  readonly thumbTravel: number
  readonly scrollRange: number
}

export type ScrollbarThumbGeometryResult =
  | { readonly status: "ready"; readonly geometry: ScrollbarThumbGeometry }
  | { readonly status: "not-scrollable"; readonly reason: "not-overflowing" | "overflow-disabled" }
  | {
      readonly status: "unsupported"
      readonly reason: "overlay-or-no-gutter" | "invalid-geometry" | "no-thumb-travel" | "rtl-horizontal"
    }

export interface ScrollbarThumbDragState {
  readonly element: HTMLElement
  readonly axis: ScrollbarDragAxis
  readonly trackStart: number
  readonly thumbTravel: number
  readonly scrollRange: number
  readonly pointerOffset: number
}

export type ScrollbarThumbDragStartResult =
  | { readonly status: "started"; readonly state: ScrollbarThumbDragState }
  | { readonly status: "track"; readonly axis: ScrollbarDragAxis }
  | { readonly status: "not-scrollbar" }

function numericCssPixel(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "")
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

function pointInsideRect(point: SpatialPoint, rect: ScrollbarThumbGeometry["gutter"]): boolean {
  return point.x >= rect.left && point.x <= rect.left + rect.width
    && point.y >= rect.top && point.y <= rect.top + rect.height
}

/**
 * Reconstruct the layout scrollbar track from the element's border box and
 * client box. Overlay scrollbars expose no gutter in that geometry, so they
 * remain explicit unsupported input instead of creating a broad edge target.
 */
export function scrollbarThumbGeometry(
  element: HTMLElement,
  axis: ScrollbarDragAxis,
): ScrollbarThumbGeometryResult {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const overflow = axis === "horizontal" ? style?.overflowX : style?.overflowY
  if (!overflow || !["auto", "scroll"].includes(overflow)) {
    return { status: "not-scrollable", reason: "overflow-disabled" }
  }
  if (axis === "horizontal" && style?.direction === "rtl") {
    return { status: "unsupported", reason: "rtl-horizontal" }
  }

  const viewportLength = axis === "horizontal" ? element.clientWidth : element.clientHeight
  const scrollLength = axis === "horizontal" ? element.scrollWidth : element.scrollHeight
  const rect = element.getBoundingClientRect()
  if (![viewportLength, scrollLength, rect.left, rect.top, rect.width, rect.height]
    .every(Number.isFinite)
    || viewportLength <= 0
    || scrollLength < 0
    || rect.width <= 0
    || rect.height <= 0) {
    return { status: "unsupported", reason: "invalid-geometry" }
  }
  if (!(scrollLength > viewportLength)) {
    return { status: "not-scrollable", reason: "not-overflowing" }
  }

  const borderLeft = numericCssPixel(style?.borderLeftWidth)
  const borderRight = numericCssPixel(style?.borderRightWidth)
  const borderTop = numericCssPixel(style?.borderTopWidth)
  const borderBottom = numericCssPixel(style?.borderBottomWidth)
  const gutterThickness = axis === "vertical"
    ? rect.width - borderLeft - borderRight - element.clientWidth
    : rect.height - borderTop - borderBottom - element.clientHeight
  if (!Number.isFinite(gutterThickness) || gutterThickness < 0) {
    return { status: "unsupported", reason: "invalid-geometry" }
  }
  if (gutterThickness === 0) {
    return { status: "unsupported", reason: "overlay-or-no-gutter" }
  }

  const trackLength = viewportLength
  const minimumThumbLength = Math.min(trackLength, gutterThickness)
  const thumbLength = Math.max(
    minimumThumbLength,
    trackLength * viewportLength / scrollLength,
  )
  const thumbTravel = trackLength - thumbLength
  if (!(thumbTravel > 0)) {
    return { status: "unsupported", reason: "no-thumb-travel" }
  }

  const scrollRange = scrollLength - viewportLength
  const rawScrollPosition = axis === "horizontal" ? element.scrollLeft : element.scrollTop
  const scrollPosition = Math.max(0, Math.min(scrollRange, rawScrollPosition))
  const clientLeft = Number.isFinite(element.clientLeft) ? element.clientLeft : borderLeft
  const clientTop = Number.isFinite(element.clientTop) ? element.clientTop : borderTop
  const verticalScrollbarOnLeft = axis === "vertical"
    && style?.direction === "rtl"
    && clientLeft > borderLeft + 0.5
  const gutter = axis === "vertical"
    ? {
        left: verticalScrollbarOnLeft
          ? rect.left + borderLeft
          : rect.left + rect.width - borderRight - gutterThickness,
        top: rect.top + clientTop,
        width: gutterThickness,
        height: trackLength,
      }
    : {
        left: rect.left + clientLeft,
        top: rect.top + rect.height - borderBottom - gutterThickness,
        width: trackLength,
        height: gutterThickness,
      }
  const trackStart = axis === "horizontal" ? gutter.left : gutter.top
  return {
    status: "ready",
    geometry: {
      axis,
      gutter,
      trackStart,
      trackLength,
      thumbStart: trackStart + scrollPosition / scrollRange * thumbTravel,
      thumbLength,
      thumbTravel,
      scrollRange,
    },
  }
}

export function beginScrollbarThumbDrag(
  element: HTMLElement,
  point: SpatialPoint,
): ScrollbarThumbDragStartResult {
  for (const axis of ["vertical", "horizontal"] as const) {
    const result = scrollbarThumbGeometry(element, axis)
    if (result.status !== "ready" || !pointInsideRect(point, result.geometry.gutter)) continue
    const coordinate = axis === "horizontal" ? point.x : point.y
    const thumbEnd = result.geometry.thumbStart + result.geometry.thumbLength
    if (coordinate < result.geometry.thumbStart || coordinate > thumbEnd) {
      return { status: "track", axis }
    }
    return {
      status: "started",
      state: {
        element,
        axis,
        trackStart: result.geometry.trackStart,
        thumbTravel: result.geometry.thumbTravel,
        scrollRange: result.geometry.scrollRange,
        pointerOffset: coordinate - result.geometry.thumbStart,
      },
    }
  }
  return { status: "not-scrollbar" }
}

export function findScrollbarThumbDrag(
  start: Element,
  sourceRoot: Element,
  point: SpatialPoint,
): ScrollbarThumbDragStartResult {
  let current: Element | null = start
  while (current && sourceRoot.contains(current)) {
    if (current instanceof HTMLElement) {
      const result = beginScrollbarThumbDrag(current, point)
      if (result.status !== "not-scrollbar") return result
    }
    if (current === sourceRoot) break
    current = current.parentElement
  }
  return { status: "not-scrollbar" }
}

function dispatchScrollEvent(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView
  element.dispatchEvent(new (view?.Event ?? Event)("scroll", { bubbles: true, composed: true }))
}

export function updateScrollbarThumbDrag(
  state: ScrollbarThumbDragState,
  point: SpatialPoint,
): { readonly changed: boolean; readonly position: ScrollPosition } {
  const coordinate = state.axis === "horizontal" ? point.x : point.y
  const thumbStart = Math.max(
    state.trackStart,
    Math.min(state.trackStart + state.thumbTravel, coordinate - state.pointerOffset),
  )
  const next = (thumbStart - state.trackStart) / state.thumbTravel * state.scrollRange
  const previous = state.axis === "horizontal" ? state.element.scrollLeft : state.element.scrollTop
  if (state.axis === "horizontal") state.element.scrollLeft = next
  else state.element.scrollTop = next
  const current = state.axis === "horizontal" ? state.element.scrollLeft : state.element.scrollTop
  const changed = current !== previous
  if (changed) dispatchScrollEvent(state.element)
  return {
    changed,
    position: { left: state.element.scrollLeft, top: state.element.scrollTop },
  }
}

export function clampScrollPosition(input: {
  readonly scrollLeft: number
  readonly scrollTop: number
  readonly clientWidth: number
  readonly clientHeight: number
  readonly scrollWidth: number
  readonly scrollHeight: number
  readonly deltaX: number
  readonly deltaY: number
}): ScrollPosition {
  const maxLeft = Math.max(0, input.scrollWidth - input.clientWidth)
  const maxTop = Math.max(0, input.scrollHeight - input.clientHeight)
  return {
    left: Math.max(0, Math.min(maxLeft, input.scrollLeft + input.deltaX)),
    top: Math.max(0, Math.min(maxTop, input.scrollTop + input.deltaY)),
  }
}

function isScrollable(element: HTMLElement): boolean {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const canScrollX = element.scrollWidth > element.clientWidth
    && style !== undefined
    && ["auto", "scroll"].includes(style.overflowX)
  const canScrollY = element.scrollHeight > element.clientHeight
    && style !== undefined
    && ["auto", "scroll"].includes(style.overflowY)
  return canScrollX || canScrollY
}

export function findScrollableAncestor(
  start: Element,
  sourceRoot: Element,
): HTMLElement | null {
  let current: Element | null = start
  while (current && sourceRoot.contains(current)) {
    if (current instanceof HTMLElement && isScrollable(current)) return current
    if (current === sourceRoot) break
    current = current.parentElement
  }
  return null
}

export function scrollElementBy(
  element: HTMLElement,
  deltaX: number,
  deltaY: number,
): { readonly changed: boolean; readonly position: ScrollPosition } {
  const position = clampScrollPosition({
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    deltaX,
    deltaY,
  })
  const changed = position.left !== element.scrollLeft || position.top !== element.scrollTop
  element.scrollLeft = position.left
  element.scrollTop = position.top
  if (changed) dispatchScrollEvent(element)
  return { changed, position }
}

export type NativeEscapeResult =
  | { readonly status: "not-required" }
  | { readonly status: "requested"; readonly method: "showPicker" | "click" }
  | { readonly status: "unsupported"; readonly message: string; readonly errorName?: string }

function isPickerBackedInput(input: HTMLInputElement): boolean {
  return ["file", "color", "date", "datetime-local", "month", "time", "week"].includes(input.type)
}

export function openNativePicker(
  target: Element,
  options: { readonly trustedSource: boolean },
): NativeEscapeResult {
  const isInput = target.tagName.toLowerCase() === "input"
  const isSelect = target.tagName.toLowerCase() === "select"
  if (!isSelect && !(isInput && isPickerBackedInput(target as HTMLInputElement))) {
    return { status: "not-required" }
  }
  if (!options.trustedSource) {
    return {
      status: "unsupported",
      message: "Native picker escape requires the original trusted input handler.",
      errorName: "NotAllowedError",
    }
  }

  const picker = target as Element & { showPicker?: () => void; click?: () => void }
  try {
    if (typeof picker.showPicker === "function") {
      picker.showPicker()
      return { status: "requested", method: "showPicker" }
    }
    if (typeof picker.click === "function") {
      picker.click()
      return { status: "requested", method: "click" }
    }
  } catch (error) {
    return {
      status: "unsupported",
      message: error instanceof Error ? error.message : String(error),
      errorName: error instanceof DOMException || error instanceof Error ? error.name : undefined,
    }
  }
  return { status: "unsupported", message: "No trusted picker activation API is available." }
}

export type RangeUpdateResult =
  | { readonly status: "updated"; readonly value: number; readonly changed: boolean }
  | { readonly status: "not-range" }
  | { readonly status: "unsupported"; readonly message: string }

export function updateRangeFromPoint(
  input: HTMLInputElement,
  point: SpatialPoint,
  options: { readonly commit?: boolean } = {},
): RangeUpdateResult {
  if (input.type !== "range") return { status: "not-range" }
  const style = input.ownerDocument.defaultView?.getComputedStyle(input)
  const direction = style?.direction || input.dir || "ltr"
  const writingMode = style?.writingMode || "horizontal-tb"
  if (direction !== "ltr" || writingMode !== "horizontal-tb") {
    return {
      status: "unsupported",
      message: `Range projection supports horizontal LTR only; got ${direction}/${writingMode}.`,
    }
  }
  const rect = input.getBoundingClientRect()
  if (rect.width <= 0) return { status: "unsupported", message: "Range has no horizontal box." }
  const parsedMin = input.min === "" ? Number.NaN : Number(input.min)
  const parsedMax = input.max === "" ? Number.NaN : Number(input.max)
  const parsedStep = input.step === "" ? Number.NaN : Number(input.step)
  const min = Number.isFinite(parsedMin) ? parsedMin : 0
  const max = Number.isFinite(parsedMax) && parsedMax >= min ? parsedMax : Math.max(min, 100)
  const step = input.step === "any" ? 0 : Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1
  const ratio = Math.max(0, Math.min(1, (point.x - rect.left) / rect.width))
  const raw = min + (max - min) * ratio
  const value = step > 0 ? min + Math.round((raw - min) / step) * step : raw
  const previous = input.value
  input.value = String(Math.max(min, Math.min(max, value)))
  const view = input.ownerDocument.defaultView
  input.dispatchEvent(new (view?.Event ?? Event)("input", { bubbles: true, composed: true }))
  if (options.commit) {
    input.dispatchEvent(new (view?.Event ?? Event)("change", { bubbles: true, composed: true }))
  }
  return {
    status: "updated",
    value: Number(input.value),
    changed: input.value !== previous,
  }
}

export type CaretPlacementResult =
  | { readonly status: "placed"; readonly method: "caretPositionFromPoint" | "caretRangeFromPoint" }
  | { readonly status: "unsupported"; readonly message: string }

export function placeCaretAtPoint(target: Element, point: SpatialPoint): CaretPlacementResult {
  const tag = target.tagName.toLowerCase()
  if (tag === "input" || tag === "textarea") {
    return {
      status: "unsupported",
      message: "Projected proportional-text caret placement is not browser-verifiable for input/textarea.",
    }
  }

  const documentWithCaret = target.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const selection = target.ownerDocument.defaultView?.getSelection()
  const caret = documentWithCaret.caretPositionFromPoint?.(point.x, point.y)
  if (caret && target.contains(caret.offsetNode) && selection) {
    const range = target.ownerDocument.createRange()
    range.setStart(caret.offsetNode, caret.offset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    return { status: "placed", method: "caretPositionFromPoint" }
  }
  const range = documentWithCaret.caretRangeFromPoint?.(point.x, point.y)
  if (range && target.contains(range.startContainer) && selection) {
    selection.removeAllRanges()
    selection.addRange(range)
    return { status: "placed", method: "caretRangeFromPoint" }
  }
  return {
    status: "unsupported",
    message: "No browser caret-from-point API resolved inside the contenteditable target.",
  }
}
