import type { HtmlInCanvasCapabilities } from "./capabilities"
import { ElementTextureRegistry, type TextureUploadBatch } from "./element-textures"
import {
  computeEnvironmentCoverUvScale,
  StaticProceduralEnvironmentBase,
  type EnvironmentBaseFrame,
  type EnvironmentBaseProvider,
} from "./environment-base"
import {
  computeEnvironmentTargetSize,
  DEFAULT_ENVIRONMENT_POST_PROCESSING,
  type EnvironmentPostProcessingOptions,
} from "./environment-effects"
import { createGlProgram, type ProgramFailure } from "./gl-program"
import { computeBackingStoreSize } from "./input/coordinates"
import type { SpatialMetrics } from "./metrics"
import {
  surfacePoseShaderUniforms,
  SURFACE_MESH_COLUMNS,
  SURFACE_MESH_ROWS,
  type SpatialPoint,
} from "./projection"
import { ContextResourceRegistry } from "./resources"
import {
  createWindowRippleParticleSeeds,
  stableSourceRippleSeed,
  windowRippleParticleCount,
} from "./source-ripple"
import {
  DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS,
  DEFAULT_WINDOW_RIPPLE_RENDER_OPTIONS,
  sourcePresentationIsAnimated,
  sourcePresentationIsRippleAnimated,
  type SpatialSourcePresentationSnapshot,
  type SpatialWindowPresentationRenderOptions,
  type SpatialWindowRippleRenderOptions,
} from "./source-presentation"
import {
  parallaxForSceneSource,
  SCENE_PARALLAX_WEIGHTS,
  sceneSourceForElement,
  type SceneSourceSurface,
} from "./scene"
import {
  ENVIRONMENT_BASE_FRAGMENT_SHADER,
  ENVIRONMENT_BLOOM_BLUR_FRAGMENT_SHADER,
  ENVIRONMENT_BLOOM_EXTRACT_FRAGMENT_SHADER,
  ENVIRONMENT_COMPOSITE_FRAGMENT_SHADER,
  ENVIRONMENT_DECORATION_FRAGMENT_SHADER,
  ENVIRONMENT_PARTICLE_FRAGMENT_SHADER,
} from "./shaders/environment"
import {
  FOREGROUND_FRAGMENT_SHADER,
  SCREEN_VERTEX_SHADER,
  SOURCE_FRAGMENT_SHADER,
  SOURCE_PRESENTATION_FRAGMENT_SHADER,
  SURFACE_PRESENTATION_VERTEX_SHADER,
  SURFACE_VERTEX_SHADER,
} from "./shaders/scene"
import {
  SOURCE_RIPPLE_MASK_FRAGMENT_SHADER,
  SOURCE_RIPPLE_PARTICLE_FRAGMENT_SHADER,
  SOURCE_RIPPLE_PARTICLE_VERTEX_SHADER,
} from "./shaders/source-ripple"

interface RendererPrograms {
  readonly environmentBase: WebGLProgram
  readonly environmentParticles: WebGLProgram
  readonly environmentBloomExtract: WebGLProgram | null
  readonly environmentBloomBlur: WebGLProgram | null
  readonly environmentComposite: WebGLProgram | null
  readonly environmentDecoration: WebGLProgram | null
  readonly source: WebGLProgram
  readonly sourcePresentation: WebGLProgram | null
  readonly sourceRippleMask: WebGLProgram | null
  readonly sourceRippleParticles: WebGLProgram | null
  readonly foreground: WebGLProgram
}

interface RenderableSurface {
  readonly scene: SceneSourceSurface
  readonly texture: WebGLTexture
}

interface EnvironmentColorTarget {
  readonly texture: WebGLTexture
  readonly framebuffer: WebGLFramebuffer
  readonly width: number
  readonly height: number
}

interface EnvironmentRenderTargets {
  readonly environment: EnvironmentColorTarget
  readonly bloomA: EnvironmentColorTarget
  readonly bloomB: EnvironmentColorTarget
}

type DrawableEnvironmentBaseFrame = Exclude<EnvironmentBaseFrame, { readonly kind: "image" }>

export interface SpatialRenderState {
  readonly time: number
  readonly parallax: SpatialPoint
  readonly transitionStrength: number
  readonly freezeParticles?: boolean
  readonly freezeEnvironmentEffects?: boolean
  readonly sourcePresentations?: readonly SpatialSourcePresentationSnapshot[]
}

export type SpatialRenderPass =
  | "environment-base"
  | "environment-particles"
  | "environment-bloom"
  | "environment-composite"
  | "environment-decoration"
  | "surface-windows"
  | "surface-shell"
  | "surface-foreground"

export interface SpatialRenderReport {
  readonly uploadBatch: TextureUploadBatch
  readonly passes: readonly SpatialRenderPass[]
}

export interface SpatialRendererOptions {
  readonly environmentBase?: EnvironmentBaseProvider
  readonly environmentEffects?: EnvironmentPostProcessingOptions
  readonly windowPresentation?: SpatialWindowPresentationRenderOptions
  readonly windowRipplePresentation?: SpatialWindowRippleRenderOptions
  readonly windowStyle?: SpatialWindowRenderStyle
}

export type SpatialWindowRenderStyle = "diagnostic" | "flat-neutral"

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

