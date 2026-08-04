import { describe, expect, it } from "vitest"
import {
  beginScrollbarThumbDrag,
  clampScrollPosition,
  openNativePicker,
  placeCaretAtPoint,
  scrollbarThumbGeometry,
  updateScrollbarThumbDrag,
  updateRangeFromPoint,
} from "./native-controls"

function fakeScrollableElement(options: {
  readonly clientWidth?: number
  readonly clientHeight?: number
  readonly scrollWidth?: number
  readonly scrollHeight?: number
  readonly scrollLeft?: number
  readonly scrollTop?: number
  readonly rectWidth?: number
  readonly rectHeight?: number
  readonly overflowX?: string
  readonly overflowY?: string
  readonly direction?: string
  readonly clientLeft?: number
} = {}): { readonly element: HTMLElement; readonly events: string[] } {
  const events: string[] = []
  const element = {
    clientWidth: options.clientWidth ?? 100,
    clientHeight: options.clientHeight ?? 100,
    clientLeft: options.clientLeft ?? 1,
    clientTop: 1,
    scrollWidth: options.scrollWidth ?? 100,
    scrollHeight: options.scrollHeight ?? 400,
    scrollLeft: options.scrollLeft ?? 0,
    scrollTop: options.scrollTop ?? 100,
    ownerDocument: {
      defaultView: {
        Event,
        getComputedStyle: () => ({
          overflowX: options.overflowX ?? "auto",
          overflowY: options.overflowY ?? "auto",
          borderLeftWidth: "1px",
          borderRightWidth: "1px",
          borderTopWidth: "1px",
          borderBottomWidth: "1px",
          direction: options.direction ?? "ltr",
        }),
      },
    },
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width: options.rectWidth ?? 112,
      height: options.rectHeight ?? 102,
    }),
    dispatchEvent: (event: Event) => { events.push(event.type); return true },
  } as unknown as HTMLElement
  return { element, events }
}

