import { composePhysicalSurfaceVertexShader } from "../physical-surface"

/** Stable curved Source mesh plus an aspect-correct radial intact-surface mask. */
export const SOURCE_RIPPLE_MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_source_size;
uniform vec2 u_ripple_origin;
uniform float u_ripple_progress;
uniform float u_ripple_direction;
uniform float u_ripple_wave_softness;
uniform float u_ripple_edge_energy;
uniform float u_ripple_chromatic_px;
in vec2 v_uv;
in float v_depth;
out vec4 outColor;

float normalizedRippleRadius(vec2 uv) {
  vec2 deltaPx = (uv - u_ripple_origin) * u_source_size;
  vec2 farthestPx = max(u_ripple_origin, 1.0 - u_ripple_origin) * u_source_size;
  return length(deltaPx) / max(1.0, length(farthestPx));
}

void main() {
  float progress = clamp(u_ripple_progress, 0.0, 1.0);
  float softness = max(0.001, u_ripple_wave_softness);
  float radius = normalizedRippleRadius(v_uv);
  float front = mix(-softness, 1.0 + softness, progress);
  float ahead = smoothstep(front - softness, front, radius);
  float reveal = 1.0 - ahead;
  float intactMask = u_ripple_direction > 0.0 ? ahead : reveal;

  float endpointEnergy = smoothstep(0.0, 0.025, progress)
    * (1.0 - smoothstep(0.975, 1.0, progress));
  float band = (1.0 - smoothstep(softness * 0.22, softness * 1.32, abs(radius - front)))
    * endpointEnergy;
  vec2 radialPx = (v_uv - u_ripple_origin) * u_source_size;
  vec2 radialDirection = length(radialPx) > 0.001
    ? normalize(radialPx)
    : vec2(1.0, 0.0);
  vec2 separationUv = radialDirection * band * u_ripple_chromatic_px
    / max(vec2(1.0), u_source_size);
  vec4 center = texture(u_texture, v_uv);
  float red = texture(u_texture, v_uv + separationUv).r;
  float blue = texture(u_texture, v_uv - separationUv).b;
  vec3 sampledRgb = vec3(red, center.g, blue);
  vec3 warmWhite = vec3(1.0, 0.966, 0.91);
  vec3 paleRed = vec3(0.94, 0.47, 0.5);
  vec3 energyColor = mix(warmWhite, paleRed, 0.3);
  vec3 color = mix(sampledRgb, energyColor, band * u_ripple_edge_energy);
  float authoredAlpha = center.a * intactMask;
  float edgeAlpha = center.a * band * u_ripple_edge_energy * 0.48;
  outColor = vec4(color, clamp(authoredAlpha + edgeAlpha, 0.0, 1.0));
}
`

/** One static UV/seed vertex anchors to the shared physical Source surface. */
export const SOURCE_RIPPLE_PARTICLE_VERTEX_SHADER = composePhysicalSurfaceVertexShader(`
in vec2 a_seed_uv;
in float a_seed;
uniform sampler2D u_texture;
uniform vec2 u_source_size;
uniform vec2 u_ripple_origin;
uniform float u_ripple_progress;
uniform float u_ripple_direction;
uniform float u_ripple_wave_softness;
uniform float u_ripple_trail_width;
uniform float u_ripple_travel_px;
uniform float u_ripple_tangential_px;
uniform float u_ripple_depth_travel;
uniform float u_ripple_point_size_px;
uniform float u_raster_scale;
uniform float u_source_seed;
flat out vec4 v_sample;
out float v_particle_alpha;
out float v_particle_energy;
`, `
float hash11(float value) {
  return fract(sin(value * 127.1 + u_source_seed * 311.7) * 43758.5453123);
}

float normalizedRippleRadius(vec2 uv) {
  vec2 deltaPx = (uv - u_ripple_origin) * u_source_size;
  vec2 farthestPx = max(u_ripple_origin, 1.0 - u_ripple_origin) * u_source_size;
  return length(deltaPx) / max(1.0, length(farthestPx));
}

