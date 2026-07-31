export {}

declare global {
  interface PaintEvent extends Event {
    readonly changedElements: readonly Element[]
    /** Present in newer draft implementations; normalize through capabilities.ts. */
    readonly removedElements?: readonly Element[]
  }

  interface HTMLCanvasElement {
    layoutSubtree: boolean
    requestPaint(): void
    onpaint: ((this: HTMLCanvasElement, event: PaintEvent) => unknown) | null
  }

  interface WebGLCopyElementImageConfig {
    readonly sx?: GLfloat
    readonly sy?: GLfloat
    readonly swidth?: GLfloat
    readonly sheight?: GLfloat
    readonly width?: GLsizei
    readonly height?: GLsizei
  }

  interface WebGL2RenderingContext {
    texElementImage2D(
      target: GLenum,
      internalformat: GLenum,
      element: Element,
      config?: WebGLCopyElementImageConfig,
    ): void
  }
}
