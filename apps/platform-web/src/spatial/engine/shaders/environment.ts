export const ENVIRONMENT_BASE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_base_texture;
uniform float u_has_base_texture;
uniform vec2 u_effect_parallax;
uniform vec2 u_base_uv_scale;
uniform float u_flip_base_y;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec2 centered = v_uv * 2.0 - 1.0;
  vec2 mediaUv = (v_uv - 0.5) * u_base_uv_scale + 0.5 + u_effect_parallax * 0.12;
  if (u_flip_base_y > 0.5) mediaUv.y = 1.0 - mediaUv.y;
  float centralVoid = exp(-dot(centered * vec2(0.76, 1.14), centered * vec2(0.76, 1.14)) * 2.25);
  float lowerAtmosphere = exp(-abs(centered.y + 0.78) * 4.2);
  float sideEnergy = exp(-abs(abs(centered.x) - 0.92) * 7.5)
    * (1.0 - smoothstep(0.22, 1.05, abs(centered.y)));
  vec3 proceduralBase = mix(vec3(0.0015, 0.005, 0.013), vec3(0.004, 0.019, 0.034), v_uv.y);
  proceduralBase += vec3(0.0, 0.035, 0.055) * centralVoid;
  proceduralBase += vec3(0.006, 0.028, 0.041) * lowerAtmosphere;
  proceduralBase += vec3(0.0, 0.018, 0.03) * sideEnergy;

  vec3 color = proceduralBase;
  if (u_has_base_texture > 0.5) {
    color = texture(u_base_texture, mediaUv).rgb;
  }
  outColor = vec4(color, 1.0);
}
`

export const ENVIRONMENT_PARTICLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform float u_time;
uniform vec2 u_effect_parallax;
in vec2 v_uv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec2 lowFrequencyFlow(vec2 position, float time, float depth, float seed) {
  float flowTime = time * (0.07 + depth * 0.05);
  float phase = seed * 0.37;
  return vec2(
    sin((position.x * 1.7 + position.y * 2.3 + flowTime) * 6.2831853 + phase),
    cos((position.x * 2.1 - position.y * 1.4 - flowTime * 0.83) * 6.2831853 - phase * 0.61)
  );
}

vec2 particleBand(
  vec2 uv,
  vec2 cells,
  float threshold,
  float size,
  vec2 velocity,
  float depth,
  float seed
) {
  vec2 shifted = uv + u_effect_parallax * depth;
  shifted += u_time * velocity;
  vec2 grid = shifted * cells;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  vec2 identity = cell + vec2(seed, seed * 1.61803);
  float presence = step(threshold, hash21(identity));
  vec2 baseOffset = vec2(
    hash21(identity + vec2(2.3, 7.1)),
    hash21(identity + vec2(4.7, 11.9))
  ) - 0.5;
  float phase = hash21(identity + vec2(13.7, 3.1)) * 6.2831853;
  float speedVariation = mix(0.68, 1.42, hash21(identity + vec2(17.3, 5.9)));
  float sizeVariation = mix(0.78, 1.24, hash21(identity + vec2(19.1, 23.7)));
  float wobbleStrength = mix(
    0.016,
    0.052,
    hash21(identity + vec2(29.3, 31.7))
  ) * (0.78 + depth * 0.32);
  vec2 flowPosition = (cell + baseOffset + 0.5) / cells;
  vec2 flow = lowFrequencyFlow(flowPosition, u_time, depth, seed);
  float wobbleTime = u_time * (0.34 + depth * 0.32) * speedVariation;
  vec2 wobble = vec2(
    sin(wobbleTime + phase),
    cos(wobbleTime * 0.73 + phase * 1.37)
  );
  vec2 offset = baseOffset * 0.5;
  offset += flow * (0.024 + depth * 0.026);
  offset += wobble * wobbleStrength;
  float particleSize = size * sizeVariation;
  // Keep the complete halo inside its deterministic cell. Without this
  // bound, animated centers near an edge are clipped when the fragment starts
  // evaluating the neighboring cell identity, producing a visible pop.
  float maxOffset = max(0.0, 0.498 - particleSize * 4.0);
  float offsetLength = length(offset);
  if (offsetLength > maxOffset && offsetLength > 0.0001) {
    offset *= maxOffset / offsetLength;
  }
  float distanceToParticle = length(local - offset);
  float core = 1.0 - smoothstep(particleSize * 0.34, particleSize, distanceToParticle);
  float halo = 1.0 - smoothstep(
    particleSize,
    particleSize * 4.0,
    distanceToParticle
  );
  halo *= halo;
  float twinkle = 0.72 + 0.28 * sin(
    u_time * (1.1 + depth * 1.35) * speedVariation + phase
  );
  return presence * vec2(core, halo) * twinkle;
}

void main() {
  vec2 uv = v_uv;
  vec2 farBand = particleBand(
    uv, vec2(64.0, 36.0), 0.925, 0.045, vec2(-0.0080, 0.0045), 0.24, 3.0
  );
  vec2 midBand = particleBand(
    uv, vec2(42.0, 24.0), 0.950, 0.055, vec2(0.0130, -0.0080), 0.56, 11.0
  );
  vec2 nearBand = particleBand(
    uv, vec2(24.0, 14.0), 0.976, 0.055, vec2(-0.0200, -0.0120), 0.92, 29.0
  );

  float farLight = farBand.x * 0.72 + farBand.y * 0.10;
  float midLight = midBand.x * 0.82 + midBand.y * 0.13;
  float nearLight = nearBand.x * 0.90 + nearBand.y * 0.15;
  vec3 weightedColor = vec3(0.94, 0.91, 0.88) * farLight;
  weightedColor += vec3(1.0, 0.91, 0.84) * midLight;
  weightedColor += vec3(1.0, 0.68, 0.66) * nearLight;
  float alpha = clamp(farLight + midLight + nearLight, 0.0, 0.88);
  vec3 color = clamp(weightedColor / max(alpha, 0.0001), 0.0, 1.0);
  outColor = clamp(vec4(color, alpha), 0.0, 1.0);
}
`

