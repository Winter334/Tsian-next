export const CURVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform float u_max_angle;
uniform float u_min_center_scale;
uniform float u_transition;
in vec2 v_uv;
out vec4 outColor;

vec4 sampleScene(vec2 uv, float depth) {
  vec4 center = texture(u_scene, uv);
  float separation = u_transition * depth * 0.0025;
  float red = texture(u_scene, uv + vec2(separation, 0.0)).r;
  float blue = texture(u_scene, uv - vec2(separation, 0.0)).b;
  return vec4(red, center.g, blue, center.a);
}

void main() {
  vec2 curved = v_uv * 2.0 - 1.0;
  float theta = atan(curved.x * tan(u_max_angle));
  float edgeDepth = (1.0 - cos(theta)) / (1.0 - cos(u_max_angle));
  float verticalScale = mix(u_min_center_scale, 1.0, edgeDepth);
  vec2 planar = vec2(theta / u_max_angle, curved.y / verticalScale);
  if (abs(planar.x) > 1.0 || abs(planar.y) > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  vec2 sceneUv = planar * 0.5 + 0.5;
  vec4 scene = sampleScene(sceneUv, edgeDepth);
  // The transparent surface framebuffer stores premultiplied RGB after
  // straight-alpha blending. Recover straight color before applying the
  // curve treatment so the final composite does not multiply alpha twice.
  vec3 straightScene = scene.a > 0.00001 ? scene.rgb / scene.a : vec3(0.0);
  vec3 color = pow(max(straightScene, vec3(0.0)), vec3(0.92));
  color *= mix(1.12, 1.0, edgeDepth);
  float surfaceEdge = min(1.0 - abs(planar.x), 1.0 - abs(planar.y));
  float surfaceFade = smoothstep(0.0, 0.035, surfaceEdge);
  float vignette = 1.0 - smoothstep(0.58, 1.32, length(curved));
  float alpha = scene.a * surfaceFade;
  color *= 0.86 + vignette * 0.14;
  outColor = vec4(color, alpha);
}
`
