import type { ClientRectLike } from "./input/coordinates"
import type { SpatialPoint } from "./projection"

export const SCENE_PARALLAX_WEIGHTS = Object.freeze({
  background: 0.3,
  sources: 1,
  foreground: 1.65,
})

export interface SceneSourceBounds {
  readonly sourceId: string
  readonly rect: ClientRectLike
  readonly zIndex: number
}

export interface NdcRect {
  readonly left: number
  readonly right: number
  readonly top: number
  readonly bottom: number
}

/** Matches the top-left row order supplied by texElementImage2D. */
export function sourceTextureUv(quadUv: SpatialPoint): SpatialPoint {
  return { x: quadUv.x, y: 1 - quadUv.y }
}

export function sourceRectToNdc(
  sourceRect: ClientRectLike,
  canvasRect: ClientRectLike,
): NdcRect {
  return {
    left: ((sourceRect.left - canvasRect.left) / canvasRect.width) * 2 - 1,
    right: ((sourceRect.left + sourceRect.width - canvasRect.left) / canvasRect.width) * 2 - 1,
    top: 1 - ((sourceRect.top - canvasRect.top) / canvasRect.height) * 2,
    bottom: 1 - ((sourceRect.top + sourceRect.height - canvasRect.top) / canvasRect.height) * 2,
  }
}

export function findTopmostSceneSource(
  sources: readonly SceneSourceBounds[],
  planarClient: SpatialPoint,
): SceneSourceBounds | null {
  return [...sources]
    .sort((left, right) => right.zIndex - left.zIndex)
    .find(({ rect }) => planarClient.x >= rect.left
      && planarClient.x <= rect.left + rect.width
      && planarClient.y >= rect.top
      && planarClient.y <= rect.top + rect.height) ?? null
}
