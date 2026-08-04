// @vitest-environment happy-dom

import { createApp, h, nextTick, ref, type App, type Ref } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import {
  confirm as openConfirm,
  confirmChoice,
  prompt as openPrompt,
  resolveConfirm,
  useConfirmState,
} from "@/composables/useConfirm"
import SpatialConfirmHost from "./SpatialConfirmHost.vue"
import {
  SPATIAL_CONFIRM_PANEL_SOURCE_ID,
  SPATIAL_CONFIRM_PANEL_Z_INDEX,
  SPATIAL_CONFIRM_SHIELD_SOURCE_ID,
  SPATIAL_CONFIRM_SHIELD_Z_INDEX,
  SPATIAL_CONFIRM_SOURCE_IDS,
  spatialConfirmPanelLayout,
} from "./spatial-confirm"

const mountedApps: Array<{ app: App; host: HTMLElement }> = []

afterEach(() => {
  if (useConfirmState().value) resolveConfirm(false)
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount()
    host.remove()
  }
  document.body.replaceChildren()
})

function mountConfirmHost(options: {
  interactive?: Ref<boolean>
  onRequestClose?: (value: boolean | string | null) => void
} = {}) {
  const sourceChanges: string[][] = []
  const dirtySources: string[] = []
  const interactive = options.interactive ?? ref(true)
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup() {
      return () => h(SpatialConfirmHost, {
        interactive: interactive.value,
        onSourcesChanged: (sourceIds: readonly string[]) => sourceChanges.push([...sourceIds]),
        onSourceDirty: (sourceId: string) => dirtySources.push(sourceId),
        onRequestClose: options.onRequestClose ?? resolveConfirm,
      })
    },
  })
  app.mount(host)
  mountedApps.push({ app, host })
  return { dirtySources, host, interactive, sourceChanges }
}

async function settleOpen(): Promise<void> {
  await nextTick()
  await nextTick()
}

