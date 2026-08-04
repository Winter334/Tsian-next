import { composePhysicalSurfaceVertexShader } from "../physical-surface"

export const SCREEN_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform vec4 u_rect;
uniform vec2 u_parallax;
out vec2 v_uv;

void main() {
  vec2 unit = a_position * 0.5 + 0.5;
  vec2 position = mix(u_rect.xy, u_rect.zw, unit) + u_parallax;
  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = a_uv;
}
`

/** Stable Source path composed from the shared physical camera transform. */
export const SURFACE_VERTEX_SHADER = composePhysicalSurfaceVertexShader(`
in vec2 a_local;
in vec2 a_uv;
out vec2 v_uv;
out float v_depth;
`, `
void main() {
  vec2 halfSize = u_source_rect.zw * 0.5;
  vec3 localSurface = spatialLocalSurface(a_local, halfSize);
  SpatialProjectedVertex projected = spatialProjectSurface(localSurface, 0.0);
  gl_Position = spatialClipPosition(projected);
  v_uv = a_uv;
  v_depth = projected.cameraSpace.z;
}
`)

/** Renderer-owned media uses the owning Source's full physical surface and
 * remaps the shared mesh into one normalized Source-local sub-rectangle. */
export const DYNAMIC_MEDIA_VERTEX_SHADER = composePhysicalSurfaceVertexShader(`
in vec2 a_local;
in vec2 a_uv;
uniform vec4 u_media_rect;
out vec2 v_uv;
out float v_depth;
`, `
void main() {
  vec2 unit = a_local * 0.5 + 0.5;
  vec2 sourceUnit = u_media_rect.xy + unit * u_media_rect.zw;
  vec2 sourceLocal = sourceUnit * 2.0 - 1.0;
  vec2 halfSize = u_source_rect.zw * 0.5;
  vec3 localSurface = spatialLocalSurface(sourceLocal, halfSize);
  SpatialProjectedVertex projected = spatialProjectSurface(localSurface, 0.0);
  gl_Position = spatialClipPosition(projected);
  v_uv = a_uv;
  v_depth = projected.cameraSpace.z;
}
`)

/** Optional product-window aperture transform; stable Sources use the shader above. */
export const SURFACE_PRESENTATION_VERTEX_SHADER = composePhysicalSurfaceVertexShader(`
in vec2 a_local;
in vec2 a_uv;
uniform float u_presentation_progress;
uniform float u_presentation_aperture_scale;
uniform float u_presentation_axis;
uniform float u_presentation_curve_depth_energy;
uniform float u_presentation_depth_energy;
out vec2 v_uv;
out float v_depth;
out float v_presentation_progress;
`, `
void main() {
  float progress = clamp(u_presentation_progress, 0.0, 1.0);
  float apertureScale = mix(u_presentation_aperture_scale, 1.0, progress);
  float transitionEnergy = 1.0 - progress;
  float horizontalAxis = step(0.5, u_presentation_axis);
  float profileCoordinate = mix(a_local.x, a_local.y, horizontalAxis);
  float apertureProfile = 1.0 - profileCoordinate * profileCoordinate;
  vec2 halfSize = u_source_rect.zw * 0.5;
  vec2 closedScale = mix(
    vec2(1.0, apertureScale),
    vec2(apertureScale, 1.0),
    horizontalAxis
  );
  vec2 apertureLocal = a_local * closedScale;
  vec3 localSurface = spatialLocalSurface(apertureLocal, halfSize);
  localSurface.z += u_presentation_curve_depth_energy
    * transitionEnergy * apertureProfile;
  SpatialProjectedVertex projected = spatialProjectSurface(
    localSurface,
    u_presentation_depth_energy * transitionEnergy * apertureProfile
  );
  gl_Position = spatialClipPosition(projected);
  v_uv = a_uv;
  v_depth = projected.cameraSpace.z;
  v_presentation_progress = progress;
}
`)

export const SOURCE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_depth_tint;
uniform float u_active;
uniform float u_transition;
uniform float u_neutral_source;
in vec2 v_uv;
in float v_depth;
out vec4 outColor;

void main() {
  // texElementImage2D owns a top-left DOM convention. The surface mesh also
  // maps local y=-1 to screen/Source top, so sampling is identity on both axes.
  // The retired screen quad needed a Y flip because its y=-1 vertex was bottom.
  vec2 sourceUv = v_uv;
  vec4 center = texture(u_texture, sourceUv);
  if (u_neutral_source > 0.5) {
    outColor = center;
    return;
  }
  float separation = u_transition * min(1.0, abs(v_depth) / 90.0) * 0.0014;
  float red = texture(u_texture, sourceUv + vec2(separation, 0.0)).r;
  float blue = texture(u_texture, sourceUv - vec2(separation, 0.0)).b;
  vec3 sourceRgb = vec3(red, center.g, blue);
  vec3 tint = mix(vec3(0.98, 1.025, 1.04), vec3(0.82, 0.91, 0.96), u_depth_tint);
  tint += vec3(0.0, 0.018, 0.022) * u_active;
  outColor = vec4(sourceRgb * tint, center.a);
}
`

export const SOURCE_PRESENTATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_source_size;
uniform float u_presentation_direction;
uniform float u_presentation_axis;
uniform float u_presentation_edge_energy;
uniform float u_presentation_chromatic_px;
in vec2 v_uv;
in float v_depth;
in float v_presentation_progress;
out vec4 outColor;

void main() {
  float progress = clamp(v_presentation_progress, 0.0, 1.0);
  float transitionEnergy = 1.0 - progress;
  float separation = transitionEnergy * u_presentation_chromatic_px
    / max(1.0, u_source_size.x);
  vec4 center = texture(u_texture, v_uv);
  float red = texture(u_texture, v_uv + vec2(separation, 0.0)).r;
  float blue = texture(u_texture, v_uv - vec2(separation, 0.0)).b;
  vec3 sourceRgb = vec3(red, center.g, blue);

  float boundaryCoordinate = mix(v_uv.y, v_uv.x, step(0.5, u_presentation_axis));
  float boundaryDistance = min(boundaryCoordinate, 1.0 - boundaryCoordinate);
  float boundary = 1.0 - smoothstep(0.0, 0.045, boundaryDistance);
  float edgeEnergy = boundary * transitionEnergy * u_presentation_edge_energy;
  vec3 warmWhite = vec3(1.0, 0.965, 0.91);
  vec3 paleRed = vec3(0.93, 0.43, 0.47);
  float redWeight = 0.28 + 0.08 * max(0.0, u_presentation_direction);
  vec3 apertureColor = mix(warmWhite, paleRed, redWeight);
  vec3 color = mix(sourceRgb, apertureColor, clamp(edgeEnergy, 0.0, 0.52));
  float authoredAlpha = center.a * smoothstep(0.015, 0.2, progress);
  float edgeAlpha = edgeEnergy * 0.58;
  outColor = vec4(color, clamp(authoredAlpha + edgeAlpha, 0.0, 1.0));
}
`

export const FOREGROUND_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_uv;
out vec4 outColor;

float node(vec2 p, vec2 center) {
  return 1.0 - smoothstep(0.002, 0.008, length(p - center));
}

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  float markers = node(p, vec2(-0.72, 0.68))
    + node(p, vec2(0.74, 0.62))
    + node(p, vec2(-0.78, -0.58))
    + node(p, vec2(0.69, -0.66));
  outColor = vec4(vec3(0.12, 0.72, 0.8), clamp(markers * 0.13, 0.0, 0.13));
}
`
