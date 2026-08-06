// @vitest-environment happy-dom

import { describe, expect, it } from "vitest"
import { PointerRouter, type RoutedPointerSample } from "./pointer-router"
import {
  gestureCaptureTargetForElement,
  selectTargetCandidate,
} from "./target-resolver"

describe("selectTargetCandidate", () => {
  it("honors elementsFromPoint z order", () => {
    expect(selectTargetCandidate([
      { target: "top", sourceId: "center" },
      { target: "bottom", sourceId: "center" },
    ], "center")).toMatchObject({ status: "hit", target: "top", sourceId: "center" })
  })

  it("excludes only ignored, genuinely hidden, and pointer-events-none geometry", () => {
    expect(selectTargetCandidate([
      { target: "plane", sourceId: null, ignored: true },
      { target: "hidden", sourceId: "left", hidden: true },
      { target: "transparent", sourceId: "left", pointerEventsNone: true },
      { target: "button", sourceId: "left" },
    ], "left")).toMatchObject({ status: "hit", target: "button" })
  })

  it("retains native-disabled geometry but suppresses activation", () => {
    expect(selectTargetCandidate([
      { target: "disabled", sourceId: "left", nativeDisabled: true },
      { target: "underneath", sourceId: "left" },
    ], "left")).toEqual({
      status: "hit",
      target: "disabled",
      sourceId: "left",
      policy: {
        activation: { allowed: false, reason: "native-disabled" },
        accessibility: { ariaHidden: false, ariaDisabled: false },
      },
    })
  })

  it("reports aria policy without erasing pointer geometry", () => {
    expect(selectTargetCandidate([
      {
        target: "aria-target",
        sourceId: "left",
        ariaHidden: true,
        ariaDisabled: true,
      },
    ], "left")).toEqual({
      status: "hit",
      target: "aria-target",
      sourceId: "left",
      policy: {
        activation: { allowed: true, reason: null },
        accessibility: { ariaHidden: true, ariaDisabled: true },
      },
    })
  })

  it("fails loudly when visual and DOM ownership disagree", () => {
    expect(selectTargetCandidate([
      { target: "right-overlay", sourceId: "right" },
      { target: "left-button", sourceId: "left" },
    ], "left")).toMatchObject({
      status: "ownership-mismatch",
      expectedSourceId: "left",
      actualSourceId: "right",
      target: "right-overlay",
    })
  })

  it("returns no hit without an expected visual source", () => {
    expect(selectTargetCandidate([{ target: "button", sourceId: "left" }], null))
      .toEqual({ status: "no-hit" })
  })
})

describe("gestureCaptureTargetForElement", () => {
  it("promotes drag chrome but preserves nested action activation", () => {
    const owner = document.createElement("section")
    owner.dataset.spatialGestureOwner = ""
    const header = document.createElement("header")
    header.dataset.spatialGestureStart = ""
    const title = document.createElement("span")
    const close = document.createElement("button")
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    close.append(icon)
    header.append(title, close)
    owner.append(header)

    expect(gestureCaptureTargetForElement(title, 0)).toBe(owner)
    expect(gestureCaptureTargetForElement(close, 0)).toBe(close)
    expect(gestureCaptureTargetForElement(icon, 0)).toBe(icon)
    expect(gestureCaptureTargetForElement(title, 2)).toBe(title)

    let closeCount = 0
    close.addEventListener("click", () => { closeCount += 1 })
    const sample: RoutedPointerSample = {
      pointerId: 9,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: 10,
      clientY: 10,
    }
    const router = new PointerRouter<Element>({
      chain: (target) => [owner, header, close, icon].filter((entry) => (
        entry === target || entry.contains(target)
      )),
      dispatch: () => true,
      focus: () => undefined,
      activate: (target) => {
        target.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        return { status: "requested", detail: "test activation" }
      },
      captureTarget: (target, routedSample) => (
        gestureCaptureTargetForElement(target, routedSample.button)
      ),
      setCapture: () => undefined,
      releaseCapture: () => undefined,
    })

    router.down(icon, sample)
    router.up(owner, { ...sample, buttons: 0 })

    expect(closeCount).toBe(1)
    expect(router.captureCount()).toBe(0)
  })
})
