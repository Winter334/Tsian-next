import type {
  WorkspaceDeleteResult,
  WorkspaceFile,
  WorkspaceListResult,
  WorkspaceMoveResult,
  WorkspaceOperationRequest,
  WorkspaceWriteResult,
  WorkspaceScope,
  WorkspaceSearchResult,
  WorkspaceValidationResult,
} from "@tsian/contracts"
import {
  AUTHORING_WORKSPACE_OPERATIONS,
  executeWorkspaceOperation,
} from "../agent-runtime/workspace-operations"
import { cardFrontendVolume, executeWorkspaceMutation, manifestVolume } from "./workspace-volumes"
import {
  cardContentFilesToWorkspaceFiles,
} from "./internal"
import {
  deleteWorkspacePathForSave,
  getActiveGameCardId,
  getActiveSaveId,
  getBuiltinBlankGameCard,
  getLocalGameCard,
  initializeWorkspaceForSave,
  listEffectiveWorkspaceFilesForSave,
  listLocalGameCardContentFiles,
  listLocalSaves,
  listWorkspaceFilesForSave,
  loadLocalAssistantFiles,
  loadLocalPlatformConfigFile,
  deleteLocalAssistantPath,
  normalizeWorkspaceFilePath,
  saveLocalAssistantFiles,
  isLocalAssistantPath,
  writePlatformWorkspaceFileForSave,
  writeWorkspaceFileForSave,
} from "../storage"
import { ensureBuiltinBlankGameCard } from "../storage"