describe("Spatial Confirm source presentation", () => {
  it("mounts direct shield/panel Sources and preserves confirm focus/result semantics", async () => {
    const invoker = document.createElement("button")
    document.body.append(invoker)
    invoker.focus()
    const { dirtySources, host, sourceChanges } = mountConfirmHost()

    const result = openConfirm({ title: "删除存档", message: "此操作不可撤销。", severity: "danger" })
    await settleOpen()

    expect([...host.children].map((element) => element.getAttribute("data-spatial-source")))
      .toEqual([...SPATIAL_CONFIRM_SOURCE_IDS])
    expect([...host.children].every((element) => element.getAttribute("data-spatial-layer") === "overlay"))
      .toBe(true)
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_CONFIRM_SHIELD_SOURCE_ID}"]`))
      .not.toBeNull()
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_CONFIRM_SHIELD_SOURCE_ID}"]`)
      ?.getAttribute("data-spatial-render")).toBe("none")
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_CONFIRM_PANEL_SOURCE_ID}"]`))
      .not.toBeNull()
    expect(SPATIAL_CONFIRM_PANEL_Z_INDEX).toBeGreaterThan(SPATIAL_CONFIRM_SHIELD_Z_INDEX)
    expect(Number(host.querySelector(`[data-spatial-source="${SPATIAL_CONFIRM_PANEL_SOURCE_ID}"]`)
      ?.getAttribute("data-spatial-z"))).toBe(SPATIAL_CONFIRM_PANEL_Z_INDEX)
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([...SPATIAL_CONFIRM_SOURCE_IDS])
    expect(dirtySources).toContain(SPATIAL_CONFIRM_PANEL_SOURCE_ID)
    expect(document.activeElement).toBe(host.querySelector("[data-spatial-confirm-cancel]"))

    host.querySelector<HTMLButtonElement>("[data-spatial-confirm-primary]")?.click()
    await expect(result).resolves.toBe(true)
    await nextTick()

    expect(host.querySelector("[data-spatial-source]")).toBeNull()
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([])
    expect(document.activeElement).toBe(invoker)
  })

  it("focuses and selects prompt defaults, then keeps validation errors in the modal", async () => {
    const { dirtySources, host } = mountConfirmHost()
    const result = openPrompt({
      title: "重命名",
      defaultValue: "旧名称",
      validate: (value) => value.trim() ? null : "名称不能为空。",
    })
    await settleOpen()

    const input = host.querySelector<HTMLInputElement>("input")
    expect(document.activeElement).toBe(input)
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe("旧名称".length)

    if (input) {
      input.value = ""
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    host.querySelector<HTMLButtonElement>("[data-spatial-confirm-primary]")?.click()
    await nextTick()

    expect(host.querySelector("[role=alert]")?.textContent).toContain("名称不能为空")
    expect(useConfirmState().value?.kind).toBe("prompt")
    expect(dirtySources.filter((sourceId) => sourceId === SPATIAL_CONFIRM_PANEL_SOURCE_ID).length)
      .toBeGreaterThan(1)

    if (input) {
      input.value = "新名称"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    }
    host.querySelector<HTMLButtonElement>("[data-spatial-confirm-primary]")?.click()
    await expect(result).resolves.toBe("新名称")
  })

  it("cancels choice requests from Escape or the shield", async () => {
    const { host } = mountConfirmHost()
    const first = confirmChoice({
      title: "未保存的更改",
      message: "是否保存？",
      options: [
        { value: "save", label: "保存" },
        { value: "discard", label: "不保存", severity: "danger" },
      ],
    })
    await settleOpen()

    host.querySelector<HTMLElement>("[role=dialog]")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }))
    await expect(first).resolves.toBeNull()
    await nextTick()

    const second = confirmChoice({
      title: "未保存的更改",
      message: "是否保存？",
      options: [{ value: "save", label: "保存" }],
    })
    await settleOpen()
    host.querySelector<HTMLElement>(`[data-spatial-source="${SPATIAL_CONFIRM_SHIELD_SOURCE_ID}"]`)?.click()
    await expect(second).resolves.toBeNull()
  })

  it("wraps Tab within the active modal", async () => {
    const { host } = mountConfirmHost()
    const result = openConfirm({ message: "继续？" })
    await settleOpen()

    const panel = host.querySelector<HTMLElement>("[role=dialog]")
    const controls = [...(panel?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? [])]
    const first = controls[0]
    const last = controls[controls.length - 1]
    last?.focus()
    last?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }))
    expect(document.activeElement).toBe(first)

    first?.focus()
    first?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }))
    expect(document.activeElement).toBe(last)

    resolveConfirm(false)
    await expect(result).resolves.toBe(false)
  })

  it("keeps controls inert during presentation and delegates resolution to the shell", async () => {
    const interactive = ref(false)
    const requestedValues: Array<boolean | string | null> = []
    const { host } = mountConfirmHost({
      interactive,
      onRequestClose: (value) => requestedValues.push(value),
    })
    const result = openConfirm({ message: "继续？" })
    await settleOpen()

    const panel = host.querySelector<HTMLElement>("[role=dialog]")
    const primary = host.querySelector<HTMLButtonElement>("[data-spatial-confirm-primary]")
    expect(document.activeElement).toBe(panel)
    expect(primary?.disabled).toBe(true)
    primary?.click()
    expect(requestedValues).toEqual([])

    interactive.value = true
    await settleOpen()
    expect(primary?.disabled).toBe(false)
    expect(document.activeElement).toBe(host.querySelector("[data-spatial-confirm-cancel]"))
    primary?.click()
    expect(requestedValues).toEqual([true])
    expect(useConfirmState().value).not.toBeNull()

    resolveConfirm(requestedValues[0])
    await expect(result).resolves.toBe(true)
  })
})

describe("Spatial Confirm layout", () => {
  it("keeps the compact panel inside both default and constrained viewports", () => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 720, height: 520 }]) {
      const layout = spatialConfirmPanelLayout(viewport, 680)
      expect(layout.width).toBeLessThanOrEqual(viewport.width)
      expect(layout.maxHeight).toBeLessThanOrEqual(viewport.height)
      expect(layout.x).toBeGreaterThanOrEqual(0)
      expect(layout.y).toBeGreaterThanOrEqual(0)
      expect(layout.x + layout.width).toBeLessThanOrEqual(viewport.width)
    }
  })
})
