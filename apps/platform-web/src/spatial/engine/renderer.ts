import type { HtmlInCanvasCapabilities } from "./capabilities"
import { ElementTextureRegistry, type TextureUploadBatch } from "./element-textures"
import {
  computeEnvironmentCoverUvScale,
  StaticProceduralEnvironmentBase,
  type EnvironmentBaseFrame,
  type EnvironmentBaseProvider,
} from "./environment-base"
import { createGlProgram, type ProgramFailure } from "./gl-program"
import { computeBackingStoreSize, type ParallaxTransform } from "./input/coordinates"
import type { SpatialMetrics } from "./metrics"
import { curveShaderUniforms, DEFAULT_CURVE_PROJECTION, type SpatialPoint } from "./projection"
import { ContextResourceRegistry } from "./resources"
import { SCENE_PARALLAX_WEIGHTS, sourceRectToNdc } from "./scene"
import { CURVE_FRAGMENT_SHADER } from "./shaders/curve"
import {
  ENVIRONMENT_BASE_FRAGMENT_SHADER,
  ENVIRONMENT_PARTICLE_FRAGMENT_SHADER,
} from "./shaders/environment"
import {
  FOREGROUND_FRAGMENT_SHADER,
  SCENE_VERTEX_SHADER,
  SOURCE_FRAGMENT_SHADER,
} from "./shaders/scene"

interface RendererPrograms {
  readonly environmentBase: WebGLProgram
  readonly environmentParticles: WebGLProgram
  readonly source: WebGLProgram
  readonly foreground: WebGLProgram
  readonly curve: WebGLProgram
}

export interface SpatialRenderState {
  readonly time: number
  readonly parallax: SpatialPoint
  readonly transitionStrength: number
  readonly freezeParticles?: boolean
}

export type SpatialRenderPass =
  | "environment-base"
  | "environment-particles"
  | "surface-sources"
  | "surface-foreground"
  | "curve-composite"

export interface SpatialRenderReport {
  readonly uploadBatch: TextureUploadBatch
  readonly passes: readonly SpatialRenderPass[]
}

export interface SpatialRendererOptions {
  readonly environmentBase?: EnvironmentBaseProvider
}

export type RendererCreationResult =
  | { readonly ok: true; readonly renderer: SpatialRenderer }
  | { readonly ok: false; readonly failure: ProgramFailure | { readonly stage: "resource"; readonly message: string } }

const QUAD_VERTICES = new Float32Array([
  -1, -1, 0, 0,
  1, -1, 1, 0,
  -1, 1, 0, 1,
  -1, 1, 0, 1,
  1, -1, 1, 0,
  1, 1, 1, 1,
])

const MIN_SPATIAL_RASTER_SCALE = 2

export class SpatialRenderer {
  readonly elementTextures: ElementTextureRegistry
  private readonly resources: ContextResourceRegistry
  private readonly environmentBase: EnvironmentBaseProvider
  private programs: RendererPrograms | null = null
  private quadBuffer: WebGLBuffer | null = null
  private surfaceFramebuffer: WebGLFramebuffer | null = null
  private surfaceTexture: WebGLTexture | null = null
  private effectiveRasterScale = 1
  private suspended = false
  private disposed = false

  private constructor(
    private capabilities: HtmlInCanvasCapabilities,
    private readonly metrics: SpatialMetrics,
    options: SpatialRendererOptions,
  ) {
    this.resources = new ContextResourceRegistry(
      capabilities.gl,
      (count) => this.metrics.recordDisposal(count),
    )
    this.elementTextures = new ElementTextureRegistry(capabilities, metrics)
    this.environmentBase = options.environmentBase ?? new StaticProceduralEnvironmentBase()
  }

