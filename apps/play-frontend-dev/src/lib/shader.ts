/**
 * shader.ts — burning-reveal 的 WebGL shader 字符串 + 初始化辅助。
 *
 * 照搬 F:/workspace/tmp/burning-reveal 的 fbm 燃烧算法（边缘推进 + 纸张焦黑 + 火焰边界 + alpha 衰减），
 * 唯一调整：火焰色调 vec3(6, 1.8, 0.2) 偏琥珀（示例是 vec3(6, 1.4, 0) 偏橙红）。
 *
 * 纹理 = 纸张底色 + Tsian Logo（createLogoPaperTexture）。
 * 燃烧把纸张和 logo 一起从边缘烧穿，烧穿区 alpha=0 透明，露出下层向导/主游玩态。
 */

/** 顶点 shader：直接输出 a_position，传递 vUv（-1..1）。 */
export const VERTEX_SHADER = `
precision mediump float;
varying vec2 vUv;
attribute vec2 a_position;
void main() {
  vUv = a_position;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

/**
 * 片元 shader：照搬示例 fbm 边缘推进烧蚀。
 * - main_noise：随 t 推进的烧蚀边界（边缘推进，非中心向外）
 * - paper_darkness：烧蚀区纸张焦黑变暗
 * - fire_edge：烧蚀边界亮起火焰色
 * - opacity：烧穿区 alpha→0 透明（露出下层 DOM）
 */
export const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_progress;
uniform float u_time;
uniform sampler2D u_text;

float rand(vec2 n) {
  return fract(cos(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}
float noise(vec2 n) {
  const vec2 d = vec2(0., 1.);
  vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
  return mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);
}
float fbm(vec2 n) {
  float total = 0.0, amplitude = .4;
  for (int i = 0; i < 4; i++) {
    total += noise(n) * amplitude;
    n += n;
    amplitude *= 0.6;
  }
  return total;
}

void main() {
  vec2 uv = vUv;
  uv.x *= min(1., u_resolution.x / u_resolution.y);
  uv.y *= min(1., u_resolution.y / u_resolution.x);

  vec2 screenUv = vUv * 0.5 + 0.5;
  screenUv.y = 1.0 - screenUv.y;

  float t = u_progress;
  vec4 textColor = texture2D(u_text, screenUv);
  vec3 color = textColor.rgb;

  // main_noise 下移展宽：原示例 1.-fbm(...) 值域 0.7~1.0，t<0.5 几乎无烧蚀（8s 慢节奏设计）。
  // 调为 *0.8-0.2 → 值域约 -0.2~0.6，t≈0.05 边缘噪声低区开始烧蚀，t=0.2 明显推进。
  // 消除"开始燃烧到有可见效果"的静默前摇，但不至于一上来全屏烧。
  float main_noise = (1. - fbm(.75 * uv + 10. - vec2(.3, .9 * t))) * 0.8 - 0.2;
  float paper_darkness = smoothstep(main_noise - .1, main_noise, t);
  color -= vec3(.99, .95, .99) * paper_darkness;

  vec3 fire_color = fbm(6. * uv - vec2(0., .005 * u_time)) * vec3(6., 1.8, 0.2);
  float show_fire = smoothstep(.4, .9, fbm(10. * uv + 2. - vec2(0., .005 * u_time)));
  show_fire += smoothstep(.7, .8, fbm(.5 * uv + 5. - vec2(0., .001 * u_time)));

  float fire_border = .02 * show_fire;
  float fire_edge = smoothstep(main_noise - fire_border, main_noise - .5 * fire_border, t);
  fire_edge *= (1. - smoothstep(main_noise - .5 * fire_border, main_noise, t));
  color += fire_color * fire_edge;

  float opacity = 1. - smoothstep(main_noise - .0005, main_noise, t);
  gl_FragColor = vec4(color, opacity);
}
`

export interface BurnContext {
  gl: WebGLRenderingContext
  uniforms: Record<string, WebGLUniformLocation | null>
  textTexture: WebGLTexture
}

function compileShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("shader compile failed:", gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function getUniforms(gl: WebGLRenderingContext, program: WebGLProgram): Record<string, WebGLUniformLocation | null> {
  const out: Record<string, WebGLUniformLocation | null> = {}
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(program, i)?.name
    if (name) out[name] = gl.getUniformLocation(program, name)
  }
  return out
}

/**
 * 生成纸张纹理：离屏 canvas 画暖白纸底 + 纸纹斑点，上传为 WebGL 纹理。
 * 纯 canvas 2D 同步绘制（不依赖 Image/SVG），无异步延迟。
 * 不含 logo——logo 在 idle 层由 SVG 独立渲染，点击后淡出消失（用户反馈定稿）。
 */
function createPaperTexture(gl: WebGLRenderingContext): WebGLTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 2048
  canvas.height = 1024
  const ctx = canvas.getContext("2d")!

  // 纸张底色：暖白米黄（古卷感）
  ctx.fillStyle = "#e8d9b8"
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // 纸纹斑点（半透明暖褐点，模拟纸面质感）
  for (let i = 0; i < 240; i++) {
    ctx.fillStyle = `rgba(120, 90, 50, ${Math.random() * 0.05})`
    ctx.beginPath()
    ctx.arc(Math.random() * canvas.width, Math.random() * canvas.height, Math.random() * 3, 0, Math.PI * 2)
    ctx.fill()
  }

  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  return texture
}

/**
 * 初始化 WebGL 燃烧上下文：编译 shader、链接程序、建全屏 quad buffer、生成纸张纹理。
 * 同步（纸张纹理纯 canvas 2D 绘制，无 Image 异步等待）。
 * 开启 alpha blend，烧穿区真透明合成到下层 DOM。
 * 失败返回 null（design §7 风险 1，已接受无 fallback）。
 */
export function initBurningGl(canvas: HTMLCanvasElement): BurnContext | null {
  const gl = (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null
  if (!gl) return null

  const vs = compileShader(gl, VERTEX_SHADER, gl.VERTEX_SHADER)
  const fs = compileShader(gl, FRAGMENT_SHADER, gl.FRAGMENT_SHADER)
  if (!vs || !fs) return null

  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("shader link failed:", gl.getProgramInfoLog(program))
    return null
  }
  gl.useProgram(program)

  // 全屏 quad（TRIANGLE_STRIP）
  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)
  const posLoc = gl.getAttribLocation(program, "a_position")
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  // alpha blend：烧穿区 alpha=0 真透明，合成到下层 DOM（露出向导）
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.clearColor(0, 0, 0, 0)

  const uniforms = getUniforms(gl, program)
  const textTexture = createPaperTexture(gl)
  return { gl, uniforms, textTexture }
}

/** easeInOut（与示例一致），BurningReveal 驱动 u_progress 时用。 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
