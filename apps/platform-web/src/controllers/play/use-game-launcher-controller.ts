import type { CloudBackupSummary } from "@tsian/contracts"
import {
  computed,
  ref,
  toValue,
  type MaybeRefOrGetter,
} from "vue"
import { confirm, confirmChoice } from "@/composables/useConfirm"
import { toast } from "@/composables/useToast"
import {
  formatDateTime,
  getGameCardCoverUrl,
  getGameCardTitle,
} from "@/lib/game-card-display"
import {
  backupPlatformSaveToCloud,
  CloudBackupConflictError,
  createPlatformSaveFromGameCard,
  deleteCloudBackupForSave,
  deletePlatformSave,
  exportPlatformSaveBackup,
  importPlatformSaveBackup,
  listCloudBackupsForCard,
  pullCloudBackupToLocal,
  renamePlatformSave,
  updatePlatformSaveGameCardVersion,
} from "@/platform-host"
import type { LocalGameCardRecord, LocalSaveRecord } from "@/storage/db"

export interface SaveBackupDownload {
  blob: Blob
  filename: string
}

export interface GameLauncherControllerOptions {
  card: MaybeRefOrGetter<LocalGameCardRecord>
  saves: MaybeRefOrGetter<readonly LocalSaveRecord[]>
  onContinue(saveId: string): void
  onChanged(): void
  downloadBackup(download: SaveBackupDownload): void
}

