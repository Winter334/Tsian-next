import type { SpatialPoint } from "../projection"

export interface ScrollPosition {
  readonly left: number
  readonly top: number
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
  if (changed) {
    const view = element.ownerDocument.defaultView
    element.dispatchEvent(new (view?.Event ?? Event)("scroll", { bubbles: true, composed: true }))
  }
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
