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
 * 片元 shader：fbm 边缘推进烧蚀。纯纹理燃烧，无程序化叠加。
 * - u_variant：0=paper（开屏，红橙火焰），1=scroll（恢复，琥珀金火焰）
 * - main_noise：随 t 推进的烧蚀边界（边缘推进，非中心向外）
 * - paper_darkness：烧蚀区焦黑变暗
 * - fire_edge：烧蚀边界亮起火焰色（按 variant 选色）
 * - opacity：烧穿区 alpha→0 透明（露出下层 DOM）
 */
export const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform vec2 u_resolution;
uniform float u_progress;
uniform float u_time;
uniform float u_variant;
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

  // main_noise 下移展宽
  float main_noise = (1. - fbm(.75 * uv + 10. - vec2(.3, .9 * t))) * 0.8 - 0.2;
  float paper_darkness = smoothstep(main_noise - .1, main_noise, t);
  color -= vec3(.99, .95, .99) * paper_darkness;

  // 火焰色：paper=红橙（开屏原色），scroll=琥珀金（恢复检查点）
  vec3 fire_base = u_variant > 0.5 ? vec3(4.0, 2.8, 0.6) : vec3(6.0, 1.8, 0.2);
  vec3 fire_color = fbm(6. * uv - vec2(0., .005 * u_time)) * fire_base;
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

  return uploadTexture(gl, canvas)
}

/**
 * 生成暗色古卷轴纹理：皮革粗糙感 + 纸张纤维 + 金丝纹理。
 * 与开屏亮色纸张对立：深褐底 + 暗金质感，营造"焚烧旧卷轴"的仪式感。
 *
 * 质感层次（从底到顶）：
 * 1. 暗色底 + 暗金径向渐变（烛火照亮中心感）
 * 2. 皮革粗糙感：三层噪声（大斑块凹凸 + 中斑反光 + 细密颗粒）
 * 3. 纸张纤维：短直线偏水平，暗金/暗褐双色，模拟纤维走向
 * 4. 金丝纹理：贝塞尔曲线波浪线，暗金色
 * 5. 暗角 vignette + 卷轴边框
 */
