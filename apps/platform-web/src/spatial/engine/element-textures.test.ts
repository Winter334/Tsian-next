import { describe, expect, it } from "vitest"
import type { HtmlInCanvasCapabilities } from "./capabilities"
import { ElementTextureRegistry } from "./element-textures"
import { SpatialMetrics } from "./metrics"

interface FakeElementState {
  connected: boolean
  parent: Element | null
  display: string
  width: number
  height: number
}

function createHarness() {
  const canvas = { nodeType: 1 } as unknown as HTMLCanvasElement
  const states = new WeakMap<Element, FakeElementState>()
  const ownerDocument = {
    defaultView: {
      getComputedStyle: (element: Element) => ({ display: states.get(element)?.display ?? "block" }),
    },
  }
  const uploads: string[] = []
  const uploadSizes: Array<{ width: number; height: number }> = []
  const deleted: WebGLTexture[] = []
  let textures = 0
  const gl = {
    TEXTURE_2D: 1,
    TEXTURE_WRAP_S: 2,
    TEXTURE_WRAP_T: 3,
    TEXTURE_MIN_FILTER: 4,
    TEXTURE_MAG_FILTER: 5,
    CLAMP_TO_EDGE: 6,
    LINEAR: 7,
    createTexture: () => ({ id: ++textures }),
    bindTexture: () => undefined,
    texParameteri: () => undefined,
    deleteTexture: (texture: WebGLTexture) => deleted.push(texture),
  } as unknown as WebGL2RenderingContext
  const capabilities: HtmlInCanvasCapabilities = {
    canvas,
    gl,
    apiVariant: "current",
    contextVariant: "webgl2",
    maxTextureSize: 4096,
    requestPaint: () => undefined,
    setPaintHandler: () => () => undefined,
    uploadElement: (_texture, element, size) => {
      uploads.push(element.id)
      uploadSizes.push(size)
    },
  }
  const element = (id: string, width = 200, height = 100): Element => {
    const source = {
      nodeType: 1,
      id,
      get isConnected() { return states.get(source as unknown as Element)?.connected ?? false },
      get parentElement() { return states.get(source as unknown as Element)?.parent ?? null },
      ownerDocument,
      contains: () => false,
      getBoundingClientRect: () => {
        const state = states.get(source as unknown as Element)
        return { width: state?.width ?? 0, height: state?.height ?? 0 }
      },
    } as unknown as Element
    states.set(source, { connected: true, parent: canvas, display: "block", width, height })
    return source
  }
  const update = (source: Element, change: Partial<FakeElementState>) => {
    const state = states.get(source)
    if (!state) throw new Error("Unknown fake element.")
    Object.assign(state, change)
  }
  const metrics = new SpatialMetrics()
  return { canvas, capabilities, uploads, uploadSizes, deleted, element, update, metrics }
}

