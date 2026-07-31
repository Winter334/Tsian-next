import { describe, expect, it } from "vitest"
import { CURVE_FRAGMENT_SHADER } from "./curve"

describe("curve shader geometry", () => {
  it("uses the concave tangent map and center-recessed vertical scale", () => {
    expect(CURVE_FRAGMENT_SHADER).toContain("atan(curved.x * tan(u_max_angle))")
    expect(CURVE_FRAGMENT_SHADER).toContain("mix(u_min_center_scale, 1.0, edgeDepth)")
    expect(CURVE_FRAGMENT_SHADER).not.toContain("bezel")
  })

  it("keeps pixels outside the curved desktop transparent", () => {
    expect(CURVE_FRAGMENT_SHADER).toContain("outColor = vec4(0.0)")
    expect(CURVE_FRAGMENT_SHADER).toContain("scene.a * surfaceFade")
  })

  it("converts the premultiplied surface back to straight color before compositing", () => {
    expect(CURVE_FRAGMENT_SHADER).toContain("scene.rgb / scene.a")
    expect(CURVE_FRAGMENT_SHADER).not.toContain(
      "color *= (0.86 + vignette * 0.14) * surfaceFade",
    )
  })
})
