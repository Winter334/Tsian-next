// @vitest-environment happy-dom

import { createApp, defineComponent, h, markRaw, nextTick, ref, type App } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import type { PlatformLauncherDescriptor } from "@/platform-apps"
import SpatialLauncherSurface from "./SpatialLauncherSurface.vue"
import SpatialStatusSurface from "./SpatialStatusSurface.vue"
import SpatialDesktopContextSurface from "./SpatialDesktopContextSurface.vue"
import { SpatialShellMenuOutsidePointerGate } from "./use-spatial-shell-context-menu"
import {
  SPATIAL_DESKTOP_INPUT_SOURCE_ID,
  SPATIAL_DESKTOP_MENU_SOURCE_ID,
  SPATIAL_LAUNCHER_MENU_SOURCE_ID,
  SPATIAL_STATUS_MENU_SOURCE_ID,
  spatialShellMenuAnchorFromSourceClient,
  spatialShellMenuLayout,
} from "./spatial-shell-context-menu"

const mountedApps: Array<{ app: App; host: HTMLElement }> = []
const TestIcon = markRaw(defineComponent(() => () => h("span", { "aria-hidden": "true" })))
const launcher: PlatformLauncherDescriptor = {
  id: "market",
  label: "创意工坊",
  shortLabel: "工坊",
  routePath: "/market",
  icon: TestIcon,
  title: "创意工坊",
  caption: "分享与安装创意资源",
}

afterEach(() => {
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount()
    host.remove()
  }
  document.body.replaceChildren()
})

async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
}

function mount(render: () => ReturnType<typeof h>): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ setup: () => render })
  app.mount(host)
  mountedApps.push({ app, host })
  return host
}