void main() {
  vec4 sampled = texture(u_texture, a_seed_uv);
  float softness = max(0.001, u_ripple_wave_softness);
  float trail = max(0.03, u_ripple_trail_width);
  float radius = normalizedRippleRadius(a_seed_uv);
  float arrival = clamp((radius + softness) / (1.0 + softness * 2.0), 0.0, 1.0);
  float localTime = u_ripple_direction > 0.0
    ? (u_ripple_progress - arrival) / trail
    : (u_ripple_progress - (arrival - trail)) / trail;
  float particleAlpha = smoothstep(-0.02, 0.08, localTime)
    * (1.0 - smoothstep(0.7, 1.0, localTime));
  float motion = smoothstep(0.0, 1.0, clamp(localTime, 0.0, 1.0));
  float outward = u_ripple_direction > 0.0 ? motion : 1.0 - motion;

  vec2 local = a_seed_uv * 2.0 - 1.0;
  vec2 halfSize = u_source_rect.zw * 0.5;
  vec3 anchorLocal = spatialLocalSurface(local, halfSize);

  float variation = hash11(a_seed * 19.17 + 0.31);
  vec2 radialPx = (a_seed_uv - u_ripple_origin) * u_source_size;
  float fallbackAngle = 6.28318530718 * hash11(a_seed * 7.13 + 0.71);
  vec2 radialDirection = length(radialPx) > 0.001
    ? normalize(radialPx)
    : vec2(cos(fallbackAngle), sin(fallbackAngle));
  vec2 tangent = vec2(-radialDirection.y, radialDirection.x);
  float tangentSign = hash11(a_seed * 31.73 + 0.17) * 2.0 - 1.0;
  vec2 drift = radialDirection * u_ripple_travel_px * (0.58 + variation * 0.42)
    + tangent * u_ripple_tangential_px * tangentSign;
  drift *= outward;

  float depthEnvelope = sin(3.14159265359 * clamp(localTime, 0.0, 1.0));
  float cameraDepthOffset = u_ripple_depth_travel
    * depthEnvelope * (0.68 + variation * 0.32);
  SpatialProjectedVertex projected = spatialProjectSurface(
    anchorLocal,
    cameraDepthOffset
  );
  projected.screen += drift;
  gl_Position = spatialClipPosition(projected);
  gl_PointSize = max(
    1.0,
    u_ripple_point_size_px * u_raster_scale
      * projected.perspective * (0.78 + variation * 0.46)
  );

  v_sample = sampled;
  v_particle_alpha = particleAlpha * sampled.a;
  v_particle_energy = particleAlpha * (1.0 - abs(localTime * 2.0 - 1.0));
  if (v_particle_alpha <= 0.002) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
  }
}
`)

export const SOURCE_RIPPLE_PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform float u_ripple_edge_energy;
uniform float u_ripple_chromatic_px;
uniform float u_ripple_point_size_px;
flat in vec4 v_sample;
in float v_particle_alpha;
in float v_particle_energy;
out vec4 outColor;

void main() {
  vec2 point = gl_PointCoord - 0.5;
  float radius = length(point);
  if (radius > 0.5 || v_particle_alpha <= 0.002) discard;
  float core = 1.0 - smoothstep(0.16, 0.34, radius);
  float halo = (1.0 - smoothstep(0.22, 0.5, radius)) * (1.0 - core);
  float split = min(0.16, u_ripple_chromatic_px / max(1.0, u_ripple_point_size_px) * 0.22);
  float redLobe = 1.0 - smoothstep(0.17, 0.4, length(point - vec2(split, 0.0)));
  float blueLobe = 1.0 - smoothstep(0.17, 0.4, length(point + vec2(split, 0.0)));
  vec3 warmWhite = vec3(1.0, 0.968, 0.92);
  vec3 paleRed = vec3(0.95, 0.49, 0.52);
  vec3 energyColor = mix(warmWhite, paleRed, 0.32);
  float energy = clamp(v_particle_energy * u_ripple_edge_energy, 0.0, 0.42);
  vec3 color = mix(v_sample.rgb, energyColor, energy);
  color.r += redLobe * energy * 0.1;
  color.b += blueLobe * energy * 0.055;
  float alphaShape = clamp(core + halo * 0.18, 0.0, 1.0);
  outColor = vec4(clamp(color, 0.0, 1.0), v_particle_alpha * alphaShape);
}
`
