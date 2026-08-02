/// <reference types="node" />

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import desktopSource from "./SpatialDesktopShell.vue?raw"
import launcherSource from "./SpatialLauncherSurface.vue?raw"
import statusSource from "./SpatialStatusSurface.vue?raw"
import wallpaperClockSource from "./SpatialWallpaperClock.vue?raw"
import surfaceSource from "./SpatialWindowSurface.vue?raw"
import presentationSource from "./window-presentation.ts?raw"
import viewportControllerSource from "../engine/viewport-controller.ts?raw"

const shellStyles = readFileSync(new URL("./spatial-shell.css", import.meta.url), "utf8")
const environmentShaders = readFileSync(
  new URL("../engine/shaders/environment.ts", import.meta.url),
  "utf8",
)

function ruleBody(selector: string, containing?: string): string {
  const marker = `${selector} {`
  const bodies: string[] = []
  let searchFrom = 0
  while (searchFrom < shellStyles.length) {
    const ruleStart = shellStyles.indexOf(marker, searchFrom)
    if (ruleStart < 0) break
    const bodyStart = shellStyles.indexOf("{", ruleStart) + 1
    const bodyEnd = shellStyles.indexOf("}", bodyStart)
    if (bodyEnd > bodyStart) bodies.push(shellStyles.slice(bodyStart, bodyEnd))
    searchFrom = bodyEnd + 1
  }
  const body = containing
    ? bodies.find((candidate) => candidate.includes(containing))
    : bodies[0]
  expect(body, `missing CSS rule ${selector}${containing ? ` containing ${containing}` : ""}`)
    .toBeDefined()
  return body ?? ""
}

describe("Spatial product window DOM", () => {
  it("uses a protruding title block and controls integrated into the top chrome", () => {
    const titleTab = surfaceSource.indexOf('class="spatial-window-title-tab"')
    const titleTabClose = surfaceSource.indexOf("</header>", titleTab)
    const controlTab = surfaceSource.indexOf('class="spatial-window-control-tab"')

    expect(titleTab).toBeGreaterThan(0)
    expect(titleTabClose).toBeGreaterThan(titleTab)
    expect(controlTab).toBeGreaterThan(titleTabClose)
    expect(surfaceSource).not.toContain("spatial-window-titlebar")
    expect(surfaceSource.match(/@pointerdown\.stop="beginDrag"/g)).toHaveLength(3)
    expect(surfaceSource.match(/@pointermove="continueInteraction"/g)).toHaveLength(1)
    expect(surfaceSource.match(/@pointerup="endInteraction"/g)).toHaveLength(1)
    expect(surfaceSource.match(/@pointercancel="endInteraction"/g)).toHaveLength(1)
    expect(surfaceSource).toContain("data-spatial-gesture-owner")
    expect(surfaceSource.match(/data-spatial-gesture-start/g)).toHaveLength(3)
    expect(surfaceSource).toContain('@pointerdown="beginSurfacePointerDown"')
    expect(surfaceSource).toMatch(/aria-label="窗口控制"\s+@pointerdown\.stop="beginDrag"/)
    expect(surfaceSource.match(/type="button"/g)).toHaveLength(2)
    expect(surfaceSource).toContain('aria-label="最小化"')
    expect(surfaceSource).toContain('aria-label="关闭"')
    expect(desktopSource).toContain('windowStyle: "flat-neutral"')
  })

  it("keeps pointer resize local to the semantic handles and window root", () => {
    expect(surfaceSource).toContain(
      '["n", "ne", "e", "se", "s", "sw", "w", "nw"]',
    )
    expect(surfaceSource).toContain('role="separator"')
    expect(surfaceSource).toContain('tabindex="0"')
    expect(surfaceSource).toContain('@pointerdown.stop="beginResize(direction, $event)"')
    expect(surfaceSource).toContain('@keydown="resizeWithKeyboard(direction, $event)"')
    expect(surfaceSource).not.toContain("surfaceEdgeHit")
    expect(surfaceSource).toContain('kind: "move" | "resize"')
    expect(surfaceSource).toContain("pointerId: number")
    expect(surfaceSource).toContain("direction?: SpatialResizeDirection")
    expect(surfaceSource).toContain("x: event.clientX - interaction.localX")
    expect(surfaceSource).toContain("emitLocalDelta(event")
    expect(surfaceSource).toContain("emitScreenDelta(event")
    expect(viewportControllerSource).not.toContain("classifyWindowResizeDirection")
    expect(viewportControllerSource).not.toContain("onWindowResize")
    expect(desktopSource).not.toContain("onWindowResize:")
  })
})

