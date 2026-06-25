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
  WorkspaceWriteResult,
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
  AGENT_CONTEXT_PATH,
  appendTurnToContext,
  ASSISTANT_CONTEXT_AGENT_ID,
  ASSISTANT_CONTEXT_SCHEMA,
  createEmptyAgentContext,
  createInitialAgentContext,
  DEFAULT_TASK_TIMEOUT_MS,
  parseAgentContext,
  resolveTokenBudget,
  serializeAgentContext,
  TaskTimeoutError,
} from "../agent-runtime/context-lifecycle"
import { buildRuntimeDiagnostics } from "../agent-runtime/diagnostics"
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
  formatRuntimeTracePath,
  serializeRuntimeTraceEvents,
} from "../agent-runtime/trace"
import {
  AUTHORING_WORKSPACE_OPERATIONS,
  executeWorkspaceOperation,
} from "../agent-runtime/workspace-operations"
import { createDebugBridge, resolveRemoteFrontendUrl } from "../bridge"
import { emitTurnDebugReady } from "../debug-events"
import { emitTurnDelta, emitTurnRoundEnd, emitTurnTool } from "../streaming-events"
import { emitInteractionRequest, rejectAllInteractionRequests } from "../interaction-events"
import {
  getBaseBridge,
  getRuntimeEngine,
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
import { ensureActiveSave, formatActiveFrontendId, getPlatformActiveGameCardId } from "./game-cards"
import { executeWorkspaceMutation } from "./workspace-volumes"
import {
  readAgentContextFromWorkspace,
  stageAgentContextFile,
  stageRawAirpHistoryTurnFile,
} from "./history-turns"
import {
  generateAssistantReply,
  generateAssistantReplyNative,
  streamAssistantReplyNative,
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
import { createBrowserSkillScriptRunner } from "./browser-skill-script-executor"
import {
  commitSuccessfulRuntimeTurnForSave,
  createRuntimeWorkspaceTransaction,
  createEmptyRuntimeSnapshot,
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
  getSnapshotForSave,
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
import {
  BUILTIN_BLANK_GAME_CARD_ID,
} from "../storage/game-cards"
import {
  DEFAULT_FRONTEND_BINDING,
  defaultFrontendFiles,
} from "../storage/default-frontend-files"

let previousTurnController: AbortController | null = null



/**
 * Map a model-call finish reason to the `turn-round-end` kind so the play
 * frontend can classify streamed `turn-delta` text: a `tool_calls` round is a
 * thought round (its text is the reasoning stream); a `stop` round is the
 * final reply. See `06-19-ai-agent-process-visible` design §3.
 */
function finishReasonToKind(finishReason: "stop" | "tool_calls"): "thought" | "final" {
  return finishReason === "tool_calls" ? "thought" : "final"
}

function cloneSnapshot(snapshot: RuntimeSnapshotShell): RuntimeSnapshotShell {
  return JSON.parse(JSON.stringify(snapshot)) as RuntimeSnapshotShell
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
        return executeWorkspaceMutation({
          scope: writeInput.scope,
          path: writeInput.path,
          content: writeInput.content,
          data: writeInput.data,
          ownerContext: { saveId, cardId },
          operation: "write",
        }) as Promise<WorkspaceFile>
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

    const snapshot = await restoreCheckpointForSave(activeSaveId, checkpointId.trim())
    if (!snapshot) {
      return actionError(
        "CHECKPOINT_NOT_FOUND",
        "指定的 checkpoint 不存在。",
        { checkpointId: checkpointId.trim() },
      )
    }

    getRuntimeEngine().loadSnapshot(snapshot)
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
  runtime: getBaseBridge().runtime,
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

      return getBaseBridge().query.query(request)
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
        // 读 master agent 会话上下文快照注入(无则 null,runtime 层兜底初始化)
        const agentContext = readAgentContextFromWorkspace(
          activeWorkspaceTransaction.workspaceFiles,
          activeSaveId,
        )
        // resolve master agent 上下文 token 预算(model.contextWindow 或 256k 默认)
        const masterConfig = resolveAgentModelConfig("master", providerPresetMap)
        const contextTokenBudget = resolveTokenBudget(
          masterConfig?.parameters.contextWindow ?? null,
        )
        const result = await runAgentRuntimeTurn(
          {
            agentId: "master",
            userInput: content,
            recentHistory: historyBefore,
            snapshot: snapshotBefore,
            workspaceFiles: workspaceTransaction.workspaceFiles,
            signal: currentController.signal,
            agentContext: agentContext ?? undefined,
            contextTokenBudget,
            // Master is a narrative-type agent: one-shot narrative compression +
            // ContextBudgetExhaustedError fallback (tool-token-budget R2, unchanged).
            // No timeoutMs — master relies on one-shot compression + user abort,
            // a timeout would mis-kill narrative deep thought (design §0/§1.3 约束8).
            compressionMode: "narrative",
            onDelta: (agentId, delta, round, kind) => emitTurnDelta(agentId, delta, nextTurn, round, kind),
            onRoundEnd: (agentId, round, finishReason) => emitTurnRoundEnd(agentId, nextTurn, round, finishReasonToKind(finishReason)),
            onTool: (agentId, round, callId, name, status, output) => emitTurnTool(agentId, nextTurn, round, callId, name, status, output),
            onAskUser: (requestId, request) => emitInteractionRequest(requestId, request.question, request.options, request.allowCustom),
          },
          {
            callModel(messages, options) {
              const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
              return generateAssistantReply(messages, {
                debugLabel: options.debugLabel,
                signal: options.signal,
                ...(agentConfig ? { config: agentConfig } : {}),
              })
            },
            async callModelNative(messages, options, tools) {
              const agentConfig = resolveAgentModelConfig(options.agentId, providerPresetMap)
              // Stream only when the caller wants deltas AND the model opted into
              // streaming (text-protocol models force false). Falls back to the
              // global config's flag when this agent has no preset mapping.
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
                // (the entry agent id "master" or a delegated target id).
                onDelta: options.onDelta
                  ? (delta, round, kind) => options.onDelta!(options.agentId ?? "master", delta, round, kind)
                  : undefined,
                round: options.round,
                ...(agentConfig ? { config: agentConfig } : {}),
              })
            },
            toolCallMode: resolveAgentModelConfig("master", providerPresetMap)?.toolCallMode
              ?? getBrowserAiConfig()?.toolCallMode
              ?? "text",
            runBrowserScript: createBrowserSkillScriptRunner({
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
          entryAgentId: "master",
          userInput: content,
          assistantOutput: result.replyText,
        })
        // R4:写回 master agent 会话上下文快照(本轮正文追加 + 压缩结果落盘)
        const contextUpdate = result.contextUpdate
        if (contextUpdate) {
          const stagedContext = stageAgentContextFile(workspaceTransaction, {
            saveId: activeSaveId,
            turn: contextUpdate.turn,
            user: contextUpdate.user,
            assistant: contextUpdate.assistant,
            compressedContext: contextUpdate.compressedContext,
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

        getRuntimeEngine().loadSnapshot(snapshotAfter)
        await commitSuccessfulRuntimeTurnForSave(activeSaveId, {
          snapshot: snapshotAfter,
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

        emitTurnDebugReady(snapshotAfter.state.turn)
        return { snapshot: snapshotAfter }
      } catch (error) {
        getRuntimeEngine().loadSnapshot(snapshotBefore)
        workspaceTransaction?.discard()
        // Reject any pending ask_user requests when the turn fails.
        rejectAllInteractionRequests(error)
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
  updatePlatformStudioAgentPlatformToolEnabled,
  updatePlatformStudioAgentWorkspaceAccess,
  updatePlatformStudioAgentProviderPreset,
  type PlatformStudioSnapshot,
  type PlatformStudioProviderPresetOption,
  type PlatformStudioAgentFileWriteInput,
  type PlatformStudioAgentSkillToggleInput,
  type PlatformStudioAgentPlatformToolToggleInput,
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
export { getPlatformActiveGameCard, waitForPlatformHostReady }
