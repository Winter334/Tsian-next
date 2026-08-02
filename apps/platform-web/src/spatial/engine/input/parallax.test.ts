import { describe, expect, it } from "vitest"
import { shouldRecenterParallax, viewportParallaxTarget } from "./parallax"

describe("full-viewport parallax", () => {
  it("tracks continuously opposite the pointer through center and every viewport edge", () => {
    const viewport = { left: 0, top: 0, width: 1920, height: 1080 }
    expect(viewportParallaxTarget({ x: 0, y: 0 }, viewport)).toEqual({ x: 0.025, y: -0.012 })
    expect(viewportParallaxTarget({ x: 960, y: 540 }, viewport)).toEqual({ x: 0, y: 0 })
    expect(viewportParallaxTarget({ x: 1920, y: 1080 }, viewport)).toEqual({ x: -0.025, y: 0.012 })
  })

  it("does not recenter at curved-content or viewport leave boundaries", () => {
    expect(shouldRecenterParallax("curve-domain-leave")).toBe(false)
    expect(shouldRecenterParallax("viewport-leave")).toBe(false)
    expect(shouldRecenterParallax("window-blur")).toBe(true)
    expect(shouldRecenterParallax("document-hidden")).toBe(true)
    expect(shouldRecenterParallax("explicit")).toBe(true)
  })
})
