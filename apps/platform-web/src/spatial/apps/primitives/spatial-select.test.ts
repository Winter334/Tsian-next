// @vitest-environment happy-dom

import { createApp, h, nextTick, ref, type App } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import SpatialSelect from "./SpatialSelect.vue"
import {
  shouldCloseSpatialSelectFromPointerDown,
  spatialSelectKeyResult,
  type SpatialSelectOption,
} from "./spatial-select"

const options: readonly SpatialSelectOption[] = [
  { value: "newest", label: "最新" },
  { value: "popular", label: "热门", disabled: true },
  { value: "downloads", label: "下载量" },
]

const mountedApps: Array<{ app: App; host: HTMLElement }> = []

afterEach(() => {
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount()
    host.remove()
  }
})

function mountSelect() {
  const model = ref("newest")
  const emitted: Array<{ name: "update:modelValue" | "change"; value: string }> = []
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup() {
      return () => h(SpatialSelect, {
        modelValue: model.value,
        options,
        ariaLabel: "排序",
        "onUpdate:modelValue": (value: string) => {
          emitted.push({ name: "update:modelValue", value })
          model.value = value
        },
        onChange: (value: string) => emitted.push({ name: "change", value }),
      })
    },
  })
  app.mount(host)
  mountedApps.push({ app, host })
  return { emitted, host, model }
}

describe("Spatial Select keyboard interaction", () => {
  it("opens from the trigger and commits the active enabled option", () => {
    const opened = spatialSelectKeyResult(options, "newest", { open: false, activeIndex: -1 }, "Enter")
    const moved = spatialSelectKeyResult(options, "newest", opened, "ArrowDown")
    const committed = spatialSelectKeyResult(options, "newest", moved, "Enter")

    expect(opened).toMatchObject({ handled: true, open: true, activeIndex: 0 })
    expect(moved).toMatchObject({ open: true, activeIndex: 2 })
    expect(committed).toMatchObject({ open: false, selectedValue: "downloads" })
  })

  it("supports Home, End and Escape without changing selection", () => {
    expect(spatialSelectKeyResult(options, "newest", { open: true, activeIndex: 0 }, "End"))
      .toMatchObject({ open: true, activeIndex: 2 })
    expect(spatialSelectKeyResult(options, "downloads", { open: true, activeIndex: 2 }, "Home"))
      .toMatchObject({ open: true, activeIndex: 0 })
    expect(spatialSelectKeyResult(options, "newest", { open: true, activeIndex: 2 }, "Escape"))
      .toEqual({ handled: true, open: false, activeIndex: 2 })
  })

  it("opens an unselected value on the first enabled option and selects with Space", () => {
    const opened = spatialSelectKeyResult(options, "", { open: false, activeIndex: -1 }, "ArrowDown")
    const committed = spatialSelectKeyResult(options, "", opened, " ")

    expect(opened).toEqual({ handled: true, open: true, activeIndex: 0 })
    expect(committed).toEqual({ handled: true, open: false, activeIndex: 0, selectedValue: "newest" })
  })

  it("skips disabled options in both directions and stays at enabled boundaries", () => {
    expect(spatialSelectKeyResult(options, "newest", { open: true, activeIndex: 0 }, "ArrowDown"))
      .toMatchObject({ open: true, activeIndex: 2 })
    expect(spatialSelectKeyResult(options, "downloads", { open: true, activeIndex: 2 }, "ArrowUp"))
      .toMatchObject({ open: true, activeIndex: 0 })
    expect(spatialSelectKeyResult(options, "newest", { open: true, activeIndex: 0 }, "ArrowUp"))
      .toMatchObject({ open: true, activeIndex: 0 })
    expect(spatialSelectKeyResult(options, "downloads", { open: true, activeIndex: 2 }, "ArrowDown"))
      .toMatchObject({ open: true, activeIndex: 2 })
  })

  it("opens at enabled edges and lets Tab close without being consumed", () => {
    expect(spatialSelectKeyResult(options, "", { open: false, activeIndex: -1 }, "Home"))
      .toEqual({ handled: true, open: true, activeIndex: 0 })
    expect(spatialSelectKeyResult(options, "", { open: false, activeIndex: -1 }, "End"))
      .toEqual({ handled: true, open: true, activeIndex: 2 })
    expect(spatialSelectKeyResult(options, "newest", { open: true, activeIndex: 0 }, "Tab"))
      .toEqual({ handled: false, open: false, activeIndex: 0 })
  })

  it("keeps an all-disabled selector closed", () => {
    const disabledOptions = options.map((option) => ({ ...option, disabled: true }))
    expect(spatialSelectKeyResult(disabledOptions, "newest", { open: false, activeIndex: -1 }, " "))
      .toMatchObject({ handled: true, open: false, activeIndex: -1 })
  })
})

