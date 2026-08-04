import { onBeforeUnmount, onMounted, ref } from "vue"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import { getGameCardSummary, getGameCardTitle } from "@/lib/game-card-display"
import {
  ACTIVE_CARD_CHANGED_EVENT,
  GAME_CARDS_CHANGED_EVENT,
  isActiveCardChangedEvent,
  isGameCardsChangedEvent,
} from "@/lib/platform-events"
import {
  copyPlatformGameCardAsLocal,
  createDefaultPlatformGameCard,
  deletePlatformGameCard,
  getPlatformActiveGameCardId,
  getWorkshopGameCardUpdate,
  importPlatformGameCardPackage,
  installWorkshopGameCardUpdate,
  inspectPlatformGameCardPackage,
  listPlatformGameCards,
  listPlatformSaves,
  refreshWorkshopGameCardUpdates,
  setPlatformActiveGameCard,
  type WorkshopGameCardUpdateInfo,
} from "@/platform-host"
import type { LocalGameCardRecord } from "@/storage/db"

export interface GameCardLibraryControllerOptions {
  openCard(cardId: string): void
}

export function useGameCardLibraryController(options: GameCardLibraryControllerOptions) {
  const cards = ref<LocalGameCardRecord[]>([])
  const selectedCardId = ref("")
  const activeGameCardId = ref("")
  const loading = ref(false)
  const importing = ref(false)
  const deleting = ref(false)
  const loadingCard = ref(false)
  const creating = ref(false)
  const copyingId = ref("")
  const updatingCardId = ref("")
  const errorMessage = ref("")
  const actionError = ref("")
  const feedback = ref("")
  let refreshRequestSeq = 0

  async function refreshCards(): Promise<void> {
    const requestId = ++refreshRequestSeq
    loading.value = true
    errorMessage.value = ""
    try {
      const [loadedCards, loadedActiveGameCardId] = await Promise.all([
        listPlatformGameCards(),
        getPlatformActiveGameCardId(),
      ])
      if (requestId !== refreshRequestSeq) return
      cards.value = loadedCards.filter((card) => card.source !== "builtin")
      activeGameCardId.value = loadedActiveGameCardId ?? ""
      if (!cards.value.some((card) => card.id === selectedCardId.value)) {
        selectedCardId.value = ""
      }
      void refreshWorkshopGameCardUpdates()
    } catch (error) {
      if (requestId === refreshRequestSeq) {
        errorMessage.value = error instanceof Error ? error.message : "无法加载游戏卡。"
      }
    } finally {
      if (requestId === refreshRequestSeq) loading.value = false
    }
  }

  async function createDefaultCard(): Promise<void> {
    if (creating.value) return
    creating.value = true
    actionError.value = ""
    feedback.value = ""
    try {
      const created = await createDefaultPlatformGameCard()
      feedback.value = `已创建并加载：${getGameCardTitle(created)}`
      toast.success(`已创建游戏卡：${getGameCardTitle(created)}`)
      await refreshCards()
      options.openCard(created.id)
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "创建游戏卡失败。"
    } finally {
      creating.value = false
    }
  }

  function canLoadCard(card: LocalGameCardRecord): boolean {
    return card.id !== activeGameCardId.value && !loadingCard.value
  }

  function canDeleteCard(card: LocalGameCardRecord): boolean {
    return card.source !== "builtin" && !deleting.value
  }

  function cardUpdateInfo(card: LocalGameCardRecord): WorkshopGameCardUpdateInfo | null {
    return getWorkshopGameCardUpdate(card.id)
  }

  async function loadCard(card: LocalGameCardRecord): Promise<boolean> {
    if (!canLoadCard(card)) return false
    loadingCard.value = true
    actionError.value = ""
    feedback.value = ""
    try {
      const loaded = await setPlatformActiveGameCard(card.id)
      activeGameCardId.value = loaded.id
      feedback.value = `已加载：${getGameCardTitle(loaded)}`
      return true
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "加载游戏卡失败。"
      return false
    } finally {
      loadingCard.value = false
    }
  }

  async function copyCard(card: LocalGameCardRecord): Promise<void> {
    if (copyingId.value) return
    copyingId.value = card.id
    actionError.value = ""
    feedback.value = ""
    try {
      const copied = await copyPlatformGameCardAsLocal(card.id, {
        name: `${getGameCardTitle(card)} 副本`,
        summary: getGameCardSummary(card),
      })
      toast.success(`已复制：${getGameCardTitle(copied)}`)
      feedback.value = `已复制：${getGameCardTitle(copied)}`
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "复制游戏卡失败。"
      toast.error(actionError.value)
    } finally {
      copyingId.value = ""
    }
  }

  async function updateCardFromWorkshop(card: LocalGameCardRecord): Promise<void> {
    const update = cardUpdateInfo(card)
    if (!update || updatingCardId.value) return
    selectedCardId.value = card.id
    updatingCardId.value = card.id
    actionError.value = ""
    feedback.value = ""
    try {
      const confirmed = await confirm({
        title: "发现新版本",
        message: `当前版本：${update.currentVersion}\n最新版本：${update.latestVersion}\n\n更新会替换本地游戏卡内容，已有存档会保留。`,
        severity: "danger",
        confirmText: "更新",
      })
      if (!confirmed) return
      const imported = await installWorkshopGameCardUpdate(update)
      toast.success(`已更新：${getGameCardTitle(imported)}`)
      feedback.value = `已更新：${getGameCardTitle(imported)}`
      await refreshCards()
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "更新游戏卡失败。"
    } finally {
      updatingCardId.value = ""
    }
  }

  async function importPackage(file: File): Promise<void> {
    if (importing.value) return
    importing.value = true
    actionError.value = ""
    feedback.value = ""
    try {
      const inspection = await inspectPlatformGameCardPackage(file)
      const incoming = inspection.manifest
      const existing = cards.value.find((card) => card.manifest.id === incoming.id)
      if (existing) {
        const confirmed = await confirm({
          title: "卡包已安装",
          message: `本地已有「${existing.manifest.name || incoming.name || incoming.id}」。导入后将替换本地卡包，已有存档会保留。`,
          severity: "danger",
          confirmText: "覆盖",
        })
        if (!confirmed) return
      }

      const imported = await importPlatformGameCardPackage(file)
      await refreshWorkshopGameCardUpdates({ force: true })
      feedback.value = `已导入：${getGameCardTitle(imported)}`
      toast.success(`已导入：${getGameCardTitle(imported)}`)
      selectedCardId.value = imported.id
      await refreshCards()
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "导入游戏卡包失败。"
    } finally {
      importing.value = false
    }
  }

  async function deleteCard(card: LocalGameCardRecord): Promise<boolean> {
    if (!canDeleteCard(card)) return false
    deleting.value = true
    actionError.value = ""
    feedback.value = ""
    try {
      const saveCount = (await listPlatformSaves())
        .filter((save) => save.gameCardId === card.manifest.id)
        .length
      const title = getGameCardTitle(card)
      const confirmed = await confirm({
        message: `删除应用「${title}」？\n\n这会同时删除 ${saveCount} 个关联存档，无法撤销。`,
        severity: "danger",
        confirmText: "删除",
      })
      if (!confirmed) return false

      await deletePlatformGameCard(card.id)
      toast.success(`已删除应用：${title}`)
      selectedCardId.value = ""
      await refreshCards()
      return true
    } catch (error) {
      actionError.value = error instanceof Error ? error.message : "删除应用失败。"
      return false
    } finally {
      deleting.value = false
    }
  }

  function onGameCardsChanged(event: Event): void {
    if (isGameCardsChangedEvent(event)) void refreshCards()
  }

  function onActiveCardChanged(event: Event): void {
    if (isActiveCardChangedEvent(event)) void refreshCards()
  }

  onMounted(() => {
    window.addEventListener(GAME_CARDS_CHANGED_EVENT, onGameCardsChanged)
    window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
    void refreshCards()
  })

  onBeforeUnmount(() => {
    refreshRequestSeq++
    window.removeEventListener(GAME_CARDS_CHANGED_EVENT, onGameCardsChanged)
    window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
  })

  return {
    cards,
    selectedCardId,
    activeGameCardId,
    loading,
    importing,
    deleting,
    loadingCard,
    creating,
    copyingId,
    updatingCardId,
    errorMessage,
    actionError,
    feedback,
    refreshCards,
    createDefaultCard,
    canLoadCard,
    canDeleteCard,
    cardUpdateInfo,
    loadCard,
    copyCard,
    updateCardFromWorkshop,
    importPackage,
    deleteCard,
  }
}
