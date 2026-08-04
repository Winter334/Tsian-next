// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  SpatialDynamicMediaTextureRegistry,
  SpatialDynamicMediaTracker,
  containDynamicMediaRect,
  type SpatialDynamicMediaRecord,
} from "./dynamic-media"
import { SpatialMetrics } from "./metrics"

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("containDynamicMediaRect", () => {
  it("contains video inside its measured Source-local box without stretching", () => {
    expect(containDynamicMediaRect({
      source: { width: 800, height: 600 },
      box: { left: 100, top: 50, width: 400, height: 300 },
      intrinsic: { width: 1920, height: 1080 },
    })).toEqual({ left: 100, top: 87.5, width: 400, height: 225 })
  })

  it("rejects zero-sized and non-finite media geometry", () => {
    expect(containDynamicMediaRect({
      source: { width: 800, height: 600 },
      box: { left: 0, top: 0, width: 0, height: 20 },
      intrinsic: { width: 1, height: 1 },
    })).toBeNull()
    expect(containDynamicMediaRect({
      source: { width: 800, height: 600 },
      box: { left: Number.NaN, top: 0, width: 20, height: 20 },
      intrinsic: { width: 1, height: 1 },
    })).toBeNull()
  })
})

describe("SpatialDynamicMediaTracker", () => {
  it("requests decoder-driven frames and suspends exactly on Source release", () => {
    const source = document.createElement("section")
    source.setAttribute("data-spatial-source", "window:media")
    const video = document.createElement("video")
    video.setAttribute("data-spatial-dynamic-media", "video")
    source.append(video)
    document.body.append(source)
    let paused = false
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 2 },
      paused: { configurable: true, get: () => paused },
      ended: { configurable: true, value: false },
    })
    const callbacks: VideoFrameRequestCallback[] = []
    const requestVideoFrameCallback = vi.fn((next: VideoFrameRequestCallback) => {
      callbacks.push(next)
      return 17
    })
    const cancelVideoFrameCallback = vi.fn()
    Object.defineProperties(video, {
      requestVideoFrameCallback: { configurable: true, value: requestVideoFrameCallback },
      cancelVideoFrameCallback: { configurable: true, value: cancelVideoFrameCallback },
    })
    const reasons: string[] = []
    const tracker = new SpatialDynamicMediaTracker({ requestFrame: (reason) => reasons.push(reason) })

    tracker.sync([source])
    expect(reasons).toEqual(["animated-media"])
    expect(requestVideoFrameCallback).toHaveBeenCalledTimes(1)
    callbacks[0]?.(0, {} as VideoFrameCallbackMetadata)
    expect(reasons).toEqual(["animated-media", "animated-media"])

    const generationBeforePause = tracker.records()[0]?.frameGeneration
    paused = true
    video.dispatchEvent(new Event("pause"))
    callbacks[1]?.(0, {} as VideoFrameCallbackMetadata)
    expect(tracker.records()[0]?.frameGeneration).toBe(generationBeforePause)
    expect(reasons).toEqual(["animated-media", "animated-media"])

    tracker.releaseSource("window:media")
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(17)
    const generation = tracker.records()[0]?.frameGeneration
    callbacks[1]?.(0, {} as VideoFrameCallbackMetadata)
    expect(tracker.records()[0]?.frameGeneration).toBe(generation)
    tracker.dispose()
  })
})

describe("SpatialDynamicMediaTextureRegistry", () => {
  function createHarness() {
    const texImage2D = vi.fn()
    const deleteTexture = vi.fn()
    const pixelStorei = vi.fn()
    const gl = {
      TEXTURE_2D: 1,
      TEXTURE_MIN_FILTER: 2,
      TEXTURE_MAG_FILTER: 3,
      TEXTURE_WRAP_S: 4,
      TEXTURE_WRAP_T: 5,
      LINEAR: 6,
      CLAMP_TO_EDGE: 7,
      UNPACK_FLIP_Y_WEBGL: 8,
      RGBA: 9,
      UNSIGNED_BYTE: 10,
      createTexture: () => ({ id: 1 }),
      bindTexture: vi.fn(),
      texParameteri: vi.fn(),
      pixelStorei,
      texImage2D,
      deleteTexture,
    } as unknown as WebGL2RenderingContext
    return { gl, texImage2D, deleteTexture, pixelStorei }
  }

  it("uploads only new video generations and maps them into the owning curved Source", () => {
    const harness = createHarness()
    const metrics = new SpatialMetrics()
    const registry = new SpatialDynamicMediaTextureRegistry(harness.gl, metrics)
    const source = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) } as unknown as Element
    const video = {
      isConnected: true,
      readyState: 2,
      videoWidth: 1920,
      videoHeight: 1080,
      getBoundingClientRect: () => ({ left: 200, top: 150, width: 400, height: 300 }),
    } as unknown as HTMLVideoElement
    const media: SpatialDynamicMediaRecord = {
      sourceId: "window:media",
      source,
      video,
      frameGeneration: 1,
      released: false,
      fullscreen: false,
    }

    registry.sync([media])
    expect(registry.uploadReady()).toBe(1)
    expect(registry.uploadReady()).toBe(0)
    expect(harness.texImage2D).toHaveBeenCalledTimes(1)
    expect(harness.pixelStorei.mock.calls).toEqual([[8, false]])
    expect(registry.surfacesForSource("window:media", {
      left: 100,
      top: 50,
      width: 800,
      height: 600,
    })[0]?.rect).toEqual({ left: 0.125, top: 0.22916666666666666, width: 0.5, height: 0.375 })

    media.frameGeneration += 1
    expect(registry.uploadReady()).toBe(1)
    media.released = true
    registry.sync([media])
    expect(harness.deleteTexture).toHaveBeenCalledTimes(1)
    expect(metrics.snapshot()).toMatchObject({ uploadCount: 2, disposalCount: 1 })
  })

  it("recreates its texture after context restoration", () => {
    const first = createHarness()
    const second = createHarness()
    const registry = new SpatialDynamicMediaTextureRegistry(first.gl, new SpatialMetrics())
    const media = {
      sourceId: "window:media",
      source: {} as Element,
      video: {
        isConnected: true,
        readyState: 2,
        videoWidth: 4,
        videoHeight: 4,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 4, height: 4 }),
      } as HTMLVideoElement,
      frameGeneration: 1,
      released: false,
      fullscreen: false,
    }
    registry.sync([media])
    expect(registry.uploadReady()).toBe(1)
    registry.abandonForContextLoss()
    registry.restoreContext(second.gl)
    media.frameGeneration += 1
    expect(registry.uploadReady()).toBe(1)
    expect(second.texImage2D).toHaveBeenCalledTimes(1)
  })
})