export const ENVIRONMENT_BLOOM_EXTRACT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_environment_texture;
uniform float u_threshold;
uniform float u_soft_knee;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec3 color = texture(u_environment_texture, v_uv).rgb;
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float contribution = smoothstep(
    max(0.0, u_threshold - u_soft_knee),
    u_threshold + u_soft_knee,
    luminance
  );
  outColor = vec4(color * contribution, 1.0);
}
`

export const ENVIRONMENT_BLOOM_BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec2 u_texel_direction;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec3 color = texture(u_texture, v_uv).rgb * 0.227027;
  color += texture(u_texture, v_uv + u_texel_direction * 1.384615).rgb * 0.316216;
  color += texture(u_texture, v_uv - u_texel_direction * 1.384615).rgb * 0.316216;
  color += texture(u_texture, v_uv + u_texel_direction * 3.230769).rgb * 0.070270;
  color += texture(u_texture, v_uv - u_texel_direction * 3.230769).rgb * 0.070270;
  outColor = vec4(color, 1.0);
}
`

export const ENVIRONMENT_COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_environment_texture;
uniform sampler2D u_bloom_texture;
uniform vec2 u_viewport_size;
uniform float u_time;
uniform float u_chromatic_separation_px;
uniform float u_bloom_strength;
uniform float u_vignette_strength;
uniform float u_grain_strength;
uniform float u_refraction_strength_px;
uniform float u_refraction_frequency;
uniform float u_refraction_speed;
in vec2 v_uv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 centered = v_uv * 2.0 - 1.0;
  vec2 radialPixels = centered * u_viewport_size * 0.5;
  float radialLength = length(radialPixels);
  vec2 radialDirection = radialLength > 0.0001 ? radialPixels / radialLength : vec2(0.0);
  float cornerDistance = length(centered);
  float edgeStrength = smoothstep(0.08, 1.32, cornerDistance);

  float phase = u_time * u_refraction_speed;
  vec2 refractionField = vec2(
    sin((v_uv.y * u_refraction_frequency + phase) * 6.2831853),
    cos((v_uv.x * u_refraction_frequency * 0.83 - phase * 0.71) * 6.2831853)
  );
  vec2 refractedUv = clamp(
    v_uv + refractionField * u_refraction_strength_px / u_viewport_size,
    vec2(0.0),
    vec2(1.0)
  );
  vec2 separation = radialDirection
    * u_chromatic_separation_px
    * edgeStrength * edgeStrength
    / u_viewport_size;
  vec4 centerSample = texture(u_environment_texture, refractedUv);
  float red = texture(u_environment_texture, clamp(refractedUv + separation, 0.0, 1.0)).r;
  float blue = texture(u_environment_texture, clamp(refractedUv - separation, 0.0, 1.0)).b;
  vec3 color = vec3(red, centerSample.g, blue);
  color += texture(u_bloom_texture, refractedUv).rgb * u_bloom_strength;

  float vignette = smoothstep(0.38, 1.34, cornerDistance);
  color *= 1.0 - vignette * u_vignette_strength;
  float grain = hash21(floor(gl_FragCoord.xy * 0.72) + floor(u_time * 24.0)) - 0.5;
  color += grain * u_grain_strength;
  outColor = vec4(max(color, vec3(0.0)), centerSample.a);
}
`

export const ENVIRONMENT_DECORATION_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec2 u_viewport_size;
uniform float u_time;
in vec2 v_uv;
out vec4 outColor;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float ringStroke(float radius, float target, float halfWidth) {
  return 1.0 - smoothstep(halfWidth, halfWidth + 1.15, abs(radius - target));
}

float dashMask(float angle, float phase, float count, float duty) {
  float segment = fract((angle + phase) / TAU * count);
  return 1.0 - smoothstep(duty, duty + 0.055, segment);
}

void main() {
  vec2 pixel = vec2(v_uv.x, 1.0 - v_uv.y) * u_viewport_size;
  vec2 center = vec2(u_viewport_size.x * 0.5, u_viewport_size.y * 0.58);
  vec2 p = pixel - center;
  float radius = length(p);
  float angle = atan(p.y, p.x) + PI;
  float diameter = clamp(u_viewport_size.x * 0.44, 512.0, 864.0);
  float outerRadius = diameter * 0.44;
  float innerRadius = diameter * 0.3933333;

  float outer = ringStroke(radius, outerRadius, 1.05)
    * dashMask(angle, u_time * TAU / 72.0, 54.0, 0.43) * 0.98;
  float inner = ringStroke(radius, innerRadius, 0.75)
    * dashMask(angle, -u_time * TAU / 96.0, 42.0, 0.54) * 0.78;

  float sector = angle / TAU * 72.0;
  float barIndex = floor(sector);
  float angularDistance = abs(fract(sector) - 0.5) * TAU / 72.0 * radius;
  float amplitude = clamp(
    0.5 + sin(barIndex * 1.71) * 0.24 + cos(barIndex * 0.63) * 0.16,
    0.0,
    1.0
  );
  float barLength = 7.0 + floor(amplitude * 15.0 + 0.5);
  float barStart = outerRadius - 11.0;
  float radialBar = smoothstep(barStart - 1.0, barStart + 0.65, radius)
    * (1.0 - smoothstep(barStart + barLength, barStart + barLength + 1.0, radius));
  float breathe = 0.94 + 0.06 * sin(u_time * TAU / 6.8 - mod(barIndex, 12.0) * 0.41);
  float bar = (1.0 - smoothstep(0.52, 1.55, angularDistance))
    * radialBar * (0.5 + amplitude * 0.42) * breathe;
  float accent = 1.0 - step(0.5, mod(barIndex, 19.0));

  vec3 warmWhite = vec3(1.0, 0.988, 0.972);
  vec3 paleRed = vec3(0.906, 0.412, 0.447);
  vec3 colorEnergy = warmWhite * (outer + inner + bar * (1.0 - accent));
  colorEnergy += paleRed * bar * accent;
  float alpha = clamp(outer + inner + bar, 0.0, 0.98);
  vec3 color = colorEnergy / max(alpha, 0.0001);
  outColor = vec4(clamp(color, 0.0, 1.0), alpha);
}
`
