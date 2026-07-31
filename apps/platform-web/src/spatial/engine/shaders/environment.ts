export const ENVIRONMENT_BASE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_base_texture;
uniform float u_has_base_texture;
uniform vec2 u_effect_parallax;
uniform vec2 u_base_uv_scale;
in vec2 v_uv;
out vec4 outColor;

void main() {
  vec2 centered = v_uv * 2.0 - 1.0;
  vec2 mediaUv = (v_uv - 0.5) * u_base_uv_scale + 0.5 + u_effect_parallax * 0.12;
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

float particleBand(
  vec2 uv,
  vec2 cells,
  float threshold,
  float size,
  float speed,
  float depth,
  float seed
) {
  vec2 shifted = uv + u_effect_parallax * depth;
  shifted += vec2(u_time * speed, -u_time * speed * 0.37);
  vec2 grid = shifted * cells;
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  float presence = step(threshold, hash21(cell + seed));
  vec2 offset = vec2(hash21(cell + seed * 2.3), hash21(cell + seed * 4.7)) - 0.5;
  float distanceToParticle = length(local - offset * 0.62);
  float point = 1.0 - smoothstep(size, size * 2.4, distanceToParticle);
  float twinkle = 0.42 + 0.58 * sin(u_time * (0.42 + depth * 0.2) + hash21(cell) * 6.28318);
  return presence * point * max(0.12, twinkle);
}

void main() {
  vec2 uv = v_uv;
  float farBand = particleBand(uv, vec2(34.0, 20.0), 0.958, 0.032, 0.0014, 0.28, 3.0);
  float midBand = particleBand(uv, vec2(25.0, 15.0), 0.968, 0.043, -0.0022, 0.58, 11.0);
  float nearBand = particleBand(uv, vec2(17.0, 10.0), 0.980, 0.058, 0.0031, 0.94, 29.0);
  vec3 color = vec3(0.16, 0.64, 0.76) * farBand * 0.46;
  color += vec3(0.24, 0.82, 0.9) * midBand * 0.62;
  color += vec3(0.78, 0.95, 0.98) * nearBand * 0.72;
  float alpha = clamp(farBand * 0.32 + midBand * 0.42 + nearBand * 0.52, 0.0, 0.78);
  outColor = vec4(color, alpha);
}
`
