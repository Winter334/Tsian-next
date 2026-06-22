import type {
  FrontendPackageManifest,
  GameCardContentFile,
  GameCardFrontendBinding,
  GameCardManifest,
  GameCardPackageFileEntry,
  GameCardPackageManifest,
} from "@tsian/contracts"
import { FRONTEND_PACKAGE_SCHEMA } from "@tsian/contracts"
import { strToU8, unzipSync, zipSync } from "fflate"
import { inferMediaTypeFromPath } from "@/lib/media-type"
import { BUILTIN_BLANK_GAME_CARD_ID, getLocalGameCard, listLocalGameCardContentFiles, listLocalGameCardFrontendFiles, putLocalGameCard, readLocalGameCardContentFile, writeLocalGameCardContentFile } from "./game-cards"
import type { LocalGameCardRecord } from "./db"

const GAME_CARD_PACKAGE_SCHEMA = "tsian.game-card.package.v1"
const GAME_CARD_MANIFEST_SCHEMA = "tsian.game-card.v1"
const PACKAGE_MANIFEST_PATH = "game-card.json"
const WORKSPACE_PREFIX = "workspace/"
const FRONTEND_PREFIX = "frontend/"
const COVER_PREFIX = "cover/"
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true })
const TEXT_ENCODER = new TextEncoder()

export class GameCardPackageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "GameCardPackageError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, code: string, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GameCardPackageError(code, message)
  }
  return value.trim()
}

function normalizePackagePath(value: string, code: string): string {
  const raw = value.trim().replace(/\\/g, "/")
  if (!raw) {
    throw new GameCardPackageError(code, "Package file path is required.")
  }
  if (raw.startsWith("/") || raw.includes("\0")) {
    throw new GameCardPackageError(code, `Unsafe package path: ${raw}`)
  }

  const parts: string[] = []
  for (const part of raw.split("/")) {
    if (!part || part === ".") {
      continue
    }
    if (part === "..") {
      throw new GameCardPackageError(code, `Package path cannot contain '..': ${raw}`)
    }
    parts.push(part)
  }

  if (parts.length === 0) {
    throw new GameCardPackageError(code, "Package file path is required.")
  }

  return parts.join("/")
}

function assertAllowedPackagePath(path: string): void {
  if (
    path === PACKAGE_MANIFEST_PATH
    || path.startsWith(WORKSPACE_PREFIX)
    || path.startsWith(FRONTEND_PREFIX)
    || path.startsWith(COVER_PREFIX)
  ) {
    return
  }

  throw new GameCardPackageError(
    "GAME_CARD_PACKAGE_PATH_UNSUPPORTED",
    `Unsupported package path: ${path}`,
  )
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/png") return "png"
  if (mediaType === "image/jpeg") return "jpg"
  if (mediaType === "image/webp") return "webp"
  if (mediaType === "image/gif") return "gif"
  if (mediaType === "image/svg+xml") return "svg"
  return "bin"
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] ?? "cover"
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.trim())
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

/** Parse a `data:<type>;base64,<...>` URL. Used by `fetchBundledCoverUrl` to
 *  handle builtin covers that ship as data URLs. Internal-only; binary covers
 *  in user-authored packages are read as raw zip bytes. */
function parseDataUrl(value: string): { mediaType: string; data: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(value.trim())
  if (!match) {
    return null
  }
  return {
    mediaType: match[1],
    data: base64ToBytes(match[2]),
  }
}

function decodeText(bytes: Uint8Array, path: string): string {
  try {
    return TEXT_DECODER.decode(bytes)
  } catch {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_TEXT_DECODE_FAILED",
      `Package file must be UTF-8 text: ${path}`,
    )
  }
}

