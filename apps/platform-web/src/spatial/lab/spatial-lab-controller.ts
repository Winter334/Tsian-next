import {
  acquireHtmlInCanvasCapabilities,
  type HtmlInCanvasApiVariant,
  type HtmlInCanvasCapabilities,
  type HtmlInCanvasCapabilityResult,
  type HtmlInCanvasContextVariant,
} from "../engine/capabilities"
import { FrameScheduler, type FrameReason, type ScheduledFrame } from "../engine/frame-scheduler"
import {
  findScrollableAncestor,
  openNativePicker,
  placeCaretAtPoint,
  scrollElementBy,
  updateRangeFromPoint,
} from "../engine/input/native-controls"
import {
  mapClientToPlanar,
  type ClientToPlanarResult,
} from "../engine/input/coordinates"
import {
  shouldRecenterParallax,
  type ParallaxResetTrigger,
  viewportParallaxTarget,
} from "../engine/input/parallax"
import {
  PointerRouter,
  type NativeActivationOutcome,
  type RoutedPointerEventType,
  type RoutedPointerSample,
  type SyntheticDeliveryReport,
} from "../engine/input/pointer-router"
import {
  activationPolicyForElement,
  resolveProjectedTarget,
  type DomTargetResolution,
  type SpatialSourceRoot,
} from "../engine/input/target-resolver"
import { SpatialMetrics, type SpatialMetricsSnapshot } from "../engine/metrics"
import type { SpatialPoint } from "../engine/projection"
import {
  parallaxTransformForRenderer,
  SpatialRenderer,
} from "../engine/renderer"
import { findTopmostSceneSource, type SceneSourceBounds } from "../engine/scene"

export interface LabPointerDiagnostics {
  readonly trusted: SpatialPoint | null
  readonly curved: SpatialPoint | null
  readonly planar: SpatialPoint | null
  readonly sourceId: string | null
  readonly targetId: string | null
  readonly status: string
}

export interface SpatialLabSnapshot {
  readonly status: "initializing" | "unsupported" | "ready" | "context-lost" | "error"
  readonly supportMessage: string
  readonly apiVariant: HtmlInCanvasApiVariant | "n/a"
  readonly contextVariant: HtmlInCanvasContextVariant | "n/a"
  readonly reducedMotion: boolean
  readonly contextLossProbe: "available" | "unavailable" | "triggered"
  readonly pointer: LabPointerDiagnostics
  readonly metrics: SpatialMetricsSnapshot
  readonly idleStableMs: number
  readonly lastNativeEscape: string
  readonly lastSyntheticDelivery: string
  readonly lastNativeOutcome: string
}

export interface SpatialLabControllerOptions {
  readonly canvas: HTMLCanvasElement
  readonly inputPlane: HTMLElement
  readonly diagnostics: HTMLElement
  readonly onSnapshot: (snapshot: SpatialLabSnapshot) => void
  readonly onControlResult: (key: string, detail: string) => void
}

interface ResolvedInput {
  readonly target: Element | null
  readonly mapping: ClientToPlanarResult
  readonly resolution: DomTargetResolution | null
  readonly sample: RoutedPointerSample
}

const EMPTY_POINTER: LabPointerDiagnostics = Object.freeze({
  trusted: null,
  curved: null,
  planar: null,
  sourceId: null,
  targetId: null,
  status: "awaiting-input",
})

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

export class SpatialLabController {
  private readonly metrics = new SpatialMetrics()
  private readonly ignoredElements: ReadonlySet<Element>
  private readonly cleanup: Array<() => void> = []
  private capabilities: HtmlInCanvasCapabilities | null = null
  private renderer: SpatialRenderer | null = null
  private scheduler: FrameScheduler | null = null
  private router: PointerRouter<Element> | null = null
  private resizeObserver: ResizeObserver | null = null
  private sourceObserver: MutationObserver | null = null
  private metricsTimer: number | null = null
  private contextRestoreTimer: number | null = null
  private status: SpatialLabSnapshot["status"] = "initializing"
  private supportMessage = "Checking HTML-in-Canvas capabilities…"
  private apiVariant: SpatialLabSnapshot["apiVariant"] = "n/a"
  private contextVariant: SpatialLabSnapshot["contextVariant"] = "n/a"
  private pointer: LabPointerDiagnostics = EMPTY_POINTER
  private reducedMotion = false
  private reducedMotionOverride: boolean | null = null
  private mediaQuery: MediaQueryList | null = null
  /** Last transform actually drawn; input inversion must never use a future target. */
  private currentParallax: SpatialPoint = { x: 0, y: 0 }
  private targetParallax: SpatialPoint = { x: 0, y: 0 }
  private transitionEndsAt = 0
  private contextLossProbe: SpatialLabSnapshot["contextLossProbe"] = "unavailable"
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

