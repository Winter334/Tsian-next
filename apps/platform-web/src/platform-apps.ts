import type { Component } from "vue"
import { defineAsyncComponent } from "vue"
import {
  Activity,
  Bell,
  Bot,
  CircleUser,
  FilePenLine,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Image,
  MessagesSquare,
  MonitorCog,
  PlaySquare,
  Settings,
  Store,
} from "lucide-vue-next"

export type PlatformAppId =
  | "market"
  | "my-apps"
  | "workspace-explorer"
  | "workspace-editor"
  | "workspace-media"
  | "studio"
  | "assistant"
  | "game-launcher"
  | "play"
  | "settings"
  | "account"
  | "announcements"
  | "debug"

export interface PlatformWindowSize {
  readonly width: number
  readonly height: number
}

export interface PlatformRouteDefinition {
  readonly name: string
  readonly path: string
  readonly props?: boolean
}

export type PlatformWindowIdentityPolicy =
  | { readonly kind: "singleton" }
  | { readonly kind: "card-detail" }
  | { readonly kind: "workspace-editor" }
  | { readonly kind: "workspace-media" }

export interface PlatformRetroPresentation {
  readonly component: Component
  readonly defaultSize: PlatformWindowSize
  readonly minSize: PlatformWindowSize
  readonly fullscreenable?: boolean
}

export interface SpatialPresentationRegistration {
  readonly readiness: "pending" | "ready"
  readonly component?: Component
  readonly defaultSize: PlatformWindowSize
  readonly minSize: PlatformWindowSize
}

export interface PlatformAppDefinition {
  readonly appId: PlatformAppId
  readonly route: PlatformRouteDefinition
  readonly identity: PlatformWindowIdentityPolicy
  readonly launcher: boolean
  readonly label: string
  readonly shortLabel: string
  readonly title: string
  readonly caption: string
  readonly icon: Component
  readonly retro: PlatformRetroPresentation
  readonly spatial: SpatialPresentationRegistration
}

export interface PlatformWindowDescriptor {
  readonly id: string
  readonly appId: PlatformAppId
  readonly routeName: string
  readonly routePath: string
  readonly label: string
  readonly shortLabel: string
  readonly title: string
  readonly caption: string
  readonly icon: Component
  readonly props: Record<string, unknown>
  readonly spatial: SpatialPresentationRegistration
}

export interface PlatformLauncherDescriptor {
  readonly id: PlatformAppId
  readonly label: string
  readonly shortLabel: string
  readonly routePath: string
  readonly icon: Component
  readonly title: string
  readonly caption: string
}

export interface PlatformRouteLocation {
  readonly name?: unknown
  readonly fullPath?: string
  readonly params: Record<string, unknown>
  readonly query: Record<string, unknown>
}

const AppMarketView = defineAsyncComponent(() => import("./views/AppMarketView.vue"))
const GameCardLibraryView = defineAsyncComponent(() => import("./views/GameCardLibraryView.vue"))
const WorkspaceExplorerView = defineAsyncComponent(() => import("./views/WorkspaceExplorerView.vue"))
const WorkspaceEditorView = defineAsyncComponent(() => import("./views/WorkspaceEditorView.vue"))
const WorkspaceMediaView = defineAsyncComponent(() => import("./views/WorkspaceMediaView.vue"))
const StudioView = defineAsyncComponent(() => import("./views/StudioView.vue"))
const AssistantView = defineAsyncComponent(() => import("./views/AssistantView.vue"))
const GameCardDetailView = defineAsyncComponent(() => import("./views/GameCardDetailView.vue"))
const PlayView = defineAsyncComponent(() => import("./views/PlayView.vue"))
const SettingsView = defineAsyncComponent(() => import("./views/SettingsView.vue"))
const AccountView = defineAsyncComponent(() => import("./views/AccountView.vue"))
const AnnouncementCenterView = defineAsyncComponent(() => import("./views/AnnouncementCenterView.vue"))
const DebugView = defineAsyncComponent(() => import("./views/DebugView.vue"))
const SpatialAppMarketView = defineAsyncComponent(() => import("./spatial/apps/market/SpatialAppMarketView.vue"))
const SpatialGameCardLibraryView = defineAsyncComponent(() => import("./spatial/apps/library/SpatialGameCardLibraryView.vue"))
const SpatialGameCardDetailView = defineAsyncComponent(() => import("./spatial/apps/game-card-detail/SpatialGameCardDetailView.vue"))