describe("Spatial shell Docks", () => {
  it("keeps launcher and task entries in two direct, deterministic shell Sources", () => {
    expect(launcherSource).toContain('data-spatial-source="shell:launcher"')
    expect(launcherSource).toContain('data-spatial-z="10"')
    expect(launcherSource).toContain('v-for="launcher in launchers"')
    expect(launcherSource).not.toContain('v-for="window in windows"')
    expect(statusSource).toContain('data-spatial-source="shell:status"')
    expect(statusSource).toContain('data-spatial-z="11"')
    expect(statusSource).toContain('v-if="windows.length > 0"')
    expect(statusSource).toContain('v-for="window in windows"')
    expect(statusSource).toContain(':is="window.descriptor.icon"')
    expect(statusSource).toContain("spatial-task-button--minimized")
    expect(statusSource.match(/class="spatial-dock-button(?: |")/g)).toHaveLength(3)
    expect(launcherSource).not.toContain("SpatialDockMark")
    expect(statusSource).not.toContain("SpatialDockMark")
    expect(statusSource).not.toContain("spatial-status-surface__readout")
    expect(statusSource).not.toContain("statusLabel")
    expect(statusSource).not.toContain("windowCount")
    expect(desktopSource).not.toContain(':status-label="viewportSnapshot.status"')
    expect(desktopSource).not.toContain(':window-count="session.windows.length"')
    expect(desktopSource).toContain(
      "const viewportSnapshot = ref<SpatialViewportSnapshot>(INITIAL_VIEWPORT_SNAPSHOT)",
    )
    expect(desktopSource).toContain("viewportSnapshot.value = snapshot")
    expect(desktopSource.indexOf("<SpatialLauncherSurface")).toBeLessThan(
      desktopSource.indexOf("<SpatialStatusSurface"),
    )
    expect(desktopSource.indexOf("<SpatialStatusSurface")).toBeLessThan(
      desktopSource.indexOf("<SpatialWindowSurface"),
    )
  })

  it("uses centered safe-inset flat capsule Docks with five visible items and hidden scrollbars", () => {
    const dockRootStart = shellStyles.indexOf(".spatial-launcher-surface,")
    const dockRoot = shellStyles.slice(dockRootStart, shellStyles.indexOf("}", dockRootStart) + 1)
    const dockButton = ruleBody(".spatial-dock-button")
    const activeButton = ruleBody(".spatial-launcher-button--active")
    const exitButton = ruleBody(".spatial-status-surface__exit")
    const statusTasks = ruleBody(".spatial-status-surface__tasks")
    const dockStyles = shellStyles.slice(
      dockRootStart,
      shellStyles.indexOf(".spatial-window-surface {", dockRootStart),
    )

    expect(shellStyles).toContain("--spatial-dock-width: 78px")
    expect(shellStyles).toContain("--spatial-dock-item-size: 48px")
    expect(shellStyles).toContain("--spatial-dock-list-height: 276px")
    expect(shellStyles).toContain("--spatial-dock-capsule-fill: rgb(239 237 231 / 40%)")
    expect(shellStyles).toContain("--spatial-dock-capsule-outline: rgb(255 250 242 / 52%)")
    expect(shellStyles).toContain("--spatial-dock-control-fill: rgb(230 227 221 / 58%)")
    expect(shellStyles).toContain("--spatial-dock-control-outline: rgb(54 54 58 / 24%)")
    expect(shellStyles).toContain("--spatial-dock-control-ink: rgb(45 46 50 / 76%)")
    expect(shellStyles).toContain("transform-origin: top left")
    expect(desktopSource).toContain("function applyDockLayouts()")
    expect(desktopSource).toContain("Math.max(48, Math.min(72, viewport.value.width * 0.04))")
    expect(desktopSource).toContain("viewport.value.width - inset - width")
    expect(desktopSource).toContain("(viewport.value.height - height) / 2")
    expect(desktopSource).toContain("() => session.windows.length")
    expect(desktopSource).toContain('requestSourcePaint("shell:status")')
    expect(shellStyles).toContain("overflow-y: auto")
    expect(shellStyles).toContain("scrollbar-width: none")
    expect(statusTasks).toContain("height: auto")
    expect(statusTasks).toContain("max-height: var(--spatial-dock-list-height)")
    expect(dockButton).toContain("width: var(--spatial-dock-item-size)")
    expect(dockButton).toContain("height: var(--spatial-dock-item-size)")
    expect(dockButton).toContain("border-radius: 50%")
    expect(dockButton).toContain("background: var(--spatial-dock-control-fill)")
    expect(dockButton).toContain("box-shadow: none")
    expect(dockRoot).toContain("border: 1px solid var(--spatial-dock-capsule-outline)")
    expect(dockRoot).toContain("border-radius: 999px")
    expect(dockRoot).toContain("background: var(--spatial-dock-capsule-fill)")
    expect(shellStyles).not.toContain("--spatial-dock-rail")
    expect(shellStyles).not.toContain(".spatial-dock-scroll::before")
    expect(shellStyles).not.toContain(".spatial-status-surface__actions::before")
    expect(shellStyles).not.toContain("spatial-dock-button__mark")
    expect(activeButton).toContain("border-color: rgb(211 75 85 / 72%)")
    expect(activeButton).toContain("background: rgb(27 28 31 / 88%)")
    expect(exitButton).toContain("background: rgb(211 75 85 / 92%)")
    expect(dockRoot).toContain("box-shadow: none")
    expect(shellStyles).not.toContain("spatial-status-surface__readout")
    expect(dockStyles).not.toMatch(/gradient\(|drop-shadow\(|blur\(|scale\(|rotate\(|perspective\(/)
    expect(dockStyles).not.toContain("backdrop-filter")
  })
})

describe("Spatial wallpaper clock", () => {
  it("is a sharp non-interactive low-z Source before Docks and windows", () => {
    const clock = ruleBody(".spatial-wallpaper-clock")
    const time = ruleBody(".spatial-wallpaper-clock__time")
    const date = ruleBody(".spatial-wallpaper-clock__date")

    expect(desktopSource.indexOf("<SpatialWallpaperClock")).toBeGreaterThan(
      desktopSource.indexOf("<canvas"),
    )
    expect(desktopSource.indexOf("<SpatialWallpaperClock")).toBeLessThan(
      desktopSource.indexOf("<SpatialLauncherSurface"),
    )
    expect(desktopSource).toContain(':timestamp="clockTimestamp"')
    expect(desktopSource).toContain("setInterval(updateClockTimestamp, 1_000)")
    expect(wallpaperClockSource).toContain('data-spatial-source="shell:clock"')
    expect(wallpaperClockSource).toContain('data-spatial-z="1"')
    expect(wallpaperClockSource).toContain('data-spatial-parallax-factor="0"')
    expect(wallpaperClockSource).toContain('data-spatial-input="none"')
    expect(statusSource).not.toContain("<time")
    expect(statusSource).not.toContain("time: string")
    expect(clock).toContain("pointer-events: none")
    expect(clock).toContain("transform-origin: top left")
    expect(desktopSource).toContain("function applyClockLayout()")
    expect(desktopSource).toContain("Math.max(16, Math.min(48, viewport.value.width * 0.025))")
    expect(desktopSource).toContain("Math.max(16, Math.min(48, viewport.value.height * 0.03))")
    expect(desktopSource).toContain("viewport.value.width - right - width")
    expect(desktopSource).toContain("viewport.value.height - bottom - height")
    expect(desktopSource).toContain('requestSourcePaint("shell:clock")')
    expect(clock).not.toContain("filter")
    expect(clock).not.toContain("background")
    expect(clock).not.toContain("opacity")
    expect(clock).not.toContain("blend")
    expect(clock).not.toContain("backdrop")
    expect(time).toContain("0 0 18px rgb(255 246 232 / 22%)")
    expect(time).toContain("0 0 34px rgb(186 35 48 / 8%)")
    expect(time).toContain("0 2px 12px rgb(2 8 18 / 52%)")
    expect(date).toContain("0 0 18px rgb(255 246 232 / 22%)")
    expect(date).toContain("0 2px 12px rgb(2 8 18 / 52%)")
    expect(ruleBody(".spatial-desktop-canvas")).toContain("z-index: 10")
  })
})

describe("Spatial wallpaper ring", () => {
  it("is renderer-owned with opposite orbits and deterministic radial bars", () => {
    expect(desktopSource).not.toContain("<SpatialWallpaperRing")
    expect(shellStyles).not.toContain(".spatial-wallpaper-ring")
    expect(environmentShaders).toContain("ENVIRONMENT_DECORATION_FRAGMENT_SHADER")
    expect(environmentShaders).toContain("u_time * TAU / 72.0")
    expect(environmentShaders).toContain("-u_time * TAU / 96.0")
    expect(environmentShaders).toContain("angle / TAU * 72.0")
    expect(environmentShaders).toContain("vec3 paleRed")
  })
})

describe("Spatial product window CSS", () => {
  it("captures one continuous warm frame and top chrome around the flat off-white body", () => {
    const surface = ruleBody(".spatial-window-surface", "background: var(--spatial-window-body)")
    const titleTab = ruleBody(".spatial-window-title-tab", "justify-self: start")
    const controlTab = ruleBody(".spatial-window-control-tab", "justify-self: end")
    const content = ruleBody(".spatial-window-content")
    const dragStrip = ruleBody(".spatial-window-top-drag-strip")
    const resizeHandle = ruleBody(".spatial-resize-handle")
    const topResizeSize = ruleBody(".spatial-resize-handle--n", "height: 8px")
    const topResizePosition = ruleBody(".spatial-resize-handle--n", "top: 0")

    expect(surface).toContain("border: 3px solid var(--spatial-window-frame)")
    expect(surface).toContain("background: var(--spatial-window-body)")
    expect(surface).toContain("box-shadow: none")
    expect(surface).not.toContain("gradient")
    expect(shellStyles).not.toContain(".spatial-window-surface::before")
    expect(titleTab).toContain("width: min(44%, 320px)")
    expect(titleTab).toContain("justify-self: start")
    expect(titleTab).toContain("clip-path: polygon(")
    expect(controlTab).toContain("justify-self: end")
    expect(controlTab).toContain("background: transparent")
    expect(content).toContain("background: transparent")
    expect(shellStyles).toContain("--spatial-window-body: rgb(241 240 234 / 91%)")
    expect(shellStyles).toContain("--spatial-window-tab: rgb(37 39 43 / 95%)")
    expect(shellStyles).toContain("--spatial-window-accent: rgb(211 75 85 / 96%)")
    expect(shellStyles).not.toContain(".spatial-window-surface--active")
    expect(shellStyles).not.toContain(".spatial-window-surface::after")
    expect(dragStrip).toContain("top: 3px")
    expect(dragStrip).toContain("height: 28px")
    expect(resizeHandle).toContain("z-index: 8")
    expect(topResizeSize).toContain("height: 8px")
    expect(topResizePosition).toContain("top: 0")
    expect(shellStyles).toContain(
      ".spatial-resize-handle--s { right: 12px; left: 12px; height: 8px; cursor: ns-resize; }",
    )
    expect(shellStyles).toContain(
      ".spatial-resize-handle--w { top: 12px; bottom: 12px; width: 8px; cursor: ew-resize; }",
    )
    expect(shellStyles).toContain(
      ".spatial-resize-handle--sw { width: 14px; height: 14px; }",
    )
    expect(shellStyles).toContain(".spatial-resize-handle--s { bottom: 0; }")
    expect(shellStyles).toContain(".spatial-resize-handle--e { right: 0; }")
    expect(shellStyles).toContain(".spatial-resize-handle--w { left: 0; }")
    expect(shellStyles).toContain(".spatial-resize-handle--ne { top: 0; right: 0;")
    expect(shellStyles).toContain(".spatial-resize-handle--nw { top: 0; left: 0;")
    expect(shellStyles).toContain(".spatial-resize-handle--se { right: 0; bottom: 0;")
    expect(shellStyles).toContain(".spatial-resize-handle--sw { bottom: 0; left: 0;")
    expect(shellStyles).not.toMatch(/spatial-resize-handle--(?:n|s|e|w|ne|nw|se|sw)[^}]*-3px/)
    expect(surfaceSource).toContain("spatial-window-top-drag-strip")
    expect(surfaceSource).toContain("@pointerdown.stop=\"beginDrag\"")
  })

  it("keeps content and window chrome free of shell-added focus frames", () => {
    const pending = ruleBody(".spatial-pending-app")
    const pendingHeading = ruleBody(".spatial-pending-app h2")
    const pendingInput = ruleBody(".spatial-pending-app__probe input")

    expect(pending).toContain("color: var(--spatial-window-ink)")
    expect(pending).toContain("background: transparent")
    expect(pending).not.toContain("gradient")
    expect(pending).not.toContain("background-size")
    expect(pendingHeading).toContain("color: #1c1e22")
    expect(pendingInput).toContain("color: var(--spatial-window-ink)")
    expect(shellStyles).not.toContain(".spatial-window-surface input:focus-visible")
    expect(shellStyles).not.toContain(".spatial-window-control-tab button:focus-visible")
    expect(shellStyles).not.toContain(".spatial-resize-handle:focus-visible")
    expect(shellStyles).toContain(".spatial-window-control-tab button[data-spatial-hover]")
    expect(shellStyles).toContain(".spatial-window-control-tab button:focus,")
    expect(shellStyles).toContain("outline: none")
  })
})

describe("Spatial product window presentation lifecycle", () => {
  it("keeps guard approval, GPU contraction, and final removal in strict sequence", () => {
    const approval = desktopSource.indexOf("approved = await session.approveClose(id)")
    const contraction = desktopSource.indexOf("presentation.startClosing(id")
    const removal = desktopSource.indexOf("session.finalizeClose(")

    expect(approval).toBeGreaterThan(0)
    expect(contraction).toBeGreaterThan(approval)
    expect(removal).toBeGreaterThan(contraction)
    expect(desktopSource.match(/session\.finalizeClose\(/g)).toHaveLength(1)
    expect(desktopSource).toContain("closeRequests.has(id)")
    expect(desktopSource).toContain("afterRender: presentationFrame.events.length > 0")
    expect(desktopSource).toContain("viewportController?.updateSourcePresentations(presentation.snapshots())")
  })

  it("keeps transition progress out of captured Source content and dirty uploads", () => {
    expect(desktopSource).not.toContain("data-spatial-presentation")
    expect(surfaceSource).not.toContain("presentation.progress")
    expect(presentationSource).not.toContain("requestSourcePaint")
    expect(presentationSource).not.toContain("markDirty")
    expect(presentationSource).not.toContain("texElementImage2D")
    expect(desktopSource).toContain('continueReasons: presentationFrame.active ? ["transition"] : []')
  })

  it("rejects stale captured input before projection and retries a failed initial snapshot", () => {
    const capturedExclusion = viewportControllerSource.indexOf(
      "this.sourceInputUnavailable(capturedSource.sourceId)",
    )
    const capturedProjection = viewportControllerSource.indexOf(
      "projectCapturedSceneSource(",
      capturedExclusion,
    )

    expect(capturedExclusion).toBeGreaterThan(0)
    expect(capturedExclusion).toBeLessThan(capturedProjection)
    expect(viewportControllerSource).toContain('status: "source-input-unavailable"')
    expect(viewportControllerSource).toContain(
      "report.uploadBatch.failures.some((failure) => failure.retryable)",
    )
    expect(viewportControllerSource).toContain("this.capabilities?.requestPaint()")
    expect(desktopSource).toContain("presentation.sourceReady(id")
    expect(viewportControllerSource).toContain("schedulePendingSourceCaptureRetry()")
    expect(viewportControllerSource).toContain("SOURCE_CAPTURE_PAINT_RETRY_LIMIT")
    expect(viewportControllerSource).toContain("window.setTimeout")
    expect(viewportControllerSource).toContain('this.scheduler?.request("restore")')
    expect(viewportControllerSource).not.toContain('continueReasons.push("restore")')
    expect(viewportControllerSource).toContain("if (this.sourceInputUnavailable(sourceId)) continue")
  })
})
