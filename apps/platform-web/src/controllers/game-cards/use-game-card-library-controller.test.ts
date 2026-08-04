import { beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  copyPlatformGameCardAsLocal: vi.fn(),
  createDefaultPlatformGameCard: vi.fn(),
  deletePlatformGameCard: vi.fn(),
  getPlatformActiveGameCardId: vi.fn(),
  getWorkshopGameCardUpdate: vi.fn(),
  importPlatformGameCardPackage: vi.fn(),
  inspectPlatformGameCardPackage: vi.fn(),
  installWorkshopGameCardUpdate: vi.fn(),
  listPlatformGameCards: vi.fn(),
  listPlatformSaves: vi.fn(),
  refreshWorkshopGameCardUpdates: vi.fn(),
  setPlatformActiveGameCard: vi.fn(),
}))

const confirmMock = vi.hoisted(() => vi.fn(async () => true))
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onMounted: vi.fn(), onBeforeUnmount: vi.fn() }
})
vi.mock("@/platform-host", () => host)
vi.mock("@/composables/useConfirm", () => ({ confirm: confirmMock }))
vi.mock("@/composables/useToast", () => ({ toast: toastMock }))

import { useGameCardLibraryController } from "./use-game-card-library-controller"

function card(id: string) {
  return {
    id,
    source: "local" as const,
    manifest: {
      schema: "tsian.game-card.v1" as const,
      id,
      name: id,
      version: "0.1.0",
      summary: `${id} summary`,
      runtime: { entrypoints: { playerTurn: "agent" } },
    },
    createdAt: 1,
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

describe("useGameCardLibraryController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    host.getWorkshopGameCardUpdate.mockReturnValue(null)
    host.refreshWorkshopGameCardUpdates.mockResolvedValue(undefined)
  })

  it("keeps the newest authoritative refresh when requests resolve out of order", async () => {
    const firstCards = deferred<ReturnType<typeof card>[]>()
    const secondCards = deferred<ReturnType<typeof card>[]>()
    host.listPlatformGameCards
      .mockReturnValueOnce(firstCards.promise)
      .mockReturnValueOnce(secondCards.promise)
    host.getPlatformActiveGameCardId
      .mockResolvedValueOnce("old")
      .mockResolvedValueOnce("new")

    const controller = useGameCardLibraryController({ openCard: vi.fn() })
    const firstRefresh = controller.refreshCards()
    const secondRefresh = controller.refreshCards()

    secondCards.resolve([card("new")])
    await secondRefresh
    firstCards.resolve([card("old")])
    await firstRefresh

    expect(controller.cards.value.map((item) => item.id)).toEqual(["new"])
    expect(controller.activeGameCardId.value).toBe("new")
    expect(controller.loading.value).toBe(false)
    expect(host.refreshWorkshopGameCardUpdates).toHaveBeenCalledTimes(1)
  })

  it("suppresses duplicate load mutations while one is pending", async () => {
    const pending = deferred<ReturnType<typeof card>>()
    host.setPlatformActiveGameCard.mockReturnValueOnce(pending.promise)
    const controller = useGameCardLibraryController({ openCard: vi.fn() })
    const target = card("target")

    const firstLoad = controller.loadCard(target)
    await expect(controller.loadCard(target)).resolves.toBe(false)
    pending.resolve(target)
    await expect(firstLoad).resolves.toBe(true)

    expect(host.setPlatformActiveGameCard).toHaveBeenCalledTimes(1)
    expect(controller.activeGameCardId.value).toBe("target")
  })

  it("surfaces copy failures without discarding the current library", async () => {
    host.copyPlatformGameCardAsLocal.mockRejectedValueOnce(new Error("copy failed"))
    const controller = useGameCardLibraryController({ openCard: vi.fn() })
    controller.cards.value = [card("kept")]

    await controller.copyCard(controller.cards.value[0]!)

    expect(controller.actionError.value).toBe("copy failed")
    expect(controller.cards.value.map((item) => item.id)).toEqual(["kept"])
    expect(toastMock.error).toHaveBeenCalledWith("copy failed")
  })

  it("suppresses duplicate workshop updates while confirmation is pending", async () => {
    const confirmation = deferred<boolean>()
    const target = card("target")
    const update = {
      cardId: "target",
      packageId: "package",
      resourceId: "target",
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      marketPackage: { id: "package" },
    }
    host.getWorkshopGameCardUpdate.mockReturnValue(update)
    host.installWorkshopGameCardUpdate.mockResolvedValue(target)
    confirmMock.mockReturnValueOnce(confirmation.promise)
    const controller = useGameCardLibraryController({ openCard: vi.fn() })

    const firstUpdate = controller.updateCardFromWorkshop(target)
    await controller.updateCardFromWorkshop(target)
    confirmation.resolve(true)
    await firstUpdate

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(host.installWorkshopGameCardUpdate).toHaveBeenCalledTimes(1)
  })
})
