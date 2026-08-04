import type { SpatialMetrics } from "./metrics"

export type FrameReason =
  | "dirty"
  | "parallax"
  | "transition"
  | "particles"
  | "animated-background"
  | "animated-source"
  | "restore"

export interface ScheduledFrame {
  readonly timestamp: number
  readonly reasons: ReadonlySet<FrameReason>
  readonly reducedMotion: boolean
}

export interface FrameResult {
  readonly continueReasons?: Iterable<FrameReason>
}

export interface FrameSchedulerOptions {
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number
  readonly cancelAnimationFrame?: (handle: number) => void
  readonly now?: () => number
  readonly metrics?: SpatialMetrics
  readonly onError?: (error: unknown) => void
}

const MOTION_REASONS = new Set<FrameReason>([
  "parallax",
  "transition",
  "particles",
  "animated-background",
  "animated-source",
])

export class FrameScheduler {
  private readonly activeReasons = new Set<FrameReason>()
  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (handle: number) => void
  private readonly now: () => number
  private readonly metrics?: SpatialMetrics
  private readonly onError?: (error: unknown) => void
  private frameHandle: number | null = null
  private disposed = false
  private reducedMotion = false

  constructor(
    private readonly render: (frame: ScheduledFrame) => FrameResult | void,
    options: FrameSchedulerOptions = {},
  ) {
    this.requestFrame = options.requestAnimationFrame
      ?? ((callback) => window.requestAnimationFrame(callback))
    this.cancelFrame = options.cancelAnimationFrame
      ?? ((handle) => window.cancelAnimationFrame(handle))
    this.now = options.now ?? (() => performance.now())
    this.metrics = options.metrics
    this.onError = options.onError
  }

  request(reason: FrameReason): void {
    if (this.disposed) return
    this.activeReasons.add(reason)
    this.metrics?.setActiveReasons(this.activeReasons)
    this.ensureScheduled()
  }

  release(reason: FrameReason): void {
    if (this.disposed || !this.activeReasons.delete(reason)) return
    this.metrics?.setActiveReasons(this.activeReasons)
    if (this.activeReasons.size === 0 && this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle)
      this.frameHandle = null
    }
  }

  setReducedMotion(reduced: boolean): void {
    if (this.reducedMotion === reduced || this.disposed) return
    this.reducedMotion = reduced
    if (reduced && [...this.activeReasons].some((reason) => MOTION_REASONS.has(reason))) {
      this.ensureScheduled()
    }
  }

  isScheduled(): boolean {
    return this.frameHandle !== null
  }

  reasons(): readonly FrameReason[] {
    return [...this.activeReasons].sort()
  }

  cancel(): void {
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle)
      this.frameHandle = null
    }
    this.activeReasons.clear()
    this.metrics?.setActiveReasons(this.activeReasons)
  }

  dispose(): void {
    this.cancel()
    this.disposed = true
  }

  private ensureScheduled(): void {
    if (this.frameHandle !== null || this.disposed || this.activeReasons.size === 0) return
    this.frameHandle = this.requestFrame((timestamp) => this.runFrame(timestamp))
  }

  private runFrame(timestamp: number): void {
    this.frameHandle = null
    if (this.disposed) return

    const frameReasons = new Set(this.activeReasons)
    this.activeReasons.clear()
    const startedAt = this.now()
    try {
      const result = this.render({
        timestamp,
        reasons: frameReasons,
        reducedMotion: this.reducedMotion,
      })
      for (const reason of result?.continueReasons ?? []) {
        if (!this.reducedMotion || !MOTION_REASONS.has(reason)) {
          this.activeReasons.add(reason)
        }
      }
    } catch (error) {
      this.activeReasons.clear()
      this.onError?.(error)
    } finally {
      this.metrics?.recordFrame(this.now() - startedAt)
      this.metrics?.setActiveReasons(this.activeReasons)
    }
    this.ensureScheduled()
  }
}