const SURFACE_VERTEX_COUNT = SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6
const MIN_SPATIAL_RASTER_SCALE = 2

function createSurfaceMesh(): Float32Array {
  const values: number[] = []
  const vertex = (x: number, y: number) => {
    values.push(x, y, (x + 1) / 2, (y + 1) / 2)
  }
  for (let row = 0; row < SURFACE_MESH_ROWS; row += 1) {
    const top = -1 + row * 2 / SURFACE_MESH_ROWS
    const bottom = -1 + (row + 1) * 2 / SURFACE_MESH_ROWS
    for (let column = 0; column < SURFACE_MESH_COLUMNS; column += 1) {
      const left = -1 + column * 2 / SURFACE_MESH_COLUMNS
      const right = -1 + (column + 1) * 2 / SURFACE_MESH_COLUMNS
      vertex(left, top)
      vertex(right, top)
      vertex(left, bottom)
      vertex(left, bottom)
      vertex(right, top)
      vertex(right, bottom)
    }
  }
  return new Float32Array(values)
}

export class SpatialRenderer {
  readonly elementTextures: ElementTextureRegistry
  private readonly resources: ContextResourceRegistry
  private readonly environmentBase: EnvironmentBaseProvider
  private readonly environmentEffects: EnvironmentPostProcessingOptions
  private readonly windowPresentation: SpatialWindowPresentationRenderOptions
  private readonly windowRipplePresentation: SpatialWindowRippleRenderOptions
  private readonly windowStyle: SpatialWindowRenderStyle
  private programs: RendererPrograms | null = null
  private quadBuffer: WebGLBuffer | null = null
  private surfaceBuffer: WebGLBuffer | null = null
  private rippleParticleBuffer: WebGLBuffer | null = null
  private rippleParticleCount = 0
  private environmentTargets: EnvironmentRenderTargets | null = null
  private environmentImageTexture: WebGLTexture | null = null
  private environmentImageVersion = -1
  private failedEnvironmentImageVersion = -1
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
    this.environmentEffects = options.environmentEffects ?? DEFAULT_ENVIRONMENT_POST_PROCESSING
    this.windowPresentation = options.windowPresentation
      ?? DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS
    this.windowRipplePresentation = options.windowRipplePresentation
      ?? DEFAULT_WINDOW_RIPPLE_RENDER_OPTIONS
    this.windowStyle = options.windowStyle ?? "diagnostic"
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

  supportsWindowPresentation(): boolean {
    return Boolean(this.windowPresentation.enabled && this.programs?.sourcePresentation)
  }

  supportsWindowRipplePresentation(): boolean {
    return Boolean(
      this.windowRipplePresentation.enabled
      && this.programs?.sourceRippleMask
      && this.programs.sourceRippleParticles
      && this.rippleParticleBuffer
      && this.rippleParticleCount > 0,
    )
  }

  resize(cssWidth: number, cssHeight: number, requestedDpr: number): void {
    this.assertAvailable()
    const size = computeBackingStoreSize(
      { width: cssWidth, height: cssHeight },
      Math.max(MIN_SPATIAL_RASTER_SCALE, requestedDpr),
      Math.max(1, this.capabilities.maxTextureSize),
    )
    if (size.width === 0 || size.height === 0) return
    const { canvas } = this.capabilities
    const backingSizeChanged = canvas.width !== size.width || canvas.height !== size.height
    if (backingSizeChanged) {
      canvas.width = size.width
      canvas.height = size.height
      this.elementTextures.markAllDirty()
    }
    this.effectiveRasterScale = size.effectiveDpr
    this.metrics.setRasterPolicy(requestedDpr, size.effectiveDpr)
    this.resizeEnvironmentTargets(cssWidth, cssHeight)
  }

