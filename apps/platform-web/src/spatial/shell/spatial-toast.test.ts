// @vitest-environment happy-dom

import { createApp, h, nextTick, type App } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { toast, useToasts } from "@/composables/useToast"
import SpatialToastHost from "./SpatialToastHost.vue"
import { SPATIAL_TOAST_SOURCE_ID } from "./spatial-global-surfaces"

const mountedApps: Array<{ app: App; host: HTMLElement }> = []

afterEach(() => {
  useToasts().value = []
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount()
    host.remove()
  }
  document.body.replaceChildren()
  vi.useRealTimers()
})

function mountToastHost(reducedMotion = true) {
  const sourceChanges: string[][] = []
  const dirtySources: string[] = []
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup() {
      return () => h(SpatialToastHost, {
        reducedMotion,
        onSourcesChanged: (ids: readonly string[]) => sourceChanges.push([...ids]),
        onSourceDirty: (id: string) => dirtySources.push(id),
      })
    },
  })
  app.mount(host)
  mountedApps.push({ app, host })
  return { dirtySources, host, sourceChanges }
}

async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
}

describe("Spatial Toast", () => {
  it("renders info/success/error as one live direct Source and supports dismiss", async () => {
    const { dirtySources, host, sourceChanges } = mountToastHost()
    toast.info("信息", { duration: 0 })
    toast.success("完成", { duration: 0 })
    toast.error("失败", { duration: 0 })
    await settle()

    const source = host.querySelector<HTMLElement>(`[data-spatial-source="${SPATIAL_TOAST_SOURCE_ID}"]`)
    expect(source?.getAttribute("aria-live")).toBe("polite")
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([SPATIAL_TOAST_SOURCE_ID])
    expect(host.querySelectorAll("[data-spatial-toast-id]")).toHaveLength(3)
    expect(dirtySources).toContain(SPATIAL_TOAST_SOURCE_ID)

    host.querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')?.click()
    await settle()
    expect(host.querySelectorAll("[data-spatial-toast-id]")).toHaveLength(2)
  })

  it("keeps the singleton stack bounded to its four newest entries", async () => {
    const { host } = mountToastHost()
    for (let index = 1; index <= 5; index += 1) toast.info(`提示 ${index}`, { duration: 0 })
    await settle()

    const items = [...host.querySelectorAll<HTMLElement>("[data-spatial-toast-id]")]
    expect(items).toHaveLength(4)
    expect(items.some((item) => item.textContent?.includes("提示 1"))).toBe(false)
    expect(items[items.length - 1]?.textContent).toContain("提示 5")
  })

  it("lets the store timeout remove the final Source and settles reduced motion immediately", async () => {
    vi.useFakeTimers()
    const { host, sourceChanges } = mountToastHost(true)
    toast.info("短提示", { duration: 25 })
    await settle()
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_TOAST_SOURCE_ID}"]`)).not.toBeNull()

    vi.advanceTimersByTime(25)
    await settle()
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_TOAST_SOURCE_ID}"]`)).toBeNull()
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([])
  })

  it("retains the final Source until its bounded leave transition settles", async () => {
    vi.useFakeTimers()
    const { host, sourceChanges } = mountToastHost(false)
    toast.info("离场提示", { duration: 0 })
    await settle()
    const item = host.querySelector<HTMLElement>("[data-spatial-toast-id]")!
    item.style.transitionProperty = "opacity"
    item.style.transitionDuration = "180ms"

    toast.dismiss(Number(item.dataset.spatialToastId))
    await nextTick()
    vi.advanceTimersByTime(20)
    await settle()

    expect(host.querySelector(`[data-spatial-source="${SPATIAL_TOAST_SOURCE_ID}"]`)).not.toBeNull()
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([SPATIAL_TOAST_SOURCE_ID])

    vi.advanceTimersByTime(220)
    await settle()
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_TOAST_SOURCE_ID}"]`)).toBeNull()
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([])
  })
})
