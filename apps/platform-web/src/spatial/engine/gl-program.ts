export type ProgramFailureStage = "vertex" | "fragment" | "link"

export interface ProgramFailure {
  readonly ok: false
  readonly stage: ProgramFailureStage
  readonly message: string
}

export interface ProgramSuccess {
  readonly ok: true
  readonly program: WebGLProgram
}

export type ProgramResult = ProgramSuccess | ProgramFailure

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  stage: "vertex" | "fragment",
): { readonly ok: true; readonly shader: WebGLShader } | ProgramFailure {
  const shader = gl.createShader(type)
  if (!shader) {
    return { ok: false, stage, message: `Unable to allocate ${stage} shader.` }
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || `${stage} shader compilation failed.`
    gl.deleteShader(shader)
    return { ok: false, stage, message }
  }
  return { ok: true, shader }
}

export function createGlProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): ProgramResult {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource, "vertex")
  if (!vertex.ok) return vertex

  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, "fragment")
  if (!fragment.ok) {
    gl.deleteShader(vertex.shader)
    return fragment
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(fragment.shader)
    gl.deleteShader(vertex.shader)
    return { ok: false, stage: "link", message: "Unable to allocate WebGL program." }
  }
  gl.attachShader(program, vertex.shader)
  gl.attachShader(program, fragment.shader)
  gl.linkProgram(program)
  const linked = Boolean(gl.getProgramParameter(program, gl.LINK_STATUS))
  const message = gl.getProgramInfoLog(program) || "WebGL program link failed."
  gl.detachShader(program, vertex.shader)
  gl.detachShader(program, fragment.shader)
  gl.deleteShader(vertex.shader)
  gl.deleteShader(fragment.shader)
  if (!linked) {
    gl.deleteProgram(program)
    return { ok: false, stage: "link", message }
  }
  return { ok: true, program }
}
