<template>
  <section ref="shellRef" class="spatial-desktop-shell" @keydown="onShellKeydown">
    <canvas ref="canvasRef" layoutsubtree class="spatial-desktop-canvas">
      <SpatialDesktopContextSurface
        :viewport="viewport"
        @minimize-all="minimizeAll"
        @source-topology-changed="handleShellSourceTopologyChanged"
        @source-dirty="handleGlobalSourceDirty"
      />
      <SpatialWallpaperClock :timestamp="clockTimestamp" />
      <SpatialLauncherSurface
        :launchers="platformLaunchers"
        :active-app-id="session.activeWindow?.descriptor.appId ?? ''"
        :viewport="viewport"
        @open="openLauncher"
        @minimize-all="minimizeAll"
        @source-topology-changed="handleShellSourceTopologyChanged"
        @source-dirty="handleGlobalSourceDirty"
      />
      <SpatialStatusSurface
        :windows="session.windows"
        :active-window-id="session.activeWindowId"
        :viewport="viewport"
        @focus="focusWindow"
        @minimize-all="minimizeAll"
        @return-retro="returnToRetro"
        @source-topology-changed="handleShellSourceTopologyChanged"
        @source-dirty="handleGlobalSourceDirty"
      />
      <SpatialWindowSurface
        v-for="window in session.windows"
        :key="window.id"
        :window="window"
        :active="window.id === session.activeWindowId"
        @focus="focusWindow"
        @minimize="minimizeWindow"
        @close="closeWindow"
        @move="moveWindow"
        @resize="resizeWindow"
        @settle="settleWindow"
      />
      <SpatialGlobalSurfaceHost
        :confirm-interactive="confirmInteractive"
        :dialog-interactive="dialogInteractive"
        @sources-changed="handleGlobalSourcesChanged"
        @source-dirty="handleGlobalSourceDirty"
        @request-confirm-close="requestGlobalConfirmClose"
        @request-dialog-close="requestGlobalDialogClose"
      />
    </canvas>

    <div ref="inputPlaneRef" class="spatial-desktop-input-plane" aria-hidden="true" />
  </section>
</template>

