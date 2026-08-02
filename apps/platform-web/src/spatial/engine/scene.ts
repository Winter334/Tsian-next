import type { ClientRectLike } from "./input/coordinates"
import {
  DEFAULT_SURFACE_POSE,
  projectSurfacePoint,
  SURFACE_PROJECTION_EPSILON,
  type SpatialPoint,
  type SpatialSurfacePose,
  type SurfaceProjectionResult,
  unprojectSurfacePoint,
} from "./projection"

export const SCENE_PARALLAX_WEIGHTS = Object.freeze({
  background: 0.3,
  sources: 1,
  foreground: 1.65,
})

export interface SceneSourceSurface {
  readonly sourceId: string
  readonly root: Element
  readonly rect: ClientRectLike
  readonly zIndex: number
  readonly parallaxFactor: number
  readonly pose: SpatialSurfacePose
  readonly window: boolean
  readonly active: boolean
}

export interface ProjectedSceneHit {
  readonly source: SceneSourceSurface
  readonly mapping: Extract<SurfaceProjectionResult, { readonly ok: true }>
}

export interface CapturedSceneProjection {
  readonly source: SceneSourceSurface
  readonly viewportRect: ClientRectLike
  readonly parallax: SpatialPoint
}

export interface ScreenToSourceLocalDifferential {
  /** local x = xx * screen x + xy * screen y */
  readonly xx: number
  readonly xy: number
  /** local y = yx * screen x + yy * screen y */
  readonly yx: number
  readonly yy: number
}

/** Matches the top-left row order supplied by texElementImage2D. */
export function sourceTextureUv(quadUv: SpatialPoint): SpatialPoint {
  return { ...quadUv }
}

