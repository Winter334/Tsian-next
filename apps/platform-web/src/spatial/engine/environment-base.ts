import type { CssSize } from "./input/coordinates"
import type { SpatialPoint } from "./projection"

export type EnvironmentBaseFrame =
  | { readonly kind: "procedural" }
  | { readonly kind: "transparent" }
  | {
      readonly kind: "texture"
      readonly texture: WebGLTexture
      /** Intrinsic media size used to preserve aspect ratio with cover sizing. */
      readonly size: CssSize
      readonly coverOverscan?: number
      readonly flipY?: boolean
    }
  | {
      readonly kind: "image"
      /** CPU-side image data; the renderer owns the context-specific texture. */
      readonly source: TexImageSource
      readonly size: CssSize
      readonly version: number
      readonly coverOverscan?: number
    }

export interface EnvironmentBaseProvider {
  /** Static providers never own a continuous frame reason. */
  readonly frameDemand: "static" | "animated"
  frame(timestamp: number): EnvironmentBaseFrame
  /** Async media providers use this to request one demand-driven redraw. */
  subscribe?(listener: () => void): () => void
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

/** Default procedural path for consumers without a media-backed environment. */
export class StaticProceduralEnvironmentBase implements EnvironmentBaseProvider {
  readonly frameDemand = "static" as const
  private static readonly stableFrame = Object.freeze<EnvironmentBaseFrame>({
    kind: "procedural",
  })

  frame(_timestamp: number): EnvironmentBaseFrame {
    return StaticProceduralEnvironmentBase.stableFrame
  }
}

/** Transparent path retained for consumers that intentionally expose DOM below. */
export class TransparentEnvironmentBase implements EnvironmentBaseProvider {
  readonly frameDemand = "static" as const
  private static readonly stableFrame = Object.freeze<EnvironmentBaseFrame>({
    kind: "transparent",
  })

  frame(_timestamp: number): EnvironmentBaseFrame {
    return TransparentEnvironmentBase.stableFrame
  }
}

export interface StaticImageEnvironmentBaseOptions {
  readonly createImage?: () => HTMLImageElement
  /** `1` matches centered CSS `background-size: cover` exactly. */
  readonly coverOverscan?: number
}

/**
 * Keeps a decoded bundled image alive across WebGL context replacement while
 * leaving all context-bound texture ownership inside SpatialRenderer.
 */
export class StaticImageEnvironmentBase implements EnvironmentBaseProvider {
  readonly frameDemand = "static" as const
  private readonly listeners = new Set<() => void>()
  private readonly coverOverscan: number
  private readonly image: HTMLImageElement
  private currentFrame: EnvironmentBaseFrame = Object.freeze({ kind: "transparent" })
  private settled = false

  constructor(sourceUrl: string, options: StaticImageEnvironmentBaseOptions = {}) {
    this.coverOverscan = options.coverOverscan ?? 1
    if (!Number.isFinite(this.coverOverscan)
      || this.coverOverscan <= 0
      || this.coverOverscan > 1) {
      throw new Error("Environment image cover overscan must be within (0, 1].")
    }
    this.image = options.createImage?.() ?? new Image()
    this.image.decoding = "async"
    this.image.addEventListener("load", this.handleLoad, { once: true })
    this.image.addEventListener("error", this.handleError, { once: true })
    this.image.src = sourceUrl
    if (this.image.complete) {
      queueMicrotask(this.image.naturalWidth > 0 ? this.handleLoad : this.handleError)
    }
  }

  frame(_timestamp: number): EnvironmentBaseFrame {
    return this.currentFrame
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private readonly handleLoad = (): void => {
    if (this.settled) return
    if (this.image.naturalWidth <= 0 || this.image.naturalHeight <= 0) {
      this.handleError()
      return
    }
    this.settled = true
    this.image.removeEventListener("error", this.handleError)
    this.currentFrame = Object.freeze({
      kind: "image",
      source: this.image,
      size: { width: this.image.naturalWidth, height: this.image.naturalHeight },
      version: 1,
      coverOverscan: this.coverOverscan,
    })
    this.notify()
  }

  private readonly handleError = (): void => {
    if (this.settled) return
    this.settled = true
    this.image.removeEventListener("load", this.handleLoad)
    this.currentFrame = Object.freeze({ kind: "transparent" })
    this.notify()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
