import { beforeEach, describe, expect, it, vi } from "vitest"

const storage = vi.hoisted(() => ({
  read: vi.fn<() => Promise<string | null>>(),
  save: vi.fn<(content: string) => Promise<void>>(),
  remove: vi.fn<() => Promise<void>>(),
}))

vi.mock("../storage", () => ({
  readLocalPlatformConfigFileContent: storage.read,
  saveLocalPlatformConfigFile: storage.save,
  deleteLocalPlatformConfigFile: storage.remove,
}))

vi.mock("@/composables/useToast", () => ({
  toast: { error: vi.fn() },
}))

describe("platform config appearance persistence", () => {
  beforeEach(() => {
    storage.read.mockReset()
    storage.save.mockReset()
    storage.remove.mockReset()
    storage.save.mockResolvedValue(undefined)
    storage.remove.mockResolvedValue(undefined)
  })

  it("preheats an old file with Retro default and saves Spatial in the full document", async () => {
    storage.read.mockResolvedValue(JSON.stringify({
      provider: { activeProviderId: "", providerTypes: [], embeddingConfig: {} },
      rag: { defaultLimit: 7, maxLimit: 9 },
    }))
    const config = await import("./platform-config")
    await config.preheatPlatformConfig()
    expect(config.getPlatformConfig()).toMatchObject({
      appearance: { uiMode: "retro" },
      rag: { defaultLimit: 7, maxLimit: 9 },
    })
    await config.savePlatformConfig({
      ...config.getPlatformConfig(),
      appearance: { uiMode: "spatial" },
    })
    const saved = JSON.parse(storage.save.mock.calls[0][0]) as Record<string, unknown>
    expect(saved).toMatchObject({
      appearance: { uiMode: "spatial" },
      rag: { defaultLimit: 7, maxLimit: 9 },
    })
  })
})