function normalizePackageFileEntry(value: unknown, fieldName: string): GameCardPackageFileEntry {
  if (!isRecord(value)) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_FILE_ENTRY_INVALID",
      `${fieldName} entries must be objects.`,
    )
  }

  const path = normalizePackagePath(
    requireString(
      value.path,
      "GAME_CARD_PACKAGE_FILE_PATH_REQUIRED",
      `${fieldName} entry path is required.`,
    ),
    "GAME_CARD_PACKAGE_FILE_PATH_INVALID",
  )
  return {
    path,
    ...(typeof value.mediaType === "string" && value.mediaType.trim()
      ? { mediaType: value.mediaType.trim() }
      : {}),
    ...(typeof value.size === "number" && Number.isFinite(value.size)
      ? { size: value.size }
      : {}),
  }
}

function normalizePackageFileEntries(
  value: unknown,
  fieldName: string,
): GameCardPackageFileEntry[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_FILE_INDEX_INVALID",
      `${fieldName} must be an array when provided.`,
    )
  }

  return value.map((entry) => normalizePackageFileEntry(entry, fieldName))
}

function normalizeFrontendBinding(value: unknown): GameCardFrontendBinding | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new GameCardPackageError(
      "GAME_CARD_FRONTEND_INVALID",
      "Game card frontend binding must be an object when provided.",
    )
  }

  const kind = value.kind
  if (kind === "builtin") {
    throw new GameCardPackageError(
      "GAME_CARD_FRONTEND_KIND_UNSUPPORTED",
      "Builtin game frontends are no longer supported.",
    )
  }

  if (kind === "remote") {
    return {
      kind,
      url: requireString(
        value.url,
        "GAME_CARD_FRONTEND_REMOTE_URL_REQUIRED",
        "Remote frontend URL is required.",
      ),
      bridgeVersion: "tsian.play-bridge.v1",
    }
  }

  if (kind === "packaged") {
    return {
      kind,
      entry: normalizePackagePath(
        requireString(
          value.entry,
          "GAME_CARD_FRONTEND_PACKAGED_ENTRY_REQUIRED",
          "Packaged frontend entry is required.",
        ),
        "GAME_CARD_FRONTEND_PACKAGED_ENTRY_INVALID",
      ),
      bridgeVersion: "tsian.play-bridge.v1",
    }
  }

  throw new GameCardPackageError(
    "GAME_CARD_FRONTEND_KIND_UNSUPPORTED",
    `Unsupported game card frontend kind: ${String(kind)}`,
  )
}

function normalizeGameCardManifest(value: unknown): GameCardManifest {
  if (!isRecord(value)) {
    throw new GameCardPackageError(
      "GAME_CARD_MANIFEST_INVALID",
      "Package manifest must contain a game card manifest object.",
    )
  }
  if (value.schema !== GAME_CARD_MANIFEST_SCHEMA) {
    throw new GameCardPackageError(
      "GAME_CARD_MANIFEST_SCHEMA_UNSUPPORTED",
      "Unsupported game card manifest schema.",
    )
  }

  const summarySource = typeof value.summary === "string" && value.summary.trim()
    ? value.summary
    : value.description
  const manifest = value as unknown as GameCardManifest

  return {
    schema: GAME_CARD_MANIFEST_SCHEMA,
    id: requireString(value.id, "GAME_CARD_ID_REQUIRED", "Game card id is required."),
    name: requireString(value.name, "GAME_CARD_NAME_REQUIRED", "Game card name is required."),
    version: requireString(
      value.version,
      "GAME_CARD_VERSION_REQUIRED",
      "Game card version is required.",
    ),
    summary: requireString(
      summarySource,
      "GAME_CARD_SUMMARY_REQUIRED",
      "Game card summary is required.",
    ),
    ...(manifest.author ? { author: manifest.author } : {}),
    ...(manifest.cover ? { cover: manifest.cover } : {}),
    frontend: normalizeFrontendBinding(value.frontend),
  }
}

