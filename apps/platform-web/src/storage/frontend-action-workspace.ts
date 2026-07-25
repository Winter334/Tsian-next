import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceGlobResult,
  WorkspaceScope,
} from "@tsian/contracts"
import Dexie from "dexie"
import { binaryPlaceholderText, isImageMediaType, resolveBlobMediaType } from "@/lib/media-type"
import { blobToWorkspaceFile } from "@/lib/workspace-blob"
import {
  localDb,
  type LocalGameCardContentFileRecord,
  type LocalGameCardFrontendFileRecord,
  type LocalGameCardRecord,
  type LocalWorkspaceFileRecord,
} from "./db"
import { normalizeGameCardManifest } from "./game-card-packages"
import {
  assertOrdinarySaveRuntimeMutationPath,
  fileName,
  normalizeDirectoryPath,
  normalizeWorkspaceFilePath,
  normalizeWorkspaceTargetPath,
} from "./workspace-paths"
import { WorkspaceStorageError, type RuntimeWorkspaceChanges } from "./workspace-types"
import { initializeWorkspaceForSave } from "./workspace"

const ACTIVE_SAVE_KEY = "active-save-id"
const DEFAULT_GLOB_LIMIT = 50
const MAX_GLOB_LIMIT = 200

export type FrontendActionWorkspaceSource =
  | "card-content"
  | "card-frontend"
  | "game-card-manifest"
  | "save-workspace"

export interface FrontendActionWorkspaceProvenance {
  source: FrontendActionWorkspaceSource
  rowId: string | null
  gameCardId?: string
  saveId?: string
}

export interface FrontendActionWorkspaceFile extends WorkspaceFile {
  readonly provenance: Readonly<FrontendActionWorkspaceProvenance>
  /** Stable exact row/file identity captured inside the invocation-start transaction. */
  readonly snapshotSignature: string
}

export interface FrontendActionWorkspaceSnapshot {
  readonly saveId: string
  readonly gameCardId: string
  readonly mountedGameCardId: string
  /** Exact bound-card content rows. Frontend Action resources must resolve here. */
  readonly cardContentFiles: readonly FrontendActionWorkspaceFile[]
  readonly cardFrontendFiles: readonly FrontendActionWorkspaceFile[]
  readonly saveWorkspaceFiles: readonly FrontendActionWorkspaceFile[]
  readonly effectiveFiles: readonly FrontendActionWorkspaceFile[]
}

export type FrontendActionWorkspaceDependency =
  | {
      readonly kind: "file"
      readonly scope: WorkspaceScope
      readonly path: string
      readonly observed: "missing" | "present"
      readonly signature?: string
    }
  | {
      readonly kind: "list"
      readonly scope: WorkspaceScope
      readonly path: string
      readonly recursive: boolean
      readonly entriesSignature: string
    }
  | {
      readonly kind: "glob"
      readonly scope: WorkspaceScope
      readonly pattern: string
      readonly limit: number
      readonly truncated: boolean
      readonly matchesSignature: string
    }
  | {
      readonly kind: "write-baseline"
      readonly scope: "save-runtime"
      readonly path: string
      readonly observed: "missing" | "present"
      readonly signature?: string
    }
  | {
      readonly kind: "delete-range"
      readonly scope: "save-runtime"
      readonly prefix: string
      readonly descendantsSignature: string
    }

export interface FrontendActionWorkspaceResourceDependency {
  readonly provenance: "card-content"
  readonly gameCardId: string
  readonly path: string
  readonly rowId: string | null
  readonly snapshotSignature: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly byteLength: number
  /** Exact text captured from the invocation-start content row. */
  readonly content: string
}

export interface FrontendActionWorkspaceReadSet {
  readonly dependencies: readonly FrontendActionWorkspaceDependency[]
  readonly deletePrefixes: readonly string[]
}

export interface FrontendActionWorkspaceDependencyTracker {
  readonly dependencies: readonly FrontendActionWorkspaceDependency[]
  readonly deletePrefixes: readonly string[]
  recordFile(scope: WorkspaceScope, path: unknown): FrontendActionWorkspaceDependency
  recordList(
    scope: WorkspaceScope,
    path?: unknown,
    options?: { recursive?: boolean },
  ): FrontendActionWorkspaceDependency
  recordGlob(
    scope: WorkspaceScope,
    pattern: unknown,
    limit?: unknown,
  ): FrontendActionWorkspaceDependency
  recordWriteBaseline(path: unknown): FrontendActionWorkspaceDependency
  recordDeleteRange(prefix: unknown): FrontendActionWorkspaceDependency
  readSet(): FrontendActionWorkspaceReadSet
}

export interface CommitFrontendActionWorkspaceInput {
  snapshot: FrontendActionWorkspaceSnapshot
  mountedGameCardId: string
  resources: readonly FrontendActionWorkspaceResourceDependency[]
  dependencies: readonly FrontendActionWorkspaceDependency[]
  changes: RuntimeWorkspaceChanges
  /** Required for initially-empty delete ranges, which RuntimeWorkspaceChanges cannot represent. */
  deletePrefixes?: readonly string[]
  /**
   * Synchronous mount-lifecycle guard. The commit invokes it exactly twice:
   * at transaction entry and at the final pre-write/no-op boundary.
   */
  assertCommitAllowed?: () => void
}

export interface FrontendActionWorkspaceCommitResult {
  readonly saveId: string
  readonly gameCardId: string
  readonly writtenPaths: readonly string[]
  readonly deletedPaths: readonly string[]
  readonly changed: boolean
}

/** Freshly verifies the exact active save and its save-to-card binding. */
export async function isFrontendActionMountBindingCurrent(
  saveId: string,
  gameCardId: string,
): Promise<boolean> {
  if (typeof saveId !== "string"
    || saveId.length === 0
    || saveId.trim() !== saveId
    || typeof gameCardId !== "string"
    || gameCardId.length === 0
    || gameCardId.trim() !== gameCardId) {
    return false
  }

  return localDb.transaction("r", [localDb.meta, localDb.saves], async () => {
    const activeSave = await localDb.meta.get(ACTIVE_SAVE_KEY)
    if (activeSave?.value !== saveId) return false
    const save = await localDb.saves.get(saveId)
    return save?.gameCardId === gameCardId
  })
}

