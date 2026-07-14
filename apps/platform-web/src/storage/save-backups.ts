import type {
  CloudBackupFileEntry,
  CloudBackupManifestResponse,
} from "@tsian/contracts"
import { strToU8, unzipSync, zipSync } from "fflate"
import {
  inferMediaTypeFromPath,
  resolveBlobMediaType,
} from "@/lib/media-type"
import type { LocalGameCardRecord, LocalSaveRecord } from "./db"
import { localDb } from "./db"
import { createCheckpointForSave, deleteCheckpointsForSave } from "./checkpoints"
import { deleteBlobsForSave } from "./blobs"
import { getLocalGameCard } from "./game-cards"
import { createLocalSaveFromGameCard } from "./saves"
import {
  listWorkspaceFilesForSave,
  replaceWorkspaceFilesForSave,
  saveRuntimeFilesFromEffectiveWorkspace,
  listEffectiveWorkspaceFilesForSave,
} from "./workspace"
import type { CheckpointWorkspaceFile } from "./workspace-types"
import { normalizeWorkspaceFilePath, isSaveRuntimePersistencePath } from "./workspace-paths"
import { getMaxTurnFromTurnFiles } from "../platform-host/history-turns"

const SAVE_BACKUP_SCHEMA = "tsian.save-backup.v1"
const SAVE_BACKUP_MANIFEST_PATH = "save-backup.json"
const WORKSPACE_PREFIX = "workspace/"
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })

export class SaveBackupPackageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "SaveBackupPackageError"
  }
}

export interface SaveBackupFilePayload {
  entry: CloudBackupFileEntry
  blob: Blob
}

export interface LocalSaveBackupSnapshot {
  save: LocalSaveRecord
  files: SaveBackupFilePayload[]
  sizeBytes: number
}

interface SaveBackupManifest {
  schema: typeof SAVE_BACKUP_SCHEMA
  name: string
  cardId: string
  cardVersion: string
  exportedAt: number
  files: CloudBackupFileEntry[]
}

interface ParsedSaveBackupPackage {
  manifest: SaveBackupManifest
  files: CheckpointWorkspaceFile[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, code: string, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SaveBackupPackageError(code, message)
  }
  return value.trim()
}

function toUint8Array(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> | Uint8Array {
  if (input instanceof Uint8Array) {
    return input
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input)
  }
  return input.arrayBuffer().then((buffer) => new Uint8Array(buffer))
}

function decodeText(bytes: Uint8Array, path: string): string {
  try {
    return TEXT_DECODER.decode(bytes)
  } catch {
    throw new SaveBackupPackageError(
      "SAVE_BACKUP_TEXT_DECODE_FAILED",
      `存档备份文件不是有效的 UTF-8 文本：${path}`,
    )
  }
}

function normalizePackagePath(value: string, code: string): string {
  const raw = value.trim().replace(/\\/g, "/")
  if (!raw || raw.startsWith("/") || raw.includes("\0")) {
    throw new SaveBackupPackageError(code, `存档备份路径不安全：${raw}`)
  }
  const parts: string[] = []
  for (const part of raw.split("/")) {
    if (!part || part === ".") {
      continue
    }
    if (part === "..") {
      throw new SaveBackupPackageError(code, `存档备份路径不能包含 '..'：${raw}`)
    }
    parts.push(part)
  }
  if (parts.length === 0) {
    throw new SaveBackupPackageError(code, "存档备份路径不能为空。")
  }
  return parts.join("/")
}

function assertBackupWorkspacePath(pathInput: string): string {
  const path = normalizeWorkspaceFilePath(pathInput)
  if (!isSaveRuntimePersistencePath(path)) {
    throw new SaveBackupPackageError(
      "SAVE_BACKUP_PATH_UNSUPPORTED",
      `存档备份包含非存档路径：${path}`,
    )
  }
  return path
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}

