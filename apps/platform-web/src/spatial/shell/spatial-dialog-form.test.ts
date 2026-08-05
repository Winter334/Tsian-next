// @vitest-environment happy-dom

import { createApp, h, nextTick, ref, type App, type Ref } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import {
  openDialogForm,
  resolveDialogForm,
  useDialogFormState,
} from "@/composables/useDialogForm"
import SpatialDialogFormHost from "./SpatialDialogFormHost.vue"
import { SPATIAL_DIALOG_PANEL_SOURCE_ID } from "./spatial-global-surfaces"

const mountedApps: Array<{ app: App; host: HTMLElement }> = []

afterEach(() => {
  if (useDialogFormState().value) resolveDialogForm(false)
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount()
    host.remove()
  }
  document.body.replaceChildren()
})

function mountDialogHost(options: {
  interactive?: Ref<boolean>
  onRequestClose?: (confirm: boolean) => void
} = {}) {
  const sourceChanges: string[][] = []
  const dirtySources: string[] = []
  const interactive = options.interactive ?? ref(true)
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup() {
      return () => h(SpatialDialogFormHost, {
        interactive: interactive.value,
        onSourcesChanged: (ids: readonly string[]) => sourceChanges.push([...ids]),
        onSourceDirty: (id: string) => dirtySources.push(id),
        onRequestClose: options.onRequestClose ?? resolveDialogForm,
      })
    },
  })
  app.mount(host)
  mountedApps.push({ app, host })
  return { dirtySources, host, interactive, sourceChanges }
}

async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
}

function inputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.value = value
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

describe("Spatial Dialog Form", () => {
  it("renders every built-in field with SpatialSelect and resolves a value snapshot", async () => {
    const invoker = document.createElement("button")
    document.body.append(invoker)
    invoker.focus()
    const { dirtySources, host, sourceChanges } = mountDialogHost()
    const result = openDialogForm({
      title: "连接设置",
      fields: [
        { name: "name", label: "名称", defaultValue: "旧名称" },
        { name: "secret", label: "密钥", type: "password", defaultValue: "old" },
        { name: "count", label: "数量", type: "number", defaultValue: "1" },
        { name: "notes", label: "备注", type: "textarea", defaultValue: "初始" },
        {
          name: "kind",
          label: "类型",
          type: "select",
          defaultValue: "a",
          options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
        },
      ],
    })
    await settle()

    expect([...host.children].map((element) => element.getAttribute("data-spatial-source")))
      .toEqual([SPATIAL_DIALOG_PANEL_SOURCE_ID])
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([SPATIAL_DIALOG_PANEL_SOURCE_ID])
    expect(document.activeElement).toBe(host.querySelector('input[type="text"]'))

    inputValue(host.querySelector<HTMLInputElement>('input[type="text"]')!, "新名称")
    inputValue(host.querySelector<HTMLInputElement>('input[type="password"]')!, "new")
    inputValue(host.querySelector<HTMLInputElement>('input[type="number"]')!, "2")
    inputValue(host.querySelector<HTMLTextAreaElement>("textarea")!, "更新")
    host.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    await nextTick()
    host.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click()
    host.querySelector<HTMLButtonElement>("[data-spatial-dialog-submit]")?.click()

    await expect(result).resolves.toEqual({
      name: "新名称",
      secret: "new",
      count: "2",
      notes: "更新",
      kind: "b",
    })
    await settle()
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([])
    expect(dirtySources).toContain(SPATIAL_DIALOG_PANEL_SOURCE_ID)
    expect(document.activeElement).toBe(invoker)
  })

  it("keeps validation errors open and traps focus until Escape cancels", async () => {
    const { host } = mountDialogHost()
    const result = openDialogForm({
      title: "重命名",
      fields: [{ name: "name", label: "名称" }],
      validate: (values) => values.name.trim() ? null : "名称不能为空。",
    })
    await settle()

    host.querySelector<HTMLButtonElement>("[data-spatial-dialog-submit]")?.click()
    await settle()
    expect(host.querySelector("[role=alert]")?.textContent).toContain("名称不能为空")
    expect(useDialogFormState().value).not.toBeNull()

    const controls = [...host.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")]
    controls[controls.length - 1]?.focus()
    controls[controls.length - 1]?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }))
    expect(document.activeElement).toBe(controls[0])

    host.querySelector<HTMLElement>("[role=dialog]")?.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }))
    await expect(result).resolves.toBeNull()
  })

  it("exposes async test busy/result/error state without resolving the form", async () => {
    let finishTest!: (value: { ok: boolean; message: string }) => void
    const { host } = mountDialogHost()
    const result = openDialogForm({
      title: "提供商",
      fields: [{ name: "url", label: "地址", defaultValue: "https://example.test" }],
      testLabel: "测试",
      test: () => new Promise((resolve) => { finishTest = resolve }),
    })
    await settle()

    const testButton = host.querySelector<HTMLButtonElement>("[data-spatial-dialog-test]")!
    testButton.click()
    await nextTick()
    expect(testButton.disabled).toBe(true)
    finishTest({ ok: false, message: "无法连接" })
    await settle()
    expect(testButton.disabled).toBe(false)
    expect(host.querySelector("[role=alert]")?.textContent).toContain("无法连接")
    expect(useDialogFormState().value).not.toBeNull()

    host.querySelector<HTMLButtonElement>("[data-spatial-dialog-cancel]")?.click()
    await expect(result).resolves.toBeNull()
  })

  it("rejects a stale async test result after close and reopen", async () => {
    let finishStaleTest!: (value: { ok: boolean; message: string }) => void
    const { host } = mountDialogHost()
    const first = openDialogForm({
      title: "旧请求",
      fields: [{ name: "url", label: "地址" }],
      test: () => new Promise((resolve) => { finishStaleTest = resolve }),
    })
    await settle()

    host.querySelector<HTMLButtonElement>("[data-spatial-dialog-test]")?.click()
    await nextTick()
    resolveDialogForm(false)
    await expect(first).resolves.toBeNull()
    await settle()

    const second = openDialogForm({
      title: "新请求",
      fields: [{ name: "name", label: "名称", defaultValue: "新值" }],
    })
    await settle()
    finishStaleTest({ ok: false, message: "过期失败" })
    await settle()

    expect(host.querySelector("h2")?.textContent).toBe("新请求")
    expect(host.textContent).not.toContain("过期失败")
    expect(host.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe("新值")

    resolveDialogForm(false)
    await expect(second).resolves.toBeNull()
  })
})
