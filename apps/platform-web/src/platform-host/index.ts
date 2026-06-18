import type {
  AgentConfig,
  AgentPlatformToolName,
  AgentContextEntry,
  AgentRegistryEntry,
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  GameCardFrontendBinding,
  PlatformActionError,
  PlatformActionRequest,
  PlatformActionResult,
  PlayFrontendBridge,
  RuntimeDiagnosticSummary,
  RuntimeDiagnosticsQueryParams,
  RuntimeSnapshotShell,
  SkillDetailEntry,
  SkillRegistryEntry,
  WorkspaceDeleteResult,
  WorkspaceListResult,
  WorkspaceFile,
  WorkspaceMoveResult,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspacePatchResult,
  WorkspaceSearchResult,
  WorkspaceScope,
  WorkspaceValidationResult,
} from "@tsian/contracts"
import {
  runAgentRuntimeTurn,
  type AgentSessionTranscriptRecord,
} from "../agent-runtime"
import type { RuntimeControlledExecutorContext } from "../agent-runtime/workspace-tools"
import { assembleAgentContext } from "../agent-runtime/context"
import { buildRuntimeDiagnostics } from "../agent-runtime/diagnostics"
import { isAgentPlatformToolEnabled } from "../agent-runtime/permissions"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  isSkillEnabledForAgent,
  loadSkillDetail,
  skillMatchesReference,
  skillMetadataReference,
} from "../agent-runtime/registry"
import type { RuntimeTraceEmitter } from "../agent-runtime/trace"
import {
  createRuntimeTraceCollector,
  errorToTraceData,
  formatRuntimeTracePath,
  serializeRuntimeTraceEvents,
} from "../agent-runtime/trace"
import {
  AUTHORING_WORKSPACE_OPERATIONS,
  executeWorkspaceOperation,
} from "../agent-runtime/workspace-operations"
import { createDebugBridge, createPlayFrontendBridge, resolveRemoteFrontendUrl } from "../bridge"
import { emitTurnDebugReady } from "../debug-events"
import { LocalRuntimeEngine } from "../runtime-host"
import { generateAssistantReply, getAiDebugRecords } from "../runtime-host/ai"
import { createBrowserSkillScriptRunner } from "./browser-skill-script-executor"
import {
  commitSuccessfulRuntimeTurnForSave,
  createRuntimeWorkspaceTransaction,
  createEmptyRuntimeSnapshot,
  createLocalSave,
  createLocalSaveFromGameCard,
  deleteLocalGameCard,
  deleteWorkspacePathForSave,
  deleteLocalSave,
  ensureBuiltinBlankGameCard,
  exportGameCardPackage,
  getActiveGameCardId,
  getActiveSaveId,
  getBuiltinBlankGameCard,
  getHistoryForSave,
  getLocalGameCard,
  getSnapshotForSave,
  importGameCardPackage,
  initializeWorkspaceForSave,
  listCheckpointsForSave,
  listEffectiveWorkspaceFilesForSave,
  listLocalGameCardFrontendFiles,
  listLocalGameCards,
  listLocalSaves,
  listWorkspaceFilesForSave,
  normalizeWorkspaceFilePath,
  putLocalGameCard,
  replaceWorkspaceFilesForSave,
  restoreCheckpointForSave,
  setActiveGameCardId,
  setActiveSaveId,
  writePlatformWorkspaceFileForSave,
  writeWorkspaceFileForSave,
  type LocalGameCardRecord,
  type LocalSaveRecord,
  type RuntimeWorkspaceTransaction,
  WorkspaceStorageError,
} from "../storage"

export const runtimeEngine = new LocalRuntimeEngine()
const baseBridge = createPlayFrontendBridge(runtimeEngine)

let platformHostReady = false
let resolvePlatformHostReady: (() => void) | null = null
const platformHostReadyPromise = new Promise<void>((resolve) => {
  resolvePlatformHostReady = resolve
})

let previousTurnController: AbortController | null = null

const AIRP_HISTORY_TURN_SCHEMA = "tsian.airp.history.turn.v1"
const AIRP_HISTORY_TURN_PATH_PREFIX = "save/history/turns/"
const AGENT_SESSION_TRANSCRIPT_MEDIA_TYPE = "application/x-ndjson"

export interface PlatformWorkspaceRootEntry {
  cardId: string
  title: string
  summary: string
  source: string
  contentFileCount: number
  saveCount: number
  updatedAt: number
}

export interface PlatformGameCardFrontendFileSummary {
  path: string
  mediaType: string
  size: number
  updatedAt: number
}