<script setup lang="ts">
import { markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue"
import { useRoute, useRouter } from "vue-router"
import {
  platformLaunchers,
  platformWindowForLauncher,
  platformWindowForRoute,
  type PlatformAppId,
  type PlatformWindowDescriptor,
} from "@/platform-apps"
import {
  SPATIAL_MIN_VIEWPORT,
  switchPlatformUiMode,
} from "@/config/platform-ui-mode"
import { resolveConfirm } from "@/composables/useConfirm"
import { resolveDialogForm } from "@/composables/useDialogForm"
import {
  INITIAL_VIEWPORT_SNAPSHOT,
  SpatialViewportController,
  type SpatialViewportSnapshot,
} from "../engine/viewport-controller"
import { StaticImageEnvironmentBase } from "../engine/environment-base"
import { SPATIAL_DESKTOP_ENVIRONMENT_EFFECTS } from "./environment-presentation"
import {
  SpatialWindowPresentationController,
  SPATIAL_WINDOW_PRESENTATION_RENDER_OPTIONS,
  SPATIAL_WINDOW_RIPPLE_RENDER_OPTIONS,
  type SpatialWindowPresentationEvent,
  type SpatialWindowPresentationFrame,
} from "./window-presentation"
import { resolveWindowMinimizeOriginUv } from "./window-ripple-origin"
import {
  windowGeometryToPose,
  type SpatialResizeDirection,
  type SpatialViewportSize,
} from "./window-layout"
import { useSpatialWindowSession } from "./useSpatialWindowSession"
import type { SpatialWindowState } from "./window-session"
import type { SpatialShellFallback } from "./shell-types"
import SpatialLauncherSurface from "./SpatialLauncherSurface.vue"
import SpatialDesktopContextSurface from "./SpatialDesktopContextSurface.vue"
import SpatialGlobalSurfaceHost from "./SpatialGlobalSurfaceHost.vue"
import SpatialStatusSurface from "./SpatialStatusSurface.vue"
import SpatialWallpaperClock from "./SpatialWallpaperClock.vue"
import SpatialWindowSurface from "./SpatialWindowSurface.vue"
import {
  SPATIAL_CONFIRM_PANEL_SOURCE_ID,
  SPATIAL_CONFIRM_PANEL_PRESENTATION_ID,
  spatialConfirmPanelLayout,
} from "./spatial-confirm"
import {
  SPATIAL_DIALOG_PANEL_PRESENTATION_ID,
  SPATIAL_DIALOG_PANEL_SOURCE_ID,
  SPATIAL_MODAL_SHIELD_SOURCE_ID,
  SPATIAL_TOAST_SOURCE_ID,
  spatialDialogPanelLayout,
  spatialGlobalModalTakesInput,
  spatialToastLayout,
} from "./spatial-global-surfaces"
import { SpatialGlobalModalCloseLifecycle } from "./spatial-global-modal-lifecycle"
import wallpaperUrl from "./assets/spatial-desktop-background.jpg"
import "./spatial-shell.css"
import { SPATIAL_DESKTOP_INPUT_SOURCE_ID } from "./spatial-shell-context-menu"

const emit = defineEmits<{
  (event: "fallback", fallback: SpatialShellFallback): void
}>()

const route = useRoute()
const router = useRouter()
const { session } = useSpatialWindowSession()
const presentation = new SpatialWindowPresentationController()
const confirmPresentation = new SpatialWindowPresentationController()
const globalModalCloseLifecycle = new SpatialGlobalModalCloseLifecycle()
const confirmInteractive = ref(false)
const dialogInteractive = ref(false)
const shellRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const inputPlaneRef = ref<HTMLElement | null>(null)
const viewport = ref<SpatialViewportSize>({ width: window.innerWidth, height: window.innerHeight })
const viewportSnapshot = ref<SpatialViewportSnapshot>(INITIAL_VIEWPORT_SNAPSHOT)
const clockTimestamp = ref(Date.now())
let viewportController: SpatialViewportController | null = null
let resizeObserver: ResizeObserver | null = null
let clockTimer: number | null = null
let fallbackEmitted = false
let pointerMedia: MediaQueryList | null = null
const dirtyWindowSources = new Set<string>()
const closeRequests = new Set<string>()
let presentationSupported = false
let ripplePresentationSupported = false
let reducedMotion = false
let contextAvailable = true
let shellDisposed = false
let minimizeAllGroupCounter = 0
const minimizeAllGroups = new Map<number, Set<string>>()
const minimizeAllGroupByWindow = new Map<string, number>()
const confirmPresentationIds = Object.freeze([
  SPATIAL_CONFIRM_PANEL_PRESENTATION_ID,
] as const)
const dialogPresentationIds = Object.freeze([
  SPATIAL_DIALOG_PANEL_PRESENTATION_ID,
] as const)
let activeGlobalSourceIds = new Set<string>()

function applyDockLayouts(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const inset = Math.max(48, Math.min(72, viewport.value.width * 0.04))
  const docks = [
    {
      element: canvas.querySelector<HTMLElement>('[data-spatial-source="shell:launcher"]'),
      side: "left" as const,
    },
    {
      element: canvas.querySelector<HTMLElement>('[data-spatial-source="shell:status"]'),
      side: "right" as const,
    },
  ]
  for (const { element, side } of docks) {
    if (!element) continue
    const rect = element.getBoundingClientRect()
    const width = element.offsetWidth || rect.width
    const height = element.offsetHeight || rect.height
    if (width <= 0 || height <= 0) continue
    const x = side === "left"
      ? inset
      : viewport.value.width - inset - width
    const y = (viewport.value.height - height) / 2
    const transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    if (element.style.transform !== transform) element.style.transform = transform
  }
}

function applyDesktopInputLayout(): void {
  const surface = canvasRef.value?.querySelector<HTMLElement>(
    `[data-spatial-source="${SPATIAL_DESKTOP_INPUT_SOURCE_ID}"]`,
  )
  if (!surface) return
  const width = `${Math.round(viewport.value.width)}px`
  const height = `${Math.round(viewport.value.height)}px`
  if (surface.style.width !== width) surface.style.width = width
  if (surface.style.height !== height) surface.style.height = height
  if (surface.style.transform !== "translate3d(0px, 0px, 0px)") {
    surface.style.transform = "translate3d(0px, 0px, 0px)"
  }
}

function applyClockLayout(): void {
  const clock = canvasRef.value?.querySelector<HTMLElement>('[data-spatial-source="shell:clock"]')
  if (!clock) return
  const width = Math.max(320, Math.min(560, viewport.value.width * 0.29))
  const right = Math.max(16, Math.min(48, viewport.value.width * 0.025))
  const bottom = Math.max(16, Math.min(48, viewport.value.height * 0.03))
  const widthStyle = `${Math.round(width)}px`
  if (clock.style.width !== widthStyle) clock.style.width = widthStyle
  const height = clock.offsetHeight || clock.getBoundingClientRect().height
  if (height <= 0) return
  const x = viewport.value.width - right - width
  const y = viewport.value.height - bottom - height
  const transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
  if (clock.style.transform !== transform) clock.style.transform = transform
}

function applyGlobalSurfaceLayouts(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const shield = canvas.querySelector<HTMLElement>(
    `[data-spatial-source="${SPATIAL_MODAL_SHIELD_SOURCE_ID}"]`,
  )
  if (shield) {
    const width = `${Math.round(viewport.value.width)}px`
    const height = `${Math.round(viewport.value.height)}px`
    if (shield.style.width !== width) shield.style.width = width
    if (shield.style.height !== height) shield.style.height = height
    if (shield.style.transform !== "translate3d(0px, 0px, 0px)") {
      shield.style.transform = "translate3d(0px, 0px, 0px)"
    }
  }

  const confirmPanel = canvas.querySelector<HTMLElement>(
    `[data-spatial-source="${SPATIAL_CONFIRM_PANEL_SOURCE_ID}"]`,
  )
  if (confirmPanel) {
    const initial = spatialConfirmPanelLayout(viewport.value, confirmPanel.offsetHeight)
    applyGlobalSurfaceLayout(confirmPanel, initial)
    applyGlobalSurfaceLayout(
      confirmPanel,
      spatialConfirmPanelLayout(viewport.value, confirmPanel.offsetHeight),
    )
  }

  const dialogPanel = canvas.querySelector<HTMLElement>(
    `[data-spatial-source="${SPATIAL_DIALOG_PANEL_SOURCE_ID}"]`,
  )
  if (dialogPanel) {
    const preferredWidth = Number(dialogPanel.dataset.spatialPreferredWidth)
    const width = Number.isFinite(preferredWidth) && preferredWidth > 0 ? preferredWidth : 480
    const initial = spatialDialogPanelLayout(viewport.value, dialogPanel.offsetHeight, width)
    applyGlobalSurfaceLayout(dialogPanel, initial)
    applyGlobalSurfaceLayout(
      dialogPanel,
      spatialDialogPanelLayout(viewport.value, dialogPanel.offsetHeight, width),
    )
  }

  const toastPanel = canvas.querySelector<HTMLElement>(
    `[data-spatial-source="${SPATIAL_TOAST_SOURCE_ID}"]`,
  )
  if (toastPanel) applyGlobalSurfaceLayout(toastPanel, spatialToastLayout(viewport.value))

}

function applyGlobalSurfaceLayout(
  element: HTMLElement,
  layout: { width: number; maxHeight: number; x: number; y: number },
): void {
  const width = `${layout.width}px`
  const maxHeight = `${layout.maxHeight}px`
  const transform = `translate3d(${layout.x}px, ${layout.y}px, 0)`
  if (element.style.width !== width) element.style.width = width
  if (element.style.maxHeight !== maxHeight) element.style.maxHeight = maxHeight
  if (element.style.transform !== transform) element.style.transform = transform
}

function mountGlobalModalPresentation(presentationId: string, sourceId: string): void {
  const panelMounted = confirmPresentation.mount(presentationId, {
    sourceId,
    apertureAxis: "horizontal",
  })
  if (!panelMounted) return
  syncGlobalModalInteractivity()
}

function handleGlobalSourcesChanged(sourceIds: readonly string[]): void {
  const nextGlobalSourceIds = new Set(sourceIds)
  if (spatialGlobalModalTakesInput(activeGlobalSourceIds, nextGlobalSourceIds)) {
    viewportController?.cancelProjectedInput()
  }
  activeGlobalSourceIds = nextGlobalSourceIds
  const panels = [
    [SPATIAL_CONFIRM_PANEL_PRESENTATION_ID, SPATIAL_CONFIRM_PANEL_SOURCE_ID],
    [SPATIAL_DIALOG_PANEL_PRESENTATION_ID, SPATIAL_DIALOG_PANEL_SOURCE_ID],
  ] as const
  for (const [presentationId, sourceId] of panels) {
    if (activeGlobalSourceIds.has(sourceId)) {
      mountGlobalModalPresentation(presentationId, sourceId)
    } else {
      confirmPresentation.forget(presentationId)
      globalModalCloseLifecycle.forget(presentationId)
    }
  }
  syncGlobalModalInteractivity()
  applyGlobalSurfaceLayouts()
  viewportController?.syncSources()
}

function handleGlobalSourceDirty(sourceId: string): void {
  applyGlobalSurfaceLayouts()
  viewportController?.requestSourcePaint(sourceId)
}

function handleShellSourceTopologyChanged(): void {
  void nextTick(() => {
    viewportController?.syncSources()
    viewportController?.requestFrame("dirty")
  })
}

function globalPresentationIdForSource(sourceId: string): string | null {
  if (sourceId === SPATIAL_CONFIRM_PANEL_SOURCE_ID) {
    return SPATIAL_CONFIRM_PANEL_PRESENTATION_ID
  }
  if (sourceId === SPATIAL_DIALOG_PANEL_SOURCE_ID) {
    return SPATIAL_DIALOG_PANEL_PRESENTATION_ID
  }
  return null
}

function handleGlobalModalSourceReady(sourceId: string): boolean {
  const presentationId = globalPresentationIdForSource(sourceId)
  if (!presentationId) return false
  if (confirmPresentation.phase(presentationId) !== "capturing-open") {
    viewportController?.requestFrame("dirty")
    return true
  }

  const timestamp = performance.now()
  const events = confirmPresentation.sourceReady(
    presentationId,
    timestamp,
    apertureMotionEnabled(),
  )
  syncPresentationInput()
  if (events.length > 0) handleGlobalModalPresentationEvents(events)
  if (confirmPresentation.phase(presentationId) === "opening") {
    viewportController?.requestFrame("transition")
  } else {
    viewportController?.requestFrame("dirty")
  }
  return true
}

function requestGlobalConfirmClose(value: boolean | string | null): void {
  if (!confirmInteractive.value) return
  requestGlobalModalClose(globalModalCloseLifecycle.requestConfirm(
    confirmPresentation,
    value,
    performance.now(),
    apertureMotionEnabled(),
  ))
}

function requestGlobalDialogClose(confirm: boolean): void {
  if (!dialogInteractive.value) return
  requestGlobalModalClose(globalModalCloseLifecycle.requestDialog(
    confirmPresentation,
    confirm,
    performance.now(),
    apertureMotionEnabled(),
  ))
}

function requestGlobalModalClose(
  request: { accepted: boolean; events: readonly SpatialWindowPresentationEvent[] },
): void {
  if (!request.accepted) return
  syncGlobalModalInteractivity()
  if (request.events.length > 0) handleGlobalModalPresentationEvents(request.events)
  viewportController?.requestFrame(globalModalCloseLifecycle.hasPending ? "transition" : "dirty")
}

function syncGlobalModalInteractivity(): void {
  const confirmIsTop = activeGlobalSourceIds.has(SPATIAL_CONFIRM_PANEL_SOURCE_ID)
  confirmInteractive.value = confirmIsTop
    && !globalModalCloseLifecycle.confirmPending
    && confirmPresentation.allVisible(confirmPresentationIds)
  dialogInteractive.value = !confirmIsTop
    && activeGlobalSourceIds.has(SPATIAL_DIALOG_PANEL_SOURCE_ID)
    && !globalModalCloseLifecycle.dialogPending
    && confirmPresentation.allVisible(dialogPresentationIds)
  syncPresentationInput()
}

watch(
  () => route.fullPath,
  () => {
    const descriptor = platformWindowForRoute(route)
    if (!descriptor) return
    openDescriptor(descriptor, false)
  },
  { immediate: true },
)

watch(
  () => session.windows.length,
  () => {
    void nextTick(() => {
      applyDockLayouts()
      viewportController?.syncSources()
      viewportController?.requestSourcePaint("shell:status")
    })
  },
)

function layoutStyle(window: SpatialWindowState): Record<string, string> {
  return {
    width: `${window.width}px`,
    height: `${window.height}px`,
    transform: `translate3d(${window.worldX}px, ${window.worldY}px, 0)`,
  }
}

function applyWindowLayouts(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const elements = new Map(
    [...canvas.querySelectorAll<HTMLElement>("[data-spatial-window-id]")]
      .map((element) => [element.dataset.spatialWindowId ?? "", element]),
  )
  for (const window of session.windows) {
    const element = elements.get(window.id)
    if (!element) continue
    const style = layoutStyle(window)
    if (element.style.width !== style.width) element.style.width = style.width
    if (element.style.height !== style.height) element.style.height = style.height
    if (element.style.transform !== style.transform) element.style.transform = style.transform
    const pose = windowGeometryToPose(window, viewport.value)
    setDatasetValue(element, "spatialDepth", String(pose.depth))
    setDatasetValue(element, "spatialYaw", String(pose.yaw))
    setDatasetValue(element, "spatialPitch", String(pose.pitch))
    setDatasetValue(element, "spatialScale", String(pose.scale))
    setDatasetValue(element, "spatialCurveHalfAngle", String(pose.curveHalfAngle))
    setDatasetValue(element, "spatialZ", String(window.zIndex))
    if (window.id === session.activeWindowId) {
      setDatasetValue(element, "spatialWindowActive", "true")
    } else if (element.dataset.spatialWindowActive !== undefined) {
      delete element.dataset.spatialWindowActive
    }
  }
}

function setDatasetValue(
  element: HTMLElement,
  key: string,
  value: string,
): void {
  if (element.dataset[key] !== value) element.dataset[key] = value
}

function openDescriptor(descriptor: PlatformWindowDescriptor, navigate: boolean): void {
  const existing = session.get(descriptor.id)
  if (existing && presentation.phase(existing.id) === "minimized") {
    restoreWindow(existing.id, navigate)
    return
  }
  if (existing && presentation.phase(existing.id) !== "visible") return
  const window = session.open(markRaw(descriptor), viewport.value)
  if (!existing) {
    presentation.mount(window.id)
    syncPresentationInput()
  }
  // Existing windows already have Source nodes; update z/focus pose metadata
  // synchronously before any restore or frame request can observe stale order.
  applyWindowLayouts()
  if (window.textureState === "restoring") {
    viewportController?.restoreSource(`window:${window.id}`)
  }
  viewportController?.requestFrame("dirty")
  void nextTick(() => {
    applyWindowLayouts()
    viewportController?.syncSources()
    viewportController?.requestSourcePaint(`window:${window.id}`)
  })
  if (navigate) navigateTo(descriptor.routePath)
}

function openLauncher(appId: PlatformAppId): void {
  const descriptor = platformWindowForLauncher(appId)
  if (descriptor) openDescriptor(descriptor, true)
}

function focusWindow(id: string): void {
  if (presentation.phase(id) === "minimized") {
    restoreWindow(id, true)
    return
  }
  if (!presentation.isCommandAvailable(id)) return
  const target = session.focus(id)
  if (!target) return
  applyWindowLayouts()
  if (target.textureState === "restoring") {
    viewportController?.restoreSource(`window:${id}`)
  }
  viewportController?.requestFrame("dirty")
  navigateTo(target.descriptor.routePath)
}

function minimizeWindow(id: string): void {
  if (!presentation.isCommandAvailable(id)) return
  const events = presentation.startMinimizing(
    id,
    resolveWindowMinimizeOriginUv(windowSourceRoot(id)),
    performance.now(),
    rippleMotionEnabled(),
  )
  if (presentation.phase(id) !== "minimizing") return
  syncPresentationInput()
  if (events.length > 0) handlePresentationEvents(events)
  else viewportController?.requestFrame("transition")
}

function minimizeAll(): void {
  const candidates = session.windows.filter((window) => !window.minimized)
  // Reject the aggregate command while any candidate is already in a
  // lifecycle transition. Otherwise a repeated minimize-all can observe no
  // command-available windows and route home before the in-flight group has
  // reached its terminal minimized state.
  if (!presentation.allVisible(candidates.map((window) => window.id))) return
  if (candidates.length === 0) {
    navigateTo("/")
    return
  }
  minimizeAllGroupCounter += 1
  const groupId = minimizeAllGroupCounter
  const pending = new Set(candidates.map((window) => window.id))
  minimizeAllGroups.set(groupId, pending)
  for (const id of pending) minimizeAllGroupByWindow.set(id, groupId)

  const events: SpatialWindowPresentationEvent[] = []
  const timestamp = performance.now()
  for (const window of candidates) {
    events.push(...presentation.startMinimizing(
      window.id,
      resolveWindowMinimizeOriginUv(windowSourceRoot(window.id)),
      timestamp,
      rippleMotionEnabled(),
    ))
    if (presentation.phase(window.id) !== "minimizing") {
      pending.delete(window.id)
      minimizeAllGroupByWindow.delete(window.id)
    }
  }
  if (pending.size === 0) {
    minimizeAllGroups.delete(groupId)
    navigateTo("/")
    return
  }
  syncPresentationInput()
  if (events.length > 0) handlePresentationEvents(events)
  if (minimizeAllGroups.has(groupId)) viewportController?.requestFrame("transition")
}

function restoreWindow(id: string, navigate: boolean): void {
  const target = session.get(id)
  if (!target || !target.minimized || !presentation.beginRestore(id)) return
  const restored = session.focus(id)
  if (!restored) return
  applyWindowLayouts()
  syncPresentationInput()
  viewportController?.restoreSource(`window:${id}`)
  viewportController?.requestFrame("dirty")
  void nextTick(() => {
    applyWindowLayouts()
    viewportController?.syncSources()
    viewportController?.requestSourcePaint(`window:${id}`)
  })
  if (navigate) navigateTo(restored.descriptor.routePath)
}

function windowSourceRoot(id: string): HTMLElement | null {
  return [...(canvasRef.value?.querySelectorAll<HTMLElement>("[data-spatial-window-id]") ?? [])]
    .find((element) => element.dataset.spatialWindowId === id) ?? null
}

async function closeWindow(id: string): Promise<void> {
  if (shellDisposed || closeRequests.has(id) || !presentation.beginGuard(id)) return
  closeRequests.add(id)
  syncPresentationInput()
  viewportController?.requestFrame("dirty")
  let approved = false
  try {
    approved = await session.approveClose(id)
  } catch {
    approved = false
  }
  if (shellDisposed) return
  if (!approved) {
    presentation.cancelGuard(id)
    closeRequests.delete(id)
    syncPresentationInput()
    viewportController?.requestFrame("dirty")
    return
  }
  const events = presentation.startClosing(id, performance.now(), apertureMotionEnabled())
  syncPresentationInput()
  if (events.length > 0) handlePresentationEvents(events)
  else viewportController?.requestFrame("transition")
}

function moveWindow(id: string, delta: { x: number; y: number }): void {
  if (!presentation.isCommandAvailable(id)) return
  session.move(id, delta, viewport.value)
  refreshWindowSource(id)
}

function resizeWindow(
  id: string,
  direction: SpatialResizeDirection,
  delta: { x: number; y: number },
): void {
  if (!presentation.isCommandAvailable(id)) return
  session.resize(id, direction, delta, viewport.value)
  refreshWindowSource(id)
}

function settleWindow(id: string): void {
  if (!presentation.isCommandAvailable(id)) return
  session.settle(id, viewport.value)
  refreshWindowSource(id)
}

function refreshWindowSource(id: string): void {
  applyWindowLayouts()
  dirtyWindowSources.add(`window:${id}`)
  viewportController?.requestFrame("dirty")
}

function syncRouteToActiveWindow(): void {
  void nextTick(() => navigateTo(session.activeWindow?.descriptor.routePath ?? "/"))
}

function navigateTo(path: string): void {
  if (router.currentRoute.value.fullPath !== path) void router.push(path)
}

async function returnToRetro(): Promise<void> {
  await switchPlatformUiMode("retro")
}

function onShellKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === "Space") {
    event.preventDefault()
    canvasRef.value?.querySelector<HTMLElement>(".spatial-launcher-button")?.focus()
    return
  }
  if (event.key === "F6" && session.windows.length > 0) {
    event.preventDefault()
    const visible = session.windows.filter((window) => (
      !window.minimized && presentation.isCommandAvailable(window.id)
    ))
    if (visible.length === 0) return
    const current = visible.findIndex((window) => window.id === session.activeWindowId)
    const offset = event.shiftKey ? -1 : 1
    const index = (current + offset + visible.length) % visible.length
    focusWindow(visible[index].id)
    return
  }
  if (event.altKey && event.key.toLowerCase() === "m" && session.activeWindowId) {
    event.preventDefault()
    minimizeWindow(session.activeWindowId)
  }
  if (event.altKey && event.key.toLowerCase() === "w" && session.activeWindowId) {
    event.preventDefault()
    void closeWindow(session.activeWindowId)
  }
}

