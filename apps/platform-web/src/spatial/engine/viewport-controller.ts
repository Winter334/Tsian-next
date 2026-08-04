import {
  acquireHtmlInCanvasCapabilities,
  type HtmlInCanvasApiVariant,
  type HtmlInCanvasCapabilities,
  type HtmlInCanvasCapabilityResult,
  type HtmlInCanvasContextVariant,
} from "./capabilities"
import type { EnvironmentBaseProvider } from "./environment-base"
import { SpatialDynamicMediaTracker } from "./dynamic-media"
import type { EnvironmentPostProcessingOptions } from "./environment-effects"
import { FrameScheduler, type FrameReason, type ScheduledFrame } from "./frame-scheduler"
import {
  findScrollbarThumbDrag,
  findScrollableAncestor,
  openNativePicker,
  placeCaretAtPoint,
  scrollElementBy,
  type ScrollbarThumbDragState,
  updateScrollbarThumbDrag,
  updateRangeFromPoint,
} from "./input/native-controls"
import {
  shouldRecenterParallax,
  type ParallaxResetTrigger,
  viewportParallaxTarget,
} from "./input/parallax"
import {
  PointerRouter,
  type NativeActivationOutcome,
  type RoutedPointerEventType,
  type RoutedPointerSample,
  type SyntheticDeliveryReport,
} from "./input/pointer-router"
import {
  activationPolicyForElement,
  resolveProjectedTarget,
  type DomTargetResolution,
  type SpatialSourceRoot,
} from "./input/target-resolver"
import { SpatialMetrics, type SpatialMetricsSnapshot } from "./metrics"
import type { SpatialPoint } from "./projection"
import { SpatialRenderer, type SpatialWindowRenderStyle } from "./renderer"
import {
  sourcePresentationBlocksInput,
  type SpatialSourcePresentationSnapshot,
  type SpatialWindowPresentationRenderOptions,
  type SpatialWindowRippleRenderOptions,
} from "./source-presentation"
import {
  shouldQueueNextSourceTexturePaint,
  SOURCE_TEXTURE_ANIMATION_SETTLE_MAX_MS,
  sourceTextureAnimationSettlementAction,
  SourceTextureAnimationTracker,
} from "./source-texture-animation"
import {
  capturedSceneScreenToLocalDifferential,
  captureSceneProjection,
  projectCapturedSceneSource,
  projectedSceneHits,
  sceneSourceForElement,
  type CapturedSceneProjection,
  type ScreenToSourceLocalDifferential,
  type SceneSourceSurface,
} from "./scene"

export interface SpatialPointerSnapshot {
  readonly trusted: SpatialPoint | null
  readonly curved: SpatialPoint | null
  readonly planar: SpatialPoint | null
  readonly sourceId: string | null
  readonly targetId: string | null
  readonly status: string
}

export type SpatialViewportStatus = "initializing" | "unsupported" | "ready" | "context-lost" | "error"

export interface SpatialViewportSnapshot {
  readonly status: SpatialViewportStatus
  readonly supportMessage: string
  readonly apiVariant: HtmlInCanvasApiVariant | "n/a"
  readonly contextVariant: HtmlInCanvasContextVariant | "n/a"
  readonly reducedMotion: boolean
  readonly contextLossProbe: "available" | "unavailable" | "triggered"
  readonly pointer: SpatialPointerSnapshot
  readonly metrics: SpatialMetricsSnapshot
  readonly idleStableMs: number
  readonly lastNativeEscape: string
  readonly lastSyntheticDelivery: string
  readonly lastNativeOutcome: string
}

export interface SpatialViewportFrameHookResult {
  readonly continueReasons?: Iterable<FrameReason>
  readonly sourcePresentations?: readonly SpatialSourcePresentationSnapshot[]
  readonly afterRender?: () => void
}

export interface SpatialViewportControllerOptions {
  readonly canvas: HTMLCanvasElement
  readonly inputPlane: HTMLElement
  /** Enables projected Source cursor mirroring; omitted consumers keep their own CSS cursor. */
  readonly projectedCursorFallback?: string
  readonly environmentBase?: EnvironmentBaseProvider
  readonly environmentEffects?: EnvironmentPostProcessingOptions
  readonly windowPresentation?: SpatialWindowPresentationRenderOptions
  readonly windowRipplePresentation?: SpatialWindowRippleRenderOptions
  readonly windowStyle?: SpatialWindowRenderStyle
  readonly ignoredElements?: Iterable<Element>
  readonly onSnapshot?: (snapshot: SpatialViewportSnapshot) => void
  readonly onControlResult?: (key: string, detail: string) => void
  readonly beforeRender?: (frame: ScheduledFrame) => SpatialViewportFrameHookResult | void
  readonly onSourceReady?: (sourceId: string) => void
  readonly onWindowPresentationSupport?: (supported: boolean) => void
  readonly onWindowRipplePresentationSupport?: (supported: boolean) => void
  readonly onReducedMotionChange?: (reduced: boolean) => void
  readonly onContextLost?: () => void
  readonly onContextRestored?: () => void
}

export function sourcesAvailableForProjectedInput(
  sources: readonly SpatialSourceRoot[],
  unavailableSourceIds: ReadonlySet<string>,
): SpatialSourceRoot[] {
  return sources.filter((source) => !unavailableSourceIds.has(source.sourceId))
}

/**
 * Input-only Sources retain their DOM geometry for inverse-projected hit
 * testing, but never allocate or upload a GPU texture.
 */
export function sourcesAvailableForTextureCapture(
  sources: readonly Element[],
): Element[] {
  return sources.filter((source) => source.getAttribute("data-spatial-render") !== "none")
}

interface ResolvedInput {
  readonly target: Element | null
  readonly source: SceneSourceSurface | null
  readonly mapping: {
    readonly localNormalized: SpatialPoint
    readonly localClient: SpatialPoint
  } | null
  readonly resolution: DomTargetResolution | null
  readonly sample: RoutedPointerSample
}

interface CapturedSceneInput {
  readonly projection: CapturedSceneProjection
  visualClient: SpatialPoint
  localClient: SpatialPoint
  screenToLocal: ScreenToSourceLocalDifferential | null
  extrapolating: boolean
}

interface CapturedScrollbarThumbDrag {
  readonly sourceId: string
  readonly sourceRoot: Element
  readonly state: ScrollbarThumbDragState
}

const EMPTY_POINTER: SpatialPointerSnapshot = Object.freeze({
  trusted: null,
  curved: null,
  planar: null,
  sourceId: null,
  targetId: null,
  status: "awaiting-input",
})

const SOURCE_CAPTURE_PAINT_RETRY_LIMIT = 8
const SOURCE_CAPTURE_PAINT_RETRY_BASE_DELAY_MS = 50
const SOURCE_CAPTURE_PAINT_RETRY_MAX_DELAY_MS = 400

function defaultMetrics(): SpatialMetricsSnapshot {
  return {
    frameCount: 0,
    lastFrameTimeMs: 0,
    averageFrameTimeMs: 0,
    uploadCount: 0,
    uploadedBytesEstimate: 0,
    textureCount: 0,
    disposalCount: 0,
    displayDpr: 1,
    internalRasterScale: 1,
    activeReasons: [],
    lastFailure: null,
  }
}

function eventSample(
  event: PointerEvent | MouseEvent | WheelEvent,
  mappedPoint: SpatialPoint,
): RoutedPointerSample {
  const pointer = event as PointerEvent
  const wheel = event as WheelEvent
  return {
    pointerId: typeof pointer.pointerId === "number" ? pointer.pointerId : 1,
    pointerType: pointer.pointerType || "mouse",
    isPrimary: pointer.isPrimary !== false,
    button: event.button,
    buttons: event.buttons,
    clientX: mappedPoint.x,
    clientY: mappedPoint.y,
    screenClientX: event.clientX,
    screenClientY: event.clientY,
    detail: event.detail,
    deltaX: typeof wheel.deltaX === "number" ? wheel.deltaX : 0,
    deltaY: typeof wheel.deltaY === "number" ? wheel.deltaY : 0,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    trustedSource: event.isTrusted,
  }
}

/**
 * PointerEvent.detail is normally zero. Compatibility mouse down/up/click
 * events must still report a first-click count of one, or consumers such as
 * CodeMirror interpret the zero as a triple-click and select the whole line.
 */
export function routedMouseEventDetail(
  type: RoutedPointerEventType,
  detail: number | undefined,
): number {
  if (detail !== undefined && detail > 0) return detail
  if (type === "mousedown" || type === "mouseup" || type === "click") return 1
  if (type === "dblclick") return 2
  return 0
}

