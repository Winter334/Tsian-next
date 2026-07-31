import { describe, expect, it } from "vitest"
import type { HtmlInCanvasCapabilities } from "./capabilities"
import { SpatialMetrics } from "./metrics"
import { SpatialRenderer } from "./renderer"

function createGlHarness() {
  let nextResourceId = 0
  let createdSurfaceTextures = 0
  let createdFramebuffers = 0
  const framebufferBinds: Array<WebGLFramebuffer | null> = []
  const textureAllocations: unknown[][] = []
  const blendCalls: unknown[][] = []
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
    ONE: 27,
    TRIANGLES: 23,
    FLOAT: 24,
    TEXTURE0: 25,
    RGBA8: 26,
    createShader: resource,
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    deleteShader: () => undefined,
    createProgram: resource,
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    detachShader: () => undefined,
    deleteProgram: () => undefined,
    createBuffer: resource,
    bindBuffer: () => undefined,
    bufferData: () => undefined,
    deleteBuffer: () => undefined,
    createTexture: () => {
      createdSurfaceTextures += 1
      return resource()
    },
    bindTexture: () => undefined,
    texParameteri: () => undefined,
    texImage2D: (...args: unknown[]) => textureAllocations.push(args),
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
    clearColor: () => undefined,
    clear: () => undefined,
    enable: () => undefined,
    blendFuncSeparate: (...args: unknown[]) => blendCalls.push(args),
    disable: () => undefined,
    useProgram: () => undefined,
    getUniformLocation: resource,
    uniform4f: () => undefined,
    uniform2f: () => undefined,
    uniform1f: () => undefined,
    uniform1i: () => undefined,
    activeTexture: () => undefined,
    drawArrays: () => undefined,
    getAttribLocation: (_program: WebGLProgram, name: string) => name === "a_position" ? 0 : 1,
    enableVertexAttribArray: () => undefined,
    vertexAttribPointer: () => undefined,
  } as unknown as WebGL2RenderingContext
  return {
    gl,
    framebufferBinds,
    blendCalls,
    textureAllocations,
    createdSurfaceTextures: () => createdSurfaceTextures,
    createdFramebuffers: () => createdFramebuffers,
    resetTrace: () => { framebufferBinds.length = 0 },
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

describe("SpatialRenderer", () => {
  it("draws environment to the default framebuffer before the transparent curved surface", () => {
    const canvas = createCanvas()
    const harness = createGlHarness()
    const created = SpatialRenderer.create(
      createCapabilities(canvas, harness.gl),
      new SpatialMetrics(),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    created.renderer.resize(800, 600, 1)
    harness.resetTrace()

    const report = created.renderer.render({
      time: 1000,
      parallax: { x: 0.02, y: -0.01 },
      transitionStrength: 0,
    })

    expect(report.passes).toEqual([
      "environment-base",
      "environment-particles",
      "surface-sources",
      "surface-foreground",
      "curve-composite",
    ])
    expect(harness.framebufferBinds[0]).toBeNull()
    expect(harness.framebufferBinds[1]).not.toBeNull()
    expect(harness.framebufferBinds[2]).toBeNull()
    expect(harness.blendCalls).toEqual([
      [21, 22, 27, 22],
      [21, 22, 27, 22],
      [21, 22, 27, 22],
    ])
  })

  it("does not reallocate the static base or surface because particles render again", () => {
    const canvas = createCanvas()
    const harness = createGlHarness()
    const created = SpatialRenderer.create(
      createCapabilities(canvas, harness.gl),
      new SpatialMetrics(),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    created.renderer.resize(800, 600, 1)
    expect(harness.textureAllocations).toHaveLength(1)
    created.renderer.render({ time: 16, parallax: { x: 0, y: 0 }, transitionStrength: 0 })
    created.renderer.render({ time: 32, parallax: { x: 0, y: 0 }, transitionStrength: 0 })
    expect(harness.textureAllocations).toHaveLength(1)
    expect(created.renderer.environmentFrameReason()).toBeNull()
  })

  it("recreates the transparent surface target when backing dimensions are unchanged", () => {
    const canvas = createCanvas()
    const initialGl = createGlHarness()
    const metrics = new SpatialMetrics()
    const created = SpatialRenderer.create(
      createCapabilities(canvas, initialGl.gl),
      metrics,
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    created.renderer.resize(800, 600, 1)
    expect(canvas.width).toBe(1600)
    expect(canvas.height).toBe(1200)
    expect(metrics.snapshot()).toMatchObject({ displayDpr: 1, internalRasterScale: 2 })
    expect(initialGl.createdSurfaceTextures()).toBe(1)
    expect(initialGl.createdFramebuffers()).toBe(1)

    created.renderer.handleContextLost()
    const restoredGl = createGlHarness()
    const restored = created.renderer.restore(createCapabilities(canvas, restoredGl.gl), 1)

    expect(restored.ok).toBe(true)
    expect(restoredGl.createdSurfaceTextures()).toBe(1)
    expect(restoredGl.createdFramebuffers()).toBe(1)
    expect(() => created.renderer.render({
      time: 0,
      parallax: { x: 0, y: 0 },
      transitionStrength: 0,
    })).not.toThrow()
  })
})
