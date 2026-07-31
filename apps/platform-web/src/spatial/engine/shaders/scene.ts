export const SCENE_VERTEX_SHADER = `#version 300 es
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

export const SOURCE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_uv;
out vec4 outColor;

void main() {
  // texElementImage2D owns a top-left DOM source convention and ignores
  // UNPACK_FLIP_Y_WEBGL. Flip exactly once at the sampling boundary.
  vec2 sourceUv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec4 source = texture(u_texture, sourceUv);
  vec3 tint = vec3(0.96, 1.03, 1.05);
  outColor = vec4(source.rgb * tint, source.a);
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
