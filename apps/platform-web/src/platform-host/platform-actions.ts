import type {
  CheckpointRetention,
  CheckpointSource,
  CreateCheckpointOptions,
  JsonValue,
  OverwriteCheckpointOptions,
  PlatformActionError,
  PlatformActionRequest,
  PlatformActionResult,
  UpdateCheckpointOptions,
} from "@tsian/contracts"
import { emitTurnDebugReady } from "../debug-events"
import {
  getActiveSaveId,
  createCheckpointForSave,
  deleteCheckpointForSave,
  getFrontendDebugSession,
  listCheckpointsForSave,
  overwriteCheckpointForSave,
  restoreCheckpointForSave,
  updateCheckpointForSave,
  WorkspaceStorageError,
} from "../storage"
import { listEffectiveWorkspaceFilesForActiveSave } from "./internal"
import { projectAssistantReply } from "./reply-projection"
import { isRecord } from "./internal"
import { resolveLocalAssistantActorLevel } from "./local-assistant"
import {
  executeWorkspaceOperationForActiveSave,
  normalizeWorkspaceActionRequest,
} from "./workspace-actions"

function actionError(
  code: string,
  message: string,
  details?: Record<string, string | number | boolean | null | string[]>,
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

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (isRecord(value)) return Object.values(value).every(isJsonValue)
  return false
}

function jsonMetadata(value: unknown): Record<string, JsonValue> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    throw new Error("metadata must be a JSON object when provided.")
  }
  const result: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!isJsonValue(item)) {
      throw new Error(`metadata.${key} must be JSON-compatible.`)
    }
    result[key] = item
  }
  return result
}

function stringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings when provided.`)
  }
  const result = value
    .map((item) => {
      if (typeof item !== "string") {
        throw new Error(`${fieldName} must be an array of strings when provided.`)
      }
      return item.trim()
    })
    .filter(Boolean)
  return result.length > 0 ? Array.from(new Set(result)) : undefined
}

const CHECKPOINT_RETENTIONS = new Set<CheckpointRetention>(["auto", "pinned"])
const CHECKPOINT_SOURCES = new Set<CheckpointSource>(["platform", "user", "card", "agent"])

function normalizeCheckpointPatch(params: Record<string, unknown> | undefined): UpdateCheckpointOptions {
  const patch: UpdateCheckpointOptions = {}
  if (!params) return patch

  if (params.label !== undefined) {
    if (typeof params.label !== "string") throw new Error("label must be a string when provided.")
    const label = params.label.trim()
    if (label) patch.label = label
  }
  if (params.retention !== undefined) {
    if (typeof params.retention !== "string" || !CHECKPOINT_RETENTIONS.has(params.retention as CheckpointRetention)) {
      throw new Error('retention must be "auto" or "pinned" when provided.')
    }
    patch.retention = params.retention as CheckpointRetention
  }
  if (params.source !== undefined) {
    if (typeof params.source !== "string" || !CHECKPOINT_SOURCES.has(params.source as CheckpointSource)) {
      throw new Error('source must be "platform", "user", "card", or "agent" when provided.')
    }
    patch.source = params.source as CheckpointSource
  }
  if (params.tags !== undefined) patch.tags = stringArray(params.tags, "tags")
  if (params.visible !== undefined) {
    if (typeof params.visible !== "boolean") throw new Error("visible must be a boolean when provided.")
    patch.visible = params.visible
  }
  if (params.metadata !== undefined) patch.metadata = jsonMetadata(params.metadata)
  if (params.reason !== undefined) {
    if (typeof params.reason !== "string") throw new Error("reason must be a string when provided.")
    const reason = params.reason.trim()
    if (reason) patch.reason = reason
  }
  return patch
}

function normalizeCreateCheckpointOptions(params: Record<string, unknown> | undefined): CreateCheckpointOptions {
  return normalizeCheckpointPatch(params) as CreateCheckpointOptions
}

function normalizeOverwriteCheckpointOptions(params: Record<string, unknown> | undefined): OverwriteCheckpointOptions {
  return normalizeCheckpointPatch(params) as OverwriteCheckpointOptions
}

function checkpointIdFromParams(
  params: Record<string, unknown> | undefined,
  action: string,
): string {
  const checkpointId = params?.checkpointId
  if (typeof checkpointId !== "string" || !checkpointId.trim()) {
    throw new Error(`${action} 需要非空 checkpointId。`)
  }
  return checkpointId.trim()
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

const REMOTE_PLATFORM_ACTION_ALLOWLIST = new Set([
  "reply-project",
  "restore-checkpoint",
  "create-checkpoint",
  "update-checkpoint",
  "overwrite-checkpoint",
  "delete-checkpoint",
])

export type PlatformActionCaller = "trusted" | "play-frontend"

export async function executePlatformAction(
  request: PlatformActionRequest,
  options: { caller?: PlatformActionCaller } = {},
): Promise<PlatformActionResult> {
  const caller = options.caller ?? "trusted"
  if (caller === "play-frontend" && !REMOTE_PLATFORM_ACTION_ALLOWLIST.has(request.action)) {
    return actionError(
      "PLATFORM_ACTION_FORBIDDEN",
      "This platform action is not available to game frontends.",
      { action: request.action },
    )
  }

  if (request.action === "reply-project") {
    const activeSaveId = await getActiveSaveId()
    if (!activeSaveId) {
      return actionError(
        "ACTIVE_SAVE_REQUIRED",
        "当前没有激活中的会话。",
      )
    }

    const text = request.params?.text
    if (typeof text !== "string") {
      return actionError(
        "REPLY_PROJECT_TEXT_REQUIRED",
        "reply-project 需要字符串 text 参数。",
      )
    }

    const projected = projectAssistantReply(
      text,
      await listEffectiveWorkspaceFilesForActiveSave(activeSaveId),
    )
    return {
      ok: true,
      item: {
        kind: "assistant",
        content: projected.content,
        ...(projected.displayContent !== undefined ? { displayContent: projected.displayContent } : {}),
        ...(projected.projections ? { projections: projected.projections } : {}),
      },
    }
  }

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

    const checkpoints = await listCheckpointsForSave(activeSaveId, { includeHidden: true })
    const checkpoint = checkpoints.find((item) => item.id === checkpointId.trim())
    const debugSession = await getFrontendDebugSession()
    const baselineCheckpoint = debugSession.status === "valid"
      ? checkpoints.find((item) => item.id === debugSession.record.checkpointId)
      : undefined
    if (
      checkpoint
      && debugSession.status === "valid"
      && debugSession.record.saveId === activeSaveId
      && (
        checkpoint.turn < debugSession.record.baselineTurn
        || (
          checkpoint.turn === debugSession.record.baselineTurn
          && baselineCheckpoint
          && checkpoint.createdAt < baselineCheckpoint.createdAt
        )
      )
    ) {
      return actionError(
        "FRONTEND_DEBUG_BASELINE_FLOOR",
        "前端调试会话期间不能恢复到调试 baseline 之前。请先完成前端自检回滚。",
        {
          checkpointId: checkpoint.id,
          checkpointTurn: checkpoint.turn,
          checkpointCreatedAt: checkpoint.createdAt,
          baselineTurn: debugSession.record.baselineTurn,
          ...(baselineCheckpoint
            ? { baselineCreatedAt: baselineCheckpoint.createdAt }
            : {}),
        },
      )
    }

    const restored = await restoreCheckpointForSave(activeSaveId, checkpointId.trim())
    if (!restored) {
      return actionError(
        "CHECKPOINT_NOT_FOUND",
        "指定的 checkpoint 不存在。",
        { checkpointId: checkpointId.trim() },
      )
    }

    // 回溯改变了存档状态（workspace + turn 文件裁剪 + 未来 checkpoint 删除），
    // 通知 DebugView 等订阅方刷新——否则开着的系统监视器还显示旧 checkpoint 列表
    // （含已删除的"未来分支"幽灵点，点击会 CHECKPOINT_NOT_FOUND）+ 旧诊断/会话历史。
    emitTurnDebugReady(restored.turn)

    return {
      ok: true,
      item: restored,
    }
  }

  if (request.action === "create-checkpoint") {
    const activeSaveId = await getActiveSaveId()
    if (!activeSaveId) {
      return actionError(
        "ACTIVE_SAVE_REQUIRED",
        "当前没有激活中的会话。",
      )
    }

    try {
      const summary = await createCheckpointForSave(
        activeSaveId,
        normalizeCreateCheckpointOptions(request.params),
      )
      emitTurnDebugReady(summary.turn)
      return { ok: true, item: summary }
    } catch (error) {
      return actionError(
        "CHECKPOINT_CREATE_FAILED",
        error instanceof Error ? error.message : "创建检查点失败。",
      )
    }
  }

  if (request.action === "update-checkpoint") {
    const activeSaveId = await getActiveSaveId()
    if (!activeSaveId) {
      return actionError(
        "ACTIVE_SAVE_REQUIRED",
        "当前没有激活中的会话。",
      )
    }

    try {
      const checkpointId = checkpointIdFromParams(request.params, "update-checkpoint")
      const summary = await updateCheckpointForSave(
        activeSaveId,
        checkpointId,
        normalizeCheckpointPatch(request.params),
      )
      if (!summary) {
        return actionError(
          "CHECKPOINT_NOT_FOUND",
          "指定的 checkpoint 不存在。",
          { checkpointId },
        )
      }
      emitTurnDebugReady(summary.turn)
      return { ok: true, item: summary }
    } catch (error) {
      return actionError(
        "CHECKPOINT_UPDATE_FAILED",
        error instanceof Error ? error.message : "更新检查点失败。",
      )
    }
  }

  if (request.action === "overwrite-checkpoint") {
    const activeSaveId = await getActiveSaveId()
    if (!activeSaveId) {
      return actionError(
        "ACTIVE_SAVE_REQUIRED",
        "当前没有激活中的会话。",
      )
    }

    try {
      const checkpointId = checkpointIdFromParams(request.params, "overwrite-checkpoint")
      const summary = await overwriteCheckpointForSave(
        activeSaveId,
        checkpointId,
        normalizeOverwriteCheckpointOptions(request.params),
      )
      if (summary === "protected") {
        return actionError(
          "CHECKPOINT_PROTECTED",
          "该 checkpoint 当前受前端调试会话保护，不能覆盖。",
          { checkpointId },
        )
      }
      if (!summary) {
        return actionError(
          "CHECKPOINT_NOT_FOUND",
          "指定的 checkpoint 不存在。",
          { checkpointId },
        )
      }
      emitTurnDebugReady(summary.turn)
      return { ok: true, item: summary }
    } catch (error) {
      return actionError(
        "CHECKPOINT_OVERWRITE_FAILED",
        error instanceof Error ? error.message : "覆盖检查点失败。",
      )
    }
  }

  if (request.action === "delete-checkpoint") {
    const activeSaveId = await getActiveSaveId()
    if (!activeSaveId) {
      return actionError(
        "ACTIVE_SAVE_REQUIRED",
        "当前没有激活中的会话。",
      )
    }

    try {
      const checkpointId = checkpointIdFromParams(request.params, "delete-checkpoint")
      const result = await deleteCheckpointForSave(activeSaveId, checkpointId)
      if (result === "not-found") {
        return actionError(
          "CHECKPOINT_NOT_FOUND",
          "指定的 checkpoint 不存在。",
          { checkpointId },
        )
      }
      if (result === "protected") {
        return actionError(
          "CHECKPOINT_PROTECTED",
          "该 checkpoint 当前受前端调试会话保护，不能删除。",
          { checkpointId },
        )
      }
      emitTurnDebugReady(0)
      return { ok: true }
    } catch (error) {
      return actionError(
        "CHECKPOINT_DELETE_FAILED",
        error instanceof Error ? error.message : "删除检查点失败。",
      )
    }
  }

  const workspaceRequest = normalizeWorkspaceActionRequest(request)
  if (workspaceRequest) {
    if (caller === "play-frontend") {
      return actionError(
        "PLATFORM_ACTION_FORBIDDEN",
        "Workspace platform actions are not available to game frontends.",
      )
    }
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
          // The desktop assistant is the platform management assistant, not a
          // runtime game agent. Its actor level comes from its own agent.json
          // (workspaceAccess.level, default 4 = highest), so it can manage all
          // resource-manager-visible content including card-content. Passing
          // undefined lets resolveWorkspaceActorLevel fall back to its default
          // only when the config is missing — never a hardcoded override that
          // would silently strip the configured level.
          actorLevel: await resolveLocalAssistantActorLevel(),
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

export function executePlatformActionForPlayFrontend(
  request: PlatformActionRequest,
): Promise<PlatformActionResult> {
  return executePlatformAction(request, { caller: "play-frontend" })
}