  constructor(private readonly options: SpatialLabControllerOptions) {
    this.ignoredElements = new Set([
      options.canvas,
      options.inputPlane,
      options.diagnostics,
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
    const created = SpatialRenderer.create(acquired.capabilities, this.metrics)
    if (!created.ok) {
      this.fail(`${created.failure.stage}: ${created.failure.message}`)
      return
    }
    this.renderer = created.renderer
    this.status = "ready"
    this.supportMessage = "Experimental HTML-in-Canvas adapter ready."
    this.contextLossProbe = acquired.capabilities.gl.getExtension("WEBGL_lose_context")
      ? "available"
      : "unavailable"
    this.configureMotionPreference()
    this.configureScheduler()
    this.configureInputRouter()
    this.configureLifecycle()
    this.syncSources()
    this.resize()
    this.capabilities.requestPaint()
    this.scheduler?.request("dirty")
    this.requestAmbientFrames()
    this.metricsTimer = window.setInterval(() => this.emitSnapshot(), 250)
    this.emitSnapshot()
  }

  syncSources(): void {
    if (!this.renderer) return
    const current = this.options.canvas.querySelectorAll(":scope > [data-spatial-source]")
    const result = this.renderer.elementTextures.synchronize(current)
    if (result.ineligible.length > 0) {
      const reasons = result.ineligible.map(({ reason }) => reason).join(", ")
      this.metrics.recordFailure(`Ineligible HTML source released: ${reasons}.`)
    }
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
  }

  releaseSource(sourceId: string): void {
    const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
    if (!source || !this.renderer) return
    this.renderer.elementTextures.release(source.root)
    this.scheduler?.request("dirty")
    this.options.onControlResult(`${sourceId}:texture`, "released; source DOM retained")
  }

  restoreSource(sourceId: string): void {
    const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
    if (!source || !this.renderer) return
    this.renderer.elementTextures.restore(source.root)
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
    this.options.onControlResult(`${sourceId}:texture`, "restored and marked dirty")
  }

  triggerTransition(): void {
    this.transitionEndsAt = performance.now() + (this.reducedMotion ? 0 : 520)
    this.scheduler?.request("transition")
  }

  triggerContextLoss(): void {
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

  requestSourcePaint(sourceId: string, resultKey?: string, detail?: string): void {
    const source = this.sourceRoots().find((candidate) => candidate.sourceId === sourceId)
    if (source && this.renderer) this.renderer.elementTextures.markDirty(source.root)
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
    if (resultKey && detail) this.options.onControlResult(`${sourceId}:${resultKey}`, detail)
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
    this.scheduler?.dispose()
    this.resizeObserver?.disconnect()
    this.sourceObserver?.disconnect()
    if (this.metricsTimer !== null) window.clearInterval(this.metricsTimer)
    if (this.contextRestoreTimer !== null) window.clearTimeout(this.contextRestoreTimer)
    this.contextRestoreTimer = null
    for (const clean of this.cleanup.splice(0)) clean()
    this.renderer?.dispose()
    this.renderer = null
    this.capabilities = null
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
    if (this.reducedMotion) {
      this.scheduler?.release("particles")
      this.scheduler?.release("animated-background")
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
    })
    if (report.uploadBatch.failures.length > 0) {
      const message = report.uploadBatch.failures.map((failure) => failure.message).join("; ")
      this.metrics.recordFailure(`Element upload failed: ${message}`)
    } else if (renderer.elementTextures.hasUploadableDirty()) {
      continueReasons.push("dirty")
    }
    if (this.pageVisible && !frame.reducedMotion) {
      continueReasons.push("particles")
      const environmentReason = renderer.environmentFrameReason()
      if (environmentReason) continueReasons.push(environmentReason)
    }
    queueMicrotask(() => this.emitSnapshot())
    return { continueReasons }
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
      focus: (target) => {
        const focusable = target as HTMLElement
        focusable.focus?.({ preventScroll: true })
      },
      activate: (target, sample) => this.activateTarget(target, sample),
      activationPolicy: (target) => activationPolicyForElement(target),
      setCapture: (pointerId) => {
        try {
          this.options.inputPlane.setPointerCapture(pointerId)
        } catch {
          // The logical capture remains authoritative if the browser rejects capture.
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
      this.router?.move(resolved.target, resolved.sample)
    })
    this.listen(this.options.inputPlane, "pointerdown", (event) => {
      const pointer = event as PointerEvent
      pointer.preventDefault()
      const resolved = this.resolveInput(pointer)
      this.router?.down(resolved.target, resolved.sample)
    })
    this.listen(this.options.inputPlane, "pointerup", (event) => {
      const pointer = event as PointerEvent
      const resolved = this.resolveInput(pointer)
      this.router?.up(resolved.target, resolved.sample)
    })
    this.listen(this.options.inputPlane, "pointercancel", (event) => {
      const pointer = event as PointerEvent
      const resolved = this.resolveInput(pointer)
      this.router?.cancel(pointer.pointerId, resolved.sample)
    })
    this.listen(this.options.inputPlane, "pointerleave", (event) => {
      const pointer = event as PointerEvent
      if (this.router?.captureCount()) return
      const resolved = this.resolveInput(pointer)
      this.router?.move(null, resolved.sample)
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

    if (typeof MutationObserver === "function") {
      this.sourceObserver = new MutationObserver(() => this.syncSources())
      this.sourceObserver.observe(this.options.canvas, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "style"],
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
        this.resetParallax("document-hidden")
        this.cancelRoutedInput()
        return
      }
      if (this.distanceToParallaxTarget() > 0.0001) this.scheduler?.request("parallax")
      this.requestAmbientFrames()
      this.scheduler?.request("dirty")
    })

    this.listen(this.options.canvas, "webglcontextlost", (event) => {
      event.preventDefault()
      this.status = "context-lost"
      this.scheduler?.cancel()
      this.renderer?.handleContextLost()
      this.emitSnapshot()
    })
    this.listen(this.options.canvas, "webglcontextrestored", () => {
      if (this.contextRestoreTimer !== null) window.clearTimeout(this.contextRestoreTimer)
      this.contextRestoreTimer = null
      const acquired = acquireHtmlInCanvasCapabilities(this.options.canvas)
      if (!acquired.supported || !this.renderer) {
        this.fail(acquired.supported ? "Renderer unavailable during restore." : acquired.message)
        return
      }
      this.capabilities = acquired.capabilities
      this.apiVariant = acquired.capabilities.apiVariant
      this.contextVariant = acquired.capabilities.contextVariant
      const restored = this.renderer.restore(acquired.capabilities, window.devicePixelRatio)
      if (!restored.ok) {
        this.fail(`${restored.failure.stage}: ${restored.failure.message}`)
        return
      }
      this.status = "ready"
      this.contextLossProbe = acquired.capabilities.gl.getExtension("WEBGL_lose_context")
        ? "available"
        : "unavailable"
      this.capabilities.requestPaint()
      this.scheduler?.request("restore")
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
    const mapping = mapClientToPlanar({
      client: trusted,
      canvasRect: this.options.canvas.getBoundingClientRect(),
      parallax: parallaxTransformForRenderer(this.currentParallax),
    })
    if (!mapping.ok) {
      this.pointer = {
        trusted,
        curved: null,
        planar: null,
        sourceId: null,
        targetId: null,
        status: mapping.reason,
      }
      const sample = eventSample(event, this.lastMappedPoint)
      this.emitSnapshot()
      return { target: null, mapping, resolution: null, sample }
    }

    this.lastMappedPoint = mapping.planarClient
    const bounds = this.sceneBounds()
    const visualSource = findTopmostSceneSource(bounds, mapping.planarClient)
    const resolution = resolveProjectedTarget({
      document: this.options.canvas.ownerDocument,
      point: mapping.planarClient,
      expectedSourceId: visualSource?.sourceId ?? null,
      sources: this.sourceRoots(),
      ignoredElements: this.ignoredElements,
    })
    const target = resolution.status === "hit" ? resolution.target : null
    this.pointer = {
      trusted,
      curved: mapping.curvedNormalized,
      planar: mapping.planarClient,
      sourceId: resolution.status === "hit" ? resolution.sourceId : visualSource?.sourceId ?? null,
      targetId: target ? this.targetLabel(target) : null,
      status: resolution.status,
    }
    if (resolution.status === "ownership-mismatch") {
      this.metrics.recordFailure(
        `Target ownership mismatch: expected ${resolution.expectedSourceId}, got ${resolution.actualSourceId}.`,
      )
    }
    this.emitSnapshot()
    return {
      target,
      mapping,
      resolution,
      sample: eventSample(event, mapping.planarClient),
    }
  }

  private sourceRoots(): SpatialSourceRoot[] {
    return [...this.options.canvas.querySelectorAll(":scope > [data-spatial-source]")]
      .map((root) => ({ sourceId: root.getAttribute("data-spatial-source") ?? "unknown", root }))
  }

  private sceneBounds(): SceneSourceBounds[] {
    return this.sourceRoots().map(({ sourceId, root }, index) => ({
      sourceId,
      rect: root.getBoundingClientRect(),
      zIndex: Number(root.getAttribute("data-spatial-z") ?? index),
    }))
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
      detail: sample.detail ?? 1,
      relatedTarget,
      altKey: sample.altKey,
      ctrlKey: sample.ctrlKey,
      metaKey: sample.metaKey,
      shiftKey: sample.shiftKey,
      view,
    }
    if (type === "wheel") {
      return target.dispatchEvent(new view.WheelEvent(type, {
        ...base,
        deltaX: sample.deltaX ?? 0,
        deltaY: sample.deltaY ?? 0,
      }))
    }
    if (type.startsWith("pointer") && typeof view.PointerEvent === "function") {
      const dispatched = target.dispatchEvent(new view.PointerEvent(type, {
        ...base,
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
    return target.dispatchEvent(new view.MouseEvent(type, base))
  }

  private activateTarget(target: Element, sample: RoutedPointerSample): NativeActivationOutcome {
    const nativeEscape = openNativePicker(target, {
      trustedSource: sample.trustedSource === true,
    })
    if (nativeEscape.status === "requested") {
      if (nativeEscape.method === "showPicker") {
        this.dispatchDomEvent(target, "click", { ...sample, buttons: 0 }, null)
      }
      this.lastNativeEscape = `${this.targetLabel(target)} requested via ${nativeEscape.method}`
      this.options.onControlResult(
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
        return {
          status: "verified",
          detail: `range value=${result.value}; changed=${String(result.changed)}`,
        }
      }
      const message = result.status === "unsupported" ? result.message : "Target is not a range input."
      this.metrics.recordFailure(message)
      return { status: "unsupported", detail: message }
    }
    const editable = tag === "input" || tag === "textarea"
      || (target as HTMLElement).isContentEditable
    if (editable) {
      const focusable = target as HTMLElement
      focusable.focus?.({ preventScroll: true })
      const caret = placeCaretAtPoint(target, { x: sample.clientX, y: sample.clientY })
      this.dispatchDomEvent(target, "click", { ...sample, buttons: 0 }, null)
      if (caret.status === "unsupported") {
        const message = `${this.targetLabel(target)}: ${caret.message}`
        this.metrics.recordFailure(message)
        this.options.onControlResult(`${this.pointer.sourceId ?? "unknown"}:caret`, message)
        this.emitSnapshot()
        return { status: "unsupported", detail: message }
      }
      this.options.onControlResult(
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
    } else {
      this.dispatchDomEvent(target, "click", { ...sample, buttons: 0 }, null)
      return {
        status: "requested",
        detail: `${this.targetLabel(target)} synthetic click dispatched without a verifiable native state`,
      }
    }
  }

  private scrollTarget(target: Element, sample: RoutedPointerSample): void {
    const source = this.sourceRoots().find(({ root }) => root === target || root.contains(target))
    if (!source) return
    const scrollable = findScrollableAncestor(target, source.root)
    if (!scrollable) {
      this.options.onControlResult(`${source.sourceId}:scroll`, "no scrollable ancestor at mapped point")
      return
    }
    const result = scrollElementBy(scrollable, sample.deltaX ?? 0, sample.deltaY ?? 0)
    this.options.onControlResult(
      `${source.sourceId}:scroll`,
      result.changed
        ? `scrollLeft=${result.position.left}, scrollTop=${result.position.top}`
        : "clamped at scroll boundary",
    )
    this.renderer?.elementTextures.markDirty(source.root)
    this.capabilities?.requestPaint()
    this.scheduler?.request("dirty")
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
      this.options.onControlResult(
        `${targetSource.sourceId}:${resultKey}`,
        this.targetLabel(target),
      )
    }
    for (const root of affectedSources.values()) {
      this.renderer?.elementTextures.markDirty(root)
    }
    if (!this.disposed && affectedSources.size > 0) {
      this.capabilities?.requestPaint()
      this.scheduler?.request("dirty")
    }
  }

  private sourceForElement(element: Element): SpatialSourceRoot | null {
    return this.sourceRoots().find(({ root }) => root === element || root.contains(element)) ?? null
  }

  private updateParallaxTarget(event: PointerEvent): void {
    const rect = this.options.canvas.getBoundingClientRect()
    this.targetParallax = viewportParallaxTarget(
      { x: event.clientX, y: event.clientY },
      rect,
    )
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
  }

  private reportSyntheticDelivery(report: SyntheticDeliveryReport): void {
    const canceled = report.canceled.length > 0
      ? `; canceled=${report.canceled.join(",")}`
      : ""
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
    this.scheduler?.cancel()
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    const metrics = this.metrics.snapshot()
    const now = performance.now()
    if (metrics.frameCount !== this.lastCounters.frameCount
      || metrics.uploadCount !== this.lastCounters.uploadCount) {
      this.lastCounters = {
        frameCount: metrics.frameCount,
        uploadCount: metrics.uploadCount,
      }
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

export const INITIAL_LAB_SNAPSHOT: SpatialLabSnapshot = Object.freeze({
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
