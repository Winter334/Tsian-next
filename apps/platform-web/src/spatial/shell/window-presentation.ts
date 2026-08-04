import type { SpatialPoint } from "../engine/projection"
import type {
  SpatialSourcePresentationEffect,
  SpatialSourcePresentationAxis,
  SpatialSourcePresentationPhase,
  SpatialSourcePresentationSnapshot,
  SpatialWindowPresentationRenderOptions,
  SpatialWindowRippleRenderOptions,
} from "../engine/source-presentation"
import {
  DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS,
  DEFAULT_WINDOW_RIPPLE_RENDER_OPTIONS,
} from "../engine/source-presentation"

export interface SpatialWindowPresentationDurations {
  readonly openMs: number
  readonly closeMs: number
  readonly minimizeMs: number
  readonly restoreMs: number
}

export const SPATIAL_WINDOW_PRESENTATION_DURATIONS = Object.freeze<SpatialWindowPresentationDurations>({
  openMs: 420,
  closeMs: 300,
  minimizeMs: 520,
  restoreMs: 560,
})

export const SPATIAL_WINDOW_PRESENTATION_RENDER_OPTIONS = Object.freeze<SpatialWindowPresentationRenderOptions>({
  ...DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS,
  enabled: true,
})

export const SPATIAL_WINDOW_RIPPLE_RENDER_OPTIONS = Object.freeze<SpatialWindowRippleRenderOptions>({
  ...DEFAULT_WINDOW_RIPPLE_RENDER_OPTIONS,
  enabled: true,
})

export type SpatialWindowPresentationEvent =
  | { readonly kind: "opened"; readonly windowId: string }
  | { readonly kind: "close-ready"; readonly windowId: string }
  | { readonly kind: "minimize-ready"; readonly windowId: string; readonly effectId: number }
  | { readonly kind: "restored"; readonly windowId: string; readonly effectId: number }

export interface SpatialWindowPresentationFrame {
  readonly snapshots: readonly SpatialSourcePresentationSnapshot[]
  readonly events: readonly SpatialWindowPresentationEvent[]
  readonly active: boolean
}

interface SpatialWindowPresentationEntry {
  readonly windowId: string
  readonly sourceId: string
  readonly apertureAxis: SpatialSourcePresentationAxis
  phase: SpatialSourcePresentationPhase
  effect: SpatialSourcePresentationEffect
  effectId: number
  originUv: Readonly<SpatialPoint>
  startedAt: number
  duration: number
  progress: number
  completionPending: boolean
  restoreAnimationAllowed: boolean
}

export interface SpatialWindowPresentationMountOptions {
  readonly sourceId?: string
  readonly apertureAxis?: SpatialSourcePresentationAxis
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function immutableUv(value: SpatialPoint): Readonly<SpatialPoint> {
  return Object.freeze({ x: clampUnit(value.x), y: clampUnit(value.y) })
}

function easeOutCubic(value: number): number {
  const inverse = 1 - clampUnit(value)
  return 1 - inverse * inverse * inverse
}

function easeInOutCubic(value: number): number {
  const progress = clampUnit(value)
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2
}

export class SpatialWindowPresentationController {
  private readonly entries = new Map<string, SpatialWindowPresentationEntry>()
  private readonly durations: SpatialWindowPresentationDurations
  private effectCounter = 0

  constructor(durations: Partial<SpatialWindowPresentationDurations> = {}) {
    this.durations = Object.freeze({
      ...SPATIAL_WINDOW_PRESENTATION_DURATIONS,
      ...durations,
    })
  }

  mount(windowId: string, options: SpatialWindowPresentationMountOptions = {}): boolean {
    if (this.entries.has(windowId)) return false
    this.entries.set(windowId, {
      windowId,
      sourceId: options.sourceId ?? `window:${windowId}`,
      apertureAxis: options.apertureAxis ?? "vertical",
      phase: "capturing-open",
      effect: "aperture",
      effectId: this.nextEffectId(),
      originUv: immutableUv({ x: 0.5, y: 0.5 }),
      startedAt: 0,
      duration: 0,
      progress: 0,
      completionPending: false,
      restoreAnimationAllowed: true,
    })
    return true
  }

  phase(windowId: string): SpatialSourcePresentationPhase | null {
    return this.entries.get(windowId)?.phase ?? null
  }

  isCommandAvailable(windowId: string): boolean {
    return this.entries.get(windowId)?.phase === "visible"
  }

  allVisible(windowIds: Iterable<string>): boolean {
    for (const windowId of windowIds) {
      if (!this.isCommandAvailable(windowId)) return false
    }
    return true
  }

