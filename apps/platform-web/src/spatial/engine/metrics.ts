export interface SpatialMetricsSnapshot {
  readonly frameCount: number
  readonly lastFrameTimeMs: number
  readonly averageFrameTimeMs: number
  readonly uploadCount: number
  readonly uploadedBytesEstimate: number
  readonly textureCount: number
  readonly disposalCount: number
  readonly displayDpr: number
  readonly internalRasterScale: number
  readonly activeReasons: readonly string[]
  readonly lastFailure: string | null
}

export class SpatialMetrics {
  private frameCount = 0
  private totalFrameTimeMs = 0
  private lastFrameTimeMs = 0
  private uploadCount = 0
  private uploadedBytesEstimate = 0
  private textureCount = 0
  private disposalCount = 0
  private displayDpr = 1
  private internalRasterScale = 1
  private activeReasons: readonly string[] = []
  private lastFailure: string | null = null

  recordFrame(durationMs: number): void {
    const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0
    this.frameCount += 1
    this.lastFrameTimeMs = duration
    this.totalFrameTimeMs += duration
  }

  recordUpload(bytesEstimate: number): void {
    this.uploadCount += 1
    this.uploadedBytesEstimate += Math.max(0, Math.round(bytesEstimate))
  }

  setTextureCount(count: number): void {
    this.textureCount = Math.max(0, Math.round(count))
  }

  recordDisposal(count = 1): void {
    this.disposalCount += Math.max(0, Math.round(count))
  }

  setRasterPolicy(displayDpr: number, internalRasterScale: number): void {
    this.displayDpr = Number.isFinite(displayDpr) ? Math.max(0, displayDpr) : 1
    this.internalRasterScale = Number.isFinite(internalRasterScale)
      ? Math.max(0, internalRasterScale)
      : 1
  }

  setActiveReasons(reasons: Iterable<string>): void {
    this.activeReasons = [...new Set(reasons)].sort()
  }

  recordFailure(message: string | null): void {
    this.lastFailure = message
  }

  snapshot(): SpatialMetricsSnapshot {
    return Object.freeze({
      frameCount: this.frameCount,
      lastFrameTimeMs: this.lastFrameTimeMs,
      averageFrameTimeMs: this.frameCount === 0 ? 0 : this.totalFrameTimeMs / this.frameCount,
      uploadCount: this.uploadCount,
      uploadedBytesEstimate: this.uploadedBytesEstimate,
      textureCount: this.textureCount,
      disposalCount: this.disposalCount,
      displayDpr: this.displayDpr,
      internalRasterScale: this.internalRasterScale,
      activeReasons: Object.freeze([...this.activeReasons]),
      lastFailure: this.lastFailure,
    })
  }
}
