import type {
  WorkspaceDeleteResult,
  WorkspaceFile,
  WorkspaceListResult,
  WorkspaceMoveResult,
  WorkspaceOperationRequest,
  WorkspacePatchResult,
  WorkspaceScope,
  WorkspaceSearchResult,
  WorkspaceValidationResult,
} from "@tsian/contracts"
import {
  AUTHORING_WORKSPACE_OPERATIONS,
  executeWorkspaceOperation,
} from "../agent-runtime/workspace-operations"
import {
  cardContentFilesToWorkspaceFiles,
  writeCardContentFileForCard,
} from "./internal"
import {
  deleteLocalGameCardContentPathForCard,
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

async function deleteCardContentPathForCard(
  cardId: string,
  path: string,
): Promise<{ scope: WorkspaceScope; deletedPaths: string[] }> {
  const card = await getLocalGameCard(cardId)
  if (!card) {
    throw new Error(`游戏卡 "${cardId}" 不存在。`)
  }

  // Per-row delete (bumps card updatedAt internally); no whole-card rewrite.
  const deletedPaths = await deleteLocalGameCardContentPathForCard(cardId, path)
  return {
    scope: "card-content",
    deletedPaths,
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
    // Also include local assistant files from the Dexie meta store.
    const localAssistantFiles = await loadLocalAssistantFiles()
    const allFiles = [...files, ...localAssistantFiles]
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
    workspaceFiles: await cardContentFilesToWorkspaceFiles(context.card),
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
  const allFiles = [...saveFiles, ...localAssistantFiles]

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
          if (isLocalAssistantPath(writeInput.path)) {
            const written: WorkspaceFile = {
              path: writeInput.path,
              content: writeInput.content,
              mediaType: writeInput.mediaType ?? "text/plain",
              createdAt: 0,
              updatedAt: Date.now(),
            }
            const updated = [...localAssistantFiles.filter((f) => f.path !== written.path), written]
            await saveLocalAssistantFiles(updated)
            return written
          }
          if (!saveId) {
            throw workspaceStudioError("WORKSPACE_LOCAL_WRITE_NO_SAVE", "没有激活存档，无法写入 .tsian/ 文件。")
          }
          return writePlatformWorkspaceFileForSave(saveId, {
            path: writeInput.path,
            content: writeInput.content,
            mediaType: writeInput.mediaType,
          })
        },
        async delete(deleteInput) {
          if (isLocalAssistantPath(deleteInput.path)) {
            const kept = localAssistantFiles.filter((f) => f.path !== deleteInput.path && !f.path.startsWith(`${deleteInput.path}/`))
            await saveLocalAssistantFiles(kept)
            return { scope: "platform-meta", deletedPaths: [deleteInput.path] }
          }
          if (!saveId) {
            throw workspaceStudioError("WORKSPACE_LOCAL_DELETE_NO_SAVE", "没有激活存档，无法删除 .tsian/ 文件。")
          }
          // Delete from save workspaceFiles — best effort.
          return { scope: "platform-meta", deletedPaths: [deleteInput.path] }
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
  content: string
  mediaType?: string
}): Promise<WorkspacePatchResult> {
  if (!input.cardId && isTsianPath(input.path)) {
    return await executeLocalWorkspaceOperation({
      operation: "write",
      scope: "platform-meta",
      path: input.path,
      content: input.content,
      mediaType: input.mediaType,
    }) as WorkspacePatchResult
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "write",
    scope: "save-runtime",
    path: input.path,
    content: input.content,
    mediaType: input.mediaType,
  }) as WorkspacePatchResult
}

export async function patchPlatformWorkspaceFile(input: {
  cardId?: string
  path: string
  content: string
  expectedContent?: string
  mediaType?: string
}): Promise<WorkspacePatchResult> {
  if (!input.cardId && isTsianPath(input.path)) {
    return await executeLocalWorkspaceOperation({
      operation: "patch",
      scope: "platform-meta",
      path: input.path,
      content: input.content,
      expectedContent: input.expectedContent,
      mediaType: input.mediaType,
    }) as WorkspacePatchResult
  }
  return await executeStudioWorkspaceOperation(input.cardId ?? "", {
    operation: "patch",
    scope: "save-runtime",
    path: input.path,
    content: input.content,
    expectedContent: input.expectedContent,
    mediaType: input.mediaType,
  }) as WorkspacePatchResult
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
