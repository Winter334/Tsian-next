import type { ClientRectLike } from "./input/coordinates"
import type { FrameReason } from "./frame-scheduler"
import type { SpatialMetrics } from "./metrics"

const HAVE_CURRENT_DATA = 2

export interface SpatialDynamicMediaRecord {
  readonly sourceId: string
  readonly source: Element
  readonly video: HTMLVideoElement
  frameGeneration: number
  released: boolean
  fullscreen: boolean
}

export interface SpatialDynamicMediaTrackerOptions {
  readonly requestFrame: (reason: FrameReason) => void
  readonly onFrameReady?: (record: SpatialDynamicMediaRecord) => void
}

interface ScheduledVideoFrame {
  readonly kind: "video" | "animation"
  readonly handle: number
}

/**
 * DOM-facing half of renderer-owned video textures. Decoded frames request
 * their own renderer work and never dirty the owning HTML Source texture.
 */
export class SpatialDynamicMediaTracker {
  private readonly recordByVideo = new Map<HTMLVideoElement, SpatialDynamicMediaRecord>()
  private readonly cleanupByVideo = new Map<HTMLVideoElement, () => void>()
  private readonly scheduledByVideo = new Map<HTMLVideoElement, ScheduledVideoFrame>()
  private visible = true
  private disposed = false

  constructor(private readonly options: SpatialDynamicMediaTrackerOptions) {}

  sync(sources: readonly Element[]): void {
    if (this.disposed) return
    const discovered = new Set<HTMLVideoElement>()
    for (const source of sources) {
      const sourceId = source.getAttribute("data-spatial-source")
      if (!sourceId) continue
      for (const video of source.querySelectorAll<HTMLVideoElement>(
        'video[data-spatial-dynamic-media="video"]',
      )) {
        discovered.add(video)
        const existing = this.recordByVideo.get(video)
        if (existing) continue
        this.register({
          sourceId,
          source,
          video,
          frameGeneration: 0,
          released: false,
          fullscreen: document.fullscreenElement === video,
        })
      }
    }
    for (const video of [...this.recordByVideo.keys()]) {
      if (!discovered.has(video)) this.remove(video)
    }
  }

  records(): readonly SpatialDynamicMediaRecord[] {
    return [...this.recordByVideo.values()]
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    for (const record of this.recordByVideo.values()) {
      if (visible) this.requestCurrentFrame(record)
      else this.stop(record.video)
    }
  }

  releaseSource(sourceId: string): void {
    for (const record of this.recordByVideo.values()) {
      if (record.sourceId !== sourceId) continue
      record.released = true
      this.stop(record.video)
    }
  }

  restoreSource(sourceId: string): void {
    for (const record of this.recordByVideo.values()) {
      if (record.sourceId !== sourceId) continue
      record.released = false
      this.requestCurrentFrame(record)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const video of [...this.recordByVideo.keys()]) this.remove(video)
  }

  private register(record: SpatialDynamicMediaRecord): void {
    const { video } = record
    this.recordByVideo.set(video, record)
    const refresh = () => {
      record.fullscreen = document.fullscreenElement === video
      if (record.fullscreen) this.stop(video)
      else this.requestCurrentFrame(record)
    }
    const stop = () => this.stop(video)
    const refreshEvents = ["loadeddata", "loadedmetadata", "seeked", "playing", "play"] as const
    const stopEvents = ["pause", "ended", "emptied"] as const
    for (const event of refreshEvents) video.addEventListener(event, refresh)
    for (const event of stopEvents) video.addEventListener(event, stop)
    document.addEventListener("fullscreenchange", refresh)
    this.cleanupByVideo.set(video, () => {
      for (const event of refreshEvents) video.removeEventListener(event, refresh)
      for (const event of stopEvents) video.removeEventListener(event, stop)
      document.removeEventListener("fullscreenchange", refresh)
      this.stop(video)
    })
    refresh()
  }

  private remove(video: HTMLVideoElement): void {
    const record = this.recordByVideo.get(video)
    if (!record) return
    record.released = true
    this.cleanupByVideo.get(video)?.()
    this.cleanupByVideo.delete(video)
    this.recordByVideo.delete(video)
  }