function updateViewport(): void {
  const rect = shellRef.value?.getBoundingClientRect()
  if (!rect) return
  viewport.value = { width: rect.width, height: rect.height }
  if (rect.width < SPATIAL_MIN_VIEWPORT.width || rect.height < SPATIAL_MIN_VIEWPORT.height) {
    emitFallback("device-eligibility", `Spatial Desktop 需要至少 ${SPATIAL_MIN_VIEWPORT.width}×${SPATIAL_MIN_VIEWPORT.height} 的视口。`)
    return
  }
  session.clampAll(viewport.value)
  applyDesktopInputLayout()
  applyDockLayouts()
  applyClockLayout()
  applyGlobalSurfaceLayouts()
  applyWindowLayouts()
  for (const window of session.windows) dirtyWindowSources.add(`window:${window.id}`)
  viewportController?.requestFrame("dirty")
}

function emitFallback(code: SpatialShellFallback["code"], message: string): void {
  if (fallbackEmitted) return
  fallbackEmitted = true
  emit("fallback", { code, message })
}

function updateClockTimestamp(): void {
  clockTimestamp.value = Date.now()
  void nextTick(() => viewportController?.requestSourcePaint("shell:clock"))
}

function apertureMotionEnabled(): boolean {
  return presentationSupported && contextAvailable && !reducedMotion
}