describe("native control helpers", () => {
  it("clamps nested scroll mutations to both axes", () => {
    expect(clampScrollPosition({
      scrollLeft: 20,
      scrollTop: 80,
      clientWidth: 100,
      clientHeight: 100,
      scrollWidth: 250,
      scrollHeight: 300,
      deltaX: 1000,
      deltaY: -1000,
    })).toEqual({ left: 150, top: 0 })
  })

  it("does not create negative scroll ranges for undersized content", () => {
    expect(clampScrollPosition({
      scrollLeft: 0,
      scrollTop: 0,
      clientWidth: 200,
      clientHeight: 200,
      scrollWidth: 100,
      scrollHeight: 100,
      deltaX: 10,
      deltaY: 10,
    })).toEqual({ left: 0, top: 0 })
  })

  it("starts only from the vertical thumb and maps its travel to the scroll range", () => {
    const { element, events } = fakeScrollableElement()
    const geometry = scrollbarThumbGeometry(element, "vertical")
    expect(geometry.status).toBe("ready")
    if (geometry.status !== "ready") throw new Error("expected vertical scrollbar geometry")

    const started = beginScrollbarThumbDrag(element, {
      x: geometry.geometry.gutter.left + geometry.geometry.gutter.width / 2,
      y: geometry.geometry.thumbStart + 5,
    })
    expect(started).toMatchObject({ status: "started", state: { axis: "vertical" } })
    if (started.status !== "started") throw new Error("expected vertical thumb hit")

    const result = updateScrollbarThumbDrag(started.state, {
      x: geometry.geometry.gutter.left,
      y: geometry.geometry.thumbStart + 5 + geometry.geometry.thumbTravel / 3,
    })
    expect(result.changed).toBe(true)
    expect(result.position.top).toBeCloseTo(200)
    expect(events).toEqual(["scroll"])
  })

  it("maps horizontal thumb movement and clamps both ends", () => {
    const { element, events } = fakeScrollableElement({
      scrollWidth: 300,
      scrollHeight: 100,
      scrollLeft: 50,
      scrollTop: 0,
      rectWidth: 102,
      rectHeight: 112,
    })
    const geometry = scrollbarThumbGeometry(element, "horizontal")
    expect(geometry.status).toBe("ready")
    if (geometry.status !== "ready") throw new Error("expected horizontal scrollbar geometry")
    const started = beginScrollbarThumbDrag(element, {
      x: geometry.geometry.thumbStart + 5,
      y: geometry.geometry.gutter.top + geometry.geometry.gutter.height / 2,
    })
    if (started.status !== "started") throw new Error("expected horizontal thumb hit")

    expect(updateScrollbarThumbDrag(started.state, { x: 10_000, y: 0 }).position.left).toBe(200)
    expect(updateScrollbarThumbDrag(started.state, { x: 10_000, y: 0 }).changed).toBe(false)
    expect(updateScrollbarThumbDrag(started.state, { x: -10_000, y: 0 }).position.left).toBe(0)
    expect(events).toEqual(["scroll", "scroll"])
  })

  it("rejects track clicks, non-overflowing axes, and overlay scrollbars", () => {
    const { element } = fakeScrollableElement()
    const geometry = scrollbarThumbGeometry(element, "vertical")
    if (geometry.status !== "ready") throw new Error("expected vertical scrollbar geometry")
    expect(beginScrollbarThumbDrag(element, {
      x: geometry.geometry.gutter.left + 1,
      y: geometry.geometry.thumbStart + geometry.geometry.thumbLength + 5,
    })).toEqual({ status: "track", axis: "vertical" })

    const nonOverflowing = fakeScrollableElement({ scrollHeight: 100 }).element
    expect(scrollbarThumbGeometry(nonOverflowing, "vertical")).toEqual({
      status: "not-scrollable",
      reason: "not-overflowing",
    })

    const overlay = fakeScrollableElement({ rectWidth: 102 }).element
    expect(scrollbarThumbGeometry(overlay, "vertical")).toEqual({
      status: "unsupported",
      reason: "overlay-or-no-gutter",
    })
  })

  it("keeps disabled, RTL-horizontal, and invalid geometry explicit", () => {
    const overflowDisabled = fakeScrollableElement({ overflowY: "hidden" }).element
    expect(scrollbarThumbGeometry(overflowDisabled, "vertical")).toEqual({
      status: "not-scrollable",
      reason: "overflow-disabled",
    })

    const rtlHorizontal = fakeScrollableElement({
      direction: "rtl",
      scrollWidth: 300,
      scrollHeight: 100,
      rectWidth: 102,
      rectHeight: 112,
    }).element
    expect(scrollbarThumbGeometry(rtlHorizontal, "horizontal")).toEqual({
      status: "unsupported",
      reason: "rtl-horizontal",
    })

    const invalid = fakeScrollableElement({ scrollHeight: Number.POSITIVE_INFINITY }).element
    expect(scrollbarThumbGeometry(invalid, "vertical")).toEqual({
      status: "unsupported",
      reason: "invalid-geometry",
    })
  })

  it("places an RTL vertical gutter from the border and client-box offsets", () => {
    const element = fakeScrollableElement({ direction: "rtl", clientLeft: 11 }).element
    const geometry = scrollbarThumbGeometry(element, "vertical")
    if (geometry.status !== "ready") throw new Error("expected vertical scrollbar geometry")
    expect(geometry.geometry.gutter).toEqual({
      left: 11,
      top: 21,
      width: 10,
      height: 100,
    })
  })

  it("reports a verified horizontal LTR range mutation", () => {
    const events: string[] = []
    const input = {
      tagName: "INPUT",
      type: "range",
      min: "0",
      max: "100",
      step: "5",
      value: "0",
      dir: "ltr",
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ direction: "ltr", writingMode: "horizontal-tb" }),
          Event,
        },
      },
      getBoundingClientRect: () => ({ left: 10, width: 200 }),
      dispatchEvent: (event: Event) => { events.push(event.type); return true },
    } as unknown as HTMLInputElement

    expect(updateRangeFromPoint(input, { x: 110, y: 0 }, { commit: true })).toEqual({
      status: "updated",
      value: 50,
      changed: true,
    })
    expect(events).toEqual(["input", "change"])
  })

  it("uses native range defaults when min, max, and step attributes are absent", () => {
    const input = {
      tagName: "INPUT",
      type: "range",
      min: "",
      max: "",
      step: "",
      value: "0",
      dir: "ltr",
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ direction: "ltr", writingMode: "horizontal-tb" }),
          Event,
        },
      },
      getBoundingClientRect: () => ({ left: 0, width: 200 }),
      dispatchEvent: () => true,
    } as unknown as HTMLInputElement

    expect(updateRangeFromPoint(input, { x: 100, y: 0 })).toEqual({
      status: "updated",
      value: 50,
      changed: true,
    })
  })

  it("does not claim unsupported RTL or vertical ranges", () => {
    const input = {
      tagName: "INPUT",
      type: "range",
      dir: "rtl",
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ direction: "rtl", writingMode: "horizontal-tb" }),
        },
      },
    } as unknown as HTMLInputElement
    expect(updateRangeFromPoint(input, { x: 50, y: 10 })).toMatchObject({
      status: "unsupported",
    })
  })

  it("requires the original trusted task for picker escapes and exposes failures", () => {
    const input = { tagName: "INPUT", type: "file" } as HTMLInputElement
    expect(openNativePicker(input, { trustedSource: false })).toEqual({
      status: "unsupported",
      message: "Native picker escape requires the original trusted input handler.",
      errorName: "NotAllowedError",
    })
  })

  it("returns explicit unsupported for proportional input caret placement", () => {
    const input = { tagName: "INPUT", value: "iiiWWW" } as HTMLInputElement
    expect(placeCaretAtPoint(input, { x: 20, y: 10 })).toEqual({
      status: "unsupported",
      message: "Projected proportional-text caret placement is not browser-verifiable for input/textarea.",
    })
  })
})
