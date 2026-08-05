// @vitest-environment happy-dom

import { createApp, h, nextTick, type App } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import { confirm, resolveConfirm, useConfirmState } from "@/composables/useConfirm"
import {
  openDialogForm,
  resetDialogFormValues,
  resolveDialogForm,
  useDialogFormState,
} from "@/composables/useDialogForm"
import SpatialGlobalSurfaceHost from "./SpatialGlobalSurfaceHost.vue"
import {
  SPATIAL_CONFIRM_PANEL_SOURCE_ID,
  SPATIAL_CONFIRM_PANEL_Z_INDEX,
} from "./spatial-confirm"
import {
  SPATIAL_DIALOG_PANEL_SOURCE_ID,
  SPATIAL_DIALOG_PANEL_PRESENTATION_ID,
  SPATIAL_DIALOG_PANEL_Z_INDEX,
  SPATIAL_MODAL_SHIELD_SOURCE_ID,
  SPATIAL_MODAL_SHIELD_Z_INDEX,
  spatialDialogPanelLayout,
  spatialGlobalModalTakesInput,
} from "./spatial-global-surfaces"
import { SpatialGlobalModalCloseLifecycle } from "./spatial-global-modal-lifecycle"
import { SpatialWindowPresentationController } from "./window-presentation"

const mountedApps: Array<{ app: App; host: HTMLElement }> = []

afterEach(() => {
  if (useConfirmState().value) resolveConfirm(false)
  if (useDialogFormState().value) resolveDialogForm(false)
  for (const { app, host } of mountedApps.splice(0)) {
    app.unmount()
    host.remove()
  }
  document.body.replaceChildren()
})

function mountGlobalHost() {
  const sourceChanges: string[][] = []
  const confirmCloseRequests: Array<boolean | string | null> = []
  const dialogCloseRequests: boolean[] = []
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({
    setup() {
      return () => h(SpatialGlobalSurfaceHost, {
        confirmInteractive: true,
        dialogInteractive: true,
        onSourcesChanged: (ids: readonly string[]) => sourceChanges.push([...ids]),
        onRequestConfirmClose: (value: boolean | string | null) => confirmCloseRequests.push(value),
        onRequestDialogClose: (value: boolean) => dialogCloseRequests.push(value),
      })
    },
  })
  app.mount(host)
  mountedApps.push({ app, host })
  return { confirmCloseRequests, dialogCloseRequests, host, sourceChanges }
}

async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
}