function normalizePackageManifest(value: unknown): GameCardPackageManifest {
  if (!isRecord(value)) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_MANIFEST_INVALID",
      "Package manifest must be an object.",
    )
  }
  if (value.schema !== GAME_CARD_PACKAGE_SCHEMA) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_SCHEMA_UNSUPPORTED",
      "Unsupported game card package schema.",
    )
  }

  return {
    schema: GAME_CARD_PACKAGE_SCHEMA,
    manifest: normalizeGameCardManifest(value.manifest),
    workspaceFiles: normalizePackageFileEntries(value.workspaceFiles, "workspaceFiles"),
    frontendFiles: normalizePackageFileEntries(value.frontendFiles, "frontendFiles"),
    coverFiles: normalizePackageFileEntries(value.coverFiles, "coverFiles"),
    ...(typeof value.exportedAt === "string" && value.exportedAt.trim()
      ? { exportedAt: value.exportedAt.trim() }
      : {}),
    ...(isRecord(value.exporter)
      ? {
          exporter: {
            name: requireString(
              value.exporter.name,
              "GAME_CARD_PACKAGE_EXPORTER_NAME_REQUIRED",
              "Package exporter name is required when exporter is provided.",
            ),
            ...(typeof value.exporter.version === "string" && value.exporter.version.trim()
              ? { version: value.exporter.version.trim() }
              : {}),
          },
        }
      : {}),
  }
}

async function toUint8Array(input: Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) {
    return input
  }
  if (input instanceof Blob) {
    return new Uint8Array(await input.arrayBuffer())
  }
  return new Uint8Array(input)
}

function zipEntries(input: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(input)
  } catch {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_ZIP_INVALID",
      "Game card package must be a valid zip file.",
    )
  }
}

function packageManifestFromEntries(entries: Record<string, Uint8Array>): GameCardPackageManifest {
  const manifestBytes = entries[PACKAGE_MANIFEST_PATH]
  if (!manifestBytes) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_MANIFEST_MISSING",
      "Game card package is missing game-card.json.",
    )
  }

  try {
    return normalizePackageManifest(JSON.parse(decodeText(manifestBytes, PACKAGE_MANIFEST_PATH)))
  } catch (error) {
    if (error instanceof GameCardPackageError) {
      throw error
    }
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_MANIFEST_PARSE_FAILED",
      "game-card.json is not valid JSON.",
    )
  }
}

function indexedMediaType(
  path: string,
  indexedFiles: GameCardPackageFileEntry[] | undefined,
): string {
  return indexedFiles?.find((file) => file.path === path)?.mediaType ?? inferMediaTypeFromPath(path)
}

function workspacePathFromPackagePath(path: string): string {
  const workspacePath = path.slice(WORKSPACE_PREFIX.length)
  if (!workspacePath) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_WORKSPACE_PATH_INVALID",
      "Workspace package path must include a file path.",
    )
  }
  return workspacePath
}

function coverContentPathFromPackagePath(path: string): string {
  return `.cover/${basename(path)}`
}

async function fetchBundledCoverUrl(rawUrl: string): Promise<{ mediaType: string; data: Uint8Array } | null> {
  const dataUrl = parseDataUrl(rawUrl)
  if (dataUrl) {
    return dataUrl
  }

  if (typeof window === "undefined") {
    return null
  }

  let url: URL
  try {
    url = new URL(rawUrl, window.location.href)
  } catch {
    return null
  }

  if (url.origin !== window.location.origin) {
    return null
  }

  const response = await fetch(url.href)
  if (!response.ok) {
    return null
  }

  const mediaType = response.headers.get("content-type")?.split(";")[0]?.trim()
    || inferMediaTypeFromPath(url.pathname)
  return {
    mediaType,
    data: new Uint8Array(await response.arrayBuffer()),
  }
}

async function resolveCoverExportFile(
  card: LocalGameCardRecord,
): Promise<{ path: string; mediaType: string; data: Uint8Array; contentPath?: string } | null> {
  const cover = card.manifest.cover
  if (!cover) {
    return null
  }

  if (cover.workspacePath?.trim()) {
    const contentPath = cover.workspacePath.trim()
    const file = await readLocalGameCardContentFile(card.id, contentPath)
    if (!file?.data) {
      return null
    }

    const mediaType = inferMediaTypeFromPath(contentPath)
    if (!mediaType.startsWith("image/")) {
      return null
    }

    return {
      path: `${COVER_PREFIX}${basename(contentPath)}`,
      mediaType,
      data: new Uint8Array(await file.data.arrayBuffer()),
      contentPath,
    }
  }

  if (cover.url?.trim()) {
    const fetched = await fetchBundledCoverUrl(cover.url)
    if (!fetched || !fetched.mediaType.startsWith("image/")) {
      return null
    }

    return {
      path: `${COVER_PREFIX}cover.${extensionForMediaType(fetched.mediaType)}`,
      mediaType: fetched.mediaType,
      data: fetched.data,
    }
  }

  return null
}