export class SpatialViewportController {
  private readonly metrics = new SpatialMetrics()
  private readonly ignoredElements: ReadonlySet<Element>
  private readonly cleanup: Array<() => void> = []
  private readonly releasedSourceIds = new Set<string>()
  private readonly restoringSourceIds = new Set<string>()
  /** Released/restoring textures are not visible and must not occlude input. */
  private readonly inputUnavailableSourceIds = new Set<string>()
  private readonly presentationInputUnavailableSourceIds = new Set<string>()
  private readonly presentationCapturePendingSourceIds = new Set<string>()
  private readonly readySourceIds = new Set<string>()
  private readonly sourceTextureAnimations = new SourceTextureAnimationTracker()
  private readonly dynamicMedia = new SpatialDynamicMediaTracker({
    requestFrame: (reason) => this.scheduler?.request(reason),
  })
  private readonly settlingSourceTextureAnimations = new Map<string, {
    finalRequested: boolean
    expiresAt: number
  }>()
  private readonly capturedSceneProjections = new Map<number, CapturedSceneInput>()
  private readonly capturedScrollbarThumbDrags = new Map<number, CapturedScrollbarThumbDrag>()
  private capabilities: HtmlInCanvasCapabilities | null = null
  private renderer: SpatialRenderer | null = null
  private scheduler: FrameScheduler | null = null
  private router: PointerRouter<Element> | null = null
  private resizeObserver: ResizeObserver | null = null
  private sourceObserver: MutationObserver | null = null
  private metricsTimer: number | null = null
  private contextRestoreTimer: number | null = null
  private sourceCaptureRetryTimer: number | null = null
  private readonly sourceCaptureRetryAttempts = new Map<string, number>()
  private status: SpatialViewportStatus = "initializing"
  private supportMessage = "Checking HTML-in-Canvas capabilities…"
  private apiVariant: SpatialViewportSnapshot["apiVariant"] = "n/a"
  private contextVariant: SpatialViewportSnapshot["contextVariant"] = "n/a"
  private pointer: SpatialPointerSnapshot = EMPTY_POINTER
  private reducedMotion = false
  private reducedMotionOverride: boolean | null = null
  private mediaQuery: MediaQueryList | null = null
  /** Last transform actually drawn; projected input never consumes a future target. */
  private currentParallax: SpatialPoint = { x: 0, y: 0 }
  private targetParallax: SpatialPoint = { x: 0, y: 0 }
  private transitionEndsAt = 0
  private contextLossProbe: SpatialViewportSnapshot["contextLossProbe"] = "unavailable"
  private lastNativeEscape = "none"
  private lastSyntheticDelivery = "none"
  private lastNativeOutcome = "none"
  private idleStableMs = 0
  private lastCounters = { frameCount: 0, uploadCount: 0 }
  private lastCounterChange = performance.now()
  private lastMappedPoint: SpatialPoint = { x: 0, y: 0 }
  private readonly routedHoverElements = new Set<Element>()
  private readonly routedActiveElements = new Set<Element>()
  private pageVisible = document.visibilityState !== "hidden"
  private disposed = false

  constructor(private readonly options: SpatialViewportControllerOptions) {
    this.ignoredElements = new Set([
      options.canvas,
      options.inputPlane,
      ...(options.ignoredElements ?? []),
    ])
  }

  start(): void {
    if (this.disposed) return
    const acquired = acquireHtmlInCanvasCapabilities(this.options.canvas)
    if (!acquired.supported) {
      this.applyUnsupported(acquired)
      return
    }
    this.capabilities = acquired.capabilities
    this.apiVariant = acquired.capabilities.apiVariant
    this.contextVariant = acquired.capabilities.contextVariant
    const created = SpatialRenderer.create(acquired.capabilities, this.metrics, {
      environmentBase: this.options.environmentBase,
      environmentEffects: this.options.environmentEffects,
      windowPresentation: this.options.windowPresentation,
      windowRipplePresentation: this.options.windowRipplePresentation,
      windowStyle: this.options.windowStyle,
    })
    if (!created.ok) {
      this.fail(`${created.failure.stage}: ${created.failure.message}`)
      return
    }
    this.renderer = created.renderer
    this.options.onWindowPresentationSupport?.(created.renderer.supportsWindowPresentation())
    this.options.onWindowRipplePresentationSupport?.(
      created.renderer.supportsWindowRipplePresentation(),
    )
    this.status = "ready"
    this.supportMessage = "Experimental HTML-in-Canvas adapter ready."
    this.contextLossProbe = acquired.capabilities.gl.getExtension("WEBGL_lose_context")
      ? "available"
      : "unavailable"
    this.configureMotionPreference()
    this.configureScheduler()
    const unsubscribeEnvironment = this.options.environmentBase?.subscribe?.(() => {
      this.scheduler?.request("dirty")
    })
    if (unsubscribeEnvironment) this.cleanup.push(unsubscribeEnvironment)
    this.configureInputRouter()
    this.configureLifecycle()
    this.syncSources()
    this.resize()
    this.capabilities.requestPaint()
    this.scheduler?.request("dirty")
    this.requestAmbientFrames()
    if (this.options.onSnapshot) {
      this.metricsTimer = window.setInterval(() => this.emitSnapshot(), 250)
    }
    this.emitSnapshot()
  }

  requestFrame(reason: FrameReason): void {
    this.scheduler?.request(reason)
  }

  /**
   * Keep projected input synchronized with lifecycle changes that can occur
   * between animation frames (notably guard entry/veto and duration-zero
   * completion). Rendering still consumes the immutable snapshots returned by
   * beforeRender; this seam owns input availability only.
   */
  updateSourcePresentations(
    presentations: readonly SpatialSourcePresentationSnapshot[],
  ): void {
    if (this.disposed) return
    this.presentationInputUnavailableSourceIds.clear()
    this.presentationCapturePendingSourceIds.clear()
    for (const presentation of presentations) {
      if (sourcePresentationBlocksInput(presentation)) {
        this.presentationInputUnavailableSourceIds.add(presentation.sourceId)
      }
      if (presentation.phase === "capturing-open"
        || presentation.phase === "capturing-restore") {
        this.presentationCapturePendingSourceIds.add(presentation.sourceId)
      }
    }
    this.cancelUnavailableScrollbarThumbDrags()
  }

  syncSources(): void {
    if (!this.renderer) return
    const current = [...this.options.canvas.querySelectorAll(":scope > [data-spatial-source]")]
    const drawable = sourcesAvailableForTextureCapture(current)
    this.dynamicMedia.setVisible(this.pageVisible && this.renderer.supportsDynamicMedia())
    this.dynamicMedia.sync(drawable)
    this.renderer.syncDynamicMedia(this.dynamicMedia.records())
    const result = this.renderer.elementTextures.synchronize(drawable)
    const currentIds = new Set(current.map((element) => element.getAttribute("data-spatial-source") ?? "unknown"))
    const drawableIds = new Set(drawable.map((element) => (
      element.getAttribute("data-spatial-source") ?? "unknown"
    )))
    this.cancelScrollbarThumbDragsOutsideSources(currentIds)
    this.sourceTextureAnimations.retain(drawableIds)
    for (const sourceId of this.settlingSourceTextureAnimations.keys()) {
      if (!drawableIds.has(sourceId)) this.settlingSourceTextureAnimations.delete(sourceId)
    }
    for (const sourceId of this.releasedSourceIds) {
      const source = drawable.find((element) => element.getAttribute("data-spatial-source") === sourceId)
      if (!source) {
        this.releasedSourceIds.delete(sourceId)
        continue
      }
      const record = this.renderer.elementTextures.records()
        .find((candidate) => candidate.element === source)
      if (record && !record.released) this.renderer.elementTextures.release(source)
    }
    for (const sourceId of this.inputUnavailableSourceIds) {
      if (!currentIds.has(sourceId)) this.inputUnavailableSourceIds.delete(sourceId)
    }
    for (const sourceId of this.restoringSourceIds) {
      if (!drawableIds.has(sourceId)) this.restoringSourceIds.delete(sourceId)
    }
    for (const sourceId of this.readySourceIds) {
      if (!drawableIds.has(sourceId)) this.readySourceIds.delete(sourceId)
    }
    for (const sourceId of this.sourceCaptureRetryAttempts.keys()) {
      if (!drawableIds.has(sourceId)) this.sourceCaptureRetryAttempts.delete(sourceId)
    }
    if (result.ineligible.length > 0) {
      const reasons = result.ineligible.map(({ reason }) => reason).join(", ")
      this.metrics.recordFailure(`Ineligible HTML source released: ${reasons}.`)
    }
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
    this.schedulePendingSourceCaptureRetry()
  }