export interface PlatformStudioSnapshot {
  card: LocalGameCardRecord
  activeSaveId?: string
  usingSaveContext: boolean
  agents: AgentRegistryEntry[]
  skills: SkillRegistryEntry[]
  assistant?: {
    agentId: string
    summary: string
    agent?: AgentRegistryEntry
  }
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

export interface PlatformStudioAgentFileWriteInput {
  agentId: string
  fileName: "AGENT.md" | "SOUL.md"
  content: string
}

export interface PlatformStudioAgentSkillToggleInput {
  agentId: string
  skillPath: string
  enabled: boolean
}

export interface PlatformStudioAgentPlatformToolToggleInput {
  agentId: string
  tool: AgentPlatformToolName
  enabled: boolean
}

export interface PlatformStudioAgentWorkspaceAccessInput {
  agentId: string
  level: number
}

interface StudioSaveSlot {
  alias: string
  saveId: string
}

interface StudioWorkspaceContext {
  card: NonNullable<Awaited<ReturnType<typeof getLocalGameCard>>>
  saveSlots: StudioSaveSlot[]
}

type StudioResolvedPath =
  | {
      scope: "card-content"
      displayPath: string
      storagePath: string
    }
  | {
      scope: "save-runtime"
      displayPath: string
      storagePath: string
      saveId: string
      alias: string
    }

interface RawAirpHistoryTurnRecord {
  schema: typeof AIRP_HISTORY_TURN_SCHEMA
  turn: number
  createdAt: string
  source: {
    kind: "agent-runtime"
    masterAgentId: "master"
    narrativeAgentId: "narrative"
  }
  messages: ConversationMessageRecord[]
}

function markPlatformHostReady() {
  if (platformHostReady) {
    return
  }
  platformHostReady = true
  resolvePlatformHostReady?.()
  resolvePlatformHostReady = null
}

export async function waitForPlatformHostReady(): Promise<void> {
  if (platformHostReady) {
    return
  }
  await platformHostReadyPromise
}

function cloneSnapshot(snapshot: RuntimeSnapshotShell): RuntimeSnapshotShell {
  return JSON.parse(JSON.stringify(snapshot)) as RuntimeSnapshotShell
}

function normalizeMessageContent(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function snapshotWithTurnAndMessages(
  snapshot: RuntimeSnapshotShell,
  turn: number,
  messages: ConversationMessageRecord[],
): RuntimeSnapshotShell {
  return {
    ...snapshot,
    state: {
      ...snapshot.state,
      turn,
      messages,
      globals: snapshot.state.globals ?? {},
    },
  }
}

function actionError(
  code: string,
  message: string,
  details?: Record<string, string | number | boolean | null>,
) {
  const error: PlatformActionError = { code, message }
  if (details && Object.keys(details).length > 0) {
    error.details = details
  }

  return {
    ok: false as const,
    error,
  }
}

function workspaceActionError(error: unknown, fallbackCode: string, fallbackMessage: string) {
  if (error instanceof WorkspaceStorageError) {
    return actionError(error.code, error.message)
  }

  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    return actionError(error.code, error.message)
  }

  return actionError(
    fallbackCode,
    fallbackMessage,
    error instanceof Error ? { reason: error.message } : undefined,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isWorkspaceFile(value: unknown): value is WorkspaceFile {
  return isRecord(value)
    && typeof value.path === "string"
    && typeof value.content === "string"
    && typeof value.mediaType === "string"
    && typeof value.createdAt === "number"
    && typeof value.updatedAt === "number"
}

function isWorkspaceDeleteResult(value: unknown): value is { deletedPaths: string[] } {
  return isRecord(value)
    && Array.isArray(value.deletedPaths)
    && value.deletedPaths.every((path) => typeof path === "string")
}

function syncWorkspaceFileWrite(
  workspaceFiles: WorkspaceFile[],
  item: WorkspaceFile,
): void {
  const existingIndex = workspaceFiles.findIndex((file) => file.path === item.path)
  if (existingIndex >= 0) {
    workspaceFiles[existingIndex] = item
  } else {
    workspaceFiles.push(item)
    workspaceFiles.sort((left, right) => left.path.localeCompare(right.path))
  }
}

function formatRawAirpHistoryTurnPath(turn: number): string {
  return `${AIRP_HISTORY_TURN_PATH_PREFIX}turn-${String(turn).padStart(6, "0")}.json`
}

function serializeRawAirpHistoryTurnRecord(
  turn: number,
  createdAt: Date,
  userInput: string,
  assistantOutput: string,
): string {
  const record: RawAirpHistoryTurnRecord = {
    schema: AIRP_HISTORY_TURN_SCHEMA,
    turn,
    createdAt: createdAt.toISOString(),
    source: {
      kind: "agent-runtime",
      masterAgentId: "master",
      narrativeAgentId: "narrative",
    },
    messages: [
      { role: "user", content: userInput },
      { role: "assistant", content: assistantOutput },
    ],
  }

  return `${JSON.stringify(record, null, 2)}\n`
}

function stageRawAirpHistoryTurnFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    turn: number
    userInput: string
    assistantOutput: string
  },
): WorkspaceFile {
  const path = formatRawAirpHistoryTurnPath(input.turn)
  return workspaceTransaction.write({
    path,
    content: serializeRawAirpHistoryTurnRecord(
      input.turn,
      new Date(),
      input.userInput,
      input.assistantOutput,
    ),
    mediaType: "application/json",
  })
}

function agentSessionTranscriptPath(record: AgentSessionTranscriptRecord): string {
  const suffix = "/AGENT.md"
  if (!record.agentPath.endsWith(suffix)) {
    throw new Error(
      `Agent session transcript requires an AGENT.md path: ${record.agentPath}`,
    )
  }

  return `save/${record.agentPath.slice(0, -suffix.length)}/session.jsonl`
}

function appendJsonlRecords(
  currentContent: string,
  records: AgentSessionTranscriptRecord[],
): string {
  const prefix = currentContent && !currentContent.endsWith("\n")
    ? `${currentContent}\n`
    : currentContent
  return `${prefix}${records.map((record) => JSON.stringify(record)).join("\n")}\n`
}

function stageAgentSessionTranscriptFiles(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  records: AgentSessionTranscriptRecord[],
): Array<{ path: string; recordCount: number; size: number }> {
  const recordsByPath = new Map<string, AgentSessionTranscriptRecord[]>()
  for (const record of records) {
    const path = agentSessionTranscriptPath(record)
    const existing = recordsByPath.get(path) ?? []
    existing.push(record)
    recordsByPath.set(path, existing)
  }

  const staged: Array<{ path: string; recordCount: number; size: number }> = []
  for (const [path, pathRecords] of recordsByPath.entries()) {
    const existing = workspaceTransaction.workspaceFiles.find((file) => file.path === path)
    const nextContent = appendJsonlRecords(existing?.content ?? "", pathRecords)
    const file = workspaceTransaction.write({
      path,
      content: nextContent,
      mediaType: AGENT_SESSION_TRANSCRIPT_MEDIA_TYPE,
    })
    staged.push({
      path: file.path,
      recordCount: pathRecords.length,
      size: file.content.length,
    })
  }

  return staged
}

async function activeSaveExists(saveId: string): Promise<boolean> {
  return (await listLocalSaves()).some((save) => save.id === saveId)
}

async function gameCardForSave(save: LocalSaveRecord): Promise<LocalGameCardRecord | null> {
  if (!save.gameCardId) {
    return getBuiltinBlankGameCard()
  }

  return getLocalGameCard(save.gameCardId)
}

async function gameCardForSaveId(saveId: string): Promise<LocalGameCardRecord | null> {
  const save = (await listLocalSaves()).find((item) => item.id === saveId)
  return save ? gameCardForSave(save) : null
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

async function ensureActiveGameCardId(saves?: LocalSaveRecord[]): Promise<string> {
  const existingId = await getActiveGameCardId()
  if (existingId && await getLocalGameCard(existingId)) {
    return existingId
  }

  const activeSaveId = await getActiveSaveId()
  const knownSaves = saves ?? await listLocalSaves()
  const activeSave = activeSaveId
    ? knownSaves.find((save) => save.id === activeSaveId)
    : undefined
  const sourceSave = activeSave ?? knownSaves[0]
  const card = sourceSave
    ? await gameCardForSave(sourceSave)
    : await getBuiltinBlankGameCard()
  const cardId = card?.id ?? (await getBuiltinBlankGameCard()).id
  await setActiveGameCardId(cardId)
  return cardId
}

async function ensureActiveSave(): Promise<string> {
  const activeSaveId = await getActiveSaveId()
  if (activeSaveId && await activeSaveExists(activeSaveId)) {
    await syncActiveGameCardFromSave(activeSaveId)
    return activeSaveId
  }

  const created = await createLocalSave()
  await setActiveSaveId(created.id)
  await setActiveGameCardId(created.gameCardId ?? (await getBuiltinBlankGameCard()).id)
  runtimeEngine.loadSnapshot(await getSnapshotForSave(created.id))
  return created.id
}

async function restoreActiveSnapshotFromStorage(saveId: string): Promise<RuntimeSnapshotShell> {
  const snapshot = await getSnapshotForSave(saveId)
  runtimeEngine.loadSnapshot(snapshot)
  return snapshot
}

async function listEffectiveWorkspaceFilesForActiveSave(saveId: string): Promise<WorkspaceFile[]> {
  const sourceCard = await gameCardForSaveId(saveId)
  if (!sourceCard) {
    return []
  }

  await initializeWorkspaceForSave(saveId)
  return listEffectiveWorkspaceFilesForSave(saveId, sourceCard)
}

function workspaceStudioError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.code = code
  return error
}

function normalizeStudioDirectoryPath(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return ""
  }

  const path = normalizeWorkspaceFilePath(value)
  return path
}

function cardContentFilesToWorkspaceFiles(
  card: NonNullable<Awaited<ReturnType<typeof getLocalGameCard>>>,
): WorkspaceFile[] {
  return card.contentFiles.map((file) => ({
    path: file.path,
    content: file.content,
    mediaType: file.mediaType ?? "text/plain",
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  }))
}

function formatStudioSaveDirectoryName(index: number): string {
  return `save-${String(index + 1).padStart(2, "0")}`
}

async function loadStudioWorkspaceContext(cardId: string): Promise<StudioWorkspaceContext> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  const saves = (await listLocalSaves())
    .filter((save) => save.gameCardId === card.manifest.id)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))

  return {
    card,
    saveSlots: saves.map((save, index) => ({
      alias: formatStudioSaveDirectoryName(index),
      saveId: save.id,
    })),
  }
}

