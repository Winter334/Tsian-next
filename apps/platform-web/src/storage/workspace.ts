import type {
  AgentConfig,
  GameCardContentFile,
  WorkspaceEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import {
  binaryPlaceholderText,
  inferMediaTypeFromPath,
  isTextMediaType,
} from "@/lib/media-type"
import { normalizeWorkspacePath } from "@/lib/workspace-path"
import {
  listLocalGameCardContentFiles,
  listLocalGameCardFrontendFiles,
  type LocalGameCardContentFile,
} from "./game-cards"
import { normalizeGameCardManifest } from "./game-card-packages"
import {
  localDb,
  type LocalGameCardRecord,
  type LocalWorkspaceFileRecord,
} from "./db"

// re-export shared types/errors for public API (no local binding)
export type {
  CheckpointWorkspaceFile,
  WorkspaceListInput,
  WorkspaceWriteInput,
  RuntimeWorkspaceTransaction,
} from "./workspace-types"
export { WorkspaceStorageError } from "./workspace-types"
// import for internal use (local binding)
import { WorkspaceStorageError } from "./workspace-types"
import type {
  CheckpointWorkspaceFile,
  WorkspaceListInput,
  WorkspaceWriteInput,
  RuntimeWorkspaceTransaction,
} from "./workspace-types"

import {
  DEFAULT_WORKSPACE_FILES,
  DEFAULT_SAVE_RUNTIME_FILES,
  DEFAULT_WORKSPACE_VERSION,
  WORKSPACE_MANIFEST_PATH,
  DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS,
  RUNTIME_DEFAULT_CARD_PATHS,
} from "./workspace-templates"
function createTableId(saveId: string, path: string): string {
  return [
    saveId,
    "workspace",
    encodeURIComponent(path),
  ].join(":")
}

function normalizeDirectoryPath(value: unknown): string {
  const result = normalizeWorkspacePath(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

export function normalizeWorkspaceFilePath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

function normalizeWorkspaceTargetPath(value: unknown): string {
  const result = normalizeWorkspacePath(value, {
    allowEmpty: false,
    rejectTrailingSlash: false,
  })
  if (!result.ok) {
    throw new WorkspaceStorageError(result.code, result.message)
  }
  return result.path
}

function toContentFile(file: {
  path: string
  content: string
}): GameCardContentFile {
  const path = normalizeWorkspaceFilePath(file.path)
  return {
    path,
    content: file.content,
    mediaType: inferMediaTypeFromPath(path, { fallback: "text/plain" }),
  }
}

export function createDefaultWorkspaceTemplateFiles(): GameCardContentFile[] {
  return DEFAULT_WORKSPACE_FILES
    .filter((file) => !RUNTIME_DEFAULT_CARD_PATHS.has(file.path))
    .map(toContentFile)
}

export function createDefaultSaveRuntimeFiles(): CheckpointWorkspaceFile[] {
  const now = Date.now()
  return DEFAULT_SAVE_RUNTIME_FILES.map((file) => {
    const path = normalizeWorkspaceFilePath(file.path)
    return {
      path,
      content: file.content,
      createdAt: now,
      updatedAt: now,
    }
  })
}

function fileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

export function isPlatformMetadataPath(path: string): boolean {
  return path === ".tsian" || path.startsWith(".tsian/")
}

export function isActiveSaveRuntimePath(path: string): boolean {
  return path === "save" || path.startsWith("save/")
}

export function isSaveRuntimePersistencePath(path: string): boolean {
  if (isActiveSaveRuntimePath(path)) {
    return true
  }
  // .tsian/local/ is local-only data excluded from save checkpoint/restore.
  if (path === ".tsian/local" || path.startsWith(".tsian/local/")) {
    return false
  }
  return isPlatformMetadataPath(path)
}

export function isOrdinaryWorkspacePath(path: string): boolean {
  return !isPlatformMetadataPath(path)
}

function assertOrdinarySaveRuntimeMutationPath(path: string): void {
  if (isPlatformMetadataPath(path)) {
    throw new WorkspaceStorageError(
      "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
      "Platform metadata paths under .tsian are host-owned.",
    )
  }

  if (isActiveSaveRuntimePath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED",
    "Runtime workspace mutations must target the active save under save/.",
  )
}

function assertOrdinaryReadPath(path: string): void {
  if (!isPlatformMetadataPath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
    "Platform metadata paths under .tsian are not available through ordinary workspace reads.",
  )
}

function assertPlatformSaveRuntimeMutationPath(path: string): void {
  if (isSaveRuntimePersistencePath(path)) {
    return
  }

  throw new WorkspaceStorageError(
    "WORKSPACE_SAVE_RUNTIME_PATH_REQUIRED",
    "Platform runtime workspace mutations must target save/ or .tsian/.",
  )
}

function ordinaryWorkspaceFiles(files: WorkspaceFile[]): WorkspaceFile[] {
  return files.filter((file) => isOrdinaryWorkspacePath(file.path))
}

function toWorkspaceFile(record: LocalWorkspaceFileRecord): WorkspaceFile {
  if (record.data) {
    return {
      path: record.path,
      // Binary files surface a placeholder string (not "") so agents do not
      // misjudge the file as empty. Future multimodal support will replace
      // this with an image content block through an independent channel.
      content: binaryPlaceholderText(record.data, record.path),
      binary: record.data,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }
  return {
    path: record.path,
    content: record.content,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function toWorkspaceFileFromGameCardContent(
  file: LocalGameCardContentFile,
): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(file.path)
  if (file.data) {
    return {
      path,
      content: binaryPlaceholderText(file.data, path),
      binary: file.data,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }
  }
  return {
    path,
    content: typeof file.content === "string" ? file.content : "",
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

function cloneWorkspaceFile(file: WorkspaceFile): WorkspaceFile {
  return {
    path: file.path,
    content: file.content,
    ...(file.binary ? { binary: file.binary } : {}),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

function toCheckpointWorkspaceFile(
  record: LocalWorkspaceFileRecord,
): CheckpointWorkspaceFile {
  const { id: _id, saveId: _saveId, ...file } = record
  return file
}

export function createLocalWorkspaceFileRecord(
  saveId: string,
  file: CheckpointWorkspaceFile,
): LocalWorkspaceFileRecord {
  const path = normalizeWorkspaceFilePath(file.path)
  return {
    id: createTableId(saveId, path),
    saveId,
    path,
    content: typeof file.content === "string" ? file.content : "",
    ...(file.data ? { data: file.data } : {}),
    createdAt: typeof file.createdAt === "number" ? file.createdAt : Date.now(),
    updatedAt: typeof file.updatedAt === "number" ? file.updatedAt : Date.now(),
  }
}

async function touchSave(saveId: string, updatedAt: number): Promise<void> {
  const save = await localDb.saves.get(saveId)
  if (!save) {
    return
  }
  await localDb.saves.put({
    ...save,
    updatedAt,
  })
}

function defaultWorkspaceFileByPath(path: string): {
  path: string
  content: string
  mediaType?: string
} | undefined {
  return DEFAULT_SAVE_RUNTIME_FILES.find((file) => file.path === path)
}

function parseWorkspaceManifestVersion(content: string | undefined): number {
  if (!content) {
    return 0
  }

  try {
    const parsed = JSON.parse(content) as unknown
    if (
      typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
      && typeof (parsed as { workspaceVersion?: unknown }).workspaceVersion === "number"
      && Number.isFinite((parsed as { workspaceVersion: number }).workspaceVersion)
    ) {
      return Math.max(0, Math.floor((parsed as { workspaceVersion: number }).workspaceVersion))
    }
  } catch {
    return 0
  }

  return 0
}

function plainRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function serializeWorkspaceManifest(content: string | undefined): string {
  let base: Record<string, unknown> = {}
  if (content) {
    try {
      const parsed = JSON.parse(content) as unknown
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
      base = {}
    }
  }

  return JSON.stringify({
    ...base,
    version: typeof base.version === "string" ? base.version : "0.0.0",
    workspaceVersion: DEFAULT_WORKSPACE_VERSION,
    contentModel: {
      ...plainRecord(base.contentModel),
      fileContent: "text",
      binaryContent: false,
      cardContentRoot: "/",
      activeSaveRoot: "save/",
    },
    platformMetadata: {
      ...plainRecord(base.platformMetadata),
      path: ".tsian/",
      ordinaryWorkspaceVisible: false,
    },
  }, null, 2) + "\n"
}

async function upgradeDefaultWorkspaceFilesForSave(saveId: string): Promise<void> {
  const existingRecords = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  const existingByPath = new Map(existingRecords.map((record) => [record.path, record]))
  const manifest = existingByPath.get(WORKSPACE_MANIFEST_PATH)
  if (parseWorkspaceManifestVersion(manifest?.content) >= DEFAULT_WORKSPACE_VERSION) {
    return
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    for (const path of DEFAULT_SAVE_RUNTIME_UPGRADE_FILE_PATHS) {
      if (existingByPath.has(path)) {
        continue
      }

      const defaultFile = defaultWorkspaceFileByPath(path)
      if (!defaultFile) {
        continue
      }

      await localDb.workspaceFiles.put({
        id: createTableId(saveId, path),
        saveId,
        path,
        content: defaultFile.content,
        createdAt: now,
        updatedAt: now,
      })
    }

    await localDb.workspaceFiles.put({
      id: createTableId(saveId, WORKSPACE_MANIFEST_PATH),
      saveId,
      path: WORKSPACE_MANIFEST_PATH,
      content: serializeWorkspaceManifest(manifest?.content),
      createdAt: manifest?.createdAt ?? now,
      updatedAt: now,
    })
  })
}

export async function initializeWorkspaceForSave(saveId: string): Promise<void> {
  const existingCount = await localDb.workspaceFiles.where("saveId").equals(saveId).count()
  if (existingCount > 0) {
    await upgradeDefaultWorkspaceFilesForSave(saveId)
    return
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    for (const file of createDefaultSaveRuntimeFiles()) {
      const path = normalizeWorkspaceFilePath(file.path)
      await localDb.workspaceFiles.put({
        id: createTableId(saveId, path),
        saveId,
        path,
        content: file.content,
        ...(file.data ? { data: file.data } : {}),
        createdAt: now,
        updatedAt: now,
      })
    }
  })
}

export async function listLocalWorkspaceFilesForSave(
  saveId: string,
): Promise<LocalWorkspaceFileRecord[]> {
  const records = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  return records.sort((left, right) => left.path.localeCompare(right.path))
}

export async function listWorkspaceFilesForSave(
  saveId: string,
): Promise<WorkspaceFile[]> {
  return (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile)
}

export async function listEffectiveWorkspaceFilesForSave(
  saveId: string,
  card: LocalGameCardRecord,
): Promise<WorkspaceFile[]> {
  const filesByPath = new Map<string, WorkspaceFile>()
  for (const file of await listLocalGameCardContentFiles(card.id)) {
    const workspaceFile = toWorkspaceFileFromGameCardContent(file)
    filesByPath.set(workspaceFile.path, workspaceFile)
  }

  // 前端文件（card-frontend，纯二进制存储）只读接入 effective list。与
  // cardFrontendVolume.enumerate 同构（storage 层不依赖 host 层 volume，直接用原生
  // API）。文本类前端文件（html/css/js/json/svg）→ await data.text() 填 content；
  // 媒体类（图片/音视频）→ binary + placeholder。write/delete 路径经 host 层 dispatch
  // 走 volume，待子3 补单文件 API。
  for (const frontendFile of await listLocalGameCardFrontendFiles(card.id)) {
    const mediaType = inferMediaTypeFromPath(frontendFile.path)
    if (isTextMediaType(mediaType) || mediaType === "image/svg+xml") {
      filesByPath.set(frontendFile.path, {
        path: frontendFile.path,
        content: await frontendFile.data.text(),
        createdAt: frontendFile.createdAt,
        updatedAt: frontendFile.updatedAt,
      })
    } else {
      filesByPath.set(frontendFile.path, {
        path: frontendFile.path,
        content: binaryPlaceholderText(frontendFile.data, frontendFile.path),
        binary: frontendFile.data,
        createdAt: frontendFile.createdAt,
        updatedAt: frontendFile.updatedAt,
      })
    }
  }

  // 合成 manifest 文件（game-card.json，不存表，list 时 JSON.stringify 注入）。
  // 与 manifestVolume.enumerate 同构（storage 层不依赖 host 层 volume，直接合成）。
  filesByPath.set("game-card.json", {
    path: "game-card.json",
    content: JSON.stringify(normalizeGameCardManifest(card.manifest), null, 2),
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  })

  for (const record of await listLocalWorkspaceFilesForSave(saveId)) {
    const workspaceFile = toWorkspaceFile(record)
    filesByPath.set(workspaceFile.path, workspaceFile)
  }

  return Array.from(filesByPath.values())
    .map(cloneWorkspaceFile)
    .sort((left, right) => left.path.localeCompare(right.path))
}

export async function listCheckpointWorkspaceFilesForSave(
  saveId: string,
): Promise<CheckpointWorkspaceFile[]> {
  return (await listLocalWorkspaceFilesForSave(saveId)).map(toCheckpointWorkspaceFile)
}

export function saveRuntimeFilesFromEffectiveWorkspace(
  workspaceFiles: WorkspaceFile[],
): CheckpointWorkspaceFile[] {
  const filesByPath = new Map<string, CheckpointWorkspaceFile>()
  for (const file of workspaceFiles) {
    const path = normalizeWorkspaceFilePath(file.path)
    if (!isSaveRuntimePersistencePath(path)) {
      continue
    }

    filesByPath.set(path, {
      path,
      content: typeof file.content === "string" ? file.content : "",
      ...(file.binary ? { data: file.binary } : {}),
      createdAt: typeof file.createdAt === "number" ? file.createdAt : Date.now(),
      updatedAt: typeof file.updatedAt === "number" ? file.updatedAt : Date.now(),
    })
  }

  return Array.from(filesByPath.values())
    .sort((left, right) => left.path.localeCompare(right.path))
}

export function listWorkspaceEntriesFromFiles(
  workspaceFiles: WorkspaceFile[],
  input: WorkspaceListInput = {},
): WorkspaceEntry[] {
  const directoryPath = normalizeDirectoryPath(input.path)
  const prefix = directoryPath ? `${directoryPath}/` : ""
  const files = new Map<string, WorkspaceEntry>()
  const directories = new Map<string, WorkspaceEntry & { children: Set<string> }>()

  for (const file of ordinaryWorkspaceFiles(workspaceFiles)) {
    if (directoryPath && !file.path.startsWith(prefix)) {
      continue
    }

    const remainder = directoryPath
      ? file.path.slice(prefix.length)
      : file.path
    if (!remainder) {
      continue
    }

    const slashIndex = remainder.indexOf("/")
    if (slashIndex === -1) {
      files.set(file.path, {
        path: file.path,
        name: fileName(file.path),
        kind: "file",
        size: file.binary?.size ?? file.content.length,
        updatedAt: file.updatedAt,
      })
      continue
    }

    const childName = remainder.slice(0, slashIndex)
    const childPath = prefix ? `${prefix}${childName}` : childName
    const nextSegment = remainder.slice(slashIndex + 1).split("/")[0]
    const existing = directories.get(childPath)
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt ?? 0, file.updatedAt)
      if (nextSegment) existing.children.add(nextSegment)
      continue
    }

    const children = new Set<string>()
    if (nextSegment) children.add(nextSegment)
    directories.set(childPath, {
      path: childPath,
      name: childName,
      kind: "directory",
      updatedAt: file.updatedAt,
      childCount: 0,
      children,
    })
  }

  const directoryEntries = Array.from(directories.values()).map(
    ({ children, ...entry }) => ({
      ...entry,
      childCount: children.size,
    }),
  )

  return [
    ...directoryEntries.sort((left, right) => left.name.localeCompare(right.name)),
    ...Array.from(files.values()).sort((left, right) => left.name.localeCompare(right.name)),
  ]
}

export async function listWorkspaceEntriesForSave(
  saveId: string,
  input: WorkspaceListInput = {},
): Promise<WorkspaceEntry[]> {
  return listWorkspaceEntriesFromFiles(
    (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile),
    input,
  )
}

export async function readWorkspaceFileForSave(
  saveId: string,
  pathInput: unknown,
): Promise<WorkspaceFile | null> {
  const path = normalizeWorkspaceFilePath(pathInput)
  assertOrdinaryReadPath(path)
  const record = await localDb.workspaceFiles.get(createTableId(saveId, path))
  return record ? toWorkspaceFile(record) : null
}

export function readWorkspaceFileFromFiles(
  workspaceFiles: WorkspaceFile[],
  pathInput: unknown,
): WorkspaceFile | null {
  const path = normalizeWorkspaceFilePath(pathInput)
  const file = workspaceFiles.find((candidate) => candidate.path === path)
  return file ? cloneWorkspaceFile(file) : null
}

export function readOrdinaryWorkspaceFileFromFiles(
  workspaceFiles: WorkspaceFile[],
  pathInput: unknown,
): WorkspaceFile | null {
  const path = normalizeWorkspaceFilePath(pathInput)
  assertOrdinaryReadPath(path)
  const file = workspaceFiles.find((candidate) => candidate.path === path)
  return file ? cloneWorkspaceFile(file) : null
}

function writeWorkspaceFileToFiles(
  workspaceFiles: WorkspaceFile[],
  input: WorkspaceWriteInput,
  options: { allowPlatformMetadata: boolean },
): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(input.path)
  if (options.allowPlatformMetadata) {
    assertPlatformSaveRuntimeMutationPath(path)
  } else {
    assertOrdinarySaveRuntimeMutationPath(path)
  }

  const isTextContent = typeof input.content === "string"
  const binaryData = input.data instanceof Blob ? input.data : undefined
  if (!isTextContent && !binaryData) {
    throw new WorkspaceStorageError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace file write requires either content (string) or data (Blob).",
    )
  }

  const now = Date.now()
  const existingIndex = workspaceFiles.findIndex((file) => file.path === path)
  const existing = existingIndex >= 0 ? workspaceFiles[existingIndex] : undefined
  const nextFile: WorkspaceFile = binaryData
    ? {
        path,
        content: binaryPlaceholderText(binaryData, path),
        binary: binaryData,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }
    : {
        path,
        content: input.content as string,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      }

  if (existingIndex >= 0) {
    workspaceFiles[existingIndex] = nextFile
  } else {
    workspaceFiles.push(nextFile)
  }
  workspaceFiles.sort((left, right) => left.path.localeCompare(right.path))
  return cloneWorkspaceFile(nextFile)
}

function deleteWorkspacePathFromFiles(
  workspaceFiles: WorkspaceFile[],
  pathInput: unknown,
  options: { allowPlatformMetadata: boolean },
): { deletedPaths: string[] } {
  const path = normalizeWorkspaceTargetPath(pathInput)
  if (options.allowPlatformMetadata) {
    assertPlatformSaveRuntimeMutationPath(path)
  } else {
    assertOrdinarySaveRuntimeMutationPath(path)
  }

  const prefix = `${path}/`
  const deletedPaths = workspaceFiles
    .filter((file) => file.path === path || file.path.startsWith(prefix))
    .map((file) => file.path)
    .sort()

  if (deletedPaths.length === 0) {
    return { deletedPaths: [] }
  }

  const deletedPathSet = new Set(deletedPaths)
  for (let index = workspaceFiles.length - 1; index >= 0; index -= 1) {
    const file = workspaceFiles[index]
    if (file && deletedPathSet.has(file.path)) {
      workspaceFiles.splice(index, 1)
    }
  }

  return { deletedPaths }
}

export function createRuntimeWorkspaceTransaction(
  baselineFiles: WorkspaceFile[],
): RuntimeWorkspaceTransaction {
  const stagedFiles = baselineFiles
    .map(cloneWorkspaceFile)
    .sort((left, right) => left.path.localeCompare(right.path))

  return {
    workspaceFiles: stagedFiles,
    write(input) {
      return writeWorkspaceFileToFiles(stagedFiles, input, {
        allowPlatformMetadata: false,
      })
    },
    writePlatformFile(input) {
      return writeWorkspaceFileToFiles(stagedFiles, input, {
        allowPlatformMetadata: true,
      })
    },
    delete(path) {
      return deleteWorkspacePathFromFiles(stagedFiles, path, {
        allowPlatformMetadata: false,
      })
    },
    finalWorkspaceFiles() {
      return stagedFiles
        .map(cloneWorkspaceFile)
        .sort((left, right) => left.path.localeCompare(right.path))
    },
    discard() {
      stagedFiles.splice(0, stagedFiles.length)
    },
  }
}

async function writeWorkspaceFileForSaveWithOptions(
  saveId: string,
  input: WorkspaceWriteInput,
  options: { allowPlatformMetadata: boolean },
): Promise<WorkspaceFile> {
  const path = normalizeWorkspaceFilePath(input.path)
  if (options.allowPlatformMetadata) {
    assertPlatformSaveRuntimeMutationPath(path)
  } else {
    assertOrdinarySaveRuntimeMutationPath(path)
  }

  const isTextContent = typeof input.content === "string"
  const binaryData = input.data instanceof Blob ? input.data : undefined
  if (!isTextContent && !binaryData) {
    throw new WorkspaceStorageError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace file write requires either content (string) or data (Blob).",
    )
  }

  const now = Date.now()
  const id = createTableId(saveId, path)
  let nextRecord: LocalWorkspaceFileRecord | null = null

  await localDb.transaction("rw", localDb.saves, localDb.workspaceFiles, async () => {
    const existing = await localDb.workspaceFiles.get(id)
    nextRecord = {
      id,
      saveId,
      path,
      content: isTextContent ? (input.content as string) : "",
      ...(binaryData ? { data: binaryData } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await localDb.workspaceFiles.put(nextRecord)
    await touchSave(saveId, now)
  })

  if (!nextRecord) {
    throw new WorkspaceStorageError(
      "WORKSPACE_WRITE_FAILED",
      "Workspace file write did not produce a record.",
    )
  }

  return toWorkspaceFile(nextRecord)
}

export async function writeWorkspaceFileForSave(
  saveId: string,
  input: WorkspaceWriteInput,
): Promise<WorkspaceFile> {
  return writeWorkspaceFileForSaveWithOptions(saveId, input, {
    allowPlatformMetadata: false,
  })
}

export async function writePlatformWorkspaceFileForSave(
  saveId: string,
  input: WorkspaceWriteInput,
): Promise<WorkspaceFile> {
  return writeWorkspaceFileForSaveWithOptions(saveId, input, {
    allowPlatformMetadata: true,
  })
}

export async function deleteWorkspacePathForSave(
  saveId: string,
  pathInput: unknown,
): Promise<{ deletedPaths: string[] }> {
  const path = normalizeWorkspaceTargetPath(pathInput)
  assertOrdinarySaveRuntimeMutationPath(path)
  const prefix = `${path}/`
  const rows = (await listLocalWorkspaceFilesForSave(saveId))
    .filter((record) => record.path === path || record.path.startsWith(prefix))

  if (rows.length === 0) {
    return { deletedPaths: [] }
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.saves, localDb.workspaceFiles, async () => {
    await Promise.all(rows.map((record) => localDb.workspaceFiles.delete(record.id)))
    await touchSave(saveId, now)
  })

  return {
    deletedPaths: rows.map((record) => record.path).sort(),
  }
}

export async function replaceWorkspaceFilesForSave(
  saveId: string,
  files: CheckpointWorkspaceFile[],
): Promise<void> {
  const deduped = new Map<string, LocalWorkspaceFileRecord>()
  for (const file of files) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    deduped.set(record.path, record)
  }

  const existing = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    await Promise.all(existing.map((record) => localDb.workspaceFiles.delete(record.id)))
    for (const record of deduped.values()) {
      await localDb.workspaceFiles.put(record)
    }
  })
}

export async function deleteWorkspaceForSave(saveId: string): Promise<void> {
  const rows = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.workspaceFiles.delete(item.id)))
}