function rippleMotionEnabled(): boolean {
  return ripplePresentationSupported && contextAvailable && !reducedMotion
}

function syncPresentationInput(): void {
  viewportController?.updateSourcePresentations([
    ...presentation.snapshots(),
    ...confirmPresentation.snapshots(),
  ])
}

function applyPresentationSettlement(
  frame: SpatialWindowPresentationFrame,
  confirmFrame?: SpatialWindowPresentationFrame,
): void {
  syncPresentationInput()
  if (frame.events.length > 0) handlePresentationEvents(frame.events)
  if (confirmFrame && confirmFrame.events.length > 0) {
    handleGlobalModalPresentationEvents(confirmFrame.events)
  }
  viewportController?.requestFrame("dirty")
}

function settleApertureMotion(): void {
  applyPresentationSettlement(
    presentation.settleApertureMotion(),
    confirmPresentation.settleApertureMotion(),
  )
}

function settleRippleMotion(): void {
  applyPresentationSettlement(presentation.settleRippleMotion())
}

function settleAllPresentationMotion(): void {
  applyPresentationSettlement(
    presentation.settleMotion(),
    confirmPresentation.settleMotion(),
  )
}

function settlePresentationForContextLoss(): void {
  applyPresentationSettlement(
    presentation.settleForContextLoss(),
    confirmPresentation.settleForContextLoss(),
  )
}

