import type {
  GameCardFrontendBinding,
  RuntimeSnapshotShell,
  WorkspaceFile,
} from "@tsian/contracts"
import type { LocalGameCardRecord, LocalSaveRecord } from "../storage"
import { resolveRemoteFrontendUrl } from "../bridge"
import {
  getRuntimeEngine,
  markPlatformHostReady,
} from "./host-state"
import {
  ensureActiveGameCardId,
  gameCardForSave,
  isRecord,
} from "./internal"
import {
  createEmptyRuntimeSnapshot,
  createLocalSave,
  createLocalSaveFromGameCard,
  deleteLocalGameCard,
  deleteLocalGameCardContentFile,
  deleteLocalGameCardContentPathForCard,
  deleteLocalSave,
  deleteWorkspacePathForSave,
  ensureBuiltinBlankGameCard,
  exportGameCardFrontendPackage,
  exportGameCardPackage,
  getActiveGameCardId,
  getActiveSaveId,
  getBuiltinBlankGameCard,
  getLocalGameCard,
  getSnapshotForSave,
  importGameCardFrontendPackage,
  importGameCardPackage,
  initializeWorkspaceForSave,
  listEffectiveWorkspaceFilesForSave,
  listLocalGameCardContentFiles,
  listLocalGameCardFrontendFiles,
  listLocalGameCards,
  listLocalSaves,
  listWorkspaceFilesForSave,
  normalizeWorkspaceFilePath,
  putLocalGameCard,
  replaceWorkspaceFilesForSave,
  setActiveGameCardId,
  setActiveSaveId,
  writeLocalGameCardContentFile,
  writeWorkspaceFileForSave,
} from "../storage"
import { BUILTIN_BLANK_GAME_CARD_ID } from "../storage/game-cards"
import {
  DEFAULT_FRONTEND_BINDING,
  defaultFrontendFiles,
} from "../storage/default-frontend-files"

export interface PlatformGameCardFrontendFileSummary {
  path: string
  mediaType: string
  size: number
  updatedAt: number
}

export interface PlatformGameCardMetadataInput {
  name: string
  summary: string
}

export type PlatformGameCardCopyInput = PlatformGameCardMetadataInput

export interface PlatformGameCardDeleteResult {
  deletedCardId: string
  deletedSaveIds: string[]
}

async function activeSaveExists(saveId: string): Promise<boolean> {
  return (await listLocalSaves()).some((save) => save.id === saveId)
}

async function syncActiveGameCardFromSave(saveId: string | null): Promise<void> {
  if (!saveId) {
    return
  }

  const save = (await listLocalSaves()).find((item) => item.id === saveId)
  if (!save) {
    return
  }

  await setActiveGameCardId(save.gameCardId ?? (await getBuiltinBlankGameCard()).id)
}

export async function ensureActiveSave(): Promise<string> {
  const activeSaveId = await getActiveSaveId()
  if (activeSaveId && await activeSaveExists(activeSaveId)) {
    await syncActiveGameCardFromSave(activeSaveId)
    return activeSaveId
  }

  const created = await createLocalSave()
  await setActiveSaveId(created.id)
  await setActiveGameCardId(created.gameCardId ?? (await getBuiltinBlankGameCard()).id)
  getRuntimeEngine().loadSnapshot(await getSnapshotForSave(created.id))
  return created.id
}

async function restoreActiveSnapshotFromStorage(saveId: string): Promise<RuntimeSnapshotShell> {
  const snapshot = await getSnapshotForSave(saveId)
  getRuntimeEngine().loadSnapshot(snapshot)
  return snapshot
}

function normalizePackagedFrontendEntry(value: string): string {
  const raw = value.trim().replace(/\\/g, "/")
  if (!raw) {
    throw new Error("打包前端入口不能为空。")
  }
  if (raw.startsWith("/") || raw.includes("\0")) {
    throw new Error("打包前端入口必须是相对 package 路径。")
  }

  const parts: string[] = []
  for (const part of raw.split("/")) {
    if (!part || part === ".") {
      continue
    }
    if (part === "..") {
      throw new Error("打包前端入口不能包含 '..'。")
    }
    parts.push(part)
  }

  const normalized = parts.join("/")
  if (!normalized.startsWith("frontend/")) {
    throw new Error("打包前端入口必须位于 frontend/ 下。")
  }
  return normalized
}

