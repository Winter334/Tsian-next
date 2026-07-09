import type {
  GameCardFrontendBinding,
  GameCardManifest,
  WorkspaceFile,
} from "@tsian/contracts"
import { FRONTEND_FRAMEWORKS } from "@tsian/contracts"
import type { LocalGameCardRecord, LocalSaveRecord } from "../storage"
import { resolveRemoteFrontendUrl } from "../bridge"
import { buildFrontend } from "../frontend-build/engine"
import {
  markPlatformHostReady,
} from "./host-state"
import {
  ensureActiveGameCardId,
  gameCardForSave,
  getPlatformActiveGameCard,
  isRecord,
} from "./internal"
import {
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
  getLocalGameCard,
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
  renameLocalSave,
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
import {
  emitActiveCardChanged,
  emitGameCardsChanged,
  emitSavesChanged,
} from "../lib/platform-events"

export interface PlatformGameCardFrontendFileSummary {
  path: string
  size: number
  updatedAt: number
}

export interface PlatformGameCardMetadataInput {
  name: string
  summary: string
  authorName?: string
  version?: string
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
    await setActiveGameCardId(null)
    return
  }

  const save = (await listLocalSaves()).find((item) => item.id === saveId)
  if (!save) {
    await setActiveGameCardId(null)
    return
  }

  const card = await gameCardForSave(save)
  await setActiveGameCardId(card?.id ?? null)
}