  private requestCurrentFrame(record: SpatialDynamicMediaRecord): void {
    if (!this.eligible(record)) return
    this.frameReady(record)
    if (!record.video.paused && !record.video.ended) this.scheduleDecodedFrame(record)
  }

  private scheduleDecodedFrame(record: SpatialDynamicMediaRecord): void {
    const { video } = record
    if (!this.eligible(record)
      || video.paused
      || video.ended
      || this.scheduledByVideo.has(video)) return
    if (typeof video.requestVideoFrameCallback === "function") {
      const handle = video.requestVideoFrameCallback(() => {
        this.scheduledByVideo.delete(video)
        if (!video.paused && !video.ended) this.frameReady(record)
        this.scheduleDecodedFrame(record)
      })
      this.scheduledByVideo.set(video, { kind: "video", handle })
      return
    }
    const handle = requestAnimationFrame(() => {
      this.scheduledByVideo.delete(video)
      if (!video.paused && !video.ended && video.readyState >= HAVE_CURRENT_DATA) {
        this.frameReady(record)
      }
      this.scheduleDecodedFrame(record)
    })
    this.scheduledByVideo.set(video, { kind: "animation", handle })
  }

  private stop(video: HTMLVideoElement): void {
    const scheduled = this.scheduledByVideo.get(video)
    if (!scheduled) return
    if (scheduled.kind === "video" && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(scheduled.handle)
    } else {
      cancelAnimationFrame(scheduled.handle)
    }
    this.scheduledByVideo.delete(video)
  }

  private eligible(record: SpatialDynamicMediaRecord): boolean {
    return !this.disposed
      && this.visible
      && !record.released
      && !record.fullscreen
      && record.video.isConnected
      && record.video.readyState >= HAVE_CURRENT_DATA
  }

  private frameReady(record: SpatialDynamicMediaRecord): void {
    if (!this.eligible(record)) return
    record.frameGeneration += 1
    this.options.onFrameReady?.(record)
    this.options.requestFrame("animated-media")
  }
}

interface SpatialDynamicMediaTextureRecord {
  readonly media: SpatialDynamicMediaRecord
  texture: WebGLTexture | null
  uploadedGeneration: number
  failedGeneration: number
}

export interface SpatialDynamicMediaSurface {
  readonly texture: WebGLTexture
  /** Normalized top-left Source-local rectangle. */
  readonly rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
}

/** GL-facing ownership for opt-in decoded video textures. */
export class SpatialDynamicMediaTextureRegistry {
  private readonly textureByVideo = new Map<HTMLVideoElement, SpatialDynamicMediaTextureRecord>()
  private contextAvailable = true

  constructor(
    private gl: WebGL2RenderingContext,
    private readonly metrics: SpatialMetrics,
  ) {}

  sync(records: readonly SpatialDynamicMediaRecord[]): void {
    const desired = new Set(records.map((record) => record.video))
    for (const video of [...this.textureByVideo.keys()]) {
      if (!desired.has(video)) this.remove(video)
    }
    for (const media of records) {
      const existing = this.textureByVideo.get(media.video)
      if (existing) {
        if (media.released) this.deleteTexture(existing)
        continue
      }
      this.textureByVideo.set(media.video, {
        media,
        texture: null,
        uploadedGeneration: 0,
        failedGeneration: -1,
      })
    }
  }

