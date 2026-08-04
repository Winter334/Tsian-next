import type { GameCardFrontendBinding } from "@tsian/contracts"
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue"
import { confirm } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import { clearBeforeClose, setBeforeClose } from "@/composables/window-close-guards"
import {
  getFrontendStatusLabel,
  getGameCardAuthor,
  getGameCardCoverUrl,
  getGameCardDescription,
  getGameCardTitle,
} from "@/lib/game-card-display"
import { ACTIVE_CARD_CHANGED_EVENT, isActiveCardChangedEvent } from "@/lib/platform-events"
import {
  deletePlatformGameCard,
  exportPlatformGameCardFrontendPackage,
  exportPlatformGameCardPackage,
  getPlatformActiveGameCardId,
  getPlatformGameCard,
  importPlatformGameCardFrontendPackage,
  listPlatformGameCardFrontendFiles,
  setPlatformActiveGameCard,
  setPlatformGameCardCover,
  updatePlatformGameCardFrontend,
  updatePlatformGameCardMetadata,
  type PlatformGameCardFrontendFileSummary,
} from "@/platform-host"
import { detailWindowIdFor } from "@/platform-apps"
import type { LocalGameCardRecord } from "@/storage/db"

export type GameCardFrontendMode = "none" | "remote" | "packaged"

export type GameCardCoverDraft =
  | { kind: "none" }
  | { kind: "upload"; file: File; previewUrl: string }
  | { kind: "url"; url: string }
  | { kind: "clear" }

export interface GameCardDetailControllerOptions {
  cardId: MaybeRefOrGetter<string>
  onDeleted(): void
}

