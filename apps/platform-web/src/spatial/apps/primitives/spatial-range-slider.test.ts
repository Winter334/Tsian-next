// @vitest-environment happy-dom

import { createApp, h, nextTick, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import SpatialRangeSlider from "./SpatialRangeSlider.vue"

const mounted: Array<{ app: ReturnType<typeof createApp>; host: HTMLElement }> = []

function mountNullableSlider() {
  const value = ref<number | null>(null)
  const onUpdate = vi.fn((next: number | null) => { value.value = next })
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup: () => () => h(SpatialRangeSlider, {
      modelValue: value.value,
      min: -2,
      max: 2,
      step: 0.1,
      nullable: true,
      label: "频率惩罚",
      tip: "说明内容",
      "onUpdate:modelValue": onUpdate,
    }),
  })
  app.mount(host)
  mounted.push({ app, host })
  return { host, onUpdate }
}

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
  document.body.replaceChildren()
})

describe("SpatialRangeSlider", () => {
  it("reserves the leftmost nullable position for not sending the parameter", async () => {
    const { host, onUpdate } = mountNullableSlider()
    const input = host.querySelector<HTMLInputElement>('input[type="range"]')!

    expect(input.value).toBe("0")
    expect(input.getAttribute("aria-valuetext")).toBe("不发送")
    expect(host.querySelector("output")?.textContent).toBe("不发送")

    input.value = "1"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(onUpdate).toHaveBeenLastCalledWith(-2)
    expect(host.querySelector("output")?.textContent).toBe("-2")

    input.value = "0"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(onUpdate).toHaveBeenLastCalledWith(null)
    expect(host.querySelector("output")?.textContent).toBe("不发送")
  })

  it("opens its Chinese accessible parameter explanation", async () => {
    const { host } = mountNullableSlider()
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="频率惩罚说明"]')!

    trigger.click()
    await nextTick()

    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(host.querySelector('[role="tooltip"]')?.textContent).toBe("说明内容")
  })
})