async function listStudioWorkspaceFilesForGameCard(cardId: string): Promise<WorkspaceFile[]> {
  const { card, saveSlots } = await loadStudioWorkspaceContext(cardId)
  const files: WorkspaceFile[] = cardContentFilesToWorkspaceFiles(card)

  for (const saveSlot of saveSlots) {
    await initializeWorkspaceForSave(saveSlot.saveId)

    for (const file of await listWorkspaceFilesForSave(saveSlot.saveId)) {
      if (!file.path.startsWith("save/")) {
        continue
      }

      files.push({
        ...file,
        path: `save/${saveSlot.alias}/${file.path.slice("save/".length)}`,
      })
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function resolveStudioWorkspacePath(
  context: StudioWorkspaceContext,
  pathInput: unknown,
): StudioResolvedPath {
  const displayPath = normalizeWorkspaceFilePath(pathInput)
  if (displayPath === ".tsian" || displayPath.startsWith(".tsian/")) {
    throw workspaceStudioError(
      "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
      "资源管理器不能打开 .tsian 平台元数据。",
    )
  }

  if (displayPath === "save" || displayPath.startsWith("save/")) {
    const segments = displayPath.split("/")
    const alias = segments[1]
    if (!alias) {
      throw workspaceStudioError(
        "WORKSPACE_SAVE_SLOT_REQUIRED",
        "需要先进入 save/ 下的具体存档槽，才能打开或编辑存档运行时文件。",
      )
    }

    const saveSlot = context.saveSlots.find((candidate) => candidate.alias === alias)
    if (!saveSlot) {
      throw workspaceStudioError(
        "WORKSPACE_SAVE_SLOT_NOT_FOUND",
        `这张游戏卡工作区中不存在存档槽 "${alias}"。`,
      )
    }

    const relativePath = segments.slice(2).join("/")
    if (!relativePath) {
      throw workspaceStudioError(
        "WORKSPACE_VIRTUAL_DIRECTORY_NOT_FILE",
        `路径 "${displayPath}" 是虚拟存档槽目录，不是文件。`,
      )
    }

    return {
      scope: "save-runtime",
      displayPath,
      storagePath: `save/${relativePath}`,
      saveId: saveSlot.saveId,
      alias,
    }
  }

  return {
    scope: "card-content",
    displayPath,
    storagePath: displayPath,
  }
}

function storageFileToStudioFile(file: WorkspaceFile, resolvedPath: StudioResolvedPath): WorkspaceFile {
  return {
    ...file,
    path: resolvedPath.displayPath,
  }
}

function storagePathToStudioPath(path: string, resolvedPath: StudioResolvedPath): string {
  if (resolvedPath.scope === "card-content") {
    return path
  }

  if (path === "save") {
    return `save/${resolvedPath.alias}`
  }

  return `save/${resolvedPath.alias}/${path.slice("save/".length)}`
}

function assertCompatibleStudioMove(
  source: StudioResolvedPath,
  target: StudioResolvedPath,
): void {
  if (source.scope !== target.scope) {
    throw workspaceStudioError(
      "WORKSPACE_MOVE_SCOPE_MISMATCH",
      "重命名不能跨越游戏卡内容与存档运行时边界。",
    )
  }

  if (
    source.scope === "save-runtime"
    && target.scope === "save-runtime"
    && source.saveId !== target.saveId
  ) {
    throw workspaceStudioError(
      "WORKSPACE_MOVE_SAVE_SLOT_MISMATCH",
      "重命名不能跨越不同的存档槽。",
    )
  }
}

function normalizeWorkspaceActionRequest(
  request: PlatformActionRequest,
): WorkspaceOperationRequest | null {
  if (!request.action.startsWith("workspace.")) {
    return null
  }

  const params = isRecord(request.params) ? request.params : {}
  const operation = request.action.slice("workspace.".length)
  return {
    ...params,
    operation,
    scope: params.scope ?? (
      operation === "read" || operation === "list" || operation === "search"
        ? "effective"
        : "save-runtime"
    ),
  } as WorkspaceOperationRequest
}

function normalizeContentMediaType(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
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

async function writeCardContentFileForCard(
  cardId: string,
  input: {
    path: string
    content: string
    mediaType?: string
  },
): Promise<WorkspaceFile> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  const now = Date.now()
  const existing = card.contentFiles.find((file) => file.path === input.path)
  const contentFiles = card.contentFiles
    .filter((file) => file.path !== input.path)
    .concat({
      path: input.path,
      content: input.content,
      ...(normalizeContentMediaType(input.mediaType ?? existing?.mediaType)
        ? { mediaType: normalizeContentMediaType(input.mediaType ?? existing?.mediaType) }
        : {}),
    })
    .sort((left, right) => left.path.localeCompare(right.path))

  await putLocalGameCard({
    manifest: card.manifest,
    contentFiles,
    source: card.source,
  })

  return {
    path: input.path,
    content: input.content,
    mediaType: normalizeContentMediaType(input.mediaType ?? existing?.mediaType) ?? "text/plain",
    createdAt: card.createdAt,
    updatedAt: now,
  }
}

async function writeCardContentFileForActiveCard(input: {
  path: string
  content: string
  mediaType?: string
}): Promise<WorkspaceFile> {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。")
  }

  const now = Date.now()
  const existing = activeCard.contentFiles.find((file) => file.path === input.path)
  const contentFiles = activeCard.contentFiles
    .filter((file) => file.path !== input.path)
    .concat({
      path: input.path,
      content: input.content,
      ...(normalizeContentMediaType(input.mediaType ?? existing?.mediaType)
        ? { mediaType: normalizeContentMediaType(input.mediaType ?? existing?.mediaType) }
        : {}),
    })
    .sort((left, right) => left.path.localeCompare(right.path))

  await putLocalGameCard({
    manifest: activeCard.manifest,
    contentFiles,
    source: activeCard.source,
  })

  return {
    path: input.path,
    content: input.content,
    mediaType: normalizeContentMediaType(input.mediaType ?? existing?.mediaType) ?? "text/plain",
    createdAt: activeCard.createdAt,
    updatedAt: now,
  }
}

async function deleteCardContentPathForCard(
  cardId: string,
  path: string,
): Promise<{ scope: WorkspaceScope; deletedPaths: string[] }> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  const prefix = `${path}/`
  const deletedPaths = card.contentFiles
    .filter((file) => file.path === path || file.path.startsWith(prefix))
    .map((file) => file.path)
    .sort()
  if (deletedPaths.length === 0) {
    return {
      scope: "card-content",
      deletedPaths: [],
    }
  }

  const deleted = new Set(deletedPaths)
  await putLocalGameCard({
    manifest: card.manifest,
    contentFiles: card.contentFiles.filter((file) => !deleted.has(file.path)),
    source: card.source,
  })

  return {
    scope: "card-content",
    deletedPaths,
  }
}

async function deleteCardContentPathForActiveCard(
  path: string,
): Promise<{ scope: WorkspaceScope; deletedPaths: string[] }> {
  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。")
  }

  const prefix = `${path}/`
  const deletedPaths = activeCard.contentFiles
    .filter((file) => file.path === path || file.path.startsWith(prefix))
    .map((file) => file.path)
    .sort()
  if (deletedPaths.length === 0) {
    return {
      scope: "card-content",
      deletedPaths: [],
    }
  }

  const deleted = new Set(deletedPaths)
  await putLocalGameCard({
    manifest: activeCard.manifest,
    contentFiles: activeCard.contentFiles.filter((file) => !deleted.has(file.path)),
    source: activeCard.source,
  })

  return {
    scope: "card-content",
    deletedPaths,
  }
}

async function executeWorkspaceOperationForActiveSave(
  saveId: string,
  request: WorkspaceOperationRequest,
  input: {
    actorLevel?: number
    agentContext?: AgentContextEntry
    exposedOperations?: Iterable<WorkspaceOperationName>
    workspaceTransaction?: RuntimeWorkspaceTransaction
  },
): Promise<unknown> {
  const workspaceFiles = input.workspaceTransaction?.workspaceFiles
    ?? await listEffectiveWorkspaceFilesForActiveSave(saveId)

  return executeWorkspaceOperation(request, {
    workspaceFiles,
    actorLevel: input.actorLevel,
    agentContext: input.agentContext,
    exposedOperations: input.exposedOperations ?? AUTHORING_WORKSPACE_OPERATIONS,
    mutations: {
      async write(writeInput) {
        if (input.workspaceTransaction) {
          if (writeInput.scope === "platform-meta") {
            return input.workspaceTransaction.writePlatformFile({
              path: writeInput.path,
              content: writeInput.content,
              mediaType: writeInput.mediaType,
            })
          }
          if (writeInput.scope === "save-runtime") {
            return input.workspaceTransaction.write({
              path: writeInput.path,
              content: writeInput.content,
              mediaType: writeInput.mediaType,
            })
          }
          throw new Error("Runtime turn staging cannot mutate card-content.")
        }

        if (writeInput.scope === "card-content") {
          return writeCardContentFileForActiveCard(writeInput)
        }
        if (writeInput.scope === "platform-meta") {
          return writePlatformWorkspaceFileForSave(saveId, {
            path: writeInput.path,
            content: writeInput.content,
            mediaType: writeInput.mediaType,
          })
        }
        return writeWorkspaceFileForSave(saveId, {
          path: writeInput.path,
          content: writeInput.content,
          mediaType: writeInput.mediaType,
        })
      },
      async delete(deleteInput) {
        if (input.workspaceTransaction) {
          if (deleteInput.scope !== "save-runtime") {
            throw new Error("Runtime turn staging can only delete save-runtime paths.")
          }
          return {
            scope: deleteInput.scope,
            ...input.workspaceTransaction.delete(deleteInput.path),
          }
        }

        if (deleteInput.scope === "card-content") {
          return deleteCardContentPathForActiveCard(deleteInput.path)
        }
        if (deleteInput.scope === "platform-meta") {
          throw new Error("Platform metadata delete is not supported yet.")
        }
        return {
          scope: deleteInput.scope,
          ...await deleteWorkspacePathForSave(saveId, deleteInput.path),
        }
      },
    },
  })
}