export interface PlatformWorkspaceRootEntry {
  kind: "local" | "card"
  /** For "card" roots, the loaded card id; empty for "local" (.tsian/). */
  cardId: string
  title: string
  summary: string
  source: string
  contentFileCount: number
  saveCount: number
  updatedAt: number
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
      isManifest?: boolean
    }
  | {
      scope: "card-frontend"
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
  const files: WorkspaceFile[] = await cardContentFilesToWorkspaceFiles(card)

  // 前端文件（card-frontend，纯二进制）只读接入 list。write/delete 占位 throw，待子3。
  files.push(...await cardFrontendVolume.enumerate(cardId))
  // 合成 manifest 文件（game-card.json，不存表，list 时 JSON.stringify 注入）。
  files.push(...await manifestVolume.enumerate(cardId))

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

  // game-card.json → card-content scope, but routed to ManifestVolume by
  // resolveVolumeForScope (synthesized manifest file, not a real content row).
  if (displayPath === "game-card.json") {
    return {
      scope: "card-content",
      displayPath,
      storagePath: "game-card.json",
      isManifest: true,
    }
  }

  // frontend/ → card-frontend（前端文件纯二进制，storage path 带 frontend/ 前缀，
  // 与 listLocalGameCardFrontendFiles 返回的 path 格式一致）。
  if (displayPath === "frontend" || displayPath.startsWith("frontend/")) {
    return {
      scope: "card-frontend",
      displayPath,
      storagePath: displayPath,
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
  if (resolvedPath.scope === "card-content" || resolvedPath.scope === "card-frontend") {
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

export async function listPlatformWorkspaceDirectory(input: {
  cardId?: string
  saveId?: string
  path?: string
} = {}): Promise<WorkspaceListResult> {
  if (input.cardId) {
    const path = normalizeStudioDirectoryPath(input.path)
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

  // Local .tsian/ browsing: the player is the platform owner, so list at level 4.
  if (input.path === ".tsian" || (input.path ?? "").startsWith(".tsian/")) {
    const saveId = input.saveId ?? await getActiveSaveId()
    const files = saveId
      ? await listWorkspaceFilesForSave(saveId)
      : []
    // Also include local assistant files + platform config from the Dexie meta store.
    const localAssistantFiles = await loadLocalAssistantFiles()
    const localConfigFiles = await loadLocalPlatformConfigFile()
    const allFiles = [...files, ...localAssistantFiles, ...localConfigFiles]
    return await executeWorkspaceOperation({
      operation: "list",
      scope: "platform-meta",
      ...(input.path ? { path: input.path } : {}),
    }, {
      workspaceFiles: allFiles,
      actorLevel: 4,
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

  const activeCardId = await getActiveGameCardId()
  const saves = await listLocalSaves()

  // Local root (.tsian/ — the platform "C drive").
  const localRoot: PlatformWorkspaceRootEntry = {
    kind: "local",
    cardId: "",
    title: "本地存储",
    summary: "平台本地数据，不随游戏卡分发。",
    source: "platform",
    contentFileCount: 0,
    saveCount: 0,
    updatedAt: Date.now(),
  }

  // Loaded card root (the "USB drive").
  if (!activeCardId) {
    return [localRoot]
  }

  const activeCard = await getLocalGameCard(activeCardId)
  if (!activeCard) {
    return [localRoot]
  }

  const cardRoot: PlatformWorkspaceRootEntry = {
    kind: "card",
    cardId: activeCard.id,
    title: activeCard.manifest.name?.trim() || "未命名游戏卡",
    summary: activeCard.manifest.summary?.trim() || "暂无简介。",
    source: activeCard.source,
    contentFileCount: (await listLocalGameCardContentFiles(activeCard.id)).length,
    saveCount: saves.filter((save) => save.gameCardId === activeCard.manifest.id).length,
    updatedAt: activeCard.updatedAt,
  }

  return [localRoot, cardRoot]
}

async function executeStudioWorkspaceOperation(
  cardId: string,
  request: WorkspaceOperationRequest,
): Promise<unknown> {
  if (!cardId) {
    throw workspaceStudioError(
      "WORKSPACE_CARD_REQUIRED",
      "此操作需要一个已加载的游戏卡。",
    )
  }
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
          return executeWorkspaceMutation({
            scope: writeInput.scope,
            path: writeInput.path,
            content: writeInput.content,
            data: writeInput.data,
            ownerContext: { saveId: resolvedPath.saveId, cardId },
            operation: "write",
          }) as Promise<WorkspaceFile>
        },
        async delete(deleteInput) {
          const deletedPaths = await executeWorkspaceMutation({
            scope: deleteInput.scope,
            path: deleteInput.path,
            ownerContext: { saveId: resolvedPath.saveId, cardId },
            operation: "delete",
          }) as string[]
          return { scope: deleteInput.scope, deletedPaths }
        },
      },
    })

    if (request.operation === "read") {
      return storageFileToStudioFile(result as WorkspaceFile, resolvedPath)
    }
    if (request.operation === "write" || request.operation === "edit") {
      const writeResult = result as WorkspaceWriteResult
      return {
        ...writeResult,
        path: resolvedPath.displayPath,
        file: storageFileToStudioFile(writeResult.file, resolvedPath),
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

  // card-content + card-frontend + manifest 共用此分支。workspaceFiles 快照必须
  // 含三者，否则 card-frontend 的 read/validate 会从快照 find 不到前端文件，
  // game-card.json 的 read/validate 也会落空。
  const cardScopedFiles = [
    ...await cardContentFilesToWorkspaceFiles(context.card),
    ...await cardFrontendVolume.enumerate(cardId),
    ...await manifestVolume.enumerate(cardId),
  ]
  const result = await executeWorkspaceOperation(operationRequest, {
    workspaceFiles: cardScopedFiles,
    actorLevel: 2,
    exposedOperations: AUTHORING_WORKSPACE_OPERATIONS,
      mutations: {
        write(writeInput) {
          return executeWorkspaceMutation({
            scope: writeInput.scope,
            path: writeInput.path,
            content: writeInput.content,
            data: writeInput.data,
            ownerContext: { cardId },
            operation: "write",
          }) as Promise<WorkspaceFile>
        },
      async delete(deleteInput) {
        const deletedPaths = await executeWorkspaceMutation({
          scope: deleteInput.scope,
          path: deleteInput.path,
          ownerContext: { cardId },
          operation: "delete",
        }) as string[]
        return { scope: deleteInput.scope, deletedPaths }
      },
    },
  })

  return result
}

/**
 * Executes a workspace operation against platform-local .tsian/ files at the
 * platform-owner level (4). Reads and writes route to the active save's
 * workspaceFiles plus the Dexie meta store for local assistant files.
 */
async function executeLocalWorkspaceOperation(
  request: WorkspaceOperationRequest,
): Promise<unknown> {
  const saveId = await getActiveSaveId()
  const saveFiles = saveId ? await listWorkspaceFilesForSave(saveId) : []
  const localAssistantFiles = await loadLocalAssistantFiles()
  const localConfigFiles = await loadLocalPlatformConfigFile()
  const allFiles = [...saveFiles, ...localAssistantFiles, ...localConfigFiles]

  if (request.operation === "list") {
    return executeWorkspaceOperation(
      { ...request, scope: "platform-meta" },
      { workspaceFiles: allFiles, actorLevel: 4, exposedOperations: ["list"] },
    )
  }

  if (request.operation === "search") {
    return executeWorkspaceOperation(
      { ...request, scope: "platform-meta" },
      { workspaceFiles: allFiles, actorLevel: 4, exposedOperations: ["search"] },
    )
  }

  if (request.operation === "read") {
    return executeWorkspaceOperation(
      { ...request, scope: "platform-meta" },
      { workspaceFiles: allFiles, actorLevel: 4, exposedOperations: ["read"] },
    )
  }

  // Write/patch/delete/move/validate: persist back to the appropriate store.
  const result = await executeWorkspaceOperation(
    { ...request, scope: "platform-meta" },
    {
      workspaceFiles: allFiles,
      actorLevel: 4,
      exposedOperations: AUTHORING_WORKSPACE_OPERATIONS,
      mutations: {
        async write(writeInput) {
          return executeWorkspaceMutation({
            scope: "platform-meta",
            path: writeInput.path,
            content: writeInput.content,
            data: writeInput.data,
            ownerContext: { saveId: saveId ?? undefined },
            operation: "write",
          }) as Promise<WorkspaceFile>
        },
        async delete(deleteInput) {
          const deletedPaths = await executeWorkspaceMutation({
            scope: "platform-meta",
            path: deleteInput.path,
            ownerContext: { saveId: saveId ?? undefined },
            operation: "delete",
          }) as string[]
          return { scope: "platform-meta", deletedPaths }
        },
      },
    },
  )
  return result
}

export async function searchPlatformWorkspace(input: {
  cardId?: string
  query: string
  path?: string
  limit?: number
}): Promise<WorkspaceSearchResult[]> {
  if (!input.cardId && (input.path === ".tsian" || (input.path ?? "").startsWith(".tsian/"))) {
    return await executeLocalWorkspaceOperation({
      operation: "search",
      scope: "platform-meta",
      query: input.query,
      path: input.path,
      limit: input.limit,
    }) as WorkspaceSearchResult[]
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "search",
    scope: "effective",
    query: input.query,
    path: input.path,
    limit: input.limit,
  }) as WorkspaceSearchResult[]
}


function isTsianPath(path: string): boolean {
  return path === ".tsian" || path.startsWith(".tsian/")
}

export async function readPlatformWorkspaceFile(input: {
  cardId?: string
  path: string
}): Promise<WorkspaceFile> {
  if (!input.cardId && isTsianPath(input.path)) {
    return await executeLocalWorkspaceOperation({
      operation: "read",
      scope: "platform-meta",
      path: input.path,
    }) as WorkspaceFile
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "read",
    scope: "effective",
    path: input.path,
  }) as WorkspaceFile
}

export async function writePlatformWorkspaceFile(input: {
  cardId?: string
  path: string
  content?: string
  /** When set, the write is rejected if the file's current content does not
   *  match — optimistic-concurrency guard against stale overwrites (formerly
   *  the `patch` operation's duty, now folded into `write`). */
  expectedContent?: string
  data?: Blob
}): Promise<WorkspaceWriteResult> {
  if (!input.cardId && isTsianPath(input.path)) {
    return await executeLocalWorkspaceOperation({
      operation: "write",
      scope: "platform-meta",
      path: input.path,
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.data ? { content: input.data } : {}),
      ...(input.expectedContent !== undefined ? { expectedContent: input.expectedContent } : {}),
    }) as WorkspaceWriteResult
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "write",
    scope: "save-runtime",
    path: input.path,
    ...(input.content !== undefined ? { content: input.content } : {}),
    ...(input.data ? { content: input.data } : {}),
    ...(input.expectedContent !== undefined ? { expectedContent: input.expectedContent } : {}),
  }) as WorkspaceWriteResult
}

export async function deletePlatformWorkspacePath(input: {
  cardId?: string
  path: string
}): Promise<WorkspaceDeleteResult> {
  if (!input.cardId && isTsianPath(input.path)) {
    return await executeLocalWorkspaceOperation({
      operation: "delete",
      scope: "platform-meta",
      path: input.path,
    }) as WorkspaceDeleteResult
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "delete",
    scope: "save-runtime",
    path: input.path,
  }) as WorkspaceDeleteResult
}

export async function movePlatformWorkspacePath(input: {
  cardId?: string
  path: string
  targetPath: string
}): Promise<WorkspaceMoveResult> {
  if (!input.cardId && (isTsianPath(input.path) || isTsianPath(input.targetPath))) {
    return await executeLocalWorkspaceOperation({
      operation: "move",
      scope: "platform-meta",
      path: input.path,
      targetPath: input.targetPath,
    }) as WorkspaceMoveResult
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "move",
    scope: "save-runtime",
    path: input.path,
    targetPath: input.targetPath,
  }) as WorkspaceMoveResult
}

export async function validatePlatformWorkspaceFile(input: {
  cardId?: string
  path: string
  validator?: "json" | "frontmatter"
}): Promise<WorkspaceValidationResult> {
  if (!input.cardId && isTsianPath(input.path)) {
    return await executeLocalWorkspaceOperation({
      operation: "validate",
      scope: "platform-meta",
      path: input.path,
      validator: input.validator,
    }) as WorkspaceValidationResult
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "validate",
    scope: "effective",
    path: input.path,
    validator: input.validator,
  }) as WorkspaceValidationResult
}