interface MaterializedWorkspace {
  cardContentFiles: FrontendActionWorkspaceFile[]
  cardFrontendFiles: FrontendActionWorkspaceFile[]
  saveWorkspaceFiles: FrontendActionWorkspaceFile[]
  effectiveFiles: FrontendActionWorkspaceFile[]
}

interface RequiredFrontendActionResource extends FrontendActionWorkspaceResourceDependency {}

interface RequiredFrontendActionResourceSet {
  exact: RequiredFrontendActionResource[]
}

interface SnapshotRows {
  activeSaveId: string
  saveId: string
  gameCardId: string
  mountedGameCardId: string
  card: LocalGameCardRecord
  cardSignature: string
  contentRows: LocalGameCardContentFileRecord[]
  contentSignatures: Map<string, string>
  frontendRows: LocalGameCardFrontendFileRecord[]
  frontendSignatures: Map<string, string>
  workspaceRows: LocalWorkspaceFileRecord[]
  workspaceSignatures: Map<string, string>
}

function storageError(code: string, message: string): WorkspaceStorageError {
  return new WorkspaceStorageError(code, message)
}

function conflict(message: string): never {
  throw storageError("FRONTEND_ACTION_WORKSPACE_CONFLICT", message)
}

function requireMountedGameCardId(value: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw storageError(
      "FRONTEND_ACTION_GAME_CARD_REQUIRED",
      "Frontend Action workspace loading requires an exact mounted game card id.",
    )
  }
  return value
}

function cloneManifest(card: LocalGameCardRecord): LocalGameCardRecord {
  return {
    ...card,
    manifest: structuredClone(card.manifest),
    ...(card.marketOrigin ? { marketOrigin: { ...card.marketOrigin } } : {}),
  }
}

function cloneContentRow(row: LocalGameCardContentFileRecord): LocalGameCardContentFileRecord {
  return {
    ...row,
    ...(row.data ? { data: cloneBlob(row.data) } : {}),
  }
}

function cloneFrontendRow(row: LocalGameCardFrontendFileRecord): LocalGameCardFrontendFileRecord {
  return {
    ...row,
    data: cloneBlob(row.data),
  }
}

function cloneWorkspaceRow(row: LocalWorkspaceFileRecord): LocalWorkspaceFileRecord {
  return {
    ...row,
    ...(row.data ? { data: cloneBlob(row.data) } : {}),
  }
}

function cloneBlob(blob: Blob): Blob {
  return blob.slice(0, blob.size, blob.type)
}