describe("Spatial shell context menu", () => {
  it("defers trusted input-plane dismissal until projected ownership is known", () => {
    const gate = new SpatialShellMenuOutsidePointerGate()
    const menuClick = gate.beginTrustedPointer()
    expect(gate.recordSyntheticPointer(true)).toBe("keep")
    expect(gate.shouldCloseAfterProjection(menuClick)).toBe(false)

    const blankDesktopClick = gate.beginTrustedPointer()
    expect(gate.shouldCloseAfterProjection(blankDesktopClick)).toBe(true)

    const projectedOutsideClick = gate.beginTrustedPointer()
    expect(gate.recordSyntheticPointer(false)).toBe("close")
    gate.reset()
    expect(gate.shouldCloseAfterProjection(projectedOutsideClick)).toBe(false)
  })

  it("derives a bounded menu placement from Source-local projected coordinates", () => {
    const anchor = spatialShellMenuAnchorFromSourceClient(
      { left: 40, top: 60, width: 78, height: 300 },
      { x: 200, y: 20 },
    )
    expect(anchor).toEqual({ x: 118, y: 60 })

    const layout = spatialShellMenuLayout({ width: 320, height: 180 }, anchor, 3)
    expect(layout.x).toBeGreaterThanOrEqual(12)
    expect(layout.y).toBeGreaterThanOrEqual(12)
    expect(layout.x + layout.width).toBeLessThanOrEqual(308)
    expect(layout.y + layout.height).toBeLessThanOrEqual(168)
  })

  it("provides an input-only blank-desktop Source with pointer and keyboard menu paths", async () => {
    const minimizeCount = ref(0)
    const host = mount(() => h(SpatialDesktopContextSurface, {
      viewport: { width: 1024, height: 640 },
      onMinimizeAll: () => { minimizeCount.value += 1 },
    }))
    const desktop = host.querySelector<HTMLElement>(
      `[data-spatial-source="${SPATIAL_DESKTOP_INPUT_SOURCE_ID}"]`,
    )!
    expect(desktop.getAttribute("data-spatial-render")).toBe("none")
    Object.defineProperty(desktop, "getBoundingClientRect", {
      value: () => ({ left: 0, top: 0, width: 1024, height: 640 }),
    })

    desktop.dispatchEvent(new MouseEvent("contextmenu", {
      clientX: 512,
      clientY: 320,
      bubbles: true,
      cancelable: true,
    }))
    await settle()
    const pointerMenu = host.querySelector<HTMLElement>(
      `[data-spatial-source="${SPATIAL_DESKTOP_MENU_SOURCE_ID}"]`,
    )!
    pointerMenu.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click()
    expect(minimizeCount.value).toBe(1)

    desktop.focus()
    desktop.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }))
    await settle()
    const keyboardItem = host.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    keyboardItem.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }))
    await settle()
    expect(document.activeElement).toBe(desktop)
  })

  it("opens launcher actions from the keyboard, supports roving focus, and restores the opener", async () => {
    const minimizeCount = ref(0)
    const topologyCount = ref(0)
    const host = mount(() => h(SpatialLauncherSurface, {
      launchers: [launcher],
      activeAppId: "",
      viewport: { width: 1024, height: 640 },
      onMinimizeAll: () => { minimizeCount.value += 1 },
      onSourceTopologyChanged: () => { topologyCount.value += 1 },
    }))
    const launcherButton = host.querySelector<HTMLButtonElement>(".spatial-launcher-button")!
    Object.defineProperty(launcherButton, "getBoundingClientRect", {
      value: () => ({ left: 48, top: 80, width: 48, height: 48 }),
    })
    launcherButton.focus()
    launcherButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }))
    await settle()

    const menu = host.querySelector<HTMLElement>(
      `[data-spatial-source="${SPATIAL_LAUNCHER_MENU_SOURCE_ID}"]`,
    )!
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual(["打开创意工坊", "显示桌面"])
    expect(document.activeElement).toBe(items[0])

    items[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    expect(document.activeElement).toBe(items[1])
    items[1].click()
    await settle()
    expect(minimizeCount.value).toBe(1)
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_LAUNCHER_MENU_SOURCE_ID}"]`)).toBeNull()

    launcherButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ContextMenu",
      bubbles: true,
      cancelable: true,
    }))
    await settle()
    const restoredItem = host.querySelector<HTMLButtonElement>('[role="menuitem"]')!
    restoredItem.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }))
    await settle()
    expect(document.activeElement).toBe(launcherButton)
    expect(topologyCount.value).toBe(4)
  })

  it("closes after a trusted blank-desktop press with no projected target", async () => {
    const host = mount(() => h(SpatialLauncherSurface, {
      launchers: [launcher],
      activeAppId: "",
      viewport: { width: 1024, height: 640 },
    }))
    const launcherButton = host.querySelector<HTMLButtonElement>(".spatial-launcher-button")!
    Object.defineProperty(launcherButton, "getBoundingClientRect", {
      value: () => ({ left: 48, top: 80, width: 48, height: 48 }),
    })
    launcherButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ContextMenu",
      bubbles: true,
      cancelable: true,
    }))
    await settle()

    const inputPlane = document.createElement("div")
    document.body.append(inputPlane)
    const trustedInside = new Event("pointerdown", { bubbles: true, cancelable: true })
    Object.defineProperty(trustedInside, "isTrusted", { value: true })
    inputPlane.dispatchEvent(trustedInside)
    host.querySelector<HTMLElement>('[role="menuitem"]')
      ?.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }))
    await Promise.resolve()
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_LAUNCHER_MENU_SOURCE_ID}"]`))
      .not.toBeNull()

    const trustedBlank = new Event("pointerdown", { bubbles: true, cancelable: true })
    Object.defineProperty(trustedBlank, "isTrusted", { value: true })
    inputPlane.dispatchEvent(trustedBlank)
    await Promise.resolve()
    await settle()
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_LAUNCHER_MENU_SOURCE_ID}"]`))
      .toBeNull()
  })

  it("keeps desktop and Retro return actions inside the status-owned menu Source", async () => {
    const minimizeCount = ref(0)
    const retroCount = ref(0)
    const host = mount(() => h(SpatialStatusSurface, {
      windows: [],
      activeWindowId: "",
      viewport: { width: 1024, height: 640 },
      onMinimizeAll: () => { minimizeCount.value += 1 },
      onReturnRetro: () => { retroCount.value += 1 },
    }))
    const utilityButton = host.querySelector<HTMLButtonElement>(".spatial-status-surface__actions button")!
    Object.defineProperty(utilityButton, "getBoundingClientRect", {
      value: () => ({ left: 928, top: 440, width: 48, height: 48 }),
    })
    utilityButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "F10",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }))
    await settle()

    const menu = host.querySelector<HTMLElement>(
      `[data-spatial-source="${SPATIAL_STATUS_MENU_SOURCE_ID}"]`,
    )!
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items.map((item) => item.textContent)).toEqual(["显示桌面", "返回 RetroOS"])
    items[0].click()
    expect(minimizeCount.value).toBe(1)

    utilityButton.dispatchEvent(new KeyboardEvent("keydown", {
      key: "ContextMenu",
      bubbles: true,
      cancelable: true,
    }))
    await settle()
    host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[1].click()
    expect(retroCount.value).toBe(1)
  })
})
