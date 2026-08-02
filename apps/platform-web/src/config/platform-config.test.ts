import { describe, expect, it } from "vitest"
import {
  clonePlatformConfig,
  DEFAULT_PLATFORM_CONFIG,
  mergePlatformConfig,
} from "./platform-config"

describe("platform config appearance", () => {
  it("defaults pre-Spatial configs without resetting other sections", () => {
    const merged = mergePlatformConfig({
      provider: { activeProviderId: "", providerTypes: [], embeddingConfig: {} },
      rag: { defaultLimit: 7, maxLimit: 11 },
      cloudBackup: { autoBackupEnabled: true },
    })
    expect(merged?.appearance).toEqual({ uiMode: "retro" })
    expect(merged?.rag).toEqual({ defaultLimit: 7, maxLimit: 11 })
    expect(merged?.cloudBackup.autoBackupEnabled).toBe(true)
  })

  it("normalizes malformed appearance locally", () => {
    const merged = mergePlatformConfig({
      appearance: { uiMode: "immersive" },
      provider: { activeProviderId: "", providerTypes: [], embeddingConfig: {} },
      checkpointPrune: { keepRecent: 9, sparseEvery: 4 },
    })
    expect(merged?.appearance.uiMode).toBe("retro")
    expect(merged?.checkpointPrune).toEqual({ keepRecent: 9, sparseEvery: 4 })
  })

  it("accepts Spatial and deep-clones appearance", () => {
    const source = clonePlatformConfig(DEFAULT_PLATFORM_CONFIG)
    source.appearance.uiMode = "spatial"
    const cloned = clonePlatformConfig(source)
    cloned.appearance.uiMode = "retro"
    expect(source.appearance.uiMode).toBe("spatial")
  })
})
