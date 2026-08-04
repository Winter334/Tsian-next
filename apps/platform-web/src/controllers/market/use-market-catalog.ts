import type { MarketPackage, MarketResourceType } from "@tsian/contracts"
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue"
import { marketApi, type MarketListParams } from "@/platform-host/api-client"
import type { MarketScope, MarketScreen } from "./market-types"

export function useMarketCatalog(loggedIn: Readonly<Ref<boolean>>) {
  const screen = ref<MarketScreen>({ kind: "list" })
  const marketScope = ref<MarketScope>("all")
  const currentType = ref<MarketResourceType>("game_card")
  const packages = ref<MarketPackage[]>([])
  const resourceCounts = ref<Partial<Record<MarketResourceType, number>>>({})
  const loading = ref(false)
  const loadingMore = ref(false)
  const nextCursor = ref<string | null>(null)
  const searchQuery = ref("")
  const tagQuery = ref("")
  const sortMode = ref<"newest" | "downloads">("newest")
  const detailPackage = ref<MarketPackage | null>(null)
  const detailLoading = ref(false)
  const errorMessage = ref("")
  const pageSize = 24
  let listRequestSeq = 0
  let countRequestSeq = 0
  let detailRequestSeq = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null
  let tagTimer: ReturnType<typeof setTimeout> | null = null

  const emptyMessage = computed(() => {
    if (marketScope.value === "mine") {
      if (searchQuery.value || tagQuery.value) return "你的上传中没有匹配的资源。"
      return "你还没有上传过这个类型的资源。"
    }
    if (searchQuery.value || tagQuery.value) return "没有匹配的资源。"
    switch (currentType.value) {
      case "agent": return "创意工坊还没有 Agent，成为第一个上传者吧。"
      case "skill": return "创意工坊还没有 Skill，成为第一个上传者吧。"
      case "tool": return "创意工坊还没有 Tool，成为第一个上传者吧。"
      default: return "创意工坊还没有游戏卡，成为第一个上传者吧。"
    }
  })

  function listParams(cursor?: string): MarketListParams {
    return {
      resourceType: currentType.value,
      q: searchQuery.value || undefined,
      tag: tagQuery.value || undefined,
      sort: sortMode.value,
      limit: pageSize,
      cursor,
    }
  }

  async function refresh(): Promise<void> {
    const requestId = ++listRequestSeq
    loadingMore.value = false
    nextCursor.value = null
    errorMessage.value = ""
    if (marketScope.value === "mine" && !loggedIn.value) {
      packages.value = []
      resourceCounts.value = {}
      loading.value = false
      return
    }
    loading.value = true
    try {
      const result = marketScope.value === "mine"
        ? await marketApi.listMine(listParams())
        : await marketApi.list(listParams())
      if (requestId !== listRequestSeq) return
      packages.value = result.packages
      nextCursor.value = result.nextCursor
    } catch (error) {
      if (requestId === listRequestSeq) {
        errorMessage.value = error instanceof Error ? error.message : "加载创意工坊列表失败。"
      }
    } finally {
      if (requestId === listRequestSeq) loading.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (!nextCursor.value || loadingMore.value || (marketScope.value === "mine" && !loggedIn.value)) return
    const requestId = listRequestSeq
    loadingMore.value = true
    errorMessage.value = ""
    try {
      const result = marketScope.value === "mine"
        ? await marketApi.listMine(listParams(nextCursor.value))
        : await marketApi.list(listParams(nextCursor.value))
      if (requestId !== listRequestSeq) return
      packages.value = [...packages.value, ...result.packages]
      nextCursor.value = result.nextCursor
    } catch (error) {
      if (requestId === listRequestSeq) {
        errorMessage.value = error instanceof Error ? error.message : "加载更多资源失败。"
      }
    } finally {
      if (requestId === listRequestSeq) loadingMore.value = false
    }
  }

  async function refreshCounts(): Promise<void> {
    const requestId = ++countRequestSeq
    if (marketScope.value === "mine" && !loggedIn.value) {
      resourceCounts.value = {}
      return
    }
    try {
      const result = marketScope.value === "mine" ? await marketApi.countsMine() : await marketApi.counts()
      if (requestId === countRequestSeq) resourceCounts.value = result.counts
    } catch {
      if (requestId === countRequestSeq) resourceCounts.value = {}
    }
  }

  function onSearchInput(): void {
    if (searchTimer) clearTimeout(searchTimer)
    invalidatePendingList()
    searchTimer = setTimeout(() => void refresh(), 300)
  }

  function onTagInput(): void {
    if (tagTimer) clearTimeout(tagTimer)
    invalidatePendingList()
    tagTimer = setTimeout(() => void refresh(), 300)
  }

  function invalidatePendingList(): void {
    listRequestSeq++
    loading.value = false
    loadingMore.value = false
    nextCursor.value = null
  }

  function switchType(type: MarketResourceType): void {
    detailRequestSeq++
    currentType.value = type
    detailPackage.value = null
    screen.value = { kind: "list" }
    void refresh()
  }

  function toggleMarketScope(): void {
    detailRequestSeq++
    marketScope.value = marketScope.value === "mine" ? "all" : "mine"
    detailPackage.value = null
    screen.value = { kind: "list" }
    void refresh()
    void refreshCounts()
  }

  function openDetail(id: string): void {
    screen.value = { kind: "detail", id }
    void loadDetail(id)
  }

  async function loadDetail(id: string): Promise<void> {
    const requestId = ++detailRequestSeq
    detailLoading.value = true
    detailPackage.value = null
    errorMessage.value = ""
    try {
      const pkg = await marketApi.get(id)
      if (requestId === detailRequestSeq && screen.value.kind === "detail" && screen.value.id === id) {
        detailPackage.value = pkg
      }
    } catch (error) {
      if (requestId === detailRequestSeq) {
        errorMessage.value = error instanceof Error ? error.message : "加载资源详情失败。"
      }
    } finally {
      if (requestId === detailRequestSeq) detailLoading.value = false
    }
  }

  function goBack(): void {
    detailRequestSeq++
    screen.value = { kind: "list" }
    detailPackage.value = null
  }

  onMounted(() => {
    void refresh()
    void refreshCounts()
  })

  watch(loggedIn, () => {
    if (marketScope.value !== "mine") return
    void refresh()
    void refreshCounts()
  })

  onBeforeUnmount(() => {
    listRequestSeq++
    countRequestSeq++
    detailRequestSeq++
    if (searchTimer) clearTimeout(searchTimer)
    if (tagTimer) clearTimeout(tagTimer)
  })

  return {
    screen,
    marketScope,
    currentType,
    packages,
    resourceCounts,
    loading,
    loadingMore,
    nextCursor,
    searchQuery,
    tagQuery,
    sortMode,
    detailPackage,
    detailLoading,
    errorMessage,
    emptyMessage,
    refresh,
    loadMore,
    refreshCounts,
    onSearchInput,
    onTagInput,
    switchType,
    toggleMarketScope,
    openDetail,
    loadDetail,
    goBack,
  }
}
