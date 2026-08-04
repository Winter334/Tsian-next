import { describe, expect, it, vi } from "vitest"
import { clonePlatformConfig, DEFAULT_PLATFORM_CONFIG } from "./platform-config"
import {
  canSelectSpatialMode,
  resolveUiMode,
  SPATIAL_RELEASE_READY,
  switchPlatformUiMode,
} from "./platform-ui-mode"

describe("platform UI mode", () => {
  it("keeps production behind the closed release gate", () => {
    expect(SPATIAL_RELEASE_READY).toBe(false)
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

  it("requires a fine pointer and minimum viewport in development", () => {
    expect(resolveUiMode({
      requested: "spatial", dev: true, releaseReady: false, finePointer: false,
      viewport: { width: 1600, height: 900 },
    }).fallbackReason).toBe("coarse-pointer")
    expect(resolveUiMode({
      requested: "spatial", dev: true, releaseReady: false, finePointer: true,
      viewport: { width: 900, height: 900 },
    }).fallbackReason).toBe("viewport-too-small")
    expect(resolveUiMode({
      requested: "spatial", dev: true, releaseReady: false, finePointer: true,
      viewport: { width: 1024, height: 640 },
    }).mode).toBe("spatial")
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