function validatePackagedFrontendEntry(
  manifest: GameCardPackageManifest,
  frontendFiles: Array<{ path: string }>,
): void {
  const frontend = manifest.manifest.frontend
  if (!frontend || frontend.kind !== "packaged") {
    return
  }
  if (!frontend.entry.startsWith(FRONTEND_PREFIX)) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_FRONTEND_ENTRY_INVALID",
      "Packaged frontend entry must live under frontend/.",
    )
  }
  if (!frontendFiles.some((file) => file.path === frontend.entry)) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_FRONTEND_ENTRY_MISSING",
      `Packaged frontend entry is missing: ${frontend.entry}`,
    )
  }
}

export async function importGameCardPackage(
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<LocalGameCardRecord> {
  const entries = zipEntries(await toUint8Array(input))
  const packageManifest = packageManifestFromEntries(entries)
  let manifest = packageManifest.manifest

  if (manifest.id === BUILTIN_BLANK_GAME_CARD_ID) {
    throw new GameCardPackageError(
      "GAME_CARD_PACKAGE_BUILTIN_IMPORT_FORBIDDEN",
      "Built-in game cards cannot be overwritten by package import.",
    )
  }

  const contentFiles: GameCardContentFile[] = []
  const frontendFiles: Array<{ path: string; data: Uint8Array; mediaType: string }> = []
  const coverFiles: Array<{ path: string; data: Uint8Array; mediaType: string }> = []

  for (const [rawPath, bytes] of Object.entries(entries)) {
    if (rawPath.endsWith("/")) {
      continue
    }

    const path = normalizePackagePath(rawPath, "GAME_CARD_PACKAGE_PATH_INVALID")
    assertAllowedPackagePath(path)

    if (path === PACKAGE_MANIFEST_PATH) {
      continue
    }

    if (path.startsWith(WORKSPACE_PREFIX)) {
      const workspacePath = workspacePathFromPackagePath(path)
      contentFiles.push({
        path: workspacePath,
        content: decodeText(bytes, path),
        mediaType: indexedMediaType(path, packageManifest.workspaceFiles),
      })
      continue
    }

    if (path.startsWith(FRONTEND_PREFIX)) {
      frontendFiles.push({
        path,
        data: bytes,
        mediaType: indexedMediaType(path, packageManifest.frontendFiles),
      })
      continue
    }

    if (path.startsWith(COVER_PREFIX)) {
      const mediaType = indexedMediaType(path, packageManifest.coverFiles)
      if (mediaType.startsWith("image/")) {
        coverFiles.push({
          path,
          data: bytes,
          mediaType,
        })
      }
    }
  }

  const primaryCoverFile = coverFiles[0]
  let coverContentPath: string | null = null
  if (primaryCoverFile) {
    coverContentPath = coverContentPathFromPackagePath(primaryCoverFile.path)
    manifest = {
      ...manifest,
      cover: {
        ...(manifest.cover?.alt ? { alt: manifest.cover.alt } : {}),
        workspacePath: coverContentPath,
      },
    }
  }

  validatePackagedFrontendEntry(packageManifest, frontendFiles)

  const savedCard = await putLocalGameCard({
    manifest,
    contentFiles,
    frontendFiles,
    source: "imported",
  })

  // Write the cover as a binary content file (Blob) after the card row + text
  // content files are in place. putLocalGameCard's contentFiles are text-only
  // (GameCardContentFile carries content: string); binary covers use the
  // data: Blob channel of writeLocalGameCardContentFile.
  if (primaryCoverFile && coverContentPath) {
    const coverBlob = new Blob([primaryCoverFile.data as BlobPart], { type: primaryCoverFile.mediaType })
    await writeLocalGameCardContentFile(savedCard.id, { path: coverContentPath, data: coverBlob })
  }

  return savedCard
}

export async function exportGameCardPackage(cardId: string): Promise<Blob> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new GameCardPackageError(
      "GAME_CARD_EXPORT_CARD_NOT_FOUND",
      `Game card not found: ${cardId}`,
    )
  }

  const frontendFiles = await listLocalGameCardFrontendFiles(card.id)
  const coverFile = await resolveCoverExportFile(card)
  const allContentFiles = await listLocalGameCardContentFiles(card.id)
  const contentFiles = coverFile?.contentPath
    ? allContentFiles.filter((file) => file.path !== coverFile.contentPath)
    : allContentFiles
  const packageManifest: GameCardPackageManifest = {
    schema: GAME_CARD_PACKAGE_SCHEMA,
    manifest: normalizeGameCardManifest(card.manifest),
    workspaceFiles: contentFiles.map((file) => ({
      path: `${WORKSPACE_PREFIX}${file.path}`,
      mediaType: inferMediaTypeFromPath(file.path),
      size: file.data?.size ?? file.content.length,
    })),
    frontendFiles: frontendFiles.map((file) => ({
      path: file.path,
      mediaType: inferMediaTypeFromPath(file.path),
      size: file.size,
    })),
    ...(coverFile
      ? {
          coverFiles: [{
            path: coverFile.path,
            mediaType: coverFile.mediaType,
            size: coverFile.data.byteLength,
          }],
        }
      : {}),
    exportedAt: new Date().toISOString(),
    exporter: {
      name: "platform-web",
      version: "0.0.0",
    },
  }

  const zipInput: Record<string, Uint8Array> = {
    [PACKAGE_MANIFEST_PATH]: strToU8(`${JSON.stringify(packageManifest, null, 2)}\n`),
  }

  for (const file of contentFiles) {
    if (file.data) {
      zipInput[`${WORKSPACE_PREFIX}${file.path}`] = new Uint8Array(await file.data.arrayBuffer())
    } else {
      zipInput[`${WORKSPACE_PREFIX}${file.path}`] = strToU8(file.content)
    }
  }

  for (const file of frontendFiles) {
    zipInput[file.path] = new Uint8Array(await file.data.arrayBuffer())
  }

  if (coverFile) {
    zipInput[coverFile.path] = coverFile.data
  }

  const zipped = zipSync(zipInput, { level: 6 })
  return new Blob([zipped], { type: "application/zip" })
}

