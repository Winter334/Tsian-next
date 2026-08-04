export interface RoutedPointerSample {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  readonly button: number
  readonly buttons: number
  readonly clientX: number
  readonly clientY: number
  /** Trusted viewport/client coordinates retained beside Source-local clientX/Y. */
  readonly screenClientX?: number
  readonly screenClientY?: number
  readonly detail?: number
  readonly deltaX?: number
  readonly deltaY?: number
  readonly altKey?: boolean
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly shiftKey?: boolean
  /** True only when routing is still inside the original trusted handler. */
  readonly trustedSource?: boolean
}

export type RoutedPointerEventType =
  | "pointerover" | "mouseover" | "pointerenter" | "mouseenter"
  | "pointerout" | "mouseout" | "pointerleave" | "mouseleave"
  | "pointermove" | "mousemove" | "pointerdown" | "mousedown"
  | "pointerup" | "mouseup" | "pointercancel" | "click" | "dblclick"
  | "contextmenu" | "wheel"

export interface PointerActivationPolicy {
  readonly allowed: boolean
  readonly reason: string | null
}

export interface NativeActivationOutcome {
  readonly status: "verified" | "requested" | "unsupported" | "suppressed"
  readonly detail: string
}

export interface SyntheticDeliveryReport {
  readonly phase: "down" | "up" | "double-click" | "context-menu" | "wheel"
  readonly events: readonly RoutedPointerEventType[]
  readonly canceled: readonly RoutedPointerEventType[]
  readonly activationEligible?: boolean
}

export interface PointerRouterAdapter<T extends object> {
  readonly chain: (target: T) => readonly T[]
  readonly dispatch: (
    target: T,
    type: RoutedPointerEventType,
    sample: RoutedPointerSample,
    relatedTarget: T | null,
  ) => boolean
  readonly focus: (target: T) => void
  readonly activate: (target: T, sample: RoutedPointerSample) => NativeActivationOutcome
  readonly activationPolicy?: (target: T) => PointerActivationPolicy
  /** Promotes gesture capture without changing the original down target. */
  readonly captureTarget?: (target: T, sample: RoutedPointerSample) => T
  readonly setCapture: (pointerId: number) => void
  readonly releaseCapture: (pointerId: number) => void
  readonly scroll?: (target: T, sample: RoutedPointerSample) => void
  readonly setHoverState?: (chain: readonly T[]) => void
  readonly setActiveState?: (chain: readonly T[]) => void
  readonly reportSyntheticDelivery?: (report: SyntheticDeliveryReport) => void
  readonly reportNativeOutcome?: (outcome: NativeActivationOutcome) => void
}

/**
 * Spatial activation deliberately remains distinct from frontend-inspector-dom:
 * the inspector asserts a center-point hit and verifies one action, while this
 * router preserves projected coordinates, hover ancestry and logical capture.
 */
export class PointerRouter<T extends object> {
  private hoverChain: readonly T[] = []
  private readonly captures = new Map<number, T>()
  private readonly activeChains = new Map<number, readonly T[]>()
  private readonly pressedTargets = new Map<number, {
    readonly target: T
    readonly activationAllowed: boolean
  }>()
  private readonly cancelingPointers = new Set<number>()

  constructor(private readonly adapter: PointerRouterAdapter<T>) {}

  move(target: T | null, sample: RoutedPointerSample): void {
    const routedTarget = this.captures.get(sample.pointerId) ?? target
    this.transitionHover(routedTarget, sample)
    if (!routedTarget) return
    this.adapter.dispatch(routedTarget, "pointermove", sample, null)
    this.adapter.dispatch(routedTarget, "mousemove", sample, null)
  }