/** Shared save-launcher behavior; native file selection and download delivery stay outside. */
export function useGameLauncherController(options: GameLauncherControllerOptions) {
  const busy = ref(false)
  const creating = ref(false)
  const createName = ref("")
  const renamingId = ref("")
  const renameName = ref("")

  const cardSaves = computed(() => {
    const cardId = toValue(options.card).manifest.id
    return toValue(options.saves)
      .filter((save) => save.gameCardId === cardId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
  })
  const cardTitle = computed(() => getGameCardTitle(toValue(options.card)))
  const coverUrl = computed(() => getGameCardCoverUrl(toValue(options.card)))
  const defaultNewName = computed(() => `${cardTitle.value} 存档 ${cardSaves.value.length + 1}`)

  function normalizedVersion(value: string | undefined): string {
    return value?.trim() ?? ""
  }

  function currentCardVersion(): string {
    return normalizedVersion(toValue(options.card).manifest.version)
  }

  function saveVersion(save: LocalSaveRecord): string {
    return normalizedVersion(save.gameCardVersion)
  }

  function saveNeedsVersionConfirmation(save: LocalSaveRecord): boolean {
    const savedVersion = saveVersion(save)
    return !savedVersion || savedVersion !== currentCardVersion()
  }

  async function requestContinue(save: LocalSaveRecord): Promise<void> {
    if (busy.value) return
    if (!saveNeedsVersionConfirmation(save)) {
      options.onContinue(save.id)
      return
    }

    const confirmed = await confirm({
      title: "继续旧版存档？",
      message: `存档「${save.name}」记录的游戏卡版本是「${saveVersion(save) || "未知版本"}」，当前本地游戏卡版本是「${currentCardVersion() || "未知版本"}」。\n\n继续后会使用当前本地游戏卡的规则、角色能力、前端与模板运行；存档文件会保留。`,
      confirmText: "使用当前版本继续",
      cancelText: "暂不继续",
      severity: "danger",
    })
    if (!confirmed) return

    busy.value = true
    try {
      await updatePlatformSaveGameCardVersion(save.id, currentCardVersion())
      options.onChanged()
      options.onContinue(save.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "更新存档版本失败，未启动游戏前端。")
    } finally {
      busy.value = false
    }
  }

  function startCreate(): void {
    creating.value = true
    createName.value = ""
  }

  function cancelCreate(): void {
    creating.value = false
    createName.value = ""
  }

  async function confirmCreate(): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      const name = createName.value.trim() || defaultNewName.value
      const created = await createPlatformSaveFromGameCard(toValue(options.card).id, { name })
      creating.value = false
      createName.value = ""
      toast.success(`已创建存档：${created.name}`)
      options.onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "创建存档失败。")
    } finally {
      busy.value = false
    }
  }

  function startRename(save: LocalSaveRecord): void {
    renamingId.value = save.id
    renameName.value = save.name
  }

  function cancelRename(): void {
    renamingId.value = ""
    renameName.value = ""
  }

  async function confirmRename(): Promise<void> {
    if (busy.value || !renamingId.value) return
    const id = renamingId.value
    const name = renameName.value.trim()
    if (!name) {
      toast.error("存档名不能为空。")
      return
    }
    busy.value = true
    try {
      await renamePlatformSave(id, name)
      renamingId.value = ""
      renameName.value = ""
      toast.success("已重命名存档。")
      options.onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "重命名存档失败。")
    } finally {
      busy.value = false
    }
  }

  function safeFileName(value: string, fallback: string): string {
    return value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      || fallback
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  async function backupToCloud(save: LocalSaveRecord): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      await backupPlatformSaveToCloud(save.id)
      toast.success("已备份到云端。")
      options.onChanged()
    } catch (error) {
      if (error instanceof CloudBackupConflictError) {
        busy.value = false
        const confirmed = await confirm({
          title: "覆盖云端备份？",
          message: `云端备份似乎在其他设备更新过。\n\n继续备份会用本机存档「${save.name}」覆盖云端备份。`,
          confirmText: "覆盖云端",
          cancelText: "取消",
          severity: "danger",
        })
        if (!confirmed) return
        busy.value = true
        try {
          await backupPlatformSaveToCloud(save.id, { force: true })
          toast.success("已覆盖云端备份。")
          options.onChanged()
        } catch (forceError) {
          toast.error(forceError instanceof Error ? forceError.message : "备份失败。")
        } finally {
          busy.value = false
        }
        return
      }
      toast.error(error instanceof Error ? error.message : "备份失败。")
    } finally {
      busy.value = false
    }
  }

  async function exportSave(save: LocalSaveRecord): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      const blob = await exportPlatformSaveBackup(save.id)
      options.downloadBackup({
        blob,
        filename: `${safeFileName(save.name, "save")}.tsian-save.zip`,
      })
      toast.success("已导出存档备份。")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导出存档失败。")
    } finally {
      busy.value = false
    }
  }

  async function importSave(file: File): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      const imported = await importPlatformSaveBackup(toValue(options.card).id, file)
      toast.success(`已导入存档：${imported.name}`)
      options.onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入存档失败。")
    } finally {
      busy.value = false
    }
  }

  function backupChoiceLabel(backup: CloudBackupSummary): string {
    return `${backup.name} · ${formatDateTime(Date.parse(backup.updatedAt))} · ${formatBytes(backup.sizeBytes)} · v${backup.cardVersion || "未知"}`
  }

  async function chooseCloudBackup(backups: CloudBackupSummary[]): Promise<CloudBackupSummary | null> {
    if (backups.length === 0) return null
    if (backups.length === 1) return backups[0] ?? null
    const selectedId = await confirmChoice({
      title: "选择云端备份",
      message: "选择要同步到本机的云端备份。",
      options: backups.map((backup) => ({
        value: backup.id,
        label: backupChoiceLabel(backup),
      })),
      cancelText: "取消",
    })
    return backups.find((backup) => backup.id === selectedId) ?? null
  }

  async function syncFromCloud(): Promise<void> {
    if (busy.value) return
    busy.value = true
    try {
      const card = toValue(options.card)
      const backups = await listCloudBackupsForCard(card.id)
      if (backups.length === 0) {
        toast.info("暂无云端备份。")
        return
      }
      busy.value = false
      const selected = await chooseCloudBackup(backups)
      if (!selected) return
      const existing = toValue(options.saves).find((save) => save.cloudBackupId === selected.id)
      if (existing) {
        const confirmed = await confirm({
          title: "同步云端？",
          message: `用云端备份覆盖本机存档「${existing.name}」？\n\n本机当前进度会被云端备份替换。`,
          confirmText: "同步云端",
          cancelText: "取消",
          severity: "danger",
        })
        if (!confirmed) return
      }
      busy.value = true
      const result = await pullCloudBackupToLocal(selected.id, card)
      toast.success(result.replaced ? "已同步云端备份。" : `已从云端创建存档：${result.save.name}`)
      options.onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "同步云端失败。")
    } finally {
      busy.value = false
    }
  }

  async function requestDelete(save: LocalSaveRecord): Promise<void> {
    if (busy.value) return
    let deleteCloud = false
    if (save.cloudBackupId) {
      const choice = await confirmChoice({
        title: "删除存档？",
        message: `删除本机存档「${save.name}」？\n\n你也可以同时删除它的云端备份。`,
        options: [
          { value: "cloud", label: "同时删除云端", severity: "danger" },
          { value: "local", label: "只删除本机", severity: "danger" },
        ],
        cancelText: "取消",
      })
      if (!choice) return
      deleteCloud = choice === "cloud"
    } else {
      const confirmed = await confirm({
        message: `删除存档「${save.name}」？\n\n游戏卡「${cardTitle.value}」不会被删除，其他存档不受影响。`,
        severity: "danger",
        confirmText: "删除",
      })
      if (!confirmed) return
    }

    busy.value = true
    try {
      if (deleteCloud) await deleteCloudBackupForSave(save)
      await deletePlatformSave(save.id)
      toast.success(deleteCloud ? `已删除存档和云端备份：${save.name}` : `已删除存档：${save.name}`)
      options.onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除存档失败。")
    } finally {
      busy.value = false
    }
  }

  return {
    busy,
    creating,
    createName,
    renamingId,
    renameName,
    cardSaves,
    cardTitle,
    coverUrl,
    defaultNewName,
    saveNeedsVersionConfirmation,
    requestContinue,
    startCreate,
    cancelCreate,
    confirmCreate,
    startRename,
    cancelRename,
    confirmRename,
    backupToCloud,
    exportSave,
    importSave,
    syncFromCloud,
    requestDelete,
  }
}