async function executePlatformAction(
  request: PlatformActionRequest,
): Promise<PlatformActionResult> {
  if (request.action === "restore-checkpoint") {
    const activeSaveId = await getActiveSaveId()
    if (!activeSaveId) {
      return actionError(
        "ACTIVE_SAVE_REQUIRED",
        "当前没有激活中的会话。",
      )
    }

    const checkpointId = request.params?.checkpointId
    if (typeof checkpointId !== "string" || !checkpointId.trim()) {
      return actionError(
        "CHECKPOINT_ID_REQUIRED",
        "restore-checkpoint 需要非空 checkpointId。",
      )
    }

    const snapshot = await restoreCheckpointForSave(activeSaveId, checkpointId.trim())
    if (!snapshot) {
      return actionError(
        "CHECKPOINT_NOT_FOUND",
        "指定的 checkpoint 不存在。",
        { checkpointId: checkpointId.trim() },
      )
    }

    runtimeEngine.loadSnapshot(snapshot)
    return {
      ok: true,
      item: snapshot,
    }
  }

  const workspaceRequest = normalizeWorkspaceActionRequest(request)
  if (workspaceRequest) {
    const activeSaveId = await getActiveSaveId()
    if (!activeSaveId) {
      return actionError(
        "ACTIVE_SAVE_REQUIRED",
        "当前没有激活中的会话。",
      )
    }

    try {
      return {
        ok: true,
        item: await executeWorkspaceOperationForActiveSave(activeSaveId, workspaceRequest, {
          actorLevel: 1,
        }),
      }
    } catch (error) {
      return workspaceActionError(
        error,
        "WORKSPACE_OPERATION_FAILED",
        "执行 workspace 操作失败。",
      )
    }
  }

  return actionError(
    "UNSUPPORTED_PLATFORM_ACTION",
    `不支持的平台动作：${request.action}`,
    { action: request.action },
  )
}

function emitWorkspaceMutationTrace(
  emitTrace: RuntimeTraceEmitter | undefined,
  request: PlatformActionRequest,
  result: PlatformActionResult,
): void {
  if (!request.action.startsWith("workspace.")) {
    return
  }

  if (!result.ok) {
    emitTrace?.({
      type: "workspace_mutation",
      ok: false,
      data: {
        platformAction: request.action,
        error: result.error ?? null,
      },
    })
    return
  }

  const item = result.item
  if (
    (request.action === "workspace.write" || request.action === "workspace.patch")
    && isRecord(item)
    && isWorkspaceFile(item.file)
  ) {
    emitTrace?.({
      type: "workspace_mutation",
      ok: true,
      data: {
        platformAction: request.action,
        mutation: request.action === "workspace.patch" ? "patch" : "write",
        path: item.file.path,
        mediaType: item.file.mediaType,
        size: item.file.content.length,
        updatedAt: item.file.updatedAt,
      },
    })
    return
  }

  if (request.action === "workspace.delete" && isWorkspaceDeleteResult(item)) {
    emitTrace?.({
      type: "workspace_mutation",
      ok: true,
      data: {
        platformAction: request.action,
        mutation: "delete",
        deletedPaths: item.deletedPaths,
        deletedCount: item.deletedPaths.length,
      },
    })
  }
}

async function runAgentRuntimeStagedPlatformAction(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  activeSaveId: string,
  request: PlatformActionRequest,
  executorContext: RuntimeControlledExecutorContext | undefined,
): Promise<PlatformActionResult> {
  const workspaceRequest = normalizeWorkspaceActionRequest(request)
  if (!workspaceRequest) {
    return actionError(
      "AGENT_RUNTIME_PLATFORM_ACTION_UNSUPPORTED",
      `Agent Runtime 不允许调用平台动作：${request.action}`,
      { action: request.action },
    )
  }

  try {
    return {
      ok: true,
      item: await executeWorkspaceOperationForActiveSave(activeSaveId, workspaceRequest, {
        agentContext: executorContext?.agentContext,
        exposedOperations: executorContext?.exposedWorkspaceOperations ?? [],
        workspaceTransaction,
      }),
    }
  } catch (error) {
    return workspaceActionError(
      error,
      "WORKSPACE_OPERATION_FAILED",
      "执行 workspace 操作失败。",
    )
  }
}

function createAgentRuntimePlatformActionRunner(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  activeSaveId: string,
  emitTrace?: RuntimeTraceEmitter,
) {
  return async (
    request: PlatformActionRequest,
    executorContext?: RuntimeControlledExecutorContext,
  ): Promise<PlatformActionResult> => {
    const result = await runAgentRuntimeStagedPlatformAction(
      workspaceTransaction,
      activeSaveId,
      request,
      executorContext,
    )
    emitWorkspaceMutationTrace(emitTrace, request, result)
    return result
  }
}

async function writeRuntimeTraceFileForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
  path: string,
  events: ReturnType<typeof createRuntimeTraceCollector>["events"],
): Promise<void> {
  const file = await writePlatformWorkspaceFileForSave(saveId, {
    path,
    content: serializeRuntimeTraceEvents(events),
    mediaType: "application/x-ndjson",
  })
  syncWorkspaceFileWrite(workspaceFiles, file)
}

function stageRuntimeTraceFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  path: string,
  events: ReturnType<typeof createRuntimeTraceCollector>["events"],
): WorkspaceFile {
  return workspaceTransaction.writePlatformFile({
    path,
    content: serializeRuntimeTraceEvents(events),
    mediaType: "application/x-ndjson",
  })
}

function normalizeRuntimeDiagnosticsQueryParams(
  params: Record<string, unknown> | undefined,
): RuntimeDiagnosticsQueryParams {
  return {
    ...(typeof params?.turn === "number" && Number.isFinite(params.turn)
      ? { turn: params.turn }
      : {}),
    ...(typeof params?.limit === "number" && Number.isFinite(params.limit)
      ? { limit: params.limit }
      : {}),
    ...(typeof params?.lookbackTurns === "number" && Number.isFinite(params.lookbackTurns)
      ? { lookbackTurns: params.lookbackTurns }
      : {}),
    ...(typeof params?.includeHealth === "boolean"
      ? { includeHealth: params.includeHealth }
      : {}),
  }
}

function formatActiveFrontendId(frontend: GameCardFrontendBinding | undefined): string | undefined {
  if (!frontend) {
    return undefined
  }

  if (frontend.kind === "remote") {
    return frontend.url
  }

  return frontend.entry
}