function cloneWorkspaceFile(file: WorkspaceFile): WorkspaceFile {
  return {
    path: file.path,
    content: file.content,
    ...(file.binary ? { binary: cloneBlob(file.binary) } : {}),
    ...(file.imageMimeType ? { imageMimeType: file.imageMimeType } : {}),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

function freezeWorkspaceFile(
  file: WorkspaceFile,
  provenance: FrontendActionWorkspaceProvenance,
  snapshotSignature: string,
): FrontendActionWorkspaceFile {
  const cloned = cloneWorkspaceFile(file)
  return Object.freeze({
    ...cloned,
    provenance: Object.freeze({ ...provenance }),
    snapshotSignature,
  })
}

function freezeArray<T>(values: T[]): readonly T[] {
  return Object.freeze(values.slice())
}

function contentRowWorkspaceFile(row: LocalGameCardContentFileRecord): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(row.path)
  if (!row.data) {
    return {
      path,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
  const mediaType = resolveBlobMediaType(path, row.data)
  return {
    path,
    content: binaryPlaceholderText(row.data, path, mediaType),
    binary: row.data,
    ...(isImageMediaType(mediaType) ? { imageMimeType: mediaType } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function workspaceRowFile(row: LocalWorkspaceFileRecord): WorkspaceFile {
  const path = normalizeWorkspaceFilePath(row.path)
  if (!row.data) {
    return {
      path,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
  const mediaType = resolveBlobMediaType(path, row.data)
  return {
    path,
    content: binaryPlaceholderText(row.data, path, mediaType),
    binary: row.data,
    ...(isImageMediaType(mediaType) ? { imageMimeType: mediaType } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function materializeWorkspace(rows: SnapshotRows): Promise<MaterializedWorkspace> {
  const cardContentFiles = rows.contentRows
    .map((row) => freezeWorkspaceFile(contentRowWorkspaceFile(row), {
      source: "card-content",
      rowId: row.id,
      gameCardId: rows.gameCardId,
    }, rows.contentSignatures.get(row.id) ?? ""))
    .sort(compareFilePath)

  const cardFrontendFiles: FrontendActionWorkspaceFile[] = []
  for (const row of rows.frontendRows) {
    const projected = await Dexie.waitFor(blobToWorkspaceFile({
      path: normalizeWorkspaceFilePath(row.path),
      blob: row.data,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    cardFrontendFiles.push(freezeWorkspaceFile(projected, {
      source: "card-frontend",
      rowId: row.id,
      gameCardId: rows.gameCardId,
    }, rows.frontendSignatures.get(row.id) ?? ""))
  }
  cardFrontendFiles.sort(compareFilePath)

  const saveWorkspaceFiles = rows.workspaceRows
    .map((row) => freezeWorkspaceFile(workspaceRowFile(row), {
      source: "save-workspace",
      rowId: row.id,
      saveId: rows.saveId,
    }, rows.workspaceSignatures.get(row.id) ?? ""))
    .sort(compareFilePath)

  const effectiveByPath = new Map<string, FrontendActionWorkspaceFile>()
  for (const file of cardContentFiles) effectiveByPath.set(file.path, file)
  for (const file of cardFrontendFiles) effectiveByPath.set(file.path, file)
  effectiveByPath.set("game-card.json", freezeWorkspaceFile({
    path: "game-card.json",
    content: JSON.stringify(normalizeGameCardManifest(rows.card.manifest), null, 2),
    createdAt: rows.card.createdAt,
    updatedAt: rows.card.updatedAt,
  }, {
    source: "game-card-manifest",
    rowId: rows.card.id,
    gameCardId: rows.gameCardId,
  }, rows.cardSignature))
  for (const file of saveWorkspaceFiles) effectiveByPath.set(file.path, file)

  return {
    cardContentFiles,
    cardFrontendFiles,
    saveWorkspaceFiles,
    effectiveFiles: Array.from(effectiveByPath.values()).sort(compareFilePath),
  }
}

function compareFilePath(left: Pick<WorkspaceFile, "path">, right: Pick<WorkspaceFile, "path">): number {
  return left.path.localeCompare(right.path)
}

async function readBoundRows(mountedGameCardId: string): Promise<SnapshotRows> {
  const activeSaveRecord = await localDb.meta.get(ACTIVE_SAVE_KEY)
  const activeSaveId = activeSaveRecord?.value
  if (!activeSaveId) {
    throw storageError("ACTIVE_SAVE_REQUIRED", "Frontend Action requires an active save.")
  }

  const save = await localDb.saves.get(activeSaveId)
  if (!save) {
    throw storageError("ACTIVE_SAVE_NOT_FOUND", "The active save does not exist.")
  }
  if (!save.gameCardId) {
    throw storageError("ACTIVE_SAVE_GAME_CARD_REQUIRED", "The active save is not bound to a game card.")
  }
  if (save.gameCardId !== mountedGameCardId) {
    throw storageError(
      "FRONTEND_ACTION_GAME_CARD_MISMATCH",
      "The mounted game card does not match the active save binding.",
    )
  }

  const card = await localDb.gameCards.get(save.gameCardId)
  if (!card) {
    throw storageError("FRONTEND_ACTION_GAME_CARD_NOT_FOUND", "The active save game card does not exist.")
  }

  const [contentRows, frontendRows, workspaceRows] = await Promise.all([
    localDb.gameCardContentFiles.where("gameCardId").equals(card.id).toArray(),
    localDb.gameCardFrontendFiles.where("gameCardId").equals(card.id).toArray(),
    localDb.workspaceFiles.where("saveId").equals(save.id).toArray(),
  ])

  return {
    activeSaveId,
    saveId: save.id,
    gameCardId: card.id,
    mountedGameCardId,
    card: cloneManifest(card),
    cardSignature: encodeSignature([
      card.id,
      card.createdAt,
      card.updatedAt,
      JSON.stringify(card.manifest),
    ]),
    contentRows: contentRows.map(cloneContentRow).sort(compareRowPath),
    contentSignatures: await signatureMap(contentRows, contentRecordSignature),
    frontendRows: frontendRows.map(cloneFrontendRow).sort(compareRowPath),
    frontendSignatures: await signatureMap(frontendRows, frontendRecordSignature),
    workspaceRows: workspaceRows.map(cloneWorkspaceRow).sort(compareRowPath),
    workspaceSignatures: await signatureMap(workspaceRows, workspaceRecordSignature),
  }
}

function compareRowPath(left: { path: string }, right: { path: string }): number {
  return left.path.localeCompare(right.path)
}

async function blobSignature(blob: Blob): Promise<string> {
  const buffer = await Dexie.waitFor(blob.arrayBuffer())
  return bytesToHex(new Uint8Array(buffer))
}

function bytesToHex(bytes: Uint8Array): string {
  let result = ""
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0")
  return result
}

async function contentRecordSignature(row: LocalGameCardContentFileRecord): Promise<string> {
  return encodeSignature([
    row.id,
    row.gameCardId,
    row.path,
    row.createdAt,
    row.updatedAt,
    row.data ? "binary" : "text",
    row.data?.type ?? "",
    row.data?.size ?? 0,
    row.data ? await blobSignature(row.data) : row.content,
  ])
}

async function frontendRecordSignature(row: LocalGameCardFrontendFileRecord): Promise<string> {
  return encodeSignature([
    row.id,
    row.gameCardId,
    row.path,
    row.createdAt,
    row.updatedAt,
    row.data.type,
    row.data.size,
    await blobSignature(row.data),
  ])
}

async function workspaceRecordSignature(row: LocalWorkspaceFileRecord): Promise<string> {
  return encodeSignature([
    row.id,
    row.saveId,
    row.path,
    row.createdAt,
    row.updatedAt,
    row.data ? "binary" : "text",
    row.data?.type ?? "",
    row.data?.size ?? 0,
    row.data ? await blobSignature(row.data) : row.content,
  ])
}

async function signatureMap<T extends { id: string }>(
  rows: readonly T[],
  signature: (row: T) => Promise<string>,
): Promise<Map<string, string>> {
  const values = await Dexie.waitFor(Promise.all(rows.map(async (row) => [row.id, await signature(row)] as const)))
  return new Map(values)
}

/**
 * Initializes/upgrades the active save, then loads one atomic readonly snapshot
 * bound to the exact mounted card id.
 */
export async function loadFrontendActionWorkspaceSnapshot(
  mountedGameCardIdInput: string,
): Promise<FrontendActionWorkspaceSnapshot> {
  const mountedGameCardId = requireMountedGameCardId(mountedGameCardIdInput)

  while (true) {
    const activeSaveRecord = await localDb.meta.get(ACTIVE_SAVE_KEY)
    const initializedSaveId = activeSaveRecord?.value
    if (!initializedSaveId) {
      throw storageError("ACTIVE_SAVE_REQUIRED", "Frontend Action requires an active save.")
    }

    await initializeWorkspaceForSave(initializedSaveId)

    const snapshot = await localDb.transaction(
      "r",
      [
        localDb.meta,
        localDb.saves,
        localDb.gameCards,
        localDb.gameCardContentFiles,
        localDb.gameCardFrontendFiles,
        localDb.workspaceFiles,
      ],
      async () => {
        const acceptedActiveSaveId = (await localDb.meta.get(ACTIVE_SAVE_KEY))?.value
        if (!acceptedActiveSaveId) {
          throw storageError("ACTIVE_SAVE_REQUIRED", "Frontend Action requires an active save.")
        }
        if (acceptedActiveSaveId !== initializedSaveId) return null

        const rows = await readBoundRows(mountedGameCardId)
        const materialized = await materializeWorkspace(rows)
        return Object.freeze({
          saveId: rows.saveId,
          gameCardId: rows.gameCardId,
          mountedGameCardId: rows.mountedGameCardId,
          cardContentFiles: freezeArray(materialized.cardContentFiles),
          cardFrontendFiles: freezeArray(materialized.cardFrontendFiles),
          saveWorkspaceFiles: freezeArray(materialized.saveWorkspaceFiles),
          effectiveFiles: freezeArray(materialized.effectiveFiles),
        })
      },
    )
    if (snapshot) return snapshot
  }
}

function normalizeScope(scope: WorkspaceScope): WorkspaceScope {
  if (
    scope === "effective"
    || scope === "card-content"
    || scope === "save-runtime"
    || scope === "platform-meta"
    || scope === "card-frontend"
    || scope === "temp"
  ) {
    return scope
  }
  throw storageError("WORKSPACE_SCOPE_REQUIRED", "Workspace dependency requires an explicit scope.")
}

function scopeForPath(path: string): Exclude<WorkspaceScope, "effective"> {
  if (path === ".tsian" || path.startsWith(".tsian/")) return "platform-meta"
  if (path === "save" || path.startsWith("save/")) return "save-runtime"
  if (path === "frontend" || path.startsWith("frontend/")) return "card-frontend"
  if (path === "temp" || path.startsWith("temp/")) return "temp"
  return "card-content"
}

function filesForScope(
  snapshot: FrontendActionWorkspaceSnapshot,
  scope: WorkspaceScope,
): readonly FrontendActionWorkspaceFile[] {
  if (scope === "effective") return snapshot.effectiveFiles
  if (scope === "card-content") return snapshot.cardContentFiles
  if (scope === "card-frontend") return snapshot.cardFrontendFiles
  if (scope === "save-runtime") {
    return snapshot.saveWorkspaceFiles.filter((file) => scopeForPath(file.path) === "save-runtime")
  }
  if (scope === "platform-meta") {
    return snapshot.saveWorkspaceFiles.filter((file) => scopeForPath(file.path) === "platform-meta")
  }
  return snapshot.saveWorkspaceFiles.filter((file) => scopeForPath(file.path) === "temp")
}

function isFrontendActionPath(path: string): boolean {
  return path === "frontend-actions" || path.startsWith("frontend-actions/")
}

function isFrontendActionBusinessFileVisible(file: Pick<WorkspaceFile, "path">): boolean {
  return scopeForPath(file.path) !== "platform-meta" && !isFrontendActionPath(file.path)
}

function filesForFrontendActionOperation(
  snapshot: FrontendActionWorkspaceSnapshot,
  scope: WorkspaceScope,
): readonly FrontendActionWorkspaceFile[] {
  return filesForScope(snapshot, scope).filter(isFrontendActionBusinessFileVisible)
}

function encodeSignature(values: readonly unknown[]): string {
  return JSON.stringify(values)
}

function workspaceFileSignature(file: FrontendActionWorkspaceFile): string {
  return file.snapshotSignature
}

function fileAtPath(
  snapshot: FrontendActionWorkspaceSnapshot,
  scope: WorkspaceScope,
  path: string,
): FrontendActionWorkspaceFile | undefined {
  return scope === "effective"
    ? snapshot.effectiveFiles.find((candidate) => candidate.path === path)
    : filesForScope(snapshot, scope).find((candidate) => candidate.path === path)
}

function fileDependency(
  snapshot: FrontendActionWorkspaceSnapshot,
  scope: WorkspaceScope,
  path: string,
): FrontendActionWorkspaceDependency {
  const file = fileAtPath(snapshot, scope, path)
  return Object.freeze(file
    ? { kind: "file", scope, path, observed: "present", signature: workspaceFileSignature(file) }
    : { kind: "file", scope, path, observed: "missing" })
}

function recursiveListEntries(files: readonly FrontendActionWorkspaceFile[], path: string): WorkspaceEntry[] {
  const prefix = path ? `${path}/` : ""
  return files
    .filter((file) => !path || file.path.startsWith(prefix))
    .map((file) => ({
      path: file.path,
      name: fileName(file.path),
      kind: "file" as const,
      size: file.binary?.size ?? file.content.length,
      updatedAt: file.updatedAt,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

function directListEntries(files: readonly FrontendActionWorkspaceFile[], path: string): WorkspaceEntry[] {
  const prefix = path ? `${path}/` : ""
  const fileEntries = new Map<string, WorkspaceEntry>()
  const directoryEntries = new Map<string, WorkspaceEntry & { children: Set<string> }>()

  for (const file of files.slice().sort(compareFilePath)) {
    if (path && file.path !== path && !file.path.startsWith(prefix)) continue
    const remainder = path ? file.path.slice(prefix.length) : file.path
    if (!remainder) continue
    const slashIndex = remainder.indexOf("/")
    if (slashIndex === -1) {
      fileEntries.set(file.path, {
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
    const existing = directoryEntries.get(childPath)
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt ?? 0, file.updatedAt)
      if (nextSegment) existing.children.add(nextSegment)
      continue
    }
    const children = new Set<string>()
    if (nextSegment) children.add(nextSegment)
    directoryEntries.set(childPath, {
      path: childPath,
      name: childName,
      kind: "directory",
      updatedAt: file.updatedAt,
      childCount: 0,
      children,
    })
  }

  return [
    ...Array.from(directoryEntries.values())
      .map(({ children, ...entry }) => ({ ...entry, childCount: children.size }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    ...Array.from(fileEntries.values()).sort((left, right) => left.name.localeCompare(right.name)),
  ]
}

function listEntriesSignature(
  snapshot: FrontendActionWorkspaceSnapshot,
  scope: WorkspaceScope,
  path: string,
  recursive: boolean,
): string {
  const files = filesForFrontendActionOperation(snapshot, scope)
  const entries = recursive ? recursiveListEntries(files, path) : directListEntries(files, path)
  return encodeSignature(entries.map((entry) => [
    entry.path,
    entry.name,
    entry.kind,
    entry.updatedAt ?? null,
    entry.size ?? null,
    entry.childCount ?? null,
  ]))
}

function normalizeGlobPattern(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw storageError("WORKSPACE_PATTERN_REQUIRED", "Workspace glob pattern must be a non-empty string.")
  }
  return value.trim().replace(/\\/g, "/").replace(/^\/+/, "")
}

function normalizeGlobLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_GLOB_LIMIT
  return Math.min(Math.floor(value), MAX_GLOB_LIMIT)
}

function globToRegExp(pattern: string): RegExp {
  let source = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        if (pattern[index + 2] === "/") {
          source += "(?:.*/)?"
          index += 2
        } else {
          source += ".*"
          index += 1
        }
      } else {
        source += "[^/]*"
      }
    } else if (char === "?") {
      source += "[^/]"
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${source}$`)
}

function globResult(
  snapshot: FrontendActionWorkspaceSnapshot,
  scope: WorkspaceScope,
  pattern: string,
  limit: number,
): WorkspaceGlobResult {
  const matcher = globToRegExp(pattern)
  const allMatches = filesForFrontendActionOperation(snapshot, scope)
    .slice()
    .sort(compareFilePath)
    .filter((file) => matcher.test(file.path))
    .map((file) => file.path)
  return {
    scope,
    pattern,
    matches: allMatches.slice(0, limit),
    truncated: allMatches.length > limit,
  }
}

function descendantsSignature(
  snapshot: FrontendActionWorkspaceSnapshot,
  prefix: string,
): string {
  const descendantPrefix = `${prefix}/`
  return encodeSignature(filesForScope(snapshot, "save-runtime")
    .filter((file) => file.path === prefix || file.path.startsWith(descendantPrefix))
    .map((file) => [file.path, workspaceFileSignature(file)]))
}

/** Creates normalized invocation-start dependencies without reading live storage. */
export function createFrontendActionWorkspaceDependencyTracker(
  snapshot: FrontendActionWorkspaceSnapshot,
): FrontendActionWorkspaceDependencyTracker {
  const dependencies: FrontendActionWorkspaceDependency[] = []
  const deletePrefixes = new Set<string>()

  function push(dependency: FrontendActionWorkspaceDependency): FrontendActionWorkspaceDependency {
    dependencies.push(dependency)
    return dependency
  }

  return {
    get dependencies() {
      return freezeArray(dependencies)
    },
    get deletePrefixes() {
      return freezeArray(Array.from(deletePrefixes).sort())
    },
    recordFile(scopeInput, pathInput) {
      const scope = normalizeScope(scopeInput)
      const path = normalizeWorkspaceFilePath(pathInput)
      return push(fileDependency(snapshot, scope, path))
    },
    recordList(scopeInput, pathInput, options) {
      const scope = normalizeScope(scopeInput)
      const path = normalizeDirectoryPath(pathInput)
      const recursive = options?.recursive === true
      return push(Object.freeze({
        kind: "list",
        scope,
        path,
        recursive,
        entriesSignature: listEntriesSignature(snapshot, scope, path, recursive),
      }))
    },
    recordGlob(scopeInput, patternInput, limitInput) {
      const scope = normalizeScope(scopeInput)
      const pattern = normalizeGlobPattern(patternInput)
      const limit = normalizeGlobLimit(limitInput)
      const result = globResult(snapshot, scope, pattern, limit)
      return push(Object.freeze({
        kind: "glob",
        scope,
        pattern,
        limit,
        truncated: result.truncated,
        matchesSignature: encodeSignature(result.matches),
      }))
    },
    recordWriteBaseline(pathInput) {
      const path = normalizeWorkspaceFilePath(pathInput)
      assertOrdinarySaveRuntimeMutationPath(path)
      const dependency = fileDependency(snapshot, "save-runtime", path)
      return push(Object.freeze({
        kind: "write-baseline",
        scope: "save-runtime",
        path,
        observed: dependency.kind === "file" ? dependency.observed : "missing",
        ...(dependency.kind === "file" && dependency.signature
          ? { signature: dependency.signature }
          : {}),
      }))
    },
    recordDeleteRange(prefixInput) {
      const prefix = normalizeWorkspaceTargetPath(prefixInput)
      assertOrdinarySaveRuntimeMutationPath(prefix)
      deletePrefixes.add(prefix)
      return push(Object.freeze({
        kind: "delete-range",
        scope: "save-runtime",
        prefix,
        descendantsSignature: descendantsSignature(snapshot, prefix),
      }))
    },
    readSet() {
      return Object.freeze({
        dependencies: freezeArray(dependencies),
        deletePrefixes: freezeArray(Array.from(deletePrefixes).sort()),
      })
    },
  }
}

/** Converts the registry's bound card-content resource into an exact CAS dependency. */
export function createFrontendActionWorkspaceResourceDependency(
  snapshot: FrontendActionWorkspaceSnapshot,
  resource: {
    provenance: "card-content"
    gameCardId: string
    file: WorkspaceFile
    signature: {
      path: string
      createdAt: number
      updatedAt: number
      byteLength: number
    }
  },
): FrontendActionWorkspaceResourceDependency {
  const path = normalizeWorkspaceFilePath(resource.signature.path)
  const snapshotFile = snapshot.cardContentFiles.find((file) => file.path === path)
  if (
    resource.provenance !== "card-content"
    || resource.gameCardId !== snapshot.gameCardId
    || snapshot.mountedGameCardId !== snapshot.gameCardId
    || !snapshotFile
    || resource.file !== snapshotFile
    || resource.file.path !== path
    || resource.file.binary
    || resource.file.createdAt !== resource.signature.createdAt
    || resource.file.updatedAt !== resource.signature.updatedAt
    || utf8ByteLength(resource.file.content) !== resource.signature.byteLength
  ) {
    throw storageError(
      "FRONTEND_ACTION_RESOURCE_INVALID",
      "Frontend Action resource must be an exact bound card-content snapshot file.",
    )
  }
  return Object.freeze({
    provenance: "card-content",
    gameCardId: resource.gameCardId,
    path,
    rowId: snapshotFile.provenance.rowId,
    snapshotSignature: snapshotFile.snapshotSignature,
    createdAt: resource.signature.createdAt,
    updatedAt: resource.signature.updatedAt,
    byteLength: resource.signature.byteLength,
    content: resource.file.content,
  })
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

async function blobsEqual(left: Blob, right: Blob): Promise<boolean> {
  if (left === right) return true
  if (left.type !== right.type || left.size !== right.size) return false
  const [leftBuffer, rightBuffer] = await Dexie.waitFor(Promise.all([
    left.arrayBuffer(),
    right.arrayBuffer(),
  ]))
  const leftBytes = new Uint8Array(leftBuffer)
  const rightBytes = new Uint8Array(rightBuffer)
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false
  }
  return true
}

async function payloadEqualsRecord(file: WorkspaceFile, record: LocalWorkspaceFileRecord): Promise<boolean> {
  if (file.binary || record.data) {
    if (!file.binary || !record.data) return false
    return blobsEqual(file.binary, record.data)
  }
  return file.content === record.content
}

function workspaceFileRecordId(saveId: string, path: string): string {
  return [saveId, "workspace", encodeURIComponent(path)].join(":")
}

function normalizeWrittenFiles(files: readonly WorkspaceFile[]): Map<string, WorkspaceFile> {
  const result = new Map<string, WorkspaceFile>()
  for (const file of files) {
    const path = normalizeWorkspaceFilePath(file.path)
    assertOrdinarySaveRuntimeMutationPath(path)
    if (result.has(path)) {
      throw storageError(
        "FRONTEND_ACTION_MUTATION_INVALID",
        `Frontend Action changes contain duplicate writes for ${path}.`,
      )
    }
    if (file.binary && file.content !== binaryPlaceholderText(
      file.binary,
      path,
      resolveBlobMediaType(path, file.binary),
    )) {
      throw storageError(
        "FRONTEND_ACTION_MUTATION_INVALID",
        `Frontend Action binary write has inconsistent content metadata: ${path}`,
      )
    }
    result.set(path, { ...cloneWorkspaceFile(file), path })
  }
  return result
}

function normalizeDeletePrefixes(
  changes: RuntimeWorkspaceChanges,
  explicit: readonly string[] | undefined,
): string[] {
  const values = [...changes.deletedPaths, ...(explicit ?? [])]
  const prefixes = new Set<string>()
  for (const value of values) {
    const prefix = normalizeWorkspaceTargetPath(value)
    assertOrdinarySaveRuntimeMutationPath(prefix)
    prefixes.add(prefix)
  }
  return Array.from(prefixes).sort()
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function buildDesiredBaseline(
  snapshot: FrontendActionWorkspaceSnapshot,
  writtenFiles: Map<string, WorkspaceFile>,
  deletePrefixes: readonly string[],
): Map<string, WorkspaceFile> {
  const desired = new Map(
    filesForScope(snapshot, "save-runtime")
      .map((file) => [file.path, cloneWorkspaceFile(file)] as const),
  )
  for (const prefix of deletePrefixes) {
    for (const path of Array.from(desired.keys())) {
      if (pathMatchesPrefix(path, prefix)) desired.delete(path)
    }
  }
  for (const [path, file] of writtenFiles) desired.set(path, file)
  return desired
}

async function validateBinding(
  snapshot: FrontendActionWorkspaceSnapshot,
  mountedGameCardId: string,
): Promise<SnapshotRows> {
  let rows: SnapshotRows
  try {
    rows = await readBoundRows(mountedGameCardId)
  } catch {
    conflict("Frontend Action active-save or mounted-card binding changed.")
  }
  if (
    rows.saveId !== snapshot.saveId
    || rows.gameCardId !== snapshot.gameCardId
    || rows.activeSaveId !== snapshot.saveId
    || mountedGameCardId !== snapshot.mountedGameCardId
  ) {
    conflict("Frontend Action active-save or mounted-card binding changed.")
  }
  return rows
}

function normalizeResources(
  snapshot: FrontendActionWorkspaceSnapshot,
  resources: readonly FrontendActionWorkspaceResourceDependency[],
): RequiredFrontendActionResourceSet {
  const requiredByPath = new Map(resources.map((resource) => [resource.path, resource]))
  if (requiredByPath.size !== resources.length) {
    throw storageError(
      "FRONTEND_ACTION_RESOURCE_INVALID",
      "Frontend Action commit received duplicate resource dependencies.",
    )
  }
  for (const resource of resources) {
    const snapshotFile = snapshot.cardContentFiles.find((file) => file.path === resource.path)
    if (
      resource.provenance !== "card-content"
      || resource.gameCardId !== snapshot.gameCardId
      || !snapshotFile
      || resource.rowId !== snapshotFile.provenance.rowId
      || resource.snapshotSignature !== snapshotFile.snapshotSignature
      || resource.createdAt !== snapshotFile.createdAt
      || resource.updatedAt !== snapshotFile.updatedAt
      || resource.byteLength !== utf8ByteLength(snapshotFile.content)
      || resource.content !== snapshotFile.content
    ) {
      throw storageError(
        "FRONTEND_ACTION_RESOURCE_INVALID",
        `Frontend Action commit received an invalid card-content resource: ${resource.path}`,
      )
    }
  }
  return {
    exact: resources.slice().sort((left, right) => left.path.localeCompare(right.path)),
  }
}

function validateResources(
  resources: RequiredFrontendActionResourceSet,
  rows: SnapshotRows,
): void {
  for (const resource of resources.exact) {
    if (resource.provenance !== "card-content" || resource.gameCardId !== rows.gameCardId) {
      conflict("Frontend Action resource provenance or card binding changed.")
    }
    const matches = rows.contentRows.filter((row) => row.path === resource.path)
    if (matches.length !== 1) {
      conflict(`Frontend Action resource changed: ${resource.path}`)
    }
    const row = matches[0]!
    if (
      row.id !== resource.rowId
      || rows.contentSignatures.get(row.id) !== resource.snapshotSignature
      || row.data
      || row.content !== resource.content
      || row.createdAt !== resource.createdAt
      || row.updatedAt !== resource.updatedAt
      || utf8ByteLength(row.content) !== resource.byteLength
    ) {
      conflict(`Frontend Action resource changed: ${resource.path}`)
    }
  }
}

function dependencyMatches(
  dependency: FrontendActionWorkspaceDependency,
  live: FrontendActionWorkspaceSnapshot,
): boolean {
  if (dependency.kind === "file") {
    const replay = fileDependency(live, dependency.scope, dependency.path)
    return replay.kind === "file"
      && replay.observed === dependency.observed
      && replay.signature === dependency.signature
  }
  if (dependency.kind === "list") {
    return listEntriesSignature(
      live,
      dependency.scope,
      dependency.path,
      dependency.recursive,
    ) === dependency.entriesSignature
  }
  if (dependency.kind === "glob") {
    const replay = globResult(live, dependency.scope, dependency.pattern, dependency.limit)
    return replay.truncated === dependency.truncated
      && encodeSignature(replay.matches) === dependency.matchesSignature
  }
  if (dependency.kind === "write-baseline") {
    const replay = fileDependency(live, "save-runtime", dependency.path)
    return replay.kind === "file"
      && replay.observed === dependency.observed
      && replay.signature === dependency.signature
  }
  return descendantsSignature(live, dependency.prefix) === dependency.descendantsSignature
}

function dependencyKey(dependency: FrontendActionWorkspaceDependency): string {
  if (dependency.kind === "file") return `file:${dependency.scope}:${dependency.path}`
  if (dependency.kind === "list") {
    return `list:${dependency.scope}:${dependency.path}:${dependency.recursive ? "recursive" : "direct"}`
  }
  if (dependency.kind === "glob") {
    return `glob:${dependency.scope}:${dependency.pattern}:${dependency.limit}`
  }
  if (dependency.kind === "write-baseline") return `write:${dependency.path}`
  return `delete:${dependency.prefix}`
}

function validateDependencies(
  dependencies: readonly FrontendActionWorkspaceDependency[],
  snapshot: FrontendActionWorkspaceSnapshot,
): void {
  const seen = new Map<string, FrontendActionWorkspaceDependency>()
  for (const dependency of dependencies) {
    const key = dependencyKey(dependency)
    const existing = seen.get(key)
    if (existing) {
      if (encodeSignature([existing]) !== encodeSignature([dependency])) {
        throw storageError(
          "FRONTEND_ACTION_DEPENDENCY_INVALID",
          `Frontend Action dependency contains conflicting baselines: ${key}`,
        )
      }
      continue
    }
    seen.set(key, dependency)

    let baseline: FrontendActionWorkspaceDependency
    if (dependency.kind === "file") {
      const scope = normalizeScope(dependency.scope)
      const path = normalizeWorkspaceFilePath(dependency.path)
      if (scope !== dependency.scope || path !== dependency.path) {
        throw storageError("FRONTEND_ACTION_DEPENDENCY_INVALID", `Dependency is not normalized: ${key}`)
      }
      baseline = fileDependency(snapshot, scope, path)
    } else if (dependency.kind === "list") {
      const scope = normalizeScope(dependency.scope)
      const path = normalizeDirectoryPath(dependency.path)
      if (scope !== dependency.scope || path !== dependency.path || typeof dependency.recursive !== "boolean") {
        throw storageError("FRONTEND_ACTION_DEPENDENCY_INVALID", `Dependency is not normalized: ${key}`)
      }
      baseline = Object.freeze({
        kind: "list",
        scope,
        path,
        recursive: dependency.recursive,
        entriesSignature: listEntriesSignature(snapshot, scope, path, dependency.recursive),
      })
    } else if (dependency.kind === "glob") {
      const scope = normalizeScope(dependency.scope)
      const pattern = normalizeGlobPattern(dependency.pattern)
      const limit = normalizeGlobLimit(dependency.limit)
      if (scope !== dependency.scope || pattern !== dependency.pattern || limit !== dependency.limit) {
        throw storageError("FRONTEND_ACTION_DEPENDENCY_INVALID", `Dependency is not normalized: ${key}`)
      }
      const result = globResult(snapshot, scope, pattern, limit)
      baseline = Object.freeze({
        kind: "glob",
        scope,
        pattern,
        limit,
        truncated: result.truncated,
        matchesSignature: encodeSignature(result.matches),
      })
    } else if (dependency.kind === "write-baseline") {
      const path = normalizeWorkspaceFilePath(dependency.path)
      assertOrdinarySaveRuntimeMutationPath(path)
      if (dependency.scope !== "save-runtime" || path !== dependency.path) {
        throw storageError("FRONTEND_ACTION_DEPENDENCY_INVALID", `Dependency is not normalized: ${key}`)
      }
      const fileBaseline = fileDependency(snapshot, "save-runtime", path)
      baseline = Object.freeze({
        kind: "write-baseline",
        scope: "save-runtime",
        path,
        observed: fileBaseline.kind === "file" ? fileBaseline.observed : "missing",
        ...(fileBaseline.kind === "file" && fileBaseline.signature
          ? { signature: fileBaseline.signature }
          : {}),
      })
    } else {
      const prefix = normalizeWorkspaceTargetPath(dependency.prefix)
      assertOrdinarySaveRuntimeMutationPath(prefix)
      if (dependency.scope !== "save-runtime" || prefix !== dependency.prefix) {
        throw storageError("FRONTEND_ACTION_DEPENDENCY_INVALID", `Dependency is not normalized: ${key}`)
      }
      baseline = Object.freeze({
        kind: "delete-range",
        scope: "save-runtime",
        prefix,
        descendantsSignature: descendantsSignature(snapshot, prefix),
      })
    }
    if (encodeSignature([baseline]) !== encodeSignature([dependency])) {
      throw storageError(
        "FRONTEND_ACTION_DEPENDENCY_INVALID",
        `Frontend Action dependency does not match the invocation-start snapshot: ${key}`,
      )
    }
  }
}

function requiredMutationDependencies(
  writtenFiles: ReadonlyMap<string, WorkspaceFile>,
  deletePrefixes: readonly string[],
): { writes: Set<string>; deletes: Set<string> } {
  return {
    writes: new Set(writtenFiles.keys()),
    deletes: new Set(deletePrefixes),
  }
}

function assertMutationDependencies(
  dependencies: readonly FrontendActionWorkspaceDependency[],
  required: ReturnType<typeof requiredMutationDependencies>,
): void {
  const writeDependencies = new Map(
    dependencies
      .filter((value): value is Extract<FrontendActionWorkspaceDependency, { kind: "write-baseline" }> => (
        value.kind === "write-baseline"
      ))
      .map((value) => [value.path, value]),
  )
  const deleteDependencies = dependencies
    .filter((value): value is Extract<FrontendActionWorkspaceDependency, { kind: "delete-range" }> => (
      value.kind === "delete-range"
    ))
  for (const path of required.writes) {
    if (!writeDependencies.has(path)) {
      throw storageError(
        "FRONTEND_ACTION_WRITE_BASELINE_REQUIRED",
        `Frontend Action write is missing its invocation-start baseline: ${path}`,
      )
    }
  }
  for (const prefix of required.deletes) {
    if (!deleteDependencies.some((dependency) => pathMatchesPrefix(prefix, dependency.prefix))) {
      throw storageError(
        "FRONTEND_ACTION_DELETE_RANGE_REQUIRED",
        `Frontend Action delete is missing its invocation-start range: ${prefix}`,
      )
    }
  }
}

async function actualDelta(
  snapshot: FrontendActionWorkspaceSnapshot,
  currentRows: readonly LocalWorkspaceFileRecord[],
  desired: ReadonlyMap<string, WorkspaceFile>,
  writtenFiles: ReadonlyMap<string, WorkspaceFile>,
  deletePrefixes: readonly string[],
): Promise<{ writtenFiles: WorkspaceFile[]; deletedRows: LocalWorkspaceFileRecord[] }> {
  const baselineByPath = new Map(
    filesForScope(snapshot, "save-runtime").map((file) => [file.path, file] as const),
  )
  const currentByPath = new Map(currentRows.map((row) => [row.path, row] as const))
  const writtenDelta: WorkspaceFile[] = []
  for (const path of writtenFiles.keys()) {
    const next = desired.get(path)
    if (!next) continue
    const baseline = baselineByPath.get(path)
    const current = currentByPath.get(path)
    if (baseline) {
      if (!current || workspaceFileSignature(baseline) !== await workspaceRecordSignature(current)) {
        conflict(`Frontend Action write target changed: ${path}`)
      }
      if (await payloadEqualsRecord(next, workspaceFileToRecord(snapshot.saveId, baseline))) {
        continue
      }
    } else if (current) {
      conflict(`Frontend Action write target changed: ${path}`)
    }
    if (current && await payloadEqualsRecord(next, current)) continue
    writtenDelta.push(next)
  }

  const desiredPaths = new Set(desired.keys())
  const deletedRows = currentRows.filter((row) => (
    deletePrefixes.some((prefix) => pathMatchesPrefix(row.path, prefix))
    && !desiredPaths.has(row.path)
  ))

  for (const row of deletedRows) {
    const baseline = baselineByPath.get(row.path)
    if (!baseline || workspaceFileSignature(baseline) !== await workspaceRecordSignature(row)) {
      conflict(`Frontend Action delete target changed: ${row.path}`)
    }
  }

  return {
    writtenFiles: writtenDelta.sort(compareFilePath),
    deletedRows: deletedRows.slice().sort(compareRowPath),
  }
}

function workspaceFileToRecord(saveId: string, file: WorkspaceFile): LocalWorkspaceFileRecord {
  return {
    id: workspaceFileRecordId(saveId, file.path),
    saveId,
    path: file.path,
    content: file.binary ? "" : file.content,
    ...(file.binary ? { data: file.binary } : {}),
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  }
}

/**
 * Validates the complete invocation read set and applies only the actual
 * save-runtime delta in one no-checkpoint transaction. Conflicts are never retried.
 */
export async function commitFrontendActionWorkspace(
  input: CommitFrontendActionWorkspaceInput,
): Promise<FrontendActionWorkspaceCommitResult> {
  const mountedGameCardId = requireMountedGameCardId(input.mountedGameCardId)
  if (
    input.snapshot.mountedGameCardId !== mountedGameCardId
    || input.snapshot.gameCardId !== mountedGameCardId
  ) {
    conflict("Frontend Action mounted-card binding changed.")
  }

  const writtenFiles = normalizeWrittenFiles(input.changes.writtenFiles)
  const deletePrefixes = normalizeDeletePrefixes(input.changes, input.deletePrefixes)
  const resources = normalizeResources(input.snapshot, input.resources)
  validateDependencies(input.dependencies, input.snapshot)
  assertMutationDependencies(
    input.dependencies,
    requiredMutationDependencies(writtenFiles, deletePrefixes),
  )

  return localDb.transaction(
    "rw",
    [
      localDb.meta,
      localDb.saves,
      localDb.gameCards,
      localDb.gameCardContentFiles,
      localDb.gameCardFrontendFiles,
      localDb.workspaceFiles,
    ],
    async () => {
      input.assertCommitAllowed?.()
      const rows = await validateBinding(input.snapshot, mountedGameCardId)
      validateResources(resources, rows)
      const liveMaterialized = await materializeWorkspace(rows)
      const liveSnapshot: FrontendActionWorkspaceSnapshot = {
        saveId: rows.saveId,
        gameCardId: rows.gameCardId,
        mountedGameCardId,
        cardContentFiles: liveMaterialized.cardContentFiles,
        cardFrontendFiles: liveMaterialized.cardFrontendFiles,
        saveWorkspaceFiles: liveMaterialized.saveWorkspaceFiles,
        effectiveFiles: liveMaterialized.effectiveFiles,
      }

      const seen = new Set<string>()
      for (const dependency of input.dependencies) {
        const key = dependencyKey(dependency)
        if (seen.has(key)) continue
        seen.add(key)
        if (!dependencyMatches(dependency, liveSnapshot)) {
          conflict(`Frontend Action workspace dependency changed: ${key}`)
        }
      }

      const desired = buildDesiredBaseline(input.snapshot, writtenFiles, deletePrefixes)
      const delta = await actualDelta(
        input.snapshot,
        rows.workspaceRows,
        desired,
        writtenFiles,
        deletePrefixes,
      )
      input.assertCommitAllowed?.()
      if (delta.writtenFiles.length === 0 && delta.deletedRows.length === 0) {
        return Object.freeze({
          saveId: rows.saveId,
          gameCardId: rows.gameCardId,
          writtenPaths: freezeArray([]),
          deletedPaths: freezeArray([]),
          changed: false,
        })
      }

      const now = Date.now()
      for (const row of delta.deletedRows) await localDb.workspaceFiles.delete(row.id)
      for (const file of delta.writtenFiles) {
        const current = rows.workspaceRows.find((row) => row.path === file.path)
        await localDb.workspaceFiles.put({
          id: workspaceFileRecordId(rows.saveId, file.path),
          saveId: rows.saveId,
          path: file.path,
          content: file.binary ? "" : file.content,
          ...(file.binary ? { data: file.binary } : {}),
          createdAt: current?.createdAt ?? file.createdAt ?? now,
          updatedAt: now,
        })
      }
      const save = await localDb.saves.get(rows.saveId)
      if (!save) conflict("Frontend Action active save disappeared during commit.")
      await localDb.saves.put({
        ...save,
        updatedAt: now,
      })

      return Object.freeze({
        saveId: rows.saveId,
        gameCardId: rows.gameCardId,
        writtenPaths: freezeArray(delta.writtenFiles.map((file) => file.path).sort()),
        deletedPaths: freezeArray(delta.deletedRows.map((row) => row.path).sort()),
        changed: true,
      })
    },
  )
}
