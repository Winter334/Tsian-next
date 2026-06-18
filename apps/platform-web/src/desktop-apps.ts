import type { Component } from "vue"
import { defineAsyncComponent } from "vue"
import type { RouteLocationNormalizedLoaded } from "vue-router"
import {
  Activity,
  Bot,
  FilePenLine,
  FolderOpen,
  Gamepad2,
  HardDrive,
  MonitorCog,
  PlaySquare,
  Settings,
  Store,
} from "lucide-vue-next"

export type DesktopAppId =
  | "market"
  | "my-apps"
  | "workspace-explorer"
  | "workspace-editor"
  | "studio"
  | "assistant"
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
const WorkspaceExplorerView = defineAsyncComponent(() => import("./views/WorkspaceExplorerView.vue"))
const WorkspaceEditorView = defineAsyncComponent(() => import("./views/WorkspaceEditorView.vue"))
const StudioView = defineAsyncComponent(() => import("./views/StudioView.vue"))
const AssistantView = defineAsyncComponent(() => import("./views/AssistantView.vue"))
const GameCardDetailView = defineAsyncComponent(() => import("./views/GameCardDetailView.vue"))
const PlayView = defineAsyncComponent(() => import("./views/PlayView.vue"))
const SettingsView = defineAsyncComponent(() => import("./views/SettingsView.vue"))
const DebugView = defineAsyncComponent(() => import("./views/DebugView.vue"))

const desktopApps: DesktopAppDefinition[] = [
  {
    appId: "market",
    label: "应用市场",
    shortLabel: "市场",
    routeName: "app-market",
    routePath: "/market",
    title: "应用市场",
    caption: "浏览与安装游戏卡",
    icon: Store,
    component: AppMarketView,
    defaultWidth: 980,
    defaultHeight: 620,
    minWidth: 560,
    minHeight: 420,
  },
  {
    appId: "my-apps",
    label: "我的应用",
    shortLabel: "应用",
    routeName: "library",
    routePath: "/library",
    title: "我的应用",
    caption: "已安装的游戏卡",
    icon: FolderOpen,
    component: GameCardLibraryView,
    defaultWidth: 1120,
    defaultHeight: 680,
    minWidth: 620,
    minHeight: 440,
  },
  {
    appId: "workspace-explorer",
    label: "资源管理器",
    shortLabel: "资源管理器",
    routeName: "workspace",
    routePath: "/workspace",
    title: "资源管理器",
    caption: "游戏卡内容与存档文件",
    icon: HardDrive,
    component: WorkspaceExplorerView,
    defaultWidth: 1180,
    defaultHeight: 720,
    minWidth: 720,
    minHeight: 460,
    fullscreenable: true,
  },
  {
    appId: "studio",
    label: "工作室",
    shortLabel: "工作室",
    routeName: "studio",
    routePath: "/studio",
    title: "工作室",
    caption: "当前游戏卡的 Agent 配置",
    icon: Bot,
    component: StudioView,
    defaultWidth: 1080,
    defaultHeight: 680,
    minWidth: 680,
    minHeight: 460,
  },
  {
    appId: "assistant",
    label: "助手",
    shortLabel: "助手",
    routeName: "assistant",
    routePath: "/assistant",
    title: "桌面助手",
    caption: "游戏卡问答与编辑辅助",
    icon: Bot,
    component: AssistantView,
    defaultWidth: 900,
    defaultHeight: 640,
    minWidth: 600,
    minHeight: 420,
  },
  {
    appId: "play",
    label: "开始游戏",
    shortLabel: "游戏",
    routeName: "play",
    routePath: "/play",
    title: "游戏前端",
    caption: "当前游戏卡的游玩窗口",
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
    label: "控制面板",
    shortLabel: "设置",
    routeName: "settings",
    routePath: "/settings",
    title: "控制面板",
    caption: "平台设置",
    icon: Settings,
    component: SettingsView,
    defaultWidth: 860,
    defaultHeight: 600,
    minWidth: 520,
    minHeight: 400,
  },
  {
    appId: "debug",
    label: "系统监视器",
    shortLabel: "监视器",
    routeName: "debug",
    routePath: "/debug",
    title: "系统监视器",
    caption: "运行时诊断",
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
  label: "游戏启动器",
  shortLabel: "启动器",
  routeName: "game-card-detail",
  routePath: "/cards",
  title: "游戏启动器",
  caption: "游玩与存档",
  icon: Gamepad2,
  component: GameCardDetailView,
  defaultWidth: 1180,
  defaultHeight: 720,
  minWidth: 720,
  minHeight: 460,
}

const workspaceEditorDefinition: DesktopAppDefinition = {
  appId: "workspace-editor",
  label: "编辑器",
  shortLabel: "编辑",
  routeName: "workspace-editor",
  routePath: "/workspace/editor",
  title: "编辑器",
  caption: "工作区文件",
  icon: FilePenLine,
  component: WorkspaceEditorView,
  defaultWidth: 1040,
  defaultHeight: 680,
  minWidth: 680,
  minHeight: 460,
  fullscreenable: true,
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

  if (routeName === "workspace-editor") {
    const cardId = queryString(route.query.cardId)
    const path = queryString(route.query.path)
    const mode = queryString(route.query.mode) === "create" ? "create" : "edit"
    const editorId = queryString(route.query.editorId)
    if (!cardId) {
      return null
    }

    const titlePath = path ? fileName(path) : "新建文件"
    return windowInputFromDefinition(workspaceEditorDefinition, {
      id: editorId
        ? `${workspaceEditorDefinition.appId}:${cardId}:${editorId}`
        : `${workspaceEditorDefinition.appId}:${cardId}:${mode}:${path || "untitled"}`,
      routePath: route.fullPath,
      props: { cardId, path, mode },
      title: mode === "create" ? "新建文件" : titlePath,
      caption: path || "工作区文件",
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
    title?: string
    caption?: string
  },
): DesktopWindowInput {
  return {
    id: input.id,
    appId: app.appId,
    label: app.label,
    shortLabel: app.shortLabel,
    routeName: app.routeName,
    routePath: input.routePath,
    title: input.title ?? app.title,
    caption: input.caption ?? app.caption,
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

function queryString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function fileName(path: string): string {
  const segments = path.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? path
}