export const playFrontendBridge: PlayFrontendBridge = {
  runtime: baseBridge.runtime,
  platform: {
    async getPlatformContext() {
      const activeCard = await getPlatformActiveGameCard()
      return {
        version: "0.0.0",
        activeFrontendId: formatActiveFrontendId(activeCard?.manifest.frontend),
        activeSaveId: (await getActiveSaveId()) ?? undefined,
      }
    },

    async runAction(request) {
      return executePlatformAction(request)
    },
  },
  query: {
    async query<T = unknown>(request: DeepQueryRequest) {
      const activeSaveId = await getActiveSaveId()

      if (request.resource === "history") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: (await getHistoryForSave(activeSaveId)) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "checkpoints") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: (await listCheckpointsForSave(activeSaveId)) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "workspace.list") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        try {
          return {
            items: [await executeWorkspaceOperationForActiveSave(activeSaveId, {
              operation: "list",
              scope: "effective",
              ...(typeof request.params?.path === "string"
                ? { path: request.params.path }
                : {}),
            }, {
              actorLevel: 1,
            })] as T[],
          } as DeepQueryResult<T>
        } catch {
          return { items: [] } as DeepQueryResult<T>
        }
      }

      if (request.resource === "workspace.read") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        try {
          return {
            items: [await executeWorkspaceOperationForActiveSave(activeSaveId, {
              operation: "read",
              scope: typeof request.params?.scope === "string"
                ? request.params.scope
                : "effective",
              path: request.params?.path,
            } as WorkspaceOperationRequest, {
              actorLevel: 1,
            })] as T[],
          } as DeepQueryResult<T>
        } catch {
          return { items: [] } as DeepQueryResult<T>
        }
      }

      if (request.resource === "workspace.search") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: await executeWorkspaceOperationForActiveSave(activeSaveId, {
            operation: "search",
            scope: typeof request.params?.scope === "string"
              ? request.params.scope
              : "effective",
            query:
              typeof request.params?.query === "string"
                ? request.params.query
                : undefined,
            limit:
              typeof request.params?.limit === "number"
                ? request.params.limit
                : undefined,
          } as WorkspaceOperationRequest, {
            actorLevel: 1,
          }) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "agent-registry") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const files = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
        return {
          items: buildAgentRegistry(files) as AgentRegistryEntry[] as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "agent-context") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const agentId =
          typeof request.params?.agentId === "string" && request.params.agentId.trim()
            ? request.params.agentId.trim()
            : undefined
        if (!agentId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const files = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
        const context = assembleAgentContext(files, { agentId })
        return {
          items: (context ? [context] : []) as AgentContextEntry[] as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "skill-registry") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const agentId =
          typeof request.params?.agentId === "string" && request.params.agentId.trim()
            ? request.params.agentId.trim()
            : undefined
        const includeShared =
          typeof request.params?.includeShared === "boolean"
            ? request.params.includeShared
            : undefined
        const includeLocal =
          typeof request.params?.includeLocal === "boolean"
            ? request.params.includeLocal
            : undefined

        const files = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
        return {
          items: buildSkillRegistry(files, {
            agentId,
            includeShared,
            includeLocal,
          }) as SkillRegistryEntry[] as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "skill-detail") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        try {
          const path = normalizeWorkspaceFilePath(request.params?.path)
          const files = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
          const detail = loadSkillDetail(files, path)
          return {
            items: (detail ? [detail] : []) as SkillDetailEntry[] as T[],
          } as DeepQueryResult<T>
        } catch {
          return { items: [] } as DeepQueryResult<T>
        }
      }

      if (request.resource === "runtime-diagnostics") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const files = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
        return {
          items: buildRuntimeDiagnostics(
            files,
            normalizeRuntimeDiagnosticsQueryParams(request.params),
          ) as RuntimeDiagnosticSummary[] as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "ai-debug") {
        return {
          items: getAiDebugRecords() as T[],
        } as DeepQueryResult<T>
      }

      return baseBridge.query.query(request)
    },
  },
  interaction: {
    async sendMessage(input) {
      const content = normalizeMessageContent(input.content)
      if (!content) {
        throw new Error("interaction.sendMessage requires non-empty content.")
      }

      const activeSaveId = await ensureActiveSave()
      const snapshotBefore = cloneSnapshot(await getSnapshotForSave(activeSaveId))
      const historyBefore = await getHistoryForSave(activeSaveId)
      const nextTurn = snapshotBefore.state.turn + 1
      const trace = createRuntimeTraceCollector(nextTurn)
      trace.emit({
        type: "turn_started",
        ok: true,
        data: {
          userInputLength: content.length,
          historyCount: historyBefore.length,
        },
      })
      let workspaceTransaction: RuntimeWorkspaceTransaction | null = null

      if (previousTurnController) {
        previousTurnController.abort("new-turn-started")
      }
      const currentController = new AbortController()
      previousTurnController = currentController

      try {
        workspaceTransaction = createRuntimeWorkspaceTransaction(
          await listEffectiveWorkspaceFilesForActiveSave(activeSaveId),
        )
        const activeWorkspaceTransaction = workspaceTransaction
        const result = await runAgentRuntimeTurn(
          {
            agentId: "master",
            userInput: content,
            recentHistory: historyBefore,
            snapshot: snapshotBefore,
            workspaceFiles: workspaceTransaction.workspaceFiles,
            signal: currentController.signal,
          },
          {
            callModel(messages, options) {
              return generateAssistantReply(messages, {
                debugLabel: options.debugLabel,
                signal: options.signal,
              })
            },
            runPlatformAction: createAgentRuntimePlatformActionRunner(
              activeWorkspaceTransaction,
              activeSaveId,
              trace.emit,
            ),
            runBrowserScript: createBrowserSkillScriptRunner({
              workspaceTransaction: activeWorkspaceTransaction,
              signal: currentController.signal,
              emitTrace: trace.emit,
            }),
            workspaceMutations: {
              write: (writeInput) => {
                if (writeInput.scope === "platform-meta") {
                  return activeWorkspaceTransaction.writePlatformFile({
                    path: writeInput.path,
                    content: writeInput.content,
                    mediaType: writeInput.mediaType,
                  })
                }
                if (writeInput.scope !== "save-runtime") {
                  throw new Error("Runtime Agent turns can only stage save-runtime workspace writes.")
                }
                return activeWorkspaceTransaction.write({
                  path: writeInput.path,
                  content: writeInput.content,
                  mediaType: writeInput.mediaType,
                })
              },
              delete: (deleteInput) => {
                if (deleteInput.scope !== "save-runtime") {
                  throw new Error("Runtime Agent turns can only stage save-runtime workspace deletes.")
                }
                return {
                  scope: deleteInput.scope,
                  ...activeWorkspaceTransaction.delete(deleteInput.path),
                }
              },
            },
            emitTrace: trace.emit,
          },
        )

        if (currentController.signal.aborted) {
          throw new DOMException("Agent Runtime turn was aborted.", "AbortError")
        }

        const nextHistory: ConversationMessageRecord[] = [
          ...historyBefore,
          { role: "user", content },
          { role: "assistant", content: result.replyText },
        ]
        const snapshotAfter = snapshotWithTurnAndMessages(
          snapshotBefore,
          nextTurn,
          nextHistory,
        )

        stageRawAirpHistoryTurnFile(workspaceTransaction, {
          turn: nextTurn,
          userInput: content,
          assistantOutput: result.replyText,
        })
        const transcriptWrites = stageAgentSessionTranscriptFiles(
          workspaceTransaction,
          result.agentSessionTranscripts,
        )
        trace.emit({
          type: "agent_session_transcripts_staged",
          ok: true,
          data: {
            recordCount: result.agentSessionTranscripts.length,
            fileCount: transcriptWrites.length,
            files: transcriptWrites,
          },
        })

        trace.emit({
          type: "turn_completed",
          ok: true,
          data: {
            replyLength: result.replyText.length,
            historyCount: nextHistory.length,
          },
        })
        stageRuntimeTraceFile(
          workspaceTransaction,
          formatRuntimeTracePath(nextTurn),
          trace.events,
        )

        runtimeEngine.loadSnapshot(snapshotAfter)
        await commitSuccessfulRuntimeTurnForSave(activeSaveId, {
          snapshot: snapshotAfter,
          history: nextHistory,
          workspaceFiles: workspaceTransaction.finalWorkspaceFiles(),
          checkpointReason: "after-turn",
        })

        emitTurnDebugReady(snapshotAfter.state.turn)
        return { snapshot: snapshotAfter }
      } catch (error) {
        runtimeEngine.loadSnapshot(snapshotBefore)
        workspaceTransaction?.discard()
        trace.emit({
          type: "turn_failed",
          ok: false,
          data: errorToTraceData(error),
        })
        if (workspaceTransaction) {
          try {
            await writeRuntimeTraceFileForSave(
              activeSaveId,
              workspaceTransaction.workspaceFiles,
              formatRuntimeTracePath(nextTurn, Date.now()),
              trace.events,
            )
          } catch {
            // Failed-turn trace is best-effort and must not mask the original error.
          }
        }
        throw error
      } finally {
        if (previousTurnController === currentController) {
          previousTurnController = null
        }
      }
    },
  },
  debug: createDebugBridge(),
}

export interface AssistantChatInput {
  message: string
  history?: ConversationMessageRecord[]
  mode?: "local" | "card"
}

export interface AssistantChatResult {
  replyText: string
}

const LOCAL_ASSISTANT_AGENT_ID = "studio-assistant"

/**
 * Runs a desktop Assistant chat turn against the currently loaded Game Card.
 * Unlike the AIRP play turn, this does not increment the turn counter,
 * create checkpoints, or stage AIRP history. It runs a single agent runtime
 * turn for Q&A and workspace assistance.
 */
