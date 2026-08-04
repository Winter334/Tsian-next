import { describe, expect, it, vi } from "vitest"
import { SpatialImageResolver } from "./spatial-image"

function environment(fetchImpl: typeof fetch = vi.fn()) {
  return {
    baseUrl: "https://tsian.local/library",
    fetch: fetchImpl,
    createObjectURL: vi.fn(() => "blob:owned"),
    revokeObjectURL: vi.fn(),
  }
}

describe("SpatialImageResolver", () => {
  it("uses same-origin URLs directly without taking ownership", async () => {
    const env = environment()
    const resolver = new SpatialImageResolver(env)
    await resolver.resolve({ kind: "url", url: "/covers/card.png" })
    expect(resolver.state).toEqual({ status: "ready", url: "/covers/card.png" })
    expect(env.fetch).not.toHaveBeenCalled()
    resolver.dispose()
    expect(env.revokeObjectURL).not.toHaveBeenCalled()
  })

  it("owns and revokes Blob URLs on replacement", async () => {
    const env = environment()
    const resolver = new SpatialImageResolver(env)
    await resolver.resolve({ kind: "blob", blob: new Blob(["image"], { type: "image/png" }) })
    expect(resolver.state).toEqual({ status: "ready", url: "blob:owned" })
    await resolver.resolve({ kind: "none" })
    expect(env.revokeObjectURL).toHaveBeenCalledWith("blob:owned")
  })

  it("materializes CORS-readable external images", async () => {
    const fetchImpl = vi.fn(async () => new Response(new Blob(["image"], { type: "image/png" }), {
      status: 200,
      headers: { "content-type": "image/png" },
    })) as typeof fetch
    const env = environment(fetchImpl)
    const resolver = new SpatialImageResolver(env)
    await resolver.resolve({ kind: "url", url: "https://cdn.example/cover.png" })
    expect(fetchImpl).toHaveBeenCalledWith("https://cdn.example/cover.png", expect.objectContaining({ mode: "cors" }))
    expect(resolver.state).toEqual({ status: "ready", url: "blob:owned" })
    resolver.dispose()
    expect(env.revokeObjectURL).toHaveBeenCalledWith("blob:owned")
  })

  it("does not let an older request replace a newer source", async () => {
    let resolveFirst!: (response: Response) => void
    const first = new Promise<Response>((resolve) => { resolveFirst = resolve })
    const fetchImpl = vi.fn(() => first) as unknown as typeof fetch
    const env = environment(fetchImpl)
    const resolver = new SpatialImageResolver(env)
    const pending = resolver.resolve({ kind: "url", url: "https://cdn.example/old.png" })
    await resolver.resolve({ kind: "none" })
    resolveFirst(new Response(new Blob(["old"], { type: "image/png" }), {
      headers: { "content-type": "image/png" },
    }))
    await pending
    expect(resolver.state).toEqual({ status: "empty" })
    expect(env.createObjectURL).not.toHaveBeenCalled()
  })

  it("degrades rejected and non-image external responses", async () => {
    const rejected = new SpatialImageResolver(environment(vi.fn(async () => { throw new TypeError("CORS") }) as typeof fetch))
    await rejected.resolve({ kind: "url", url: "https://cdn.example/private.png" })
    expect(rejected.state).toEqual({ status: "unavailable", reason: "cors" })

    const invalid = new SpatialImageResolver(environment(vi.fn(async () => new Response("no", {
      headers: { "content-type": "text/plain" },
    })) as typeof fetch))
    await invalid.resolve({ kind: "url", url: "https://cdn.example/not-image" })
    expect(invalid.state).toEqual({ status: "unavailable", reason: "invalid" })
  })
})