  static create(
    capabilities: HtmlInCanvasCapabilities,
    metrics: SpatialMetrics,
    options: SpatialRendererOptions = {},
  ): RendererCreationResult {
    const renderer = new SpatialRenderer(capabilities, metrics, options)
    let initialized: RendererCreationResult
    try {
      initialized = renderer.initialize()
    } catch (error) {
      initialized = {
        ok: false,
        failure: {
          stage: "resource",
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
    if (!initialized.ok) {
      renderer.dispose()
      return initialized
    }
    return { ok: true, renderer }
  }

  environmentFrameReason(): "animated-background" | null {
    return this.environmentBase.frameDemand === "animated" ? "animated-background" : null
  }

  resize(cssWidth: number, cssHeight: number, requestedDpr: number): void {
    this.assertAvailable()
    const maxDimension = Math.max(1, this.capabilities.maxTextureSize)
    const size = computeBackingStoreSize(
      { width: cssWidth, height: cssHeight },
      // The display DPR and local 2x source/scene raster floor are distinct.
      // Layout and projected input remain in CSS pixels.
      Math.max(MIN_SPATIAL_RASTER_SCALE, requestedDpr),
      maxDimension,
    )
    if (size.width === 0 || size.height === 0) return
    const { canvas } = this.capabilities
    const backingSizeChanged = canvas.width !== size.width || canvas.height !== size.height
    if (backingSizeChanged) {
      canvas.width = size.width
      canvas.height = size.height
    }
    this.effectiveRasterScale = size.effectiveDpr
    this.metrics.setRasterPolicy(requestedDpr, size.effectiveDpr)
    if (!backingSizeChanged && this.surfaceTexture && this.surfaceFramebuffer) return
    this.allocateSurfaceTarget(size.width, size.height)
    this.elementTextures.markAllDirty()
  }

  render(state: SpatialRenderState): SpatialRenderReport {
    this.assertAvailable()
    const { gl, canvas } = this.capabilities
    const programs = this.programs
    if (!programs || !this.quadBuffer || !this.surfaceFramebuffer || !this.surfaceTexture) {
      throw new Error("Spatial renderer resources are not initialized.")
    }

    const uploadBatch = this.elementTextures.uploadDirty(this.effectiveRasterScale)
    const passes: SpatialRenderPass[] = []

    // Environment is visually stable in viewport space and never enters the
    // curved framebuffer.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.disable(gl.BLEND)
    gl.clearColor(0.001, 0.004, 0.011, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.drawEnvironmentBase(
      programs.environmentBase,
      this.environmentBase.frame(state.time),
      state.parallax,
    )
    passes.push("environment-base")

    this.configureStraightAlphaBlend()
    this.drawEnvironmentParticles(
      programs.environmentParticles,
      state.freezeParticles ? 0 : state.time,
      state.parallax,
    )
    passes.push("environment-particles")

    // Only HTML surfaces and local accents enter the transparent curve pass.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfaceFramebuffer)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    this.configureStraightAlphaBlend()

    const canvasRect = canvas.getBoundingClientRect()
    const records = [...this.elementTextures.records()].sort((left, right) => {
      const leftZ = Number(left.element.getAttribute("data-spatial-z") ?? 0)
      const rightZ = Number(right.element.getAttribute("data-spatial-z") ?? 0)
      return leftZ - rightZ
    })
    for (const record of records) {
      if (!record.texture) continue
      const rect = sourceRectToNdc(record.element.getBoundingClientRect(), canvasRect)
      this.drawSource(programs.source, {
        rect: [rect.left, rect.bottom, rect.right, rect.top],
        parallax: state.parallax,
        texture: record.texture,
      })
    }
    passes.push("surface-sources")

    this.drawForeground(programs.foreground, state.parallax)
    passes.push("surface-foreground")

    // Alpha-composite the curved surface over the already-drawn environment.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, canvas.width, canvas.height)
    this.configureStraightAlphaBlend()
    this.drawFinal(programs.curve, state.transitionStrength)
    passes.push("curve-composite")
    return { uploadBatch, passes }
  }

  handleContextLost(): void {
    if (this.disposed) return
    this.suspended = true
    this.resources.abandonForContextLoss()
    this.elementTextures.abandonForContextLoss()
    this.programs = null
    this.quadBuffer = null
    this.surfaceFramebuffer = null
    this.surfaceTexture = null
  }

  restore(
    capabilities: HtmlInCanvasCapabilities,
    requestedDpr: number,
  ): RendererCreationResult {
    if (this.disposed) {
      return { ok: false, failure: { stage: "resource", message: "Renderer is disposed." } }
    }
    this.capabilities = capabilities
    this.resources.restoreContext(capabilities.gl)
    this.suspended = false
    try {
      const initialized = this.initialize()
      if (!initialized.ok) {
        this.cleanupFailedRestore()
        return initialized
      }
      this.elementTextures.restoreContext(capabilities)
      const rect = capabilities.canvas.getBoundingClientRect()
      this.resize(rect.width, rect.height, requestedDpr)
      return { ok: true, renderer: this }
    } catch (error) {
      this.cleanupFailedRestore()
      return {
        ok: false,
        failure: {
          stage: "resource",
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.elementTextures.dispose()
    this.resources.releaseAll()
    this.programs = null
    this.quadBuffer = null
    this.surfaceFramebuffer = null
    this.surfaceTexture = null
    this.disposed = true
  }

  private initialize(): RendererCreationResult {
    const { gl } = this.capabilities
    const environmentBase = createGlProgram(gl, SCENE_VERTEX_SHADER, ENVIRONMENT_BASE_FRAGMENT_SHADER)
    if (!environmentBase.ok) return { ok: false, failure: environmentBase }
    this.resources.trackProgram(environmentBase.program)
    const environmentParticles = createGlProgram(
      gl,
      SCENE_VERTEX_SHADER,
      ENVIRONMENT_PARTICLE_FRAGMENT_SHADER,
    )
    if (!environmentParticles.ok) return { ok: false, failure: environmentParticles }
    this.resources.trackProgram(environmentParticles.program)
    const source = createGlProgram(gl, SCENE_VERTEX_SHADER, SOURCE_FRAGMENT_SHADER)
    if (!source.ok) return { ok: false, failure: source }
    this.resources.trackProgram(source.program)
    const foreground = createGlProgram(gl, SCENE_VERTEX_SHADER, FOREGROUND_FRAGMENT_SHADER)
    if (!foreground.ok) return { ok: false, failure: foreground }
    this.resources.trackProgram(foreground.program)
    const curve = createGlProgram(gl, SCENE_VERTEX_SHADER, CURVE_FRAGMENT_SHADER)
    if (!curve.ok) return { ok: false, failure: curve }
    this.resources.trackProgram(curve.program)

    const buffer = gl.createBuffer()
    if (!buffer) {
      return { ok: false, failure: { stage: "resource", message: "Unable to allocate quad buffer." } }
    }
    this.quadBuffer = this.resources.trackBuffer(buffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW)
    this.programs = {
      environmentBase: environmentBase.program,
      environmentParticles: environmentParticles.program,
      source: source.program,
      foreground: foreground.program,
      curve: curve.program,
    }
    return { ok: true, renderer: this }
  }

  private allocateSurfaceTarget(width: number, height: number): void {
    const { gl } = this.capabilities
    if (!this.surfaceTexture) {
      const texture = gl.createTexture()
      if (!texture) throw new Error("Unable to allocate transparent surface texture.")
      this.surfaceTexture = this.resources.trackTexture(texture)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.surfaceTexture)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    )

    if (!this.surfaceFramebuffer) {
      const framebuffer = gl.createFramebuffer()
      if (!framebuffer) throw new Error("Unable to allocate transparent surface framebuffer.")
      this.surfaceFramebuffer = this.resources.trackFramebuffer(framebuffer)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.surfaceFramebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.surfaceTexture,
      0,
    )
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("Spatial surface framebuffer is incomplete.")
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private drawEnvironmentBase(
    program: WebGLProgram,
    frame: EnvironmentBaseFrame,
    parallax: SpatialPoint,
  ): void {
    const { gl } = this.capabilities
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.uniform2f(
      gl.getUniformLocation(program, "u_effect_parallax"),
      parallax.x * SCENE_PARALLAX_WEIGHTS.background,
      parallax.y * SCENE_PARALLAX_WEIGHTS.background,
    )
    const canvas = this.capabilities.canvas
    const uvScale = frame.kind === "texture"
      ? computeEnvironmentCoverUvScale(frame.size, {
          width: canvas.width,
          height: canvas.height,
        })
      : { x: 0.94, y: 0.94 }
    gl.uniform2f(gl.getUniformLocation(program, "u_base_uv_scale"), uvScale.x, uvScale.y)
    gl.uniform1f(gl.getUniformLocation(program, "u_has_base_texture"), frame.kind === "texture" ? 1 : 0)
    if (frame.kind === "texture") {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, frame.texture)
      gl.uniform1i(gl.getUniformLocation(program, "u_base_texture"), 0)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawEnvironmentParticles(
    program: WebGLProgram,
    time: number,
    parallax: SpatialPoint,
  ): void {
    const { gl } = this.capabilities
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), time / 1000)
    gl.uniform2f(
      gl.getUniformLocation(program, "u_effect_parallax"),
      parallax.x,
      parallax.y,
    )
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawSource(program: WebGLProgram, input: {
    readonly rect: readonly [number, number, number, number]
    readonly parallax: SpatialPoint
    readonly texture: WebGLTexture
  }): void {
    const { gl } = this.capabilities
    gl.useProgram(program)
    this.prepareQuad(program, input.rect, {
      x: input.parallax.x * SCENE_PARALLAX_WEIGHTS.sources,
      y: input.parallax.y * SCENE_PARALLAX_WEIGHTS.sources,
    })
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, input.texture)
    gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawForeground(program: WebGLProgram, parallax: SpatialPoint): void {
    const { gl } = this.capabilities
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], {
      x: parallax.x * SCENE_PARALLAX_WEIGHTS.foreground,
      y: parallax.y * SCENE_PARALLAX_WEIGHTS.foreground,
    })
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawFinal(program: WebGLProgram, transitionStrength: number): void {
    const { gl } = this.capabilities
    if (!this.surfaceTexture) return
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.surfaceTexture)
    gl.uniform1i(gl.getUniformLocation(program, "u_scene"), 0)
    const uniforms = curveShaderUniforms(DEFAULT_CURVE_PROJECTION)
    gl.uniform1f(gl.getUniformLocation(program, "u_max_angle"), uniforms.maxAngleRadians)
    gl.uniform1f(gl.getUniformLocation(program, "u_min_center_scale"), uniforms.minCenterScale)
    gl.uniform1f(gl.getUniformLocation(program, "u_transition"), Math.max(0, transitionStrength))
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private prepareQuad(
    program: WebGLProgram,
    rect: readonly [number, number, number, number],
    parallax: SpatialPoint,
  ): void {
    const { gl } = this.capabilities
    if (!this.quadBuffer) throw new Error("Spatial quad buffer is unavailable.")
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer)
    gl.uniform4f(gl.getUniformLocation(program, "u_rect"), ...rect)
    gl.uniform2f(gl.getUniformLocation(program, "u_parallax"), parallax.x, parallax.y)
    const position = gl.getAttribLocation(program, "a_position")
    const uv = gl.getAttribLocation(program, "a_uv")
    if (position >= 0) {
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0)
    }
    if (uv >= 0) {
      gl.enableVertexAttribArray(uv)
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8)
    }
  }

  private configureStraightAlphaBlend(): void {
    const { gl } = this.capabilities
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    )
  }

  private cleanupFailedRestore(): void {
    this.elementTextures.releaseAfterRestoreFailure()
    this.resources.releaseAll()
    this.programs = null
    this.quadBuffer = null
    this.surfaceFramebuffer = null
    this.surfaceTexture = null
    this.suspended = true
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("Spatial renderer is disposed.")
    if (this.suspended) throw new Error("Spatial renderer is suspended after context loss.")
  }
}

export function parallaxTransformForRenderer(parallax: SpatialPoint): ParallaxTransform {
  return {
    offsetX: parallax.x * SCENE_PARALLAX_WEIGHTS.sources,
    offsetY: parallax.y * SCENE_PARALLAX_WEIGHTS.sources,
    scale: 1,
  }
}
