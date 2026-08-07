import { describe, expect, it } from "vitest"
import {
  detailWindowIdFor,
  editorWindowIdFor,
  platformAppRegistry,
  platformLaunchers,
  platformWindowForLauncher,
  platformWindowForRoute,
} from "./platform-apps"

function route(name: string, input: {
  fullPath?: string
  params?: Record<string, unknown>
  query?: Record<string, unknown>
} = {}) {
  return {
    name,
    fullPath: input.fullPath ?? `/${name}`,
    params: input.params ?? {},
    query: input.query ?? {},
  }
}

describe("platform app registry", () => {
  it("is the unique source for router and launcher identities", () => {
    expect(new Set(platformAppRegistry.map((app) => app.appId)).size).toBe(platformAppRegistry.length)
    expect(new Set(platformAppRegistry.map((app) => app.route.name)).size).toBe(platformAppRegistry.length)
    expect(platformLaunchers.map((launcher) => launcher.id)).toEqual(
      platformAppRegistry.filter((app) => app.launcher).map((app) => app.appId),
    )
    expect(platformLaunchers.map((launcher) => launcher.id)).toEqual([
      "market",
      "my-apps",
      "workspace-explorer",
      "studio",
      "assistant",
      "play",
      "settings",
      "account",
      "debug",
    ])
  })

  it.each([
    ["app-market", "market"],
    ["library", "my-apps"],
    ["workspace", "workspace-explorer"],
    ["studio", "studio"],
    ["assistant", "assistant"],
    ["play", "play"],
    ["settings", "settings"],
    ["account", "account"],
    ["announcements", "announcements"],
    ["debug", "debug"],
  ])("resolves singleton route %s", (routeName, id) => {
    expect(platformWindowForRoute(route(routeName))?.id).toBe(id)
  })

  it("preserves detail, editor, and media instance IDs", () => {
    expect(platformWindowForRoute(route("game-card-detail", {
      fullPath: "/cards/card-1", params: { cardId: "card-1" },
    }))?.id).toBe(detailWindowIdFor("card-1"))
    expect(platformWindowForRoute(route("workspace-editor", {
      fullPath: "/workspace/editor?cardId=card-1&path=a.md&editorId=e-1",
      query: { cardId: "card-1", path: "a.md", mode: "edit", editorId: "e-1" },
    }))?.id).toBe(editorWindowIdFor({ scopeKey: "card-1", editorId: "e-1", mode: "edit", path: "a.md" }))
    expect(platformWindowForRoute(route("workspace-media", {
      query: { cardId: "card-1", path: "assets/a.png" },
    }))?.id).toBe("workspace-media:card-1:assets/a.png")
  })

  it("accepts local metadata editors but rejects invalid parameterized routes", () => {
    expect(platformWindowForRoute(route("workspace-editor", {
      query: { path: ".tsian/local/config.json", mode: "edit" },
    }))?.id).toContain("workspace-editor:tsian-local")
    expect(platformWindowForRoute(route("workspace-editor", { query: { path: "save/a.md" } }))).toBeNull()
    expect(platformWindowForRoute(route("workspace-media", { query: { cardId: "card-1" } }))).toBeNull()
    expect(platformWindowForRoute(route("game-card-detail"))).toBeNull()
  })

  it("keeps Play singleton and exposes the currently reviewed Spatial application set", () => {
    expect(platformWindowForLauncher("play")?.id).toBe("play")
    expect(platformAppRegistry
      .filter((app) => app.spatial.readiness === "ready")
      .map((app) => app.appId))
      .toEqual(["market", "my-apps", "workspace-explorer", "workspace-editor", "workspace-media", "studio", "assistant", "game-launcher", "play", "settings", "account", "announcements", "debug"])
    expect(platformAppRegistry
      .filter((app) => app.spatial.readiness === "ready")
      .every((app) => Boolean(app.spatial.component)))
      .toBe(true)
    expect(platformAppRegistry
      .filter((app) => !["market", "my-apps", "workspace-explorer", "workspace-editor", "workspace-media", "studio", "assistant", "game-launcher", "play", "settings", "account", "announcements", "debug"].includes(app.appId))
      .every((app) => app.spatial.readiness === "pending" && !app.spatial.component))
      .toBe(true)
  })
})
