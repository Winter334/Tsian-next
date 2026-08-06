// @vitest-environment happy-dom

import { createApp, nextTick, type App } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"

const controllerFns = vi.hoisted(() => ({
  applyChanges: vi.fn(async () => true),
  cancelChanges: vi.fn(),
  confirmChanges: vi.fn(async () => undefined),
}))

vi.mock("@/controllers/assistant/use-assistant-config-controller", async () => {
  const { computed, ref } = await import("vue")
  const noop = vi.fn()
  return {
    useAssistantConfigController: () => ({
      agent: ref(null),
      skills: ref([]),
      toolDiagnostics: ref([]),
      applying: ref(false),
      updatingKnowledge: ref(false),
      workspaceAccessOptions: [],
      assistantCapabilities: computed(() => []),
      enabledAssistantCapabilityCount: computed(() => 0),
      workspaceLevel: computed(() => 1),
      enabledSkillCount: computed(() => 0),
      workspaceAccessDescription: computed(() => ""),
      hasChanges: computed(() => false),
      isSecretKey: noop,
      configValue: noop,
      setConfigValue: noop,
      skillConfigChanged: noop,
      entrySummary: noop,
      skillEnabled: noop,
      toggleSkill: noop,
      toggleAssistantCapability: noop,
      updateWorkspaceAccessLevel: noop,
      refreshKnowledge: noop,
      ...controllerFns,
    }),
  }
})

import SpatialAssistantConfigPanel from "./SpatialAssistantConfigPanel.vue"

const mounted: Array<{ app: App; host: HTMLElement }> = []

afterEach(() => {
  controllerFns.applyChanges.mockClear()
  controllerFns.cancelChanges.mockClear()
  controllerFns.confirmChanges.mockClear()
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
})

function routedPointer(
  type: string,
  input: {
    pointerId: number
    clientX: number
    clientY: number
    screenX: number
    screenY: number
  },
): PointerEvent {
  const event = new PointerEvent(type, {
    bubbles: true,
    button: 0,
    clientX: input.clientX,
    clientY: input.clientY,
    pointerId: input.pointerId,
  })
  Object.defineProperties(event, {
    spatialScreenClientX: { value: input.screenX },
    spatialScreenClientY: { value: input.screenY },
  })
  return event
}

describe("SpatialAssistantConfigPanel", () => {
  it("drags from its header with routed screen deltas and excludes the close control", async () => {
    const moves: Array<{ x: number; y: number }> = []
    const host = document.createElement("div")
    document.body.append(host)
    const app = createApp(SpatialAssistantConfigPanel, {
      interactive: true,
      onMove: (delta: { x: number; y: number }) => moves.push(delta),
    })
    app.mount(host)
    mounted.push({ app, host })
    await nextTick()

    const panel = host.querySelector<HTMLElement>("[data-spatial-gesture-owner]")!
    const header = panel.querySelector<HTMLElement>("[data-spatial-gesture-start]")!
    header.dispatchEvent(routedPointer("pointerdown", {
      pointerId: 7,
      clientX: 30,
      clientY: 12,
      screenX: 400,
      screenY: 300,
    }))
    panel.dispatchEvent(routedPointer("pointermove", {
      pointerId: 7,
      clientX: 35,
      clientY: 15,
      screenX: 480,
      screenY: 345,
    }))
    panel.dispatchEvent(routedPointer("pointermove", {
      pointerId: 7,
      clientX: 37,
      clientY: 18,
      screenX: 500,
      screenY: 360,
    }))
    panel.dispatchEvent(routedPointer("pointerup", {
      pointerId: 7,
      clientX: 37,
      clientY: 18,
      screenX: 500,
      screenY: 360,
    }))

    expect(moves).toEqual([{ x: 80, y: 45 }, { x: 20, y: 15 }])

    const close = panel.querySelector<HTMLElement>("[data-spatial-assistant-config-close]")!
    close.dispatchEvent(routedPointer("pointerdown", {
      pointerId: 8,
      clientX: 20,
      clientY: 12,
      screenX: 450,
      screenY: 320,
    }))
    panel.dispatchEvent(routedPointer("pointermove", {
      pointerId: 8,
      clientX: 40,
      clientY: 18,
      screenX: 540,
      screenY: 380,
    }))

    expect(moves).toHaveLength(2)
  })
})