  releaseSource(sourceId: string): void {
    // Teardown gesture ownership even if the Source was already detached or
    // its renderer record disappeared before the explicit release arrived.
    this.cancelScrollbarThumbDragsForSource(sourceId)
    this.dynamicMedia.releaseSource(sourceId)
    this.renderer?.syncDynamicMedia(this.dynamicMedia.records())
    const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
    if (!source || !this.renderer) return
    this.releasedSourceIds.add(sourceId)
    this.restoringSourceIds.delete(sourceId)
    this.inputUnavailableSourceIds.add(sourceId)
    this.readySourceIds.delete(sourceId)
    this.sourceTextureAnimations.settle(sourceId)
    this.settlingSourceTextureAnimations.delete(sourceId)
    this.sourceCaptureRetryAttempts.delete(sourceId)
    const record = this.renderer.elementTextures.records()
      .find((candidate) => candidate.element === source.root)
    if (record && !record.released) this.renderer.elementTextures.release(source.root)
    this.scheduler?.request("dirty")
    this.schedulePendingSourceCaptureRetry()
    this.reportControl(`${sourceId}:texture`, "released; source DOM retained")
  }

  restoreSource(sourceId: string): void {
    const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
    if (!source || !this.renderer) return
    this.releasedSourceIds.delete(sourceId)
    this.dynamicMedia.restoreSource(sourceId)
    this.renderer?.syncDynamicMedia(this.dynamicMedia.records())
    let record = this.renderer.elementTextures.records()
      .find((candidate) => candidate.element === source.root)
    if (!record) {
      this.syncSources()
      record = this.renderer.elementTextures.records()
        .find((candidate) => candidate.element === source.root)
    }
    if (!record) return
    if (record.released) this.renderer.elementTextures.restore(source.root)
    else this.renderer.elementTextures.markDirty(source.root)
    this.restoringSourceIds.add(sourceId)
    this.inputUnavailableSourceIds.add(sourceId)
    this.readySourceIds.delete(sourceId)
    this.sourceCaptureRetryAttempts.set(sourceId, 0)
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
    this.scheduler?.request("restore")
    this.reportControl(`${sourceId}:texture`, "restored and marked dirty")
  }

  requestSourcePaint(sourceId: string, resultKey?: string, detail?: string): void {
    const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
    if (source && this.renderer) this.renderer.elementTextures.markDirty(source.root)
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
    if (resultKey && detail) this.reportControl(`${sourceId}:${resultKey}`, detail)
  }

  triggerTransition(): void {
    this.transitionEndsAt = performance.now() + (this.reducedMotion ? 0 : 520)
    this.scheduler?.request("transition")
  }

  /** Diagnostic test seam; product callers rely on browser context events. */
  triggerContextLossForDiagnostics(): void {
    const extension = this.capabilities?.gl.getExtension("WEBGL_lose_context")
    if (!extension) {
      this.contextLossProbe = "unavailable"
      this.emitSnapshot()
      return
    }
    this.contextLossProbe = "triggered"
    extension.loseContext()
    if (this.contextRestoreTimer !== null) window.clearTimeout(this.contextRestoreTimer)
    this.contextRestoreTimer = window.setTimeout(() => {
      this.contextRestoreTimer = null
      extension.restoreContext()
    }, 500)
    this.emitSnapshot()
  }

  setReducedMotionOverride(value: boolean | null): void {
    this.reducedMotionOverride = value
    this.applyMotionPreference()
  }

  resetParallax(trigger: ParallaxResetTrigger = "explicit"): void {
    if (!shouldRecenterParallax(trigger)) return
    this.targetParallax = { x: 0, y: 0 }
    if (this.pageVisible) this.scheduler?.request("parallax")
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.router?.clear({
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: this.lastMappedPoint.x,
      clientY: this.lastMappedPoint.y,
    })
    this.clearAllCapturedInput()
    this.syncProjectedCursor(null)
    this.scheduler?.dispose()
    this.resizeObserver?.disconnect()
    this.sourceObserver?.disconnect()
    if (this.metricsTimer !== null) window.clearInterval(this.metricsTimer)
    if (this.contextRestoreTimer !== null) window.clearTimeout(this.contextRestoreTimer)
    this.contextRestoreTimer = null
    this.cancelSourceCaptureRetryTimer()
    for (const clean of this.cleanup.splice(0)) clean()
    this.dynamicMedia.dispose()
    this.renderer?.syncDynamicMedia([])
    this.renderer?.dispose()
    this.renderer = null
    this.capabilities = null
    this.releasedSourceIds.clear()
    this.restoringSourceIds.clear()
    this.inputUnavailableSourceIds.clear()
    this.presentationInputUnavailableSourceIds.clear()
    this.presentationCapturePendingSourceIds.clear()
    this.readySourceIds.clear()
    this.sourceCaptureRetryAttempts.clear()
    this.sourceTextureAnimations.settleAll()
    this.settlingSourceTextureAnimations.clear()
  }

  private applyUnsupported(result: Exclude<HtmlInCanvasCapabilityResult, { supported: true }>): void {
    this.status = "unsupported"
    this.supportMessage = `${result.message} Enable chrome://flags/#canvas-draw-element and reload.`
    this.metrics.recordFailure(this.supportMessage)
    this.emitSnapshot()
  }

  private configureMotionPreference(): void {
    this.mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const listener = () => this.applyMotionPreference()
    this.mediaQuery.addEventListener("change", listener)
    this.cleanup.push(() => this.mediaQuery?.removeEventListener("change", listener))
    this.applyMotionPreference()
  }

  private applyMotionPreference(): void {
    this.reducedMotion = this.reducedMotionOverride ?? this.mediaQuery?.matches ?? false
    this.scheduler?.setReducedMotion(this.reducedMotion)
    this.options.onReducedMotionChange?.(this.reducedMotion)
    if (this.reducedMotion) {
      this.scheduler?.release("particles")
      this.scheduler?.release("animated-background")
      this.scheduler?.release("animated-source")
      this.settleSourceTextureAnimations()
    } else {
      this.requestAmbientFrames()
    }
    this.scheduler?.request("dirty")
    this.emitSnapshot()
  }

  private configureScheduler(): void {
    this.scheduler = new FrameScheduler(
      (frame) => this.renderFrame(frame),
      {
        metrics: this.metrics,
        onError: (error) => this.fail(error instanceof Error ? error.message : String(error)),
      },
    )
    this.scheduler.setReducedMotion(this.reducedMotion)
  }

  private renderFrame(frame: ScheduledFrame): { readonly continueReasons: FrameReason[] } {
    const renderer = this.renderer
    if (!renderer || this.status !== "ready") return { continueReasons: [] }
    const continueReasons: FrameReason[] = []
    if (frame.reasons.has("parallax") || this.distanceToParallaxTarget() > 0.0001) {
      if (frame.reducedMotion) {
        this.currentParallax = this.targetParallax
      } else {
        this.currentParallax = {
          x: this.currentParallax.x + (this.targetParallax.x - this.currentParallax.x) * 0.18,
          y: this.currentParallax.y + (this.targetParallax.y - this.currentParallax.y) * 0.18,
        }
        if (this.distanceToParallaxTarget() > 0.0001) continueReasons.push("parallax")
      }
    }
    const hookResult = this.options.beforeRender?.(frame)
    continueReasons.push(...hookResult?.continueReasons ?? [])
    this.updateSourcePresentations(hookResult?.sourcePresentations ?? [])
    const transitionRemaining = this.transitionEndsAt - frame.timestamp
    const transitionStrength = frame.reducedMotion || transitionRemaining <= 0
      ? 0
      : Math.sin(Math.max(0, transitionRemaining) / 520 * Math.PI)
    if (transitionRemaining > 0 && !frame.reducedMotion) continueReasons.push("transition")

    const report = renderer.render({
      time: frame.timestamp,
      parallax: this.currentParallax,
      transitionStrength,
      freezeParticles: frame.reducedMotion || !this.pageVisible,
      freezeEnvironmentEffects: frame.reducedMotion || !this.pageVisible,
      sourcePresentations: hookResult?.sourcePresentations,
    })
    this.advanceSourceTextureAnimations(frame, continueReasons)
    if (report.uploadBatch.failures.length > 0) {
      const message = report.uploadBatch.failures.map((failure) => failure.message).join("; ")
      this.metrics.recordFailure(`Element upload failed: ${message}`)
      if (report.uploadBatch.failures.some((failure) => failure.retryable)) {
        // A failed texElementImage2D attempt consumes the current paint
        // snapshot. Ask HTML-in-Canvas for a fresh snapshot so an initial
        // capturing-open Source cannot remain hidden forever.
        this.capabilities?.requestPaint()
        continueReasons.push("dirty")
      }
    } else if (renderer.elementTextures.hasUploadableDirty()) {
      continueReasons.push("dirty")
    }
    this.reportReadySources()
    this.schedulePendingSourceCaptureRetry()
    hookResult?.afterRender?.()
    if (this.pageVisible && !frame.reducedMotion) {
      continueReasons.push("particles")
      const environmentReason = renderer.environmentFrameReason()
      if (environmentReason) continueReasons.push(environmentReason)
    }
    queueMicrotask(() => {
      if (!this.disposed) this.emitSnapshot()
    })
    return { continueReasons }
  }

