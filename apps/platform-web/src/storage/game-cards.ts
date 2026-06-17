import type {
  GameCardContentFile,
  GameCardManifest,
} from "@tsian/contracts"
import {
  localDb,
  type LocalGameCardFrontendFileRecord,
  type LocalGameCardRecord,
} from "./db"
import {
  createDefaultWorkspaceTemplateFiles,
  normalizeWorkspaceFilePath,
} from "./workspace"

export const BUILTIN_BLANK_GAME_CARD_ID = "tsian.builtin.blank"
const BUILTIN_BLANK_GAME_CARD_ASSISTANT_ID = "studio-assistant"
const BUILTIN_BLANK_GAME_CARD_COVER_URL = "/default-card-cover.webp"

type GameCardSource = LocalGameCardRecord["source"]

export interface PutLocalGameCardInput {
  manifest: GameCardManifest
  contentFiles: GameCardContentFile[]
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

function normalizeManifest(manifest: GameCardManifest): GameCardManifest {
  return {
    ...manifest,
    id: requireNonEmptyString(manifest.id, "id"),
    name: requireNonEmptyString(manifest.name, "name"),
    version: requireNonEmptyString(manifest.version, "version"),
    summary: requireNonEmptyString(manifest.summary, "summary"),
    frontend: normalizeFrontendBinding(manifest),
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
  if (path.endsWith(".woff")) return "font/woff"
  if (path.endsWith(".woff2")) return "font/woff2"
  if (path.endsWith(".wasm")) return "application/wasm"
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
    manifest: { ...record.manifest },
    contentFiles: record.contentFiles.map((file) => ({ ...file })),
  }
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

function isCurrentBuiltinBlankGameCard(record: LocalGameCardRecord): boolean {
  if (record.source !== "builtin") {
    return true
  }

  if (record.manifest.assistant?.agentId !== BUILTIN_BLANK_GAME_CARD_ASSISTANT_ID) {
    return false
  }

  if (
    record.manifest.cover?.url !== BUILTIN_BLANK_GAME_CARD_COVER_URL
    || record.manifest.cover?.alt !== "Blank Agent Runtime cover"
  ) {
    return false
  }

  return createDefaultWorkspaceTemplateFiles()
    .every((file) => hasTemplateFile(record.contentFiles, file))
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
    description: "The built-in blank workspace template used before a custom game frontend is configured.",
    cover: {
      url: BUILTIN_BLANK_GAME_CARD_COVER_URL,
      alt: "Blank Agent Runtime cover",
    },
    assistant: {
      agentId: BUILTIN_BLANK_GAME_CARD_ASSISTANT_ID,
      summary: "Use the default Studio Assistant Agent as the workspace assistant entrypoint.",
    },
    ...(frontend ? { frontend } : {}),
  }

  return {
    id: manifest.id,
    manifest,
    contentFiles: createDefaultWorkspaceTemplateFiles(),
    source: "builtin",
    createdAt,
    updatedAt,
  }
}

export async function listLocalGameCards(): Promise<LocalGameCardRecord[]> {
  const records = await localDb.gameCards.orderBy("updatedAt").reverse().toArray()
  return records.map(cloneLocalGameCardRecord)
}

export async function getLocalGameCard(cardId: string): Promise<LocalGameCardRecord | null> {
  const id = cardId.trim()
  if (!id) {
    return null
  }

  const record = await localDb.gameCards.get(id)
  return record ? cloneLocalGameCardRecord(record) : null
}

export async function putLocalGameCard(
  input: PutLocalGameCardInput,
): Promise<LocalGameCardRecord> {
  const manifest = normalizeManifest(input.manifest)
  const now = Date.now()
  const existing = await localDb.gameCards.get(manifest.id)
  const frontendFileRecords = input.frontendFiles?.map((file) =>
    normalizeFrontendFile(manifest.id, file, now)
  )
  const record: LocalGameCardRecord = {
    id: manifest.id,
    manifest,
    contentFiles: normalizeTemplateFiles(input.contentFiles),
    source: input.source ?? existing?.source ?? "local",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }

  await localDb.transaction(
    "rw",
    [localDb.gameCards, localDb.gameCardFrontendFiles],
    async () => {
      await localDb.gameCards.put(record)
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
  return cloneLocalGameCardRecord(record)
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

export async function ensureBuiltinBlankGameCard(): Promise<LocalGameCardRecord> {
  const existing = await localDb.gameCards.get(BUILTIN_BLANK_GAME_CARD_ID)
  if (existing && isCurrentBuiltinBlankGameCard(existing)) {
    return cloneLocalGameCardRecord(existing)
  }

  const now = Date.now()
  const record = createBuiltinBlankGameCardRecord(
    existing?.createdAt ?? now,
    now,
    existing?.manifest.frontend,
  )
  await localDb.gameCards.put(record)
  return cloneLocalGameCardRecord(record)
}

export async function getBuiltinBlankGameCard(): Promise<LocalGameCardRecord> {
  return ensureBuiltinBlankGameCard()
}