function normalizeGameCardFrontendBinding(
  frontend: GameCardFrontendBinding | null | undefined,
): GameCardFrontendBinding | undefined {
  if (!frontend) {
    return undefined
  }

  if (frontend.kind === "remote") {
    const resolved = resolveRemoteFrontendUrl(frontend.url)
    if (!resolved.ok) {
      throw new Error(resolved.error.message)
    }
    return {
      kind: "remote",
      url: frontend.url.trim(),
      bridgeVersion: "tsian.play-bridge.v1",
    }
  }

  if (frontend.kind === "packaged") {
    return {
      kind: "packaged",
      entry: normalizePackagedFrontendEntry(frontend.entry),
      bridgeVersion: "tsian.play-bridge.v1",
    }
  }

  throw new Error(
    `不支持的游戏卡前端类型：${String((frontend as { kind?: unknown }).kind)}`,
  )
}

function requireMetadataText(value: string, fieldName: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`)
  }
  return normalized
}

function metadataManifestPatch(input: PlatformGameCardMetadataInput) {
  return {
    name: requireMetadataText(input.name, "名称"),
    summary: requireMetadataText(input.summary, "简介"),
  }
}

function slugifyGameCardIdSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "")
    || "game-card"
}

async function createUniqueLocalGameCardId(name: string): Promise<string> {
  const base = `local.${slugifyGameCardIdSegment(name)}`
  let candidate = base
  let index = 2
  while (await getLocalGameCard(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }
  return candidate
}

export function formatActiveFrontendId(frontend: GameCardFrontendBinding | undefined): string | undefined {
  if (!frontend) {
    return undefined
  }

  if (frontend.kind === "remote") {
    return frontend.url
  }

  return frontend.entry
}

export async function initializePlatformHost(): Promise<void> {
  await ensureBuiltinBlankGameCard()

  const saves = await listLocalSaves()
  const activeSaveId = await getActiveSaveId()
  const storedActiveCardId = await getActiveGameCardId()
  const hasStoredActiveCard = Boolean(storedActiveCardId && await getLocalGameCard(storedActiveCardId))
  await ensureActiveGameCardId(saves)

  if (activeSaveId) {
    const activeSave = saves.find((save) => save.id === activeSaveId)
    if (activeSave) {
      if (!hasStoredActiveCard) {
        await syncActiveGameCardFromSave(activeSaveId)
      }
      await restoreActiveSnapshotFromStorage(activeSaveId)
      markPlatformHostReady()
      return
    }

    await setActiveSaveId(null)
  }

  if (saves.length > 0) {
    const next = saves[0]
    await setActiveSaveId(next.id)
    if (!hasStoredActiveCard) {
      await syncActiveGameCardFromSave(next.id)
    }
    await restoreActiveSnapshotFromStorage(next.id)
  } else {
    getRuntimeEngine().loadSnapshot(createEmptyRuntimeSnapshot())
  }

  markPlatformHostReady()
}

export async function listPlatformSaves() {
  return listLocalSaves()
}

export async function createPlatformSave(input?: {
  name?: string
}) {
  const created = await createLocalSave(input?.name)
  await setActiveSaveId(created.id)
  await setActiveGameCardId(created.gameCardId ?? (await getBuiltinBlankGameCard()).id)
  await restoreActiveSnapshotFromStorage(created.id)
  return created
}

export async function listPlatformGameCards() {
  await ensureBuiltinBlankGameCard()
  return listLocalGameCards()
}

export async function getPlatformGameCard(cardId: string) {
  return getLocalGameCard(cardId)
}

export async function updatePlatformGameCardMetadata(
  cardId: string,
  input: PlatformGameCardMetadataInput,
) {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  if (card.source === "builtin") {
    throw new Error("内置游戏卡不能直接改名。请先另存为本地副本。")
  }

  const patch = metadataManifestPatch(input)
  return putLocalGameCard({
    manifest: {
      ...card.manifest,
      ...patch,
    },
    // contentFiles undefined = leave the content table untouched (metadata-only write).
    source: card.source,
  })
}

export async function copyPlatformGameCardAsLocal(
  cardId: string,
  input: PlatformGameCardCopyInput,
) {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  const frontendFiles = await listLocalGameCardFrontendFiles(card.id)
  const contentFiles = await listLocalGameCardContentFiles(card.id)
  const patch = metadataManifestPatch(input)
  const id = await createUniqueLocalGameCardId(patch.name)
  return putLocalGameCard({
    manifest: {
      ...card.manifest,
      ...patch,
      id,
    },
    contentFiles: contentFiles.map((file) => ({
      path: file.path,
      content: file.content,
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    })),
    frontendFiles: frontendFiles.map((file) => ({
      path: file.path,
      data: file.data,
      mediaType: file.mediaType,
    })),
    source: "local",
  })
}

/**
 * Create a fresh local game card from the builtin blank template, bound to the
 * default lightweight packaged frontend, and set it as the active card.
 *
 * The builtin blank card is treated as a reusable template: this copies its
 * workspace content into a new local card (new id), injects the 3 default
 * frontend files, sets the packaged frontend binding, then loads it. The user
 * can then customize the card via the desktop assistant or workspace editor.
 */
export async function createDefaultPlatformGameCard(input?: {
  name?: string
  summary?: string
}): Promise<LocalGameCardRecord> {
  const name = input?.name?.trim() || "我的游戏"
  const summary = input?.summary?.trim()
    || "从模板创建的游戏卡，可用桌面助手定制内容。"

  // 1. Copy the builtin template card as a local card (new id, same content).
  const copy = await copyPlatformGameCardAsLocal(BUILTIN_BLANK_GAME_CARD_ID, {
    name,
    summary,
  })

  // 2. Inject the default packaged frontend files + binding onto the new card.
  //    Re-read the copy's content rows from the per-file table (copy returns a
  //    LocalGameCardRecord without contentFiles now) and pass them as a full
  //    replace so they survive the frontend-binding upsert.
  const copyContentFiles = await listLocalGameCardContentFiles(copy.id)
  const record = await putLocalGameCard({
    manifest: {
      ...copy.manifest,
      frontend: DEFAULT_FRONTEND_BINDING,
    },
    contentFiles: copyContentFiles.map((file) => ({
      path: file.path,
      content: file.content,
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    })),
    frontendFiles: defaultFrontendFiles(),
    source: "local",
  })

  // 3. Load the new card as the active game card.
  const active = await setPlatformActiveGameCard(record.id)
  return active
}

export async function deletePlatformGameCard(
  cardId: string,
): Promise<PlatformGameCardDeleteResult> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  if (card.source === "builtin") {
    throw new Error("内置游戏卡不能删除。")
  }

  const activeSaveId = await getActiveSaveId()
  const saves = (await listLocalSaves()).filter((save) => save.gameCardId === card.manifest.id)
  const deletedSaveIds = saves.map((save) => save.id)
  for (const saveId of deletedSaveIds) {
    await deleteLocalSave(saveId)
  }
  await deleteLocalGameCard(card.id)

  if (await getActiveGameCardId() === card.id) {
    const remainingCards = await listLocalGameCards()
    await setActiveGameCardId(remainingCards[0]?.id ?? (await getBuiltinBlankGameCard()).id)
  }

  if (activeSaveId && deletedSaveIds.includes(activeSaveId)) {
    const remainingSaves = await listLocalSaves()
    if (remainingSaves.length > 0) {
      await setActiveSaveId(remainingSaves[0].id)
      await syncActiveGameCardFromSave(remainingSaves[0].id)
      await restoreActiveSnapshotFromStorage(remainingSaves[0].id)
    } else {
      await setActiveSaveId(null)
      getRuntimeEngine().loadSnapshot(createEmptyRuntimeSnapshot())
    }
  }

  return {
    deletedCardId: card.id,
    deletedSaveIds,
  }
}

export async function listPlatformGameCardFrontendFiles(
  cardId: string,
): Promise<PlatformGameCardFrontendFileSummary[]> {
  return (await listLocalGameCardFrontendFiles(cardId)).map((file) => ({
    path: file.path,
    mediaType: file.mediaType,
    size: file.size,
    updatedAt: file.updatedAt,
  }))
}

export async function updatePlatformGameCardFrontend(
  cardId: string,
  frontend: GameCardFrontendBinding | null | undefined,
) {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  const normalizedFrontend = normalizeGameCardFrontendBinding(frontend)
  if (normalizedFrontend?.kind === "packaged") {
    const frontendFiles = await listLocalGameCardFrontendFiles(card.id)
    if (!frontendFiles.some((file) => file.path === normalizedFrontend.entry)) {
      throw new Error(`打包前端入口不存在：${normalizedFrontend.entry}`)
    }
  }

  return putLocalGameCard({
    manifest: {
      ...card.manifest,
      frontend: normalizedFrontend,
    },
    // contentFiles undefined = leave the content table untouched (frontend-binding-only write).
    // When clearing the binding, also delete all packaged frontend files.
    // putLocalGameCard treats frontendFiles: [] as "delete all existing
    // frontend files for this card" (enters the delete branch, writes none).
    frontendFiles: normalizedFrontend ? undefined : [],
    source: card.source,
  })
}

export async function importPlatformGameCardPackage(input: Blob | ArrayBuffer | Uint8Array) {
  await ensureBuiltinBlankGameCard()
  return importGameCardPackage(input)
}

export async function exportPlatformGameCardPackage(cardId: string) {
  await ensureBuiltinBlankGameCard()
  return exportGameCardPackage(cardId)
}

export async function importPlatformGameCardFrontendPackage(
  cardId: string,
  input: Blob | ArrayBuffer | Uint8Array,
) {
  await ensureBuiltinBlankGameCard()
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }
  if (card.source === "builtin") {
    throw new Error("内置游戏卡不能直接替换前端，请先另存为本地副本。")
  }
  return importGameCardFrontendPackage(cardId, input)
}

export async function exportPlatformGameCardFrontendPackage(cardId: string): Promise<Blob> {
  await ensureBuiltinBlankGameCard()
  return exportGameCardFrontendPackage(cardId)
}

export async function createPlatformSaveFromGameCard(
  cardId: string,
  input?: { name?: string },
) {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  const created = await createLocalSaveFromGameCard(card, input)
  await setActiveSaveId(created.id)
  await setActiveGameCardId(card.id)
  await restoreActiveSnapshotFromStorage(created.id)
  return created
}

export async function selectPlatformSave(saveId: string) {
  if (!await activeSaveExists(saveId)) {
    throw new Error(`会话 "${saveId}" 不存在。`)
  }

  await setActiveSaveId(saveId)
  await syncActiveGameCardFromSave(saveId)
  await restoreActiveSnapshotFromStorage(saveId)
}

export async function deletePlatformSave(saveId: string) {
  const activeSaveId = await getActiveSaveId()
  await deleteLocalSave(saveId)

  const remaining = await listLocalSaves()

  if (remaining.length === 0) {
    if (activeSaveId === saveId) {
      await setActiveSaveId(null)
    }
    getRuntimeEngine().loadSnapshot(createEmptyRuntimeSnapshot())
    return
  }

  if (activeSaveId === saveId) {
    const next = remaining[0]
    await setActiveSaveId(next.id)
    await syncActiveGameCardFromSave(next.id)
    await restoreActiveSnapshotFromStorage(next.id)
  }
}

export async function getPlatformActiveSaveId() {
  return getActiveSaveId()
}

export async function getPlatformActiveGameCardId() {
  return ensureActiveGameCardId()
}

export async function setPlatformActiveGameCard(cardId: string): Promise<LocalGameCardRecord> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  await setActiveGameCardId(card.id)
  return card
}
