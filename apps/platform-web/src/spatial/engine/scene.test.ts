import { describe, expect, it } from "vitest"
import { findTopmostSceneSource, sourceRectToNdc, sourceTextureUv } from "./scene"
import { SOURCE_FRAGMENT_SHADER } from "./shaders/scene"

describe("spatial scene geometry", () => {
  it("converts source CSS bounds into framebuffer NDC", () => {
    expect(sourceRectToNdc(
      { left: 100, top: 50, width: 200, height: 100 },
      { left: 0, top: 0, width: 400, height: 200 },
    )).toEqual({ left: -0.5, right: 0.5, top: 0.5, bottom: -0.5 })
  })

  it("selects the highest visual source in an overlap", () => {
    const sources = [
      { sourceId: "left", rect: { left: 0, top: 0, width: 100, height: 100 }, zIndex: 10 },
      { sourceId: "right", rect: { left: 50, top: 0, width: 100, height: 100 }, zIndex: 30 },
    ]
    expect(findTopmostSceneSource(sources, { x: 75, y: 50 })?.sourceId).toBe("right")
    expect(findTopmostSceneSource(sources, { x: 200, y: 50 })).toBeNull()
  })

  it("maps the top-left DOM upload convention without pixel-store state", () => {
    expect(sourceTextureUv({ x: 0, y: 0 })).toEqual({ x: 0, y: 1 })
    expect(sourceTextureUv({ x: 1, y: 1 })).toEqual({ x: 1, y: 0 })
    expect(SOURCE_FRAGMENT_SHADER).toContain("vec2(v_uv.x, 1.0 - v_uv.y)")
  })
})