export async function runAssistantChat(
  input: AssistantChatInput,
): Promise<AssistantChatResult> {
  await waitForPlatformHostReady()

  const content = normalizeMessageContent(input.message)
  if (!content) {
    throw new Error("Assistant chat requires non-empty message.")
  }

  const activeCard = await getPlatformActiveGameCard()
  if (!activeCard) {
    throw new Error("当前没有激活中的游戏卡。请在我的应用中选择一张游戏卡。")
  }

  const mode = input.mode ?? "local"
  const history = input.history ?? []

  // Resolve assistant agent ID based on mode.
  let agentId: string
  if (mode === "card" && activeCard.manifest.assistant?.agentId) {
    agentId = activeCard.manifest.assistant.agentId
  } else {
    agentId = LOCAL_ASSISTANT_AGENT_ID
  }

  // Build effective workspace files from card content (+ save if active).
  const activeSaveId = await getActiveSaveId()
  let workspaceFiles: WorkspaceFile[]
  if (activeSaveId) {
    workspaceFiles = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
  } else {
    // No active save: use card content only.
    workspaceFiles = activeCard.contentFiles.map((file) => ({
      path: file.path,
      content: typeof file.content === "string" ? file.content : "",
      mediaType: file.mediaType ?? "text/plain",
      createdAt: activeCard.updatedAt,
      updatedAt: activeCard.updatedAt,
    }))
  }

  // Ensure local assistant files exist in the workspace.
  workspaceFiles = ensureLocalAssistantFiles(workspaceFiles)

  const controller = new AbortController()
  const workspaceTransaction = createRuntimeWorkspaceTransaction(workspaceFiles)
  const activeWorkspaceTransaction = workspaceTransaction

  try {
    const result = await runAgentRuntimeTurn(
      {
        agentId,
        userInput: content,
        recentHistory: history,
        snapshot: { version: "tsian.runtime.snapshot.v1", state: { turn: 0, messages: [] } },
        workspaceFiles: workspaceTransaction.workspaceFiles,
        signal: controller.signal,
      },
      {
        callModel(messages, options) {
          return generateAssistantReply(messages, {
            debugLabel: options.debugLabel,
            signal: options.signal,
          })
        },
        runPlatformAction: createAgentRuntimePlatformActionRunner(
          activeWorkspaceTransaction,
          activeSaveId ?? "",
          () => {},
        ),
        runBrowserScript: createBrowserSkillScriptRunner({
          workspaceTransaction: activeWorkspaceTransaction,
          signal: controller.signal,
          emitTrace: () => {},
        }),
        workspaceMutations: {
          write: (writeInput) => {
            if (writeInput.scope === "platform-meta") {
              return activeWorkspaceTransaction.writePlatformFile({
                path: writeInput.path,
                content: writeInput.content,
                mediaType: writeInput.mediaType,
              })
            }
            if (writeInput.scope === "card-content") {
              return activeWorkspaceTransaction.write({
                path: writeInput.path,
                content: writeInput.content,
                mediaType: writeInput.mediaType,
              })
            }
            if (writeInput.scope === "save-runtime") {
              return activeWorkspaceTransaction.write({
                path: writeInput.path,
                content: writeInput.content,
                mediaType: writeInput.mediaType,
              })
            }
            throw new Error(`Assistant workspace write scope not supported: ${writeInput.scope}`)
          },
          delete: (deleteInput) => {
            if (deleteInput.scope === "card-content" || deleteInput.scope === "save-runtime") {
              return {
                scope: deleteInput.scope,
                ...activeWorkspaceTransaction.delete(deleteInput.path),
              }
            }
            throw new Error(`Assistant workspace delete scope not supported: ${deleteInput.scope}`)
          },
        },
        emitTrace: () => {},
      },
    )

    // Commit workspace changes (no checkpoint, no turn increment).
    const finalFiles = activeWorkspaceTransaction.finalWorkspaceFiles()
    await commitAssistantWorkspaceFiles(activeSaveId, finalFiles)

    return { replyText: result.replyText }
  } catch (error) {
    activeWorkspaceTransaction.discard()
    throw error
  }
}

function ensureLocalAssistantFiles(files: WorkspaceFile[]): WorkspaceFile[] {
  const now = Date.now()
  const result = [...files]
  const hasLocalNotes = result.some((file) => file.path === ".tsian/local/assistant/notes.md")
  if (!hasLocalNotes) {
    result.push({
      path: ".tsian/local/assistant/notes.md",
      content: "# Assistant Notes\n\n",
      mediaType: "text/markdown",
      createdAt: now,
      updatedAt: now,
    })
  }
  return result.sort((left, right) => left.path.localeCompare(right.path))
}

async function commitAssistantWorkspaceFiles(
  saveId: string | null,
  files: WorkspaceFile[],
): Promise<void> {
  if (!saveId) {
    // No active save: persist card-content changes back to the card.
    const activeCard = await getPlatformActiveGameCard()
    if (!activeCard) {
      return
    }
    const cardFiles = files.filter((file) => !file.path.startsWith("save/") && !file.path.startsWith(".tsian/"))
    // Update card content files.
    await updateCardContentFilesForCard(activeCard.id, cardFiles)
    return
  }

  // Active save: persist save-runtime and platform-meta files.
  const saveRuntimeFiles = files
    .filter((file) => file.path.startsWith("save/") || file.path.startsWith(".tsian/"))
    .map((file) => ({
      path: file.path,
      content: file.content,
      mediaType: file.mediaType,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }))
  if (saveRuntimeFiles.length > 0) {
    await replaceWorkspaceFilesForSave(saveId, saveRuntimeFiles)
  }

  // Also persist card-content changes (from knowledge mount writes).
  const cardFiles = files.filter((file) => !file.path.startsWith("save/") && !file.path.startsWith(".tsian/"))
  if (cardFiles.length > 0) {
    const activeCard = await getPlatformActiveGameCard()
    if (activeCard) {
      await updateCardContentFilesForCard(activeCard.id, cardFiles)
    }
  }
}

async function updateCardContentFilesForCard(
  cardId: string,
  files: WorkspaceFile[],
): Promise<void> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    return
  }
  const filesByPath = new Map(card.contentFiles.map((file) => [file.path, file]))
  for (const file of files) {
    filesByPath.set(file.path, {
      path: file.path,
      content: file.content,
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    })
  }
  const contentFiles = Array.from(filesByPath.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  await putLocalGameCard({
    manifest: card.manifest,
    contentFiles,
    source: card.source,
  })
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
    runtimeEngine.loadSnapshot(createEmptyRuntimeSnapshot())
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
    contentFiles: card.contentFiles,
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
  const patch = metadataManifestPatch(input)
  const id = await createUniqueLocalGameCardId(patch.name)
  return putLocalGameCard({
    manifest: {
      ...card.manifest,
      ...patch,
      id,
    },
    contentFiles: card.contentFiles,
    frontendFiles: frontendFiles.map((file) => ({
      path: file.path,
      data: file.data,
      mediaType: file.mediaType,
    })),
    source: "local",
  })
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
      runtimeEngine.loadSnapshot(createEmptyRuntimeSnapshot())
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
    contentFiles: card.contentFiles,
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

export async function getPlatformActiveGameCard() {
  const activeCardId = await ensureActiveGameCardId()
  const activeCard = await getLocalGameCard(activeCardId)
  if (activeCard) {
    return activeCard
  }

  const activeSaveId = await getActiveSaveId()
  if (!activeSaveId) {
    return getBuiltinBlankGameCard()
  }

  const activeSave = (await listLocalSaves()).find((save) => save.id === activeSaveId)
  if (!activeSave) {
    return getBuiltinBlankGameCard()
  }

  return gameCardForSave(activeSave)
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
    runtimeEngine.loadSnapshot(createEmptyRuntimeSnapshot())
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

async function activeStudioWorkspaceFiles(
  card: LocalGameCardRecord,
): Promise<{
  files: WorkspaceFile[]
  activeSaveId?: string
  usingSaveContext: boolean
}> {
  const activeSaveId = await getActiveSaveId()
  const activeSave = activeSaveId
    ? (await listLocalSaves()).find((save) => save.id === activeSaveId)
    : undefined
  const activeSaveCard = activeSave ? await gameCardForSave(activeSave) : null
  if (activeSave && activeSaveCard?.id === card.id) {
    await initializeWorkspaceForSave(activeSave.id)
    return {
      files: await listEffectiveWorkspaceFilesForSave(activeSave.id, card),
      activeSaveId: activeSave.id,
      usingSaveContext: true,
    }
  }

  return {
    files: cardContentFilesToWorkspaceFiles(card),
    ...(activeSaveId ? { activeSaveId } : {}),
    usingSaveContext: false,
  }
}

export async function getPlatformStudioSnapshot(): Promise<PlatformStudioSnapshot> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agents = buildAgentRegistry(context.files)
  const skills = buildSkillRegistry(context.files)
  const assistantManifest = card.manifest.assistant
  const assistantAgent = assistantManifest
    ? agents.find((agent) => agent.id === assistantManifest.agentId)
    : undefined

  return {
    card,
    ...(context.activeSaveId ? { activeSaveId: context.activeSaveId } : {}),
    usingSaveContext: context.usingSaveContext,
    agents,
    skills,
    ...(assistantManifest
      ? {
          assistant: {
            agentId: assistantManifest.agentId,
            summary: assistantManifest.summary?.trim() || "这张游戏卡提供了一个工作室助手入口。",
            ...(assistantAgent ? { agent: assistantAgent } : {}),
          },
        }
      : {}),
  }
}

export async function getPlatformStudioAgentContext(
  agentId: string,
): Promise<AgentContextEntry | null> {
  const normalizedAgentId = agentId.trim()
  if (!normalizedAgentId) {
    return null
  }

  const card = await getPlatformActiveGameCard()
  if (!card) {
    return null
  }

  const context = await activeStudioWorkspaceFiles(card)
  return assembleAgentContext(context.files, { agentId: normalizedAgentId })
}

export async function getPlatformStudioSkillDetail(
  path: string,
): Promise<SkillDetailEntry | null> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    return null
  }

  try {
    const context = await activeStudioWorkspaceFiles(card)
    return loadSkillDetail(context.files, normalizeWorkspaceFilePath(path))
  } catch {
    return null
  }
}

