import { describe, expect, it } from "vitest"
import {
  computeEnvironmentCoverUvScale,
  StaticImageEnvironmentBase,
  StaticProceduralEnvironmentBase,
  TransparentEnvironmentBase,
} from "./environment-base"

function createFakeImage(): HTMLImageElement {
  const image = new EventTarget() as HTMLImageElement
  Object.defineProperties(image, {
    complete: { configurable: true, value: false, writable: true },
    decoding: { configurable: true, value: "auto", writable: true },
    naturalHeight: { configurable: true, value: 0, writable: true },
    naturalWidth: { configurable: true, value: 0, writable: true },
    src: { configurable: true, value: "", writable: true },
  })
  return image
}

describe("StaticProceduralEnvironmentBase", () => {
  it("returns one stable procedural frame and owns no animation reason", () => {
    const provider = new StaticProceduralEnvironmentBase()
    expect(provider.frameDemand).toBe("static")
    expect(provider.frame(0)).toBe(provider.frame(10_000))
    expect(provider.frame(0)).toEqual({ kind: "procedural" })
  })

  it("computes overscanned cover UVs without stretching media", () => {
    expect(computeEnvironmentCoverUvScale(
      { width: 1000, height: 1000 },
      { width: 2000, height: 1000 },
    )).toEqual({ x: 0.94, y: 0.47 })
    expect(computeEnvironmentCoverUvScale(
      { width: 2000, height: 1000 },
      { width: 1000, height: 1000 },
    )).toEqual({ x: 0.47, y: 0.94 })
    expect(computeEnvironmentCoverUvScale(
      { width: 1000, height: 1000 },
      { width: 2000, height: 1000 },
      1,
    )).toEqual({ x: 1, y: 0.5 })
  })
})

describe("TransparentEnvironmentBase", () => {
  it("returns one stable transparent frame and owns no animation reason", () => {
    const provider = new TransparentEnvironmentBase()
    expect(provider.frameDemand).toBe("static")
    expect(provider.frame(0)).toBe(provider.frame(10_000))
    expect(provider.frame(0)).toEqual({ kind: "transparent" })
  })
})

describe("StaticImageEnvironmentBase", () => {
  it("publishes decoded CPU image data without owning a frame reason", () => {
    const image = createFakeImage()
    const provider = new StaticImageEnvironmentBase("/wallpaper.jpg", {
      createImage: () => image,
      coverOverscan: 1,
    })
    let notifications = 0
    provider.subscribe(() => { notifications += 1 })

    Object.defineProperties(image, {
      naturalHeight: { value: 1080 },
      naturalWidth: { value: 1920 },
    })
    image.dispatchEvent(new Event("load"))

    expect(provider.frameDemand).toBe("static")
    expect(provider.frame(0)).toEqual({
      kind: "image",
      source: image,
      size: { width: 1920, height: 1080 },
      version: 1,
      coverOverscan: 1,
    })
    expect(notifications).toBe(1)
  })

  it("stays transparent and requests one redraw when loading fails", () => {
    const image = createFakeImage()
    const provider = new StaticImageEnvironmentBase("/missing.jpg", {
      createImage: () => image,
    })
    let notifications = 0
    provider.subscribe(() => { notifications += 1 })

    image.dispatchEvent(new Event("error"))

    expect(provider.frame(0)).toEqual({ kind: "transparent" })
    expect(notifications).toBe(1)
  })
})