function presentation(
  component: Component,
  defaultSize: PlatformWindowSize,
  minSize: PlatformWindowSize,
  fullscreenable = false,
  spatialComponent?: Component,
): Pick<PlatformAppDefinition, "retro" | "spatial"> {
  const spatialDefaultSize = {
    width: Math.min(defaultSize.width, 760),
    height: Math.min(defaultSize.height, 560),
  }
  const spatialMinSize = {
    width: Math.min(minSize.width, 480),
    height: Math.min(minSize.height, 320),
  }
  return {
    retro: { component, defaultSize, minSize, fullscreenable },
    spatial: {
      readiness: spatialComponent ? "ready" : "pending",
      ...(spatialComponent ? { component: spatialComponent } : {}),
      defaultSize: spatialDefaultSize,
      minSize: spatialMinSize,
    },
  }
}

export const platformAppRegistry: readonly PlatformAppDefinition[] = Object.freeze([
  {
    appId: "market", launcher: true,
    route: { name: "app-market", path: "/market" }, identity: { kind: "singleton" },
    label: "创意工坊", shortLabel: "工坊", title: "创意工坊", caption: "分享与安装创意资源", icon: Store,
    ...presentation(AppMarketView, { width: 980, height: 620 }, { width: 560, height: 420 }, true, SpatialAppMarketView),
  },
  {
    appId: "my-apps", launcher: true,
    route: { name: "library", path: "/library" }, identity: { kind: "singleton" },
    label: "我的应用", shortLabel: "应用", title: "我的应用", caption: "已安装的游戏卡", icon: FolderOpen,
    ...presentation(GameCardLibraryView, { width: 1120, height: 680 }, { width: 620, height: 440 }, true, SpatialGameCardLibraryView),
  },
  {
    appId: "workspace-explorer", launcher: true,
    route: { name: "workspace", path: "/workspace" }, identity: { kind: "singleton" },
    label: "资源管理器", shortLabel: "资源管理器", title: "资源管理器", caption: "游戏卡内容与存档文件", icon: HardDrive,
    ...presentation(WorkspaceExplorerView, { width: 1180, height: 720 }, { width: 720, height: 460 }, true),
  },
  {
    appId: "workspace-editor", launcher: false,
    route: { name: "workspace-editor", path: "/workspace/editor" }, identity: { kind: "workspace-editor" },
    label: "编辑器", shortLabel: "编辑", title: "编辑器", caption: "工作区文件", icon: FilePenLine,
    ...presentation(WorkspaceEditorView, { width: 1040, height: 680 }, { width: 680, height: 460 }, true),
  },
  {
    appId: "workspace-media", launcher: false,
    route: { name: "workspace-media", path: "/workspace/media" }, identity: { kind: "workspace-media" },
    label: "媒体查看器", shortLabel: "媒体", title: "媒体查看器", caption: "图片 / 音频 / 视频", icon: Image,
    ...presentation(WorkspaceMediaView, { width: 980, height: 640 }, { width: 520, height: 420 }, true),
  },
  {
    appId: "studio", launcher: true,
    route: { name: "studio", path: "/studio" }, identity: { kind: "singleton" },
    label: "工作室", shortLabel: "工作室", title: "工作室", caption: "当前游戏卡的 Agent 配置", icon: Bot,
    ...presentation(StudioView, { width: 1080, height: 680 }, { width: 680, height: 460 }, true),
  },
  {
    appId: "assistant", launcher: true,
    route: { name: "assistant", path: "/assistant" }, identity: { kind: "singleton" },
    label: "桌面助手", shortLabel: "助手", title: "桌面助手", caption: "游戏卡问答与编辑辅助", icon: MessagesSquare,
    ...presentation(AssistantView, { width: 900, height: 640 }, { width: 600, height: 420 }, true),
  },
  {
    appId: "game-launcher", launcher: false,
    route: { name: "game-card-detail", path: "/cards/:cardId", props: true }, identity: { kind: "card-detail" },
    label: "应用属性", shortLabel: "属性", title: "应用属性", caption: "游戏卡属性与存档", icon: Gamepad2,
    ...presentation(GameCardDetailView, { width: 1180, height: 720 }, { width: 720, height: 460 }, true, SpatialGameCardDetailView),
  },
  {
    appId: "play", launcher: true,
    route: { name: "play", path: "/play" }, identity: { kind: "singleton" },
    label: "开始游戏", shortLabel: "游戏", title: "游戏前端", caption: "当前游戏卡的游玩窗口", icon: PlaySquare,
    ...presentation(PlayView, { width: 1180, height: 720 }, { width: 680, height: 460 }, true),
  },
  {
    appId: "settings", launcher: true,
    route: { name: "settings", path: "/settings" }, identity: { kind: "singleton" },
    label: "控制面板", shortLabel: "设置", title: "控制面板", caption: "平台设置", icon: Settings,
    ...presentation(SettingsView, { width: 860, height: 600 }, { width: 520, height: 400 }, true),
  },
  {
    appId: "account", launcher: true,
    route: { name: "account", path: "/account" }, identity: { kind: "singleton" },
    label: "账号中心", shortLabel: "账号", title: "账号中心", caption: "操作员身份", icon: CircleUser,
    ...presentation(AccountView, { width: 720, height: 540 }, { width: 480, height: 420 }),
  },
  {
    appId: "announcements", launcher: false,
    route: { name: "announcements", path: "/announcements" }, identity: { kind: "singleton" },
    label: "公告中心", shortLabel: "公告", title: "公告中心", caption: "平台消息与更新记录", icon: Bell,
    ...presentation(AnnouncementCenterView, { width: 760, height: 560 }, { width: 460, height: 360 }),
  },
  {
    appId: "debug", launcher: true,
    route: { name: "debug", path: "/debug" }, identity: { kind: "singleton" },
    label: "系统监视器", shortLabel: "监视器", title: "系统监视器", caption: "运行时诊断", icon: Activity,
    ...presentation(DebugView, { width: 1180, height: 720 }, { width: 720, height: 460 }, true),
  },
])

