import type {
  GameCardContentFile,
  GameCardManifest,
} from "@tsian/contracts"
import {
  localDb,
  type LocalGameCardContentFileRecord,
  type LocalGameCardFrontendFileRecord,
  type LocalGameCardRecord,
} from "./db"
import {
  createDefaultWorkspaceTemplateFiles,
  normalizeWorkspaceFilePath,
} from "./workspace"

export const BUILTIN_BLANK_GAME_CARD_ID = "tsian.builtin.blank"
const BUILTIN_BLANK_GAME_CARD_COVER_URL = "/default-card-cover.webp"
const ACTIVE_GAME_CARD_KEY = "active-game-card-id"

type GameCardSource = LocalGameCardRecord["source"]

export interface PutLocalGameCardInput {
  manifest: GameCardManifest
  /** undefined = leave the content table untouched; array = full replace inside the write transaction. */
  contentFiles?: GameCardContentFile[]
  frontendFiles?: PutLocalGameCardFrontendFileInput[]
  source?: GameCardSource
}

export interface PutLocalGameCardFrontendFileInput {
  path: string
  data: Blob | ArrayBuffer | Uint8Array | string
  mediaType?: string
}

export interface LocalGameCardFrontendFile {
  path: string
  data: Blob
  mediaType: string
  size: number
  createdAt: number
  updatedAt: number
}

export interface LocalGameCardContentFile {
  path: string
  content: string
  mediaType?: string
  createdAt: number
  updatedAt: number
}

/**
 * Read view returned to consumers. Extends the DB row with an optional
 * preloaded cover content file, so sync render paths (getGameCardCoverUrl in
 * Vue templates/computed) can resolve the cover without an async table query.
 * The field is non-persistent: it is injected by getLocalGameCard /
 * listLocalGameCards after cloning and is never written back to Dexie.
 */
export interface LocalGameCardView extends LocalGameCardRecord {
  coverContentFile?: LocalGameCardContentFile
}

function requireNonEmptyString(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`Game card ${fieldName} is required.`)
  }
  return normalized
}

function normalizePackageFilePath(value: string, fieldName: string): string {
  const raw = value.trim().replace(/\\/g, "/")
  if (!raw) {
    throw new Error(`Game card ${fieldName} is required.`)
  }
  if (raw.startsWith("/") || raw.includes("\0")) {
    throw new Error(`Game card ${fieldName} must be a relative package path.`)
  }

  const parts: string[] = []
  for (const part of raw.split("/")) {
    if (!part || part === ".") {
      continue
    }
    if (part === "..") {
      throw new Error(`Game card ${fieldName} cannot contain '..'.`)
    }
    parts.push(part)
  }

  if (parts.length === 0) {
    throw new Error(`Game card ${fieldName} is required.`)
  }

  return parts.join("/")
}

function normalizeFrontendBinding(manifest: GameCardManifest): GameCardManifest["frontend"] {
  const frontend = manifest.frontend
  if (!frontend) {
    return undefined
  }

  if (frontend.kind === "remote") {
    return {
      kind: "remote",
      url: requireNonEmptyString(frontend.url, "frontend.url"),
      bridgeVersion: frontend.bridgeVersion,
    }
  }

  if (frontend.kind === "packaged") {
    return {
      kind: "packaged",
      entry: normalizePackageFilePath(frontend.entry, "frontend.entry"),
      bridgeVersion: frontend.bridgeVersion,
    }
  }

  throw new Error(
    `Unsupported game card frontend kind: ${String((frontend as { kind?: unknown }).kind)}`,
  )
}

