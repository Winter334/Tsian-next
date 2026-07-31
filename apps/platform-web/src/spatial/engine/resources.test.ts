import { describe, expect, it } from "vitest"
import { ContextResourceRegistry, type WebGlDeletionContext } from "./resources"

function resource<T>(name: string): T {
  return { name } as T
}

describe("ContextResourceRegistry", () => {
  it("releases every tracked resource once in dependency-safe order", () => {
    const deleted: string[] = []
    const context: WebGlDeletionContext = {
      deleteShader: () => deleted.push("shader"),
      deleteProgram: () => deleted.push("program"),
      deleteBuffer: () => deleted.push("buffer"),
      deleteTexture: () => deleted.push("texture"),
      deleteFramebuffer: () => deleted.push("framebuffer"),
    }
    let disposals = 0
    const registry = new ContextResourceRegistry(context, (count) => { disposals += count })
    registry.trackShader(resource<WebGLShader>("shader"))
    registry.trackProgram(resource<WebGLProgram>("program"))
    registry.trackBuffer(resource<WebGLBuffer>("buffer"))
    registry.trackTexture(resource<WebGLTexture>("texture"))
    registry.trackFramebuffer(resource<WebGLFramebuffer>("framebuffer"))
    expect(registry.releaseAll()).toBe(5)
    expect(deleted).toEqual(["framebuffer", "texture", "buffer", "program", "shader"])
    expect(disposals).toBe(5)
    expect(registry.releaseAll()).toBe(0)
  })

  it("forgets lost handles and advances generation on restore", () => {
    const context: WebGlDeletionContext = {
      deleteShader: () => undefined,
      deleteProgram: () => undefined,
      deleteBuffer: () => undefined,
      deleteTexture: () => undefined,
      deleteFramebuffer: () => undefined,
    }
    const registry = new ContextResourceRegistry(context)
    registry.trackTexture(resource<WebGLTexture>("texture"))
    expect(registry.abandonForContextLoss()).toBe(1)
    registry.restoreContext(context)
    expect(registry.snapshot()).toMatchObject({ total: 0, generation: 1 })
  })
})
