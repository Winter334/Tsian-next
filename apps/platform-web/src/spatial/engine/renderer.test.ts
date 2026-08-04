import { describe, expect, it } from "vitest"
import type { HtmlInCanvasCapabilities } from "./capabilities"
import { TransparentEnvironmentBase } from "./environment-base"
import { DEFAULT_ENVIRONMENT_POST_PROCESSING } from "./environment-effects"
import { SpatialMetrics } from "./metrics"
import { SURFACE_MESH_COLUMNS, SURFACE_MESH_ROWS } from "./projection"
import { SpatialRenderer } from "./renderer"
import { DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS } from "./source-presentation"

function createGlHarness(options: {
  readonly failBufferAt?: number
  readonly failProgramAt?: number
} = {}) {
  let nextResourceId = 0
  let createdTextures = 0
  let createdFramebuffers = 0
  let bufferCreateCount = 0
  let programCreateCount = 0
  let deletedBuffers = 0
  const framebufferBinds: Array<WebGLFramebuffer | null> = []
  const bufferUploads: ArrayBufferView[] = []
  const drawCounts: number[] = []
  const clearColors: Array<readonly [number, number, number, number]> = []
  const blendCalls: Array<readonly [number, number, number, number]> = []
  const uniform1fCalls: Array<readonly [string, number]> = []
  const resource = () => ({ id: ++nextResourceId })
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    TEXTURE_2D: 7,
    TEXTURE_MIN_FILTER: 8,
    TEXTURE_MAG_FILTER: 9,
    TEXTURE_WRAP_S: 10,
    TEXTURE_WRAP_T: 11,
    LINEAR: 12,
    CLAMP_TO_EDGE: 13,
    RGBA: 14,
    UNSIGNED_BYTE: 15,
    FRAMEBUFFER: 16,
    COLOR_ATTACHMENT0: 17,
    FRAMEBUFFER_COMPLETE: 18,
    COLOR_BUFFER_BIT: 19,
    BLEND: 20,
    SRC_ALPHA: 21,
    ONE_MINUS_SRC_ALPHA: 22,
    TRIANGLES: 23,
    FLOAT: 24,
    TEXTURE0: 25,
    TEXTURE1: 28,
    RGBA8: 26,
    ONE: 27,
    createShader: resource,
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: () => undefined,
    createProgram: () => {
      programCreateCount += 1
      return {
        ...resource(),
        linked: programCreateCount !== options.failProgramAt,
      }
    },
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: (program: { linked?: boolean }) => program.linked !== false,
    getProgramInfoLog: () => "forced program link failure",
    detachShader: () => undefined,
    deleteProgram: () => undefined,
    createBuffer: () => {
      bufferCreateCount += 1
      return bufferCreateCount === options.failBufferAt ? null : resource()
    },
    bindBuffer: () => undefined,
    bufferData: (_target: number, data: ArrayBufferView) => bufferUploads.push(data),
    deleteBuffer: () => { deletedBuffers += 1 },
    createTexture: () => {
      createdTextures += 1
      return resource()
    },
    bindTexture: () => undefined,
    texParameteri: () => undefined,
    texImage2D: () => undefined,
    deleteTexture: () => undefined,
    createFramebuffer: () => {
      createdFramebuffers += 1
      return resource()
    },
    bindFramebuffer: (_target: number, framebuffer: WebGLFramebuffer | null) => {
      framebufferBinds.push(framebuffer)
    },
    framebufferTexture2D: () => undefined,
    checkFramebufferStatus: () => 18,
    deleteFramebuffer: () => undefined,
    viewport: () => undefined,
    clearColor: (red: number, green: number, blue: number, alpha: number) => {
      clearColors.push([red, green, blue, alpha])
    },
    clear: () => undefined,
    enable: () => undefined,
    blendFuncSeparate: (
      sourceRgb: number,
      destinationRgb: number,
      sourceAlpha: number,
      destinationAlpha: number,
    ) => blendCalls.push([sourceRgb, destinationRgb, sourceAlpha, destinationAlpha]),
    disable: () => undefined,
    useProgram: () => undefined,
    getUniformLocation: (_program: WebGLProgram, name: string) => ({ ...resource(), name }),
    uniform4f: () => undefined,
    uniform2f: () => undefined,
    uniform1f: (location: { name?: string } | null, value: number) => {
      uniform1fCalls.push([location?.name ?? "unknown", value])
    },
    uniform1i: () => undefined,
    activeTexture: () => undefined,
    drawArrays: (_mode: number, _first: number, count: number) => drawCounts.push(count),
    getAttribLocation: (_program: WebGLProgram, name: string) => name === "a_position" || name === "a_local" ? 0 : 1,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
  } as unknown as WebGL2RenderingContext
  return {
    gl,
    framebufferBinds,
    bufferUploads,
    drawCounts,
    clearColors,
    blendCalls,
    uniform1fCalls,
    createdTextures: () => createdTextures,
    createdFramebuffers: () => createdFramebuffers,
    deletedBuffers: () => deletedBuffers,
  }
}