  sourceReady(
    windowId: string,
    timestamp: number,
    animate: boolean,
  ): readonly SpatialWindowPresentationEvent[] {
    const entry = this.entries.get(windowId)
    if (!entry) return []
    if (entry.phase === "capturing-open") {
      if (!animate || this.durations.openMs <= 0) {
        this.makeVisible(entry)
        return [{ kind: "opened", windowId }]
      }
      entry.phase = "opening"
      entry.effect = "aperture"
      entry.startedAt = timestamp
      entry.duration = this.durations.openMs
      entry.progress = 0
      return []
    }
    if (entry.phase !== "capturing-restore") return []
    entry.phase = "restoring"
    entry.effect = "particle-ripple"
    entry.startedAt = timestamp
    entry.duration = animate && entry.restoreAnimationAllowed ? this.durations.restoreMs : 0
    entry.progress = entry.duration > 0 ? 0 : 1
    entry.completionPending = entry.duration <= 0
    return entry.completionPending
      ? [{ kind: "restored", windowId, effectId: entry.effectId }]
      : []
  }

  beginGuard(windowId: string): boolean {
    const entry = this.entries.get(windowId)
    if (!entry || entry.phase !== "visible") return false
    entry.phase = "guard-pending"
    entry.progress = 1
    return true
  }

  cancelGuard(windowId: string): boolean {
    const entry = this.entries.get(windowId)
    if (!entry || entry.phase !== "guard-pending") return false
    this.makeVisible(entry)
    return true
  }

  startClosing(
    windowId: string,
    timestamp: number,
    animate: boolean,
  ): readonly SpatialWindowPresentationEvent[] {
    const entry = this.entries.get(windowId)
    if (!entry || entry.phase !== "guard-pending") return []
    entry.phase = "closing"
    entry.effect = "aperture"
    entry.effectId = this.nextEffectId()
    entry.startedAt = timestamp
    entry.duration = animate ? this.durations.closeMs : 0
    entry.progress = entry.duration > 0 ? 1 : 0
    entry.completionPending = entry.duration <= 0
    return entry.completionPending ? [{ kind: "close-ready", windowId }] : []
  }

  startMinimizing(
    windowId: string,
    originUv: SpatialPoint,
    timestamp: number,
    animate: boolean,
  ): readonly SpatialWindowPresentationEvent[] {
    const entry = this.entries.get(windowId)
    if (!entry || entry.phase !== "visible") return []
    entry.phase = "minimizing"
    entry.effect = "particle-ripple"
    entry.effectId = this.nextEffectId()
    entry.originUv = immutableUv(originUv)
    entry.startedAt = timestamp
    entry.duration = animate ? this.durations.minimizeMs : 0
    entry.progress = entry.duration > 0 ? 0 : 1
    entry.completionPending = entry.duration <= 0
    return entry.completionPending
      ? [{ kind: "minimize-ready", windowId, effectId: entry.effectId }]
      : []
  }

  completeMinimize(windowId: string, effectId?: number): boolean {
    const entry = this.entries.get(windowId)
    if (!entry
      || entry.phase !== "minimizing"
      || !entry.completionPending
      || (effectId !== undefined && entry.effectId !== effectId)) return false
    entry.phase = "minimized"
    entry.progress = 1
    entry.duration = 0
    entry.completionPending = false
    return true
  }

  beginRestore(windowId: string): boolean {
    const entry = this.entries.get(windowId)
    if (!entry || entry.phase !== "minimized") return false
    entry.phase = "capturing-restore"
    entry.effect = "particle-ripple"
    entry.effectId = this.nextEffectId()
    entry.originUv = immutableUv({ x: 0.5, y: 0.5 })
    entry.startedAt = 0
    entry.duration = 0
    entry.progress = 0
    entry.completionPending = false
    entry.restoreAnimationAllowed = true
    return true
  }

  completeRestore(windowId: string, effectId?: number): boolean {
    const entry = this.entries.get(windowId)
    if (!entry
      || entry.phase !== "restoring"
      || !entry.completionPending
      || (effectId !== undefined && entry.effectId !== effectId)) return false
    this.makeVisible(entry)
    return true
  }

  advance(timestamp: number): SpatialWindowPresentationFrame {
    const events: SpatialWindowPresentationEvent[] = []
    for (const entry of this.entries.values()) {
      if (entry.phase === "opening") {
        const normalized = this.normalizedElapsed(entry, timestamp)
        entry.progress = Math.max(entry.progress, easeOutCubic(normalized))
        if (normalized >= 1) {
          this.makeVisible(entry)
          events.push({ kind: "opened", windowId: entry.windowId })
        }
        continue
      }
      if (entry.phase === "closing" && !entry.completionPending) {
        const normalized = this.normalizedElapsed(entry, timestamp)
        // Reverse of the opening curve: stable at t=0, slit at t=1.
        entry.progress = Math.min(entry.progress, 1 - normalized * normalized * normalized)
        if (normalized >= 1) {
          entry.progress = 0
          entry.completionPending = true
          events.push({ kind: "close-ready", windowId: entry.windowId })
        }
        continue
      }
      if (entry.phase !== "minimizing" && entry.phase !== "restoring") continue
      if (entry.completionPending) continue
      const normalized = this.normalizedElapsed(entry, timestamp)
      entry.progress = Math.max(entry.progress, easeInOutCubic(normalized))
      if (normalized < 1) continue
      entry.progress = 1
      entry.completionPending = true
      events.push(entry.phase === "minimizing"
        ? { kind: "minimize-ready", windowId: entry.windowId, effectId: entry.effectId }
        : { kind: "restored", windowId: entry.windowId, effectId: entry.effectId })
    }
    return this.frame(events)
  }

