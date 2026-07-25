import { describe, expect, it } from "vitest"
import {
  createFrontendActionRuntimeError,
  parseFrontendActionDomainError,
  publicFrontendActionError,
} from "./errors"

describe("Frontend Action public errors", () => {
  it("constructs stable sanitized runtime errors", () => {
    expect(createFrontendActionRuntimeError("FRONTEND_ACTION_INPUT_INVALID", {
      correlationId: "invocation-1",
    })).toEqual({
      kind: "runtime",
      code: "FRONTEND_ACTION_INPUT_INVALID",
      message: "Frontend Action input is invalid.",
      correlationId: "invocation-1",
    })

    expect(publicFrontendActionError(new Error("secret workspace content and stack"))).toEqual({
      kind: "runtime",
      code: "FRONTEND_ACTION_EXECUTION_FAILED",
      message: "Frontend Action execution failed.",
    })
  })

  it("preserves only a strictly valid domain envelope", () => {
    const result = parseFrontendActionDomainError({
      code: "ITEM_UNAVAILABLE",
      message: "Item is unavailable.",
      details: { itemId: "item-1" },
    }, "invocation-1")
    expect(result).toEqual({
      ok: true,
      error: {
        kind: "domain",
        code: "ITEM_UNAVAILABLE",
        message: "Item is unavailable.",
        details: { itemId: "item-1" },
        correlationId: "invocation-1",
      },
    })
  })

  it.each([
    { code: "lowercase", message: "bad" },
    { code: "OK", message: "" },
    { code: "OK", message: "x".repeat(501) },
    { code: "OK", message: "bad", stack: "secret" },
    { code: "OK", message: "bad", details: { value: Number.NaN } },
  ])("rejects an invalid domain envelope", (envelope) => {
    expect(parseFrontendActionDomainError(envelope).ok).toBe(false)
  })

  it("does not invoke accessors while parsing an envelope", () => {
    const value = Object.defineProperty({ code: "OK", message: "bad" }, "details", {
      enumerable: true,
      get: () => {
        throw new Error("secret")
      },
    })
    expect(parseFrontendActionDomainError(value).ok).toBe(false)
  })
})