// ── Frontend package (.tsian-frontend.zip) ──

const FRONTEND_PACKAGE_MANIFEST_PATH = "frontend.json"
const FRONTEND_BRIDGE_VERSION = "tsian.play-bridge.v1" as const

function assertSafeRelativePath(path: string, code: string): void {
  if (!path) {
    throw new GameCardPackageError(code, "Frontend package file path is required.")
  }
  if (path.startsWith("/") || path.includes("\0") || path.includes("..")) {
    throw new GameCardPackageError(code, `Unsafe frontend package path: ${path}`)
  }
}

function normalizeFrontendPackageFileEntry(
  value: unknown,
): { path: string; mediaType: string; size: number } {
  if (!isRecord(value)) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_FILE_ENTRY_INVALID",
      "Frontend package file entry must be an object.",
    )
  }
  const path = requireString(
    value.path,
    "FRONTEND_PACKAGE_FILE_PATH_REQUIRED",
    "Frontend package file entry path is required.",
  )
  const mediaType =
    typeof value.mediaType === "string" && value.mediaType.trim()
      ? value.mediaType.trim()
      : inferMediaTypeFromPath(path)
  const size =
    typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
      ? Math.floor(value.size)
      : 0
  return { path, mediaType, size }
}

function normalizeFrontendPackageManifest(value: unknown): FrontendPackageManifest {
  if (!isRecord(value)) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_MANIFEST_INVALID",
      "frontend.json must be an object.",
    )
  }
  const schema = requireString(
    value.schema,
    "FRONTEND_PACKAGE_SCHEMA_REQUIRED",
    "frontend.json schema is required.",
  )
  if (schema !== FRONTEND_PACKAGE_SCHEMA) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_SCHEMA_UNSUPPORTED",
      `Unsupported frontend package schema: ${schema}`,
    )
  }

  const entry = requireString(
    value.entry,
    "FRONTEND_PACKAGE_ENTRY_REQUIRED",
    "frontend.json entry is required.",
  )
  const bridgeVersion = requireString(
    value.bridgeVersion,
    "FRONTEND_PACKAGE_BRIDGE_VERSION_REQUIRED",
    "frontend.json bridgeVersion is required.",
  )
  if (bridgeVersion !== FRONTEND_BRIDGE_VERSION) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_BRIDGE_VERSION_UNSUPPORTED",
      `Unsupported frontend bridge version: ${bridgeVersion}`,
    )
  }

  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_FILES_EMPTY",
      "frontend.json must list at least one file.",
    )
  }
  const files = value.files.map((item) => normalizeFrontendPackageFileEntry(item))

  const manifest: FrontendPackageManifest = {
    schema: FRONTEND_PACKAGE_SCHEMA,
    entry,
    bridgeVersion: FRONTEND_BRIDGE_VERSION,
    files,
  }
  if (typeof value.exportedAt === "string" && value.exportedAt.trim()) {
    manifest.exportedAt = value.exportedAt.trim()
  }
  if (isRecord(value.exporter)) {
    manifest.exporter = {
      name: requireString(
        value.exporter.name,
        "FRONTEND_PACKAGE_EXPORTER_NAME_REQUIRED",
        "Frontend package exporter name is required when exporter is provided.",
      ),
      ...(typeof value.exporter.version === "string" && value.exporter.version.trim()
        ? { version: value.exporter.version.trim() }
        : {}),
    }
  }
  return manifest
}