  down(target: T | null, sample: RoutedPointerSample): boolean {
    if (!target) return false
    this.transitionHover(target, sample)
    this.activeChains.set(sample.pointerId, this.adapter.chain(target))
    this.syncActiveState()
    const pointerAllowed = this.adapter.dispatch(target, "pointerdown", sample, null)
    const mouseAllowed = this.adapter.dispatch(target, "mousedown", sample, null)
    const policy = this.adapter.activationPolicy?.(target) ?? { allowed: true, reason: null }
    // Browser click synthesis is gated by pointerdown cancellation, but
    // canceling mousedown alone does not suppress the later click. Keep the
    // mousedown delivery result for diagnostics without turning it into a
    // projected-activation gate.
    const activationAllowed = pointerAllowed && policy.allowed
    // mousedown cancellation preserves click synthesis but still suppresses
    // the browser's ordinary focus default.
    if (activationAllowed && mouseAllowed) this.adapter.focus(target)
    this.pressedTargets.set(sample.pointerId, {
      target,
      activationAllowed,
    })
    this.captures.set(sample.pointerId, this.adapter.captureTarget?.(target, sample) ?? target)
    this.adapter.setCapture(sample.pointerId)
    this.adapter.reportSyntheticDelivery?.({
      phase: "down",
      events: ["pointerdown", "mousedown"],
      canceled: [
        ...(pointerAllowed ? [] : ["pointerdown"] as const),
        ...(mouseAllowed ? [] : ["mousedown"] as const),
      ],
      activationEligible: activationAllowed,
    })
    if (!policy.allowed) {
      this.adapter.reportNativeOutcome?.({
        status: "suppressed",
        detail: `activation suppressed: ${policy.reason ?? "policy"}`,
      })
    }
    return activationAllowed
  }

  up(target: T | null, sample: RoutedPointerSample): void {
    const routedTarget = this.captures.get(sample.pointerId) ?? target
    const pressed = this.pressedTargets.get(sample.pointerId)
    if (routedTarget) {
      const pointerAllowed = this.adapter.dispatch(
        routedTarget,
        "pointerup",
        { ...sample, buttons: 0 },
        null,
      )
      const mouseAllowed = this.adapter.dispatch(
        routedTarget,
        "mouseup",
        { ...sample, buttons: 0 },
        null,
      )
      this.adapter.reportSyntheticDelivery?.({
        phase: "up",
        events: ["pointerup", "mouseup"],
        canceled: [
          ...(pointerAllowed ? [] : ["pointerup"] as const),
          ...(mouseAllowed ? [] : ["mouseup"] as const),
        ],
        activationEligible: sample.button === 0
          && pressed?.target === routedTarget
          && pressed.activationAllowed,
      })
      if (sample.button === 0 && pressed?.target === routedTarget && pressed.activationAllowed) {
        const outcome = this.adapter.activate(routedTarget, sample)
        this.adapter.reportNativeOutcome?.(outcome)
      }
    }
    this.release(sample.pointerId)
    this.transitionHover(target, sample)
  }

  cancel(pointerId: number, sample: RoutedPointerSample): void {
    if (this.cancelingPointers.has(pointerId)) return
    const target = this.captures.get(pointerId) ?? this.pressedTargets.get(pointerId)?.target
    this.cancelingPointers.add(pointerId)
    try {
      if (target) this.adapter.dispatch(target, "pointercancel", sample, null)
    } finally {
      // Keep logical capture valid while pointercancel is delivered, then
      // release exactly once even if a handler synchronously requests reset.
      this.release(pointerId)
      this.transitionHover(null, sample)
      this.cancelingPointers.delete(pointerId)
    }
  }

  contextMenu(target: T | null, sample: RoutedPointerSample): void {
    if (!target) return
    const allowed = this.adapter.dispatch(target, "contextmenu", sample, null)
    this.adapter.reportSyntheticDelivery?.({
      phase: "context-menu",
      events: ["contextmenu"],
      canceled: allowed ? [] : ["contextmenu"],
    })
  }

  doubleClick(target: T | null, sample: RoutedPointerSample): void {
    if (!target) return
    const policy = this.adapter.activationPolicy?.(target) ?? { allowed: true, reason: null }
    if (!policy.allowed) {
      this.adapter.reportSyntheticDelivery?.({
        phase: "double-click",
        events: [],
        canceled: [],
        activationEligible: false,
      })
      this.adapter.reportNativeOutcome?.({
        status: "suppressed",
        detail: `double-click suppressed: ${policy.reason ?? "policy"}`,
      })
      return
    }
    const allowed = this.adapter.dispatch(target, "dblclick", { ...sample, detail: 2 }, null)
    this.adapter.reportSyntheticDelivery?.({
      phase: "double-click",
      events: ["dblclick"],
      canceled: allowed ? [] : ["dblclick"],
      activationEligible: true,
    })
  }

