import type { Component } from "vue"
import { computed, markRaw, ref } from "vue"
import type { DesktopAppId, DesktopWindowInput } from "@/desktop-apps"

export interface DesktopBounds {
  width: number
  height: number
}

export interface DesktopWindowGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface DesktopWindowState extends DesktopWindowGeometry {
  id: string
  appId: DesktopAppId
  routeName: string
  routePath: string
  label: string
  shortLabel: string
  title: string
  caption: string
  icon: Component
  component: Component
  props: Record<string, unknown>
  minWidth: number
  minHeight: number
  zIndex: number
  minimized: boolean
  fullscreen: boolean
  fullscreenable: boolean
}

const DEFAULT_BOUNDS: DesktopBounds = {
  width: 1280,
  height: 720,
}

export function useDesktopWindows() {
  const windows = ref<DesktopWindowState[]>([])
  const activeWindowId = ref("")
  let zCounter = 100

  const visibleWindows = computed(() =>
    windows.value
      .filter((window) => !window.minimized)
      .sort((left, right) => left.zIndex - right.zIndex),
  )

  const activeWindow = computed(() =>
    windows.value.find((window) => window.id === activeWindowId.value) ?? null,
  )

  function openWindow(input: DesktopWindowInput, bounds: DesktopBounds = DEFAULT_BOUNDS) {
    const existing = windows.value.find((window) => window.id === input.id)
    if (existing) {
      existing.routePath = input.routePath
      existing.title = input.title
      existing.caption = input.caption
      existing.props = input.props
      existing.minimized = false
      focusWindow(existing.id)
      return existing
    }

    const geometry = defaultGeometry(input, windows.value.length, bounds)
    const created: DesktopWindowState = {
      id: input.id,
      appId: input.appId,
      routeName: input.routeName,
      routePath: input.routePath,
      label: input.label,
      shortLabel: input.shortLabel,
      title: input.title,
      caption: input.caption,
      icon: markRaw(input.icon),
      component: markRaw(input.component),
      props: input.props,
      minWidth: input.minWidth,
      minHeight: input.minHeight,
      zIndex: nextZIndex(),
      minimized: false,
      fullscreen: false,
      fullscreenable: input.fullscreenable === true,
      ...geometry,
    }

    windows.value.push(created)
    activeWindowId.value = created.id
    return created
  }

  function focusWindow(id: string) {
    const target = windows.value.find((window) => window.id === id)
    if (!target) {
      return null
    }

    target.minimized = false
    target.zIndex = nextZIndex()
    activeWindowId.value = target.id
    return target
  }

  function minimizeWindow(id: string) {
    const target = windows.value.find((window) => window.id === id)
    if (!target) {
      return null
    }

    target.minimized = true
    target.fullscreen = false
    if (activeWindowId.value === target.id) {
      activeWindowId.value = topVisibleWindow()?.id ?? ""
    }
    return target
  }

  function minimizeAll() {
    for (const window of windows.value) {
      window.minimized = true
      window.fullscreen = false
    }
    activeWindowId.value = ""
  }

  function closeWindow(id: string) {
    const wasActive = activeWindowId.value === id
    windows.value = windows.value.filter((window) => window.id !== id)
    if (wasActive) {
      activeWindowId.value = topVisibleWindow()?.id ?? ""
    }
  }

  function moveWindow(
    id: string,
    geometry: Pick<DesktopWindowGeometry, "x" | "y">,
    bounds: DesktopBounds = DEFAULT_BOUNDS,
  ) {
    const target = windows.value.find((window) => window.id === id)
    if (!target || target.fullscreen) {
      return
    }

    const clamped = clampGeometry({ ...target, ...geometry }, bounds)
    target.x = clamped.x
    target.y = clamped.y
  }

  function resizeWindow(
    id: string,
    geometry: DesktopWindowGeometry,
    bounds: DesktopBounds = DEFAULT_BOUNDS,
  ) {
    const target = windows.value.find((window) => window.id === id)
    if (!target || target.fullscreen) {
      return
    }

    const clamped = clampGeometry(geometry, bounds, {
      minWidth: target.minWidth,
      minHeight: target.minHeight,
    })
    target.x = clamped.x
    target.y = clamped.y
    target.width = clamped.width
    target.height = clamped.height
  }

  function setFullscreen(id: string, fullscreen: boolean) {
    const target = windows.value.find((window) => window.id === id)
    if (!target || !target.fullscreenable) {
      return
    }

    target.fullscreen = fullscreen
    focusWindow(id)
  }

  function clampAll(bounds: DesktopBounds = DEFAULT_BOUNDS) {
    for (const window of windows.value) {
      if (window.fullscreen) {
        continue
      }
      const clamped = clampGeometry(window, bounds, {
        minWidth: window.minWidth,
        minHeight: window.minHeight,
      })
      window.x = clamped.x
      window.y = clamped.y
      window.width = clamped.width
      window.height = clamped.height
    }
  }

  function isAppOpen(appId: DesktopAppId) {
    return windows.value.some((window) => window.appId === appId && !window.minimized)
  }

  function nextZIndex() {
    zCounter += 1
    return zCounter
  }

  function topVisibleWindow() {
    return windows.value
      .filter((window) => !window.minimized)
      .sort((left, right) => right.zIndex - left.zIndex)[0] ?? null
  }

  return {
    windows,
    visibleWindows,
    activeWindow,
    activeWindowId,
    openWindow,
    focusWindow,
    minimizeWindow,
    minimizeAll,
    closeWindow,
    moveWindow,
    resizeWindow,
    setFullscreen,
    clampAll,
    isAppOpen,
  }
}

function defaultGeometry(
  input: DesktopWindowInput,
  openCount: number,
  bounds: DesktopBounds,
): DesktopWindowGeometry {
  const width = Math.min(input.defaultWidth, Math.max(input.minWidth, bounds.width - 72))
  const height = Math.min(input.defaultHeight, Math.max(input.minHeight, bounds.height - 72))
  const offset = (openCount % 7) * 28
  return clampGeometry({
    x: 128 + offset,
    y: 54 + offset,
    width,
    height,
  }, bounds, {
    minWidth: input.minWidth,
    minHeight: input.minHeight,
  })
}

function clampGeometry(
  geometry: DesktopWindowGeometry,
  bounds: DesktopBounds,
  minimums: { minWidth?: number; minHeight?: number } = {},
): DesktopWindowGeometry {
  const minWidth = minimums.minWidth ?? 360
  const minHeight = minimums.minHeight ?? 260
  const maxWidth = Math.max(minWidth, bounds.width - 24)
  const maxHeight = Math.max(minHeight, bounds.height - 24)
  const width = clamp(geometry.width, minWidth, maxWidth)
  const height = clamp(geometry.height, minHeight, maxHeight)
  const recoverableMargin = 56
  const maxX = Math.max(12, bounds.width - recoverableMargin)
  const maxY = Math.max(12, bounds.height - recoverableMargin)
  const x = clamp(geometry.x, 12 - width + recoverableMargin, maxX)
  const y = clamp(geometry.y, 12, maxY)

  return { x, y, width, height }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