function legacyManifestDescription(manifest: GameCardManifest): string | undefined {
  const value = (manifest as { description?: unknown }).description
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeManifest(manifest: GameCardManifest): GameCardManifest {
  const summary = manifest.summary?.trim() || legacyManifestDescription(manifest)
  const frontend = normalizeFrontendBinding(manifest)
  return {
    schema: manifest.schema,
    id: requireNonEmptyString(manifest.id, "id"),
    name: requireNonEmptyString(manifest.name, "name"),
    version: requireNonEmptyString(manifest.version, "version"),
    summary: requireNonEmptyString(summary ?? "", "summary"),
    ...(manifest.author ? { author: manifest.author } : {}),
    ...(manifest.cover ? { cover: manifest.cover } : {}),
    ...(frontend ? { frontend } : {}),
  }
}

function normalizeTemplateFile(
  file: GameCardContentFile,
): GameCardContentFile {
  return {
    path: normalizeWorkspaceFilePath(file.path),
    content: typeof file.content === "string" ? file.content : "",
    ...(typeof file.mediaType === "string" && file.mediaType.trim()
      ? { mediaType: file.mediaType.trim() }
      : {}),
  }
}

function normalizeTemplateFiles(
  files: GameCardContentFile[],
): GameCardContentFile[] {
  const filesByPath = new Map<string, GameCardContentFile>()
  for (const file of files) {
    const normalized = normalizeTemplateFile(file)
    if (normalized.path === "save" || normalized.path.startsWith("save/")) {
      throw new Error("Game card content cannot use reserved save/ paths.")
    }
    if (normalized.path === ".tsian" || normalized.path.startsWith(".tsian/")) {
      throw new Error("Game card content cannot use reserved .tsian/ paths.")
    }
    filesByPath.set(normalized.path, normalized)
  }
  return Array.from(filesByPath.values()).sort((left, right) => left.path.localeCompare(right.path))
}

function gameCardFrontendFileId(gameCardId: string, path: string): string {
  return `${gameCardId}::${path}`
}

export function gameCardContentFileId(gameCardId: string, path: string): string {
  return `${gameCardId}::${path}`
}

function normalizeMediaType(mediaType: string | undefined, path: string): string {
  const normalized = mediaType?.trim()
  if (normalized) {
    return normalized
  }

  if (path.endsWith(".html")) return "text/html"
  if (path.endsWith(".css")) return "text/css"
  if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript"
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".svg")) return "image/svg+xml"
  if (path.endsWith(".png")) return "image/png"
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"
  if (path.endsWith(".webp")) return "image/webp"
  if (path.endsWith(".gif")) return "image/gif"
  if (path.endsWith(".avif")) return "image/avif"
  if (path.endsWith(".woff")) return "font/woff"
  if (path.endsWith(".woff2")) return "font/woff2"
  if (path.endsWith(".wasm")) return "application/wasm"
  if (path.endsWith(".mp3")) return "audio/mpeg"
  if (path.endsWith(".ogg")) return "audio/ogg"
  if (path.endsWith(".wav")) return "audio/wav"
  if (path.endsWith(".m4a")) return "audio/mp4"
  if (path.endsWith(".flac")) return "audio/flac"
  if (path.endsWith(".mp4")) return "video/mp4"
  if (path.endsWith(".webm")) return "video/webm"
  if (path.endsWith(".mov")) return "video/quicktime"
  return "application/octet-stream"
}

function toBlob(data: PutLocalGameCardFrontendFileInput["data"], mediaType: string): Blob {
  if (data instanceof Blob) {
    if (data.type === mediaType) {
      return data
    }
    return data.slice(0, data.size, mediaType)
  }

  if (data instanceof Uint8Array) {
    return new Blob([data.slice().buffer as ArrayBuffer], { type: mediaType })
  }

  return new Blob([data], { type: mediaType })
}

function normalizeFrontendFile(
  gameCardId: string,
  file: PutLocalGameCardFrontendFileInput,
  now: number,
): LocalGameCardFrontendFileRecord {
  const path = normalizePackageFilePath(file.path, "frontend file path")
  if (!path.startsWith("frontend/")) {
    throw new Error(`Game card frontend file must live under frontend/: ${path}`)
  }

  const mediaType = normalizeMediaType(file.mediaType, path)
  const data = toBlob(file.data, mediaType)
  return {
    id: gameCardFrontendFileId(gameCardId, path),
    gameCardId,
    path,
    data,
    mediaType,
    size: data.size,
    createdAt: now,
    updatedAt: now,
  }
}

