// @vitest-environment happy-dom

import { createApp, h, type App } from "vue"
import { afterEach, describe, expect, it } from "vitest"
import type { BrowserPlatformConfigDraft } from "@/config/ai"
import { SPATIAL_ENVIRONMENT_GUIDANCE } from "@/config/platform-ui-mode"
import AppearanceScreen from "./AppearanceScreen.vue"
import SettingsHub from "./SettingsHub.vue"

const mounted: Array<{ app: App; host: HTMLElement }> = []

function mount(component: Parameters<typeof h>[0], props: Record<string, unknown>): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp({ render: () => h(component, props) })
  app.mount(host)
  mounted.push({ app, host })
  return host
}

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
})

describe("RetroOS appearance presentation", () => {
  it("presents Spatial as an optional mode with concise environment guidance", () => {
    const host = mount(AppearanceScreen, { currentMode: "retro" })

    expect(host.textContent).toContain("Spatial Desktop")
    expect(host.textContent).toContain(SPATIAL_ENVIRONMENT_GUIDANCE)
    expect(host.textContent).not.toMatch(/本地实验|仍在逐项适配/)
    expect(host.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.textContent)
      .toContain("RetroOS")
    expect(host.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')?.textContent)
      .toContain("Spatial Desktop")
  })

  it("keeps the settings hub free of obsolete experiment labels", () => {
    const draft = {
      activeProviderId: "",
      providerTypes: [],
      embeddingConfig: { enabled: false, baseUrl: "", apiKey: "", model: "", dimensions: 0 },
    } satisfies BrowserPlatformConfigDraft
    const host = mount(SettingsHub, { draft, appearanceSelectable: true })

    expect(host.textContent).toContain("RetroOS / Spatial Desktop")
    expect(host.textContent).not.toContain("本地实验")
  })
})
