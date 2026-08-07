// @vitest-environment happy-dom

import type { User } from "@tsian/contracts"
import { createApp, nextTick, type App, type Ref } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import SpatialAccountView from "./SpatialAccountView.vue"

const auth = vi.hoisted(() => ({
  currentUser: null as Ref<User | null> | null,
  initializing: null as Ref<boolean> | null,
  authError: null as Ref<string> | null,
  login: vi.fn(),
  logout: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock("@/composables/useAuth", async () => {
  const { computed, ref } = await import("vue")
  auth.currentUser = ref<User | null>(null)
  auth.initializing = ref(false)
  auth.authError = ref("")
  return {
    useAuth: () => ({
      currentUser: auth.currentUser,
      loggedIn: computed(() => auth.currentUser?.value !== null),
      initializing: auth.initializing,
      authError: auth.authError,
      login: auth.login,
      logout: auth.logout,
    }),
  }
})

vi.mock("@/composables/useToast", () => ({
  toast: { success: auth.success, error: auth.error },
}))

const mounted: Array<{ app: App; host: HTMLElement }> = []

function mount(): HTMLElement {
  const host = document.createElement("div")
  document.body.append(host)
  const app = createApp(SpatialAccountView)
  app.mount(host)
  mounted.push({ app, host })
  return host
}

async function settle(): Promise<void> {
  await nextTick()
  await nextTick()
}

beforeEach(() => {
  auth.currentUser!.value = null
  auth.initializing!.value = false
  auth.authError!.value = ""
})

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount()
    host.remove()
  }
  vi.clearAllMocks()
})

describe("SpatialAccountView", () => {
  it("renders guest and authentication-error states and invokes Discord login", async () => {
    const host = mount()
    expect(host.textContent).toContain("GUEST")
    host.querySelector<HTMLButtonElement>("button")!.click()
    expect(auth.login).toHaveBeenCalledOnce()

    auth.authError!.value = "session expired"
    await settle()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("session expired")
    expect(host.textContent).toContain("AUTH ERROR")
  })

  it("renders a bound account and keeps logout pending until the shared action resolves", async () => {
    auth.currentUser!.value = {
      id: "user-1",
      handle: "operator",
      displayName: "Spatial Operator",
      avatarUrl: null,
      authProviders: ["discord"],
    }
    let resolveLogout!: () => void
    auth.logout.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveLogout = resolve }))
    const host = mount()
    expect(host.textContent).toContain("Spatial Operator")
    expect(host.textContent).toContain("已绑定")

    const logout = [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("退出登录"))!
    logout.click()
    await settle()
    expect(host.textContent).toContain("SIGNING OUT")
    expect(logout.disabled).toBe(true)

    resolveLogout()
    await settle()
    expect(auth.success).toHaveBeenCalledWith("已退出登录")
    expect(host.textContent).not.toContain("SIGNING OUT")
  })
})