function frontendPackageManifestFromEntries(
  entries: Record<string, Uint8Array>,
): FrontendPackageManifest {
  const manifestBytes = entries[FRONTEND_PACKAGE_MANIFEST_PATH]
  if (!manifestBytes) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_MANIFEST_MISSING",
      "Frontend package is missing frontend.json.",
    )
  }
  try {
    return normalizeFrontendPackageManifest(
      JSON.parse(decodeText(manifestBytes, FRONTEND_PACKAGE_MANIFEST_PATH)),
    )
  } catch (error) {
    if (error instanceof GameCardPackageError) {
      throw error
    }
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_MANIFEST_PARSE_FAILED",
      "frontend.json is not valid JSON.",
    )
  }
}

export async function importGameCardFrontendPackage(
  cardId: string,
  input: Blob | ArrayBuffer | Uint8Array,
): Promise<LocalGameCardRecord> {
  const trimmedCardId = cardId.trim()
  if (!trimmedCardId) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_CARD_ID_REQUIRED",
      "Game card id is required.",
    )
  }

  const entries = zipEntries(await toUint8Array(input))
  const manifest = frontendPackageManifestFromEntries(entries)

  // Collect file bytes keyed by normalized path.
  const fileBytes = new Map<string, Uint8Array>()
  for (const [rawPath, bytes] of Object.entries(entries)) {
    if (rawPath.endsWith("/")) {
      continue
    }
    if (rawPath === FRONTEND_PACKAGE_MANIFEST_PATH) {
      continue
    }
    const path = normalizePackagePath(rawPath, "FRONTEND_PACKAGE_PATH_INVALID")
    assertSafeRelativePath(path, "FRONTEND_PACKAGE_PATH_INVALID")
    fileBytes.set(path, bytes)
  }

  // Bidirectional consistency: manifest files vs archive entries.
  const manifestPaths = new Set(manifest.files.map((file) => file.path))
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path, "FRONTEND_PACKAGE_PATH_INVALID")
    if (!fileBytes.has(file.path)) {
      throw new GameCardPackageError(
        "FRONTEND_PACKAGE_FILE_MISMATCH",
        `Frontend package file is missing in archive: ${file.path}`,
      )
    }
  }
  for (const path of fileBytes.keys()) {
    if (!manifestPaths.has(path)) {
      throw new GameCardPackageError(
        "FRONTEND_PACKAGE_FILE_MISMATCH",
        `Frontend package archive entry is not listed in manifest: ${path}`,
      )
    }
  }

  // Entry must exist in manifest files.
  if (!manifestPaths.has(manifest.entry)) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_ENTRY_MISSING",
      `Frontend package entry is not in file list: ${manifest.entry}`,
    )
  }

  const card = await getLocalGameCard(trimmedCardId)
  if (!card) {
    throw new GameCardPackageError(
      "FRONTEND_PACKAGE_CARD_NOT_FOUND",
      `Game card not found: ${trimmedCardId}`,
    )
  }

  const frontendFiles = manifest.files.map((file) => ({
    path: `${FRONTEND_PREFIX}${file.path}`,
    data: fileBytes.get(file.path)!,
  }))

  const frontendBinding: GameCardFrontendBinding = {
    kind: "packaged",
    entry: `${FRONTEND_PREFIX}${manifest.entry}`,
    bridgeVersion: manifest.bridgeVersion,
  }

  return putLocalGameCard({
    manifest: {
      ...card.manifest,
      frontend: frontendBinding,
    },
    // contentFiles undefined = leave the content table untouched (frontend-package-only write).
    frontendFiles,
    source: card.source,
  })
}