function fileBlob(file: CheckpointWorkspaceFile): { blob: Blob; kind: "text" | "binary"; mediaType: string } {
  if (file.data) {
    const mediaType = resolveBlobMediaType(file.path, file.data)
    return { blob: file.data, kind: "binary", mediaType }
  }
  const mediaType = inferMediaTypeFromPath(file.path, { fallback: "text/plain" })
  return { blob: new Blob([file.content], { type: mediaType }), kind: "text", mediaType }
}

async function backupPayloadFromFile(file: CheckpointWorkspaceFile): Promise<SaveBackupFilePayload> {
  const path = assertBackupWorkspacePath(file.path)
  const { blob, kind, mediaType } = fileBlob({ ...file, path })
  return {
    entry: {
      path,
      hash: await sha256Hex(blob),
      size: blob.size,
      mediaType,
      kind,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    },
    blob,
  }
}

export async function collectLocalSaveBackupSnapshot(saveId: string): Promise<LocalSaveBackupSnapshot> {
  const save = await localDb.saves.get(saveId)
  if (!save) {
    throw new SaveBackupPackageError("SAVE_BACKUP_SAVE_NOT_FOUND", `存档不存在：${saveId}`)
  }
  const card = save.gameCardId ? await getLocalGameCard(save.gameCardId) : null
  const sourceFiles = card
    ? await listEffectiveWorkspaceFilesForSave(saveId, card)
    : await listWorkspaceFilesForSave(saveId)
  const runtimeFiles = saveRuntimeFilesFromEffectiveWorkspace(sourceFiles)
  const files: SaveBackupFilePayload[] = []
  let sizeBytes = 0
  for (const file of runtimeFiles) {
    const payload = await backupPayloadFromFile(file)
    files.push(payload)
    sizeBytes += payload.entry.size
  }
  return { save, files, sizeBytes }
}

export async function exportLocalSaveBackup(saveId: string): Promise<Blob> {
  const snapshot = await collectLocalSaveBackupSnapshot(saveId)
  const manifest: SaveBackupManifest = {
    schema: SAVE_BACKUP_SCHEMA,
    name: snapshot.save.name,
    cardId: snapshot.save.gameCardId ?? "",
    cardVersion: snapshot.save.gameCardVersion ?? "",
    exportedAt: Date.now(),
    files: snapshot.files.map((file) => file.entry),
  }
  const zipInput: Record<string, Uint8Array> = {
    [SAVE_BACKUP_MANIFEST_PATH]: strToU8(`${JSON.stringify(manifest, null, 2)}\n`),
  }
  for (const file of snapshot.files) {
    zipInput[`${WORKSPACE_PREFIX}${file.entry.path}`] = new Uint8Array(await file.blob.arrayBuffer())
  }
  const zipped = zipSync(zipInput, { level: 6 })
  return new Blob([zipped], { type: "application/zip" })
}

function normalizeManifestFileEntry(value: unknown): CloudBackupFileEntry {
  if (!isRecord(value)) {
    throw new SaveBackupPackageError("SAVE_BACKUP_FILE_ENTRY_INVALID", "存档备份文件清单格式无效。")
  }
  const path = assertBackupWorkspacePath(requireString(
    value.path,
    "SAVE_BACKUP_FILE_PATH_REQUIRED",
    "存档备份文件路径不能为空。",
  ))
  const hash = requireString(value.hash, "SAVE_BACKUP_FILE_HASH_REQUIRED", `存档备份文件缺少哈希：${path}`).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw new SaveBackupPackageError("SAVE_BACKUP_FILE_HASH_INVALID", `存档备份文件哈希无效：${path}`)
  }
  const size = typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
    ? Math.floor(value.size)
    : -1
  if (size < 0) {
    throw new SaveBackupPackageError("SAVE_BACKUP_FILE_SIZE_INVALID", `存档备份文件大小无效：${path}`)
  }
  const kind = value.kind === "binary" ? "binary" : value.kind === "text" ? "text" : null
  if (!kind) {
    throw new SaveBackupPackageError("SAVE_BACKUP_FILE_KIND_INVALID", `存档备份文件类型无效：${path}`)
  }
  return {
    path,
    hash,
    size,
    mediaType: typeof value.mediaType === "string" && value.mediaType.trim()
      ? value.mediaType.trim()
      : inferMediaTypeFromPath(path),
    kind,
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
    updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  }
}

