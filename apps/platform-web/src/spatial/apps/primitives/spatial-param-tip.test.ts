// @vitest-environment happy-dom

import { createApp, h, nextTick } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MODEL_PARAMETER_TIPS } from "@/controllers/settings/model-parameter-helpers"
import SpatialParamTip from "./SpatialParamTip.vue"
import { spatialParamTipHorizontalLayout } from "./spatial-param-tip"

const mounted: Array<{ app: ReturnType<typeof createApp>; host: HTMLElement }> = []

function mountTip(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup: () => () => h("div", { class: "spatial-app__scroll" }, [
      h("section", [h(SpatialParamTip, { label: "温度", tip: "采样温度说明" })]),
      h("section", [h("input", { "aria-label": "相邻参数" })]),
    ]),
  })
  app.mount(host)
  mounted.push({ app, host })
  return host
}

afterEach(() => {
  vi.useRealTimers()
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe("SpatialParamTip", () => {
  it("clamps a centered Tip inside either horizontal edge and narrows it when needed", () => {
    const boundary = { left: 100, right: 500 }

    for (const anchor of [{ left: 108, width: 18 }, { left: 474, width: 18 }]) {
      const layout = spatialParamTipHorizontalLayout(anchor, boundary)
      const anchorCenter = anchor.left + anchor.width / 2
      const paintedLeft = anchorCenter - layout.width / 2 + layout.offsetX

      expect(paintedLeft).toBeGreaterThanOrEqual(boundary.left + 8)
      expect(paintedLeft + layout.width).toBeLessThanOrEqual(boundary.right - 8)
    }

    const narrowBoundary = { left: 20, right: 180 }
    const narrowLayout = spatialParamTipHorizontalLayout({ left: 30, width: 18 }, narrowBoundary)
    expect(narrowLayout.width).toBeLessThan(260)
    expect(narrowLayout.width).toBeLessThanOrEqual(narrowBoundary.right - narrowBoundary.left)
  })

  it("wraps the long streaming Tip inside a nowrap settings row and keeps its box within the panel", async () => {
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp({
      setup: () => () => h("main", {
        class: "spatial-app__scroll",
        style: { whiteSpace: "nowrap" },
      }, [
        h(SpatialParamTip, {
          label: "流式响应",
          tip: MODEL_PARAMETER_TIPS.streaming,
        }),
      ]),
    })
    app.mount(host)
    mounted.push({ app, host })

    const boundary = host.querySelector<HTMLElement>(".spatial-app__scroll")!
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="流式响应说明"]')!
    const tipRoot = trigger.closest<HTMLElement>(".spatial-param-tip")!
    const boundaryRect = { left: 100, right: 320, width: 220 }
    const anchorRect = { left: 294, width: 18 }

    Object.defineProperty(boundary, "clientWidth", { configurable: true, value: boundaryRect.width })
    Object.defineProperty(boundary, "clientLeft", { configurable: true, value: 0 })
    vi.spyOn(boundary, "getBoundingClientRect").mockReturnValue({
      ...boundaryRect,
      top: 0,
      bottom: 200,
      height: 200,
      x: boundaryRect.left,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(tipRoot, "getBoundingClientRect").mockReturnValue({
      ...anchorRect,
      right: anchorRect.left + anchorRect.width,
      top: 0,
      bottom: 18,
      height: 18,
      x: anchorRect.left,
      y: 0,
      toJSON: () => ({}),
    })

    trigger.click()
    await nextTick()

    const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!
    const width = Number.parseFloat(tooltip.style.width)
    const offsetX = Number.parseFloat(tooltip.style.transform.match(/\+\s*(-?[\d.]+)px/)?.[1] ?? "NaN")
    const paintedLeft = anchorRect.left + anchorRect.width / 2 - width / 2 + offsetX

    expect(tooltip.textContent).toBe(MODEL_PARAMETER_TIPS.streaming)
    expect(getComputedStyle(tooltip).whiteSpace).toBe("normal")
    expect(paintedLeft).toBeGreaterThanOrEqual(boundaryRect.left + 8)
    expect(paintedLeft + width).toBeLessThanOrEqual(boundaryRect.right - 8)
  })

  it("promotes the open Tip above adjacent fields and closes on Escape", async () => {
    const host = mountTip()
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="温度说明"]')!
    const tipRoot = trigger.closest<HTMLElement>(".spatial-param-tip")!
    const adjacentField = host.querySelector<HTMLElement>('input[aria-label="相邻参数"]')!

    trigger.focus()
    await nextTick()

    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!
    expect(tooltip.textContent).toBe("采样温度说明")
    expect(tipRoot.classList.contains("spatial-param-tip--open")).toBe(true)
    expect(tipRoot.contains(tooltip)).toBe(true)
    expect(tipRoot.closest("section")?.nextElementSibling?.contains(adjacentField)).toBe(true)

    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    await nextTick()

    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(tipRoot.classList.contains("spatial-param-tip--open")).toBe(false)
    expect(host.querySelector('[role="tooltip"]')).toBeNull()
  })

  it("keeps pointer and blur dismissal delayed for moving into the Tip", async () => {
    vi.useFakeTimers()
    const host = mountTip()
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="温度说明"]')!

    trigger.click()
    await nextTick()
    const tooltip = host.querySelector<HTMLElement>('[role="tooltip"]')!

    trigger.dispatchEvent(new FocusEvent("blur", { bubbles: true }))
    tooltip.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }))
    vi.advanceTimersByTime(140)
    await nextTick()
    expect(host.querySelector('[role="tooltip"]')).not.toBeNull()

    tooltip.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }))
    vi.advanceTimersByTime(140)
    await nextTick()
    expect(host.querySelector('[role="tooltip"]')).toBeNull()
  })

  it("removes active layout listeners when unmounted", async () => {
    const host = mountTip()
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="温度说明"]')!
    const addEventListener = vi.spyOn(window, "addEventListener")
    const removeEventListener = vi.spyOn(window, "removeEventListener")

    trigger.click()
    await nextTick()
    expect(addEventListener.mock.calls.some(([type]) => type === "resize")).toBe(true)

    const [{ app }] = mounted.splice(mounted.findIndex(entry => entry.host === host), 1)
    app.unmount()
    host.remove()
    expect(removeEventListener.mock.calls.some(([type]) => type === "resize")).toBe(true)
  })
})