function cloneGameCardFrontendFileRecord(
  record: LocalGameCardFrontendFileRecord,
): LocalGameCardFrontendFile {
  return {
    path: record.path,
    data: record.data,
    mediaType: record.mediaType,
    size: record.size,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function cloneLocalGameCardRecord(record: LocalGameCardRecord): LocalGameCardRecord {
  return {
    ...record,
    manifest: normalizeManifest(record.manifest),
  }
}

/** Build the read-view: clone the card row, then preload the cover content file
 *  (if manifest.cover.workspacePath is set) so sync render paths can resolve
 *  the cover without an async table query. Returns LocalGameCardView. */
async function toLocalGameCardView(record: LocalGameCardRecord): Promise<LocalGameCardView> {
  const view: LocalGameCardView = cloneLocalGameCardRecord(record)
  const coverPath = view.manifest.cover?.workspacePath?.trim()
  if (coverPath) {
    const coverFile = await readLocalGameCardContentFile(view.id, coverPath)
    if (coverFile) {
      view.coverContentFile = coverFile
    }
  }
  return view
}

function hasTemplateFile(
  files: GameCardContentFile[],
  expected: GameCardContentFile,
): boolean {
  return files.some((file) =>
    file.path === expected.path
    && file.content === expected.content
    && (file.mediaType ?? "") === (expected.mediaType ?? "")
  )
}

/** Staleness check now reads the per-file content table; preserves the existing
 *  builtin reset-protection semantic (builtin content drifted → ensureBuiltinBlankGameCard
 *  re-seeds). Async because it queries Dexie. */
async function isCurrentBuiltinBlankGameCard(record: LocalGameCardRecord): Promise<boolean> {
  if (record.source !== "builtin") {
    return true
  }

  if (
    record.manifest.cover?.url !== BUILTIN_BLANK_GAME_CARD_COVER_URL
    || record.manifest.cover?.alt !== "Blank Agent Runtime cover"
  ) {
    return false
  }

  const files = await listLocalGameCardContentFiles(record.id)
  return createDefaultWorkspaceTemplateFiles()
    .every((file) => hasTemplateFile(files, file))
}

function createBuiltinBlankGameCardRecord(
  createdAt: number,
  updatedAt: number = createdAt,
  frontend: GameCardManifest["frontend"] = undefined,
): LocalGameCardRecord {
  const manifest: GameCardManifest = {
    schema: "tsian.game-card.v1",
    id: BUILTIN_BLANK_GAME_CARD_ID,
    name: "Blank Agent Runtime",
    version: "0.0.0",
    summary: "A default empty Tsian Runtime Workspace with official Agent and Skill templates.",
    cover: {
      url: BUILTIN_BLANK_GAME_CARD_COVER_URL,
      alt: "Blank Agent Runtime cover",
    },
    ...(frontend ? { frontend } : {}),
  }

  return {
    id: manifest.id,
    manifest,
    source: "builtin",
    createdAt,
    updatedAt,
  }
}

export async function listLocalGameCards(): Promise<LocalGameCardView[]> {
  const records = await localDb.gameCards.orderBy("updatedAt").reverse().toArray()
  const views: LocalGameCardView[] = []
  for (const record of records) {
    views.push(await toLocalGameCardView(record))
  }
  return views
}

export async function getLocalGameCard(cardId: string): Promise<LocalGameCardView | null> {
  const id = cardId.trim()
  if (!id) {
    return null
  }

  const record = await localDb.gameCards.get(id)
  return record ? await toLocalGameCardView(record) : null
}

export async function getActiveGameCardId(): Promise<string | null> {
  const record = await localDb.meta.get(ACTIVE_GAME_CARD_KEY)
  return record?.value ?? null
}

export async function setActiveGameCardId(cardId: string | null): Promise<void> {
  const normalized = cardId?.trim()
  if (!normalized) {
    await localDb.meta.delete(ACTIVE_GAME_CARD_KEY)
    return
  }

  await localDb.meta.put({
    key: ACTIVE_GAME_CARD_KEY,
    value: normalized,
  })
}

export async function putLocalGameCard(
  input: PutLocalGameCardInput,
): Promise<LocalGameCardView> {
  const manifest = normalizeManifest(input.manifest)
  const now = Date.now()
  const existing = await localDb.gameCards.get(manifest.id)
  const frontendFileRecords = input.frontendFiles?.map((file) =>
    normalizeFrontendFile(manifest.id, file, now)
  )
  const contentFileRecords = input.contentFiles === undefined
    ? undefined
    : normalizeTemplateFiles(input.contentFiles).map((file) => ({
      id: gameCardContentFileId(manifest.id, file.path),
      gameCardId: manifest.id,
      path: file.path,
      content: file.content,
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
      createdAt: now,
      updatedAt: now,
    }))
  const record: LocalGameCardRecord = {
    id: manifest.id,
    manifest,
    source: input.source ?? existing?.source ?? "local",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  await localDb.transaction(
    "rw",
    [localDb.gameCards, localDb.gameCardContentFiles, localDb.gameCardFrontendFiles],
    async () => {
      await localDb.gameCards.put(record)
      if (contentFileRecords) {
        // Full replace: clear the card's content rows, then put each. undefined
        // (the "only manifest changed" case) leaves the content table untouched.
        await localDb.gameCardContentFiles
          .where("gameCardId")
          .equals(manifest.id)
          .delete()
        for (const file of contentFileRecords) {
          await localDb.gameCardContentFiles.put(file)
        }
      }
      if (frontendFileRecords) {
        await localDb.gameCardFrontendFiles
          .where("gameCardId")
          .equals(manifest.id)
          .delete()
        for (const file of frontendFileRecords) {
          await localDb.gameCardFrontendFiles.put(file)
        }
      }
    },
  )
  return await toLocalGameCardView(record)
}

export async function deleteLocalGameCard(cardId: string): Promise<void> {
  const id = cardId.trim()
  if (!id) {
    return
  }

  const existing = await localDb.gameCards.get(id)
  if (!existing) {
    return
  }
  if (existing.source === "builtin") {
    throw new Error("Built-in game cards cannot be deleted.")
  }

  await localDb.transaction(
    "rw",
    [localDb.gameCards, localDb.gameCardContentFiles, localDb.gameCardFrontendFiles],
    async () => {
      await localDb.gameCards.delete(id)
      await localDb.gameCardContentFiles
        .where("gameCardId")
        .equals(id)
        .delete()
      await localDb.gameCardFrontendFiles
        .where("gameCardId")
        .equals(id)
        .delete()
    },
  )
}

export async function listLocalGameCardContentFiles(
  gameCardId: string,
): Promise<LocalGameCardContentFile[]> {
  const id = gameCardId.trim()
  if (!id) {
    return []
  }

  const records = await localDb.gameCardContentFiles
    .where("gameCardId")
    .equals(id)
    .sortBy("path")
  return records.map(cloneGameCardContentFileRecord)
}

export async function readLocalGameCardContentFile(
  gameCardId: string,
  path: string,
): Promise<LocalGameCardContentFile | null> {
  const id = gameCardId.trim()
  if (!id) {
    return null
  }

  const normalizedPath = normalizeWorkspaceFilePath(path)
  const record = await localDb.gameCardContentFiles.get(
    gameCardContentFileId(id, normalizedPath),
  )
  return record ? cloneGameCardContentFileRecord(record) : null
}

export async function writeLocalGameCardContentFile(
  gameCardId: string,
  input: { path: string; content: string; mediaType?: string },
): Promise<LocalGameCardContentFile> {
  const id = gameCardId.trim()
  if (!id) {
    throw new Error("Game card id is required.")
  }

  const normalizedPath = normalizeWorkspaceFilePath(input.path)
  const recordId = gameCardContentFileId(id, normalizedPath)
  const now = Date.now()
  const existing = await localDb.gameCardContentFiles.get(recordId)
  const record: LocalGameCardContentFileRecord = {
    id: recordId,
    gameCardId: id,
    path: normalizedPath,
    content: typeof input.content === "string" ? input.content : "",
    ...(input.mediaType && input.mediaType.trim() ? { mediaType: input.mediaType.trim() } : {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await localDb.transaction(
    "rw",
    [localDb.gameCardContentFiles, localDb.gameCards],
    async () => {
      await localDb.gameCardContentFiles.put(record)
      // Bump the card row so its updatedAt reflects "most recent any change"
      // (single-file writes no longer go through putLocalGameCard, which used to
      // set updatedAt). Lightweight extra write; preserves the existing contract.
      await localDb.gameCards.update(id, { updatedAt: now })
    },
  )
  return cloneGameCardContentFileRecord(record)
}

export async function deleteLocalGameCardContentFile(
  gameCardId: string,
  path: string,
): Promise<void> {
  const id = gameCardId.trim()
  if (!id) {
    return
  }

  const normalizedPath = normalizeWorkspaceFilePath(path)
  const now = Date.now()
  await localDb.transaction(
    "rw",
    [localDb.gameCardContentFiles, localDb.gameCards],
    async () => {
      await localDb.gameCardContentFiles.delete(gameCardContentFileId(id, normalizedPath))
      await localDb.gameCards.update(id, { updatedAt: now })
    },
  )
}

export async function deleteLocalGameCardContentPathForCard(
  gameCardId: string,
  pathPrefix: string,
): Promise<string[]> {
  const id = gameCardId.trim()
  if (!id) {
    return []
  }

  const normalizedPrefix = normalizeWorkspaceFilePath(pathPrefix)
  const now = Date.now()
  const records = await localDb.gameCardContentFiles
    .where("gameCardId")
    .equals(id)
    .toArray()
  const deleted: string[] = []
  await localDb.transaction(
    "rw",
    [localDb.gameCardContentFiles, localDb.gameCards],
    async () => {
      for (const record of records) {
        if (record.path === normalizedPrefix || record.path.startsWith(`${normalizedPrefix}/`)) {
          await localDb.gameCardContentFiles.delete(record.id)
          deleted.push(record.path)
        }
      }
      if (deleted.length > 0) {
        await localDb.gameCards.update(id, { updatedAt: now })
      }
    },
  )
  return deleted.sort((left, right) => left.localeCompare(right))
}

function cloneGameCardContentFileRecord(
  record: LocalGameCardContentFileRecord,
): LocalGameCardContentFile {
  return {
    path: record.path,
    content: record.content,
    ...(record.mediaType ? { mediaType: record.mediaType } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export async function listLocalGameCardFrontendFiles(
  gameCardId: string,
): Promise<LocalGameCardFrontendFile[]> {
  const id = gameCardId.trim()
  if (!id) {
    return []
  }

  const records = await localDb.gameCardFrontendFiles
    .where("gameCardId")
    .equals(id)
    .sortBy("path")
  return records.map(cloneGameCardFrontendFileRecord)
}

export async function readLocalGameCardFrontendFile(
  gameCardId: string,
  path: string,
): Promise<LocalGameCardFrontendFile | null> {
  const id = gameCardId.trim()
  if (!id) {
    return null
  }

  const normalizedPath = normalizePackageFilePath(path, "frontend file path")
  const record = await localDb.gameCardFrontendFiles.get(
    gameCardFrontendFileId(id, normalizedPath),
  )
  return record ? cloneGameCardFrontendFileRecord(record) : null
}

export async function ensureBuiltinBlankGameCard(): Promise<LocalGameCardView> {
  const existing = await localDb.gameCards.get(BUILTIN_BLANK_GAME_CARD_ID)
  if (existing && await isCurrentBuiltinBlankGameCard(existing)) {
    return toLocalGameCardView(existing)
  }

  // Stale or missing: re-seed the card row and its template content rows.
  const now = Date.now()
  const record = createBuiltinBlankGameCardRecord(
    existing?.createdAt ?? now,
    now,
    existing?.manifest.frontend,
  )
  await putLocalGameCard({
    manifest: record.manifest,
    contentFiles: createDefaultWorkspaceTemplateFiles(),
    source: "builtin",
  })
  return toLocalGameCardView(record)
}

export async function getBuiltinBlankGameCard(): Promise<LocalGameCardView> {
  return ensureBuiltinBlankGameCard()
}
