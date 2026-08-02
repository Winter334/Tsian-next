import type { PlatformWindowDescriptor } from "@/platform-apps"
import { canCloseWindow, forgetWindowCloseGuard } from "@/composables/window-close-guards"
import {
  clampSpatialGeometry,
  defaultSpatialWindowSize,
  resizeSpatialGeometry,
  sideDepthForGeometry,
  type SpatialResizeDirection,
  type SpatialViewportSize,
  type SpatialWindowGeometry,
} from "./window-layout"
import type { SpatialPoint } from "../engine/projection"

export type SpatialTextureState = "active" | "released" | "restoring"

export interface SpatialWindowState extends SpatialWindowGeometry {
  readonly id: string
  descriptor: PlatformWindowDescriptor
  zIndex: number
  minimized: boolean
  textureState: SpatialTextureState
}

export type SpatialCloseGuard = (id: string) => Promise<boolean>
export type SpatialWindowActivationFilter = (window: SpatialWindowState) => boolean

export class SpatialWindowSession {
  windows: SpatialWindowState[] = []
  activeWindowId = ""
  private zCounter = 100

  get activeWindow(): SpatialWindowState | null {
    return this.windows.find((window) => window.id === this.activeWindowId) ?? null
  }

  get(id: string): SpatialWindowState | null {
    return this.find(id)
  }

  open(
    descriptor: PlatformWindowDescriptor,
    viewport: SpatialViewportSize,
  ): SpatialWindowState {
    const existing = this.windows.find((window) => window.id === descriptor.id)
    if (existing) {
      existing.descriptor = descriptor
      return this.focus(existing.id) ?? existing
    }
    const size = defaultSpatialWindowSize(
      descriptor.spatial.defaultSize,
      viewport,
      descriptor.spatial.minSize,
    )
    const offset = (this.windows.length % 7) * 46
    const geometry = clampSpatialGeometry({
      worldX: (viewport.width - size.width) / 2 + offset,
      worldY: Math.max(24, (viewport.height - size.height) / 2 + offset * 0.35),
      width: size.width,
      height: size.height,
      sideDepth: 0,
    }, viewport, descriptor.spatial.minSize)
    const created: SpatialWindowState = {
      id: descriptor.id,
      descriptor,
      zIndex: this.nextZIndex(),
      minimized: false,
      textureState: "active",
      ...geometry,
    }
    this.windows.push(created)
    this.activeWindowId = created.id
    return created
  }

  focus(id: string): SpatialWindowState | null {
    const target = this.find(id)
    if (!target) return null
    target.minimized = false
    if (target.textureState === "released") target.textureState = "restoring"
    target.zIndex = this.nextZIndex()
    this.activeWindowId = target.id
    return target
  }

  minimize(
    id: string,
    canActivate: SpatialWindowActivationFilter = () => true,
  ): SpatialWindowState | null {
    const target = this.find(id)
    if (!target) return null
    target.minimized = true
    target.textureState = "released"
    if (this.activeWindowId === id) this.activateTopVisible(canActivate)
    return target
  }

  minimizeAll(): void {
    for (const window of this.windows) {
      window.minimized = true
      window.textureState = "released"
    }
    this.activeWindowId = ""
  }

  async close(
    id: string,
    guard: SpatialCloseGuard = canCloseWindow,
  ): Promise<boolean> {
    if (!await this.approveClose(id, guard)) return false
    return this.finalizeClose(id) !== null
  }

  async approveClose(
    id: string,
    guard: SpatialCloseGuard = canCloseWindow,
  ): Promise<boolean> {
    if (!this.find(id) || !await guard(id)) return false
    // A close guard may suspend on user input. Re-resolve the target afterwards
    // before allowing presentation to begin.
    return this.find(id) !== null
  }

  finalizeClose(
    id: string,
    canActivate: SpatialWindowActivationFilter = () => true,
  ): SpatialWindowState | null {
    const index = this.windows.findIndex((window) => window.id === id)
    if (index < 0) return null
    const wasActive = this.activeWindowId === id
    const [removed] = this.windows.splice(index, 1)
    forgetWindowCloseGuard(id)
    if (wasActive) this.activateTopVisible(canActivate)
    return removed ?? null
  }

  move(
    id: string,
    screenDelta: SpatialPoint,
    viewport: SpatialViewportSize,
  ): SpatialWindowState | null {
    const target = this.find(id)
    if (!target) return null
    Object.assign(target, clampSpatialGeometry({
      ...target,
      worldX: target.worldX + screenDelta.x,
      worldY: target.worldY + screenDelta.y,
    }, viewport, target.descriptor.spatial.minSize))
    return target
  }

  resize(
    id: string,
    direction: SpatialResizeDirection,
    sourceLocalDelta: SpatialPoint,
    viewport: SpatialViewportSize,
  ): SpatialWindowState | null {
    const target = this.find(id)
    if (!target) return null
    Object.assign(target, resizeSpatialGeometry({
      geometry: target,
      direction,
      sourceLocalDelta,
      minimums: target.descriptor.spatial.minSize,
      viewport,
    }))
    return target
  }

  settle(id: string, viewport: SpatialViewportSize): void {
    const target = this.find(id)
    if (target) target.sideDepth = sideDepthForGeometry(target, viewport)
  }

  clampAll(viewport: SpatialViewportSize): void {
    for (const window of this.windows) {
      Object.assign(window, clampSpatialGeometry(
        window,
        viewport,
        window.descriptor.spatial.minSize,
      ))
    }
  }

  markTextureActive(id: string): void {
    const target = this.find(id)
    if (target && !target.minimized) target.textureState = "active"
  }

  private activateTopVisible(canActivate: SpatialWindowActivationFilter = () => true): void {
    const next = [...this.windows]
      .filter((window) => !window.minimized && canActivate(window))
      .sort((left, right) => right.zIndex - left.zIndex)[0] ?? null
    this.activeWindowId = next?.id ?? ""
  }

  private find(id: string): SpatialWindowState | null {
    return this.windows.find((window) => window.id === id) ?? null
  }

  private nextZIndex(): number {
    this.zCounter += 1
    return this.zCounter
  }
}
