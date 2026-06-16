import type { Component } from "vue"
import { defineAsyncComponent } from "vue"
import type { RouteLocationNormalizedLoaded } from "vue-router"
import {
  Activity,
  FolderOpen,
  Gamepad2,
  MonitorCog,
  PlaySquare,
  Settings,
  Store,
} from "lucide-vue-next"

export type DesktopAppId =
  | "market"
  | "my-apps"
  | "game-launcher"
  | "play"
  | "settings"
  | "debug"

export interface DesktopWindowInput {
  id: string
  appId: DesktopAppId
  label: string
  shortLabel: string
  routeName: string
  routePath: string
  title: string
  caption: string
  icon: Component
  component: Component
  props: Record<string, unknown>
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
  fullscreenable?: boolean
}

export interface DesktopLauncher {
  id: DesktopAppId
  label: string
  shortLabel: string
  routePath: string
  icon: Component
  title: string
  caption: string
}

interface DesktopAppDefinition {
  appId: DesktopAppId
  label: string
  shortLabel: string
  routeName: string
  routePath: string
  title: string
  caption: string
  icon: Component
  component: Component
  defaultWidth: number
  defaultHeight: number
  minWidth: number
  minHeight: number
  fullscreenable?: boolean
}

const AppMarketView = defineAsyncComponent(() => import("./views/AppMarketView.vue"))
const GameCardLibraryView = defineAsyncComponent(() => import("./views/GameCardLibraryView.vue"))
const GameCardDetailView = defineAsyncComponent(() => import("./views/GameCardDetailView.vue"))
const PlayView = defineAsyncComponent(() => import("./views/PlayView.vue"))
const SettingsView = defineAsyncComponent(() => import("./views/SettingsView.vue"))
const DebugView = defineAsyncComponent(() => import("./views/DebugView.vue"))

const desktopApps: DesktopAppDefinition[] = [
  {
    appId: "market",
    label: "App Market",
    shortLabel: "Market",
    routeName: "app-market",
    routePath: "/market",
    title: "App Market",
    caption: "Browse and install Game Cards",
    icon: Store,
    component: AppMarketView,
    defaultWidth: 980,
    defaultHeight: 620,
    minWidth: 560,
    minHeight: 420,
  },
  {
    appId: "my-apps",
    label: "My Apps",
    shortLabel: "My Apps",
    routeName: "library",
    routePath: "/library",
    title: "My Apps",
    caption: "Installed Game Cards",
    icon: FolderOpen,
    component: GameCardLibraryView,
    defaultWidth: 1120,
    defaultHeight: 680,
    minWidth: 620,
    minHeight: 440,
  },
  {
    appId: "play",
    label: "Play",
    shortLabel: "Play",
    routeName: "play",
    routePath: "/play",
    title: "Game Frontend",
    caption: "Active Game Card play window",
    icon: PlaySquare,
    component: PlayView,
    defaultWidth: 1180,
    defaultHeight: 720,
    minWidth: 680,
    minHeight: 460,
    fullscreenable: true,
  },
  {
    appId: "settings",
    label: "Control Panel",
    shortLabel: "Settings",
    routeName: "settings",
    routePath: "/settings",
    title: "Control Panel",
    caption: "Platform settings",
    icon: Settings,
    component: SettingsView,
    defaultWidth: 860,
    defaultHeight: 600,
    minWidth: 520,
    minHeight: 400,
  },
  {
    appId: "debug",
    label: "System Monitor",
    shortLabel: "Monitor",
    routeName: "debug",
    routePath: "/debug",
    title: "System Monitor",
    caption: "Runtime diagnostics",
    icon: Activity,
    component: DebugView,
    defaultWidth: 1180,
    defaultHeight: 720,
    minWidth: 720,
    minHeight: 460,
  },
]

const gameLauncherDefinition: DesktopAppDefinition = {
  appId: "game-launcher",
  label: "Game Launcher",
  shortLabel: "Launcher",
  routeName: "game-card-detail",
  routePath: "/cards",
  title: "Game Launcher",
  caption: "Play, saves, and workspace",
  icon: Gamepad2,
  component: GameCardDetailView,
  defaultWidth: 1180,
  defaultHeight: 720,
  minWidth: 720,
  minHeight: 460,
}

export const desktopLaunchers: DesktopLauncher[] = desktopApps.map((app) => ({
  id: app.appId,
  label: app.label,
  shortLabel: app.shortLabel,
  routePath: app.routePath,
  icon: app.icon,
  title: app.title,
  caption: app.caption,
}))

export function desktopWindowForLauncher(appId: DesktopAppId): DesktopWindowInput | null {
  const app = desktopApps.find((candidate) => candidate.appId === appId)
  if (!app) {
    return null
  }

  return windowInputFromDefinition(app, {
    id: app.appId,
    routePath: app.routePath,
    props: {},
  })
}

export function desktopWindowForRoute(
  route: RouteLocationNormalizedLoaded,
): DesktopWindowInput | null {
  const routeName = String(route.name ?? "")
  if (routeName === "desktop") {
    return null
  }

  if (routeName === "game-card-detail") {
    const cardId = String(route.params.cardId ?? "")
    if (!cardId) {
      return null
    }

    return windowInputFromDefinition(gameLauncherDefinition, {
      id: `${gameLauncherDefinition.appId}:${cardId}`,
      routePath: route.fullPath,
      props: { cardId },
    })
  }

  const app = desktopApps.find((candidate) => candidate.routeName === routeName)
  if (!app) {
    return null
  }

  return windowInputFromDefinition(app, {
    id: app.appId,
    routePath: route.fullPath || app.routePath,
    props: {},
  })
}

function windowInputFromDefinition(
  app: DesktopAppDefinition,
  input: {
    id: string
    routePath: string
    props: Record<string, unknown>
  },
): DesktopWindowInput {
  return {
    id: input.id,
    appId: app.appId,
    label: app.label,
    shortLabel: app.shortLabel,
    routeName: app.routeName,
    routePath: input.routePath,
    title: app.title,
    caption: app.caption,
    icon: app.icon,
    component: app.component,
    props: input.props,
    defaultWidth: app.defaultWidth,
    defaultHeight: app.defaultHeight,
    minWidth: app.minWidth,
    minHeight: app.minHeight,
    fullscreenable: app.fullscreenable,
  }
}

export const fallbackDesktopIcon = MonitorCog
