import { describe, expect, it } from "vitest"
import { platformWindowForLauncher } from "@/platform-apps"
import { windowGeometryToPose } from "./window-layout"
import { SpatialWindowSession } from "./window-session"

const viewport = { width: 1200, height: 800 }

function descriptor(id: "settings" | "assistant" | "play") {
  const result = platformWindowForLauncher(id)
  if (!result) throw new Error(`Missing ${id}`)
  return result
}

describe("SpatialWindowSession", () => {
  it("focuses by active state and z-order without moving any geometry", () => {
    const session = new SpatialWindowSession()
    const first = session.open(descriptor("settings"), viewport)
    const second = session.open(descriptor("assistant"), viewport)
    session.move(first.id, { x: -350, y: 0 }, viewport)
    const geometries = session.windows.map(({ worldX, worldY, width, height, sideDepth }) => ({
      worldX, worldY, width, height, sideDepth,
    }))
    const poses = session.windows.map((window) => windowGeometryToPose(window, viewport))
    session.focus(first.id)
    expect(session.windows.map(({ worldX, worldY, width, height, sideDepth }) => ({
      worldX, worldY, width, height, sideDepth,
    }))).toEqual(geometries)
    expect(session.windows.map((window) => windowGeometryToPose(window, viewport))).toEqual(poses)
    expect(session.activeWindowId).toBe(first.id)
    expect(second.zIndex).toBeLessThan(first.zIndex)
  })

  it("preserves geometry while releasing texture state and restoring before visible", () => {
    const session = new SpatialWindowSession()
    session.open(descriptor("settings"), viewport)
    const { worldX, worldY, width, height, sideDepth } = session.windows[0]
    session.minimize("settings")
    expect(session.windows[0]).toMatchObject({ minimized: true, textureState: "released" })
    session.focus("settings")
    expect(session.windows[0]).toMatchObject({ minimized: false, textureState: "restoring" })
    expect(session.windows[0]).toMatchObject({
      worldX,
      worldY,
      width,
      height,
      sideDepth,
    })
    session.markTextureActive("settings")
    expect(session.windows[0].textureState).toBe("active")
  })

  it("opens at about 58% by 72% on a 1920x1080 viewport", () => {
    const session = new SpatialWindowSession()
    const opened = session.open(descriptor("settings"), { width: 1920, height: 1080 })
    expect(opened).toMatchObject({ width: 1114, height: 778 })
  })

  it("does not mutate route, focus, or texture state when close is vetoed", async () => {
    const session = new SpatialWindowSession()
    session.open(descriptor("settings"), viewport)
    const before = structuredClone({
      active: session.activeWindowId,
      windows: session.windows.map((window) => ({ id: window.id, texture: window.textureState })),
    })
    expect(await session.close("settings", async () => false)).toBe(false)
    expect({
      active: session.activeWindowId,
      windows: session.windows.map((window) => ({ id: window.id, texture: window.textureState })),
    }).toEqual(before)
  })

  it("keeps guard approval separate from final removal and focus selection", async () => {
    const session = new SpatialWindowSession()
    session.open(descriptor("settings"), viewport)
    session.open(descriptor("assistant"), viewport)
    const before = structuredClone({
      active: session.activeWindowId,
      windows: session.windows.map((window) => window.id),
    })

    expect(await session.approveClose("assistant", async () => true)).toBe(true)
    expect({
      active: session.activeWindowId,
      windows: session.windows.map((window) => window.id),
    }).toEqual(before)

    expect(session.finalizeClose("assistant", () => false)?.id).toBe("assistant")
    expect(session.windows.map((window) => window.id)).toEqual(["settings"])
    expect(session.activeWindowId).toBe("")
    expect(session.finalizeClose("assistant")).toBeNull()
  })

  it("keeps repeated asynchronous close requests from removing a sibling window", async () => {
    const session = new SpatialWindowSession()
    session.open(descriptor("settings"), viewport)
    session.open(descriptor("assistant"), viewport)
    const allowClose: Array<() => void> = []
    const guard = () => new Promise<boolean>((resolve) => {
      allowClose.push(() => resolve(true))
    })
    const first = session.close("settings", guard)
    const second = session.close("settings", guard)
    for (const release of allowClose) release()
    expect(await Promise.all([first, second])).toEqual([true, false])
    expect(session.windows.map((window) => window.id)).toEqual(["assistant"])
  })

  it("rebuilds a fresh in-memory session from only the opened deep link", () => {
    const firstSession = new SpatialWindowSession()
    firstSession.open(descriptor("settings"), viewport)
    firstSession.open(descriptor("play"), viewport)
    const refreshed = new SpatialWindowSession()
    refreshed.open(descriptor("play"), viewport)
    expect(refreshed.windows.map((window) => window.id)).toEqual(["play"])
  })
})
