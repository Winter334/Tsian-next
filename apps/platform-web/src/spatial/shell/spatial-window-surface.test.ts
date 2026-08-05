// @vitest-environment happy-dom

import { createApp, nextTick, reactive } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { platformWindowForLauncher } from "@/platform-apps"
import SpatialWindowSurface from "./SpatialWindowSurface.vue"
import { SpatialWindowSession } from "./window-session"

const mounted: Array<{ app: ReturnType<typeof createApp>; host: HTMLElement }> = []

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
})

describe("SpatialWindowSurface", () => {
  it("exposes accessible maximize/restore state and removes resize handles while maximized", async () => {
    const descriptor = platformWindowForLauncher("settings")
    if (!descriptor) throw new Error("Missing settings descriptor")
    const session = new SpatialWindowSession()
    const windowState = reactive(session.open(descriptor, { width: 1200, height: 800 }))
    const onMaximize = vi.fn()
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(SpatialWindowSurface, {
      window: windowState,
      active: true,
      onMaximize,
    })
    app.mount(host)
    mounted.push({ app, host })

    host.querySelector<HTMLButtonElement>('button[aria-label="最大化窗口"]')?.click()
    expect(onMaximize).toHaveBeenCalledWith("settings", true)
    expect(host.querySelectorAll(".spatial-resize-handle")).toHaveLength(8)

    windowState.maximized = true
    await nextTick()
    expect(host.querySelector(".spatial-window-surface--maximized")).not.toBeNull()
    expect(host.querySelector('button[aria-label="还原窗口"]')).not.toBeNull()
    expect(host.querySelectorAll(".spatial-resize-handle")).toHaveLength(0)
  })
})