function agentDirectoryFromFilePath(path: string): string {
  const suffix = "/AGENT.md"
  if (!path.endsWith(suffix)) {
    throw new Error(`Agent path must end with AGENT.md: ${path}`)
  }
  return path.slice(0, -suffix.length)
}

function soulPathForAgent(agent: AgentRegistryEntry): string {
  return `${agentDirectoryFromFilePath(agent.path)}/SOUL.md`
}

function findStudioAgent(files: WorkspaceFile[], agentId: string): AgentRegistryEntry {
  const normalizedAgentId = agentId.trim()
  const agent = buildAgentRegistry(files).find((candidate) => candidate.id === normalizedAgentId)
  if (!agent) {
    throw new Error(`Agent "${normalizedAgentId}" 不存在。`)
  }
  return agent
}

function findStudioSkill(files: WorkspaceFile[], path: string): SkillRegistryEntry {
  const normalizedPath = normalizeWorkspaceFilePath(path)
  const skill = buildSkillRegistry(files).find((candidate) => candidate.path === normalizedPath)
  if (!skill) {
    throw new Error(`Skill "${normalizedPath}" 不存在。`)
  }
  return skill
}

function normalizeSkillList(values: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const item = value.trim()
    const key = item.toLowerCase()
    if (!item || seen.has(key)) {
      continue
    }
    seen.add(key)
    normalized.push(item)
  }
  return normalized
}

function removeSkillReferences(
  values: string[],
  skill: SkillRegistryEntry,
): string[] {
  return normalizeSkillList(values)
    .filter((value) => !skillMatchesReference(skill, value))
}

function appendSkillReference(
  values: string[],
  skill: SkillRegistryEntry,
): string[] {
  return normalizeSkillList([
    ...removeSkillReferences(values, skill),
    skillMetadataReference(skill),
  ])
}

function removePlatformToolReference(
  values: AgentPlatformToolName[],
  tool: AgentPlatformToolName,
): AgentPlatformToolName[] {
  return values.filter((value) => value !== tool)
}

function appendPlatformToolReference(
  values: AgentPlatformToolName[],
  tool: AgentPlatformToolName,
): AgentPlatformToolName[] {
  return Array.from(new Set([
    ...removePlatformToolReference(values, tool),
    tool,
  ]))
}

function normalizeWorkspaceAccessLevel(value: number): number {
  if (!Number.isFinite(value)) {
    return 1
  }

  return Math.max(0, Math.min(4, Math.floor(value)))
}

function agentConfigFileForAgent(
  files: WorkspaceFile[],
  agent: AgentRegistryEntry,
): WorkspaceFile {
  const file = files.find((candidate) => candidate.path === agent.configPath)
  if (!file) {
    throw new Error(`Agent 配置文件 "${agent.configPath}" 不存在。`)
  }
  return file
}

function parseAgentConfigRecord(file: WorkspaceFile): Record<string, unknown> {
  try {
    const parsed = JSON.parse(file.content) as unknown
    if (isRecord(parsed)) {
      return parsed
    }
  } catch {
    // Fall through to the normalized error below.
  }

  throw new Error(`Agent 配置文件 "${file.path}" 不是有效 JSON 对象。`)
}

function writeAgentConfigRecord(
  cardId: string,
  agent: AgentRegistryEntry,
  config: Record<string, unknown>,
): Promise<WorkspaceFile> {
  return writeCardContentFileForCard(cardId, {
    path: agent.configPath,
    content: JSON.stringify(config, null, 2) + "\n",
    mediaType: "application/json",
  })
}

export async function writePlatformStudioAgentFile(
  input: PlatformStudioAgentFileWriteInput,
): Promise<WorkspaceFile> {
  if (typeof input.content !== "string") {
    throw new Error("文件内容必须是字符串。")
  }

  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const path = input.fileName === "AGENT.md"
    ? agent.path
    : soulPathForAgent(agent)

  return writeCardContentFileForCard(card.id, {
    path,
    content: input.content,
    mediaType: "text/markdown",
  })
}

export async function updatePlatformStudioAgentSkillEnabled(
  input: PlatformStudioAgentSkillToggleInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const skill = findStudioSkill(context.files, input.skillPath)
  if (skill.scope === "agent-local" && skill.agentId !== agent.id) {
    throw new Error("这个 Agent 不能启用其它 Agent 目录下的 Skill。")
  }

  let enabledSkills = removeSkillReferences(agent.enabledSkills, skill)
  let disabledSkills = removeSkillReferences(agent.disabledSkills, skill)

  if (input.enabled) {
    const nextAgent = {
      ...agent,
      enabledSkills,
      disabledSkills,
    }
    if (!isSkillEnabledForAgent(skill, nextAgent)) {
      enabledSkills = appendSkillReference(enabledSkills, skill)
    }
  } else {
    const nextAgent = {
      ...agent,
      enabledSkills,
      disabledSkills,
    }
    if (isSkillEnabledForAgent(skill, nextAgent)) {
      disabledSkills = appendSkillReference(disabledSkills, skill)
    }
  }

  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingSkills = isRecord(config.skills) ? config.skills : {}

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    skills: {
      ...existingSkills,
      enabled: enabledSkills,
      disabled: disabledSkills,
    },
  })
}

export async function updatePlatformStudioAgentPlatformToolEnabled(
  input: PlatformStudioAgentPlatformToolToggleInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  let enabled = removePlatformToolReference(agent.platformTools.enabled, input.tool)
  let disabled = removePlatformToolReference(agent.platformTools.disabled, input.tool)

  if (input.enabled) {
    const nextAgent = {
      ...agent,
      platformTools: {
        enabled,
        disabled,
      },
    }
    if (!isAgentPlatformToolEnabled(nextAgent, input.tool)) {
      enabled = appendPlatformToolReference(enabled, input.tool)
    }
  } else {
    const nextAgent = {
      ...agent,
      platformTools: {
        enabled,
        disabled,
      },
    }
    if (isAgentPlatformToolEnabled(nextAgent, input.tool)) {
      disabled = appendPlatformToolReference(disabled, input.tool)
    }
  }

  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingTools = isRecord(config.platformTools) ? config.platformTools : {}

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    platformTools: {
      ...existingTools,
      enabled,
      disabled,
    },
  })
}

export async function updatePlatformStudioAgentWorkspaceAccess(
  input: PlatformStudioAgentWorkspaceAccessInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)
  const existingAccess = isRecord(config.workspaceAccess) ? config.workspaceAccess : {}

  return writeAgentConfigRecord(card.id, agent, {
    ...config,
    workspaceAccess: {
      ...existingAccess,
      level: normalizeWorkspaceAccessLevel(input.level),
    },
  })
}

export async function listPlatformWorkspaceDirectory(input: {
  cardId?: string
  saveId?: string
  path?: string
} = {}): Promise<WorkspaceListResult> {
  if (input.cardId) {
    const path = normalizeStudioDirectoryPath(input.path)
    if (path === ".tsian" || path.startsWith(".tsian/")) {
      throw workspaceStudioError(
        "WORKSPACE_PLATFORM_METADATA_FORBIDDEN",
        "资源管理器不能浏览 .tsian 平台元数据。",
      )
    }

    return await executeWorkspaceOperation({
      operation: "list",
      scope: "effective",
      ...(path ? { path } : {}),
    }, {
      workspaceFiles: await listStudioWorkspaceFilesForGameCard(input.cardId),
      actorLevel: 1,
      exposedOperations: ["list"],
    }) as WorkspaceListResult
  }

  const saveId = input.saveId ?? await getActiveSaveId()
  if (!saveId) {
    return { path: "", entries: [] }
  }

  const save = (await listLocalSaves()).find((item) => item.id === saveId)
  if (!save) {
    throw new Error(`会话 "${saveId}" 不存在。`)
  }

  const sourceCard = save.gameCardId
    ? await getLocalGameCard(save.gameCardId)
    : await getBuiltinBlankGameCard()
  if (!sourceCard) {
    throw new Error(`存档 "${saveId}" 的游戏卡不存在。`)
  }

  await initializeWorkspaceForSave(saveId)

  return await executeWorkspaceOperation({
    operation: "list",
    scope: "effective",
    ...(input.path ? { path: input.path } : {}),
  }, {
    workspaceFiles: await listEffectiveWorkspaceFilesForSave(saveId, sourceCard),
    actorLevel: 1,
    exposedOperations: ["list"],
  }) as WorkspaceListResult
}