  private advanceSourceTextureAnimations(
    frame: ScheduledFrame,
    continueReasons: FrameReason[],
  ): void {
    const animationFrame = this.sourceTextureAnimations.frame(frame.timestamp)
    for (const sourceId of animationFrame.expiredSourceIds) {
      this.queueSourceTextureAnimationSettlement(sourceId, frame.timestamp)
    }
    if (!frame.reducedMotion && this.pageVisible) {
      let hasActiveSource = false
      for (const sourceId of animationFrame.activeSourceIds) {
        if (this.requestNextSourceTextureAnimationPaint(sourceId)) {
          hasActiveSource = true
        } else {
          this.sourceTextureAnimations.settle(sourceId)
        }
      }
      if (hasActiveSource) continueReasons.push("animated-source")
    }
    this.advanceSourceTextureAnimationSettlements(frame.timestamp)
  }

  /**
   * Keep at most one paint snapshot outstanding per Source. Re-marking a
   * dirty record here would clear paintReady and turn a smooth CSS transition
   * into alternating stale/final texture uploads.
   */
  private requestNextSourceTextureAnimationPaint(sourceId: string): boolean {
    const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
    const renderer = this.renderer
    if (!source || !renderer || this.sourceInputUnavailable(sourceId)) return false
    const record = renderer.elementTextures.records()
      .find((candidate) => candidate.element === source.root)
    if (!record || record.released) return false
    if (shouldQueueNextSourceTexturePaint(record)) {
      renderer.elementTextures.markDirty(source.root)
      this.capabilities?.requestPaint()
    }
    return true
  }

  private queueSourceTextureAnimationSettlement(sourceId: string, timestamp: number): void {
    this.settlingSourceTextureAnimations.set(sourceId, {
      finalRequested: false,
      expiresAt: timestamp + SOURCE_TEXTURE_ANIMATION_SETTLE_MAX_MS,
    })
    this.scheduler?.request("dirty")
  }

  private advanceSourceTextureAnimationSettlements(timestamp: number): void {
    if (!this.pageVisible) return
    for (const [sourceId, settlement] of this.settlingSourceTextureAnimations) {
      if (timestamp >= settlement.expiresAt) {
        this.settlingSourceTextureAnimations.delete(sourceId)
        continue
      }
      const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
      const renderer = this.renderer
      if (!source || !renderer || this.sourceInputUnavailable(sourceId)) {
        this.settlingSourceTextureAnimations.delete(sourceId)
        continue
      }
      const record = renderer.elementTextures.records()
        .find((candidate) => candidate.element === source.root)
      if (!record) {
        this.settlingSourceTextureAnimations.delete(sourceId)
        continue
      }
      const action = sourceTextureAnimationSettlementAction(record, settlement.finalRequested)
      if (action === "wait") continue
      if (action === "complete" || action === "drop") {
        this.settlingSourceTextureAnimations.delete(sourceId)
      } else {
        renderer.elementTextures.markDirty(source.root)
        this.capabilities?.requestPaint()
        settlement.finalRequested = true
      }
    }
  }

  private settleSourceTextureAnimations(): void {
    for (const sourceId of this.sourceTextureAnimations.settleAll()) {
      this.queueSourceTextureAnimationSettlement(sourceId, performance.now())
    }
  }

  private reportReadySources(): void {
    if (!this.renderer) return
    for (const record of this.renderer.elementTextures.records()) {
      const sourceId = record.element.getAttribute("data-spatial-source") ?? ""
      if (!sourceId || this.readySourceIds.has(sourceId)) continue
      if (record.uploadedGeneration <= 0 || record.dirty || record.released) continue
      this.readySourceIds.add(sourceId)
      this.restoringSourceIds.delete(sourceId)
      this.inputUnavailableSourceIds.delete(sourceId)
      this.sourceCaptureRetryAttempts.delete(sourceId)
      this.options.onSourceReady?.(sourceId)
    }
  }

  private pendingSourceCaptureIdsWithoutSnapshot(): string[] {
    if (!this.renderer) return []
    const pendingSourceIds = new Set([
      ...this.restoringSourceIds,
      ...this.presentationCapturePendingSourceIds,
    ])
    if (pendingSourceIds.size === 0) return []
    return this.renderer.elementTextures.records().flatMap((record) => {
      const sourceId = record.element.getAttribute("data-spatial-source") ?? ""
      const waiting = pendingSourceIds.has(sourceId)
        && !record.released
        && record.dirty
        && !record.paintReady
      return waiting ? [sourceId] : []
    })
  }

  private schedulePendingSourceCaptureRetry(): void {
    if (this.disposed || this.status !== "ready" || !this.capabilities) {
      this.cancelSourceCaptureRetryTimer()
      return
    }
    const pendingSourceIds = this.pendingSourceCaptureIdsWithoutSnapshot()
    const pendingSourceIdSet = new Set(pendingSourceIds)
    for (const sourceId of this.sourceCaptureRetryAttempts.keys()) {
      if (!pendingSourceIdSet.has(sourceId)) this.sourceCaptureRetryAttempts.delete(sourceId)
    }
    const retryableSourceIds = pendingSourceIds.filter(
      (sourceId) => (this.sourceCaptureRetryAttempts.get(sourceId) ?? 0)
        < SOURCE_CAPTURE_PAINT_RETRY_LIMIT,
    )
    if (retryableSourceIds.length === 0) {
      this.cancelSourceCaptureRetryTimer()
      return
    }
    if (this.sourceCaptureRetryTimer !== null) return

    const attempt = Math.min(...retryableSourceIds.map(
      (sourceId) => this.sourceCaptureRetryAttempts.get(sourceId) ?? 0,
    ))
    const delay = Math.min(
      SOURCE_CAPTURE_PAINT_RETRY_MAX_DELAY_MS,
      SOURCE_CAPTURE_PAINT_RETRY_BASE_DELAY_MS * 2 ** Math.min(attempt, 3),
    )
    this.sourceCaptureRetryTimer = window.setTimeout(() => {
      this.sourceCaptureRetryTimer = null
      if (this.disposed || this.status !== "ready" || !this.capabilities) return

      const waitingSourceIds = this.pendingSourceCaptureIdsWithoutSnapshot()
      let requested = false
      for (const sourceId of waitingSourceIds) {
        const attempts = this.sourceCaptureRetryAttempts.get(sourceId) ?? 0
        if (attempts >= SOURCE_CAPTURE_PAINT_RETRY_LIMIT) continue
        this.sourceCaptureRetryAttempts.set(sourceId, attempts + 1)
        requested = true
      }
      if (!requested) return

      // A coalesced payload may legitimately name only another Source. Ask
      // for another platform snapshot without treating that payload as broad
      // authorization or sustaining a permanent animation-frame loop.
      this.capabilities.requestPaint()
      this.scheduler?.request("restore")
    }, delay)
  }

  private cancelSourceCaptureRetryTimer(): void {
    if (this.sourceCaptureRetryTimer === null) return
    window.clearTimeout(this.sourceCaptureRetryTimer)
    this.sourceCaptureRetryTimer = null
  }

