import { describe, expect, it } from "vitest"
import {
  SOURCE_FRAGMENT_SHADER,
  SOURCE_PRESENTATION_FRAGMENT_SHADER,
  SURFACE_PRESENTATION_VERTEX_SHADER,
  SURFACE_VERTEX_SHADER,
} from "./scene"

describe("per-surface curve shader geometry", () => {
  it("uses one cylindrical, rigid, perspective camera transform", () => {
    expect(SURFACE_VERTEX_SHADER).toContain("u_source_rect")
    expect(SURFACE_VERTEX_SHADER).toContain("u_pose")
    expect(SURFACE_VERTEX_SHADER).toContain("u_curve_half_angle")
    expect(SURFACE_VERTEX_SHADER).toContain("u_focal_length")
    expect(SURFACE_VERTEX_SHADER).toContain("float radius = halfSize.x / sin(u_curve_half_angle)")
    expect(SURFACE_VERTEX_SHADER).toContain("radius * (cos(arc) - 1.0)")
    expect(SURFACE_VERTEX_SHADER).toContain("float cosYaw = cos(u_pose.y)")
    expect(SURFACE_VERTEX_SHADER).toContain("float cosPitch = cos(u_pose.z)")
    expect(SURFACE_VERTEX_SHADER).toContain("u_pose.x + rotated.z + cameraDepthOffset")
    expect(SURFACE_VERTEX_SHADER).toContain(
      "float clipW = (u_focal_length + cameraSpace.z) / u_focal_length",
    )
    expect(SURFACE_VERTEX_SHADER).toContain(
      "return vec4(ndc * projected.clipW, 0.0, projected.clipW)",
    )
    expect(SURFACE_VERTEX_SHADER).not.toContain("horizontalEdgeScale")
    expect(SURFACE_VERTEX_SHADER).not.toContain("verticalEdgeScale")
    expect(SURFACE_VERTEX_SHADER).not.toContain("curveOffsetY")
  })

  it("contains no all-sources framebuffer or spherical radial inverse", () => {
    expect(SURFACE_VERTEX_SHADER).not.toContain("u_scene")
    expect(SURFACE_VERTEX_SHADER).not.toContain("radiusSquared")
    expect(SURFACE_VERTEX_SHADER).not.toContain("sphereRoot")
  })

  it("preserves exact captured color for flat-neutral product Sources", () => {
    expect(SOURCE_FRAGMENT_SHADER).toContain("uniform float u_neutral_source")
    expect(SOURCE_FRAGMENT_SHADER).toContain("if (u_neutral_source > 0.5)")
    expect(SOURCE_FRAGMENT_SHADER).toContain("outColor = center")
    expect(SOURCE_FRAGMENT_SHADER.indexOf("outColor = center"))
      .toBeLessThan(SOURCE_FRAGMENT_SHADER.indexOf("float separation"))
  })

  it("keeps curved-aperture geometry and edge treatment isolated to transition shaders", () => {
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("u_presentation_progress")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("u_presentation_aperture_scale")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("u_presentation_axis")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("vec2(1.0, apertureScale)")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("vec2(apertureScale, 1.0)")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("a_local * closedScale")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("u_presentation_curve_depth_energy")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("u_presentation_depth_energy")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("spatialProjectSurface")
    expect(SURFACE_PRESENTATION_VERTEX_SHADER).toContain("mix(u_presentation_aperture_scale, 1.0, progress)")
    expect(SOURCE_PRESENTATION_FRAGMENT_SHADER).toContain("u_presentation_edge_energy")
    expect(SOURCE_PRESENTATION_FRAGMENT_SHADER).toContain("u_presentation_chromatic_px")
    expect(SOURCE_PRESENTATION_FRAGMENT_SHADER).toContain("u_presentation_axis")
    expect(SOURCE_PRESENTATION_FRAGMENT_SHADER).toContain("warmWhite")
    expect(SOURCE_PRESENTATION_FRAGMENT_SHADER).toContain("paleRed")
    expect(SOURCE_PRESENTATION_FRAGMENT_SHADER).toContain(
      "boundary * transitionEnergy * u_presentation_edge_energy",
    )
    expect(SOURCE_FRAGMENT_SHADER).not.toContain("u_presentation_progress")
    expect(SURFACE_VERTEX_SHADER).not.toContain("u_presentation_progress")
  })
})