describe("ElementTextureRegistry", () => {
  it("uploads only dirty generations after a paint snapshot is available", () => {
    const harness = createHarness()
    const registry = new ElementTextureRegistry(harness.capabilities, harness.metrics)
    const left = harness.element("left")
    const right = harness.element("right")
    registry.register(left)
    registry.register(right)
    expect(registry.uploadDirty(2).uploaded).toBe(0)
    registry.handlePaint({ changed: [left, right], removed: [] })
    expect(registry.uploadDirty(2).uploaded).toBe(2)
    expect(registry.uploadDirty(2).uploaded).toBe(0)
    registry.handlePaint({ changed: [left], removed: [] })
    expect(registry.uploadDirty(2).uploaded).toBe(1)
    expect(harness.uploads).toEqual(["left", "right", "left"])
    expect(harness.uploadSizes).toEqual([
      { width: 400, height: 200 },
      { width: 400, height: 200 },
      { width: 400, height: 200 },
    ])
    expect(harness.metrics.snapshot()).toMatchObject({ uploadCount: 3, textureCount: 2 })
  })

  it("preserves source aspect ratio at the texture limit", () => {
    const harness = createHarness()
    const registry = new ElementTextureRegistry(
      { ...harness.capabilities, maxTextureSize: 300 },
      harness.metrics,
    )
    const source = harness.element("wide", 400, 100)
    registry.register(source)
    registry.handlePaint({ changed: [source], removed: [] })
    expect(registry.uploadDirty(2).uploaded).toBe(1)
    expect(harness.uploadSizes).toEqual([{ width: 300, height: 75 }])
  })

  it("releases and restores a texture without removing source state", () => {
    const harness = createHarness()
    const registry = new ElementTextureRegistry(harness.capabilities, harness.metrics)
    const source = harness.element("source")
    const record = registry.register(source)
    expect(registry.release(source)).toBe(true)
    expect(record.texture).toBeNull()
    expect(registry.records()).toHaveLength(1)
    expect(registry.restore(source)).toBe(true)
    expect(record.texture).not.toBeNull()
    expect(record.dirty).toBe(true)
  })

  it("keeps a released source minimized through paint and context restoration", () => {
    const harness = createHarness()
    const registry = new ElementTextureRegistry(harness.capabilities, harness.metrics)
    const source = harness.element("source")
    const record = registry.register(source)
    registry.handlePaint({ changed: [source], removed: [] })
    expect(registry.uploadDirty(1).uploaded).toBe(1)

    expect(registry.release(source)).toBe(true)
    registry.handlePaint({ changed: [source], removed: [] })
    expect(registry.uploadDirty(1).uploaded).toBe(0)
    expect(record.texture).toBeNull()
    expect(record.released).toBe(true)

    registry.abandonForContextLoss()
    registry.restoreContext(harness.capabilities)
    expect(record.texture).toBeNull()
    expect(record.released).toBe(true)
    expect(registry.restore(source)).toBe(true)
    expect(record.texture).not.toBeNull()
  })

  it("releases removed paint entries immediately", () => {
    const harness = createHarness()
    const registry = new ElementTextureRegistry(harness.capabilities, harness.metrics)
    const source = harness.element("source")
    registry.register(source)
    const result = registry.handlePaint({ changed: [], removed: [source] })
    expect(result.removed).toBe(1)
    expect(harness.deleted).toHaveLength(1)
    expect(registry.records()).toHaveLength(0)
  })

  it.each([
    ["disconnected", { connected: false }],
    ["stale-parent", { parent: null }],
    ["display-none", { display: "none" }],
    ["no-box", { width: 0, height: 0 }],
  ] satisfies Array<[string, Partial<FakeElementState>]>)
  ("releases %s sources instead of forcing a 1x1 retry", (_label, invalidation) => {
    const harness = createHarness()
    const registry = new ElementTextureRegistry(harness.capabilities, harness.metrics)
    const source = harness.element("source")
    registry.register(source)
    registry.handlePaint({ changed: [source], removed: [] })
    harness.update(source, invalidation)

    const batch = registry.uploadDirty(2)
    expect(batch.uploaded).toBe(0)
    expect(batch.failures).toHaveLength(1)
    expect(batch.failures[0]?.retryable).toBe(false)
    expect(registry.records()).toHaveLength(0)
    expect(harness.deleted).toHaveLength(1)
  })

  it("retains an upload failure but waits for a new paint snapshot before retrying", () => {
    const harness = createHarness()
    const capabilities = {
      ...harness.capabilities,
      uploadElement: () => { throw new Error("snapshot unavailable") },
    }
    const registry = new ElementTextureRegistry(capabilities, harness.metrics)
    const record = registry.register(harness.element("source"))
    registry.handlePaint({ changed: [record.element], removed: [] })
    const batch = registry.uploadDirty(1)
    expect(batch.failures[0]).toMatchObject({
      message: "snapshot unavailable",
      retryable: true,
    })
    expect(record.dirty).toBe(true)
    expect(record.paintReady).toBe(false)
    expect(registry.uploadDirty(1).failures).toEqual([])
  })
})