  private configureInputRouter(): void {
    this.router = new PointerRouter<Element>({
      chain: (target) => this.targetChain(target),
      dispatch: (target, type, sample, relatedTarget) => this.dispatchDomEvent(
        target,
        type,
        sample,
        relatedTarget,
      ),
      focus: (target) => (target as HTMLElement).focus?.({ preventScroll: true }),
      activate: (target, sample) => this.activateTarget(target, sample),
      activationPolicy: (target) => activationPolicyForElement(target),
      captureTarget: (target, sample) => {
        if (sample.button !== 0) return target
        const gestureStart = target.closest("[data-spatial-gesture-start]")
        return gestureStart?.closest("[data-spatial-gesture-owner]") ?? target
      },
      setCapture: (pointerId) => {
        try {
          this.options.inputPlane.setPointerCapture(pointerId)
        } catch {
          // Logical capture remains authoritative when browser capture is rejected.
        }
      },
      releaseCapture: (pointerId) => {
        try {
          if (this.options.inputPlane.hasPointerCapture(pointerId)) {
            this.options.inputPlane.releasePointerCapture(pointerId)
          }
        } catch {
          // Teardown and pointercancel are intentionally idempotent.
        }
      },
      scroll: (target, sample) => this.scrollTarget(target, sample),
      setHoverState: (chain) => this.syncRoutedState(
        "data-spatial-hover",
        this.routedHoverElements,
        chain,
        "hover",
      ),
      setActiveState: (chain) => this.syncRoutedState(
        "data-spatial-active",
        this.routedActiveElements,
        chain,
        "active",
      ),
      reportSyntheticDelivery: (report) => this.reportSyntheticDelivery(report),
      reportNativeOutcome: (outcome) => {
        this.lastNativeOutcome = `${outcome.status}: ${outcome.detail}`
        this.emitSnapshot()
      },
    })

    this.listen(this.options.inputPlane, "pointermove", (event) => {
      const pointer = event as PointerEvent
      this.updateParallaxTarget(pointer)
      const resolved = this.resolveInput(pointer)
      const hasCapture = (this.router?.captureCount() ?? 0) > 0
      this.router?.move(resolved.target, resolved.sample)
      this.updateCapturedScrollbarThumbDrag(resolved.sample)
      if (!hasCapture) this.syncProjectedCursor(resolved.target)
    })
    this.listen(this.options.inputPlane, "pointerdown", (event) => {
      const pointer = event as PointerEvent
      pointer.preventDefault()
      const resolved = this.resolveInput(pointer)
      this.syncProjectedCursor(resolved.target)
      const activationAllowed = this.router?.down(resolved.target, resolved.sample) ?? false
      if (activationAllowed) this.beginCapturedScrollbarThumbDrag(resolved)
      if (resolved.source && resolved.mapping
        && this.router?.capturedTarget(resolved.sample.pointerId)) {
        const projection = captureSceneProjection(
          resolved.source,
          this.options.canvas.getBoundingClientRect(),
          this.currentParallax,
        )
        this.capturedSceneProjections.set(
          resolved.sample.pointerId,
          {
            projection,
            visualClient: { x: pointer.clientX, y: pointer.clientY },
            localClient: { ...resolved.mapping.localClient },
            screenToLocal: capturedSceneScreenToLocalDifferential(
              projection,
              resolved.mapping.localNormalized,
            ),
            extrapolating: false,
          },
        )
      }
    })
    this.listen(this.options.inputPlane, "pointerup", (event) => {
      const pointer = event as PointerEvent
      const resolved = this.resolveInput(pointer)
      this.updateCapturedScrollbarThumbDrag(resolved.sample)
      this.router?.up(resolved.target, resolved.sample)
      this.clearCapturedInput(resolved.sample.pointerId)
      // Capture resolution intentionally targets the gesture owner. Once the
      // gesture ends, resolve again so the visible cursor follows the element
      // actually beneath the pointer instead of the former capture target.
      this.syncProjectedCursor(this.resolveInput(pointer).target)
    })
    this.listen(this.options.inputPlane, "pointercancel", (event) => {
      const pointer = event as PointerEvent
      const resolved = this.resolveInput(pointer)
      this.router?.cancel(pointer.pointerId, resolved.sample)
      this.clearCapturedInput(resolved.sample.pointerId)
      this.syncProjectedCursor(null)
    })
    this.listen(this.options.inputPlane, "pointerleave", (event) => {
      const pointer = event as PointerEvent
      if (this.router?.captureCount()) return
      const resolved = this.resolveInput(pointer)
      this.router?.move(null, resolved.sample)
      this.syncProjectedCursor(null)
    })
    this.listen(this.options.inputPlane, "dblclick", (event) => {
      event.preventDefault()
      const resolved = this.resolveInput(event as MouseEvent)
      this.router?.doubleClick(resolved.target, resolved.sample)
    })
    this.listen(this.options.inputPlane, "contextmenu", (event) => {
      event.preventDefault()
      const resolved = this.resolveInput(event as MouseEvent)
      this.router?.contextMenu(resolved.target, resolved.sample)
    })
    this.listen(this.options.inputPlane, "wheel", (event) => {
      event.preventDefault()
      const resolved = this.resolveInput(event as WheelEvent)
      this.router?.wheel(resolved.target, resolved.sample)
    }, { passive: false })
  }

