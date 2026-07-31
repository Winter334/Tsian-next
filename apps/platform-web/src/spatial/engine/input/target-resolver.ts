import type { SpatialPoint } from "../projection"

export type ActivationSuppressionReason = "native-disabled"

export interface TargetActivationPolicy {
  readonly allowed: boolean
  readonly reason: ActivationSuppressionReason | null
}

export interface TargetAccessibilityPolicy {
  readonly ariaHidden: boolean
  readonly ariaDisabled: boolean
}

export interface TargetCandidate<T> {
  readonly target: T
  readonly sourceId: string | null
  readonly ignored?: boolean
  readonly nativeDisabled?: boolean
  readonly hidden?: boolean
  readonly ariaHidden?: boolean
  readonly ariaDisabled?: boolean
  readonly pointerEventsNone?: boolean
}

export interface TargetPolicy {
  readonly activation: TargetActivationPolicy
  readonly accessibility: TargetAccessibilityPolicy
}

export type TargetSelection<T> =
  | { readonly status: "hit"; readonly target: T; readonly sourceId: string; readonly policy: TargetPolicy }
  | { readonly status: "no-hit" }
  | {
      readonly status: "ownership-mismatch"
      readonly expectedSourceId: string
      readonly actualSourceId: string
      readonly target: T
      readonly policy: TargetPolicy
    }

function candidatePolicy<T>(candidate: TargetCandidate<T>): TargetPolicy {
  const reason: ActivationSuppressionReason | null = candidate.nativeDisabled
    ? "native-disabled"
    : null
  return {
    activation: { allowed: reason === null, reason },
    accessibility: {
      ariaHidden: candidate.ariaHidden === true,
      ariaDisabled: candidate.ariaDisabled === true,
    },
  }
}

export function selectTargetCandidate<T>(
  candidates: readonly TargetCandidate<T>[],
  expectedSourceId: string | null,
): TargetSelection<T> {
  if (!expectedSourceId) return { status: "no-hit" }
  for (const candidate of candidates) {
    if (candidate.ignored || candidate.sourceId === null || candidate.hidden
      || candidate.pointerEventsNone) {
      continue
    }
    const policy = candidatePolicy(candidate)
    if (candidate.sourceId !== expectedSourceId) {
      return {
        status: "ownership-mismatch",
        expectedSourceId,
        actualSourceId: candidate.sourceId,
        target: candidate.target,
        policy,
      }
    }
    return {
      status: "hit",
      target: candidate.target,
      sourceId: candidate.sourceId,
      policy,
    }
  }
  return { status: "no-hit" }
}

export interface SpatialSourceRoot {
  readonly sourceId: string
  readonly root: Element
}

export interface TargetResolutionDiagnostics {
  readonly point: SpatialPoint
  readonly candidateCount: number
  readonly expectedSourceId: string | null
}

export type DomTargetResolution =
  | {
      readonly status: "hit"
      readonly target: Element
      readonly sourceId: string
      readonly policy: TargetPolicy
      readonly diagnostics: TargetResolutionDiagnostics
    }
  | {
      readonly status: "no-hit"
      readonly diagnostics: TargetResolutionDiagnostics
    }
  | {
      readonly status: "ownership-mismatch"
      readonly expectedSourceId: string
      readonly actualSourceId: string
      readonly target: Element
      readonly policy: TargetPolicy
      readonly diagnostics: TargetResolutionDiagnostics
    }

function owningSource(element: Element, sources: readonly SpatialSourceRoot[]): string | null {
  return sources.find(({ root }) => root === element || root.contains(element))?.sourceId ?? null
}

function ariaStateWithinSource(
  element: Element,
  attribute: "aria-hidden" | "aria-disabled",
  sourceRoot: Element | null,
): boolean {
  let current: Element | null = element
  while (current) {
    if (current.getAttribute(attribute) === "true") return true
    if (current === sourceRoot) break
    current = current.parentElement
  }
  return false
}

function isNativeDisabled(element: Element): boolean {
  let current: Element | null = element
  while (current) {
    if ((current as Element & { readonly disabled?: unknown }).disabled === true) return true
    current = current.parentElement
  }
  return false
}

function isGeometricallyHidden(element: Element, sourceRoot: Element | null): boolean {
  let current: Element | null = element
  while (current) {
    if (current.hasAttribute("hidden")) return true
    const style = current.ownerDocument.defaultView?.getComputedStyle(current)
    if (style?.display === "none"
      || style?.visibility === "hidden"
      || style?.visibility === "collapse") {
      return true
    }
    if (current === sourceRoot) break
    current = current.parentElement
  }
  return false
}

function hasEffectivePointerEventsNone(element: Element, sourceRoot: Element | null): boolean {
  let current: Element | null = element
  while (current) {
    if (current.ownerDocument.defaultView?.getComputedStyle(current).pointerEvents === "none") {
      return true
    }
    if (current === sourceRoot) break
    current = current.parentElement
  }
  return false
}

export function activationPolicyForElement(element: Element): TargetActivationPolicy {
  if (isNativeDisabled(element)) return { allowed: false, reason: "native-disabled" }
  return { allowed: true, reason: null }
}

export function resolveProjectedTarget(input: {
  readonly document: Document
  readonly point: SpatialPoint
  readonly expectedSourceId: string | null
  readonly sources: readonly SpatialSourceRoot[]
  readonly ignoredElements?: ReadonlySet<Element>
}): DomTargetResolution {
  const rawCandidates = input.document.elementsFromPoint(input.point.x, input.point.y)
  const candidates = rawCandidates.map((element): TargetCandidate<Element> => {
    const sourceId = owningSource(element, input.sources)
    const sourceRoot = input.sources.find((source) => source.sourceId === sourceId)?.root ?? null
    return {
      target: element,
      sourceId,
      ignored: input.ignoredElements?.has(element)
        || element.closest("[data-spatial-ignore]") !== null,
      nativeDisabled: isNativeDisabled(element),
      hidden: isGeometricallyHidden(element, sourceRoot),
      ariaHidden: ariaStateWithinSource(element, "aria-hidden", sourceRoot),
      ariaDisabled: ariaStateWithinSource(element, "aria-disabled", sourceRoot),
      pointerEventsNone: hasEffectivePointerEventsNone(element, sourceRoot),
    }
  })
  const diagnostics = {
    point: input.point,
    candidateCount: rawCandidates.length,
    expectedSourceId: input.expectedSourceId,
  }
  const selected = selectTargetCandidate(candidates, input.expectedSourceId)
  return selected.status === "no-hit"
    ? { ...selected, diagnostics }
    : { ...selected, diagnostics }
}
