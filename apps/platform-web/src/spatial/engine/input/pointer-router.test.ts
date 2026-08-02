import { describe, expect, it } from "vitest"
import { PointerRouter, type RoutedPointerSample } from "./pointer-router"

interface FakeTarget { readonly name: string; readonly parent?: FakeTarget }

const sample: RoutedPointerSample = {
  pointerId: 7,
  pointerType: "mouse",
  isPrimary: true,
  button: 0,
  buttons: 1,
  clientX: 10,
  clientY: 20,
}

describe("PointerRouter", () => {
  it("dispatches hover transitions around the shared ancestor", () => {
    const root = { name: "root" }
    const left = { name: "left", parent: root }
    const right = { name: "right", parent: root }
    const events: string[] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (target) => target.parent ? [target.parent, target] : [target],
      dispatch: (target, type) => { events.push(`${target.name}:${type}`); return true },
      focus: () => undefined,
      activate: () => ({ status: "requested", detail: "test" }),
      setCapture: () => undefined,
      releaseCapture: () => undefined,
    })
    router.move(left, sample)
    events.length = 0
    router.move(right, sample)
    expect(events).toEqual([
      "left:pointerout", "left:mouseout", "left:pointerleave", "left:mouseleave",
      "right:pointerover", "right:mouseover", "right:pointerenter", "right:mouseenter",
      "right:pointermove", "right:mousemove",
    ])
  })

  it("keeps routing to the captured target until pointerup", () => {
    const drag = { name: "drag" }
    const other = { name: "other" }
    const events: string[] = []
    const captures: string[] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (target) => [target],
      dispatch: (target, type) => { events.push(`${target.name}:${type}`); return true },
      focus: (target) => events.push(`${target.name}:focus`),
      activate: (target) => {
        events.push(`${target.name}:activate`)
        return { status: "requested", detail: "test" }
      },
      setCapture: (id) => captures.push(`set:${id}`),
      releaseCapture: (id) => captures.push(`release:${id}`),
    })
    router.down(drag, sample)
    router.move(other, { ...sample, clientX: 100 })
    expect(events[events.length - 2]).toBe("drag:pointermove")
    router.up(other, sample)
    expect(events).toContain("drag:activate")
    expect(captures).toEqual(["set:7", "release:7"])
    expect(router.captureCount()).toBe(0)
  })

  it("can promote a drag capture to one stable gesture owner", () => {
    const owner = { name: "owner" }
    const handle = { name: "handle", parent: owner }
    const other = { name: "other" }
    const events: string[] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (target) => target.parent ? [target.parent, target] : [target],
      dispatch: (target, type) => { events.push(`${target.name}:${type}`); return true },
      focus: () => undefined,
      activate: (target) => {
        events.push(`${target.name}:activate`)
        return { status: "requested", detail: "test" }
      },
      captureTarget: (target) => target === handle ? owner : target,
      setCapture: () => undefined,
      releaseCapture: () => undefined,
    })

    router.down(handle, sample)
    router.move(other, { ...sample, clientX: 100 })
    router.up(other, sample)

    expect(events).toContain("handle:pointerdown")
    expect(events).toContain("owner:pointermove")
    expect(events).toContain("owner:pointerup")
    expect(events).not.toContain("handle:activate")
    expect(router.captureCount()).toBe(0)
  })

  it("cancel releases capture without activation", () => {
    const target = { name: "target" }
    const events: string[] = []
    const hoverStates: string[][] = []
    const activeStates: string[][] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (value) => [value],
      dispatch: (_target, type) => { events.push(type); return true },
      focus: () => undefined,
      activate: () => {
        events.push("activate")
        return { status: "requested", detail: "test" }
      },
      setCapture: () => undefined,
      releaseCapture: () => events.push("release"),
      setHoverState: (chain) => hoverStates.push(chain.map((value) => value.name)),
      setActiveState: (chain) => activeStates.push(chain.map((value) => value.name)),
    })
    router.down(target, sample)
    router.cancel(sample.pointerId, sample)
    expect(events).toContain("pointercancel")
    expect(events).not.toContain("activate")
    expect(events).toContain("release")
    expect(events.indexOf("release")).toBeLessThan(events.indexOf("pointerleave"))
    expect(hoverStates).toEqual([["target"], []])
    expect(activeStates).toEqual([["target"], []])
  })

  it("does not activate when pointerdown is canceled", () => {
    const target = { name: "target" }
    const events: string[] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (value) => [value],
      dispatch: (_target, type) => type !== "pointerdown",
      focus: () => events.push("focus"),
      activate: () => {
        events.push("activate")
        return { status: "requested", detail: "test" }
      },
      setCapture: () => undefined,
      releaseCapture: () => undefined,
    })
    router.down(target, sample)
    router.up(target, sample)
    expect(events).toEqual([])
  })

  it("reports synthetic delivery separately from activation-policy suppression", () => {
    const target = { name: "disabled" }
    const synthetic: string[] = []
    const native: string[] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (value) => [value],
      dispatch: () => true,
      focus: () => native.push("focus"),
      activate: () => ({ status: "verified", detail: "unexpected" }),
      activationPolicy: () => ({ allowed: false, reason: "native-disabled" }),
      setCapture: () => undefined,
      releaseCapture: () => undefined,
      reportSyntheticDelivery: (report) => synthetic.push(
        `${report.phase}:${report.events.join(",")}:${String(report.activationEligible)}`,
      ),
      reportNativeOutcome: (outcome) => native.push(`${outcome.status}:${outcome.detail}`),
    })
    router.down(target, sample)
    router.up(target, sample)
    expect(synthetic).toEqual([
      "down:pointerdown,mousedown:false",
      "up:pointerup,mouseup:false",
    ])
    expect(native).toEqual(["suppressed:activation suppressed: native-disabled"])
  })

  it("cancels every logical capture on an external reset", () => {
    const first = { name: "first" }
    const second = { name: "second" }
    const events: string[] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (value) => [value],
      dispatch: (target, type) => { events.push(`${target.name}:${type}`); return true },
      focus: () => undefined,
      activate: () => ({ status: "requested", detail: "test" }),
      setCapture: () => undefined,
      releaseCapture: (pointerId) => events.push(`release:${pointerId}`),
    })
    router.down(first, sample)
    router.down(second, { ...sample, pointerId: 8 })
    events.length = 0

    router.cancelAll(sample)

    expect(events).toContain("first:pointercancel")
    expect(events).toContain("second:pointercancel")
    expect(events).toContain("release:7")
    expect(events).toContain("release:8")
    expect(router.captureCount()).toBe(0)
  })

  it("suppresses double-click activation for a natively disabled target", () => {
    const target = { name: "disabled" }
    const events: string[] = []
    const router = new PointerRouter<FakeTarget>({
      chain: (value) => [value],
      dispatch: (_target, type) => { events.push(type); return true },
      focus: () => undefined,
      activate: () => ({ status: "verified", detail: "unexpected" }),
      activationPolicy: () => ({ allowed: false, reason: "native-disabled" }),
      setCapture: () => undefined,
      releaseCapture: () => undefined,
      reportNativeOutcome: (outcome) => events.push(`${outcome.status}:${outcome.detail}`),
    })

    router.doubleClick(target, sample)

    expect(events).toEqual(["suppressed:double-click suppressed: native-disabled"])
  })
})
