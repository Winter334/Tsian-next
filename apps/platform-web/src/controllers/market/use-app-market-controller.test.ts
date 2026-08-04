import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  exportAgentPackage: vi.fn(),
  exportPlatformGameCardPackage: vi.fn(),
  exportSkillPackage: vi.fn(),
  exportToolPackage: vi.fn(),
  gameCardMarketOriginFromPackage: vi.fn(),
  importPlatformGameCardPackage: vi.fn(),
  inspectPlatformGameCardPackage: vi.fn(),
  inspectResourcePackage: vi.fn(),
  installAgentPackage: vi.fn(),
  installSkillPackage: vi.fn(),
  installToolPackage: vi.fn(),
  listPlatformGameCards: vi.fn(),
  listPlatformSaves: vi.fn(),
  refreshWorkshopGameCardUpdates: vi.fn(),
  updatePlatformGameCardMetadata: vi.fn(),
}))
const api = vi.hoisted(() => ({
  delete: vi.fn(),
  download: vi.fn(),
  update: vi.fn(),
  upload: vi.fn(),
}))
const catalogCommands = vi.hoisted(() => ({
  refresh: vi.fn(async () => undefined),
  refreshCounts: vi.fn(async () => undefined),
}))
const confirmMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onBeforeUnmount: vi.fn() }
})
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/platform-host", () => host)
vi.mock("@/platform-host/api-client", () => ({ marketApi: api }))
vi.mock("@/composables/useConfirm", () => ({ confirm: confirmMock }))
vi.mock("@/composables/useDialogForm", () => ({ openDialogForm: vi.fn() }))
vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/composables/useAuth", async () => {
  const { ref } = await vi.importActual<typeof import("vue")>("vue")
  return {
    useAuth: () => ({
      currentUser: ref({ id: "owner" }),
      loggedIn: ref(true),
    }),
  }
})
vi.mock("./market-constants", () => ({ marketResourceTypeOptions: [] }))
vi.mock("./use-market-catalog", async () => {
  const { ref } = await vi.importActual<typeof import("vue")>("vue")
  return {
    useMarketCatalog: () => ({
      screen: ref({ kind: "list" as const }),
      detailPackage: ref(null),
      errorMessage: ref(""),
      goBack: vi.fn(),
      refresh: catalogCommands.refresh,
      refreshCounts: catalogCommands.refreshCounts,
    }),
  }
})
vi.mock("./use-market-inventory", () => ({
  useMarketInventory: () => ({
    dispose: vi.fn(),
  }),
}))

import { useAppMarketController } from "./use-app-market-controller"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function marketPackage(uploaderId: string) {
  return {
    id: "package",
    resourceType: "agent" as const,
    resourceId: "agent",
    resourceVersion: "0.1.0",
    resourceAuthor: "author",
    name: "Agent",
    summary: "summary",
    tags: [],
    coverUrl: null,
    coverThumbUrl: null,
    uploader: { id: uploaderId, displayName: "User", avatarUrl: null },
    downloadCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  }
}

describe("useAppMarketController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.upload.mockResolvedValue(marketPackage("owner"))
  })

  it("suppresses duplicate uploads while package export is pending", async () => {
    const exported = deferred<Blob>()
    host.exportAgentPackage.mockReturnValueOnce(exported.promise)
    const controller = useAppMarketController()
    const payload = {
      resourceType: "agent" as const,
      source: { kind: "assistant" as const },
      version: "0.1.0",
    }

    const firstUpload = controller.handleUpload(payload)
    await controller.handleUpload(payload)
    exported.resolve(new Blob(["agent"], { type: "application/zip" }))
    await firstUpload

    expect(host.exportAgentPackage).toHaveBeenCalledOnce()
    expect(api.upload).toHaveBeenCalledOnce()
    expect(catalogCommands.refresh).toHaveBeenCalledOnce()
    expect(catalogCommands.refreshCounts).toHaveBeenCalledOnce()
  })

  it("rejects deleting another uploader's package before confirmation or API mutation", async () => {
    const controller = useAppMarketController()

    await controller.handleDeletePackage(marketPackage("someone-else"))

    expect(controller.errorMessage.value).toBe("只能删除自己上传的发布物。")
    expect(confirmMock).not.toHaveBeenCalled()
    expect(api.delete).not.toHaveBeenCalled()
  })
})
