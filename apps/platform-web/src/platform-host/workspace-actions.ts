import type {
  AgentContextEntry,
  PlatformActionRequest,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceListRequest,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspaceReadRequest,
  WorkspaceReadResult,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
} from "@tsian/contracts"
import {
  AUTHORING_WORKSPACE_OPERATIONS,
  executeWorkspaceOperation,
} from "../agent-runtime/workspace-operations"
import { triggerFrontendRebuild } from "../frontend-build/trigger"
import {
  getActiveSaveId,
  type RuntimeWorkspaceTransaction,
} from "../storage"
import {
  ensureActiveSave,
  getPlatformActiveGameCardId,
} from "./game-cards"
import {
  isRecord,
  listEffectiveWorkspaceFilesForActiveSave,
} from "./internal"
import { executeWorkspaceMutation } from "./workspace-volumes"

export function normalizeWorkspaceActionRequest(
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
      operation === "read" || operation === "list" || operation === "search" || operation === "semantic_search"
        ? "effective"
        : "save-runtime"
    ),
  } as WorkspaceOperationRequest
}

export function normalizeWorkspaceListEntries(result: unknown): WorkspaceEntry[] {
  if (Array.isArray(result)) {
    return result as WorkspaceEntry[]
  }
  if (isRecord(result)) {
    const entries = result.entries
    if (Array.isArray(entries)) {
      return entries as WorkspaceEntry[]
    }
  }
  throw new Error("workspace.list returned an invalid result shape.")
}

export async function executeWorkspaceOperationForActiveSave(
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
    semanticSearchOwnerId: saveId,
    mutations: {
      async write(writeInput) {
        // staged turn：保留上层特殊路径（transaction 攒变更），不进 dispatch。
        if (input.workspaceTransaction) {
          if (writeInput.scope === "platform-meta") {
            return input.workspaceTransaction.writePlatformFile({
              path: writeInput.path,
              content: writeInput.content,
              ...(writeInput.data ? { data: writeInput.data } : {}),
            })
          }
          if (writeInput.scope === "save-runtime") {
            return input.workspaceTransaction.write({
              path: writeInput.path,
              content: writeInput.content,
              ...(writeInput.data ? { data: writeInput.data } : {}),
            })
          }
          throw new Error("Runtime turn staging cannot mutate card-content.")
        }

        // 非 staged：统一 dispatch。card-scope 需要 activeCardId（与原
        // writeCardContentFileForActiveCard 内部 getPlatformActiveGameCard 同源）。
        const cardId = writeInput.scope === "card-content" || writeInput.scope === "card-frontend"
          ? await getPlatformActiveGameCardId()
          : undefined
        const result = await executeWorkspaceMutation({
          scope: writeInput.scope,
          path: writeInput.path,
          content: writeInput.content,
          data: writeInput.data,
          ownerContext: { saveId, cardId: cardId ?? undefined },
          operation: "write",
        }) as WorkspaceFile
        // frontend/src/** 写入 → 防抖触发平台重建（R6）。fire-and-forget，
        // 不阻塞 tool 返回；staged turn 不落盘故不在此分支。
        if (writeInput.scope === "card-frontend" && cardId) {
          triggerFrontendRebuild(cardId, writeInput.path)
        }
        return result
      },
      async delete(deleteInput) {
        // staged turn：保留上层特殊路径（transaction 攒变更），不进 dispatch。
        if (input.workspaceTransaction) {
          if (deleteInput.scope !== "save-runtime") {
            throw new Error("Runtime turn staging can only delete save-runtime paths.")
          }
          return {
            scope: deleteInput.scope,
            ...input.workspaceTransaction.delete(deleteInput.path),
          }
        }

        // 非 staged：统一 dispatch。card-scope 需要 activeCardId。
        const cardId = deleteInput.scope === "card-content" || deleteInput.scope === "card-frontend"
          ? await getPlatformActiveGameCardId()
          : undefined
        const deletedPaths = await executeWorkspaceMutation({
          scope: deleteInput.scope,
          path: deleteInput.path,
          ownerContext: { saveId, cardId: cardId ?? undefined },
          operation: "delete",
        }) as string[]
        // frontend/src/** 删除 → 同样触发重建（源码文件被删影响构建）。
        if (deleteInput.scope === "card-frontend" && cardId) {
          triggerFrontendRebuild(cardId, deleteInput.path)
        }
        return { scope: deleteInput.scope, deletedPaths }
      },
    },
  })
}

export async function readBridgeWorkspace(req: WorkspaceReadRequest): Promise<WorkspaceReadResult | null> {
  const activeSaveId = await getActiveSaveId()
  if (!activeSaveId) {
    return null
  }
  try {
    return await executeWorkspaceOperationForActiveSave(activeSaveId, {
      operation: "read",
      scope: req.scope ?? "effective",
      path: req.path,
      ...(typeof req.offset === "number" ? { offset: req.offset } : {}),
      ...(typeof req.limit === "number" ? { limit: req.limit } : {}),
    } as WorkspaceOperationRequest, {
      actorLevel: 1,
    }) as Promise<WorkspaceReadResult>
  } catch (error) {
    // 文件不存在 → null（区别于旧 query 通道的 catch 吞所有错误）。
    // 其它错误（权限/路径非法）继续抛。
    if (isRecord(error) && (error as { code?: string }).code === "WORKSPACE_FILE_NOT_FOUND") {
      return null
    }
    throw error
  }
}

export async function listBridgeWorkspace(req: WorkspaceListRequest): Promise<WorkspaceEntry[]> {
  const activeSaveId = await getActiveSaveId()
  if (!activeSaveId) {
    return []
  }
  const result = await executeWorkspaceOperationForActiveSave(activeSaveId, {
    operation: "list",
    scope: "effective",
    ...(typeof req.path === "string" ? { path: req.path } : {}),
  }, {
    actorLevel: 1,
  })
  return normalizeWorkspaceListEntries(result)
}

export async function searchBridgeWorkspace(req: WorkspaceSearchRequest): Promise<WorkspaceSearchResult[]> {
  const activeSaveId = await getActiveSaveId()
  if (!activeSaveId) {
    return []
  }
  return executeWorkspaceOperationForActiveSave(activeSaveId, {
    operation: "search",
    scope: req.scope ?? "effective",
    ...(typeof req.query === "string" ? { query: req.query } : {}),
    ...(typeof req.pattern === "string" ? { pattern: req.pattern } : {}),
    ...(typeof req.limit === "number" ? { limit: req.limit } : {}),
    ...(typeof req.contextLines === "number" ? { contextLines: req.contextLines } : {}),
    ...(typeof req.ignoreCase === "boolean" ? { ignoreCase: req.ignoreCase } : {}),
  } as WorkspaceOperationRequest, {
    actorLevel: 1,
  }) as Promise<WorkspaceSearchResult[]>
}

export async function writeBridgeWorkspace(req: WorkspaceWriteRequest): Promise<WorkspaceWriteResult> {
  const activeSaveId = await ensureActiveSave()
  return executeWorkspaceOperationForActiveSave(activeSaveId, {
    operation: "write",
    scope: req.scope ?? "save-runtime",
    path: req.path,
    content: req.content,
  } as WorkspaceOperationRequest, {
    actorLevel: 1,
  }) as Promise<WorkspaceWriteResult>
}
