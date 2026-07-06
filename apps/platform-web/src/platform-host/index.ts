import type {
  AgentConfig,
  AgentPlatformToolName,
  AgentContextEntry,
  AgentContextSnapshot,
  AgentRegistryEntry,
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  GameCardContentFile,
  GameCardCover,
  GameCardFrontendBinding,
  GameCardRuntimeEntrypoints,
  InvokeAgentRequest,
  InvokeAgentResult,
  JsonValue,
  PlatformActionError,
  PlatformActionRequest,
  PlatformActionResult,
  PlayFrontendBridge,
  RuntimeDiagnosticSummary,
  RuntimeDiagnosticsQueryParams,
  SkillDetailEntry,
  SkillRegistryEntry,
  TurnStats,
  TurnTimelineItem,
  WorkspaceDeleteResult,
  WorkspaceEntry,
  WorkspaceListRequest,
  WorkspaceListResult,
  WorkspaceFile,
  WorkspaceMoveResult,
  WorkspaceOperationName,
  WorkspaceOperationRequest,
  WorkspaceReadRequest,
  WorkspaceReadResult,
  WorkspaceWriteRequest,
  WorkspaceWriteResult,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
  WorkspaceScope,
  WorkspaceValidationResult,
} from "@tsian/contracts"
import {
  runAgentRuntimeTurn,
} from "../agent-runtime"
import type { RuntimeControlledExecutorContext } from "../agent-runtime/workspace-tools"
import { assembleAgentContext } from "../agent-runtime/context"
import {
  agentContextPath,
  appendTurnToContext,
  ASSISTANT_CONTEXT_AGENT_ID,
  ASSISTANT_CONTEXT_SCHEMA,
  createEmptyAgentContext,
  createInitialAgentContext,
  DEFAULT_TASK_INACTIVITY_TIMEOUT_MS,
  parseAgentContext,
  resolveTokenBudget,
  serializeAgentContext,
  TaskTimeoutError,
} from "../agent-runtime/context-lifecycle"
import { buildRuntimeDiagnostics, loadRuntimeTraceEvents } from "../agent-runtime/diagnostics"
import { isAgentPlatformToolEnabled } from "../agent-runtime/permissions"
import { enqueueStaleEmbeddings } from "../agent-runtime/semantic-index/staleness"
import { resolveEmbeddingConfig } from "../config/ai"
import {
  buildAgentRegistry,
  buildSkillRegistry,
  isSkillEnabledForAgent,
  loadSkillDetail,
  skillMatchesReference,
  skillMetadataReference,
} from "../agent-runtime/registry"
import {
  assistantContextPath,
  deleteLocalAssistantFile,
  loadLocalAssistantFiles,
  saveLocalAssistantFiles,
  isLocalAssistantPath,
  isAssistantDirectWritePath,
  LOCAL_ASSISTANT_AGENT_ID,
} from "../storage"
import type { RuntimeTraceEmitter } from "../agent-runtime/trace"
import {
  createRuntimeTraceCollector,
  errorToTraceData,
  errorToTraceDataWithStack,
  formatRuntimeTracePath,
  formatAgentTracePath,
  serializeRuntimeTraceEvents,
} from "../agent-runtime/trace"
import {
  AUTHORING_WORKSPACE_OPERATIONS,
  executeWorkspaceOperation,
} from "../agent-runtime/workspace-operations"
import { createDebugBridge, resolveRemoteFrontendUrl } from "../bridge"
import { emitTurnDebugReady } from "../debug-events"
import { emitTurnDelta, emitTurnRoundEnd, emitTurnTool, emitTurnOptions, emitTurnStats, emitAgentInvocation } from "../streaming-events"
import { emitInteractionRequest, rejectAllInteractionRequests } from "../interaction-events"
import {
  markPlatformHostReady,
  waitForPlatformHostReady,
} from "./host-state"
import {
  buildAgentProviderPresetMap,
  cardContentFilesToWorkspaceFiles,
  ensureActiveGameCardId,
  getPlatformActiveGameCard,
  gameCardForSave,
  isRecord,
  listEffectiveWorkspaceFilesForActiveSave,
  normalizeMessageContent,
  resolveAgentModelConfig,
} from "./internal"
import { resolveLocalAssistantActorLevel } from "./local-assistant"
import { resolvePlayerTurnAgentIdForSave } from "./runtime-entrypoints"
import { ensureActiveSave, formatActiveFrontendId, getPlatformActiveGameCardId } from "./game-cards"
import { executeWorkspaceMutation } from "./workspace-volumes"
import {
  readAgentContextFromWorkspace,
  getMaxTurnFromTurnFiles,
  getSessionHistoryFromTurnFiles,
  stageAgentContextFile,
  stageRawAirpHistoryTurnFile,
} from "./history-turns"
import { createTurnTimelineCollector } from "./turn-timeline-collector"
import { extractStoryOptions } from "./story-options"
import {
  generateAssistantReply,
  generateAssistantReplyNative,
  streamAssistantReplyNative,
  streamAssistantReplyText,
  getAiDebugRecords,
  type RuntimeChatMessage,
} from "../runtime-host/ai"
import {
  getBrowserAiConfig,
  listBrowserAiProviderPresetOptions,
  resolveBrowserAiConfigForProviderId,
  type BrowserAiConfig,
  type BrowserAiToolCallMode,
} from "../config/ai"
import { createBrowserScriptRunners } from "./browser-skill-script-executor"
import {
  commitSuccessfulRuntimeTurnForSave,
  commitWorkspaceFilesForSave,
  commitWorkspaceFilesWithCheckpointForSave,
  createRuntimeWorkspaceTransaction,
  createLocalSave,
  createLocalSaveFromGameCard,
  deleteLocalGameCard,
  deleteLocalSave,
  ensureBuiltinBlankGameCard,
  exportGameCardFrontendPackage,
  exportGameCardPackage,
  getActiveGameCardId,
  getActiveSaveId,
  getBuiltinBlankGameCard,
  getHistoryForSave,
  getLocalGameCard,
  importGameCardFrontendPackage,
  importGameCardPackage,
  initializeWorkspaceForSave,
  listCheckpointsForSave,
  listEffectiveWorkspaceFilesForSave,
  listLocalGameCardContentFiles,
  listLocalGameCardFrontendFiles,
  listLocalGameCards,
  listLocalSaves,
  listWorkspaceFilesForSave,
  normalizeWorkspaceFilePath,
  putLocalGameCard,
  readLocalGameCardContentFile,
  deleteLocalGameCardContentFile,
  deleteLocalGameCardContentPathForCard,
  replaceWorkspaceFilesForSave,
  restoreCheckpointForSave,
  setActiveGameCardId,
  setActiveSaveId,
  writeLocalGameCardContentFile,
  writePlatformWorkspaceFileForSave,
  type LocalGameCardRecord,
  type LocalSaveRecord,
  type RuntimeWorkspaceTransaction,
  WorkspaceStorageError,
} from "../storage"
import { triggerFrontendRebuild, readFrontendBuildStatus } from "../frontend-build/trigger"
import {
  DEFAULT_FRONTEND_BINDING,
  defaultFrontendFiles,
} from "../storage/default-frontend-files"

