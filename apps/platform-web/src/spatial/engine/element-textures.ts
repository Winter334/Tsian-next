import type {
  HtmlInCanvasCapabilities,
  HtmlInCanvasPaintPayload,
} from "./capabilities"
import { computeBackingStoreSize } from "./input/coordinates"
import type { SpatialMetrics } from "./metrics"

export type SourceIneligibilityReason =
  | "disconnected"
  | "stale-parent"
  | "display-none"
  | "no-box"

export interface ElementTextureRecord {
  readonly element: Element
  texture: WebGLTexture | null
  width: number
  height: number
  released: boolean
  dirty: boolean
  paintReady: boolean
  generation: number
  uploadedGeneration: number
}

export interface TextureUploadFailure {
  readonly element: Element
  readonly generation: number
  readonly message: string
  readonly retryable: boolean
}

export interface TextureUploadBatch {
  readonly uploaded: number
  readonly failures: readonly TextureUploadFailure[]
}

export interface ElementTextureSyncResult {
  readonly added: number
  readonly removed: number
  readonly ineligible: readonly {
    readonly element: Element
    readonly reason: SourceIneligibilityReason
  }[]
}

export interface ElementTexturePaintResult {
  readonly marked: number
  readonly removed: number
}

function sourceIneligibility(
  element: Element,
  canvas: HTMLCanvasElement,
): SourceIneligibilityReason | null {
  if (!element.isConnected) return "disconnected"
  if (element.parentElement !== canvas) return "stale-parent"
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (style?.display === "none") return "display-none"
  const rect = element.getBoundingClientRect()
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)
    || rect.width <= 0 || rect.height <= 0) {
    return "no-box"
  }
  return null
}

function ineligibilityMessage(reason: SourceIneligibilityReason): string {
  switch (reason) {
    case "disconnected": return "HTML-in-Canvas source is disconnected."
    case "stale-parent": return "HTML-in-Canvas source is no longer a direct canvas child."
    case "display-none": return "HTML-in-Canvas source has display:none and no drawable box."
    case "no-box": return "HTML-in-Canvas source has no non-zero drawable box."
  }
}

export class ElementTextureRegistry {
  private readonly recordByElement = new Map<Element, ElementTextureRecord>()

  constructor(
    private capabilities: HtmlInCanvasCapabilities,
    private readonly metrics: SpatialMetrics,
  ) {}

  register(element: Element): ElementTextureRecord {
    const existing = this.recordByElement.get(element)
    if (existing) return existing
    const ineligible = sourceIneligibility(element, this.capabilities.canvas)
    if (ineligible) throw new Error(ineligibilityMessage(ineligible))
    const record: ElementTextureRecord = {
      element,
      texture: this.createTexture(),
      width: 0,
      height: 0,
      released: false,
      dirty: true,
      paintReady: false,
      generation: 1,
      uploadedGeneration: 0,
    }
    this.recordByElement.set(element, record)
    this.updateTextureMetric()
    return record
  }

  synchronize(elements: Iterable<Element>): ElementTextureSyncResult {
    const desired = new Set(elements)
    const ineligible: ElementTextureSyncResult["ineligible"][number][] = []
    let added = 0
    let removed = 0

    for (const record of [...this.recordByElement.values()]) {
      const reason = desired.has(record.element)
        ? sourceIneligibility(record.element, this.capabilities.canvas)
        : "disconnected"
      if (!desired.has(record.element) || reason) {
        if (reason && desired.has(record.element)) {
          ineligible.push({ element: record.element, reason })
        }
        this.remove(record.element)
        removed += 1
      }
    }
    for (const element of desired) {
      if (this.recordByElement.has(element)) continue
      const reason = sourceIneligibility(element, this.capabilities.canvas)
      if (reason) {
        ineligible.push({ element, reason })
        continue
      }
      this.register(element)
      added += 1
    }
    return { added, removed, ineligible }
  }

  remove(element: Element): boolean {
    const record = this.recordByElement.get(element)
    if (!record) return false
    this.deleteTexture(record)
    this.recordByElement.delete(element)
    this.updateTextureMetric()
    return true
  }

  release(element: Element): boolean {
    const record = this.recordByElement.get(element)
    if (!record || record.released) return false
    this.deleteTexture(record)
    record.released = true
    record.dirty = false
    record.paintReady = false
    record.generation += 1
    this.updateTextureMetric()
    return true
  }

  restore(element: Element): boolean {
    const record = this.recordByElement.get(element)
    if (!record || !record.released) return false
    if (sourceIneligibility(element, this.capabilities.canvas)) return false
    record.released = false
    if (!record.texture) record.texture = this.createTexture()
    record.dirty = true
    record.paintReady = false
    record.generation += 1
    this.updateTextureMetric()
    return true
  }

  markDirty(element: Element): boolean {
    const record = this.findOwningRecord(element)
    if (!record || record.released) return false
    record.dirty = true
    record.paintReady = false
    record.generation += 1
    return true
  }

