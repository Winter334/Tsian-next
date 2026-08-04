import type { SpatialPoint } from "./projection"

export type SpatialSourcePresentationPhase =
  | "capturing-open"
  | "opening"
  | "visible"
  | "guard-pending"
  | "closing"
  | "minimizing"
  | "minimized"
  | "capturing-restore"
  | "restoring"

export type SpatialSourcePresentationEffect = "stable" | "aperture" | "particle-ripple"
export type SpatialSourcePresentationAxis = "vertical" | "horizontal"

export interface SpatialSourcePresentationSnapshot {
  readonly sourceId: string
  readonly phase: SpatialSourcePresentationPhase
  /** Current visible aperture extent: 0 is the slit, 1 is the stable mesh. */
  readonly progress: number
  /** Optional for compatibility with non-product renderer consumers. */
  readonly effect?: SpatialSourcePresentationEffect
  /** Monotonic identity for rejecting completion from a superseded effect. */
  readonly effectId?: number
  /** Immutable Source-local origin used by particle-ripple presentation. */
  readonly originUv?: Readonly<SpatialPoint>
  /** Aperture collapse axis. Product windows default to vertical. */
  readonly apertureAxis?: SpatialSourcePresentationAxis
}

export interface SpatialWindowPresentationRenderOptions {
  readonly enabled: boolean
  readonly apertureScale: number
  /** Presentation-only local Z recession before rigid camera projection. */
  readonly curveDepthEnergy: number
  readonly depthEnergy: number
  readonly edgeEnergy: number
  readonly chromaticSeparationPx: number
}

export const DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS = Object.freeze<SpatialWindowPresentationRenderOptions>({
  enabled: false,
  apertureScale: 0.028,
  curveDepthEnergy: 14,
  depthEnergy: 34,
  edgeEnergy: 0.34,
  chromaticSeparationPx: 0.72,
})

export interface SpatialWindowRippleRenderOptions {
  readonly enabled: boolean
  readonly particleColumns: number
  readonly particleRows: number
  readonly pointSizePx: number
  readonly travelPx: number
  readonly tangentialTravelPx: number
  readonly depthTravel: number
  readonly trailWidth: number
  readonly waveSoftness: number
  readonly edgeEnergy: number
  readonly chromaticSeparationPx: number
}

export const DEFAULT_WINDOW_RIPPLE_RENDER_OPTIONS = Object.freeze<SpatialWindowRippleRenderOptions>({
  enabled: false,
  particleColumns: 96,
  particleRows: 64,
  pointSizePx: 2.15,
  travelPx: 24,
  tangentialTravelPx: 7,
  depthTravel: 18,
  trailWidth: 0.18,
  waveSoftness: 0.026,
  edgeEnergy: 0.3,
  chromaticSeparationPx: 0.62,
})

export function sourcePresentationBlocksInput(
  snapshot: SpatialSourcePresentationSnapshot,
): boolean {
  return snapshot.phase !== "visible"
}

export function sourcePresentationIsAnimated(
  snapshot: SpatialSourcePresentationSnapshot,
): boolean {
  return snapshot.phase === "opening" || snapshot.phase === "closing"
}

export function sourcePresentationIsRippleAnimated(
  snapshot: SpatialSourcePresentationSnapshot,
): boolean {
  return snapshot.phase === "minimizing" || snapshot.phase === "restoring"
}
