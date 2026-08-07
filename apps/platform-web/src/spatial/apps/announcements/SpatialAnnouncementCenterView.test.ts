// @vitest-environment happy-dom

import type { Announcement } from "@tsian/contracts"
import { createApp, nextTick, type App, type Ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SpatialAnnouncementCenterView from "./SpatialAnnouncementCenterView.vue"

const announcements = vi.hoisted(() => ({
  items: null as Ref<Announcement[]> | null,
  loading: null as Ref<boolean> | null,
  error: null as Ref<string> | null,
  readIds: new Set<string>(),
  refresh: vi.fn(),
  markRead: vi.fn(),
}))

vi.mock("@/composables/useAnnouncements", async () => {
  const { ref } = await import("vue")
  announcements.items = ref<Announcement[]>([])
  announcements.loading = ref(false)
  announcements.error = ref("")
  announcements.markRead.mockImplementation((id: string) => { announcements.readIds.add(id) })
  return {
    useAnnouncements: () => ({
      announcements: announcements.items,
      loading: announcements.loading,
      errorMessage: announcements.error,
      refreshAnnouncements: announcements.refresh,
      markRead: announcements.markRead,
      isRead: (id: string) => announcements.readIds.has(id),
    }),
  }
})

const mounted: Array<{ app: App; host: HTMLElement }> = []
const items: Announcement[] = [
  { id: "first", title: "First signal", body: "**Hello**", createdAt: "2026-08-06T10:00:00Z", updatedAt: "2026-08-06T10:00:00Z" },
  { id: "second", title: "Second signal", body: "Second body", createdAt: "2026-08-06T11:00:00Z", updatedAt: "2026-08-06T11:00:00Z" },
]

function mount(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(SpatialAnnouncementCenterView)
  app.mount(host)
  mounted.push({ app, host })
  return host
}

async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
}

beforeEach(() => {
  announcements.items!.value = items
  announcements.loading!.value = false
  announcements.error!.value = ""
  announcements.readIds.clear()
})

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
  vi.clearAllMocks()
})

describe("SpatialAnnouncementCenterView", () => {
  it("selects and marks the first announcement read, then updates detail selection", async () => {
    const host = mount()
    await settle()
    expect(announcements.markRead).toHaveBeenCalledWith("first")
    expect(host.querySelector(".spatial-announcements__markdown")?.innerHTML).toContain("<strong>Hello</strong>")

    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".spatial-announcements__item")]
    buttons[1]!.click()
    await settle()
    expect(announcements.markRead).toHaveBeenCalledWith("second")
    expect(buttons[1]!.getAttribute("aria-pressed")).toBe("true")
    expect(host.querySelector(".spatial-announcements__detail")?.textContent).toContain("Second body")
  })

  it("surfaces refresh and loading/error states from the shared composable", async () => {
    const host = mount()
    host.querySelector<HTMLButtonElement>(".spatial-app__header button")!.click()
    expect(announcements.refresh).toHaveBeenCalledOnce()

    announcements.error!.value = "network unavailable"
    await settle()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("network unavailable")
  })
})
