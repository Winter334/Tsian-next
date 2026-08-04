import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  counts: vi.fn(),
  countsMine: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  listMine: vi.fn(),
}))

vi.mock("vue", async () => {
  const actual = await vi.importActual<typeof import("vue")>("vue")
  return { ...actual, onMounted: vi.fn(), onBeforeUnmount: vi.fn() }
})
vi.mock("@/platform-host/api-client", () => ({ marketApi: api }))

import { ref } from "vue"
import { useMarketCatalog } from "./use-market-catalog"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}

function marketPackage(id: string) {
  return {
    id,
    resourceType: "game_card" as const,
    resourceId: id,
    resourceVersion: "0.1.0",
    resourceAuthor: "author",
    name: id,
    summary: `${id} summary`,
    tags: [],
    coverUrl: null,
    coverThumbUrl: null,
    uploader: { id: "user", displayName: "User", avatarUrl: null },
    downloadCount: 0,
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  }
}

describe("useMarketCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it("does not let an older detail request replace the active resource", async () => {
    const first = deferred<ReturnType<typeof marketPackage>>()
    const second = deferred<ReturnType<typeof marketPackage>>()
    api.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const catalog = useMarketCatalog(ref(true))

    catalog.screen.value = { kind: "detail", id: "old" }
    const firstLoad = catalog.loadDetail("old")
    catalog.screen.value = { kind: "detail", id: "new" }
    const secondLoad = catalog.loadDetail("new")
    second.resolve(marketPackage("new"))
    await secondLoad
    first.resolve(marketPackage("old"))
    await firstLoad

    expect(catalog.detailPackage.value?.id).toBe("new")
    expect(catalog.detailLoading.value).toBe(false)
  })

  it("keeps counts from the newest scope when requests resolve out of order", async () => {
    const all = deferred<{ counts: { game_card: number } }>()
    const mine = deferred<{ counts: { game_card: number } }>()
    api.counts.mockReturnValueOnce(all.promise)
    api.countsMine.mockReturnValueOnce(mine.promise)
    const catalog = useMarketCatalog(ref(true))

    const allRefresh = catalog.refreshCounts()
    catalog.marketScope.value = "mine"
    const mineRefresh = catalog.refreshCounts()
    mine.resolve({ counts: { game_card: 2 } })
    await mineRefresh
    all.resolve({ counts: { game_card: 99 } })
    await allRefresh

    expect(catalog.resourceCounts.value).toEqual({ game_card: 2 })
  })

  it("invalidates load-more results as soon as filter input changes", async () => {
    vi.useFakeTimers()
    const nextPage = deferred<{ packages: ReturnType<typeof marketPackage>[]; nextCursor: string | null }>()
    api.list.mockReturnValueOnce(nextPage.promise)
    const catalog = useMarketCatalog(ref(true))
    catalog.packages.value = [marketPackage("kept")]
    catalog.nextCursor.value = "cursor"

    const loadingMore = catalog.loadMore()
    catalog.searchQuery.value = "new query"
    catalog.onSearchInput()
    nextPage.resolve({ packages: [marketPackage("stale")], nextCursor: null })
    await loadingMore

    expect(catalog.packages.value.map((pkg) => pkg.id)).toEqual(["kept"])
    expect(catalog.nextCursor.value).toBeNull()
    expect(catalog.loadingMore.value).toBe(false)
  })
})