function numberAttribute(element: Element, name: string, fallback: number): number {
  const value = element.getAttribute(name)
  if (value === null || value.trim() === "") return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function surfacePoseForElement(element: Element): SpatialSurfacePose {
  return {
    depth: numberAttribute(element, "data-spatial-depth", DEFAULT_SURFACE_POSE.depth),
    yaw: numberAttribute(element, "data-spatial-yaw", DEFAULT_SURFACE_POSE.yaw),
    pitch: numberAttribute(element, "data-spatial-pitch", DEFAULT_SURFACE_POSE.pitch),
    scale: numberAttribute(element, "data-spatial-scale", DEFAULT_SURFACE_POSE.scale),
    curveHalfAngle: numberAttribute(
      element,
      "data-spatial-curve-half-angle",
      DEFAULT_SURFACE_POSE.curveHalfAngle,
    ),
  }
}

export function sceneSourceForElement(
  root: Element,
  fallbackZIndex = 0,
): SceneSourceSurface {
  const sourceId = root.getAttribute("data-spatial-source") ?? "unknown"
  return {
    sourceId,
    root,
    rect: root.getBoundingClientRect(),
    zIndex: numberAttribute(root, "data-spatial-z", fallbackZIndex),
    parallaxFactor: numberAttribute(root, "data-spatial-parallax-factor", 1),
    pose: surfacePoseForElement(root),
    window: sourceId.startsWith("window:"),
    active: root.getAttribute("data-spatial-window-active") === "true",
  }
}

export function parallaxForSceneSource(
  source: Pick<SceneSourceSurface, "parallaxFactor">,
  parallax: SpatialPoint,
): SpatialPoint {
  const factor = SCENE_PARALLAX_WEIGHTS.sources * source.parallaxFactor
  return {
    x: parallax.x * factor,
    y: parallax.y * factor,
  }
}

export function sortSceneSourcesBackToFront<T extends Pick<SceneSourceSurface, "zIndex" | "sourceId">>(
  sources: readonly T[],
): T[] {
  return [...sources].sort((left, right) => left.zIndex - right.zIndex
    || left.sourceId.localeCompare(right.sourceId))
}

export function sortSceneSourcesFrontToBack<T extends Pick<SceneSourceSurface, "zIndex" | "sourceId">>(
  sources: readonly T[],
): T[] {
  return [...sources].sort((left, right) => right.zIndex - left.zIndex
    || right.sourceId.localeCompare(left.sourceId))
}

export function projectedSceneHits(
  sources: readonly SceneSourceSurface[],
  visualClient: SpatialPoint,
  viewportRect: ClientRectLike,
  parallax: SpatialPoint = { x: 0, y: 0 },
): ProjectedSceneHit[] {
  const hits: ProjectedSceneHit[] = []
  for (const source of sortSceneSourcesFrontToBack(sources)) {
    const mapping = unprojectSurfacePoint(visualClient, {
      sourceRect: source.rect,
      viewportRect,
      pose: source.pose,
      parallax: parallaxForSceneSource(source, parallax),
    })
    if (mapping.ok) hits.push({ source, mapping })
  }
  return hits
}

function snapshotClientRect(rect: ClientRectLike): ClientRectLike {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}

/** Freezes the inverse transform selected at pointer-down for one gesture. */
export function captureSceneProjection(
  source: SceneSourceSurface,
  viewportRect: ClientRectLike,
  parallax: SpatialPoint = { x: 0, y: 0 },
): CapturedSceneProjection {
  return {
    source: {
      ...source,
      rect: snapshotClientRect(source.rect),
      pose: { ...source.pose },
    },
    viewportRect: snapshotClientRect(viewportRect),
    parallax: parallaxForSceneSource(source, parallax),
  }
}

export function projectCapturedSceneSource(
  projection: CapturedSceneProjection,
  visualClient: SpatialPoint,
): SurfaceProjectionResult {
  const { source, viewportRect, parallax } = projection
  return unprojectSurfacePoint(visualClient, {
    sourceRect: source.rect,
    viewportRect,
    pose: source.pose,
    parallax,
  }, { allowOutside: true })
}

export function capturedSceneScreenToLocalDifferential(
  projection: CapturedSceneProjection,
  localNormalized: SpatialPoint,
): ScreenToSourceLocalDifferential | null {
  const surfaceProjection = {
    sourceRect: projection.source.rect,
    viewportRect: projection.viewportRect,
    pose: projection.source.pose,
    parallax: projection.parallax,
  }
  const step = 1e-4
  const origin = projectSurfacePoint(localNormalized, surfaceProjection, { allowOutside: true })
  const xSample = projectSurfacePoint({
    x: localNormalized.x + step,
    y: localNormalized.y,
  }, surfaceProjection, { allowOutside: true })
  const ySample = projectSurfacePoint({
    x: localNormalized.x,
    y: localNormalized.y + step,
  }, surfaceProjection, { allowOutside: true })
  if (!origin.ok || !xSample.ok || !ySample.ok) return null

  const localStepX = projection.source.rect.width * step / 2
  const localStepY = projection.source.rect.height * step / 2
  const screenPerLocalX = {
    x: (xSample.visualClient.x - origin.visualClient.x) / localStepX,
    y: (xSample.visualClient.y - origin.visualClient.y) / localStepX,
  }
  const screenPerLocalY = {
    x: (ySample.visualClient.x - origin.visualClient.x) / localStepY,
    y: (ySample.visualClient.y - origin.visualClient.y) / localStepY,
  }
  const determinant = screenPerLocalX.x * screenPerLocalY.y
    - screenPerLocalY.x * screenPerLocalX.y
  if (!Number.isFinite(determinant)
    || Math.abs(determinant) <= SURFACE_PROJECTION_EPSILON) return null
  const differential = {
    xx: screenPerLocalY.y / determinant,
    xy: -screenPerLocalY.x / determinant,
    yx: -screenPerLocalX.y / determinant,
    yy: screenPerLocalX.x / determinant,
  }
  return Object.values(differential).every(Number.isFinite) ? differential : null
}