  handlePaint(payload: HtmlInCanvasPaintPayload): ElementTexturePaintResult {
    let removed = 0
    for (const removedElement of payload.removed) {
      for (const record of [...this.recordByElement.values()]) {
        if (record.element === removedElement || removedElement.contains(record.element)) {
          if (this.remove(record.element)) removed += 1
        }
      }
    }
    return {
      marked: this.markChanged(payload.changed),
      removed,
    }
  }

  markChanged(changedElements: readonly Element[]): number {
    let marked = 0
    if (changedElements.length === 0) {
      for (const record of this.recordByElement.values()) {
        if (!record.dirty) continue
        record.paintReady = true
        marked += 1
      }
      return marked
    }
    for (const element of changedElements) {
      const record = this.findOwningRecord(element)
      if (!record || record.released) continue
      const reason = sourceIneligibility(record.element, this.capabilities.canvas)
      if (reason) {
        this.remove(record.element)
        continue
      }
      record.dirty = true
      record.paintReady = true
      record.generation += 1
      marked += 1
    }
    return marked
  }

  markAllDirty(): void {
    for (const record of this.recordByElement.values()) {
      if (record.released) continue
      record.dirty = true
      record.paintReady = false
      record.generation += 1
    }
  }

  hasDirty(): boolean {
    return [...this.recordByElement.values()].some((record) => !record.released && record.dirty)
  }

  hasUploadableDirty(): boolean {
    return [...this.recordByElement.values()].some((record) => (
      !record.released && record.dirty && record.paintReady
    ))
  }

  uploadDirty(effectiveRasterScale: number): TextureUploadBatch {
    let uploaded = 0
    const failures: TextureUploadFailure[] = []
    for (const record of [...this.recordByElement.values()]) {
      if (record.released || !record.dirty || !record.paintReady) continue
      const ineligible = sourceIneligibility(record.element, this.capabilities.canvas)
      if (ineligible) {
        const generation = record.generation
        this.remove(record.element)
        failures.push({
          element: record.element,
          generation,
          message: ineligibilityMessage(ineligible),
          retryable: false,
        })
        continue
      }
      if (!record.texture) record.texture = this.createTexture()
      const generation = record.generation
      const rect = record.element.getBoundingClientRect()
      const size = computeBackingStoreSize(
        { width: rect.width, height: rect.height },
        effectiveRasterScale,
        this.capabilities.maxTextureSize,
      )
      record.width = size.width
      record.height = size.height
      try {
        this.capabilities.uploadElement(record.texture, record.element, {
          width: size.width,
          height: size.height,
        })
        record.uploadedGeneration = generation
        record.dirty = record.generation !== generation
        record.paintReady = false
        uploaded += 1
        this.metrics.recordUpload(record.width * record.height * 4)
      } catch (error) {
        record.dirty = true
        record.paintReady = false
        failures.push({
          element: record.element,
          generation,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        })
      }
    }
    this.updateTextureMetric()
    return { uploaded, failures }
  }

  records(): readonly ElementTextureRecord[] {
    return [...this.recordByElement.values()]
  }

  abandonForContextLoss(): void {
    for (const record of this.recordByElement.values()) {
      if (record.texture) this.metrics.recordDisposal()
      record.texture = null
      record.dirty = !record.released
      record.paintReady = false
      record.generation += 1
    }
    this.updateTextureMetric()
  }

  restoreContext(capabilities: HtmlInCanvasCapabilities): void {
    this.capabilities = capabilities
    for (const record of [...this.recordByElement.values()]) {
      if (sourceIneligibility(record.element, capabilities.canvas)) {
        this.remove(record.element)
        continue
      }
      record.texture = record.released ? null : this.createTexture()
      record.dirty = !record.released
      record.paintReady = false
      record.generation += 1
    }
    this.updateTextureMetric()
  }

  releaseAfterRestoreFailure(): void {
    for (const record of this.recordByElement.values()) {
      this.deleteTexture(record)
      record.dirty = !record.released
      record.paintReady = false
      record.generation += 1
    }
    this.updateTextureMetric()
  }

  dispose(): void {
    for (const record of this.recordByElement.values()) this.deleteTexture(record)
    this.recordByElement.clear()
    this.updateTextureMetric()
  }

  private findOwningRecord(element: Element): ElementTextureRecord | undefined {
    return this.recordByElement.get(element)
      ?? [...this.recordByElement.values()].find((candidate) => candidate.element.contains(element))
  }

  private createTexture(): WebGLTexture {
    const { gl } = this.capabilities
    const texture = gl.createTexture()
    if (!texture) throw new Error("Unable to allocate HTML element texture.")
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return texture
  }

  private deleteTexture(record: ElementTextureRecord): void {
    if (!record.texture) return
    this.capabilities.gl.deleteTexture(record.texture)
    record.texture = null
    this.metrics.recordDisposal()
  }

  private updateTextureMetric(): void {
    this.metrics.setTextureCount(
      [...this.recordByElement.values()].filter((record) => record.texture !== null).length,
    )
  }
}