  render(state: SpatialRenderState): SpatialRenderReport {
    this.assertAvailable()
    const { gl, canvas } = this.capabilities
    const programs = this.programs
    if (!programs || !this.quadBuffer || !this.surfaceBuffer) {
      throw new Error("Spatial renderer resources are not initialized.")
    }

    const uploadBatch = this.elementTextures.uploadDirty(this.effectiveRasterScale)
    const passes: SpatialRenderPass[] = []
    const canvasRect = canvas.getBoundingClientRect()
    const environmentFrame = this.drawableEnvironmentFrame(this.environmentBase.frame(state.time))
    const environmentTime = (state.freezeEnvironmentEffects ?? state.freezeParticles)
      ? 0
      : state.time
    const targets = this.environmentTargets
    const postProcessingReady = Boolean(
      targets
      && programs.environmentBloomExtract
      && programs.environmentBloomBlur
      && programs.environmentComposite,
    )
    if (postProcessingReady && targets
      && programs.environmentBloomExtract
      && programs.environmentBloomBlur
      && programs.environmentComposite) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.environment.framebuffer)
      gl.viewport(0, 0, targets.environment.width, targets.environment.height)
      gl.disable(gl.BLEND)
      if (environmentFrame.kind === "transparent") gl.clearColor(0, 0, 0, 0)
      else gl.clearColor(0.001, 0.004, 0.011, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (environmentFrame.kind !== "transparent") {
        this.drawEnvironmentBase(
          programs.environmentBase,
          environmentFrame,
          state.parallax,
          { width: targets.environment.width, height: targets.environment.height },
        )
      }
      passes.push("environment-base")

      this.configureStraightAlphaBlend()
      this.drawEnvironmentParticles(programs.environmentParticles, environmentTime, state.parallax)
      passes.push("environment-particles")
      this.drawEnvironmentBloom(
        programs.environmentBloomExtract,
        programs.environmentBloomBlur,
        targets,
      )
      passes.push("environment-bloom")

      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.disable(gl.BLEND)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.drawEnvironmentComposite(programs.environmentComposite, targets, canvasRect, environmentTime)
      passes.push("environment-composite")
    } else {
      // Optional post resources fail open to the direct environment path. An
      // image upload failure remains transparent so the CSS twin can show.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.disable(gl.BLEND)
      if (environmentFrame.kind === "transparent") gl.clearColor(0, 0, 0, 0)
      else gl.clearColor(0.001, 0.004, 0.011, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (environmentFrame.kind !== "transparent") {
        this.drawEnvironmentBase(
          programs.environmentBase,
          environmentFrame,
          state.parallax,
          { width: canvas.width, height: canvas.height },
        )
      }
      passes.push("environment-base")
      this.configureStraightAlphaBlend()
      this.drawEnvironmentParticles(programs.environmentParticles, environmentTime, state.parallax)
      passes.push("environment-particles")
    }

    if (this.environmentEffects.decorationEnabled && programs.environmentDecoration) {
      this.configureStraightAlphaBlend()
      this.drawEnvironmentDecoration(programs.environmentDecoration, canvasRect, environmentTime)
      passes.push("environment-decoration")
    }
    this.configureStraightAlphaBlend()

    const renderable = this.elementTextures.records()
      .flatMap((record, index): RenderableSurface[] => record.texture
        ? [{ scene: sceneSourceForElement(record.element, index), texture: record.texture }]
        : [])
      .sort((left, right) => left.scene.zIndex - right.scene.zIndex
        || left.scene.sourceId.localeCompare(right.scene.sourceId))
    const windows = renderable.filter((surface) => surface.scene.window)
    const shell = renderable.filter((surface) => !surface.scene.window)
    const sourcePresentations = new Map(
      (state.sourcePresentations ?? []).map((snapshot) => [snapshot.sourceId, snapshot]),
    )

    // Low-z clock and Dock Sources remain independent sharp meshes. Draw them
    // before windows so painter order matches their Source z contract.
    for (const surface of shell) {
      this.drawTexturedSurface(programs.source, surface, canvasRect, state)
    }
    passes.push("surface-shell")

    if (this.windowStyle === "diagnostic") {
      for (const surface of windows) {
        this.drawTexturedSurface(programs.source, surface, canvasRect, state)
      }
      passes.push("surface-windows")
    } else {
      for (const surface of windows) {
        const presentation = sourcePresentations.get(surface.scene.sourceId)
        // Capture gating is a lifecycle contract, not an animation-program
        // feature. Even the immediate fallback must wait for one valid Source
        // upload before drawing the stable window.
        if (presentation?.phase === "capturing-open"
          || presentation?.phase === "capturing-restore"
          || presentation?.phase === "minimized") {
          continue
        }
        const rippleDrawable = Boolean(
          presentation
          && sourcePresentationIsRippleAnimated(presentation)
          && this.supportsWindowRipplePresentation()
          && programs.sourceRippleMask
          && programs.sourceRippleParticles,
        )
        // A restore remains fully hidden, including its material silhouette,
        // until the texture-sampled reconstruction path can draw it.
        if (presentation?.phase === "restoring" && !rippleDrawable) continue
        if (presentation
          && rippleDrawable
          && programs.sourceRippleMask
          && programs.sourceRippleParticles) {
          this.drawRippleSurface(
            programs.sourceRippleMask,
            surface,
            canvasRect,
            state,
            presentation,
          )
          this.drawRippleParticles(
            programs.sourceRippleParticles,
            surface,
            canvasRect,
            state,
            presentation,
          )
          continue
        }
        // Capture-gated restore must never expose a stable Source merely
        // because the optional ripple resources became unavailable. The shell
        // will complete it immediately after the valid upload callback.
        if (presentation?.phase === "restoring") continue
        if (this.supportsWindowPresentation()
          && presentation
          && sourcePresentationIsAnimated(presentation)
          && programs.sourcePresentation) {
          this.drawPresentedSurface(
            programs.sourcePresentation,
            surface,
            canvasRect,
            state,
            presentation,
          )
        } else {
          this.drawTexturedSurface(programs.source, surface, canvasRect, state)
        }
      }
      passes.push("surface-windows")
    }

    this.drawForeground(programs.foreground, state.parallax)
    passes.push("surface-foreground")
    return { uploadBatch, passes }
  }

  handleContextLost(): void {
    if (this.disposed) return
    this.suspended = true
    this.resources.abandonForContextLoss()
    this.elementTextures.abandonForContextLoss()
    this.programs = null
    this.quadBuffer = null
    this.surfaceBuffer = null
    this.rippleParticleBuffer = null
    this.rippleParticleCount = 0
    this.environmentTargets = null
    this.environmentImageTexture = null
    this.environmentImageVersion = -1
    this.failedEnvironmentImageVersion = -1
  }

