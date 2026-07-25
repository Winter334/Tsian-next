import { describe, expect, it } from "vitest"
import {
  parseStrictJson,
  utf8ByteLength,
  validateStrictJson,
} from "./json"

function expectIssue(value: unknown, code: string): void {
  const result = validateStrictJson(value)
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.issue.code).toBe(code)
}

describe("validateStrictJson", () => {
  it("accepts finite strict JSON including null-prototype records", () => {
    const record = Object.create(null) as Record<string, unknown>
    record.ok = [null, true, 1.5, "text"]
    const result = validateStrictJson(record)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.stats.nodeCount).toBe(6)
      expect(result.stats.maxDepth).toBe(2)
    }
  })

  it("rejects unsupported primitives and non-finite numbers", () => {
    expectIssue(undefined, "unsupported_type")
    expectIssue(1n, "unsupported_type")
    expectIssue(Symbol("x"), "unsupported_type")
    expectIssue(() => undefined, "unsupported_type")
    expectIssue(Number.NaN, "non_finite_number")
    expectIssue(Number.POSITIVE_INFINITY, "non_finite_number")
  })

  it("rejects cycles but permits repeated acyclic references", () => {
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expectIssue(cycle, "cycle")

    const shared = { value: 1 }
    expect(validateStrictJson({ a: shared, b: shared }).ok).toBe(true)
  })

  it("rejects sparse and decorated arrays", () => {
    const sparse = new Array(2)
    sparse[1] = "x"
    expectIssue(sparse, "sparse_array")

    const decorated = [1] as unknown as Record<string, unknown>
    decorated.extra = true
    expectIssue(decorated, "array_property")
  })

  it("rejects accessors, symbols, non-enumerable properties, and exotic objects", () => {
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        throw new Error("must not be invoked")
      },
    })
    expectIssue(accessor, "accessor_property")

    const hidden = Object.defineProperty({}, "value", { value: 1 })
    expectIssue(hidden, "non_enumerable_property")

    const symbolic = { [Symbol("secret")]: true }
    expectIssue(symbolic, "symbol_property")

    expectIssue(new Date(), "non_plain_object")
    expectIssue(new Map(), "non_plain_object")
    expectIssue(new Uint8Array([1]), "non_plain_object")
  })

  it("enforces depth, node, and UTF-8 byte limits", () => {
    const depth = validateStrictJson({ a: { b: true } }, { maxDepth: 1 })
    expect(depth.ok).toBe(false)
    if (!depth.ok) expect(depth.issue.code).toBe("max_depth")

    const nodes = validateStrictJson([1, 2], { maxNodes: 2 })
    expect(nodes.ok).toBe(false)
    if (!nodes.ok) expect(nodes.issue.code).toBe("max_nodes")

    const bytes = validateStrictJson("你", { maxBytes: 4 })
    expect(bytes.ok).toBe(false)
    if (!bytes.ok) expect(bytes.issue.code).toBe("max_bytes")
    expect(utf8ByteLength("你a")).toBe(4)
  })
})

describe("parseStrictJson", () => {
  it("checks source bytes before parsing and reports malformed JSON safely", () => {
    const tooLarge = parseStrictJson("{not parsed", { maxSourceBytes: 2 })
    expect(tooLarge.ok).toBe(false)
    if (!tooLarge.ok) expect(tooLarge.issue.code).toBe("max_bytes")

    const malformed = parseStrictJson("{not json", { maxSourceBytes: 100 })
    expect(malformed.ok).toBe(false)
    if (!malformed.ok) expect(malformed.issue).toEqual({
      code: "invalid_json",
      path: "$",
      message: "JSON source is malformed.",
    })
  })
})
