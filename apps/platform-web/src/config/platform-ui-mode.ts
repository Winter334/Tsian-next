import {
  getPlatformConfig,
  savePlatformConfig,
  type PlatformConfig,
  type PlatformUiMode,
} from "./platform-config"

/** Production gate; set false for an immediate RetroOS rollback without data migration. */
export const SPATIAL_RELEASE_READY = true
export const SPATIAL_MIN_VIEWPORT = Object.freeze({ width: 1024, height: 640 })
export const SPATIAL_ENVIRONMENT_GUIDANCE = "需要桌面版 Chromium、实验性 HTML-in-Canvas Flag 与鼠标或触控板；环境不兼容时会自动回退到 RetroOS。"

export type UiModeFallbackReason =
  | "release-gate"
  | "coarse-pointer"
  | "viewport-too-small"

export interface UiModeResolution {
  readonly mode: PlatformUiMode
  readonly requested: PlatformUiMode
  readonly fallbackReason: UiModeFallbackReason | null
}

export function resolveUiMode(input: {
  readonly requested: PlatformUiMode
  readonly dev: boolean
  readonly releaseReady: boolean
  readonly finePointer: boolean
  readonly viewport: { readonly width: number; readonly height: number }
}): UiModeResolution {
  if (input.requested === "retro") {
    return { mode: "retro", requested: input.requested, fallbackReason: null }
  }
  if (!input.dev && !input.releaseReady) {
    return { mode: "retro", requested: input.requested, fallbackReason: "release-gate" }
  }
  if (!input.finePointer) {
    return { mode: "retro", requested: input.requested, fallbackReason: "coarse-pointer" }
  }
  if (input.viewport.width < SPATIAL_MIN_VIEWPORT.width
    || input.viewport.height < SPATIAL_MIN_VIEWPORT.height) {
    return { mode: "retro", requested: input.requested, fallbackReason: "viewport-too-small" }
  }
  return { mode: "spatial", requested: input.requested, fallbackReason: null }
}

export function canSelectSpatialMode(input: {
  readonly dev?: boolean
  readonly releaseReady?: boolean
} = {}): boolean {
  return (input.dev ?? import.meta.env.DEV)
    || (input.releaseReady ?? SPATIAL_RELEASE_READY)
}

export function currentUiModeEnvironment(): {
  readonly finePointer: boolean
  readonly viewport: { readonly width: number; readonly height: number }
} {
  return {
    finePointer: window.matchMedia("(pointer: fine)").matches,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

export function uiModeFallbackMessage(reason: UiModeFallbackReason): string {
  switch (reason) {
    case "release-gate":
      return "Spatial Desktop 尚未通过正式发布门禁，已使用 RetroOS。"
    case "coarse-pointer":
      return "Spatial Desktop 需要鼠标或触控板，已使用 RetroOS。"
    case "viewport-too-small":
      return `Spatial Desktop 需要至少 ${SPATIAL_MIN_VIEWPORT.width}×${SPATIAL_MIN_VIEWPORT.height} 的视口，已使用 RetroOS。`
  }
}

export interface UiModeSwitchDependencies {
  readonly readConfig: () => PlatformConfig
  readonly saveConfig: (config: PlatformConfig) => Promise<void>
  readonly reload: () => void
}

const DEFAULT_SWITCH_DEPENDENCIES: UiModeSwitchDependencies = {
  readConfig: getPlatformConfig,
  saveConfig: savePlatformConfig,
  reload: () => window.location.reload(),
}

/** Full-save first, then reload. Location/hash is intentionally left untouched. */
export async function switchPlatformUiMode(
  uiMode: PlatformUiMode,
  dependencies: UiModeSwitchDependencies = DEFAULT_SWITCH_DEPENDENCIES,
): Promise<void> {
  const current = dependencies.readConfig()
  await dependencies.saveConfig({
    ...current,
    appearance: { ...current.appearance, uiMode },
  })
  dependencies.reload()
}
