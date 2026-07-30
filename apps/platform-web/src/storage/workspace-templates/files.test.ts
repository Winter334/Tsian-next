import { describe, expect, it } from "vitest"
import { DEFAULT_SAVE_RUNTIME_FILES, DEFAULT_WORKSPACE_FILES } from "./files"

describe("default workspace templates", () => {
  it("does not create the retired Runtime Trace workspace path", () => {
    const paths = [...DEFAULT_WORKSPACE_FILES, ...DEFAULT_SAVE_RUNTIME_FILES]
      .map((file) => file.path)
    expect(paths.filter((path) => path.startsWith(".tsian/save/traces/"))).toEqual([])
  })
})