function handleGlobalModalPresentationEvents(
  events: readonly SpatialWindowPresentationEvent[],
): void {
  const resolutions = globalModalCloseLifecycle.complete(confirmPresentation, events)
  syncGlobalModalInteractivity()
  if (resolutions.confirm) resolveConfirm(resolutions.confirm.value)
  if (resolutions.dialog) resolveDialogForm(resolutions.dialog.confirm)
}

function handlePresentationEvents(events: readonly SpatialWindowPresentationEvent[]): void {
  for (const event of events) {
    if (event.kind === "close-ready") finalizeApprovedClose(event.windowId)
    else if (event.kind === "minimize-ready") {
      finalizeMinimize(event.windowId, event.effectId)
    } else if (event.kind === "restored") {
      finalizeRestore(event.windowId, event.effectId)
    }
  }
}

function finalizeMinimize(id: string, effectId: number): void {
  if (shellDisposed || !presentation.completeMinimize(id, effectId)) return
  const wasActive = session.activeWindowId === id
  const minimized = session.minimize(
    id,
    (candidate) => presentation.isCommandAvailable(candidate.id),
  )
  syncPresentationInput()
  if (!minimized) return
  applyWindowLayouts()
  viewportController?.releaseSource(`window:${id}`)
  viewportController?.requestFrame("dirty")

  const groupId = minimizeAllGroupByWindow.get(id)
  if (groupId !== undefined) {
    minimizeAllGroupByWindow.delete(id)
    const pending = minimizeAllGroups.get(groupId)
    pending?.delete(id)
    if (pending && pending.size === 0) {
      minimizeAllGroups.delete(groupId)
      navigateTo("/")
    }
  } else if (wasActive) {
    syncRouteToActiveWindow()
  }
}