function normalizeSaveBackupManifest(value: unknown): SaveBackupManifest {
  if (!isRecord(value)) {
    throw new SaveBackupPackageError("SAVE_BACKUP_MANIFEST_INVALID", "存档备份清单格式无效。")
  }
  const schema = requireString(value.schema, "SAVE_BACKUP_SCHEMA_REQUIRED", "存档备份缺少 schema。")
  if (schema !== SAVE_BACKUP_SCHEMA) {
    throw new SaveBackupPackageError("SAVE_BACKUP_SCHEMA_UNSUPPORTED", `不支持的存档备份格式：${schema}`)
  }
  if (!Array.isArray(value.files)) {
    throw new SaveBackupPackageError("SAVE_BACKUP_FILES_INVALID", "存档备份文件清单必须是数组。")
  }
  return {
    schema,
    name: requireString(value.name, "SAVE_BACKUP_NAME_REQUIRED", "存档备份缺少名称。"),
    cardId: requireString(value.cardId, "SAVE_BACKUP_CARD_ID_REQUIRED", "存档备份缺少游戏卡 ID。"),
    cardVersion: requireString(value.cardVersion, "SAVE_BACKUP_CARD_VERSION_REQUIRED", "存档备份缺少游戏卡版本。"),
    exportedAt: typeof value.exportedAt === "number" && Number.isFinite(value.exportedAt) ? value.exportedAt : Date.now(),
    files: value.files.map(normalizeManifestFileEntry),
  }
}

