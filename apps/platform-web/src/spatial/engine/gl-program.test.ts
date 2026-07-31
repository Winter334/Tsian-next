import { describe, expect, it } from "vitest"
import { createGlProgram } from "./gl-program"

function fakeGl(options: { compile?: boolean; link?: boolean } = {}) {
  const deleted: string[] = []
  let shaderIndex = 0
  const context = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    createShader: () => ({ id: `shader-${++shaderIndex}` }),
    shaderSource: () => undefined,
    compileShader: () => undefined,
    getShaderParameter: () => options.compile !== false,
    getShaderInfoLog: () => "compile log",
    deleteShader: (shader: { id: string }) => deleted.push(shader.id),
    createProgram: () => ({ id: "program" }),
    attachShader: () => undefined,
    linkProgram: () => undefined,
    getProgramParameter: () => options.link !== false,
    getProgramInfoLog: () => "link log",
    detachShader: () => undefined,
    deleteProgram: () => deleted.push("program"),
  } as unknown as WebGL2RenderingContext
  return { context, deleted }
}

describe("createGlProgram", () => {
  it("links a program and deletes intermediate shaders", () => {
    const { context, deleted } = fakeGl()
    expect(createGlProgram(context, "vertex", "fragment")).toMatchObject({ ok: true })
    expect(deleted).toEqual(["shader-1", "shader-2"])
  })

  it("returns a typed compile failure and cleans up", () => {
    const { context, deleted } = fakeGl({ compile: false })
    expect(createGlProgram(context, "bad", "fragment")).toEqual({
      ok: false,
      stage: "vertex",
      message: "compile log",
    })
    expect(deleted).toEqual(["shader-1"])
  })

  it("returns a typed link failure and deletes the program", () => {
    const { context, deleted } = fakeGl({ link: false })
    expect(createGlProgram(context, "vertex", "fragment")).toEqual({
      ok: false,
      stage: "link",
      message: "link log",
    })
    expect(deleted).toEqual(["shader-1", "shader-2", "program"])
  })
})
