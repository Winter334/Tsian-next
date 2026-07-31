import { describe, expect, it } from "vitest"
import {
  clampScrollPosition,
  openNativePicker,
  placeCaretAtPoint,
  updateRangeFromPoint,
} from "./native-controls"

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
