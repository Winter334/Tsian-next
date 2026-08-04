import type { MarketPackage, MarketResourceType } from "@tsian/contracts"
import { computed, onBeforeUnmount, ref, watch } from "vue"
import { useRouter } from "vue-router"
import type {
  MarketInstallDialogState,
  MarketInstallTargetOption,
  MarketUploadMetadata,
  MarketUploadSelectionPayload,
  MarketUploadSubmitPayload,
} from "@/components/market/types"
import { useAuth } from "@/composables/useAuth"
import { confirm } from "@/composables/useConfirm"
import { openDialogForm } from "@/composables/useDialogForm"
import { toast } from "@/composables/useToast"
import { getGameCardTitle } from "@/lib/game-card-display"
import {
  exportAgentPackage,
  exportPlatformGameCardPackage,
  exportSkillPackage,
  exportToolPackage,
  gameCardMarketOriginFromPackage,
  importPlatformGameCardPackage,
  inspectPlatformGameCardPackage,
  inspectResourcePackage,
  installAgentPackage,
  installSkillPackage,
  installToolPackage,
  listPlatformGameCards,
  listPlatformSaves,
  refreshWorkshopGameCardUpdates,
  updatePlatformGameCardMetadata,
} from "@/platform-host"
import { marketApi } from "@/platform-host/api-client"
import { marketResourceTypeOptions } from "./market-constants"
import type { MarketReplacementSelection } from "./market-types"
import { useMarketCatalog } from "./use-market-catalog"
import { useMarketInventory } from "./use-market-inventory"