export async function listPlatformWorkspaceRoots(): Promise<PlatformWorkspaceRootEntry[]> {
  await ensureBuiltinBlankGameCard()

  const [cards, saves] = await Promise.all([
    listLocalGameCards(),
    listLocalSaves(),
  ])

  return cards.map((card) => ({
    cardId: card.id,
    title: card.manifest.name?.trim() || "未命名游戏卡",
    summary: card.manifest.summary?.trim() || "暂无简介。",
    source: card.source,
    contentFileCount: card.contentFiles.length,
    saveCount: saves.filter((save) => save.gameCardId === card.manifest.id).length,
    updatedAt: card.updatedAt,
  }))
}

async function executeStudioWorkspaceOperation(
  cardId: string,
  request: WorkspaceOperationRequest,
): Promise<unknown> {
  const context = await loadStudioWorkspaceContext(cardId)

  if (request.operation === "list") {
    return executeWorkspaceOperation({
      ...request,
      path: normalizeStudioDirectoryPath(request.path),
      scope: "effective",
    }, {
      workspaceFiles: await listStudioWorkspaceFilesForGameCard(cardId),
      actorLevel: 1,
      exposedOperations: ["list"],
    })
  }

  if (request.operation === "search") {
    const directoryPath = normalizeStudioDirectoryPath(request.path)
    const prefix = directoryPath ? `${directoryPath}/` : ""
    const workspaceFiles = (await listStudioWorkspaceFilesForGameCard(cardId))
      .filter((file) => !directoryPath || file.path === directoryPath || file.path.startsWith(prefix))

    return executeWorkspaceOperation({
      ...request,
      path: undefined,
      scope: "effective",
    }, {
      workspaceFiles,
      actorLevel: 1,
      exposedOperations: ["search"],
    })
  }

  const resolvedPath = resolveStudioWorkspacePath(context, request.path)
  const targetResolvedPath = request.operation === "move"
    ? resolveStudioWorkspacePath(context, request.targetPath)
    : null
  if (targetResolvedPath) {
    assertCompatibleStudioMove(resolvedPath, targetResolvedPath)
  }

  const operationRequest: WorkspaceOperationRequest = {
    ...request,
    path: resolvedPath.storagePath,
    ...(targetResolvedPath ? { targetPath: targetResolvedPath.storagePath } : {}),
    scope: resolvedPath.scope,
  }

  if (resolvedPath.scope === "save-runtime") {
    await initializeWorkspaceForSave(resolvedPath.saveId)
    const result = await executeWorkspaceOperation(operationRequest, {
      workspaceFiles: await listEffectiveWorkspaceFilesForSave(resolvedPath.saveId, context.card),
      actorLevel: 2,
      exposedOperations: AUTHORING_WORKSPACE_OPERATIONS,
      mutations: {
        write(writeInput) {
          return writeWorkspaceFileForSave(resolvedPath.saveId, {
            path: writeInput.path,
            content: writeInput.content,
            mediaType: writeInput.mediaType,
          })
        },
        async delete(deleteInput) {
          return {
            scope: deleteInput.scope,
            ...await deleteWorkspacePathForSave(resolvedPath.saveId, deleteInput.path),
          }
        },
      },
    })

    if (request.operation === "read") {
      return storageFileToStudioFile(result as WorkspaceFile, resolvedPath)
    }
    if (request.operation === "write" || request.operation === "patch") {
      const patchResult = result as WorkspacePatchResult
      return {
        ...patchResult,
        path: resolvedPath.displayPath,
        file: storageFileToStudioFile(patchResult.file, resolvedPath),
      }
    }
    if (request.operation === "delete") {
      const deleteResult = result as WorkspaceDeleteResult
      return {
        ...deleteResult,
        deletedPaths: deleteResult.deletedPaths.map((path) =>
          storagePathToStudioPath(path, resolvedPath)
        ),
      }
    }
    if (request.operation === "move" && targetResolvedPath) {
      const moveResult = result as WorkspaceMoveResult
      return {
        ...moveResult,
        fromPath: resolvedPath.displayPath,
        toPath: targetResolvedPath.displayPath,
        movedPaths: moveResult.movedPaths.map((path) =>
          storagePathToStudioPath(path, targetResolvedPath)
        ),
      }
    }
    if (request.operation === "validate") {
      const validationResult = result as WorkspaceValidationResult
      return {
        ...validationResult,
        path: validationResult.path
          ? storagePathToStudioPath(validationResult.path, resolvedPath)
          : undefined,
        errors: validationResult.errors.map((error) => ({
          ...error,
          path: error.path ? storagePathToStudioPath(error.path, resolvedPath) : undefined,
        })),
      }
    }

    return result
  }

  const result = await executeWorkspaceOperation(operationRequest, {
    workspaceFiles: cardContentFilesToWorkspaceFiles(context.card),
    actorLevel: 2,
    exposedOperations: AUTHORING_WORKSPACE_OPERATIONS,
    mutations: {
      write(writeInput) {
        return writeCardContentFileForCard(cardId, {
          path: writeInput.path,
          content: writeInput.content,
          mediaType: writeInput.mediaType,
        })
      },
      delete(deleteInput) {
        return deleteCardContentPathForCard(cardId, deleteInput.path)
      },
    },
  })

  return result
}

export async function searchPlatformWorkspace(input: {
  cardId: string
  query: string
  path?: string
  limit?: number
}): Promise<WorkspaceSearchResult[]> {
  return await executeStudioWorkspaceOperation(input.cardId, {
    operation: "search",
    scope: "effective",
    query: input.query,
    path: input.path,
    limit: input.limit,
  }) as WorkspaceSearchResult[]
}

export async function readPlatformWorkspaceFile(input: {
  cardId: string
  path: string
}): Promise<WorkspaceFile> {
  return await executeStudioWorkspaceOperation(input.cardId, {
    operation: "read",
    scope: "effective",
    path: input.path,
  }) as WorkspaceFile
}

export async function writePlatformWorkspaceFile(input: {
  cardId: string
  path: string
  content: string
  mediaType?: string
}): Promise<WorkspacePatchResult> {
  return await executeStudioWorkspaceOperation(input.cardId, {
    operation: "write",
    scope: "save-runtime",
    path: input.path,
    content: input.content,
    mediaType: input.mediaType,
  }) as WorkspacePatchResult
}

export async function patchPlatformWorkspaceFile(input: {
  cardId: string
  path: string
  content: string
  expectedContent?: string
  mediaType?: string
}): Promise<WorkspacePatchResult> {
  return await executeStudioWorkspaceOperation(input.cardId, {
    operation: "patch",
    scope: "save-runtime",
    path: input.path,
    content: input.content,
    expectedContent: input.expectedContent,
    mediaType: input.mediaType,
  }) as WorkspacePatchResult
}

export async function deletePlatformWorkspacePath(input: {
  cardId: string
  path: string
}): Promise<WorkspaceDeleteResult> {
  return await executeStudioWorkspaceOperation(input.cardId, {
    operation: "delete",
    scope: "save-runtime",
    path: input.path,
  }) as WorkspaceDeleteResult
}

export async function movePlatformWorkspacePath(input: {
  cardId: string
  path: string
  targetPath: string
}): Promise<WorkspaceMoveResult> {
  return await executeStudioWorkspaceOperation(input.cardId, {
    operation: "move",
    scope: "save-runtime",
    path: input.path,
    targetPath: input.targetPath,
  }) as WorkspaceMoveResult
}

export async function validatePlatformWorkspaceFile(input: {
  cardId: string
  path: string
  validator?: "json" | "frontmatter"
}): Promise<WorkspaceValidationResult> {
  return await executeStudioWorkspaceOperation(input.cardId, {
    operation: "validate",
    scope: "effective",
    path: input.path,
    validator: input.validator,
  }) as WorkspaceValidationResult
}