function createScrollTexture(gl: WebGLRenderingContext): WebGLTexture {
  const canvas = document.createElement("canvas")
  canvas.width = 2048
  canvas.height = 1024
  const ctx = canvas.getContext("2d")!
  const w = canvas.width
  const h = canvas.height

  // ── 1. 暗色底 + 径向渐变 ──
  ctx.fillStyle = "#0e0805"
  ctx.fillRect(0, 0, w, h)
  const grad = ctx.createRadialGradient(w * 0.5, h * 0.5, 0, w * 0.5, h * 0.5, w * 0.5)
  grad.addColorStop(0, "rgba(50, 35, 18, 0.6)")
  grad.addColorStop(0.4, "rgba(28, 18, 8, 0.3)")
  grad.addColorStop(1, "rgba(0, 0, 0, 0)")
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // ── 2. 皮革粗糙感 ──
  // 大尺度暗色斑块（皮面凹陷）
  for (let i = 0; i < 60; i++) {
    const r = 40 + Math.random() * 80
    const x = Math.random() * w
    const y = Math.random() * h
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(15, 8, 3, ${0.1 + Math.random() * 0.12})`)
    g.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 中尺度暖色微亮斑（皮面凸起反光）
  for (let i = 0; i < 200; i++) {
    const r = 6 + Math.random() * 18
    const x = Math.random() * w
    const y = Math.random() * h
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(90, 65, 30, ${0.04 + Math.random() * 0.06})`)
    g.addColorStop(1, "rgba(0, 0, 0, 0)")
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 小尺度细密颗粒（粗糙质感）
  for (let i = 0; i < 1200; i++) {
    const v = Math.random()
    const c = v > 0.5
      ? `rgba(${70 + Math.random() * 40}, ${48 + Math.random() * 25}, ${22 + Math.random() * 15}, ${Math.random() * 0.1})`
      : `rgba(${15 + Math.random() * 10}, ${8 + Math.random() * 8}, 3, ${Math.random() * 0.12})`
    ctx.fillStyle = c
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5)
  }

  // ── 3. 纸张纤维 ──
  // 暗纤维（大量，褐色，偏水平）
  for (let i = 0; i < 500; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const angle = (Math.random() - 0.5) * 0.5 + Math.PI * 0.5
    const len = 4 + Math.random() * 14
    ctx.strokeStyle = `rgba(35, 24, 12, ${0.04 + Math.random() * 0.08})`
    ctx.lineWidth = 0.4 + Math.random() * 0.6
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  // 亮纤维（少量，暗金，偏水平）
  for (let i = 0; i < 150; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const angle = (Math.random() - 0.5) * 0.5 + Math.PI * 0.5
    const len = 5 + Math.random() * 16
    ctx.strokeStyle = `rgba(130, 98, 45, ${0.03 + Math.random() * 0.06})`
    ctx.lineWidth = 0.3 + Math.random() * 0.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }

  // ── 4. 金丝纹理 ──
  // 主金丝：几条流畅贝塞尔波浪线，暗金色
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = `rgba(150, 112, 52, ${0.08 + Math.random() * 0.06})`
    ctx.lineWidth = 0.5 + Math.random() * 0.6
    ctx.beginPath()
    const baseY = h * (0.2 + Math.random() * 0.6)
    ctx.moveTo(0, baseY)
    for (let x = 0; x < w; x += 250) {
      const cp1y = baseY + (Math.random() - 0.5) * 150
      const cp2y = baseY + (Math.random() - 0.5) * 150
      const endY = baseY + (Math.random() - 0.5) * 100
      ctx.bezierCurveTo(x + 80, cp1y, x + 170, cp2y, x + 250, endY)
    }
    ctx.stroke()
  }
  // 细金丝：更细更密的短曲线
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = `rgba(110, 82, 38, ${0.04 + Math.random() * 0.04})`
    ctx.lineWidth = 0.3
    ctx.beginPath()
    const baseY = Math.random() * h
    ctx.moveTo(0, baseY)
    for (let x = 0; x < w; x += 150) {
      ctx.bezierCurveTo(
        x + 50, baseY + (Math.random() - 0.5) * 80,
        x + 100, baseY + (Math.random() - 0.5) * 80,
        x + 150, baseY + (Math.random() - 0.5) * 60,
      )
    }
    ctx.stroke()
  }

  // ── 5. 暗角 vignette + 卷轴边框 ──
  const vignette = ctx.createRadialGradient(w * 0.5, h * 0.5, w * 0.3, w * 0.5, h * 0.5, w * 0.6)
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)")
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.5)")
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)

  // 卷轴边框
  ctx.fillStyle = "rgba(6, 3, 1, 0.95)"
  ctx.fillRect(0, 0, w, 20)
  ctx.fillRect(0, h - 20, w, 20)
  ctx.strokeStyle = "rgba(100, 75, 35, 0.3)"
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(w, 20); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, h - 20); ctx.lineTo(w, h - 20); ctx.stroke()

  return uploadTexture(gl, canvas)
}

/** 上传 canvas 为 WebGL 纹理（公共逻辑）。 */
function uploadTexture(gl: WebGLRenderingContext, canvas: HTMLCanvasElement): WebGLTexture {
  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  return texture
}

export type BurnVariant = "paper" | "scroll"

/**
 * 初始化 WebGL 燃烧上下文：编译 shader、链接程序、建全屏 quad buffer、生成纹理。
 * variant="paper" → 亮色纸张纹理（开屏）；variant="scroll" → 暗色卷轴纹理（恢复检查点）。
 * 纯纹理燃烧，shader 不做程序化叠加——Logo/魔法阵方案已移除，专心做好纹理质感。
 * 同步（纹理纯 canvas 2D 绘制，无 Image 异步等待）。
 * 开启 alpha blend，烧穿区真透明合成到下层 DOM。
 * 失败返回 null（design §7 风险 1，已接受无 fallback）。
 */
export function initBurningGl(canvas: HTMLCanvasElement, variant: BurnVariant = "paper"): BurnContext | null {
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
  // u_variant：0=paper（开屏，红橙火焰），1=scroll（恢复，琥珀金火焰）
  gl.uniform1f(uniforms["u_variant"], variant === "scroll" ? 1.0 : 0.0)
  const textTexture = variant === "scroll" ? createScrollTexture(gl) : createPaperTexture(gl)
  return { gl, uniforms, textTexture }
}

/** easeInOut（与示例一致），BurningReveal 驱动 u_progress 时用。 */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}