describe("Spatial global modal ownership", () => {
  it("uses one input-only shield, keeps Confirm above Dialog, and blocks Dialog backdrop close", async () => {
    const { confirmCloseRequests, dialogCloseRequests, host, sourceChanges } = mountGlobalHost()
    const dialogResult = openDialogForm({
      title: "表单",
      fields: [{ name: "name", label: "名称" }],
    })
    await settle()

    const shield = host.querySelector<HTMLElement>(`[data-spatial-source="${SPATIAL_MODAL_SHIELD_SOURCE_ID}"]`)!
    expect(shield.getAttribute("data-spatial-render")).toBe("none")
    shield.click()
    expect(dialogCloseRequests).toEqual([])
    expect(useDialogFormState().value).not.toBeNull()
    const dialogCancel = host.querySelector<HTMLButtonElement>("[data-spatial-dialog-cancel]")
    dialogCancel?.focus()

    const confirmResult = confirm({ message: "继续？" })
    await settle()
    expect(host.querySelectorAll(`[data-spatial-source="${SPATIAL_MODAL_SHIELD_SOURCE_ID}"]`))
      .toHaveLength(1)
    expect(Number(host.querySelector(`[data-spatial-source="${SPATIAL_DIALOG_PANEL_SOURCE_ID}"]`)
      ?.getAttribute("data-spatial-z"))).toBe(SPATIAL_DIALOG_PANEL_Z_INDEX)
    expect(Number(host.querySelector(`[data-spatial-source="${SPATIAL_CONFIRM_PANEL_SOURCE_ID}"]`)
      ?.getAttribute("data-spatial-z"))).toBe(SPATIAL_CONFIRM_PANEL_Z_INDEX)
    expect(SPATIAL_CONFIRM_PANEL_Z_INDEX).toBeGreaterThan(SPATIAL_DIALOG_PANEL_Z_INDEX)
    expect(SPATIAL_DIALOG_PANEL_Z_INDEX).toBeGreaterThan(SPATIAL_MODAL_SHIELD_Z_INDEX)
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_DIALOG_PANEL_SOURCE_ID}"]`)
      ?.getAttribute("data-spatial-input")).toBe("none")

    shield.click()
    expect(confirmCloseRequests).toEqual([false])
    expect(dialogCloseRequests).toEqual([])
    resolveConfirm(false)
    await expect(confirmResult).resolves.toBe(false)
    await settle()
    expect(host.querySelector(`[data-spatial-source="${SPATIAL_DIALOG_PANEL_SOURCE_ID}"]`)
      ?.getAttribute("data-spatial-input")).toBeNull()
    await nextTick()
    expect(document.activeElement).toBe(dialogCancel)
    expect(sourceChanges[sourceChanges.length - 1]).toEqual([
      SPATIAL_MODAL_SHIELD_SOURCE_ID,
      SPATIAL_DIALOG_PANEL_SOURCE_ID,
    ])

    resolveDialogForm(false)
    await expect(dialogResult).resolves.toBeNull()
  })

  it("keeps dialog geometry within constrained viewports", () => {
    for (const viewport of [{ width: 1920, height: 1080 }, { width: 720, height: 520 }]) {
      const layout = spatialDialogPanelLayout(viewport, 900, 560)
      expect(layout.x).toBeGreaterThanOrEqual(0)
      expect(layout.y).toBeGreaterThanOrEqual(0)
      expect(layout.x + layout.width).toBeLessThanOrEqual(viewport.width)
      expect(layout.maxHeight).toBeLessThanOrEqual(viewport.height)
    }
  })

  it("cancels prior projected capture whenever modal input ownership advances", () => {
    const dialogSources = new Set([
      SPATIAL_MODAL_SHIELD_SOURCE_ID,
      SPATIAL_DIALOG_PANEL_SOURCE_ID,
    ])
    const confirmSources = new Set([
      ...dialogSources,
      SPATIAL_CONFIRM_PANEL_SOURCE_ID,
    ])

    expect(spatialGlobalModalTakesInput(new Set(), dialogSources)).toBe(true)
    expect(spatialGlobalModalTakesInput(dialogSources, confirmSources)).toBe(true)
    expect(spatialGlobalModalTakesInput(confirmSources, dialogSources)).toBe(true)
    expect(spatialGlobalModalTakesInput(dialogSources, new Set(dialogSources))).toBe(false)
  })

  it("keeps the Dialog store pending through the shell's terminal close frame", async () => {
    const presentation = new SpatialWindowPresentationController({ openMs: 0, closeMs: 300 })
    const lifecycle = new SpatialGlobalModalCloseLifecycle()
    presentation.mount(SPATIAL_DIALOG_PANEL_PRESENTATION_ID, {
      sourceId: SPATIAL_DIALOG_PANEL_SOURCE_ID,
      apertureAxis: "horizontal",
    })
    presentation.sourceReady(SPATIAL_DIALOG_PANEL_PRESENTATION_ID, 0, false)

    let settled = false
    const result = openDialogForm({
      title: "延迟关闭",
      fields: [{ name: "name", label: "名称", defaultValue: "保留" }],
    })
    resetDialogFormValues({ name: "保留" })
    void result.then(() => { settled = true })
    const close = lifecycle.requestDialog(presentation, true, 100, true)

    expect(close.accepted).toBe(true)
    expect(close.events).toEqual([])
    expect(presentation.phase(SPATIAL_DIALOG_PANEL_PRESENTATION_ID)).toBe("closing")
    expect(useDialogFormState().value).not.toBeNull()
    await Promise.resolve()
    expect(settled).toBe(false)

    const interim = presentation.advance(250)
    expect(lifecycle.complete(presentation, interim.events).dialog).toBeUndefined()
    expect(useDialogFormState().value).not.toBeNull()

    const terminal = presentation.advance(400)
    expect(terminal.snapshots).toEqual([
      expect.objectContaining({
        sourceId: SPATIAL_DIALOG_PANEL_SOURCE_ID,
        phase: "closing",
        progress: 0,
      }),
    ])
    const completion = lifecycle.complete(presentation, terminal.events)
    expect(completion.dialog).toEqual({ confirm: true })
    expect(presentation.snapshots()).toEqual([])
    expect(useDialogFormState().value).not.toBeNull()

    resolveDialogForm(completion.dialog!.confirm)
    await expect(result).resolves.toEqual({ name: "保留" })
    expect(settled).toBe(true)
  })
})
