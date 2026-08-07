import { describe, expect, it, vi } from "vitest"
import { clonePlatformConfig, DEFAULT_PLATFORM_CONFIG } from "./platform-config"
import {
  canSelectSpatialMode,
  resolveUiMode,
  SPATIAL_ENVIRONMENT_GUIDANCE,
  SPATIAL_RELEASE_READY,
  switchPlatformUiMode,
} from "./platform-ui-mode"

describe("platform UI mode", () => {
  it("opens production selection while retaining the explicit rollback gate", () => {
    expect(SPATIAL_RELEASE_READY).toBe(true)
    expect(resolveUiMode({
      requested: "spatial",
      dev: false,
      releaseReady: SPATIAL_RELEASE_READY,
      finePointer: true,
      viewport: { width: 1600, height: 900 },
    })).toMatchObject({ mode: "spatial", fallbackReason: null })
    expect(canSelectSpatialMode({ dev: false })).toBe(true)

    expect(resolveUiMode({
      requested: "spatial",
      dev: false,
      releaseReady: false,
      finePointer: true,
      viewport: { width: 1600, height: 900 },
    })).toMatchObject({ mode: "retro", fallbackReason: "release-gate" })
    expect(canSelectSpatialMode({ dev: false, releaseReady: false })).toBe(false)
    expect(canSelectSpatialMode({ dev: true, releaseReady: false })).toBe(true)
  })

  it("allows production selection only after the gate is explicitly open", () => {
    expect(canSelectSpatialMode({ dev: false, releaseReady: true })).toBe(true)
    expect(resolveUiMode({
      requested: "spatial", dev: false, releaseReady: true, finePointer: true,
      viewport: { width: 1024, height: 640 },
    })).toEqual({ mode: "spatial", requested: "spatial", fallbackReason: null })
  })

  it("requires a fine pointer and minimum viewport in every environment", () => {
    expect(resolveUiMode({
      requested: "spatial", dev: false, releaseReady: true, finePointer: false,
      viewport: { width: 1600, height: 900 },
    }).fallbackReason).toBe("coarse-pointer")
    expect(resolveUiMode({
      requested: "spatial", dev: false, releaseReady: true, finePointer: true,
      viewport: { width: 900, height: 900 },
    }).fallbackReason).toBe("viewport-too-small")
    expect(resolveUiMode({
      requested: "spatial", dev: true, releaseReady: false, finePointer: true,
      viewport: { width: 1024, height: 640 },
    }).mode).toBe("spatial")
  })

  it("keeps RetroOS authoritative when it is the requested mode", () => {
    expect(resolveUiMode({
      requested: "retro", dev: false, releaseReady: false, finePointer: false,
      viewport: { width: 320, height: 480 },
    })).toEqual({ mode: "retro", requested: "retro", fallbackReason: null })
  })

  it("publishes one concise environment and fallback contract", () => {
    expect(SPATIAL_ENVIRONMENT_GUIDANCE).toContain("桌面版 Chromium")
    expect(SPATIAL_ENVIRONMENT_GUIDANCE).toContain("HTML-in-Canvas Flag")
    expect(SPATIAL_ENVIRONMENT_GUIDANCE).toContain("鼠标或触控板")
    expect(SPATIAL_ENVIRONMENT_GUIDANCE).toContain("自动回退到 RetroOS")
  })

  it("fully saves before reload without touching location state", async () => {
    const current = clonePlatformConfig(DEFAULT_PLATFORM_CONFIG)
    current.rag.defaultLimit = 7
    const save = vi.fn(async () => undefined)
    const reload = vi.fn()
    await switchPlatformUiMode("spatial", { readConfig: () => current, saveConfig: save, reload })
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      appearance: { uiMode: "spatial" },
      rag: expect.objectContaining({ defaultLimit: 7 }),
    }))
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0])
  })
})
