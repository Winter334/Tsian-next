import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createInteractionRequestScope,
  rejectAllInteractionRequests,
  resolveInteractionRequest,
  subscribeInteractionRequest,
} from "./interaction-events"

afterEach(() => {
  rejectAllInteractionRequests(new Error("test cleanup"))
})

describe("interaction request scopes", () => {
  it("rejects only requests owned by the failing concurrent turn", async () => {
    const listener = vi.fn()
    const unsubscribe = subscribeInteractionRequest(listener)
    const first = createInteractionRequestScope()
    const second = createInteractionRequestScope()
    const firstResult = first.emit("first", "第一问", undefined, true)
    const secondResult = second.emit("second", "第二问", ["继续"], false)
    expect(listener).toHaveBeenCalledTimes(2)

    const failure = new Error("first turn failed")
    first.rejectAll(failure)
    await expect(firstResult).rejects.toBe(failure)
    expect(resolveInteractionRequest("second", "继续")).toBe(true)
    await expect(secondResult).resolves.toEqual({ answer: "继续" })
    unsubscribe()
  })

  it("binds a scoped request to its turn abort signal", async () => {
    const controller = new AbortController()
    const scope = createInteractionRequestScope(controller.signal)
    const result = scope.emit("abort-me", "等待回答", undefined, true)
    controller.abort(new DOMException("Stopped", "AbortError"))
    await expect(result).rejects.toMatchObject({ name: "AbortError" })
    expect(resolveInteractionRequest("abort-me", "late")).toBe(false)
  })
})
