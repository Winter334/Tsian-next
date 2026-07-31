import { describe, expect, it } from "vitest"
import { acquireHtmlInCanvasCapabilities } from "./capabilities"

function fakeElement(): Element {
  return { nodeType: 1 } as Element
}

function supportedHarness(
  uploader: (...args: unknown[]) => void,
  options: { readonly exposeRgba8?: boolean } = {},
) {
  const listeners = new Map<string, EventListener>()
  const contextRequests: string[] = []
  const pixelStoreCalls: unknown[][] = []
  let requested = 0
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    TEXTURE_2D: 2,
    RGBA: 4,
    UNSIGNED_BYTE: 5,
    ...(options.exposeRgba8 === false ? {} : { RGBA8: 0x8058 }),
    texElementImage2D: uploader,
    getContextAttributes: () => ({ alpha: true, antialias: true }),
    getParameter: () => 4096,
    bindTexture: () => undefined,
    pixelStorei: (...args: unknown[]) => pixelStoreCalls.push(args),
  } as unknown as WebGL2RenderingContext
  const canvas = {
    layoutSubtree: false,
    onpaint: null,
    requestPaint: () => { requested += 1 },
    getContext: (contextId: string) => {
      contextRequests.push(contextId)
      return contextId === "webgl2" ? gl : null
    },
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as HTMLCanvasElement
  return {
    canvas,
    contextRequests,
    gl,
    listeners,
    pixelStoreCalls,
    requested: () => requested,
  }
}

describe("HTML-in-Canvas capability adapter", () => {
  it("returns all missing capability names instead of throwing", () => {
    const canvas = {
      getContext: () => null,
    } as unknown as HTMLCanvasElement
    const result = acquireHtmlInCanvasCapabilities(canvas)
    expect(result).toMatchObject({
      supported: false,
      missing: [
        "HTMLCanvasElement.layoutSubtree",
        "HTMLCanvasElement.requestPaint",
        "HTMLCanvasElement paint event",
        "WebGL2RenderingContext",
      ],
    })
  })

  it("requires WebGL2 RGBA8 and never probes WebGL1", () => {
    const harness = supportedHarness(() => undefined, { exposeRgba8: false })
    const result = acquireHtmlInCanvasCapabilities(harness.canvas)
    expect(result).toMatchObject({
      supported: false,
      missing: ["WebGL2RenderingContext.RGBA8"],
    })
    expect(harness.contextRequests).toEqual(["webgl2"])
  })

  it("rejects a context that did not grant alpha and antialiasing", () => {
    const harness = supportedHarness(() => undefined)
    harness.gl.getContextAttributes = () => ({
      alpha: false,
      antialias: false,
    }) as WebGLContextAttributes
    const result = acquireHtmlInCanvasCapabilities(harness.canvas)
    expect(result).toMatchObject({
      supported: false,
      missing: ["WebGL2 alpha framebuffer", "WebGL2 antialiasing"],
    })
  })

  it("uses the current four-argument call and normalizes changed and removed paint entries", () => {
    const calls: unknown[][] = []
    const harness = supportedHarness(function current(...args) {
      calls.push(args)
    })
    const result = acquireHtmlInCanvasCapabilities(harness.canvas)
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.capabilities.apiVariant).toBe("unresolved")
    expect(result.capabilities.contextVariant).toBe("webgl2")
    expect(harness.canvas.layoutSubtree).toBe(true)
    result.capabilities.requestPaint()
    expect(harness.requested()).toBe(1)

    const payloads: Array<{ changed: readonly Element[]; removed: readonly Element[] }> = []
    const cleanup = result.capabilities.setPaintHandler((payload) => payloads.push(payload))
    const changed = fakeElement()
    const removed = fakeElement()
    harness.listeners.get("paint")?.({
      changedElements: new Set([changed]),
      removedElements: [removed],
    } as unknown as Event)
    expect(payloads).toEqual([{ changed: [changed], removed: [removed] }])
    cleanup()

    result.capabilities.uploadElement(
      {} as WebGLTexture,
      changed,
      { width: 320, height: 180 },
    )
    expect(calls).toEqual([[2, 0x8058, changed, { width: 320, height: 180 }]])
    expect(result.capabilities.apiVariant).toBe("current")
    expect(harness.pixelStoreCalls).toEqual([])
  })

  it("normalizes absent or malformed paint lists to empty arrays", () => {
    const harness = supportedHarness(() => undefined)
    const result = acquireHtmlInCanvasCapabilities(harness.canvas)
    expect(result.supported).toBe(true)
    if (!result.supported) return
    const payloads: unknown[] = []
    result.capabilities.setPaintHandler((payload) => payloads.push(payload))
    harness.listeners.get("paint")?.({ changedElements: "not-an-element-list" } as unknown as Event)
    expect(payloads).toEqual([{ changed: [], removed: [] }])
  })

  it("falls back directly to the temporary six-argument legacy call", () => {
    const calls: unknown[][] = []
    const harness = supportedHarness(function legacy(...args) {
      calls.push(args)
      if (args.length === 4) throw new TypeError("current signature unsupported")
    })
    const result = acquireHtmlInCanvasCapabilities(harness.canvas)
    expect(result.supported).toBe(true)
    if (!result.supported) return
    const element = fakeElement()
    result.capabilities.uploadElement(
      {} as WebGLTexture,
      element,
      { width: 320, height: 180 },
    )
    result.capabilities.uploadElement(
      {} as WebGLTexture,
      element,
      { width: 640, height: 360 },
    )
    expect(result.capabilities.apiVariant).toBe("legacy")
    expect(calls).toEqual([
      [2, 0x8058, element, { width: 320, height: 180 }],
      [2, 0, 0x8058, 4, 5, element],
      [2, 0, 0x8058, 4, 5, element],
    ])
  })

  it("preserves the current-shape error when legacy also fails", () => {
    const currentError = new TypeError("current signature unsupported")
    const callLengths: number[] = []
    const harness = supportedHarness(function unsupported(...args) {
      callLengths.push(args.length)
      if (args.length === 4) throw currentError
      throw new TypeError("legacy signature unsupported")
    })
    const result = acquireHtmlInCanvasCapabilities(harness.canvas)
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(() => result.capabilities.uploadElement(
      {} as WebGLTexture,
      fakeElement(),
      { width: 320, height: 180 },
    )).toThrow(currentError)
    expect(callLengths).toEqual([4, 6])
    expect(result.capabilities.apiVariant).toBe("unresolved")
  })

  it("does not renegotiate a later current-API upload failure", () => {
    const callLengths: number[] = []
    let uploads = 0
    const harness = supportedHarness(function current(...args) {
      callLengths.push(args.length)
      uploads += 1
      if (uploads === 2) throw new TypeError("element snapshot unavailable")
    })
    const result = acquireHtmlInCanvasCapabilities(harness.canvas)
    expect(result.supported).toBe(true)
    if (!result.supported) return
    const element = fakeElement()
    result.capabilities.uploadElement({} as WebGLTexture, element, { width: 10, height: 10 })
    expect(() => result.capabilities.uploadElement(
      {} as WebGLTexture,
      element,
      { width: 20, height: 20 },
    )).toThrow("element snapshot unavailable")
    expect(callLengths).toEqual([4, 4])
    expect(result.capabilities.apiVariant).toBe("current")
  })
})
