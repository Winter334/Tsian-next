import { describe, expect, it } from "vitest"
import { sourcePresentationBlocksInput } from "../engine/source-presentation"
import {
  SPATIAL_CONFIRM_PANEL_PRESENTATION_ID,
  SPATIAL_CONFIRM_PANEL_SOURCE_ID,
} from "./spatial-confirm"
import { SpatialWindowPresentationController } from "./window-presentation"

describe("SpatialWindowPresentationController", () => {
  it("waits for Source readiness, opens monotonically, and does not replay visible ids", () => {
    const presentation = new SpatialWindowPresentationController({ openMs: 400, closeMs: 300 })
    expect(presentation.mount("library")).toBe(true)
    expect(presentation.snapshots()[0]).toMatchObject({ phase: "capturing-open", progress: 0 })
    presentation.sourceReady("library", 100, true)
    const first = presentation.advance(200).snapshots[0].progress
    expect(presentation.advance(150).snapshots[0].progress).toBe(first)
    const second = presentation.advance(300).snapshots[0].progress
    expect(second).toBeGreaterThan(first)
    expect(presentation.advance(500).snapshots[0]).toMatchObject({ phase: "visible", progress: 1 })
    expect(presentation.mount("library")).toBe(false)
    expect(presentation.sourceReady("library", 600, true)).toEqual([])
  })

  it("retains custom Source presentation metadata while windows keep vertical defaults", () => {
    const presentation = new SpatialWindowPresentationController()
    presentation.mount("library")
    presentation.mount(SPATIAL_CONFIRM_PANEL_PRESENTATION_ID, {
      sourceId: SPATIAL_CONFIRM_PANEL_SOURCE_ID,
      apertureAxis: "horizontal",
    })

    expect(presentation.snapshots()).toEqual([
      expect.objectContaining({
        sourceId: "window:library",
        apertureAxis: "vertical",
      }),
      expect.objectContaining({
        sourceId: SPATIAL_CONFIRM_PANEL_SOURCE_ID,
        apertureAxis: "horizontal",
      }),
    ])
  })

  it("keeps the modal panel through its closing terminal frame", () => {
    const presentation = new SpatialWindowPresentationController({ openMs: 400, closeMs: 300 })
    presentation.mount(SPATIAL_CONFIRM_PANEL_PRESENTATION_ID, {
      sourceId: SPATIAL_CONFIRM_PANEL_SOURCE_ID,
      apertureAxis: "horizontal",
    })
    presentation.sourceReady(SPATIAL_CONFIRM_PANEL_PRESENTATION_ID, 100, true)
    expect(presentation.advance(500).snapshots.every(({ phase }) => phase === "visible")).toBe(true)

    presentation.beginGuard(SPATIAL_CONFIRM_PANEL_PRESENTATION_ID)
    presentation.startClosing(SPATIAL_CONFIRM_PANEL_PRESENTATION_ID, 600, true)
    expect(presentation.advance(750).snapshots[0].progress).toBeGreaterThan(0)

    const terminal = presentation.advance(900)
    expect(terminal.events).toEqual([
      { kind: "close-ready", windowId: SPATIAL_CONFIRM_PANEL_PRESENTATION_ID },
    ])
    expect(terminal.snapshots).toEqual([
      expect.objectContaining({ sourceId: SPATIAL_CONFIRM_PANEL_SOURCE_ID, phase: "closing", progress: 0 }),
    ])
    expect(presentation.completeClose(SPATIAL_CONFIRM_PANEL_PRESENTATION_ID)).toBe(true)
    expect(presentation.snapshots()).toHaveLength(0)
  })

  it("keeps guard veto stable and emits close completion exactly once", () => {
    const presentation = new SpatialWindowPresentationController({ openMs: 0, closeMs: 300 })
    presentation.mount("settings")
    presentation.sourceReady("settings", 0, false)
    expect(presentation.beginGuard("settings")).toBe(true)
    expect(presentation.cancelGuard("settings")).toBe(true)
    expect(presentation.snapshots()[0].phase).toBe("visible")
    presentation.beginGuard("settings")
    presentation.startClosing("settings", 100, true)
    expect(presentation.advance(250).events).toEqual([])
    expect(presentation.advance(400).events).toEqual([{ kind: "close-ready", windowId: "settings" }])
    expect(presentation.advance(500).events).toEqual([])
    expect(presentation.completeClose("settings")).toBe(true)
    expect(presentation.completeClose("settings")).toBe(false)
  })

  it("uses the same completion events for duration-zero and interruption settlement", () => {
    const presentation = new SpatialWindowPresentationController({ openMs: 400, closeMs: 300 })
    presentation.mount("market")
    expect(presentation.sourceReady("market", 0, false)).toEqual([
      { kind: "opened", windowId: "market" },
    ])
    presentation.beginGuard("market")
    expect(presentation.startClosing("market", 10, false)).toEqual([
      { kind: "close-ready", windowId: "market" },
    ])
  })

  it("advances concurrent windows independently and settles interruption through terminal events", () => {
    const presentation = new SpatialWindowPresentationController({ openMs: 400, closeMs: 300 })
    presentation.mount("settings")
    presentation.mount("assistant")
    presentation.sourceReady("settings", 0, true)
    presentation.sourceReady("assistant", 100, true)

    const concurrent = presentation.advance(200)
    const settings = concurrent.snapshots.find((snapshot) => snapshot.sourceId === "window:settings")
    const assistant = concurrent.snapshots.find((snapshot) => snapshot.sourceId === "window:assistant")
    expect(settings?.progress).toBeGreaterThan(assistant?.progress ?? 1)
    expect(concurrent.active).toBe(true)

    expect(presentation.settleMotion().events).toEqual([
      { kind: "opened", windowId: "settings" },
      { kind: "opened", windowId: "assistant" },
    ])
    presentation.beginGuard("assistant")
    presentation.startClosing("assistant", 250, true)
    expect(presentation.settleMotion().events).toEqual([
      { kind: "close-ready", windowId: "assistant" },
    ])
    expect(presentation.snapshots().find((snapshot) => snapshot.sourceId === "window:assistant"))
      .toMatchObject({ phase: "closing", progress: 0 })
  })

  it("blocks projected input for every non-visible lifecycle phase", () => {
    for (const phase of [
      "capturing-open",
      "opening",
      "guard-pending",
      "closing",
    ] as const) {
      expect(sourcePresentationBlocksInput({
        sourceId: "window:settings",
        phase,
        progress: phase === "closing" || phase === "guard-pending" ? 1 : 0,
      })).toBe(true)
    }
    expect(sourcePresentationBlocksInput({
      sourceId: "window:settings",
      phase: "visible",
      progress: 1,
    })).toBe(false)
  })
})