export async function exportGameCardFrontendPackage(cardId: string): Promise<Blob> {
  const trimmedCardId = cardId.trim()
  if (!trimmedCardId) {
    throw new GameCardPackageError(
      "FRONTEND_EXPORT_CARD_ID_REQUIRED",
      "Game card id is required.",
    )
  }

  const card = await getLocalGameCard(trimmedCardId)
  if (!card) {
    throw new GameCardPackageError(
      "FRONTEND_EXPORT_CARD_NOT_FOUND",
      `Game card not found: ${trimmedCardId}`,
    )
  }

  const frontend = card.manifest.frontend
  if (!frontend || frontend.kind !== "packaged") {
    throw new GameCardPackageError(
      "FRONTEND_EXPORT_NOT_PACKAGED",
      "Game card does not have a packaged frontend to export.",
    )
  }

  const frontendFiles = await listLocalGameCardFrontendFiles(card.id)
  if (frontendFiles.length === 0) {
    throw new GameCardPackageError(
      "FRONTEND_EXPORT_NO_FILES",
      "Game card has no packaged frontend files to export.",
    )
  }

  // Strip the frontend/ prefix for the package-internal paths.
  const stripPrefix = (path: string): string =>
    path.startsWith(FRONTEND_PREFIX) ? path.slice(FRONTEND_PREFIX.length) : path

  const entryPath = stripPrefix(frontend.entry)
  const packageManifest: FrontendPackageManifest = {
    schema: FRONTEND_PACKAGE_SCHEMA,
    entry: entryPath,
    bridgeVersion: frontend.bridgeVersion,
    files: frontendFiles.map((file) => ({
      path: stripPrefix(file.path),
      mediaType: inferMediaTypeFromPath(file.path),
      size: file.size,
    })),
    exportedAt: new Date().toISOString(),
    exporter: {
      name: "platform-web",
      version: "0.0.0",
    },
  }

  const zipInput: Record<string, Uint8Array> = {
    [FRONTEND_PACKAGE_MANIFEST_PATH]: strToU8(`${JSON.stringify(packageManifest, null, 2)}\n`),
  }
  for (const file of frontendFiles) {
    zipInput[stripPrefix(file.path)] = new Uint8Array(await file.data.arrayBuffer())
  }

  const zipped = zipSync(zipInput, { level: 6 })
  return new Blob([zipped], { type: "application/zip" })
}
