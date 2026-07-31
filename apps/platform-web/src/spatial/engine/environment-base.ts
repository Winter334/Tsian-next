import type { CssSize } from "./input/coordinates"
import type { SpatialPoint } from "./projection"

export type EnvironmentBaseFrame =
  | { readonly kind: "procedural" }
  | {
      readonly kind: "texture"
      readonly texture: WebGLTexture
      /** Intrinsic media size used to preserve aspect ratio with cover sizing. */
      readonly size: CssSize
    }

export interface EnvironmentBaseProvider {
  /** Static providers never own a continuous frame reason. */
  readonly frameDemand: "static" | "animated"
  frame(timestamp: number): EnvironmentBaseFrame
}

export function computeEnvironmentCoverUvScale(
  mediaSize: CssSize,
  viewportSize: CssSize,
  overscan = 0.94,
): SpatialPoint {
  const values = [mediaSize.width, mediaSize.height, viewportSize.width, viewportSize.height]
  if (values.some((value) => !Number.isFinite(value) || value <= 0)
    || !Number.isFinite(overscan) || overscan <= 0 || overscan > 1) {
    throw new Error("Environment media and viewport sizes must be positive and finite.")
  }
  const mediaAspect = mediaSize.width / mediaSize.height
  const viewportAspect = viewportSize.width / viewportSize.height
  return viewportAspect > mediaAspect
    ? { x: overscan, y: overscan * mediaAspect / viewportAspect }
    : { x: overscan * viewportAspect / mediaAspect, y: overscan }
}

/**
 * Default media-ready boundary. A later wallpaper provider can return a
 * standard WebGL texture without changing curve, source capture, or input.
 */
export class StaticProceduralEnvironmentBase implements EnvironmentBaseProvider {
  readonly frameDemand = "static" as const
  private static readonly stableFrame = Object.freeze<EnvironmentBaseFrame>({
    kind: "procedural",
  })

  frame(_timestamp: number): EnvironmentBaseFrame {
    return StaticProceduralEnvironmentBase.stableFrame
  }
}