export function useGameCardDetailController(options: GameCardDetailControllerOptions) {
  const card = ref<LocalGameCardRecord | null>(null)
  const activeGameCardId = ref("")
  const frontendFiles = ref<PlatformGameCardFrontendFileSummary[]>([])
  const frontendMode = ref<GameCardFrontendMode>("none")
  const remoteUrl = ref("")
  const packagedEntry = ref("")
  const pendingFrontendPackageFile = ref<File | null>(null)
  const metadataName = ref("")
  const metadataIntro = ref("")
  const metadataAuthor = ref("")
  const metadataVersion = ref("")
  const coverUrlDraft = ref("")
  const coverError = ref("")
  const coverDraft = ref<GameCardCoverDraft>({ kind: "none" })
  const loading = ref(false)
  const exporting = ref(false)
  const frontendSaving = ref(false)
  const frontendPackageSaving = ref(false)
  const propertiesSaving = ref(false)
  const loadingCard = ref(false)
  const errorMessage = ref("")
  const feedback = ref("")
  let refreshRequestSeq = 0
  let activeCardRequestSeq = 0
  let contextRevision = 0

  const cardTitle = computed(() => getGameCardTitle(card.value))
  const cardDescription = computed(() => getGameCardDescription(card.value))
  const cardAuthor = computed(() => getGameCardAuthor(card.value))
  const coverUrl = computed(() => {
    const draft = coverDraft.value
    if (draft.kind === "upload") return draft.previewUrl
    if (draft.kind === "url") return draft.url
    if (draft.kind === "clear") return ""
    return getGameCardCoverUrl(card.value)
  })
  const coverSourceLabel = computed(() => {
    const draft = coverDraft.value
    if (draft.kind === "upload") return "预览"
    if (draft.kind === "url") return "URL*"
    if (draft.kind === "clear") return "已移除*"
    const cover = card.value?.manifest.cover
    if (!cover) return ""
    if (cover.url?.trim()) return "URL"
    if (cover.workspacePath?.trim()) return "本地"
    return ""
  })
  const frontendStatusLabel = computed(() => getFrontendStatusLabel(card.value))
  const isLoadedCard = computed(() => Boolean(card.value && activeGameCardId.value === card.value.id))
  const frontendDraftChanged = computed(() => {
    const frontend = card.value?.manifest.frontend
    if (pendingFrontendPackageFile.value) return true
    if (frontendMode.value === "none") return Boolean(frontend)
    if (frontendMode.value === "remote") {
      return frontend?.kind !== "remote" || remoteUrl.value.trim() !== frontend.url
    }
    return frontend?.kind !== "packaged" || packagedEntry.value !== frontend.entry
  })
  const canApplyFrontendDraft = computed(() => {
    if (!card.value || card.value.source === "builtin") return false
    if (frontendSaving.value || frontendPackageSaving.value || !frontendDraftChanged.value) return false
    if (frontendMode.value === "remote") return Boolean(remoteUrl.value.trim())
    if (frontendMode.value === "packaged") {
      return Boolean(pendingFrontendPackageFile.value || packagedEntry.value)
    }
    return true
  })
  const frontendApplyLabel = computed(() => frontendSaving.value ? "应用中…" : "应用")
  const packageDraftLabel = computed(() => pendingFrontendPackageFile.value
    ? `待应用 ${pendingFrontendPackageFile.value.name}`
    : packagedEntry.value)
  const hasUnsavedChanges = computed(() => {
    if (!card.value) return false
    return metadataName.value.trim() !== card.value.manifest.name
      || metadataIntro.value.trim() !== card.value.manifest.summary
      || metadataAuthor.value.trim() !== (card.value.manifest.author?.name ?? "")
      || metadataVersion.value.trim() !== card.value.manifest.version
      || coverDraft.value.kind !== "none"
  })

  function defaultPackagedEntry(): string {
    return frontendFiles.value.find((file) => file.path.endsWith(".html"))?.path
      ?? frontendFiles.value[0]?.path
      ?? ""
  }

  function setFrontendMode(mode: GameCardFrontendMode): void {
    if (frontendSaving.value || frontendPackageSaving.value) return
    frontendMode.value = mode
    if (mode !== "packaged") pendingFrontendPackageFile.value = null
    if (mode === "packaged" && !packagedEntry.value) packagedEntry.value = defaultPackagedEntry()
    feedback.value = ""
  }

  function syncFrontendDraft(loadedCard: LocalGameCardRecord): void {
    const frontend = loadedCard.manifest.frontend
    if (!frontend) {
      frontendMode.value = "none"
      remoteUrl.value = ""
      packagedEntry.value = defaultPackagedEntry()
    } else if (frontend.kind === "remote") {
      frontendMode.value = "remote"
      remoteUrl.value = frontend.url
    } else {
      frontendMode.value = "packaged"
      packagedEntry.value = frontend.entry
    }
    pendingFrontendPackageFile.value = null
  }

  function syncMetadataDraft(loadedCard: LocalGameCardRecord): void {
    metadataName.value = loadedCard.manifest.name
    metadataIntro.value = loadedCard.manifest.summary
    metadataAuthor.value = loadedCard.manifest.author?.name ?? ""
    metadataVersion.value = loadedCard.manifest.version
    coverUrlDraft.value = loadedCard.manifest.cover?.url ?? ""
    resetCoverDraft()
  }

  function setCoverDraft(next: GameCardCoverDraft): void {
    if (coverDraft.value.kind === "upload") URL.revokeObjectURL(coverDraft.value.previewUrl)
    coverDraft.value = next
  }

  function resetCoverDraft(): void {
    setCoverDraft({ kind: "none" })
  }

  function stageCoverUpload(file: File): void {
    if (!card.value || propertiesSaving.value) return
    if (card.value.source === "builtin") {
      coverError.value = "内置游戏卡不能直接修改封面，请先另存为本地副本。"
      return
    }
    coverError.value = ""
    setCoverDraft({ kind: "upload", file, previewUrl: URL.createObjectURL(file) })
  }

  function applyCoverUrlDraft(): void {
    const url = coverUrlDraft.value.trim()
    if (!url || !card.value || propertiesSaving.value) return
    if (card.value.source === "builtin") {
      coverError.value = "内置游戏卡不能直接修改封面，请先另存为本地副本。"
      return
    }
    coverError.value = ""
    setCoverDraft({ kind: "url", url })
  }

  function applyCoverClearDraft(): void {
    if (!card.value || propertiesSaving.value) return
    if (card.value.source === "builtin") {
      coverError.value = "内置游戏卡不能直接修改封面，请先另存为本地副本。"
      return
    }
    coverError.value = ""
    setCoverDraft({ kind: "clear" })
  }

  async function refreshData(): Promise<void> {
    const cardId = toValue(options.cardId)
    const requestId = ++refreshRequestSeq
    const activeRequestId = ++activeCardRequestSeq
    loading.value = true
    errorMessage.value = ""
    try {
      const [loadedCard, loadedActiveGameCardId, loadedFrontendFiles] = await Promise.all([
        getPlatformGameCard(cardId),
        getPlatformActiveGameCardId(),
        listPlatformGameCardFrontendFiles(cardId),
      ])
      if (requestId !== refreshRequestSeq || cardId !== toValue(options.cardId)) return
      if (!loadedCard) throw new Error(`未找到游戏卡「${cardId}」。`)
      card.value = loadedCard
      if (activeRequestId === activeCardRequestSeq) {
        activeGameCardId.value = loadedActiveGameCardId ?? ""
      }
      frontendFiles.value = loadedFrontendFiles
      syncFrontendDraft(loadedCard)
      syncMetadataDraft(loadedCard)
    } catch (error) {
      if (requestId === refreshRequestSeq) {
        errorMessage.value = error instanceof Error ? error.message : "无法加载游戏卡详情。"
      }
    } finally {
      if (requestId === refreshRequestSeq) loading.value = false
    }
  }

  async function refreshActiveCardId(): Promise<void> {
    const requestId = ++activeCardRequestSeq
    try {
      const loadedActiveGameCardId = await getPlatformActiveGameCardId()
      if (requestId === activeCardRequestSeq) {
        activeGameCardId.value = loadedActiveGameCardId ?? ""
      }
    } catch {
      // Active-card refresh is advisory; keep the current detail draft intact.
    }
  }

  async function saveProperties(): Promise<void> {
    if (!card.value || card.value.source === "builtin" || propertiesSaving.value) return
    const target = card.value
    const revision = contextRevision
    const draft = coverDraft.value
    const name = metadataName.value.trim()
    const summary = metadataIntro.value.trim()
    const authorName = metadataAuthor.value
    const version = metadataVersion.value
    propertiesSaving.value = true
    feedback.value = ""
    try {
      if (!name || !summary) throw new Error("名称和简介不能为空。")
      await updatePlatformGameCardMetadata(target.id, {
        name,
        summary,
        authorName,
        version,
      })
      if (draft.kind === "upload") {
        await setPlatformGameCardCover(target.id, { kind: "upload", file: draft.file })
      } else if (draft.kind === "url") {
        await setPlatformGameCardCover(target.id, { kind: "url", url: draft.url })
      } else if (draft.kind === "clear") {
        await setPlatformGameCardCover(target.id, { kind: "clear" })
      }
      if (!isCurrentContext(target.id, revision)) return
      resetCoverDraft()
      toast.success("已保存属性")
      feedback.value = "已保存属性。"
      await refreshData()
    } catch (error) {
      if (isCurrentContext(target.id, revision)) {
        feedback.value = error instanceof Error ? error.message : "保存属性失败。"
      }
    } finally {
      propertiesSaving.value = false
    }
  }

  async function deleteCurrentCard(): Promise<void> {
    if (!card.value || card.value.source === "builtin" || propertiesSaving.value) return
    const target = card.value
    const title = getGameCardTitle(target)
    const revision = contextRevision
    propertiesSaving.value = true
    feedback.value = ""
    try {
      const confirmed = await confirm({
        message: `删除应用「${title}」？\n\n这会同时删除所有关联存档，无法撤销。`,
        severity: "danger",
        confirmText: "删除",
      })
      if (!confirmed) return
      await deletePlatformGameCard(target.id)
      toast.success(`已删除应用：${title}`)
      if (isCurrentContext(target.id, revision)) options.onDeleted()
    } catch (error) {
      if (isCurrentContext(target.id, revision)) {
        feedback.value = error instanceof Error ? error.message : "删除应用失败。"
      }
    } finally {
      propertiesSaving.value = false
    }
  }

  function packageFilename(title = cardTitle.value): string {
    const name = title.trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "") || "game-card"
    return `${name}.tsian-card.zip`
  }

  function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.rel = "noopener"
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  async function exportCard(): Promise<void> {
    if (!card.value || exporting.value) return
    const target = card.value
    const revision = contextRevision
    exporting.value = true
    feedback.value = ""
    try {
      const filename = packageFilename(getGameCardTitle(target))
      downloadBlob(await exportPlatformGameCardPackage(target.id), filename)
      if (isCurrentContext(target.id, revision)) feedback.value = `已导出卡包：${filename}`
    } catch (error) {
      if (isCurrentContext(target.id, revision)) {
        feedback.value = error instanceof Error ? error.message : "导出游戏卡包失败。"
      }
    } finally {
      exporting.value = false
    }
  }

  function frontendBindingDraft(
    mode: GameCardFrontendMode,
    remote: string,
    entry: string,
  ): GameCardFrontendBinding | undefined {
    if (mode === "none") return undefined
    if (mode === "remote") {
      return { kind: "remote", url: remote, bridgeVersion: "tsian.play-bridge.v1" }
    }
    return { kind: "packaged", entry, bridgeVersion: "tsian.play-bridge.v1" }
  }

  async function applyFrontendBindingDraft(): Promise<void> {
    if (!card.value || !canApplyFrontendDraft.value) return
    const target = card.value
    const revision = contextRevision
    const mode = frontendMode.value
    const remote = remoteUrl.value
    const entry = packagedEntry.value
    const packageFile = pendingFrontendPackageFile.value
    frontendSaving.value = true
    feedback.value = ""
    try {
      if (mode === "none") {
        const confirmed = await confirm({ message: "清除当前前端绑定？", severity: "danger", confirmText: "清除" })
        if (!confirmed) return
      }
      if (mode === "packaged" && packageFile) {
        await importPlatformGameCardFrontendPackage(target.id, packageFile)
        if (!isCurrentContext(target.id, revision)) return
        pendingFrontendPackageFile.value = null
        feedback.value = "已应用前端包。"
      } else {
        const updated = await updatePlatformGameCardFrontend(
          target.id,
          frontendBindingDraft(mode, remote, entry),
        )
        if (!isCurrentContext(target.id, revision)) return
        feedback.value = updated.manifest.frontend ? "已保存前端绑定。" : "已清除前端绑定。"
      }
      await refreshData()
    } catch (error) {
      if (isCurrentContext(target.id, revision)) {
        feedback.value = error instanceof Error ? error.message : mode === "packaged" && packageFile
          ? "应用前端包失败。"
          : "保存前端绑定失败。"
      }
    } finally {
      frontendSaving.value = false
    }
  }

  function stageFrontendPackage(file: File): void {
    if (!card.value || frontendSaving.value || frontendPackageSaving.value) return
    if (card.value.source === "builtin") {
      feedback.value = "内置游戏卡不能直接替换前端，请先另存为本地副本。"
      return
    }
    frontendMode.value = "packaged"
    pendingFrontendPackageFile.value = file
    feedback.value = ""
  }

  async function exportFrontendPackage(): Promise<void> {
    if (!card.value || frontendFiles.value.length === 0 || frontendPackageSaving.value) return
    const target = card.value
    const revision = contextRevision
    frontendPackageSaving.value = true
    feedback.value = ""
    try {
      const filename = `${target.manifest.id}.tsian-frontend.zip`
      downloadBlob(await exportPlatformGameCardFrontendPackage(target.id), filename)
      if (isCurrentContext(target.id, revision)) feedback.value = `已导出前端包：${filename}`
    } catch (error) {
      if (isCurrentContext(target.id, revision)) {
        feedback.value = error instanceof Error ? error.message : "导出前端包失败。"
      }
    } finally {
      frontendPackageSaving.value = false
    }
  }

  async function loadCurrentCard(): Promise<void> {
    if (!card.value || isLoadedCard.value || loadingCard.value) return
    const target = card.value
    const revision = contextRevision
    loadingCard.value = true
    feedback.value = ""
    try {
      const loaded = await setPlatformActiveGameCard(target.id)
      if (!isCurrentContext(target.id, revision)) return
      activeGameCardId.value = loaded.id
      feedback.value = `已加载游戏卡：${loaded.manifest.name}`
    } catch (error) {
      if (isCurrentContext(target.id, revision)) {
        feedback.value = error instanceof Error ? error.message : "加载游戏卡失败。"
      }
    } finally {
      loadingCard.value = false
    }
  }

  async function onBeforeClose(): Promise<boolean> {
    if (!hasUnsavedChanges.value) return true
    return confirm({ message: "有未保存的改动，放弃并关闭？", severity: "danger", confirmText: "放弃" })
  }

  let mounted = false
  let registeredWindowId = ""

  function registerCloseGuard(): void {
    const nextId = detailWindowIdFor(toValue(options.cardId))
    if (registeredWindowId && registeredWindowId !== nextId) clearBeforeClose(registeredWindowId)
    registeredWindowId = nextId
    setBeforeClose(nextId, onBeforeClose)
  }

  function onActiveCardChanged(event: Event): void {
    if (isActiveCardChangedEvent(event)) void refreshActiveCardId()
  }

  function isCurrentContext(cardId: string, revision: number): boolean {
    return revision === contextRevision
      && toValue(options.cardId) === cardId
      && card.value?.id === cardId
  }

  watch(() => toValue(options.cardId), () => {
    contextRevision++
    resetCoverDraft()
    card.value = null
    activeGameCardId.value = ""
    frontendFiles.value = []
    pendingFrontendPackageFile.value = null
    feedback.value = ""
    coverError.value = ""
    if (mounted) registerCloseGuard()
    void refreshData()
  })

  onMounted(() => {
    mounted = true
    registerCloseGuard()
    window.addEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
    void refreshData()
  })

  onBeforeUnmount(() => {
    mounted = false
    contextRevision++
    refreshRequestSeq++
    activeCardRequestSeq++
    if (registeredWindowId) clearBeforeClose(registeredWindowId)
    registeredWindowId = ""
    window.removeEventListener(ACTIVE_CARD_CHANGED_EVENT, onActiveCardChanged)
    resetCoverDraft()
  })

  return {
    card,
    activeGameCardId,
    frontendFiles,
    frontendMode,
    remoteUrl,
    packagedEntry,
    pendingFrontendPackageFile,
    metadataName,
    metadataIntro,
    metadataAuthor,
    metadataVersion,
    coverUrlDraft,
    coverError,
    coverDraft,
    loading,
    exporting,
    frontendSaving,
    frontendPackageSaving,
    propertiesSaving,
    loadingCard,
    errorMessage,
    feedback,
    cardTitle,
    cardDescription,
    cardAuthor,
    coverUrl,
    coverSourceLabel,
    frontendStatusLabel,
    isLoadedCard,
    frontendDraftChanged,
    canApplyFrontendDraft,
    frontendApplyLabel,
    packageDraftLabel,
    hasUnsavedChanges,
    setFrontendMode,
    resetCoverDraft,
    stageCoverUpload,
    applyCoverUrlDraft,
    applyCoverClearDraft,
    refreshData,
    saveProperties,
    deleteCurrentCard,
    exportCard,
    applyFrontendBindingDraft,
    stageFrontendPackage,
    exportFrontendPackage,
    loadCurrentCard,
  }
}

export function formatGameCardFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "0 B"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