export async function parseLocalSaveBackupPackage(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<ParsedSaveBackupPackage> {
  const entries = unzipSync(await toUint8Array(input))
  const manifestBytes = entries[SAVE_BACKUP_MANIFEST_PATH]
  if (!manifestBytes) {
    throw new SaveBackupPackageError("SAVE_BACKUP_MANIFEST_MISSING", "存档备份缺少清单文件。")
  }
  const manifest = normalizeSaveBackupManifest(JSON.parse(decodeText(manifestBytes, SAVE_BACKUP_MANIFEST_PATH)) as unknown)
  const files: CheckpointWorkspaceFile[] = []
  const seen = new Set<string>()
  for (const entry of manifest.files) {
    if (seen.has(entry.path)) {
      throw new SaveBackupPackageError("SAVE_BACKUP_DUPLICATE_PATH", `存档备份包含重复路径：${entry.path}`)
    }
    seen.add(entry.path)
    const zipPath = `${WORKSPACE_PREFIX}${entry.path}`
    const bytes = entries[zipPath]
    if (!bytes) {
      throw new SaveBackupPackageError("SAVE_BACKUP_FILE_MISSING", `存档备份缺少文件：${entry.path}`)
    }
    const blob = new Blob([bytes as BlobPart], { type: entry.mediaType })
    if (blob.size !== entry.size) {
      throw new SaveBackupPackageError("SAVE_BACKUP_FILE_SIZE_MISMATCH", `存档备份文件大小不匹配：${entry.path}`)
    }
    if (await sha256Hex(blob) !== entry.hash) {
      throw new SaveBackupPackageError("SAVE_BACKUP_FILE_HASH_MISMATCH", `存档备份文件校验失败：${entry.path}`)
    }
    files.push(entry.kind === "binary"
      ? {
          path: entry.path,
          content: "",
          data: blob,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        }
      : {
          path: entry.path,
          content: decodeText(bytes, entry.path),
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        })
  }
  return { manifest, files }
}

async function resetSaveCheckpoint(saveId: string, label: string): Promise<void> {
  await deleteCheckpointsForSave(saveId)
  await deleteBlobsForSave(saveId)
  const turn = getMaxTurnFromTurnFiles(await listWorkspaceFilesForSave(saveId))
  await createCheckpointForSave(saveId, {
    turn,
    reason: "manual",
    label,
  })
}

export async function createLocalSaveFromBackupPackage(
  card: LocalGameCardRecord,
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<LocalSaveRecord> {
  const parsed = await parseLocalSaveBackupPackage(input)
  if (parsed.manifest.cardId !== card.id) {
    throw new SaveBackupPackageError(
      "SAVE_BACKUP_CARD_MISMATCH",
      `这个存档属于另一张游戏卡：${parsed.manifest.cardId}`,
    )
  }
  const save = await createLocalSaveFromGameCard(card, { name: parsed.manifest.name })
  await replaceWorkspaceFilesForSave(save.id, parsed.files)
  await resetSaveCheckpoint(save.id, "导入存档")
  await updateLocalSaveCloudBackupMetadata(save.id, {
    updatedAt: Date.now(),
    gameCardVersion: parsed.manifest.cardVersion,
  })
  return await localDb.saves.get(save.id) ?? save
}

export async function replaceLocalSaveFromCloudBackup(
  saveId: string,
  backup: CloudBackupManifestResponse,
  files: CheckpointWorkspaceFile[],
): Promise<LocalSaveRecord> {
  const save = await localDb.saves.get(saveId)
  if (!save) {
    throw new SaveBackupPackageError("SAVE_BACKUP_SAVE_NOT_FOUND", `存档不存在：${saveId}`)
  }
  await replaceWorkspaceFilesForSave(saveId, files)
  await resetSaveCheckpoint(saveId, "同步云端")
  return updateLocalSaveCloudBackupMetadata(saveId, {
    updatedAt: Date.now(),
    name: backup.name,
    gameCardVersion: backup.cardVersion,
    cloudBackupId: backup.id,
    cloudBackupRevisionId: backup.revisionId,
    cloudBackedUpAt: Date.now(),
  })
}

export async function createLocalSaveFromCloudBackup(
  card: LocalGameCardRecord,
  backup: CloudBackupManifestResponse,
  files: CheckpointWorkspaceFile[],
): Promise<LocalSaveRecord> {
  if (backup.cardId !== card.id) {
    throw new SaveBackupPackageError("SAVE_BACKUP_CARD_MISMATCH", `这个云端备份属于另一张游戏卡：${backup.cardId}`)
  }
  const save = await createLocalSaveFromGameCard(card, { name: backup.name })
  await replaceWorkspaceFilesForSave(save.id, files)
  await resetSaveCheckpoint(save.id, "同步云端")
  return updateLocalSaveCloudBackupMetadata(save.id, {
    updatedAt: Date.now(),
    gameCardVersion: backup.cardVersion,
    cloudBackupId: backup.id,
    cloudBackupRevisionId: backup.revisionId,
    cloudBackedUpAt: Date.now(),
  })
}

export async function updateLocalSaveCloudBackupMetadata(
  saveId: string,
  input: {
    name?: string
    gameCardVersion?: string
    cloudBackupId?: string
    cloudBackupRevisionId?: string
    cloudBackedUpAt?: number
    updatedAt?: number
  },
): Promise<LocalSaveRecord> {
  const save = await localDb.saves.get(saveId)
  if (!save) {
    throw new SaveBackupPackageError("SAVE_BACKUP_SAVE_NOT_FOUND", `存档不存在：${saveId}`)
  }
  const updated: LocalSaveRecord = {
    ...save,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.gameCardVersion !== undefined ? { gameCardVersion: input.gameCardVersion } : {}),
    ...(input.cloudBackupId !== undefined ? { cloudBackupId: input.cloudBackupId } : {}),
    ...(input.cloudBackupRevisionId !== undefined ? { cloudBackupRevisionId: input.cloudBackupRevisionId } : {}),
    ...(input.cloudBackedUpAt !== undefined ? { cloudBackedUpAt: input.cloudBackedUpAt } : {}),
    ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
  }
  await localDb.saves.put(updated)
  return updated
}
