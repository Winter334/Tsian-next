import type {
  PlatformActionError,
  PlatformActionRequest,
  PlatformActionResult,
} from "@tsian/contracts"
import { emitTurnDebugReady } from "../debug-events"
import {
  getActiveSaveId,
  getFrontendDebugSession,
  listCheckpointsForSave,
  replaceInitialCheckpointForSave,
  restoreCheckpointForSave,
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

export async function executePlatformAction(
  request: PlatformActionRequest,
): Promise<PlatformActionResult> {
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

    const checkpoints = await listCheckpointsForSave(activeSaveId)
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

    const labelRaw = request.params?.label
    const label = typeof labelRaw === "string" && labelRaw.trim()
      ? labelRaw.trim()
      : "开局设定"

    try {
      const summary = await replaceInitialCheckpointForSave(activeSaveId, {
        turn: 0,
        label,
      })
      // 检查点列表变了（新增 manual + 删除 initial），通知订阅方刷新。
      emitTurnDebugReady(0)
      return { ok: true, item: summary }
    } catch (error) {
      return actionError(
        "CHECKPOINT_CREATE_FAILED",
        error instanceof Error ? error.message : "创建检查点失败。",
      )
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