  private configureLifecycle(): void {
    const removePaintHandler = this.capabilities?.setPaintHandler((payload) => {
      const result = this.renderer?.elementTextures.handlePaint(payload)
      if (result && (result.marked > 0 || result.removed > 0)) this.scheduler?.request("dirty")
    })
    if (removePaintHandler) this.cleanup.push(removePaintHandler)

    const sourceMutation = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const root = target.closest("[data-spatial-source]")
      if (root && root.parentElement === this.options.canvas) {
        this.renderer?.elementTextures.markDirty(root)
        this.capabilities?.requestPaint()
        this.scheduler?.request("dirty")
      }
    }
    for (const type of ["input", "change", "focusin", "focusout", "compositionupdate", "keyup"]) {
      this.listen(this.options.canvas, type, sourceMutation, true)
    }
    this.listen(this.options.canvas, "transitionrun", (event) => {
      this.beginSourceTextureAnimation(event)
    }, true)
    for (const type of ["transitionend", "transitioncancel"]) {
      this.listen(this.options.canvas, type, (event) => {
        this.endSourceTextureAnimation(event)
      }, true)
    }
    if (typeof MutationObserver === "function") {
      this.sourceObserver = new MutationObserver(() => this.syncSources())
      this.sourceObserver.observe(this.options.canvas, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "style", "data-spatial-render"],
      })
    }

    this.listen(window, "blur", () => {
      this.resetParallax("window-blur")
      this.cancelRoutedInput()
    })
    this.listen(document, "visibilitychange", () => {
      this.pageVisible = document.visibilityState !== "hidden"
      if (!this.pageVisible) {
        this.scheduler?.release("particles")
        this.scheduler?.release("animated-background")
        this.scheduler?.release("animated-source")
        this.scheduler?.release("animated-media")
        this.dynamicMedia.setVisible(false)
        this.resetParallax("document-hidden")
        this.cancelRoutedInput()
        return
      }
      if (this.distanceToParallaxTarget() > 0.0001) this.scheduler?.request("parallax")
      if (this.sourceTextureAnimations.hasAny()) this.scheduler?.request("animated-source")
      this.dynamicMedia.setVisible(this.renderer?.supportsDynamicMedia() === true)
      this.requestAmbientFrames()
      this.scheduler?.request("dirty")
    })

    this.listen(this.options.canvas, "webglcontextlost", (event) => {
      event.preventDefault()
      this.status = "context-lost"
      this.options.onContextLost?.()
      this.cancelSourceCaptureRetryTimer()
      this.sourceCaptureRetryAttempts.clear()
      this.sourceTextureAnimations.settleAll()
      this.dynamicMedia.setVisible(false)
      this.settlingSourceTextureAnimations.clear()
      this.scheduler?.cancel()
      // Every context-specific texture generation is now invalid. Successful
      // replacement uploads must be reported again, especially for a
      // capture-gated restore interrupted by the loss.
      this.readySourceIds.clear()
      this.renderer?.handleContextLost()
      this.emitSnapshot()
    })
    this.listen(this.options.canvas, "webglcontextrestored", () => {
      if (this.contextRestoreTimer !== null) window.clearTimeout(this.contextRestoreTimer)
      this.contextRestoreTimer = null
      const acquired = acquireHtmlInCanvasCapabilities(this.options.canvas)
      const renderer = this.renderer
      if (!acquired.supported || !renderer) {
        this.fail(acquired.supported ? "Renderer unavailable during restore." : acquired.message)
        return
      }
      this.capabilities = acquired.capabilities
      this.apiVariant = acquired.capabilities.apiVariant
      this.contextVariant = acquired.capabilities.contextVariant
      const restored = renderer.restore(acquired.capabilities, window.devicePixelRatio)
      if (!restored.ok) {
        this.fail(`${restored.failure.stage}: ${restored.failure.message}`)
        return
      }
      this.options.onWindowPresentationSupport?.(renderer.supportsWindowPresentation())
      this.options.onWindowRipplePresentationSupport?.(
        renderer.supportsWindowRipplePresentation(),
      )
      this.status = "ready"
      this.sourceCaptureRetryAttempts.clear()
      this.contextLossProbe = acquired.capabilities.gl.getExtension("WEBGL_lose_context")
        ? "available"
        : "unavailable"
      this.capabilities.requestPaint()
      this.dynamicMedia.setVisible(this.pageVisible && renderer.supportsDynamicMedia())
      renderer.syncDynamicMedia(this.dynamicMedia.records())
      this.scheduler?.request("restore")
      this.options.onContextRestored?.()
      this.emitSnapshot()
    })

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(this.options.canvas)
    } else {
      const resize = () => this.resize()
      window.addEventListener("resize", resize)
      this.cleanup.push(() => window.removeEventListener("resize", resize))
    }
  }

  private resolveInput(event: PointerEvent | MouseEvent | WheelEvent): ResolvedInput {
    const trusted = { x: event.clientX, y: event.clientY }
    const canvasRect = this.options.canvas.getBoundingClientRect()
    const pointer = event as PointerEvent
    const pointerId = typeof pointer.pointerId === "number" ? pointer.pointerId : 1
    const capturedTarget = this.router?.capturedTarget(pointerId) ?? null
    const capturedSource = capturedTarget ? this.sourceForElement(capturedTarget) : null
    if (capturedTarget && (
      !capturedSource || this.sourceInputUnavailable(capturedSource.sourceId)
    )) {
      // Presentation/lifecycle exclusion is authoritative even for a gesture
      // captured before the phase changed. Cancel instead of projecting or
      // dispatching one more event into an opening/guard/closing Source.
      const sample = eventSample(event, this.lastMappedPoint)
      this.router?.cancel(pointerId, sample)
      this.clearCapturedInput(pointerId)
      this.syncProjectedCursor(null)
      this.pointer = {
        trusted,
        curved: null,
        planar: null,
        sourceId: capturedSource?.sourceId ?? null,
        targetId: null,
        status: "source-input-unavailable",
      }
      this.emitSnapshot()
      return { target: null, source: null, mapping: null, resolution: null, sample }
    }
    if (capturedTarget) {
      const capturedInput = this.capturedSceneProjections.get(pointerId)
      if (capturedInput) {
        if (!capturedInput.extrapolating) {
          const mapping = projectCapturedSceneSource(
            capturedInput.projection,
            trusted,
          )
          if (mapping.ok) {
            capturedInput.visualClient = { ...trusted }
            capturedInput.localClient = { ...mapping.localClient }
            capturedInput.screenToLocal = capturedSceneScreenToLocalDifferential(
              capturedInput.projection,
              mapping.localNormalized,
            ) ?? capturedInput.screenToLocal
            return this.finishResolvedInput(
              event,
              trusted,
              capturedTarget,
              capturedInput.projection.source,
              mapping,
              null,
              "captured",
            )
          }
          capturedInput.extrapolating = true
        }

        // The curved inverse is intentionally bounded and can stop converging
        // once a captured pointer moves far beyond every Source. Keep the
        // gesture continuous from its last valid local sample instead of
        // reusing that sample forever and producing a zero delta.
        const screenDelta = {
          x: trusted.x - capturedInput.visualClient.x,
          y: trusted.y - capturedInput.visualClient.y,
        }
        const differential = capturedInput.screenToLocal
        const localDelta = differential
          ? {
              x: differential.xx * screenDelta.x + differential.xy * screenDelta.y,
              y: differential.yx * screenDelta.x + differential.yy * screenDelta.y,
            }
          : { x: 0, y: 0 }
        const localClient = {
          x: capturedInput.localClient.x + localDelta.x,
          y: capturedInput.localClient.y + localDelta.y,
        }
        capturedInput.visualClient = { ...trusted }
        capturedInput.localClient = localClient
        const rect = capturedInput.projection.source.rect
        return this.finishResolvedInput(
          event,
          trusted,
          capturedTarget,
          capturedInput.projection.source,
          {
            localClient,
            localNormalized: {
              x: (localClient.x - rect.left) * 2 / rect.width - 1,
              y: (localClient.y - rect.top) * 2 / rect.height - 1,
            },
          },
          null,
          "captured-extrapolated",
        )
      }
    }

    if (trusted.x < canvasRect.left || trusted.x > canvasRect.left + canvasRect.width
      || trusted.y < canvasRect.top || trusted.y > canvasRect.top + canvasRect.height) {
      this.pointer = {
        trusted,
        curved: null,
        planar: null,
        sourceId: null,
        targetId: null,
        status: "outside-canvas",
      }
      const sample = eventSample(event, this.lastMappedPoint)
      this.emitSnapshot()
      return { target: null, source: null, mapping: null, resolution: null, sample }
    }

    const inputSources = this.inputSourceRoots()
    const sceneSources = this.sceneSources(inputSources)
    for (const hit of projectedSceneHits(
      sceneSources,
      trusted,
      canvasRect,
      this.currentParallax,
    )) {
      const resolution = resolveProjectedTarget({
        document: this.options.canvas.ownerDocument,
        point: hit.mapping.localClient,
        expectedSourceId: hit.source.sourceId,
        // Surface overlap was already resolved in visual space. Restrict DOM
        // resolution to this Source so a different planar Source cannot steal
        // the projected point merely because its unposed DOM boxes overlap.
        sources: [{ sourceId: hit.source.sourceId, root: hit.source.root }],
        ignoredElements: this.ignoredElements,
      })
      if (resolution.status === "hit") {
        return this.finishResolvedInput(
          event,
          trusted,
          resolution.target,
          hit.source,
          hit.mapping,
          resolution,
          resolution.status,
        )
      }
    }

    this.pointer = {
      trusted,
      curved: null,
      planar: null,
      sourceId: null,
      targetId: null,
      status: "no-hit",
    }
    this.emitSnapshot()
    return {
      target: null,
      source: null,
      mapping: null,
      resolution: null,
      sample: eventSample(event, this.lastMappedPoint),
    }
  }

  private finishResolvedInput(
    event: PointerEvent | MouseEvent | WheelEvent,
    trusted: SpatialPoint,
    target: Element,
    source: SceneSourceSurface,
    mapping: { readonly localNormalized: SpatialPoint; readonly localClient: SpatialPoint },
    resolution: DomTargetResolution | null,
    status: string,
  ): ResolvedInput {
    this.lastMappedPoint = mapping.localClient
    this.pointer = {
      trusted,
      curved: mapping.localNormalized,
      planar: mapping.localClient,
      sourceId: source.sourceId,
      targetId: this.targetLabel(target),
      status,
    }
    this.emitSnapshot()
    return {
      target,
      source,
      mapping,
      resolution,
      sample: eventSample(event, mapping.localClient),
    }
  }

  private sourceRoots(): SpatialSourceRoot[] {
    return [...this.options.canvas.querySelectorAll(":scope > [data-spatial-source]")]
      .map((root) => ({ sourceId: root.getAttribute("data-spatial-source") ?? "unknown", root }))
  }

  private inputSourceRoots(): SpatialSourceRoot[] {
    return sourcesAvailableForProjectedInput(this.sourceRoots(), this.inputUnavailableSourceIds)
      .filter(({ sourceId }) => !this.sourceInputUnavailable(sourceId))
      .filter(({ root }) => root.getAttribute("data-spatial-input") !== "none")
  }

  private sourceInputUnavailable(sourceId: string): boolean {
    return this.inputUnavailableSourceIds.has(sourceId)
      || this.presentationInputUnavailableSourceIds.has(sourceId)
  }

  private sceneSources(sources: readonly SpatialSourceRoot[] = this.inputSourceRoots()): SceneSourceSurface[] {
    return sources.map(({ root }, index) => sceneSourceForElement(root, index))
  }

  private targetChain(target: Element): readonly Element[] {
    const source = this.sourceRoots().find(({ root }) => root === target || root.contains(target))
    if (!source) return [target]
    const chain: Element[] = []
    let current: Element | null = target
    while (current) {
      chain.push(current)
      if (current === source.root) break
      current = current.parentElement
    }
    return chain.reverse()
  }

  private dispatchDomEvent(
    target: Element,
    type: RoutedPointerEventType,
    sample: RoutedPointerSample,
    relatedTarget: Element | null,
  ): boolean {
    const view = target.ownerDocument.defaultView ?? window
    const bubbles = !["pointerenter", "mouseenter", "pointerleave", "mouseleave"].includes(type)
    const base: MouseEventInit = {
      bubbles,
      cancelable: true,
      composed: true,
      button: sample.button,
      buttons: sample.buttons,
      clientX: sample.clientX,
      clientY: sample.clientY,
      detail: routedMouseEventDetail(type, sample.detail),
      relatedTarget,
      altKey: sample.altKey,
      ctrlKey: sample.ctrlKey,
      metaKey: sample.metaKey,
      shiftKey: sample.shiftKey,
      view,
    }
    const dispatch = (routedEvent: Event): boolean => {
      Object.defineProperties(routedEvent, {
        spatialScreenClientX: { value: sample.screenClientX ?? sample.clientX },
        spatialScreenClientY: { value: sample.screenClientY ?? sample.clientY },
      })
      return target.dispatchEvent(routedEvent)
    }
    if (type === "wheel") {
      return dispatch(new view.WheelEvent(type, {
        ...base,
        deltaX: sample.deltaX ?? 0,
        deltaY: sample.deltaY ?? 0,
      }))
    }
    if (type.startsWith("pointer") && typeof view.PointerEvent === "function") {
      const dispatched = dispatch(new view.PointerEvent(type, {
        ...base,
        detail: sample.detail ?? 0,
        pointerId: sample.pointerId,
        pointerType: sample.pointerType,
        isPrimary: sample.isPrimary,
      }))
      if (type === "pointermove"
        && target.tagName.toLowerCase() === "input"
        && (target as HTMLInputElement).type === "range"
        && this.router?.capturedTarget(sample.pointerId) === target) {
        const rangeResult = updateRangeFromPoint(target as HTMLInputElement, {
          x: sample.clientX,
          y: sample.clientY,
        })
        if (rangeResult.status === "unsupported") {
          this.lastNativeOutcome = `unsupported: ${rangeResult.message}`
          this.metrics.recordFailure(rangeResult.message)
        }
      }
      return dispatched
    }
    return dispatch(new view.MouseEvent(type, base))
  }

  private activateTarget(target: Element, sample: RoutedPointerSample): NativeActivationOutcome {
    const nativeEscape = openNativePicker(target, { trustedSource: sample.trustedSource === true })
    if (nativeEscape.status === "requested") {
      if (nativeEscape.method === "showPicker") {
        this.dispatchDomEvent(target, "click", { ...sample, buttons: 0 }, null)
      }
      this.lastNativeEscape = `${this.targetLabel(target)} requested via ${nativeEscape.method}`
      this.reportControl(
        `${this.pointer.sourceId ?? "unknown"}:native-picker`,
        `request accepted (${nativeEscape.method}); popup outcome remains browser-only`,
      )
      this.emitSnapshot()
      return {
        status: "requested",
        detail: `trusted picker request accepted via ${nativeEscape.method}; opening is not script-verifiable`,
      }
    }
    if (nativeEscape.status === "unsupported") {
      this.lastNativeEscape = `unsupported${nativeEscape.errorName ? ` (${nativeEscape.errorName})` : ""}: ${nativeEscape.message}`
      this.metrics.recordFailure(this.lastNativeEscape)
      this.emitSnapshot()
      return { status: "unsupported", detail: this.lastNativeEscape }
    }

    const tag = target.tagName.toLowerCase()
    if (tag === "input" && (target as HTMLInputElement).type === "range") {
      const result = updateRangeFromPoint(
        target as HTMLInputElement,
        { x: sample.clientX, y: sample.clientY },
        { commit: true },
      )
      this.dispatchDomEvent(target, "click", { ...sample, buttons: 0 }, null)
      if (result.status === "updated") {
        return { status: "verified", detail: `range value=${result.value}; changed=${String(result.changed)}` }
      }
      const message = result.status === "unsupported" ? result.message : "Target is not a range input."
      this.metrics.recordFailure(message)
      return { status: "unsupported", detail: message }
    }
    const editable = tag === "input" || tag === "textarea" || (target as HTMLElement).isContentEditable
    if (editable) {
      ;(target as HTMLElement).focus?.({ preventScroll: true })
      const caret = placeCaretAtPoint(target, { x: sample.clientX, y: sample.clientY })
      this.dispatchDomEvent(target, "click", { ...sample, buttons: 0 }, null)
      if (caret.status === "unsupported") {
        const message = `${this.targetLabel(target)}: ${caret.message}`
        this.metrics.recordFailure(message)
        this.reportControl(`${this.pointer.sourceId ?? "unknown"}:caret`, message)
        this.emitSnapshot()
        return { status: "unsupported", detail: message }
      }
      this.reportControl(
        `${this.pointer.sourceId ?? "unknown"}:caret`,
        `placed via ${caret.method}; keyboard and IME remain browser-owned`,
      )
      return { status: "verified", detail: `contenteditable caret placed via ${caret.method}` }
    }

    if (tag === "input") {
      const input = target as HTMLInputElement
      if (input.type === "checkbox" || input.type === "radio") {
        const previous = input.checked
        input.click()
        const changed = input.checked !== previous
        if (input.type === "radio" && previous && input.checked) {
          return {
            status: "verified",
            detail: "radio remained checked; final native state verified without a mutation claim",
          }
        }
        return changed
          ? { status: "verified", detail: `${input.type} checked=${String(input.checked)}` }
          : { status: "unsupported", detail: `${input.type} state did not change after synthetic activation` }
      }
    }
    const clickable = target as HTMLElement
    if (typeof clickable.click === "function") {
      clickable.click()
      return {
        status: "requested",
        detail: `${this.targetLabel(target)} synthetic click invoked; handler delivery is not a trusted default action`,
      }
    }
    this.dispatchDomEvent(target, "click", { ...sample, buttons: 0 }, null)
    return {
      status: "requested",
      detail: `${this.targetLabel(target)} synthetic click dispatched without a verifiable native state`,
    }
  }

  private scrollTarget(target: Element, sample: RoutedPointerSample): void {
    const source = this.sourceRoots().find(({ root }) => root === target || root.contains(target))
    if (!source) return
    const scrollable = findScrollableAncestor(target, source.root)
    if (!scrollable) {
      this.reportControl(`${source.sourceId}:scroll`, "no scrollable ancestor at mapped point")
      return
    }
    const result = scrollElementBy(scrollable, sample.deltaX ?? 0, sample.deltaY ?? 0)
    this.reportControl(
      `${source.sourceId}:scroll`,
      result.changed
        ? `scrollLeft=${result.position.left}, scrollTop=${result.position.top}`
        : "clamped at scroll boundary",
    )
    this.renderer?.elementTextures.markDirty(source.root)
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
  }

  private beginCapturedScrollbarThumbDrag(resolved: ResolvedInput): void {
    if (!resolved.target || !resolved.source || !resolved.mapping || resolved.sample.button !== 0) return
    const result = findScrollbarThumbDrag(
      resolved.target,
      resolved.source.root,
      resolved.mapping.localClient,
    )
    if (result.status !== "started") return
    if (!this.router?.suppressActivation(resolved.sample.pointerId)) return
    this.capturedScrollbarThumbDrags.set(resolved.sample.pointerId, {
      sourceId: resolved.source.sourceId,
      sourceRoot: resolved.source.root,
      state: result.state,
    })
    this.reportControl(
      `${resolved.source.sourceId}:scrollbar`,
      `${result.state.axis} thumb drag captured`,
    )
  }

  private updateCapturedScrollbarThumbDrag(sample: RoutedPointerSample): void {
    const captured = this.capturedScrollbarThumbDrags.get(sample.pointerId)
    if (!captured) return
    const sourceStillAvailable = captured.sourceRoot.parentElement === this.options.canvas
      && !this.sourceInputUnavailable(captured.sourceId)
      && captured.sourceRoot.contains(captured.state.element)
    if (!sourceStillAvailable) {
      this.cancelScrollbarThumbDrag(sample.pointerId)
      return
    }

    const result = updateScrollbarThumbDrag(captured.state, {
      x: sample.clientX,
      y: sample.clientY,
    })
    if (!result.changed) return
    this.reportControl(
      `${captured.sourceId}:scrollbar`,
      `scrollLeft=${result.position.left}, scrollTop=${result.position.top}`,
    )
    if (this.renderer?.elementTextures.markDirty(captured.sourceRoot)) {
      this.capabilities?.requestPaint()
      this.scheduler?.request("dirty")
    }
  }

  private cancelScrollbarThumbDrag(pointerId: number): void {
    if (!this.capturedScrollbarThumbDrags.delete(pointerId)) return
    this.capturedSceneProjections.delete(pointerId)
    this.router?.cancel(pointerId, {
      pointerId,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: this.lastMappedPoint.x,
      clientY: this.lastMappedPoint.y,
    })
  }

  private cancelScrollbarThumbDragsForSource(sourceId: string): void {
    for (const [pointerId, captured] of [...this.capturedScrollbarThumbDrags]) {
      if (captured.sourceId === sourceId) this.cancelScrollbarThumbDrag(pointerId)
    }
  }

  private cancelScrollbarThumbDragsOutsideSources(currentSourceIds: ReadonlySet<string>): void {
    for (const [pointerId, captured] of [...this.capturedScrollbarThumbDrags]) {
      if (!currentSourceIds.has(captured.sourceId)
        || captured.sourceRoot.parentElement !== this.options.canvas) {
        this.cancelScrollbarThumbDrag(pointerId)
      }
    }
  }

  private cancelUnavailableScrollbarThumbDrags(): void {
    for (const [pointerId, captured] of [...this.capturedScrollbarThumbDrags]) {
      if (this.sourceInputUnavailable(captured.sourceId)) {
        this.cancelScrollbarThumbDrag(pointerId)
      }
    }
  }

  private syncRoutedState(
    attribute: "data-spatial-hover" | "data-spatial-active",
    current: Set<Element>,
    nextChain: readonly Element[],
    resultKey: "hover" | "active",
  ): void {
    const next = new Set(nextChain)
    const affectedSources = new Map<string, Element>()
    let changed = false
    for (const element of [...current]) {
      if (next.has(element)) continue
      element.removeAttribute(attribute)
      const source = this.sourceForElement(element)
      if (source) affectedSources.set(source.sourceId, source.root)
      current.delete(element)
      changed = true
    }
    for (const element of next) {
      if (current.has(element)) continue
      element.setAttribute(attribute, "")
      const source = this.sourceForElement(element)
      if (source) affectedSources.set(source.sourceId, source.root)
      current.add(element)
      changed = true
    }
    if (!changed) return

    const target = nextChain[nextChain.length - 1] ?? null
    const targetSource = target ? this.sourceForElement(target) : null
    if (target && targetSource && target !== targetSource.root) {
      this.reportControl(`${targetSource.sourceId}:${resultKey}`, this.targetLabel(target))
    }
    let dirtiedSourceCount = 0
    for (const [sourceId, root] of affectedSources) {
      // Hover/pressed DOM state may still be unwinding after a click changes
      // lifecycle phase. It must not invalidate a hidden capture-gated Source
      // or make restore liveness depend on where the pointer moves next.
      if (this.sourceInputUnavailable(sourceId)) continue
      if (this.renderer?.elementTextures.markDirty(root)) dirtiedSourceCount += 1
    }
    if (!this.disposed && dirtiedSourceCount > 0) {
      this.capabilities?.requestPaint()
      this.scheduler?.request("dirty")
    }
  }

  private beginSourceTextureAnimation(event: Event): void {
    if (this.reducedMotion || !this.pageVisible) return
    const source = this.sourceTextureAnimationSource(event)
    if (!source) return
    this.settlingSourceTextureAnimations.delete(source.sourceId)
    this.sourceTextureAnimations.begin(source.sourceId, performance.now())
    if (!this.requestNextSourceTextureAnimationPaint(source.sourceId)) {
      this.sourceTextureAnimations.settle(source.sourceId)
      return
    }
    this.scheduler?.request("animated-source")
  }

  private endSourceTextureAnimation(event: Event): void {
    const source = this.sourceTextureAnimationSource(event)
    if (!source || !this.sourceTextureAnimations.has(source.sourceId)) return
    if (!this.sourceTextureAnimations.end(source.sourceId)) {
      this.queueSourceTextureAnimationSettlement(source.sourceId, performance.now())
    }
  }

  private sourceTextureAnimationSource(event: Event): SpatialSourceRoot | null {
    const target = event.target
    if (!(target instanceof Element)
      || !target.closest("[data-spatial-source-animation]")) return null
    return this.sourceForElement(target)
  }

  private sourceForElement(element: Element): SpatialSourceRoot | null {
    return this.sourceRoots().find(({ root }) => root === element || root.contains(element)) ?? null
  }

  private clearCapturedInput(pointerId: number): void {
    this.capturedSceneProjections.delete(pointerId)
    this.capturedScrollbarThumbDrags.delete(pointerId)
  }

  private clearAllCapturedInput(): void {
    this.capturedSceneProjections.clear()
    this.capturedScrollbarThumbDrags.clear()
  }

  private updateParallaxTarget(event: PointerEvent): void {
    const rect = this.options.canvas.getBoundingClientRect()
    this.targetParallax = viewportParallaxTarget({ x: event.clientX, y: event.clientY }, rect)
    this.scheduler?.request("parallax")
  }

  private requestAmbientFrames(): void {
    if (!this.pageVisible || this.reducedMotion) return
    this.scheduler?.request("particles")
    const environmentReason = this.renderer?.environmentFrameReason()
    if (environmentReason) this.scheduler?.request(environmentReason)
  }

  private cancelRoutedInput(): void {
    this.router?.cancelAll({
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: this.lastMappedPoint.x,
      clientY: this.lastMappedPoint.y,
    })
    this.clearAllCapturedInput()
    this.syncProjectedCursor(null)
  }

  private syncProjectedCursor(target: Element | null): void {
    const fallback = this.options.projectedCursorFallback
    if (fallback === undefined) return
    if (!target) {
      this.options.inputPlane.style.cursor = fallback
      return
    }
    const view = target.ownerDocument.defaultView
    const cursor = view?.getComputedStyle(target).cursor.trim() ?? ""
    this.options.inputPlane.style.cursor = cursor && cursor !== "auto" ? cursor : fallback
  }

  private reportSyntheticDelivery(report: SyntheticDeliveryReport): void {
    const canceled = report.canceled.length > 0 ? `; canceled=${report.canceled.join(",")}` : ""
    const activation = report.activationEligible === undefined
      ? ""
      : `; activationEligible=${String(report.activationEligible)}`
    this.lastSyntheticDelivery = `${report.phase}: ${report.events.join(",")}${canceled}${activation}`
    this.emitSnapshot()
  }

  private resize(): void {
    if (!this.renderer || this.status !== "ready") return
    const rect = this.options.canvas.getBoundingClientRect()
    try {
      this.renderer.resize(rect.width, rect.height, window.devicePixelRatio)
      this.capabilities?.requestPaint()
      this.scheduler?.request("dirty")
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  private distanceToParallaxTarget(): number {
    return Math.hypot(
      this.targetParallax.x - this.currentParallax.x,
      this.targetParallax.y - this.currentParallax.y,
    )
  }

  private targetLabel(target: Element): string {
    return target.id || target.getAttribute("data-probe") || target.tagName.toLowerCase()
  }

  private reportControl(key: string, detail: string): void {
    this.options.onControlResult?.(key, detail)
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    target.addEventListener(type, listener, options)
    this.cleanup.push(() => target.removeEventListener(type, listener, options))
  }

  private fail(message: string): void {
    this.status = "error"
    this.supportMessage = message
    this.metrics.recordFailure(message)
    this.cancelSourceCaptureRetryTimer()
    this.sourceCaptureRetryAttempts.clear()
    this.sourceTextureAnimations.settleAll()
    this.settlingSourceTextureAnimations.clear()
    this.scheduler?.cancel()
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    if (!this.options.onSnapshot) return
    const metrics = this.metrics.snapshot()
    const now = performance.now()
    if (metrics.frameCount !== this.lastCounters.frameCount
      || metrics.uploadCount !== this.lastCounters.uploadCount) {
      this.lastCounters = { frameCount: metrics.frameCount, uploadCount: metrics.uploadCount }
      this.lastCounterChange = now
    }
    this.idleStableMs = Math.max(0, Math.round(now - this.lastCounterChange))
    this.options.onSnapshot({
      status: this.status,
      supportMessage: this.supportMessage,
      apiVariant: this.capabilities?.apiVariant ?? this.apiVariant,
      contextVariant: this.capabilities?.contextVariant ?? this.contextVariant,
      reducedMotion: this.reducedMotion,
      contextLossProbe: this.contextLossProbe,
      pointer: this.pointer,
      metrics,
      idleStableMs: this.idleStableMs,
      lastNativeEscape: this.lastNativeEscape,
      lastSyntheticDelivery: this.lastSyntheticDelivery,
      lastNativeOutcome: this.lastNativeOutcome,
    })
  }
}

export const INITIAL_VIEWPORT_SNAPSHOT: SpatialViewportSnapshot = Object.freeze({
  status: "initializing",
  supportMessage: "Checking HTML-in-Canvas capabilities…",
  apiVariant: "n/a",
  contextVariant: "n/a",
  reducedMotion: false,
  contextLossProbe: "unavailable",
  pointer: EMPTY_POINTER,
  metrics: defaultMetrics(),
  idleStableMs: 0,
  lastNativeEscape: "none",
  lastSyntheticDelivery: "none",
  lastNativeOutcome: "none",
})
