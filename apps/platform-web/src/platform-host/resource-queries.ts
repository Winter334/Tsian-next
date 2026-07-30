import type {
  AgentContextEntry,
  AgentRegistryEntry,
  DeepQueryRequest,
  DeepQueryResult,
  ListCheckpointOptions,
  SkillDetailEntry,
  SkillRegistryEntry,
} from "@tsian/contracts"
import { assembleAgentContext } from "../agent-runtime/context"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  loadSkillDetail,
} from "../agent-runtime/registry"
import { readFrontendBuildStatus } from "../frontend-build/trigger"
import {
  getActiveSaveId,
  getHistoryForSave,
  listCheckpointsForSave,
  listWorkspaceFilesForSave,
  normalizeWorkspaceFilePath,
} from "../storage"
import { getPlatformActiveGameCardId } from "./game-cards"
import { getSessionHistoryFromTurnFiles } from "./history-turns"
import { listEffectiveWorkspaceFilesForActiveSave } from "./internal"

export async function queryResource<T = unknown>(request: DeepQueryRequest): Promise<DeepQueryResult<T>> {
  const activeSaveId = await getActiveSaveId()

  if (request.resource === "history") {
    if (!activeSaveId) {
      return { items: [] } as DeepQueryResult<T>
    }

    return {
      items: (await getHistoryForSave(activeSaveId)) as T[],
    } as DeepQueryResult<T>
  }

  if (request.resource === "session-history") {
    if (!activeSaveId) {
      return { items: [] } as DeepQueryResult<T>
    }

    const files = await listWorkspaceFilesForSave(activeSaveId)
    return {
      items: getSessionHistoryFromTurnFiles(files) as T[],
    } as DeepQueryResult<T>
  }

  if (request.resource === "checkpoints") {
    if (!activeSaveId) {
      return { items: [] } as DeepQueryResult<T>
    }

    return {
      items: (await listCheckpointsForSave(activeSaveId, request.params as ListCheckpointOptions | undefined)) as T[],
    } as DeepQueryResult<T>
  }

  // workspace.read/list/search 已拆出为独立 workspace.* RPC method（见下方
  // playFrontendBridge.workspace），不再走 query.query 通道。

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

  // 前端构建状态：助手写 frontend/src/** 后读此 resource 看构建结果
  // （ok/failed + error）。per-card（非 per-save），故不走 activeSaveId 守卫。
  if (request.resource === "frontend-build-status") {
    const cardId = typeof request.params?.cardId === "string" && request.params.cardId.trim()
      ? request.params.cardId.trim()
      : (await getPlatformActiveGameCardId()) ?? ""
    return {
      items: [readFrontendBuildStatus(cardId)] as T[],
    } as DeepQueryResult<T>
  }

  return { items: [] } as DeepQueryResult<T>
}