  restore(capabilities: HtmlInCanvasCapabilities, requestedDpr: number): RendererCreationResult {
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
    this.surfaceBuffer = null
    this.rippleParticleBuffer = null
    this.rippleParticleCount = 0
    this.environmentTargets = null
    this.environmentImageTexture = null
    this.environmentImageVersion = -1
    this.failedEnvironmentImageVersion = -1
    this.disposed = true
  }

  private initialize(): RendererCreationResult {
    const { gl } = this.capabilities
    const environmentBase = createGlProgram(gl, SCREEN_VERTEX_SHADER, ENVIRONMENT_BASE_FRAGMENT_SHADER)
    if (!environmentBase.ok) return { ok: false, failure: environmentBase }
    this.resources.trackProgram(environmentBase.program)
    const environmentParticles = createGlProgram(
      gl,
      SCREEN_VERTEX_SHADER,
      ENVIRONMENT_PARTICLE_FRAGMENT_SHADER,
    )
    if (!environmentParticles.ok) return { ok: false, failure: environmentParticles }
    this.resources.trackProgram(environmentParticles.program)
    const environmentEffects = this.initializeEnvironmentEffectPrograms()
    const source = createGlProgram(gl, SURFACE_VERTEX_SHADER, SOURCE_FRAGMENT_SHADER)
    if (!source.ok) return { ok: false, failure: source }
    this.resources.trackProgram(source.program)
    const sourcePresentation = this.initializeWindowPresentationProgram()
    let {
      sourceRippleMask,
      sourceRippleParticles,
    } = this.initializeWindowRipplePrograms()
    const foreground = createGlProgram(gl, SCREEN_VERTEX_SHADER, FOREGROUND_FRAGMENT_SHADER)
    if (!foreground.ok) return { ok: false, failure: foreground }
    this.resources.trackProgram(foreground.program)

    const quadBuffer = gl.createBuffer()
    const surfaceBuffer = gl.createBuffer()
    if (!quadBuffer || !surfaceBuffer) {
      if (quadBuffer) gl.deleteBuffer(quadBuffer)
      if (surfaceBuffer) gl.deleteBuffer(surfaceBuffer)
      return { ok: false, failure: { stage: "resource", message: "Unable to allocate Spatial mesh buffers." } }
    }
    this.quadBuffer = this.resources.trackBuffer(quadBuffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW)
    this.surfaceBuffer = this.resources.trackBuffer(surfaceBuffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, surfaceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, createSurfaceMesh(), gl.STATIC_DRAW)
    if (sourceRippleMask && sourceRippleParticles) {
      const particleBuffer = gl.createBuffer()
      if (!particleBuffer) {
        this.resources.releaseProgram(sourceRippleMask)
        this.resources.releaseProgram(sourceRippleParticles)
        sourceRippleMask = null
        sourceRippleParticles = null
        this.metrics.recordFailure("Window particle ripple disabled: unable to allocate the shared seed buffer.")
      } else {
        try {
          this.rippleParticleBuffer = this.resources.trackBuffer(particleBuffer)
          this.rippleParticleCount = windowRippleParticleCount(this.windowRipplePresentation)
          gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer)
          gl.bufferData(
            gl.ARRAY_BUFFER,
            createWindowRippleParticleSeeds(this.windowRipplePresentation),
            gl.STATIC_DRAW,
          )
        } catch (error) {
          this.resources.releaseBuffer(particleBuffer)
          this.resources.releaseProgram(sourceRippleMask)
          this.resources.releaseProgram(sourceRippleParticles)
          sourceRippleMask = null
          sourceRippleParticles = null
          this.rippleParticleBuffer = null
          this.rippleParticleCount = 0
          this.metrics.recordFailure(
            `Window particle ripple disabled: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
    this.programs = {
      environmentBase: environmentBase.program,
      environmentParticles: environmentParticles.program,
      ...environmentEffects,
      source: source.program,
      sourcePresentation,
      sourceRippleMask,
      sourceRippleParticles,
      foreground: foreground.program,
    }
    return { ok: true, renderer: this }
  }

  private initializeWindowPresentationProgram(): WebGLProgram | null {
    if (!this.windowPresentation.enabled) return null
    const { gl } = this.capabilities
    try {
      const result = createGlProgram(
        gl,
        SURFACE_PRESENTATION_VERTEX_SHADER,
        SOURCE_PRESENTATION_FRAGMENT_SHADER,
      )
      if (result.ok) return this.resources.trackProgram(result.program)
      this.metrics.recordFailure(`Window presentation disabled: ${result.message}`)
    } catch (error) {
      this.metrics.recordFailure(
        `Window presentation disabled: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return null
  }

  private initializeWindowRipplePrograms(): Pick<
    RendererPrograms,
    "sourceRippleMask" | "sourceRippleParticles"
  > {
    if (!this.windowRipplePresentation.enabled) {
      return { sourceRippleMask: null, sourceRippleParticles: null }
    }
    const { gl } = this.capabilities
    try {
      const mask = createGlProgram(gl, SURFACE_VERTEX_SHADER, SOURCE_RIPPLE_MASK_FRAGMENT_SHADER)
      const particles = createGlProgram(
        gl,
        SOURCE_RIPPLE_PARTICLE_VERTEX_SHADER,
        SOURCE_RIPPLE_PARTICLE_FRAGMENT_SHADER,
      )
      if (mask.ok && particles.ok) {
        return {
          sourceRippleMask: this.resources.trackProgram(mask.program),
          sourceRippleParticles: this.resources.trackProgram(particles.program),
        }
      }
      if (mask.ok) gl.deleteProgram(mask.program)
      if (particles.ok) gl.deleteProgram(particles.program)
      const message = !mask.ok
        ? mask.message
        : !particles.ok
          ? particles.message
          : "program initialization failed"
      this.metrics.recordFailure(`Window particle ripple disabled: ${message}`)
    } catch (error) {
      this.metrics.recordFailure(
        `Window particle ripple disabled: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return { sourceRippleMask: null, sourceRippleParticles: null }
  }

  private initializeEnvironmentEffectPrograms(): Pick<
    RendererPrograms,
    | "environmentBloomExtract"
    | "environmentBloomBlur"
    | "environmentComposite"
    | "environmentDecoration"
  > {
    const { gl } = this.capabilities
    let environmentBloomExtract: WebGLProgram | null = null
    let environmentBloomBlur: WebGLProgram | null = null
    let environmentComposite: WebGLProgram | null = null
    let environmentDecoration: WebGLProgram | null = null

    if (this.environmentEffects.enabled) {
      const extract = createGlProgram(gl, SCREEN_VERTEX_SHADER, ENVIRONMENT_BLOOM_EXTRACT_FRAGMENT_SHADER)
      const blur = createGlProgram(gl, SCREEN_VERTEX_SHADER, ENVIRONMENT_BLOOM_BLUR_FRAGMENT_SHADER)
      const composite = createGlProgram(gl, SCREEN_VERTEX_SHADER, ENVIRONMENT_COMPOSITE_FRAGMENT_SHADER)
      if (extract.ok && blur.ok && composite.ok) {
        environmentBloomExtract = this.resources.trackProgram(extract.program)
        environmentBloomBlur = this.resources.trackProgram(blur.program)
        environmentComposite = this.resources.trackProgram(composite.program)
      } else {
        if (extract.ok) gl.deleteProgram(extract.program)
        if (blur.ok) gl.deleteProgram(blur.program)
        if (composite.ok) gl.deleteProgram(composite.program)
        const failureMessage = !extract.ok
          ? extract.message
          : !blur.ok
            ? blur.message
            : !composite.ok
              ? composite.message
              : "program initialization failed"
        this.metrics.recordFailure(`Environment post-processing disabled: ${failureMessage}`)
      }
    }

    if (this.environmentEffects.decorationEnabled) {
      const decoration = createGlProgram(
        gl,
        SCREEN_VERTEX_SHADER,
        ENVIRONMENT_DECORATION_FRAGMENT_SHADER,
      )
      if (decoration.ok) {
        environmentDecoration = this.resources.trackProgram(decoration.program)
      } else {
        this.metrics.recordFailure(`Environment decoration disabled: ${decoration.message}`)
      }
    }

    return {
      environmentBloomExtract,
      environmentBloomBlur,
      environmentComposite,
      environmentDecoration,
    }
  }

  private drawableEnvironmentFrame(frame: EnvironmentBaseFrame): DrawableEnvironmentBaseFrame {
    if (frame.kind !== "image") return frame
    if (this.failedEnvironmentImageVersion === frame.version) return { kind: "transparent" }
    const { gl } = this.capabilities
    try {
      if (!this.environmentImageTexture) {
        const texture = gl.createTexture()
        if (!texture) throw new Error("Unable to allocate the environment image texture.")
        this.environmentImageTexture = this.resources.trackTexture(texture)
        this.environmentImageVersion = -1
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      }
      if (this.environmentImageVersion !== frame.version) {
        gl.bindTexture(gl.TEXTURE_2D, this.environmentImageTexture)
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA8,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          frame.source,
        )
        this.environmentImageVersion = frame.version
        this.failedEnvironmentImageVersion = -1
      }
      return {
        kind: "texture",
        texture: this.environmentImageTexture,
        size: frame.size,
        coverOverscan: frame.coverOverscan,
        flipY: true,
      }
    } catch (error) {
      if (this.environmentImageTexture) {
        this.resources.releaseTexture(this.environmentImageTexture)
      }
      this.environmentImageTexture = null
      this.environmentImageVersion = -1
      this.failedEnvironmentImageVersion = frame.version
      this.metrics.recordFailure(
        `Environment image upload failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return { kind: "transparent" }
    }
  }

  private resizeEnvironmentTargets(cssWidth: number, cssHeight: number): void {
    const programs = this.programs
    if (!this.environmentEffects.enabled
      || !programs?.environmentBloomExtract
      || !programs.environmentBloomBlur
      || !programs.environmentComposite) {
      this.releaseEnvironmentTargets()
      return
    }
    const targetSize = computeEnvironmentTargetSize(
      cssWidth,
      cssHeight,
      this.capabilities.maxTextureSize,
      this.environmentEffects,
    )
    const current = this.environmentTargets
    if (current
      && current.environment.width === targetSize.width
      && current.environment.height === targetSize.height
      && current.bloomA.width === targetSize.bloomWidth
      && current.bloomA.height === targetSize.bloomHeight) return

    this.releaseEnvironmentTargets()
    const allocated: EnvironmentColorTarget[] = []
    try {
      const environment = this.createEnvironmentColorTarget(targetSize.width, targetSize.height)
      allocated.push(environment)
      const bloomA = this.createEnvironmentColorTarget(targetSize.bloomWidth, targetSize.bloomHeight)
      allocated.push(bloomA)
      const bloomB = this.createEnvironmentColorTarget(targetSize.bloomWidth, targetSize.bloomHeight)
      allocated.push(bloomB)
      this.environmentTargets = {
        environment,
        bloomA,
        bloomB,
      }
    } catch (error) {
      for (const target of allocated) {
        this.resources.releaseFramebuffer(target.framebuffer)
        this.resources.releaseTexture(target.texture)
      }
      this.metrics.recordFailure(
        `Environment render targets disabled: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      this.capabilities.gl.bindFramebuffer(this.capabilities.gl.FRAMEBUFFER, null)
    }
  }

  private createEnvironmentColorTarget(width: number, height: number): EnvironmentColorTarget {
    const { gl } = this.capabilities
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) {
      if (texture) gl.deleteTexture(texture)
      if (framebuffer) gl.deleteFramebuffer(framebuffer)
      throw new Error("Unable to allocate an environment color target.")
    }
    try {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      )
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Incomplete environment framebuffer (${width}×${height}).`)
      }
    } catch (error) {
      gl.deleteFramebuffer(framebuffer)
      gl.deleteTexture(texture)
      throw error
    }
    return {
      texture: this.resources.trackTexture(texture),
      framebuffer: this.resources.trackFramebuffer(framebuffer),
      width,
      height,
    }
  }

  private releaseEnvironmentTargets(): void {
    const targets = this.environmentTargets
    if (!targets) return
    for (const target of [targets.environment, targets.bloomA, targets.bloomB]) {
      this.resources.releaseFramebuffer(target.framebuffer)
      this.resources.releaseTexture(target.texture)
    }
    this.environmentTargets = null
  }

  private drawEnvironmentBloom(
    extractProgram: WebGLProgram,
    blurProgram: WebGLProgram,
    targets: EnvironmentRenderTargets,
  ): void {
    const { gl } = this.capabilities
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bloomA.framebuffer)
    gl.viewport(0, 0, targets.bloomA.width, targets.bloomA.height)
    gl.useProgram(extractProgram)
    this.prepareQuad(extractProgram, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, targets.environment.texture)
    gl.uniform1i(gl.getUniformLocation(extractProgram, "u_environment_texture"), 0)
    gl.uniform1f(
      gl.getUniformLocation(extractProgram, "u_threshold"),
      this.environmentEffects.bloomThreshold,
    )
    gl.uniform1f(
      gl.getUniformLocation(extractProgram, "u_soft_knee"),
      this.environmentEffects.bloomSoftKnee,
    )
    gl.drawArrays(gl.TRIANGLES, 0, 6)

    this.drawBloomBlurPass(
      blurProgram,
      targets.bloomA.texture,
      targets.bloomB,
      { x: this.environmentEffects.bloomRadius / targets.bloomA.width, y: 0 },
    )
    this.drawBloomBlurPass(
      blurProgram,
      targets.bloomB.texture,
      targets.bloomA,
      { x: 0, y: this.environmentEffects.bloomRadius / targets.bloomA.height },
    )
  }

  private drawBloomBlurPass(
    program: WebGLProgram,
    sourceTexture: WebGLTexture,
    target: EnvironmentColorTarget,
    direction: SpatialPoint,
  ): void {
    const { gl } = this.capabilities
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
    gl.viewport(0, 0, target.width, target.height)
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, sourceTexture)
    gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0)
    gl.uniform2f(gl.getUniformLocation(program, "u_texel_direction"), direction.x, direction.y)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawEnvironmentComposite(
    program: WebGLProgram,
    targets: EnvironmentRenderTargets,
    viewport: DOMRect,
    time: number,
  ): void {
    const { gl } = this.capabilities
    const effects = this.environmentEffects
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, targets.environment.texture)
    gl.uniform1i(gl.getUniformLocation(program, "u_environment_texture"), 0)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, targets.bloomA.texture)
    gl.uniform1i(gl.getUniformLocation(program, "u_bloom_texture"), 1)
    gl.uniform2f(gl.getUniformLocation(program, "u_viewport_size"), viewport.width, viewport.height)
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), time / 1000)
    gl.uniform1f(
      gl.getUniformLocation(program, "u_chromatic_separation_px"),
      effects.chromaticSeparationPx,
    )
    gl.uniform1f(gl.getUniformLocation(program, "u_bloom_strength"), effects.bloomStrength)
    gl.uniform1f(gl.getUniformLocation(program, "u_vignette_strength"), effects.vignetteStrength)
    gl.uniform1f(gl.getUniformLocation(program, "u_grain_strength"), effects.grainStrength)
    gl.uniform1f(
      gl.getUniformLocation(program, "u_refraction_strength_px"),
      effects.atmosphericRefraction.strengthPx,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_refraction_frequency"),
      effects.atmosphericRefraction.frequency,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_refraction_speed"),
      effects.atmosphericRefraction.speed,
    )
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawEnvironmentDecoration(program: WebGLProgram, viewport: DOMRect, time: number): void {
    const { gl } = this.capabilities
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.uniform2f(gl.getUniformLocation(program, "u_viewport_size"), viewport.width, viewport.height)
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), time / 1000)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawEnvironmentBase(
    program: WebGLProgram,
    frame: Exclude<DrawableEnvironmentBaseFrame, { readonly kind: "transparent" }>,
    parallax: SpatialPoint,
    viewportSize: { readonly width: number; readonly height: number },
  ): void {
    const { gl } = this.capabilities
    gl.useProgram(program)
    this.prepareQuad(program, [-1, -1, 1, 1], { x: 0, y: 0 })
    gl.uniform2f(
      gl.getUniformLocation(program, "u_effect_parallax"),
      parallax.x * SCENE_PARALLAX_WEIGHTS.background,
      parallax.y * SCENE_PARALLAX_WEIGHTS.background,
    )
    const uvScale = frame.kind === "texture"
      ? computeEnvironmentCoverUvScale(
          frame.size,
          viewportSize,
          frame.coverOverscan ?? 0.94,
        )
      : { x: 0.94, y: 0.94 }
    gl.uniform2f(gl.getUniformLocation(program, "u_base_uv_scale"), uvScale.x, uvScale.y)
    gl.uniform1f(gl.getUniformLocation(program, "u_has_base_texture"), frame.kind === "texture" ? 1 : 0)
    gl.uniform1f(
      gl.getUniformLocation(program, "u_flip_base_y"),
      frame.kind === "texture" && frame.flipY ? 1 : 0,
    )
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
    gl.uniform2f(gl.getUniformLocation(program, "u_effect_parallax"), parallax.x, parallax.y)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private drawTexturedSurface(
    program: WebGLProgram,
    surface: RenderableSurface,
    canvasRect: DOMRect,
    state: SpatialRenderState,
  ): void {
    const { gl } = this.capabilities
    this.drawSurface(program, surface.scene, canvasRect, state.parallax, () => {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, surface.texture)
      gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0)
      gl.uniform1f(
        gl.getUniformLocation(program, "u_depth_tint"),
        Math.max(0, Math.min(1, surface.scene.pose.depth / 72)),
      )
      gl.uniform1f(gl.getUniformLocation(program, "u_active"), surface.scene.active ? 1 : 0)
      gl.uniform1f(gl.getUniformLocation(program, "u_transition"), Math.max(0, state.transitionStrength))
      gl.uniform1f(
        gl.getUniformLocation(program, "u_neutral_source"),
        this.windowStyle === "flat-neutral" ? 1 : 0,
      )
    })
  }

  private drawPresentedSurface(
    program: WebGLProgram,
    surface: RenderableSurface,
    canvasRect: DOMRect,
    state: SpatialRenderState,
    presentation: SpatialSourcePresentationSnapshot,
  ): void {
    const { gl } = this.capabilities
    this.drawSurface(program, surface.scene, canvasRect, state.parallax, () => {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, surface.texture)
      gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0)
      gl.uniform2f(
        gl.getUniformLocation(program, "u_source_size"),
        surface.scene.rect.width,
        surface.scene.rect.height,
      )
      this.applyApertureUniforms(program, presentation)
      gl.uniform1f(
        gl.getUniformLocation(program, "u_presentation_edge_energy"),
        this.windowPresentation.edgeEnergy,
      )
      gl.uniform1f(
        gl.getUniformLocation(program, "u_presentation_chromatic_px"),
        this.windowPresentation.chromaticSeparationPx,
      )
    })
  }

  private applyApertureUniforms(
    program: WebGLProgram,
    presentation: SpatialSourcePresentationSnapshot,
  ): void {
    const { gl } = this.capabilities
    const options = this.windowPresentation
    gl.uniform1f(
      gl.getUniformLocation(program, "u_presentation_progress"),
      presentation.progress,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_presentation_direction"),
      presentation.phase === "closing" ? 1 : -1,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_presentation_aperture_scale"),
      options.apertureScale,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_presentation_curve_depth_energy"),
      options.curveDepthEnergy,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_presentation_depth_energy"),
      options.depthEnergy,
    )
  }

  private drawRippleSurface(
    program: WebGLProgram,
    surface: RenderableSurface,
    canvasRect: DOMRect,
    state: SpatialRenderState,
    presentation: SpatialSourcePresentationSnapshot,
  ): void {
    const { gl } = this.capabilities
    this.drawSurface(program, surface.scene, canvasRect, state.parallax, () => {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, surface.texture)
      gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0)
      this.applyRippleUniforms(program, surface, presentation)
    })
  }

  private drawRippleParticles(
    program: WebGLProgram,
    surface: RenderableSurface,
    canvasRect: DOMRect,
    state: SpatialRenderState,
    presentation: SpatialSourcePresentationSnapshot,
  ): void {
    const { gl } = this.capabilities
    const particleBuffer = this.rippleParticleBuffer
    if (!particleBuffer || this.rippleParticleCount <= 0) return
    const options = this.windowRipplePresentation
    gl.useProgram(program)
    this.applySurfaceUniforms(
      program,
      surface.scene,
      canvasRect,
      state.parallax,
    )
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer)
    const seedUv = gl.getAttribLocation(program, "a_seed_uv")
    const seed = gl.getAttribLocation(program, "a_seed")
    if (seedUv >= 0) {
      gl.enableVertexAttribArray(seedUv)
      gl.vertexAttribPointer(seedUv, 2, gl.FLOAT, false, 12, 0)
    }
    if (seed >= 0) {
      gl.enableVertexAttribArray(seed)
      gl.vertexAttribPointer(seed, 1, gl.FLOAT, false, 12, 8)
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, surface.texture)
    gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0)
    this.applyRippleUniforms(program, surface, presentation)
    gl.uniform1f(gl.getUniformLocation(program, "u_ripple_trail_width"), options.trailWidth)
    gl.uniform1f(gl.getUniformLocation(program, "u_ripple_travel_px"), options.travelPx)
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_tangential_px"),
      options.tangentialTravelPx,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_depth_travel"),
      options.depthTravel,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_point_size_px"),
      options.pointSizePx,
    )
    gl.uniform1f(gl.getUniformLocation(program, "u_raster_scale"), this.effectiveRasterScale)
    gl.uniform1f(
      gl.getUniformLocation(program, "u_source_seed"),
      stableSourceRippleSeed(surface.scene.sourceId),
    )
    gl.drawArrays(gl.POINTS, 0, this.rippleParticleCount)
  }

  private applyRippleUniforms(
    program: WebGLProgram,
    surface: RenderableSurface,
    presentation: SpatialSourcePresentationSnapshot,
  ): void {
    const { gl } = this.capabilities
    const options = this.windowRipplePresentation
    const origin = presentation.originUv ?? { x: 0.5, y: 0.5 }
    gl.uniform2f(
      gl.getUniformLocation(program, "u_source_size"),
      surface.scene.rect.width,
      surface.scene.rect.height,
    )
    gl.uniform2f(gl.getUniformLocation(program, "u_ripple_origin"), origin.x, origin.y)
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_progress"),
      Math.max(0, Math.min(1, presentation.progress)),
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_direction"),
      presentation.phase === "minimizing" ? 1 : -1,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_wave_softness"),
      options.waveSoftness,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_edge_energy"),
      options.edgeEnergy,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_ripple_chromatic_px"),
      options.chromaticSeparationPx,
    )
  }

  private drawSurface(
    program: WebGLProgram,
    surface: SceneSourceSurface,
    canvasRect: DOMRect,
    parallax: SpatialPoint,
    beforeDraw?: () => void,
  ): void {
    const { gl } = this.capabilities
    if (!this.surfaceBuffer) throw new Error("Spatial surface mesh is unavailable.")
    gl.useProgram(program)
    this.applySurfaceUniforms(
      program,
      surface,
      canvasRect,
      parallax,
    )
    gl.bindBuffer(gl.ARRAY_BUFFER, this.surfaceBuffer)
    const local = gl.getAttribLocation(program, "a_local")
    const uv = gl.getAttribLocation(program, "a_uv")
    if (local >= 0) {
      gl.enableVertexAttribArray(local)
      gl.vertexAttribPointer(local, 2, gl.FLOAT, false, 16, 0)
    }
    if (uv >= 0) {
      gl.enableVertexAttribArray(uv)
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8)
    }
    beforeDraw?.()
    gl.drawArrays(gl.TRIANGLES, 0, SURFACE_VERTEX_COUNT)
  }

  private applySurfaceUniforms(
    program: WebGLProgram,
    surface: SceneSourceSurface,
    canvasRect: DOMRect,
    parallax: SpatialPoint,
  ): void {
    const { gl } = this.capabilities
    const uniforms = surfacePoseShaderUniforms(surface.pose, canvasRect)
    gl.uniform4f(
      gl.getUniformLocation(program, "u_source_rect"),
      surface.rect.left - canvasRect.left,
      surface.rect.top - canvasRect.top,
      surface.rect.width,
      surface.rect.height,
    )
    gl.uniform2f(gl.getUniformLocation(program, "u_viewport_size"), canvasRect.width, canvasRect.height)
    gl.uniform4f(
      gl.getUniformLocation(program, "u_pose"),
      uniforms.depth,
      uniforms.yaw,
      uniforms.pitch,
      uniforms.scale,
    )
    gl.uniform1f(
      gl.getUniformLocation(program, "u_curve_half_angle"),
      uniforms.curveHalfAngle,
    )
    gl.uniform1f(gl.getUniformLocation(program, "u_focal_length"), uniforms.focalLength)
    const sourceParallax = parallaxForSceneSource(surface, parallax)
    gl.uniform2f(
      gl.getUniformLocation(program, "u_parallax"),
      sourceParallax.x,
      sourceParallax.y,
    )
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
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  }

  private cleanupFailedRestore(): void {
    this.elementTextures.releaseAfterRestoreFailure()
    this.resources.releaseAll()
    this.programs = null
    this.quadBuffer = null
    this.surfaceBuffer = null
    this.rippleParticleBuffer = null
    this.rippleParticleCount = 0
    this.environmentTargets = null
    this.environmentImageTexture = null
    this.environmentImageVersion = -1
    this.failedEnvironmentImageVersion = -1
    this.suspended = true
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error("Spatial renderer is disposed.")
    if (this.suspended) throw new Error("Spatial renderer is suspended after context loss.")
  }
}