export async function ensureActiveSave(): Promise<string> {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("无法创建存档：当前没有加载游戏卡。请先在我的应用中创建、导入或加载一张游戏卡。")
  }

  const activeSaveId = await getActiveSaveId()
  if (activeSaveId && await activeSaveExists(activeSaveId)) {
    await syncActiveGameCardFromSave(activeSaveId)
    return activeSaveId
  }

  const created = await createLocalSaveFromGameCard(activeCard)
  await setActiveSaveId(created.id)
  await setActiveGameCardId(activeCard.id)
  return created.id
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
    const framework = frontend.framework
    if (framework !== undefined && !FRONTEND_FRAMEWORKS.includes(framework)) {
      throw new Error(
        `不支持的游戏卡前端框架：${String(framework)}`,
      )
    }
    return {
      kind: "packaged",
      entry: normalizePackagedFrontendEntry(frontend.entry),
      ...(framework ? { framework } : {}),
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

function metadataManifestPatch(input: PlatformGameCardMetadataInput): Partial<GameCardManifest> {
  const patch: Partial<GameCardManifest> = {
    name: requireMetadataText(input.name, "名称"),
    summary: requireMetadataText(input.summary, "简介"),
  }
  if (input.authorName !== undefined) {
    const trimmed = input.authorName.trim()
    patch.author = trimmed ? { name: trimmed } : undefined
  }
  if (input.version !== undefined) {
    const trimmed = input.version.trim()
    if (trimmed) {
      patch.version = trimmed
    }
  }
  return patch
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
  await ensureActiveGameCardId()

  if (activeSaveId && !saves.some((save) => save.id === activeSaveId)) {
    await setActiveSaveId(null)
  }

  markPlatformHostReady()
}

export async function listPlatformSaves() {
  return listLocalSaves()
}

export async function createPlatformSave(input?: {
  name?: string
}) {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("无法创建存档：当前没有加载游戏卡。请先在我的应用中创建、导入或加载一张游戏卡。")
  }

  const created = await createLocalSaveFromGameCard(activeCard, input)
  await setActiveSaveId(created.id)
  await setActiveGameCardId(activeCard.id)
  emitSavesChanged()
  emitActiveCardChanged()
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
  const result = await putLocalGameCard({
    manifest: {
      ...card.manifest,
      ...patch,
    },
    // contentFiles undefined = leave the content table untouched (metadata-only write).
    source: card.source,
  })
  emitGameCardsChanged()
  if (await getActiveGameCardId() === cardId) {
    emitActiveCardChanged()
  }
  return result
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
  const id = await createUniqueLocalGameCardId(patch.name ?? card.manifest.name)
  const result = await putLocalGameCard({
    manifest: {
      ...card.manifest,
      ...patch,
      id,
    },
    contentFiles: contentFiles.map((file) => ({
      path: file.path,
      content: file.content,
      ...(file.data ? { data: file.data } : {}),
    })),
    frontendFiles: frontendFiles.map((file) => ({
      path: file.path,
      data: file.data,
    })),
    source: "local",
  })
  emitGameCardsChanged()
  return result
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
/**
 * Build a newly-created default card's frontend/src into frontend/dist so
 * the entry (frontend/dist/index.html) resolves on first /play load. Called
 * after default-card creation in three sites. Fire-and-forget semantics but
 * awaited here so the card is playable before the caller returns; failures
 * are swallowed (the card still exists, /play will show a load error the
 * assistant can read via frontend-build-status).
 */
async function buildDefaultFrontendQuiet(cardId: string): Promise<void> {
  try {
    await buildFrontend(cardId)
  } catch (e) {
    // 不阻塞卡创建——前端加载失败时助手可读 frontend-build-status 排错。
    console.warn(`[frontend-build] 默认卡首次构建失败 (${cardId}):`, e instanceof Error ? e.message : e)
  }
}

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
      ...(file.data ? { data: file.data } : {}),
    })),
    frontendFiles: defaultFrontendFiles(),
    source: "local",
  })

  // 3. Load the new card as the active game card.
  const active = await setPlatformActiveGameCard(record.id)
  // setPlatformActiveGameCard emits active-card-changed; emit game-cards-changed
  // again here so subscribers see the final state (with frontend binding applied),
  // since copyPlatformGameCardAsLocal's earlier emit reflected a pre-frontend copy.
  emitGameCardsChanged()
  // 4. Build frontend/src → frontend/dist so the entry resolves on first load.
  await buildDefaultFrontendQuiet(record.id)
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
  const wasActiveCard = await getActiveGameCardId() === card.id
  const saves = (await listLocalSaves()).filter((save) => save.gameCardId === card.manifest.id)
  const deletedSaveIds = saves.map((save) => save.id)
  for (const saveId of deletedSaveIds) {
    await deleteLocalSave(saveId)
  }
  await deleteLocalGameCard(card.id)

  if (wasActiveCard) {
    const remainingCards = await listLocalGameCards()
    const remainingLocal = remainingCards.filter((item) => item.source !== "builtin")
    if (remainingLocal.length > 0) {
      await setActiveGameCardId(remainingLocal[0].id)
    } else {
      await setActiveGameCardId(null)
    }
  }

  if (activeSaveId && deletedSaveIds.includes(activeSaveId)) {
    const remainingSaves = await listLocalSaves()
    if (remainingSaves.length > 0) {
      await setActiveSaveId(remainingSaves[0].id)
      await syncActiveGameCardFromSave(remainingSaves[0].id)
    } else {
      await setActiveSaveId(null)
    }
  }

  emitGameCardsChanged()
  emitSavesChanged()
  if (wasActiveCard) {
    emitActiveCardChanged()
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

  const result = await putLocalGameCard({
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
  emitGameCardsChanged()
  if (await getActiveGameCardId() === cardId) {
    emitActiveCardChanged()
  }
  return result
}

export async function importPlatformGameCardPackage(input: Blob | ArrayBuffer | Uint8Array) {
  await ensureBuiltinBlankGameCard()
  const result = await importGameCardPackage(input)
  emitGameCardsChanged()
  return result
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
  const result = await importGameCardFrontendPackage(cardId, input)
  const frontendFiles = await listLocalGameCardFrontendFiles(cardId)
  const hasSourceFiles = frontendFiles.some((file) => file.path.startsWith("frontend/src/"))
  try {
    if (hasSourceFiles) {
      await buildFrontend(cardId)
    }
  } catch (error) {
    emitGameCardsChanged()
    if (await getActiveGameCardId() === cardId) {
      emitActiveCardChanged()
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`前端源码包已导入，但在线构建失败：${message}`)
  }
  emitGameCardsChanged()
  if (await getActiveGameCardId() === cardId) {
    emitActiveCardChanged()
  }
  return await getLocalGameCard(cardId) ?? result
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
  emitSavesChanged()
  emitActiveCardChanged()
  return created
}

export async function selectPlatformSave(saveId: string) {
  if (!await activeSaveExists(saveId)) {
    throw new Error(`会话 "${saveId}" 不存在。`)
  }

  await setActiveSaveId(saveId)
  await syncActiveGameCardFromSave(saveId)
  emitSavesChanged()
  emitActiveCardChanged()
}

export async function renamePlatformSave(saveId: string, name: string) {
  const updated = await renameLocalSave(saveId, name)
  emitSavesChanged()
  return updated
}

export async function deletePlatformSave(saveId: string) {
  const activeSaveId = await getActiveSaveId()
  const wasActiveSave = activeSaveId === saveId
  await deleteLocalSave(saveId)

  const remaining = await listLocalSaves()

  if (remaining.length === 0) {
    if (wasActiveSave) {
      await setActiveSaveId(null)
    }
    emitSavesChanged()
    if (wasActiveSave) {
      emitActiveCardChanged()
    }
    return
  }

  if (wasActiveSave) {
    const next = remaining[0]
    await setActiveSaveId(next.id)
    await syncActiveGameCardFromSave(next.id)
  }
  emitSavesChanged()
  if (wasActiveSave) {
    emitActiveCardChanged()
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
  emitActiveCardChanged()
  return card
}