export function useAppMarketController() {
  const router = useRouter()
  const { currentUser, loggedIn } = useAuth()
  const catalog = useMarketCatalog(loggedIn)
  const inventory = useMarketInventory(catalog.errorMessage)
  const installing = ref(false)
  const uploading = ref(false)
  const feedback = ref("")
  const pendingInstallBlob = ref<Blob | null>(null)
  const installDialog = ref<MarketInstallDialogState | null>(null)
  const updatingPackage = ref(false)
  const deletingPackage = ref(false)
  const replacementDialogOpen = ref(false)
  const replacementSelection = ref<MarketReplacementSelection | null>(null)
  const replacementDefaults = ref<MarketUploadMetadata | null>(null)
  const replacementLabel = ref("")
  const editSaveToken = ref(0)

  const canManageDetail = computed(() => catalog.detailPackage.value?.uploader.id === currentUser.value?.id)

  function openUploadScreen(): void {
    feedback.value = ""
    catalog.errorMessage.value = ""
    catalog.goBack()
    catalog.screen.value = { kind: "upload" }
    if (loggedIn.value) void inventory.loadUploadResources()
  }

  async function handlePrepareUpload(selection: MarketUploadSelectionPayload): Promise<void> {
    if (uploading.value) return
    const defaults = inventory.uploadMetadataDefaults(selection)
    const values = await openDialogForm({
      title: `上传资源：${defaults.title || uploadTypeLabel(selection.resourceType)}`,
      widthClass: "max-w-md",
      confirmText: "确认上传",
      fields: [
        { name: "title", label: "标题（可选）", type: "text", defaultValue: defaults.title ?? "", placeholder: "资源标题" },
        { name: "version", label: "版本", type: "text", defaultValue: defaults.version ?? "", placeholder: "0.1.0", mono: true },
        { name: "author", label: "作者（可选）", type: "text", defaultValue: defaults.author ?? "", placeholder: "作者名" },
        { name: "summary", label: "简介（可选）", type: "textarea", rows: 3, defaultValue: defaults.summary ?? "", placeholder: "资源简介" },
        { name: "tags", label: "Tags（可选，逗号分隔）", type: "text", defaultValue: defaults.tags ?? "", placeholder: "tool, narrative", mono: true },
      ],
    })
    if (!values) return
    const version = requireVersion(values.version)
    if (!version) return
    await handleUpload({
      ...selection,
      title: optionalFormValue(values.title),
      summary: optionalFormValue(values.summary),
      author: optionalFormValue(values.author),
      version,
      tags: optionalFormValue(values.tags),
    })
  }

  async function handleUpload(payload: MarketUploadSubmitPayload): Promise<void> {
    if (uploading.value) return
    if (!loggedIn.value) {
      catalog.errorMessage.value = "上传资源需要先登录。"
      return
    }
    uploading.value = true
    feedback.value = ""
    catalog.errorMessage.value = ""
    try {
      const blob = await exportMarketSelection(payload, { version: payload.version })
      const pkg = await marketApi.upload(blob, {
        resourceType: payload.resourceType,
        title: payload.title,
        summary: payload.summary,
        author: payload.author,
        tags: payload.tags,
      })
      if (payload.resourceType === "game_card") {
        await syncUploadedGameCardVersion(payload.cardId, payload.version)
      }
      toast.success(`已上传：${pkg.name}`)
      catalog.screen.value = { kind: "list" }
      await catalog.refresh()
      await catalog.refreshCounts()
    } catch (error) {
      catalog.errorMessage.value = error instanceof Error ? error.message : "上传资源失败。"
    } finally {
      uploading.value = false
    }
  }

  async function syncUploadedGameCardVersion(cardId: string, version: string | undefined): Promise<void> {
    const targetVersion = version?.trim()
    if (!targetVersion) return
    const card = (await listPlatformGameCards()).find((candidate) => candidate.id === cardId)
    if (!card || card.manifest.version === targetVersion) return
    await updatePlatformGameCardMetadata(card.id, {
      name: card.manifest.name,
      summary: card.manifest.summary,
      authorName: card.manifest.author?.name,
      version: targetVersion,
    })
  }

  async function handleDownloadInstall(pkg: MarketPackage): Promise<void> {
    if (installing.value) return
    installing.value = true
    pendingInstallBlob.value = null
    installDialog.value = null
    feedback.value = ""
    catalog.errorMessage.value = ""
    try {
      if (pkg.resourceType === "game_card") {
        await installGameCardPackage(pkg)
        return
      }
      const blob = await marketApi.download(pkg.id)
      const inspection = await inspectResourcePackage(blob)
      await inventory.loadInstallResources()
      pendingInstallBlob.value = blob
      installDialog.value = {
        pkg,
        options: inventory.buildInstallOptions(pkg.resourceType, inspection.resourceId),
      }
    } catch (error) {
      catalog.errorMessage.value = error instanceof Error ? error.message : "下载安装失败。"
    } finally {
      installing.value = false
    }
  }

  async function installGameCardPackage(pkg: MarketPackage): Promise<void> {
    const blob = await marketApi.download(pkg.id)
    const inspection = await inspectPlatformGameCardPackage(blob)
    const incoming = inspection.manifest
    const existing = (await listPlatformGameCards()).find((card) => card.manifest.id === incoming.id)
    if (existing) {
      const targetVersion = incoming.version.trim()
      const affectedSaves = (await listPlatformSaves()).filter((save) => {
        if (save.gameCardId !== incoming.id) return false
        const savedVersion = save.gameCardVersion?.trim() ?? ""
        return !savedVersion || savedVersion !== targetVersion
      })
      const saveWarning = affectedSaves.length > 0
        ? `\n\n检测到 ${affectedSaves.length} 个旧版存档，首次继续时会询问是否使用新版。`
        : ""
      const confirmed = await confirm({
        title: "卡包已安装",
        message: `本地已有「${existing.manifest.name || incoming.name || pkg.resourceId}」。安装后将替换本地卡包，已有存档会保留。${saveWarning}`,
        severity: "danger",
        confirmText: "覆盖",
      })
      if (!confirmed) return
    }
    const imported = await importPlatformGameCardPackage(blob, { marketOrigin: gameCardMarketOriginFromPackage(pkg) })
    await refreshWorkshopGameCardUpdates({ force: true })
    feedback.value = `已安装：${getGameCardTitle(imported)}`
    toast.success(`已安装：${getGameCardTitle(imported)}`)
  }

  async function handleInstallTargetSelected(option: MarketInstallTargetOption): Promise<void> {
    if (installing.value) return
    const blob = pendingInstallBlob.value
    if (!blob) {
      installDialog.value = null
      return
    }
    const dialog = installDialog.value
    if (option.requiresConfirm) {
      installDialog.value = null
      const confirmed = await confirm({
        title: option.confirmTitle ?? "确认替换",
        message: option.confirmMessage ?? "目标已存在同名资源，是否替换？",
        severity: option.severity === "danger" ? "danger" : "normal",
        confirmText: "替换",
      })
      if (!confirmed) {
        pendingInstallBlob.value = null
        return
      }
    }
    installing.value = true
    try {
      if (option.resourceType === "agent") await installAgentPackage(blob, option.target)
      else if (option.resourceType === "skill") await installSkillPackage(blob, option.target)
      else await installToolPackage(blob, option.target)
      toast.success("资源已安装。")
      feedback.value = "资源已安装。"
      installDialog.value = null
      pendingInstallBlob.value = null
      await inventory.loadInstallResources()
    } catch (error) {
      catalog.errorMessage.value = error instanceof Error ? error.message : "安装资源失败。"
      if (pendingInstallBlob.value === blob && dialog) installDialog.value = dialog
    } finally {
      installing.value = false
    }
  }

  function closeInstallDialog(): void {
    if (installing.value) return
    installDialog.value = null
    pendingInstallBlob.value = null
  }

  async function exportMarketSelection(
    selection: MarketUploadSelectionPayload,
    options: { version?: string } = {},
  ): Promise<Blob> {
    switch (selection.resourceType) {
      case "game_card": return exportPlatformGameCardPackage(selection.cardId, { version: options.version })
      case "agent": return exportAgentPackage(selection.source, { version: options.version })
      case "skill": return exportSkillPackage(selection.source, { version: options.version })
      case "tool": return exportToolPackage(selection.source, { version: options.version })
    }
  }

  function startEditPackage(): void {
    clearReplacement()
  }

  function clearReplacement(): void {
    replacementSelection.value = null
    replacementDefaults.value = null
    replacementLabel.value = ""
  }

  async function openReplacementDialog(): Promise<void> {
    if (!canManageDetail.value || replacementDialogOpen.value) return
    replacementDialogOpen.value = true
    if (loggedIn.value) await inventory.loadUploadResources()
  }

  function handleReplacementSelected(selection: MarketUploadSelectionPayload): void {
    if (!catalog.detailPackage.value || selection.resourceType !== catalog.detailPackage.value.resourceType) return
    replacementSelection.value = selection
    replacementDefaults.value = inventory.uploadMetadataDefaults(selection)
    replacementLabel.value = inventory.replacementSelectionLabel(selection)
    replacementDialogOpen.value = false
  }

  async function handleSavePackageEdit(metadata: Required<MarketUploadMetadata>): Promise<boolean> {
    const pkg = catalog.detailPackage.value
    if (!pkg || updatingPackage.value || !canManageDetail.value) return false
    updatingPackage.value = true
    feedback.value = ""
    catalog.errorMessage.value = ""
    try {
      const replacement = replacementSelection.value
      let replacementVersion: string | undefined
      if (replacement) {
        const version = requireVersion(metadata.version)
        if (!version) return false
        replacementVersion = version
      }
      const blob = replacement ? await exportMarketSelection(replacement, { version: replacementVersion }) : null
      const updated = await marketApi.update(pkg.id, blob, {
        resourceType: pkg.resourceType,
        title: metadata.title,
        summary: metadata.summary,
        author: metadata.author,
        tags: metadata.tags,
      })
      if (replacement?.resourceType === "game_card") {
        await syncUploadedGameCardVersion(replacement.cardId, replacementVersion)
      }
      catalog.detailPackage.value = updated
      editSaveToken.value++
      clearReplacement()
      toast.success(`已更新：${updated.name}`)
      feedback.value = `已更新：${updated.name}`
      await catalog.refresh()
      await catalog.refreshCounts()
      return true
    } catch (error) {
      catalog.errorMessage.value = error instanceof Error ? error.message : "更新发布失败。"
      return false
    } finally {
      updatingPackage.value = false
    }
  }

  async function handleDeletePackage(pkg: MarketPackage): Promise<void> {
    if (deletingPackage.value) return
    if (pkg.uploader.id !== currentUser.value?.id) {
      catalog.errorMessage.value = "只能删除自己上传的发布物。"
      return
    }
    deletingPackage.value = true
    feedback.value = ""
    catalog.errorMessage.value = ""
    try {
      const confirmed = await confirm({
        title: `删除发布物「${pkg.name}」？`,
        message: "删除后将从创意工坊移除，无法撤销。",
        severity: "danger",
        confirmText: "删除",
      })
      if (!confirmed) return
      await marketApi.delete(pkg.id)
      toast.success(`已删除：${pkg.name}`)
      if (catalog.screen.value.kind === "detail" && catalog.screen.value.id === pkg.id) {
        catalog.detailPackage.value = null
        catalog.screen.value = { kind: "list" }
      }
      await catalog.refresh()
      await catalog.refreshCounts()
    } catch (error) {
      catalog.errorMessage.value = error instanceof Error ? error.message : "删除发布失败。"
    } finally {
      deletingPackage.value = false
    }
  }

  function openAccountCenter(): void {
    void router.push("/account")
  }

  watch(loggedIn, (isLoggedIn) => {
    if (isLoggedIn && catalog.screen.value.kind === "upload") {
      void inventory.loadUploadResources()
    }
  })

  onBeforeUnmount(() => inventory.dispose())

  return {
    ...catalog,
    ...inventory,
    currentUser,
    loggedIn,
    resourceTypeOptions: marketResourceTypeOptions,
    installing,
    uploading,
    feedback,
    pendingInstallBlob,
    installDialog,
    updatingPackage,
    deletingPackage,
    replacementDialogOpen,
    replacementSelection,
    replacementDefaults,
    replacementLabel,
    editSaveToken,
    canManageDetail,
    openUploadScreen,
    handlePrepareUpload,
    handleUpload,
    handleDownloadInstall,
    handleInstallTargetSelected,
    closeInstallDialog,
    startEditPackage,
    clearReplacement,
    openReplacementDialog,
    handleReplacementSelected,
    handleSavePackageEdit,
    handleDeletePackage,
    openAccountCenter,
  }
}

function optionalFormValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ""
  return trimmed || undefined
}

function requireVersion(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) {
    toast.error("版本不能为空。")
    return null
  }
  return trimmed
}

function uploadTypeLabel(type: MarketResourceType): string {
  return marketResourceTypeOptions.find((option) => option.type === type)?.label ?? "资源"
}
