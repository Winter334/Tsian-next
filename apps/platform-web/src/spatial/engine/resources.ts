export interface WebGlDeletionContext {
  deleteShader(shader: WebGLShader | null): void
  deleteProgram(program: WebGLProgram | null): void
  deleteBuffer(buffer: WebGLBuffer | null): void
  deleteTexture(texture: WebGLTexture | null): void
  deleteFramebuffer(framebuffer: WebGLFramebuffer | null): void
}

export interface ResourceSnapshot {
  readonly shaders: number
  readonly programs: number
  readonly buffers: number
  readonly textures: number
  readonly framebuffers: number
  readonly total: number
  readonly generation: number
}

export class ContextResourceRegistry {
  private readonly shaders = new Set<WebGLShader>()
  private readonly programs = new Set<WebGLProgram>()
  private readonly buffers = new Set<WebGLBuffer>()
  private readonly textures = new Set<WebGLTexture>()
  private readonly framebuffers = new Set<WebGLFramebuffer>()
  private generation = 0

  constructor(
    private gl: WebGlDeletionContext,
    private readonly onDispose?: (count: number) => void,
  ) {}

  trackShader(resource: WebGLShader): WebGLShader {
    this.shaders.add(resource)
    return resource
  }

  trackProgram(resource: WebGLProgram): WebGLProgram {
    this.programs.add(resource)
    return resource
  }

  trackBuffer(resource: WebGLBuffer): WebGLBuffer {
    this.buffers.add(resource)
    return resource
  }

  trackTexture(resource: WebGLTexture): WebGLTexture {
    this.textures.add(resource)
    return resource
  }

  trackFramebuffer(resource: WebGLFramebuffer): WebGLFramebuffer {
    this.framebuffers.add(resource)
    return resource
  }

  releaseShader(resource: WebGLShader): boolean {
    return this.release(this.shaders, resource, (value) => this.gl.deleteShader(value))
  }

  releaseProgram(resource: WebGLProgram): boolean {
    return this.release(this.programs, resource, (value) => this.gl.deleteProgram(value))
  }

  releaseBuffer(resource: WebGLBuffer): boolean {
    return this.release(this.buffers, resource, (value) => this.gl.deleteBuffer(value))
  }

  releaseTexture(resource: WebGLTexture): boolean {
    return this.release(this.textures, resource, (value) => this.gl.deleteTexture(value))
  }

  releaseFramebuffer(resource: WebGLFramebuffer): boolean {
    return this.release(this.framebuffers, resource, (value) => this.gl.deleteFramebuffer(value))
  }

  releaseAll(): number {
    let released = 0
    released += this.releaseSet(this.framebuffers, (value) => this.gl.deleteFramebuffer(value))
    released += this.releaseSet(this.textures, (value) => this.gl.deleteTexture(value))
    released += this.releaseSet(this.buffers, (value) => this.gl.deleteBuffer(value))
    released += this.releaseSet(this.programs, (value) => this.gl.deleteProgram(value))
    released += this.releaseSet(this.shaders, (value) => this.gl.deleteShader(value))
    return released
  }

  abandonForContextLoss(): number {
    const count = this.snapshot().total
    this.shaders.clear()
    this.programs.clear()
    this.buffers.clear()
    this.textures.clear()
    this.framebuffers.clear()
    this.onDispose?.(count)
    return count
  }

  restoreContext(gl: WebGlDeletionContext): void {
    this.gl = gl
    this.generation += 1
  }

  snapshot(): ResourceSnapshot {
    const total = this.shaders.size + this.programs.size + this.buffers.size
      + this.textures.size + this.framebuffers.size
    return Object.freeze({
      shaders: this.shaders.size,
      programs: this.programs.size,
      buffers: this.buffers.size,
      textures: this.textures.size,
      framebuffers: this.framebuffers.size,
      total,
      generation: this.generation,
    })
  }

  private release<T>(set: Set<T>, resource: T, dispose: (resource: T) => void): boolean {
    if (!set.delete(resource)) return false
    dispose(resource)
    this.onDispose?.(1)
    return true
  }

  private releaseSet<T>(set: Set<T>, dispose: (resource: T) => void): number {
    const resources = [...set]
    set.clear()
    for (const resource of resources) dispose(resource)
    this.onDispose?.(resources.length)
    return resources.length
  }
}