describe("Spatial Select mounted DOM", () => {
  it("ignores the trusted input plane before handling routed inside/outside targets", () => {
    const root = document.createElement("div")
    const option = document.createElement("div")
    const outside = document.createElement("div")
    root.append(option)

    expect(shouldCloseSpatialSelectFromPointerDown(root, {
      isTrusted: true,
      target: outside,
    })).toBe(false)
    expect(shouldCloseSpatialSelectFromPointerDown(root, {
      isTrusted: false,
      target: option,
    })).toBe(false)
    expect(shouldCloseSpatialSelectFromPointerDown(root, {
      isTrusted: false,
      target: outside,
    })).toBe(true)
  })

  it("keeps one listbox and option subtree mounted across closed and open states", async () => {
    const { host } = mountSelect()
    const trigger = host.querySelector<HTMLButtonElement>(".spatial-select__trigger")
    const initialListbox = host.querySelector<HTMLElement>("[role=listbox]")
    const initialOptions = [...host.querySelectorAll<HTMLElement>("[role=option]")]

    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(initialListbox?.getAttribute("aria-hidden")).toBe("true")
    expect(initialOptions).toHaveLength(options.length)

    trigger?.click()
    await nextTick()

    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector("[role=listbox]")).toBe(initialListbox)
    expect(initialListbox?.getAttribute("aria-hidden")).toBe("false")
    expect([...host.querySelectorAll("[role=option]")]).toEqual(initialOptions)

    trigger?.click()
    await nextTick()

    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(host.querySelector("[role=listbox]")).toBe(initialListbox)
    expect(initialListbox?.getAttribute("aria-hidden")).toBe("true")
    expect([...host.querySelectorAll("[role=option]")]).toEqual(initialOptions)
  })

  it("selects a mounted option, emits both contracts, and closes without unmounting", async () => {
    const { emitted, host, model } = mountSelect()
    const trigger = host.querySelector<HTMLButtonElement>(".spatial-select__trigger")
    const listbox = host.querySelector<HTMLElement>("[role=listbox]")
    const optionElements = [...host.querySelectorAll<HTMLElement>("[role=option]")]

    trigger?.click()
    await nextTick()
    optionElements[2]?.click()
    await nextTick()

    expect(model.value).toBe("downloads")
    expect(emitted).toEqual([
      { name: "update:modelValue", value: "downloads" },
      { name: "change", value: "downloads" },
    ])
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(listbox?.getAttribute("aria-hidden")).toBe("true")
    expect(host.querySelector("[role=listbox]")).toBe(listbox)
    expect([...host.querySelectorAll("[role=option]")]).toEqual(optionElements)
    expect(optionElements[2]?.getAttribute("aria-selected")).toBe("true")
  })

  it("preserves trigger focus when pointer selection cancels only mousedown", async () => {
    const { emitted, host } = mountSelect()
    const trigger = host.querySelector<HTMLButtonElement>(".spatial-select__trigger")
    const option = host.querySelectorAll<HTMLElement>("[role=option]")[2]

    trigger?.focus()
    trigger?.click()
    await nextTick()

    const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    expect(option?.dispatchEvent(mouseDown)).toBe(false)
    expect(mouseDown.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(trigger)

    option?.click()
    await nextTick()

    expect(emitted).toEqual([
      { name: "update:modelValue", value: "downloads" },
      { name: "change", value: "downloads" },
    ])
    expect(document.activeElement).toBe(trigger)
  })

  it("closes on an outside pointerdown without unmounting its option subtree", async () => {
    const { host } = mountSelect()
    const trigger = host.querySelector<HTMLButtonElement>(".spatial-select__trigger")
    const listbox = host.querySelector<HTMLElement>("[role=listbox]")
    const optionElements = [...host.querySelectorAll<HTMLElement>("[role=option]")]

    trigger?.click()
    await nextTick()
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))
    await nextTick()

    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(listbox?.getAttribute("aria-hidden")).toBe("true")
    expect(host.querySelector("[role=listbox]")).toBe(listbox)
    expect([...host.querySelectorAll("[role=option]")]).toEqual(optionElements)
  })
})
