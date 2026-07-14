import type {
  CloudBackupCommitRequest,
  CloudBackupManifestResponse,
  CloudBackupPrepareRequest,
  CloudBackupSummary,
} from "@tsian/contracts"
import { cloudBackupApi, ApiError } from "./api-client"
import {
  collectLocalSaveBackupSnapshot,
  createLocalSaveFromBackupPackage,
  createLocalSaveFromCloudBackup,
  exportLocalSaveBackup,
  replaceLocalSaveFromCloudBackup,
  updateLocalSaveCloudBackupMetadata,
  type SaveBackupFilePayload,
} from "@/storage/save-backups"
import {
  getLocalGameCard,
  localDb,
  setActiveGameCardId,
  setActiveSaveId,
  type LocalGameCardRecord,
  type LocalSaveRecord,
} from "@/storage"
import type { CheckpointWorkspaceFile } from "@/storage/workspace-types"
import { getPlatformConfig } from "@/config/platform-config"
import { emitActiveCardChanged, emitSavesChanged } from "@/lib/platform-events"

export class CloudBackupConflictError extends Error {
  constructor(message = "云端备份已在其他设备更新。") {
    super(message)
    this.name = "CloudBackupConflictError"
  }
}

async function selectLocalSaveForCard(save: LocalSaveRecord, cardId: string): Promise<void> {
  await setActiveSaveId(save.id)
  await setActiveGameCardId(cardId)
  emitActiveCardChanged()
}

async function clearLocalCloudBackupMetadata(backupId: string): Promise<void> {
  const linkedSaves = await localDb.saves
    .where("updatedAt")
    .aboveOrEqual(0)
    .filter((save) => save.cloudBackupId === backupId)
    .toArray()

  for (const save of linkedSaves) {
    const updated: LocalSaveRecord = { ...save }
    delete updated.cloudBackupId
    delete updated.cloudBackupRevisionId
    delete updated.cloudBackedUpAt
    await localDb.saves.put(updated)
  }
}

function requestFromSnapshot(
  snapshot: Awaited<ReturnType<typeof collectLocalSaveBackupSnapshot>>,
  options: { force?: boolean } = {},
): CloudBackupPrepareRequest {
  return {
    ...(snapshot.save.cloudBackupId ? { backupId: snapshot.save.cloudBackupId } : {}),
    expectedRevisionId: snapshot.save.cloudBackupRevisionId ?? null,
    ...(options.force ? { force: true } : {}),
    name: snapshot.save.name,
    cardId: snapshot.save.gameCardId ?? "",
    cardVersion: snapshot.save.gameCardVersion ?? "",
    files: snapshot.files.map((file) => file.entry),
  }
}

async function uploadMissingBlobs(
  files: SaveBackupFilePayload[],
  missingHashes: string[],
): Promise<void> {
  const missing = new Set(missingHashes)
  for (const file of files) {
    if (!missing.has(file.entry.hash)) {
      continue
    }
    await cloudBackupApi.uploadBlob(file.entry.hash, file.blob, file.entry.mediaType)
  }
}

export async function backupPlatformSaveToCloud(
  saveId: string,
  options: { force?: boolean } = {},
): Promise<CloudBackupManifestResponse> {
  const snapshot = await collectLocalSaveBackupSnapshot(saveId)
  const request = requestFromSnapshot(snapshot, options)
  let backupId = request.backupId
  try {
    const prepared = await cloudBackupApi.prepare(request)
    backupId = prepared.backupId
    await uploadMissingBlobs(snapshot.files, prepared.missingHashes)
    const commitRequest: CloudBackupCommitRequest = {
      ...request,
      backupId,
    }
    const committed = await cloudBackupApi.commit(backupId, commitRequest)
    await updateLocalSaveCloudBackupMetadata(saveId, {
      cloudBackupId: committed.id,
      cloudBackupRevisionId: committed.revisionId,
      cloudBackedUpAt: Date.now(),
    })
    emitSavesChanged()
    return committed
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new CloudBackupConflictError()
    }
    throw error
  }
}

export async function listCloudBackupsForCard(cardId: string): Promise<CloudBackupSummary[]> {
  return (await cloudBackupApi.list(cardId)).backups
}

export async function listAllCloudBackups() {
  return cloudBackupApi.list()
}

export async function deleteCloudBackup(id: string): Promise<void> {
  await cloudBackupApi.delete(id)
  await clearLocalCloudBackupMetadata(id)
  emitSavesChanged()
}

export async function deleteCloudBackupForSave(save: LocalSaveRecord): Promise<void> {
  if (!save.cloudBackupId) {
    return
  }
  await deleteCloudBackup(save.cloudBackupId)
}

async function filesFromCloudBackup(backup: CloudBackupManifestResponse): Promise<CheckpointWorkspaceFile[]> {
  const files: CheckpointWorkspaceFile[] = []
  for (const entry of backup.files) {
    const blob = await cloudBackupApi.downloadBlob(backup.id, entry.hash)
    if (entry.kind === "binary") {
      files.push({
        path: entry.path,
        content: "",
        data: blob,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })
    } else {
      files.push({
        path: entry.path,
        content: await blob.text(),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })
    }
  }
  return files
}

export async function pullCloudBackupToLocal(
  backupId: string,
  card: LocalGameCardRecord,
): Promise<{ save: LocalSaveRecord; replaced: boolean }> {
  const backup = await cloudBackupApi.manifest(backupId)
  if (backup.cardId !== card.id) {
    throw new Error(`这个云端备份属于另一张游戏卡：${backup.cardId}`)
  }
  const files = await filesFromCloudBackup(backup)
  const existing = await localDb.saves
    .where("updatedAt")
    .aboveOrEqual(0)
    .filter((save) => save.cloudBackupId === backup.id)
    .first()
  if (existing) {
    const save = await replaceLocalSaveFromCloudBackup(existing.id, backup, files)
    await selectLocalSaveForCard(save, card.id)
    emitSavesChanged()
    return { save, replaced: true }
  }
  const save = await createLocalSaveFromCloudBackup(card, backup, files)
  await selectLocalSaveForCard(save, card.id)
  emitSavesChanged()
  return { save, replaced: false }
}

export async function getCloudBackupCard(backup: CloudBackupManifestResponse): Promise<LocalGameCardRecord> {
  const card = await getLocalGameCard(backup.cardId)
  if (!card) {
    throw new Error(`请先安装游戏卡：${backup.cardId}`)
  }
  return card
}

let autoBackupTimer: number | null = null

export function scheduleAutoBackupForSave(saveId: string): void {
  if (!getPlatformConfig().cloudBackup.autoBackupEnabled) {
    return
  }
  if (autoBackupTimer !== null) {
    window.clearTimeout(autoBackupTimer)
  }
  autoBackupTimer = window.setTimeout(() => {
    autoBackupTimer = null
    void backupPlatformSaveToCloud(saveId).catch((error) => {
      console.warn("[cloud-backup] automatic backup failed", error)
    })
  }, 5000)
}

export async function exportPlatformSaveBackup(saveId: string): Promise<Blob> {
  return exportLocalSaveBackup(saveId)
}

export async function importPlatformSaveBackup(
  cardId: string,
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<LocalSaveRecord> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  const save = await createLocalSaveFromBackupPackage(card, input)
  await selectLocalSaveForCard(save, card.id)
  emitSavesChanged()
  return save
}