  uploadReady(): number {
    if (!this.contextAvailable) return 0
    let uploaded = 0
    for (const record of this.textureByVideo.values()) {
      const { media } = record
      if (media.released
        || media.fullscreen
        || !media.video.isConnected
        || media.video.readyState < HAVE_CURRENT_DATA
        || media.frameGeneration <= record.uploadedGeneration
        || media.frameGeneration === record.failedGeneration) continue
      try {
        if (!record.texture) record.texture = this.createTexture()
        this.gl.bindTexture(this.gl.TEXTURE_2D, record.texture)
        // The shared surface mesh maps its top edge to v=0. Keep the DOM
        // video's top row at v=0 so dynamic media follows the same top-left
        // convention as captured Source textures.
        this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false)
        this.gl.texImage2D(
          this.gl.TEXTURE_2D,
          0,
          this.gl.RGBA,
          this.gl.RGBA,
          this.gl.UNSIGNED_BYTE,
          media.video,
        )
        record.uploadedGeneration = media.frameGeneration
        record.failedGeneration = -1
        this.metrics.recordUpload(Math.max(1, media.video.videoWidth)
          * Math.max(1, media.video.videoHeight) * 4)
        uploaded += 1
      } catch (error) {
        record.failedGeneration = media.frameGeneration
        this.metrics.recordFailure(
          `Dynamic video upload failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return uploaded
  }

  surfacesForSource(sourceId: string, sourceRect: ClientRectLike): readonly SpatialDynamicMediaSurface[] {
    if (!this.contextAvailable || sourceRect.width <= 0 || sourceRect.height <= 0) return []
    const result: SpatialDynamicMediaSurface[] = []
    for (const record of this.textureByVideo.values()) {
      const { media, texture } = record
      if (!texture
        || media.sourceId !== sourceId
        || media.released
        || media.fullscreen
        || record.uploadedGeneration <= 0) continue
      const videoRect = snapshotRect(media.video.getBoundingClientRect())
      const contained = containDynamicMediaRect({
        source: sourceRect,
        box: videoRect,
        intrinsic: { width: media.video.videoWidth, height: media.video.videoHeight },
      })
      if (!contained) continue
      const normalized = {
        left: (contained.left - sourceRect.left) / sourceRect.width,
        top: (contained.top - sourceRect.top) / sourceRect.height,
        width: contained.width / sourceRect.width,
        height: contained.height / sourceRect.height,
      }
      if (normalized.left >= 1 || normalized.top >= 1
        || normalized.left + normalized.width <= 0
        || normalized.top + normalized.height <= 0) continue
      result.push({ texture, rect: normalized })
    }
    return result
  }

  abandonForContextLoss(): void {
    this.contextAvailable = false
    for (const record of this.textureByVideo.values()) {
      if (record.texture) this.metrics.recordDisposal()
      record.texture = null
      record.uploadedGeneration = 0
      record.failedGeneration = -1
    }
  }

  restoreContext(gl: WebGL2RenderingContext): void {
    this.gl = gl
    this.contextAvailable = true
    for (const record of this.textureByVideo.values()) {
      record.texture = null
      record.uploadedGeneration = 0
      record.failedGeneration = -1
    }
  }

  dispose(): void {
    for (const record of this.textureByVideo.values()) this.deleteTexture(record)
    this.textureByVideo.clear()
  }

  private createTexture(): WebGLTexture {
    const texture = this.gl.createTexture()
    if (!texture) throw new Error("Unable to allocate dynamic video texture.")
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE)
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE)
    return texture
  }

  private remove(video: HTMLVideoElement): void {
    const record = this.textureByVideo.get(video)
    if (!record) return
    this.deleteTexture(record)
    this.textureByVideo.delete(video)
  }

  private deleteTexture(record: SpatialDynamicMediaTextureRecord): void {
    if (!record.texture || !this.contextAvailable) {
      record.texture = null
      return
    }
    this.gl.deleteTexture(record.texture)
    record.texture = null
    this.metrics.recordDisposal()
  }
}

function snapshotRect(rect: ClientRectLike): ClientRectLike {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

export function containDynamicMediaRect(input: {
  source: ClientRectLike | { width: number; height: number }
  box: ClientRectLike
  intrinsic: { width: number; height: number }
}): ClientRectLike | null {
  const values = [
    input.source.width,
    input.source.height,
    input.box.left,
    input.box.top,
    input.box.width,
    input.box.height,
    input.intrinsic.width,
    input.intrinsic.height,
  ]
  if (!values.every(Number.isFinite)
    || input.source.width <= 0
    || input.source.height <= 0
    || input.box.width <= 0
    || input.box.height <= 0
    || input.intrinsic.width <= 0
    || input.intrinsic.height <= 0) return null
  const scale = Math.min(
    input.box.width / input.intrinsic.width,
    input.box.height / input.intrinsic.height,
  )
  const width = input.intrinsic.width * scale
  const height = input.intrinsic.height * scale
  return {
    left: input.box.left + (input.box.width - width) / 2,
    top: input.box.top + (input.box.height - height) / 2,
    width,
    height,
  }
}