function finalizeRestore(id: string, effectId: number): void {
  if (shellDisposed || !presentation.completeRestore(id, effectId)) return
  session.markTextureActive(id)
  applyWindowLayouts()
  syncPresentationInput()
  viewportController?.requestFrame("dirty")
}

function finalizeApprovedClose(id: string): void {
  if (shellDisposed || !presentation.completeClose(id)) return
  syncPresentationInput()
  const wasActive = session.activeWindowId === id
  const removed = session.finalizeClose(
    id,
    (candidate) => presentation.isCommandAvailable(candidate.id),
  )
  closeRequests.delete(id)
  if (!removed) return
  if (wasActive) syncRouteToActiveWindow()
  void nextTick(() => {
    applyWindowLayouts()
    viewportController?.syncSources()
    viewportController?.requestFrame("dirty")
  })
}

onMounted(async () => {
  await nextTick()
  const canvas = canvasRef.value
  const inputPlane = inputPlaneRef.value
  if (!canvas || !inputPlane) {
    emitFallback("renderer", "Spatial Desktop 无法建立渲染表面。")
    return
  }
  const shellRect = shellRef.value?.getBoundingClientRect()
  if (shellRect) viewport.value = { width: shellRect.width, height: shellRect.height }
  applyDesktopInputLayout()
  applyDockLayouts()
  applyClockLayout()
  applyWindowLayouts()
  viewportController = new SpatialViewportController({
    canvas,
    inputPlane,
    projectedCursorFallback: "default",
    environmentBase: new StaticImageEnvironmentBase(wallpaperUrl, { coverOverscan: 1 }),
    environmentEffects: SPATIAL_DESKTOP_ENVIRONMENT_EFFECTS,
    windowPresentation: SPATIAL_WINDOW_PRESENTATION_RENDER_OPTIONS,
    windowRipplePresentation: SPATIAL_WINDOW_RIPPLE_RENDER_OPTIONS,
    windowStyle: "flat-neutral",
    onSnapshot: (snapshot) => {
      viewportSnapshot.value = snapshot
      if (snapshot.status === "unsupported") emitFallback("runtime-capability", snapshot.supportMessage)
      if (snapshot.status === "error") emitFallback("renderer", snapshot.supportMessage)
    },
    beforeRender: (frame) => {
      applyGlobalSurfaceLayouts()
      applyWindowLayouts()
      for (const sourceId of dirtyWindowSources) viewportController?.requestSourcePaint(sourceId)
      dirtyWindowSources.clear()
      const presentationFrame = presentation.advance(frame.timestamp)
      const confirmPresentationFrame = confirmPresentation.advance(frame.timestamp)
      const hasPresentationEvents = presentationFrame.events.length > 0
        || confirmPresentationFrame.events.length > 0
      return {
        continueReasons: presentationFrame.active || confirmPresentationFrame.active
          ? ["transition"]
          : [],
        sourcePresentations: [
          ...presentationFrame.snapshots,
          ...confirmPresentationFrame.snapshots,
        ],
        afterRender: hasPresentationEvents
          ? () => {
              if (presentationFrame.events.length > 0) {
                handlePresentationEvents(presentationFrame.events)
              }
              if (confirmPresentationFrame.events.length > 0) {
                handleGlobalModalPresentationEvents(confirmPresentationFrame.events)
              }
            }
          : undefined,
      }
    },
    onSourceReady: (sourceId) => {
      if (handleGlobalModalSourceReady(sourceId)) return
      if (!sourceId.startsWith("window:")) return
      const id = sourceId.slice("window:".length)
      const phase = presentation.phase(id)
      if (phase !== "capturing-restore") session.markTextureActive(id)
      const events = presentation.sourceReady(
        id,
        performance.now(),
        phase === "capturing-restore" ? rippleMotionEnabled() : apertureMotionEnabled(),
      )
      syncPresentationInput()
      if (events.length > 0) handlePresentationEvents(events)
      if (presentation.phase(id) === "opening" || presentation.phase(id) === "restoring") {
        viewportController?.requestFrame("transition")
      }
      else viewportController?.requestFrame("dirty")
    },
    onWindowPresentationSupport: (supported) => {
      presentationSupported = supported
      if (!supported) settleApertureMotion()
    },
    onWindowRipplePresentationSupport: (supported) => {
      ripplePresentationSupported = supported
      if (!supported) settleRippleMotion()
    },
    onReducedMotionChange: (reduced) => {
      reducedMotion = reduced
      if (reduced) settleAllPresentationMotion()
    },
    onContextLost: () => {
      contextAvailable = false
      settlePresentationForContextLoss()
    },
    onContextRestored: () => {
      contextAvailable = true
    },
  })
  viewportController.start()
  updateClockTimestamp()
  clockTimer = window.setInterval(updateClockTimestamp, 1_000)
  resizeObserver = new ResizeObserver(updateViewport)
  resizeObserver.observe(shellRef.value ?? canvas)
  updateViewport()
  pointerMedia = window.matchMedia("(pointer: fine)")
  const onPointerChange = () => {
    if (!pointerMedia?.matches) emitFallback("device-eligibility", "Spatial Desktop 需要鼠标或触控板。")
  }
  pointerMedia.addEventListener("change", onPointerChange)
  pointerMediaCleanup = () => pointerMedia?.removeEventListener("change", onPointerChange)
})

let pointerMediaCleanup: (() => void) | null = null

onBeforeUnmount(() => {
  shellDisposed = true
  closeRequests.clear()
  minimizeAllGroups.clear()
  minimizeAllGroupByWindow.clear()
  presentation.clear()
  confirmPresentation.clear()
  globalModalCloseLifecycle.clear()
  confirmInteractive.value = false
  dialogInteractive.value = false
  pointerMediaCleanup?.()
  resizeObserver?.disconnect()
  viewportController?.dispose()
  if (clockTimer !== null) window.clearInterval(clockTimer)
})
</script>
