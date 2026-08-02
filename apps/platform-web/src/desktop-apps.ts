import type { Component } from "vue"
import type { RouteLocationNormalizedLoaded } from "vue-router"
import {
  detailWindowIdFor,
  editorWindowIdFor,
  fallbackPlatformIcon,
  platformAppById,
  platformLaunchers,
  platformWindowForLauncher,
  platformWindowForRoute,
  type PlatformAppId,
  type PlatformLauncherDescriptor,
  type PlatformWindowDescriptor,
} from "./platform-apps"

export type DesktopAppId = PlatformAppId
export type DesktopLauncher = PlatformLauncherDescriptor

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

export const desktopLaunchers: DesktopLauncher[] = [...platformLaunchers]

export function desktopWindowForLauncher(appId: DesktopAppId): DesktopWindowInput | null {
  const descriptor = platformWindowForLauncher(appId)
  return descriptor ? desktopInput(descriptor) : null
}

export function desktopWindowForRoute(
  route: RouteLocationNormalizedLoaded,
): DesktopWindowInput | null {
  const descriptor = platformWindowForRoute(route)
  return descriptor ? desktopInput(descriptor) : null
}

export function announcementWindowInput(): DesktopWindowInput {
  const descriptor = platformWindowForRoute({
    name: "announcements",
    fullPath: "/announcements",
    params: {},
    query: {},
  })
  if (!descriptor) throw new Error("Announcement app is missing from the platform registry.")
  return desktopInput(descriptor)
}

function desktopInput(descriptor: PlatformWindowDescriptor): DesktopWindowInput {
  const app = platformAppById(descriptor.appId)
  if (!app) throw new Error(`Unknown platform app: ${descriptor.appId}`)
  return {
    ...descriptor,
    component: app.retro.component,
    defaultWidth: app.retro.defaultSize.width,
    defaultHeight: app.retro.defaultSize.height,
    minWidth: app.retro.minSize.width,
    minHeight: app.retro.minSize.height,
    fullscreenable: app.retro.fullscreenable,
  }
}

export { detailWindowIdFor, editorWindowIdFor }
export const fallbackDesktopIcon = fallbackPlatformIcon