export const platformLaunchers: readonly PlatformLauncherDescriptor[] = Object.freeze(
  platformAppRegistry.filter((app) => app.launcher).map((app) => ({
    id: app.appId,
    label: app.label,
    shortLabel: app.shortLabel,
    routePath: app.route.path,
    icon: app.icon,
    title: app.title,
    caption: app.caption,
  })),
)

export function platformAppById(appId: PlatformAppId): PlatformAppDefinition | null {
  return platformAppRegistry.find((candidate) => candidate.appId === appId) ?? null
}

export function platformWindowForLauncher(appId: PlatformAppId): PlatformWindowDescriptor | null {
  const app = platformAppById(appId)
  if (!app?.launcher) return null
  return descriptorFromDefinition(app, {
    id: app.appId,
    routePath: app.route.path,
    props: {},
  })
}

export function platformWindowForRoute(route: PlatformRouteLocation): PlatformWindowDescriptor | null {
  const routeName = String(route.name ?? "")
  if (!routeName || routeName === "desktop") return null
  const app = platformAppRegistry.find((candidate) => candidate.route.name === routeName)
  if (!app) return null
  const routePath = route.fullPath || app.route.path

  switch (app.identity.kind) {
    case "singleton":
      return descriptorFromDefinition(app, { id: app.appId, routePath, props: {} })
    case "card-detail": {
      const cardId = routeValue(route.params.cardId)
      if (!cardId) return null
      return descriptorFromDefinition(app, {
        id: detailWindowIdFor(cardId),
        routePath,
        props: { cardId },
      })
    }
    case "workspace-editor": {
      const cardId = routeValue(route.query.cardId)
      const path = routeValue(route.query.path)
      const mode = routeValue(route.query.mode) === "create" ? "create" : "edit"
      const editorId = routeValue(route.query.editorId)
      if (!cardId && !isTsianPath(path)) return null
      const scopeKey = cardId || "tsian-local"
      return descriptorFromDefinition(app, {
        id: editorWindowIdFor({ scopeKey, editorId, mode, path }),
        routePath,
        props: { cardId, path, mode, editorId },
        title: mode === "create" ? "新建文件" : fileName(path) || "新建文件",
        caption: path || "工作区文件",
      })
    }
    case "workspace-media": {
      const cardId = routeValue(route.query.cardId)
      const path = routeValue(route.query.path)
      if (!path || (!cardId && !isTsianPath(path))) return null
      const scopeKey = cardId || "tsian-local"
      return descriptorFromDefinition(app, {
        id: `${app.appId}:${scopeKey}:${path}`,
        routePath,
        props: { cardId, path },
        title: fileName(path),
        caption: path,
      })
    }
  }
}

function descriptorFromDefinition(
  app: PlatformAppDefinition,
  input: {
    readonly id: string
    readonly routePath: string
    readonly props: Record<string, unknown>
    readonly title?: string
    readonly caption?: string
  },
): PlatformWindowDescriptor {
  return {
    id: input.id,
    appId: app.appId,
    routeName: app.route.name,
    routePath: input.routePath,
    label: app.label,
    shortLabel: app.shortLabel,
    title: input.title ?? app.title,
    caption: input.caption ?? app.caption,
    icon: app.icon,
    props: input.props,
    spatial: app.spatial,
  }
}

export function editorWindowIdFor(input: {
  readonly scopeKey: string
  readonly editorId: string
  readonly mode: string
  readonly path: string
}): string {
  if (input.editorId) return `workspace-editor:${input.scopeKey}:${input.editorId}`
  return `workspace-editor:${input.scopeKey}:${input.mode}:${input.path || "untitled"}`
}

export function detailWindowIdFor(cardId: string): string {
  return `game-launcher:${cardId}`
}

function routeValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function isTsianPath(path: string): boolean {
  return path === ".tsian" || path.startsWith(".tsian/")
}

function fileName(path: string): string {
  const segments = path.split("/").filter(Boolean)
  return segments[segments.length - 1] ?? path
}

export const fallbackPlatformIcon = MonitorCog
