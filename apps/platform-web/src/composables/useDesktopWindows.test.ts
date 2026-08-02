import { describe, expect, it } from "vitest"
import { desktopWindowForLauncher, desktopWindowForRoute } from "@/desktop-apps"
import { clearBeforeClose, setBeforeClose, useDesktopWindows } from "./useDesktopWindows"

describe("RetroOS desktop compatibility", () => {
  it("keeps launcher and parameterized route window identities", () => {
    expect(desktopWindowForLauncher("play")?.id).toBe("play")
    const detail = desktopWindowForRoute({
      name: "game-card-detail",
      fullPath: "/cards/card-1",
      params: { cardId: "card-1" },
      query: {},
    } as never)
    expect(detail?.id).toBe("game-launcher:card-1")
  })

  it("preserves state when a before-close guard vetoes", async () => {
    const desktop = useDesktopWindows()
    const input = desktopWindowForLauncher("settings")
    if (!input) throw new Error("Missing settings launcher")
    desktop.openWindow(input)
    setBeforeClose(input.id, async () => false)
    expect(await desktop.closeWindow(input.id)).toBe(false)
    expect(desktop.windows.value.map((window) => window.id)).toEqual([input.id])
    expect(desktop.activeWindowId.value).toBe(input.id)
    clearBeforeClose(input.id)
  })
})