  settleApertureMotion(): SpatialWindowPresentationFrame {
    return this.settleMotionKinds(true, false)
  }

  settleRippleMotion(): SpatialWindowPresentationFrame {
    return this.settleMotionKinds(false, true)
  }

  settleMotion(): SpatialWindowPresentationFrame {
    return this.settleMotionKinds(true, true)
  }

  settleForContextLoss(): SpatialWindowPresentationFrame {
    const events: SpatialWindowPresentationEvent[] = []
    for (const entry of this.entries.values()) {
      if (entry.phase === "opening") {
        this.makeVisible(entry)
        events.push({ kind: "opened", windowId: entry.windowId })
      } else if (entry.phase === "closing" && !entry.completionPending) {
        entry.progress = 0
        entry.completionPending = true
        events.push({ kind: "close-ready", windowId: entry.windowId })
      } else if (entry.phase === "minimizing" && !entry.completionPending) {
        entry.progress = 1
        entry.completionPending = true
        events.push({ kind: "minimize-ready", windowId: entry.windowId, effectId: entry.effectId })
      } else if (entry.phase === "restoring" || entry.phase === "capturing-restore") {
        // The previously valid texture is gone. Invalidate that effect and
        // wait for a replacement upload; do not replay a stale completion.
        entry.phase = "capturing-restore"
        entry.effect = "particle-ripple"
        entry.effectId = this.nextEffectId()
        entry.originUv = immutableUv({ x: 0.5, y: 0.5 })
        entry.startedAt = 0
        entry.duration = 0
        entry.progress = 0
        entry.completionPending = false
        entry.restoreAnimationAllowed = false
      }
    }
    return this.frame(events)
  }

  completeClose(windowId: string): boolean {
    const entry = this.entries.get(windowId)
    if (!entry || entry.phase !== "closing" || !entry.completionPending) return false
    return this.entries.delete(windowId)
  }

  forget(windowId: string): void {
    this.entries.delete(windowId)
  }

  snapshots(): readonly SpatialSourcePresentationSnapshot[] {
    return [...this.entries.values()].map((entry) => Object.freeze({
      sourceId: entry.sourceId,
      phase: entry.phase,
      progress: clampUnit(entry.progress),
      effect: entry.effect,
      effectId: entry.effectId,
      originUv: entry.originUv,
      apertureAxis: entry.apertureAxis,
    }))
  }

  clear(): void {
    this.entries.clear()
  }

  private normalizedElapsed(entry: SpatialWindowPresentationEntry, timestamp: number): number {
    const elapsed = Math.max(0, timestamp - entry.startedAt)
    return entry.duration <= 0 ? 1 : clampUnit(elapsed / entry.duration)
  }

  private settleMotionKinds(
    aperture: boolean,
    ripple: boolean,
  ): SpatialWindowPresentationFrame {
    const events: SpatialWindowPresentationEvent[] = []
    for (const entry of this.entries.values()) {
      if (aperture && entry.phase === "opening") {
        this.makeVisible(entry)
        events.push({ kind: "opened", windowId: entry.windowId })
      } else if (aperture && entry.phase === "closing" && !entry.completionPending) {
        entry.progress = 0
        entry.completionPending = true
        events.push({ kind: "close-ready", windowId: entry.windowId })
      } else if (ripple && entry.phase === "minimizing" && !entry.completionPending) {
        entry.progress = 1
        entry.completionPending = true
        events.push({ kind: "minimize-ready", windowId: entry.windowId, effectId: entry.effectId })
      } else if (ripple && entry.phase === "restoring" && !entry.completionPending) {
        entry.progress = 1
        entry.completionPending = true
        events.push({ kind: "restored", windowId: entry.windowId, effectId: entry.effectId })
      }
    }
    return this.frame(events)
  }

  private makeVisible(entry: SpatialWindowPresentationEntry): void {
    entry.phase = "visible"
    entry.effect = "stable"
    entry.progress = 1
    entry.duration = 0
    entry.completionPending = false
    entry.restoreAnimationAllowed = true
  }

  private nextEffectId(): number {
    this.effectCounter += 1
    return this.effectCounter
  }

  private frame(events: readonly SpatialWindowPresentationEvent[]): SpatialWindowPresentationFrame {
    return Object.freeze({
      snapshots: Object.freeze(this.snapshots()),
      events: Object.freeze([...events]),
      active: [...this.entries.values()].some((entry) => (
        entry.phase === "opening"
        || entry.phase === "minimizing"
        || entry.phase === "restoring"
        || (entry.phase === "closing" && !entry.completionPending)
      ) && !entry.completionPending),
    })
  }
}