function createCapabilities(
  canvas: HTMLCanvasElement,
  gl: WebGL2RenderingContext,
): HtmlInCanvasCapabilities {
  return {
    canvas,
    gl,
    apiVariant: "current",
    contextVariant: "webgl2",
    maxTextureSize: 4096,
    requestPaint: () => undefined,
    setPaintHandler: () => () => undefined,
    uploadElement: () => undefined,
  }
}

function createCanvas(): HTMLCanvasElement {
  return {
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  } as unknown as HTMLCanvasElement
}

function createSource(
  canvas: HTMLCanvasElement,
  attributes: Readonly<Record<string, string>>,
): Element {
  return {
    isConnected: true,
    parentElement: canvas,
    ownerDocument: { defaultView: null },
    getBoundingClientRect: () => ({ left: 120, top: 90, width: 480, height: 360 }),
    getAttribute: (name: string) => attributes[name] ?? null,
  } as unknown as Element
}

function registerCompositionSources(renderer: SpatialRenderer, canvas: HTMLCanvasElement): void {
  renderer.elementTextures.register(createSource(canvas, {
    "data-spatial-source": "window:active",
    "data-spatial-window-active": "true",
    "data-spatial-z": "101",
    "data-spatial-scale": "1",
  }))
  renderer.elementTextures.register(createSource(canvas, {
    "data-spatial-source": "shell:launcher",
    "data-spatial-z": "10",
    "data-spatial-scale": "1",
  }))
}