  wheel(target: T | null, sample: RoutedPointerSample): void {
    if (!target) return
    const allowed = this.adapter.dispatch(target, "wheel", sample, null)
    this.adapter.reportSyntheticDelivery?.({
      phase: "wheel",
      events: ["wheel"],
      canceled: allowed ? [] : ["wheel"],
    })
    this.adapter.scroll?.(target, sample)
  }

  clear(sample: RoutedPointerSample): void {
    for (const pointerId of [...this.captures.keys()]) this.release(pointerId)
    this.transitionHover(null, sample)
  }

  cancelAll(sample: RoutedPointerSample): void {
    const pointerIds = new Set([
      ...this.captures.keys(),
      ...this.pressedTargets.keys(),
    ])
    for (const pointerId of pointerIds) {
      this.cancel(pointerId, { ...sample, pointerId })
    }
    if (pointerIds.size === 0) this.transitionHover(null, sample)
  }

  capturedTarget(pointerId: number): T | null {
    return this.captures.get(pointerId) ?? null
  }

  captureCount(): number {
    return this.captures.size
  }

  /** Marks an already-delivered pointer gesture as drag-owned, so release does not click. */
  suppressActivation(pointerId: number): boolean {
    const pressed = this.pressedTargets.get(pointerId)
    if (!pressed || !pressed.activationAllowed) return false
    this.pressedTargets.set(pointerId, { ...pressed, activationAllowed: false })
    return true
  }

  private release(pointerId: number): void {
    if (this.captures.delete(pointerId)) this.adapter.releaseCapture(pointerId)
    this.pressedTargets.delete(pointerId)
    if (this.activeChains.delete(pointerId)) this.syncActiveState()
  }

  private transitionHover(target: T | null, sample: RoutedPointerSample): void {
    const nextChain = target ? this.adapter.chain(target) : []
    const oldTarget = this.hoverChain[this.hoverChain.length - 1] ?? null
    const nextTarget = nextChain[nextChain.length - 1] ?? null
    if (oldTarget === nextTarget) return

    let commonLength = 0
    while (commonLength < this.hoverChain.length && commonLength < nextChain.length
      && this.hoverChain[commonLength] === nextChain[commonLength]) {
      commonLength += 1
    }
    if (oldTarget) {
      this.adapter.dispatch(oldTarget, "pointerout", sample, nextTarget)
      this.adapter.dispatch(oldTarget, "mouseout", sample, nextTarget)
      for (let index = this.hoverChain.length - 1; index >= commonLength; index -= 1) {
        const exited = this.hoverChain[index]
        this.adapter.dispatch(exited, "pointerleave", sample, nextTarget)
        this.adapter.dispatch(exited, "mouseleave", sample, nextTarget)
      }
    }
    if (nextTarget) {
      this.adapter.dispatch(nextTarget, "pointerover", sample, oldTarget)
      this.adapter.dispatch(nextTarget, "mouseover", sample, oldTarget)
      for (let index = commonLength; index < nextChain.length; index += 1) {
        const entered = nextChain[index]
        this.adapter.dispatch(entered, "pointerenter", sample, oldTarget)
        this.adapter.dispatch(entered, "mouseenter", sample, oldTarget)
      }
    }
    this.hoverChain = nextChain
    this.adapter.setHoverState?.(nextChain)
  }

  private syncActiveState(): void {
    const active: T[] = []
    const seen = new Set<T>()
    for (const chain of this.activeChains.values()) {
      for (const target of chain) {
        if (seen.has(target)) continue
        seen.add(target)
        active.push(target)
      }
    }
    this.adapter.setActiveState?.(active)
  }
}
