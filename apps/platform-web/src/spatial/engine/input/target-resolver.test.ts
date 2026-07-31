import { describe, expect, it } from "vitest"
import { selectTargetCandidate } from "./target-resolver"

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
