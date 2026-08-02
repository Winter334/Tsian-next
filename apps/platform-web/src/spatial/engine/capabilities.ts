export type HtmlInCanvasApiVariant = "unresolved" | "current" | "legacy"
export type HtmlInCanvasContextVariant = "webgl2"

export interface HtmlInCanvasPaintPayload {
  readonly changed: readonly Element[]
  readonly removed: readonly Element[]
}

export interface HtmlInCanvasCapabilities {
  readonly canvas: HTMLCanvasElement
  readonly gl: WebGL2RenderingContext
  readonly apiVariant: HtmlInCanvasApiVariant
  readonly contextVariant: HtmlInCanvasContextVariant
  readonly maxTextureSize: number
  requestPaint(): void
  setPaintHandler(handler: (payload: HtmlInCanvasPaintPayload) => void): () => void
  uploadElement(
    texture: WebGLTexture,
    element: Element,
    size: { readonly width: number; readonly height: number },
  ): void
}

export interface UnsupportedHtmlInCanvas {
  readonly supported: false
  readonly missing: readonly string[]
  readonly message: string
}

export interface SupportedHtmlInCanvas {
  readonly supported: true
  readonly capabilities: HtmlInCanvasCapabilities
}

export type HtmlInCanvasCapabilityResult = SupportedHtmlInCanvas | UnsupportedHtmlInCanvas

type LegacyElementUploader = (
  target: number,
  level: number,
  internalFormat: number,
  format: number,
  type: number,
  element: Element,
) => void

type CurrentElementUploader = (
  target: number,
  internalFormat: number,
  element: Element,
  config: { readonly width: number; readonly height: number },
) => void

function isNegotiableUploadError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const message = typeof error === "string"
    ? error
    : typeof error === "object" && error !== null && "message" in error
      && typeof error.message === "string"
      ? error.message
      : ""
  return /ValidateTexFunc|signature|argument/i.test(message)
}

function unsupported(missing: readonly string[]): UnsupportedHtmlInCanvas {
  return {
    supported: false,
    missing,
    message: `Spatial rendering requires experimental HTML-in-Canvas support: ${missing.join(", ")}.`,
  }
}

function normalizeElementList(value: unknown): readonly Element[] {
  if (value === null || value === undefined || typeof value === "string") return []
  const iterator = (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator]
  if (typeof iterator !== "function") return []
  return Array.from(value as Iterable<unknown>).filter((candidate): candidate is Element => (
    typeof candidate === "object"
    && candidate !== null
    && "nodeType" in candidate
    && candidate.nodeType === 1
  ))
}

export function acquireHtmlInCanvasCapabilities(
  canvas: HTMLCanvasElement,
): HtmlInCanvasCapabilityResult {
  const missing: string[] = []
  if (!("layoutSubtree" in canvas)) missing.push("HTMLCanvasElement.layoutSubtree")
  if (typeof canvas.requestPaint !== "function") missing.push("HTMLCanvasElement.requestPaint")
  if (!("onpaint" in canvas)) missing.push("HTMLCanvasElement paint event")

  const contextOptions: WebGLContextAttributes = {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  }
  const gl = canvas.getContext("webgl2", contextOptions)
  if (!gl) {
    missing.push("WebGL2RenderingContext")
    return unsupported(missing)
  }
  const actualContextOptions = gl.getContextAttributes()
  if (actualContextOptions?.alpha !== true) missing.push("WebGL2 alpha framebuffer")
  if (actualContextOptions?.antialias !== true) missing.push("WebGL2 antialiasing")
  if (typeof gl.RGBA8 !== "number") missing.push("WebGL2RenderingContext.RGBA8")
  if (typeof gl.texElementImage2D !== "function") {
    missing.push("WebGL2RenderingContext.texElementImage2D")
  }
  const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE))
  if (!Number.isFinite(maxTextureSize) || maxTextureSize <= 0) {
    missing.push("WebGL2RenderingContext.MAX_TEXTURE_SIZE")
  }
  if (missing.length > 0) return unsupported(missing)

  canvas.layoutSubtree = true
  const rawUploader = gl.texElementImage2D
  const uploadCurrent = rawUploader.bind(gl) as unknown as CurrentElementUploader
  // The six-argument shape is intentionally private and temporary. It is not
  // declared as current platform IDL in html-in-canvas-types.d.ts.
  const uploadLegacy = rawUploader.bind(gl) as unknown as LegacyElementUploader
  let resolvedVariant: Exclude<HtmlInCanvasApiVariant, "unresolved"> | null = null

  const uploadWithCurrentApi = (
    element: Element,
    size: { readonly width: number; readonly height: number },
  ) => uploadCurrent(gl.TEXTURE_2D, gl.RGBA8, element, size)
  const uploadWithLegacyApi = (element: Element) => {
    uploadLegacy(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      element,
    )
  }

  return {
    supported: true,
    capabilities: {
      canvas,
      gl,
      get apiVariant() {
        return resolvedVariant ?? "unresolved"
      },
      contextVariant: "webgl2",
      maxTextureSize,
      requestPaint: () => canvas.requestPaint(),
      setPaintHandler(handler) {
        const listener = (event: Event) => {
          const paint = event as Event & {
            readonly changedElements?: unknown
            readonly removedElements?: unknown
          }
          handler({
            changed: normalizeElementList(paint.changedElements),
            removed: normalizeElementList(paint.removedElements),
          })
        }
        canvas.addEventListener("paint", listener)
        return () => canvas.removeEventListener("paint", listener)
      },
      uploadElement(texture, element, size) {
        gl.bindTexture(gl.TEXTURE_2D, texture)
        // Element uploads currently ignore UNPACK_* state. Orientation is
        // owned by the source UV convention in shaders/scene.ts.
        if (resolvedVariant === "current") {
          uploadWithCurrentApi(element, size)
          return
        }
        if (resolvedVariant === "legacy") {
          uploadWithLegacyApi(element)
          return
        }

        try {
          uploadWithCurrentApi(element, size)
          resolvedVariant = "current"
        } catch (currentError) {
          if (!isNegotiableUploadError(currentError)) throw currentError
          try {
            uploadWithLegacyApi(element)
            resolvedVariant = "legacy"
          } catch {
            throw currentError
          }
        }
      },
    },
  }
}
