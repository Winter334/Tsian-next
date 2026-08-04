import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const host = vi.hoisted(() => ({
  deletePlatformGameCard: vi.fn(),
  exportPlatformGameCardFrontendPackage: vi.fn(),
  exportPlatformGameCardPackage: vi.fn(),
  getPlatformActiveGameCardId: vi.fn(),
  getPlatformGameCard: vi.fn(),
  importPlatformGameCardFrontendPackage: vi.fn(),
  listPlatformGameCardFrontendFiles: vi.fn(),
  setPlatformActiveGameCard: vi.fn(),
  setPlatformGameCardCover: vi.fn(),
  updatePlatformGameCardFrontend: vi.fn(),
  updatePlatformGameCardMetadata: vi.fn(),
}))

const closeGuards = vi.hoisted(() => ({
  clearBeforeClose: vi.fn(),
  setBeforeClose: vi.fn(),
}))
const confirmMock = vi.hoisted(() => vi.fn(async () => true))

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onMounted: vi.fn(), onBeforeUnmount: vi.fn() }
})
vi.mock("@/platform-host", () => host)
vi.mock("@/platform-apps", () => ({ detailWindowIdFor: (id: string) => `detail:${id}` }))
vi.mock("@/composables/window-close-guards", () => closeGuards)
vi.mock("@/composables/useConfirm", () => ({ confirm: confirmMock }))
vi.mock("@/composables/useToast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { nextTick, onMounted, ref } from "vue"
import { useGameCardDetailController } from "./use-game-card-detail-controller"

function card(id: string, source: "local" | "builtin" = "local") {
  return {
    id,
    source,
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

describe("useGameCardDetailController", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    confirmMock.mockResolvedValue(true)
    host.getPlatformActiveGameCardId.mockResolvedValue(null)
    host.listPlatformGameCardFrontendFiles.mockResolvedValue([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("does not let an older card route request replace the latest detail", async () => {
    let cardId = "old"
    const oldCard = deferred<ReturnType<typeof card> | null>()
    const newCard = deferred<ReturnType<typeof card> | null>()
    host.getPlatformGameCard
      .mockReturnValueOnce(oldCard.promise)
      .mockReturnValueOnce(newCard.promise)
    const controller = useGameCardDetailController({ cardId: () => cardId, onDeleted: vi.fn() })

    const oldRefresh = controller.refreshData()
    cardId = "new"
    const newRefresh = controller.refreshData()
    newCard.resolve(card("new"))
    await newRefresh
    oldCard.resolve(card("old"))
    await oldRefresh

    expect(controller.card.value?.id).toBe("new")
    expect(controller.metadataName.value).toBe("new")
    expect(controller.loading.value).toBe(false)
  })

  it("revokes owned cover preview URLs on replacement and reset", async () => {
    host.getPlatformGameCard.mockResolvedValue(card("editable"))
    const createObjectURL = vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second")
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    const controller = useGameCardDetailController({ cardId: "editable", onDeleted: vi.fn() })
    await controller.refreshData()

    controller.stageCoverUpload(new File(["first"], "first.png", { type: "image/png" }))
    controller.stageCoverUpload(new File(["second"], "second.png", { type: "image/png" }))
    controller.resetCoverDraft()

    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL.mock.calls).toEqual([["blob:first"], ["blob:second"]])
  })

  it("enforces builtin mutation restrictions inside the controller", async () => {
    host.getPlatformGameCard.mockResolvedValue(card("builtin", "builtin"))
    const controller = useGameCardDetailController({ cardId: "builtin", onDeleted: vi.fn() })
    await controller.refreshData()
    controller.metadataName.value = "changed"

    await controller.saveProperties()
    controller.stageCoverUpload(new File(["cover"], "cover.png", { type: "image/png" }))

    expect(host.updatePlatformGameCardMetadata).not.toHaveBeenCalled()
    expect(host.setPlatformGameCardCover).not.toHaveBeenCalled()
    expect(controller.coverError.value).toMatch(/内置游戏卡/)
  })

  it("keeps a property save pinned to its original card when the route changes", async () => {
    const cardId = ref("old")
    const metadataWrite = deferred<ReturnType<typeof card>>()
    host.getPlatformGameCard.mockImplementation(async (id: string) => card(id))
    host.updatePlatformGameCardMetadata.mockReturnValueOnce(metadataWrite.promise)
    host.setPlatformGameCardCover.mockResolvedValueOnce(card("old"))
    const controller = useGameCardDetailController({ cardId, onDeleted: vi.fn() })
    await controller.refreshData()
    controller.coverUrlDraft.value = "https://example.com/old.png"
    controller.applyCoverUrlDraft()

    const saving = controller.saveProperties()
    cardId.value = "new"
    await nextTick()
    await vi.waitFor(() => expect(controller.card.value?.id).toBe("new"))
    metadataWrite.resolve(card("old"))
    await saving

    expect(host.updatePlatformGameCardMetadata).toHaveBeenCalledWith("old", expect.any(Object))
    expect(host.setPlatformGameCardCover).toHaveBeenCalledWith("old", {
      kind: "url",
      url: "https://example.com/old.png",
    })
    expect(controller.card.value?.id).toBe("new")
    expect(controller.metadataName.value).toBe("new")
  })

  it("guards duplicate delete confirmation and never deletes a later route card", async () => {
    const cardId = ref("old")
    const confirmation = deferred<boolean>()
    const onDeleted = vi.fn()
    host.getPlatformGameCard.mockImplementation(async (id: string) => card(id))
    host.deletePlatformGameCard.mockResolvedValue(undefined)
    confirmMock.mockReturnValueOnce(confirmation.promise)
    const controller = useGameCardDetailController({ cardId, onDeleted })
    await controller.refreshData()

    const firstDelete = controller.deleteCurrentCard()
    await controller.deleteCurrentCard()
    cardId.value = "new"
    await nextTick()
    await vi.waitFor(() => expect(controller.card.value?.id).toBe("new"))
    confirmation.resolve(true)
    await firstDelete

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(host.deletePlatformGameCard).toHaveBeenCalledOnce()
    expect(host.deletePlatformGameCard).toHaveBeenCalledWith("old")
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it("registers a draft close guard whose veto does not mutate the draft", async () => {
    vi.stubGlobal("window", new EventTarget())
    host.getPlatformGameCard.mockResolvedValue(card("editable"))
    const controller = useGameCardDetailController({ cardId: "editable", onDeleted: vi.fn() })
    const mountedCalls = vi.mocked(onMounted).mock.calls
    const mounted = mountedCalls[mountedCalls.length - 1]?.[0]
    expect(mounted).toBeTypeOf("function")
    mounted?.()
    await vi.waitFor(() => expect(controller.card.value?.id).toBe("editable"))
    controller.metadataName.value = "unsaved"
    confirmMock.mockResolvedValueOnce(false)
    const guardCalls = closeGuards.setBeforeClose.mock.calls
    const guard = guardCalls[guardCalls.length - 1]?.[1]

    await expect(guard?.()).resolves.toBe(false)
    expect(controller.metadataName.value).toBe("unsaved")
    expect(closeGuards.setBeforeClose).toHaveBeenCalledWith("detail:editable", expect.any(Function))
  })
})