describe("SpatialRenderer", () => {
  it("releases a partially allocated mesh buffer when initialization fails", () => {
    const harness = createGlHarness({ failBufferAt: 2 })
    const created = SpatialRenderer.create(
      createCapabilities(createCanvas(), harness.gl),
      new SpatialMetrics(),
    )

    expect(created.ok).toBe(false)
    expect(harness.deletedBuffers()).toBe(1)
  })

  it("draws directly to the default framebuffer with no global composite target", () => {
    const canvas = createCanvas()
    const harness = createGlHarness()
    const created = SpatialRenderer.create(createCapabilities(canvas, harness.gl), new SpatialMetrics())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    created.renderer.resize(800, 600, 1)
    harness.framebufferBinds.length = 0

    const report = created.renderer.render({
      time: 1000,
      parallax: { x: 0.02, y: -0.01 },
      transitionStrength: 0,
    })

    expect(report.passes).toEqual([
      "environment-base",
      "environment-particles",
      "surface-shell",
      "surface-windows",
      "surface-foreground",
    ])
    expect(harness.framebufferBinds).toEqual([null])
    expect(harness.createdFramebuffers()).toBe(0)
    expect(harness.createdTextures()).toBe(0)
  })

  it("allocates a reusable horizontally tessellated Source mesh", () => {
    const harness = createGlHarness()
    const created = SpatialRenderer.create(
      createCapabilities(createCanvas(), harness.gl),
      new SpatialMetrics(),
    )
    expect(created.ok).toBe(true)
    expect(harness.bufferUploads.map((data) => data.byteLength / Float32Array.BYTES_PER_ELEMENT))
      .toEqual([24, SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6 * 4])
    const mesh = harness.bufferUploads[1] as Float32Array
    expect(Array.from(mesh.slice(0, 4))).toEqual([-1, -1, 0, 0])
    expect(mesh[8]).toBe(-1)
    expect(mesh[9]).toBeCloseTo(-1 + 2 / SURFACE_MESH_ROWS, 6)
    expect(mesh[10]).toBe(0)
    expect(mesh[11]).toBeCloseTo(1 / SURFACE_MESH_ROWS, 6)
    expect(Array.from(mesh.slice(-4))).toEqual([1, 1, 1, 1])
  })

  it("owns one bounded environment target and one reusable Bloom pair", () => {
    const canvas = createCanvas()
    const harness = createGlHarness()
    const created = SpatialRenderer.create(
      createCapabilities(canvas, harness.gl),
      new SpatialMetrics(),
      {
        environmentEffects: {
          ...DEFAULT_ENVIRONMENT_POST_PROCESSING,
          enabled: true,
          decorationEnabled: true,
        },
      },
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return

    created.renderer.resize(2560, 1440, 2)
    expect(harness.createdFramebuffers()).toBe(3)
    expect(harness.createdTextures()).toBe(3)
    const report = created.renderer.render({
      time: 1_000,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
    })
    expect(report.passes.slice(0, 5)).toEqual([
      "environment-base",
      "environment-particles",
      "environment-bloom",
      "environment-composite",
      "environment-decoration",
    ])
    expect(harness.framebufferBinds.some((framebuffer) => framebuffer !== null)).toBe(true)

    created.renderer.handleContextLost()
    const restoredHarness = createGlHarness()
    const restored = created.renderer.restore(createCapabilities(canvas, restoredHarness.gl), 2)
    expect(restored.ok).toBe(true)
    expect(restoredHarness.createdFramebuffers()).toBe(3)
    expect(restoredHarness.createdTextures()).toBe(3)
  })

  it("leaves the framebuffer transparent only for an explicitly transparent environment", () => {
    const defaultCanvas = createCanvas()
    const defaultHarness = createGlHarness()
    const defaultCreated = SpatialRenderer.create(
      createCapabilities(defaultCanvas, defaultHarness.gl),
      new SpatialMetrics(),
    )
    expect(defaultCreated.ok).toBe(true)
    if (!defaultCreated.ok) return
    registerCompositionSources(defaultCreated.renderer, defaultCanvas)
    defaultCreated.renderer.render({
      time: 0,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
    })

    const transparentCanvas = createCanvas()
    const transparentHarness = createGlHarness()
    const transparentCreated = SpatialRenderer.create(
      createCapabilities(transparentCanvas, transparentHarness.gl),
      new SpatialMetrics(),
      { environmentBase: new TransparentEnvironmentBase() },
    )
    expect(transparentCreated.ok).toBe(true)
    if (!transparentCreated.ok) return
    registerCompositionSources(transparentCreated.renderer, transparentCanvas)
    const report = transparentCreated.renderer.render({
      time: 0,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
    })

    expect(defaultHarness.clearColors[defaultHarness.clearColors.length - 1])
      .toEqual([0.001, 0.004, 0.011, 1])
    expect(transparentHarness.clearColors[transparentHarness.clearColors.length - 1])
      .toEqual([0, 0, 0, 0])
    expect(transparentHarness.drawCounts).toHaveLength(defaultHarness.drawCounts.length - 1)
    expect(transparentHarness.blendCalls[transparentHarness.blendCalls.length - 1]).toEqual([
      transparentHarness.gl.SRC_ALPHA,
      transparentHarness.gl.ONE_MINUS_SRC_ALPHA,
      transparentHarness.gl.ONE,
      transparentHarness.gl.ONE_MINUS_SRC_ALPHA,
    ])
    expect(report.passes[0]).toBe("environment-base")

    transparentCreated.renderer.handleContextLost()
    const restoredHarness = createGlHarness()
    const restored = transparentCreated.renderer.restore(
      createCapabilities(transparentCanvas, restoredHarness.gl),
      1,
    )
    expect(restored.ok).toBe(true)
    transparentCreated.renderer.render({
      time: 1000,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
    })
    expect(restoredHarness.clearColors[restoredHarness.clearColors.length - 1])
      .toEqual([0, 0, 0, 0])
    expect(restoredHarness.drawCounts).toHaveLength(transparentHarness.drawCounts.length)
  })

  it("renders every flat-neutral product window as one sharp Source material", () => {
    const canvas = createCanvas()
    const harness = createGlHarness()
    const created = SpatialRenderer.create(
      createCapabilities(canvas, harness.gl),
      new SpatialMetrics(),
      {
        environmentBase: new TransparentEnvironmentBase(),
        windowStyle: "flat-neutral",
      },
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    registerCompositionSources(created.renderer, canvas)

    const report = created.renderer.render({
      time: 0,
      parallax: { x: 0, y: 0 },
      transitionStrength: 1,
    })

    expect(report.passes).toEqual([
      "environment-base",
      "environment-particles",
      "surface-shell",
      "surface-windows",
      "surface-foreground",
    ])
    expect(harness.drawCounts).toEqual([
      6,
      SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6,
      SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6,
      6,
    ])
    expect(harness.uniform1fCalls.filter(([name]) => name === "u_neutral_source"))
      .toEqual([["u_neutral_source", 1], ["u_neutral_source", 1]])
  })

  it("hides capturing product windows and uses aperture uniforms only while animated", () => {
    const canvas = createCanvas()
    const harness = createGlHarness()
    const created = SpatialRenderer.create(
      createCapabilities(canvas, harness.gl),
      new SpatialMetrics(),
      {
        environmentBase: new TransparentEnvironmentBase(),
        windowStyle: "flat-neutral",
        windowPresentation: {
          ...DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS,
          enabled: true,
        },
      },
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.renderer.supportsWindowPresentation()).toBe(true)
    registerCompositionSources(created.renderer, canvas)

    created.renderer.render({
      time: 0,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
      sourcePresentations: [{
        sourceId: "window:active",
        phase: "capturing-open",
        progress: 0,
      }],
    })
    expect(harness.drawCounts).toEqual([
      6,
      SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6,
      6,
    ])

    harness.drawCounts.length = 0
    harness.uniform1fCalls.length = 0
    created.renderer.render({
      time: 100,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
      sourcePresentations: [{
        sourceId: "window:active",
        phase: "opening",
        progress: 0.5,
      }],
    })
    expect(harness.drawCounts).toEqual([
      6,
      SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6,
      SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6,
      6,
    ])
    expect(harness.uniform1fCalls).toContainEqual(["u_presentation_progress", 0.5])
    expect(harness.uniform1fCalls.filter(([name]) => name === "u_neutral_source"))
      .toEqual([["u_neutral_source", 1]])

    harness.uniform1fCalls.length = 0
    created.renderer.render({
      time: 500,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
      sourcePresentations: [{
        sourceId: "window:active",
        phase: "visible",
        progress: 1,
      }],
    })
    expect(harness.uniform1fCalls.some(([name]) => name === "u_presentation_progress"))
      .toBe(false)
    expect(harness.uniform1fCalls.filter(([name]) => name === "u_neutral_source"))
      .toEqual([["u_neutral_source", 1], ["u_neutral_source", 1]])
  })

  it("fails open to stable product rendering when the optional aperture program cannot link", () => {
    const canvas = createCanvas()
    const harness = createGlHarness({ failProgramAt: 4 })
    const created = SpatialRenderer.create(
      createCapabilities(canvas, harness.gl),
      new SpatialMetrics(),
      {
        environmentBase: new TransparentEnvironmentBase(),
        windowStyle: "flat-neutral",
        windowPresentation: {
          ...DEFAULT_WINDOW_PRESENTATION_RENDER_OPTIONS,
          enabled: true,
        },
      },
    )

    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.renderer.supportsWindowPresentation()).toBe(false)
    registerCompositionSources(created.renderer, canvas)
    created.renderer.render({
      time: 0,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
      sourcePresentations: [{
        sourceId: "window:active",
        phase: "capturing-open",
        progress: 0,
      }],
    })
    expect(harness.drawCounts).toEqual([
      6,
      SURFACE_MESH_COLUMNS * SURFACE_MESH_ROWS * 6,
      6,
    ])
  })

  it("restores programs and mesh buffers without recreating a framebuffer", () => {
    const canvas = createCanvas()
    const initial = createGlHarness()
    const created = SpatialRenderer.create(createCapabilities(canvas, initial.gl), new SpatialMetrics())
    expect(created.ok).toBe(true)
    if (!created.ok) return
    created.renderer.resize(800, 600, 1)
    created.renderer.handleContextLost()

    const restoredHarness = createGlHarness()
    const restored = created.renderer.restore(createCapabilities(canvas, restoredHarness.gl), 1)
    expect(restored.ok).toBe(true)
    expect(restoredHarness.createdFramebuffers()).toBe(0)
    expect(restoredHarness.bufferUploads).toHaveLength(2)
    expect(() => created.renderer.render({
      time: 0,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
    })).not.toThrow()
  })
})