let previousTurnController: AbortController | null = null

/** 旁路调用排队锁：同一 agentId + slot 串行执行，避免 context.json 读写竞争。
 *  key = `${agentId}:${slot ?? "default"}`，value = 当前正在执行的 Promise。
 *  不同 agent 或不同 slot 可真并行。条目在执行完成后自动清理。 */
const invokeAgentQueue = new Map<string, Promise<unknown>>()



/**
 * Map a model-call finish reason to the `turn-round-end` kind so the play
 * frontend can classify streamed `turn-delta` text: a `tool_calls` round is a
 * thought round (its text is the reasoning stream); a `stop` round is the
 * final reply. See `06-19-ai-agent-process-visible` design §3.
 */
function finishReasonToKind(finishReason: "stop" | "tool_calls"): "thought" | "final" {
  return finishReason === "tool_calls" ? "thought" : "final"
}

function createInvocationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return `invoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function platformErrorFromUnknown(error: unknown, fallbackCode = "AGENT_INVOCATION_FAILED"): PlatformActionError {
  if (isRecord(error) && typeof error.code === "string" && typeof error.message === "string") {
    const details = isRecord(error.details)
      ? Object.fromEntries(
          Object.entries(error.details).filter((entry): entry is [string, JsonValue] =>
            isJsonValue(entry[1]),
          ),
        )
      : undefined
    return {
      code: error.code,
      message: error.message,
      ...(details && Object.keys(details).length > 0 ? { details } : {}),
    }
  }

  return {
    code: error instanceof DOMException ? error.name : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
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
      operation === "read" || operation === "list" || operation === "search" || operation === "semantic_search"
        ? "effective"
        : "save-runtime"
    ),
  } as WorkspaceOperationRequest
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
          ownerContext: { saveId, cardId },
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
          ownerContext: { saveId, cardId },
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

async function writeRuntimeTraceFileForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
  path: string,
  events: ReturnType<typeof createRuntimeTraceCollector>["events"],
): Promise<void> {
  const file = await writePlatformWorkspaceFileForSave(saveId, {
    path,
    content: serializeRuntimeTraceEvents(events),
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

export const playFrontendBridge: PlayFrontendBridge = {
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
          items: (await listCheckpointsForSave(activeSaveId)) as T[],
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

      // 运行日志浏览器：返回指定回合（或全部）的原始 trace events，供 DebugView 渲染。
      if (request.resource === "runtime-trace") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const files = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
        const turn = typeof request.params?.turn === "number" && Number.isFinite(request.params.turn)
          ? request.params.turn
          : undefined
        return {
          items: loadRuntimeTraceEvents(files, turn) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "ai-debug") {
        return {
          items: await getAiDebugRecords() as T[],
        } as DeepQueryResult<T>
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
    },
  },
  workspace: {
    async read(req: WorkspaceReadRequest): Promise<WorkspaceReadResult | null> {
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
    },

    async list(req: WorkspaceListRequest): Promise<WorkspaceEntry[]> {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        return []
      }
      return executeWorkspaceOperationForActiveSave(activeSaveId, {
        operation: "list",
        scope: "effective",
        ...(typeof req.path === "string" ? { path: req.path } : {}),
      }, {
        actorLevel: 1,
      }) as Promise<WorkspaceEntry[]>
    },

    async search(req: WorkspaceSearchRequest): Promise<WorkspaceSearchResult[]> {
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
    },

    async write(req: WorkspaceWriteRequest): Promise<WorkspaceWriteResult> {
      const activeSaveId = await ensureActiveSave()
      return executeWorkspaceOperationForActiveSave(activeSaveId, {
        operation: "write",
        scope: req.scope ?? "save-runtime",
        path: req.path,
        content: req.content,
      } as WorkspaceOperationRequest, {
        actorLevel: 1,
      }) as Promise<WorkspaceWriteResult>
    },
  },
  card: {
    /** 返回当前卡 runtime.entrypoints；卡未配置时返回空对象 {}。
     *  前端用它决定调用哪个 agent（如回合后维护入口），不硬编码 agent 名。 */
    async getEntrypoints(): Promise<GameCardRuntimeEntrypoints> {
      const activeCard = await getPlatformActiveGameCard()
      const entrypoints = activeCard?.manifest.runtime?.entrypoints
      if (!entrypoints) return {}
      // 只透出已声明的字段，避免 manifest 解析外的字段泄漏到前端。
      const result: GameCardRuntimeEntrypoints = {}
      if (entrypoints.playerTurn) result.playerTurn = entrypoints.playerTurn
      if (entrypoints.postTurnMaintenance) result.postTurnMaintenance = entrypoints.postTurnMaintenance
      return result
    },
  },
  interaction: {
    async sendMessage(input) {
      const content = normalizeMessageContent(input.content)
      if (!content) {
        throw new Error("interaction.sendMessage requires non-empty content.")
      }

      const activeSaveId = await ensureActiveSave()
      const playerTurnAgentId = await resolvePlayerTurnAgentIdForSave(activeSaveId)
      const workspaceFilesBefore = await listEffectiveWorkspaceFilesForActiveSave(activeSaveId)
      const maxTurn = getMaxTurnFromTurnFiles(workspaceFilesBefore)
      const historyBefore = await getHistoryForSave(activeSaveId)
      const nextTurn = maxTurn + 1
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
        // Reject any pending ask_user requests from the previous turn.
        rejectAllInteractionRequests(new DOMException("Agent Runtime turn aborted.", "AbortError"))
      }
      const currentController = new AbortController()
      previousTurnController = currentController

      try {
        workspaceTransaction = createRuntimeWorkspaceTransaction(
          await listEffectiveWorkspaceFilesForActiveSave(activeSaveId),
        )
        const activeWorkspaceTransaction = workspaceTransaction
        const providerPresetMap = buildAgentProviderPresetMap(
          activeWorkspaceTransaction.workspaceFiles,
        )
        // 读玩家回合入口 agent 会话上下文快照注入（无则由 runtime 层兜底初始化）。
        const agentContext = readAgentContextFromWorkspace(
          activeWorkspaceTransaction.workspaceFiles,
          activeSaveId,
          playerTurnAgentId,
        )
        // 按玩家回合入口 agent 的模型配置解析上下文 token 预算。
        const playerTurnConfig = resolveAgentModelConfig(playerTurnAgentId, providerPresetMap)
        const contextTokenBudget = resolveTokenBudget(
          playerTurnConfig?.parameters.common.contextWindow ?? null,
        )
        // 过程节点累积器:从事件流累积 thought/tool/interim,turn 收尾写入 turn 文件.
        // 与前端 turnProcessLog 用同一份事件数据,节点带 agentId 区分 delegated agent.
        const timelineCollector = createTurnTimelineCollector()
        const result = await runAgentRuntimeTurn(
          {
            agentId: playerTurnAgentId,
            userInput: content,
            injection: input.injection,
            recentHistory: historyBefore,
            turn: maxTurn,
            workspaceFiles: workspaceTransaction.workspaceFiles,
            signal: currentController.signal,
            agentContext: agentContext ?? undefined,
            contextTokenBudget,
            // 玩家正式回合入口使用 narrative 压缩：one-shot narrative compression +
            // ContextBudgetExhaustedError fallback (tool-token-budget R2, unchanged).
            // No timeoutMs — narrative turns rely on one-shot compression + user abort;
            // a timeout would mis-kill narrative deep thought (design §0/§1.3 约束8).
            compressionMode: "narrative",
            // 三个回调同时 emit 事件(给前端实时渲染)+ 喂 collector(给 turn 文件持久化).
            onDelta: (agentId, delta, round, kind) => {
              emitTurnDelta(agentId, delta, nextTurn, round, kind)
              timelineCollector.onDelta(agentId, delta, round, kind)
            },
            onRoundEnd: (agentId, round, finishReason) => {
              emitTurnRoundEnd(agentId, nextTurn, round, finishReasonToKind(finishReason))
              timelineCollector.onRoundEnd(agentId, round, finishReason)
            },
            onTool: (agentId, round, callId, name, status, output) => {
              emitTurnTool(agentId, nextTurn, round, callId, name, status, output)
              timelineCollector.onTool(agentId, round, callId, name, status, output)
            },
            onAskUser: (requestId, request) => emitInteractionRequest(requestId, request.question, request.options, request.allowCustom),
          },
          {
            callModel(messages, options) {
              const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
              // Text-protocol streaming: stream when the caller wants deltas
              // AND the model opted into streaming. Falls back to one-shot
              // generateAssistantReply otherwise. Mirrors the native gate in
              // callModelNative below.
              const streamingEnabled = agentConfig
                ? agentConfig.streaming
                : getBrowserAiConfig()?.streaming ?? false
              if (!options.onDelta || !streamingEnabled) {
                return generateAssistantReply(messages, {
                  debugLabel: options.debugLabel,
                  signal: options.signal,
                  ...(agentConfig ? { config: agentConfig } : {}),
                })
              }
              return streamAssistantReplyText(messages, {
                debugLabel: options.debugLabel,
                signal: options.signal,
                round: options.round,
                ...(agentConfig ? { config: agentConfig } : {}),
                onDelta: options.onDelta
                  ? (delta, round, kind) => options.onDelta!(options.agentId ?? playerTurnAgentId, delta, round, kind)
                  : undefined,
              })
            },
            async callModelNative(messages, options, tools) {
              const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
              // Stream only when the caller wants deltas AND the model opted into
              // streaming. Both native and text modes support streaming; falls
              // back to the global config's flag when this agent has no preset.
              const streamingEnabled = agentConfig
                ? agentConfig.streaming
                : getBrowserAiConfig()?.streaming ?? false
              if (!options.onDelta || !streamingEnabled) {
                return generateAssistantReplyNative(messages as RuntimeChatMessage[], {
                  debugLabel: options.debugLabel,
                  signal: options.signal,
                  tools,
                  ...(agentConfig ? { config: agentConfig } : {}),
                })
              }
              return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
                debugLabel: options.debugLabel,
                signal: options.signal,
                tools,
                // ai.ts onDelta is (delta, round, kind); adapt the runtime's
                // (agentId, delta, round, kind) signature by binding options.agentId
                // (the current entry agent id or a delegated target id).
                onDelta: options.onDelta
                  ? (delta, round, kind) => options.onDelta!(options.agentId ?? playerTurnAgentId, delta, round, kind)
                  : undefined,
                round: options.round,
                ...(agentConfig ? { config: agentConfig } : {}),
              })
            },
            toolCallMode: playerTurnConfig?.toolCallMode
              ?? getBrowserAiConfig()?.toolCallMode
              ?? "text",
            ...createBrowserScriptRunners({
              workspaceTransaction: activeWorkspaceTransaction,
              signal: currentController.signal,
              emitTrace: trace.emit,
            }),
            semanticSearchOwnerId: activeSaveId,
            workspaceMutations: {
              write: (writeInput) => {
                if (writeInput.scope === "platform-meta") {
                  return activeWorkspaceTransaction.writePlatformFile({
                    path: writeInput.path,
                    content: writeInput.content,
                    ...(writeInput.data ? { data: writeInput.data } : {}),
                  })
                }
                if (writeInput.scope !== "save-runtime") {
                  throw new Error("Runtime Agent turns can only stage save-runtime workspace writes.")
                }
                return activeWorkspaceTransaction.write({
                  path: writeInput.path,
                  content: writeInput.content,
                  ...(writeInput.data ? { data: writeInput.data } : {}),
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

        // 剧情选项剥离:从 replyText 提取 [[选项]]块 → options(给前端渲染按钮)
        // + cleanReply(存入 snapshot/turn 文件/context.json,agent 上下文干净).
        // 剥离单点:下游 snapshot/turn 文件/context.json 全部用 cleanReply,零冗余.
        const { options: storyOptions, cleanText: cleanReply } = extractStoryOptions(result.replyText)

        const nextHistory: ConversationMessageRecord[] = [
          ...historyBefore,
          { role: "user", content },
          { role: "assistant", content: cleanReply },
        ]

        // 本轮 token usage（来自 runtime 最后一轮 model call）。
        // 耗时由前端自己计时（setInterval），不在此处记录。
        const usage = result.usage
        const turnStats: TurnStats | undefined = usage
          ? {
              ...(usage.input !== undefined ? { inputTokens: usage.input } : {}),
              ...(usage.output !== undefined ? { outputTokens: usage.output } : {}),
              ...(usage.total !== undefined ? { totalTokens: usage.total } : {}),
            }
          : undefined

        // 拼 turn 完整 timeline: user → process items(interim/thought/tool) → assistant(带 stats) → options
        // 单一有序数组,顺序即发生顺序,替代旧的 messages + processNodes + stats 分裂结构.
        const turnTimeline: TurnTimelineItem[] = [
          { kind: "user", content },
          ...timelineCollector.getTimelineItems(),
          { kind: "assistant", content: cleanReply, ...(turnStats ? { stats: turnStats } : {}) },
          ...(storyOptions.length > 0 ? [{ kind: "options" as const, items: storyOptions }] : []),
        ]

        stageRawAirpHistoryTurnFile(workspaceTransaction, {
          turn: nextTurn,
          entryAgentId: playerTurnAgentId,
          timeline: turnTimeline,
        })
        // 通知前端 token 消耗（耗时由前端自己计时，不在此 emit）。
        if (turnStats) emitTurnStats(nextTurn, turnStats)
        // R4:写回玩家回合入口 agent 会话上下文快照（本轮正文追加 + 压缩结果落盘）.
        // contextUpdate.assistant 是原始 replyText(含选项块),改传 cleanReply 保持上下文干净.
        const contextUpdate = result.contextUpdate
        if (contextUpdate) {
          const stagedContext = stageAgentContextFile(workspaceTransaction, {
            saveId: activeSaveId,
            turn: contextUpdate.turn,
            user: contextUpdate.user,
            assistant: cleanReply,
            compressedContext: contextUpdate.compressedContext,
            agentId: playerTurnAgentId,
          })
          trace.emit({
            type: "agent_context_staged",
            ok: true,
            data: {
              turn: contextUpdate.turn,
              path: stagedContext.path,
              summaryPresent: !!contextUpdate.compressedContext?.summary,
            },
          })
        }

        // 剧情选项:有则 emit turn-options 事件,前端缓存后 finalizeTurn 渲染按钮.
        if (storyOptions.length > 0) {
          emitTurnOptions(nextTurn, storyOptions)
        }

        trace.emit({
          type: "turn_completed",
          ok: true,
          data: {
            replyLength: cleanReply.length,
            historyCount: nextHistory.length,
            storyOptions: storyOptions.length,
          },
        })
        stageRuntimeTraceFile(
          workspaceTransaction,
          formatRuntimeTracePath(nextTurn),
          trace.events,
        )

        await commitSuccessfulRuntimeTurnForSave(activeSaveId, {
          history: nextHistory,
          workspaceFiles: workspaceTransaction.finalWorkspaceFiles(),
          checkpointReason: "after-turn",
        })

        // Proactive embed enqueue:turn commit 是 play-time 真实写瓶颈(raw turn +
        // maintenance 都 staged → 经此 commit),落库后对当轮 save-runtime 文件做
        // staleness 检查 + 异步入队,让索引每轮后自动追新,不等下次搜索才补.
        // fire-and-forget:turn 已落盘完成,enqueue 失败不阻塞,staleness 兜底兜得住.
        if (resolveEmbeddingConfig()) {
          const saveRuntimeFiles = workspaceTransaction
            .finalWorkspaceFiles()
            .filter((file) => file.path.startsWith("save/"))
          void enqueueStaleEmbeddings(activeSaveId, saveRuntimeFiles)
        }

        emitTurnDebugReady(nextTurn)
        return {}
      } catch (error) {
        workspaceTransaction?.discard()
        // Reject any pending ask_user requests when the turn fails.
        rejectAllInteractionRequests(error)
        trace.emit({
          type: "turn_failed",
          ok: false,
          data: errorToTraceDataWithStack(error),
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
    async invokeAgent(input: InvokeAgentRequest): Promise<InvokeAgentResult> {
      const agentId = input.agentId.trim()
      if (!agentId) {
        throw new Error("interaction.invokeAgent requires a non-empty agentId.")
      }
      const userInput = input.input
      if (!userInput) {
        throw new Error("interaction.invokeAgent requires non-empty input.")
      }
      const invocationId = input.invocationId?.trim() || createInvocationId()
      const purpose = input.purpose?.trim() || undefined
      const commitMode = input.commitMode ?? "workspace"
      if (input.checkpointReason !== undefined && commitMode === "workspace") {
        throw new Error(
          "interaction.invokeAgent checkpointReason requires commitMode workspace-with-checkpoint.",
        )
      }
      // workspace-with-checkpoint 的 checkpointReason 校验（MVP）：
      // - 省略 → 默认 "post-turn-maintenance"。
      // - 提供 → 必须是非空字符串且等于 "post-turn-maintenance"（未知值 fail loud，不静默落库）。
      if (commitMode === "workspace-with-checkpoint") {
        if (
          input.checkpointReason !== undefined &&
          input.checkpointReason !== "post-turn-maintenance"
        ) {
          throw new Error(
            "interaction.invokeAgent checkpointReason must be \"post-turn-maintenance\" (MVP); unknown values are rejected.",
          )
        }
      }

      const slot = input.contextSlot
      const shouldPersist = input.persist === true
      const queueKey = `${agentId}:${slot ?? "default"}`

      // 同 slot 串行排队：前一个完成（成功/失败）后后一个才开始执行，
      // 确保 context.json 读写不竞争。不同 slot 或不同 agent 可真并行。
      const previous = invokeAgentQueue.get(queueKey) ?? Promise.resolve()
      const currentPromise = previous
        .catch(() => {})
        .then(() => executeInvokeAgentBody())
      invokeAgentQueue.set(queueKey, currentPromise)
      currentPromise.finally(() => {
        if (invokeAgentQueue.get(queueKey) === currentPromise) {
          invokeAgentQueue.delete(queueKey)
        }
      })
      return currentPromise as Promise<InvokeAgentResult>

      // ── 旁路调用实际执行体（闭包，捕获上方所有变量）──
      // invokeAgent 是旁路调用:不推进 turn、不写历史.
      // 结果直接返回调用方(游戏前端自行处理 NPC 视角/UI 修正等).
      async function executeInvokeAgentBody(): Promise<InvokeAgentResult> {
        const invokeController = new AbortController()
        const invokeTimestamp = Date.now()
        let activeSaveId: string | null = null
        let invokeWorkspaceFilesBefore: WorkspaceFile[] = []
        // 旁路调用 trace collector：独立路径落盘，不与主 turn trace 混淆。
        // 让系统监视器(DebugView)也能看到旁路调用的 runtime 事件。
        let trace = createRuntimeTraceCollector(0)
        let workspaceTransaction: RuntimeWorkspaceTransaction | null = null
        emitAgentInvocation({
          type: "started",
          invocationId,
          agentId,
          ...(purpose ? { purpose } : {}),
        })
        try {
          activeSaveId = await ensureActiveSave()
          const currentActiveSaveId = activeSaveId
          invokeWorkspaceFilesBefore = await listEffectiveWorkspaceFilesForActiveSave(currentActiveSaveId)
          const invokeMaxTurn = getMaxTurnFromTurnFiles(invokeWorkspaceFilesBefore)
          const historyBefore = await getHistoryForSave(currentActiveSaveId)
          trace = createRuntimeTraceCollector(invokeMaxTurn)
          trace.emit({
            type: "turn_started",
            ok: true,
            data: { agentId, inputLength: input.input.length, historyCount: historyBefore.length },
          })
          workspaceTransaction = createRuntimeWorkspaceTransaction(
            await listEffectiveWorkspaceFilesForActiveSave(currentActiveSaveId),
          )
          const workspaceFiles = workspaceTransaction!.workspaceFiles
          const providerPresetMap = buildAgentProviderPresetMap(workspaceFiles)

          // 装配目标 agent context,检查 agent 存在.
          const targetContext = assembleAgentContext(workspaceFiles, { agentId })
          if (!targetContext) {
            throw new Error(
              `Agent "${agentId}" was not found. Restore agents/${agentId}/AGENT.md or recreate the agent.`,
            )
          }

          // 持久化由 persist 参数控制(默认 false,不读 entryMode)。
          // persist:true → 读写 context-<slot>.json;persist:false → 不读不写,调完即弃。
          const agentContext = shouldPersist
            ? readAgentContextFromWorkspace(workspaceFiles, currentActiveSaveId, agentId, slot)
            : null

          // resolve target agent 上下文 token 预算.
          const targetConfig = resolveAgentModelConfig(agentId, providerPresetMap)
          const contextTokenBudget = resolveTokenBudget(
            targetConfig?.parameters.common.contextWindow ?? null,
          )

          const result = await runAgentRuntimeTurn(
            {
              agentId,
              userInput,
              injection: input.injection,
              recentHistory: historyBefore,
              turn: invokeMaxTurn,
              workspaceFiles,
              signal: invokeController.signal,
              agentContext: agentContext ?? undefined,
              contextTokenBudget,
              // 旁路调用用 task 模式压缩(工具交互段压缩,不压剧情正文).
              compressionMode: "task",
              ...(shouldPersist
                ? {
                    timeoutMs: DEFAULT_TASK_INACTIVITY_TIMEOUT_MS,
                  }
                : {}),
              // 旁路调用绑 onAskUser 以防目标 agent 需要 ask_user
              // (复用进程内 interaction-events 总线).
              // 旁路 agent 活动信号通过独立的 invocation 事件通道 emit。
              onDelta: (emittingAgentId, delta, round, kind) => {
                emitAgentInvocation({
                  type: "delta",
                  invocationId,
                  agentId: emittingAgentId,
                  round,
                  kind,
                  delta,
                })
              },
              onRoundEnd: (emittingAgentId, round, finishReason) => {
                emitAgentInvocation({
                  type: "round-end",
                  invocationId,
                  agentId: emittingAgentId,
                  round,
                  kind: finishReasonToKind(finishReason),
                })
              },
              onTool: (emittingAgentId, round, callId, name, status, output) => {
                emitAgentInvocation({
                  type: "tool",
                  invocationId,
                  agentId: emittingAgentId,
                  round,
                  callId,
                  name,
                  status,
                  ...(output !== undefined ? { output } : {}),
                })
              },
              onAskUser: (requestId, request) =>
                emitInteractionRequest(requestId, request.question, request.options, request.allowCustom),
            },
            {
              callModel(messages, options) {
                const modelConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
                const streamingEnabled = modelConfig
                  ? modelConfig.streaming
                  : getBrowserAiConfig()?.streaming ?? false
                if (!options.onDelta || !streamingEnabled) {
                  return generateAssistantReply(messages, {
                    debugLabel: options.debugLabel,
                    signal: options.signal,
                    ...(modelConfig ? { config: modelConfig } : {}),
                  })
                }
                return streamAssistantReplyText(messages, {
                  debugLabel: options.debugLabel,
                  signal: options.signal,
                  round: options.round,
                  ...(modelConfig ? { config: modelConfig } : {}),
                  onDelta: options.onDelta
                    ? (delta, round, kind) => options.onDelta!(options.agentId ?? agentId, delta, round, kind)
                    : undefined,
                })
              },
              async callModelNative(messages, options, tools) {
                const modelConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
                const streamingEnabled = modelConfig
                  ? modelConfig.streaming
                  : getBrowserAiConfig()?.streaming ?? false
                if (!options.onDelta || !streamingEnabled) {
                  return generateAssistantReplyNative(messages as RuntimeChatMessage[], {
                    debugLabel: options.debugLabel,
                    signal: options.signal,
                    tools,
                    ...(modelConfig ? { config: modelConfig } : {}),
                  })
                }
                return streamAssistantReplyNative(messages as RuntimeChatMessage[], {
                  debugLabel: options.debugLabel,
                  signal: options.signal,
                  tools,
                  onDelta: options.onDelta
                    ? (delta, round, kind) => options.onDelta!(options.agentId ?? agentId, delta, round, kind)
                    : undefined,
                  round: options.round,
                  ...(modelConfig ? { config: modelConfig } : {}),
                })
              },
              emitTrace: trace.emit,
              toolCallMode: targetConfig?.toolCallMode
                ?? getBrowserAiConfig()?.toolCallMode
                ?? "text",
              ...createBrowserScriptRunners({
                workspaceTransaction: workspaceTransaction!,
                signal: invokeController.signal,
              }),
              actionExecutorPolicy: undefined,
              // 旁路调用也接入 workspace mutation 适配器——agent 的 skill 脚本
              // (如 commit_opening_understanding)和 workspace_write 工具都需要写入能力。
              // 事务已在上方创建(同一 workspaceTransaction)，写入会随事务一起 commit。
              workspaceMutations: {
                write: (writeInput) => {
                  if (writeInput.scope === "platform-meta") {
                    return workspaceTransaction!.writePlatformFile({
                      path: writeInput.path,
                      content: writeInput.content,
                      ...(writeInput.data ? { data: writeInput.data } : {}),
                    })
                  }
                  if (writeInput.scope !== "save-runtime") {
                    throw new Error("Runtime Agent turns can only stage save-runtime workspace writes.")
                  }
                  return workspaceTransaction!.write({
                    path: writeInput.path,
                    content: writeInput.content,
                    ...(writeInput.data ? { data: writeInput.data } : {}),
                  })
                },
                delete: (deleteInput) => {
                  if (deleteInput.scope !== "save-runtime") {
                    throw new Error("Runtime Agent turns can only stage save-runtime workspace deletes.")
                  }
                  return {
                    scope: deleteInput.scope,
                    ...workspaceTransaction!.delete(deleteInput.path),
                  }
                },
              },
              exposedWorkspaceOperations: undefined,
              collaborationPolicy: undefined,
              semanticSearchOwnerId: currentActiveSaveId,
            },
          )

          // persist:true → 写回 context-<slot>.json(不推进 turn、不写历史、不更新 snapshot).
          // persist:false → 不写 context,调完即弃.工作区写入(若有)用同一事务提交.
          if (shouldPersist && result.contextUpdate) {
            stageAgentContextFile(workspaceTransaction!, {
              saveId: currentActiveSaveId,
              turn: result.contextUpdate.turn,
              user: result.contextUpdate.user,
              assistant: result.replyText,
              compressedContext: result.contextUpdate.compressedContext,
              agentId,
              slot,
            })
          }
          // 旁路 trace 落盘（独立路径，不与主 turn trace 混淆）
          trace.emit({
            type: "turn_completed",
            ok: true,
            data: { agentId, replyLength: result.replyText.length },
          })
          // trace 走事务提交（与主 turn 一致），用旁路专用路径
          workspaceTransaction!.writePlatformFile({
            path: formatAgentTracePath(agentId, invokeTimestamp),
            content: serializeRuntimeTraceEvents(trace.events),
          })
          await (commitMode === "workspace-with-checkpoint"
            ? commitWorkspaceFilesWithCheckpointForSave(
                currentActiveSaveId,
                workspaceTransaction!.finalWorkspaceFiles(),
                { turn: invokeMaxTurn, checkpointReason: "post-turn-maintenance" },
              )
            : commitWorkspaceFilesForSave(
                currentActiveSaveId,
                workspaceTransaction!.finalWorkspaceFiles(),
              ))
          emitAgentInvocation({ type: "completed", invocationId, agentId })

          return { invocationId, response: result.replyText }
        } catch (error) {
          workspaceTransaction?.discard()
          emitAgentInvocation({
            type: "failed",
            invocationId,
            agentId,
            error: platformErrorFromUnknown(error),
          })
          rejectAllInteractionRequests(error)
          // 旁路 trace 失败落盘（事务已 discard，直接写文件系统）
          trace.emit({
            type: "turn_failed",
            ok: false,
            data: errorToTraceDataWithStack(error),
          })
          if (activeSaveId) {
            try {
              await writeRuntimeTraceFileForSave(
                activeSaveId,
                invokeWorkspaceFilesBefore,
                formatAgentTracePath(agentId, invokeTimestamp),
                trace.events,
              )
            } catch {
              // trace 落盘失败不掩盖原始错误
            }
          }
          throw error
        }
      }
    },

    /** 中断当前正在进行的 turn（流式输出/工具执行）。
     *  abort 触发后，sendMessage 的 promise 会以 AbortError reject，
     *  前端 onTurnEnd 不会触发——由 useTsian.stop 负责把前端状态切回 standby。
     *  无 turn 进行中时空操作（幂等）。 */
    async stop(): Promise<void> {
      if (previousTurnController) {
        previousTurnController.abort("user-stopped")
        rejectAllInteractionRequests(new DOMException("Agent Runtime turn aborted by user.", "AbortError"))
      }
    },
  },
  debug: createDebugBridge(),
}


export {
  runAssistantChat,
  type AssistantChatInput,
  type AssistantChatResult,
} from "./assistant-chat"
export {
  setPlatformGameCardCover,
  type PlatformGameCardCoverInput,
} from "./covers"
export {
  listPlatformWorkspaceDirectory,
  listPlatformWorkspaceRoots,
  searchPlatformWorkspace,
  readPlatformWorkspaceFile,
  writePlatformWorkspaceFile,
  deletePlatformWorkspacePath,
  copyPlatformWorkspacePath,
  movePlatformWorkspacePath,
  validatePlatformWorkspaceFile,
  type PlatformWorkspaceRootEntry,
} from "./workspace-ops"
export {
  getPlatformStudioSnapshot,
  getPlatformStudioAgentContext,
  getPlatformStudioSkillDetail,
  writePlatformStudioAgentFile,
  updatePlatformStudioAgentSkillEnabled,
  deletePlatformStudioSkill,
  updatePlatformStudioAgentPlatformToolEnabled,
  updatePlatformStudioAgentToolEnabled,
  updatePlatformStudioAgentWorkspaceAccess,
  updatePlatformStudioAgentProviderPreset,
  isPlatformStudioToolEnabledForAgent,
  type PlatformStudioSnapshot,
  type PlatformStudioProviderPresetOption,
  type PlatformStudioAgentFileWriteInput,
  type PlatformStudioAgentSkillToggleInput,
  type PlatformStudioAgentSkillDeleteInput,
  type PlatformStudioAgentPlatformToolToggleInput,
  type PlatformStudioAgentToolToggleInput,
  type PlatformStudioAgentWorkspaceAccessInput,
  type PlatformStudioAgentProviderPresetInput,
} from "./studio-agents"
export {
  getLocalAssistantProviderPreset,
  updateLocalAssistantProviderPreset,
  updateLocalAssistantModel,
  getLocalAssistantConfig,
  updateLocalAssistantSkillEnabled,
  updateLocalAssistantSkillConfig,
  updateLocalAssistantPlatformToolEnabled,
  updateLocalAssistantWorkspaceAccess,
  getLocalAssistantToolCallMode,
  type LocalAssistantConfig,
  type LocalAssistantSkillToggleInput,
  type LocalAssistantPlatformToolToggleInput,
} from "./local-assistant"
export {
  initializePlatformHost,
  listPlatformSaves,
  createPlatformSave,
  listPlatformGameCards,
  getPlatformGameCard,
  updatePlatformGameCardMetadata,
  copyPlatformGameCardAsLocal,
  createDefaultPlatformGameCard,
  deletePlatformGameCard,
  listPlatformGameCardFrontendFiles,
  updatePlatformGameCardFrontend,
  importPlatformGameCardPackage,
  exportPlatformGameCardPackage,
  importPlatformGameCardFrontendPackage,
  exportPlatformGameCardFrontendPackage,
  createPlatformSaveFromGameCard,
  selectPlatformSave,
  renamePlatformSave,
  deletePlatformSave,
  getPlatformActiveSaveId,
  getPlatformActiveGameCardId,
  setPlatformActiveGameCard,
  type PlatformGameCardFrontendFileSummary,
  type PlatformGameCardMetadataInput,
  type PlatformGameCardCopyInput,
  type PlatformGameCardDeleteResult,
} from "./game-cards"
export {
  exportAgentPackage,
  exportSkillPackage,
  inspectResourcePackage,
  installAgentPackage,
  installSkillPackage,
  replaceCardContentDirectory,
  replaceAssistantDefinition,
  replaceAssistantSkillDirectory,
  type AgentPackageSource,
  type SkillPackageSource,
  type AgentInstallTarget,
  type SkillInstallTarget,
  type ResourcePackageInspection,
} from "./resource-packages"
export { getPlatformActiveGameCard, waitForPlatformHostReady }
