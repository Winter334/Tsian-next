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
  WorkspacePatchResult,
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
import {
  getBaseBridge,
  getRuntimeEngine,
  markPlatformHostReady,
  waitForPlatformHostReady,
} from "./host-state"
import {
  buildAgentProviderPresetMap,
  cardContentFilesToWorkspaceFiles,
  deleteCardContentPathForActiveCard,
  ensureActiveGameCardId,
  getPlatformActiveGameCard,
  gameCardForSave,
  listEffectiveWorkspaceFilesForActiveSave,
  normalizeMessageContent,
  resolveAgentModelConfig,
  writeCardContentFileForActiveCard,
  writeCardContentFileForCard,
} from "./internal"
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
  deleteWorkspacePathForSave,
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
  writeWorkspaceFileForSave,
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

const AIRP_HISTORY_TURN_SCHEMA = "tsian.airp.history.turn.v1"
const AIRP_HISTORY_TURN_PATH_PREFIX = "save/history/turns/"


export interface PlatformGameCardFrontendFileSummary {
  path: string
  mediaType: string
  size: number
  updatedAt: number
}

export interface PlatformStudioProviderPresetOption {
  id: string
  name: string
}

export interface PlatformStudioSnapshot {
  card: LocalGameCardRecord
  activeSaveId?: string
  usingSaveContext: boolean
  agents: AgentRegistryEntry[]
  skills: SkillRegistryEntry[]
  providerPresets: PlatformStudioProviderPresetOption[]
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

export interface PlatformStudioAgentProviderPresetInput {
  agentId: string
  providerPresetId: string | null
}

export interface LocalAssistantSkillToggleInput {
  skillPath: string
  enabled: boolean
}

export interface LocalAssistantPlatformToolToggleInput {
  tool: AgentPlatformToolName
  enabled: boolean
}


interface RawAirpHistoryTurnRecord {
  schema: typeof AIRP_HISTORY_TURN_SCHEMA
  turn: number
  createdAt: string
  source: {
    kind: "agent-runtime"
    entryAgentId: string
  }
  messages: ConversationMessageRecord[]
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
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
  entryAgentId: string,
  userInput: string,
  assistantOutput: string,
): string {
  const record: RawAirpHistoryTurnRecord = {
    schema: AIRP_HISTORY_TURN_SCHEMA,
    turn,
    createdAt: createdAt.toISOString(),
    source: {
      kind: "agent-runtime",
      entryAgentId,
    },
    messages: [
      { role: "user", content: userInput },
      { role: "assistant", content: assistantOutput },
    ],
  }

  return `${JSON.stringify(record, null, 2)}\n`
}

/**
 * 从工作区文件读 master agent 会话上下文快照(agents/master/context.json).
 * 文件不存在/损坏 → 返回 null(由 runtime 层兜底初始化).
 */
function readAgentContextFromWorkspace(
  workspaceFiles: WorkspaceFile[],
  saveId: string,
): AgentContextSnapshot | null {
  const file = workspaceFiles.find((f) => f.path === AGENT_CONTEXT_PATH)
  if (!file) return null
  return parseAgentContext(file.content, saveId)
}

/**
 * turn 收尾:把本轮正文追加进 context.json,若本轮开头压缩了则用压缩后快照.
 * 原地更新(workspaceTransaction.write),与其它 stage 函数同事务提交.
 */
function stageAgentContextFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    saveId: string
    turn: number
    user: string
    assistant: string
    compressedContext?: AgentContextSnapshot
  },
): WorkspaceFile {
  // 基础快照:本轮压缩了→用压缩结果;否则读现有 context.json,无则空快照
  const base =
    input.compressedContext
    ?? readAgentContextFromWorkspace(workspaceTransaction.workspaceFiles, input.saveId)
    ?? createEmptyAgentContext(input.saveId)
  // 追加本轮正文(保持最近 K 轮),saveId 用真实值修正(runtime 兜底时可能为空)
  const updated = appendTurnToContext(
    { ...base, saveId: input.saveId },
    input.turn,
    input.user,
    input.assistant,
  )
  return workspaceTransaction.write({
    path: AGENT_CONTEXT_PATH,
    content: serializeAgentContext(updated),
    mediaType: "application/json",
  })
}

// ─────────────────────────────────────────────────────────────────────────
// 助手会话 context 虚拟文件读写(design 06-20-assistant-context-persistence)
// 对称 master 的 readAgentContextFromWorkspace/stageAgentContextFile,但从
// localAssistantFiles 读、写进 workspaceTransaction(搭便车 commitAssistantWorkspaceFiles
// → saveLocalAssistantFiles 合并落盘).每会话独立路径 sessions/<sessionId>/context.json.
// ─────────────────────────────────────────────────────────────────────────

function stageRawAirpHistoryTurnFile(
  workspaceTransaction: RuntimeWorkspaceTransaction,
  input: {
    turn: number
    entryAgentId: string
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
      input.entryAgentId,
      input.userInput,
      input.assistantOutput,
    ),
    mediaType: "application/json",
  })
}

async function activeSaveExists(saveId: string): Promise<boolean> {
  return (await listLocalSaves()).some((save) => save.id === saveId)
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

async function ensureActiveSave(): Promise<string> {
  const activeSaveId = await getActiveSaveId()
  if (activeSaveId && await activeSaveExists(activeSaveId)) {
    await syncActiveGameCardFromSave(activeSaveId)
    return activeSaveId
  }

  const created = await createLocalSave()
  await setActiveSaveId(created.id)
  await setActiveGameCardId(created.gameCardId ?? (await getBuiltinBlankGameCard()).id)
  getRuntimeEngine().loadSnapshot(await getSnapshotForSave(created.id))
  return created.id
}

async function restoreActiveSnapshotFromStorage(saveId: string): Promise<RuntimeSnapshotShell> {
  const snapshot = await getSnapshotForSave(saveId)
  getRuntimeEngine().loadSnapshot(snapshot)
  return snapshot
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

        emitTurnDebugReady(snapshotAfter.state.turn)
        return { snapshot: snapshotAfter }
      } catch (error) {
        getRuntimeEngine().loadSnapshot(snapshotBefore)
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
    getRuntimeEngine().loadSnapshot(createEmptyRuntimeSnapshot())
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
    // contentFiles undefined = leave the content table untouched (metadata-only write).
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
  const contentFiles = await listLocalGameCardContentFiles(card.id)
  const patch = metadataManifestPatch(input)
  const id = await createUniqueLocalGameCardId(patch.name)
  return putLocalGameCard({
    manifest: {
      ...card.manifest,
      ...patch,
      id,
    },
    contentFiles: contentFiles.map((file) => ({
      path: file.path,
      content: file.content,
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    })),
    frontendFiles: frontendFiles.map((file) => ({
      path: file.path,
      data: file.data,
      mediaType: file.mediaType,
    })),
    source: "local",
  })
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
      ...(file.mediaType ? { mediaType: file.mediaType } : {}),
    })),
    frontendFiles: defaultFrontendFiles(),
    source: "local",
  })

  // 3. Load the new card as the active game card.
  const active = await setPlatformActiveGameCard(record.id)
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
      getRuntimeEngine().loadSnapshot(createEmptyRuntimeSnapshot())
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
    // contentFiles undefined = leave the content table untouched (frontend-binding-only write).
    // When clearing the binding, also delete all packaged frontend files.
    // putLocalGameCard treats frontendFiles: [] as "delete all existing
    // frontend files for this card" (enters the delete branch, writes none).
    frontendFiles: normalizedFrontend ? undefined : [],
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
  return importGameCardFrontendPackage(cardId, input)
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
  await restoreActiveSnapshotFromStorage(created.id)
  return created
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
    getRuntimeEngine().loadSnapshot(createEmptyRuntimeSnapshot())
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
    files: await cardContentFilesToWorkspaceFiles(card),
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

  return {
    card,
    ...(context.activeSaveId ? { activeSaveId: context.activeSaveId } : {}),
    usingSaveContext: context.usingSaveContext,
    agents,
    skills,
    providerPresets: listBrowserAiProviderPresetOptions(),
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

export async function updatePlatformStudioAgentProviderPreset(
  input: PlatformStudioAgentProviderPresetInput,
): Promise<WorkspaceFile> {
  const card = await getPlatformActiveGameCard()
  if (!card) {
    throw new Error("当前没有加载游戏卡。")
  }

  const context = await activeStudioWorkspaceFiles(card)
  const agent = findStudioAgent(context.files, input.agentId)
  const configFile = agentConfigFileForAgent(context.files, agent)
  const config = parseAgentConfigRecord(configFile)

  const nextConfig: Record<string, unknown> = { ...config }
  const presetId = input.providerPresetId?.trim() ?? ""
  if (presetId) {
    nextConfig.providerPresetId = presetId
  } else {
    delete nextConfig.providerPresetId
  }

  return writeAgentConfigRecord(card.id, agent, nextConfig)
}

const LOCAL_ASSISTANT_AGENT_CONFIG_PATH = ".tsian/local/assistant/agent.json"

/**
 * Resolve the desktop assistant's workspace actor level from its agent.json
 * (`workspaceAccess.level`). The desktop assistant is the platform management
 * assistant — a high-trust actor distinct from runtime game agents — and its
 * configured level must drive workspace access decisions, not a hardcoded
 * fallback. Returns undefined when the config is missing/unparseable, so the
 * caller falls back to `resolveWorkspaceActorLevel`'s default (1).
 */
async function resolveLocalAssistantActorLevel(): Promise<number | undefined> {
  const files = await loadLocalAssistantFiles()
  const configFile = files.find((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  if (!configFile) {
    return undefined
  }
  try {
    const parsed = JSON.parse(configFile.content) as unknown
    const access = isRecord(parsed) && isRecord(parsed.workspaceAccess) ? parsed.workspaceAccess : undefined
    const level = access?.level
    return typeof level === "number" && Number.isFinite(level)
      ? Math.max(0, Math.min(4, Math.floor(level)))
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the local assistant's current provider preset id and available presets.
 * Used by the Assistant chat UI to render the provider selection control.
 */
export async function getLocalAssistantProviderPreset(): Promise<{
  providerPresetId: string
  presets: PlatformStudioProviderPresetOption[]
}> {
  const files = await loadLocalAssistantFiles()
  const configFile = files.find((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  let providerPresetId = ""
  if (configFile) {
    try {
      const parsed = JSON.parse(configFile.content) as unknown
      if (isRecord(parsed) && typeof parsed.providerPresetId === "string") {
        providerPresetId = parsed.providerPresetId
      }
    } catch {
      // Ignore parse errors; treat as no selection.
    }
  }
  return {
    providerPresetId,
    presets: listBrowserAiProviderPresetOptions(),
  }
}

/**
 * Update the local assistant's provider preset selection by rewriting
 * .tsian/local/assistant/agent.json via the Dexie meta store.
 */
export async function updateLocalAssistantProviderPreset(
  providerPresetId: string | null,
): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const presetId = providerPresetId?.trim() ?? ""

  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const nextConfig = { ...config }
    if (presetId) {
      nextConfig.providerPresetId = presetId
    } else {
      delete nextConfig.providerPresetId
    }
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify(nextConfig, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    // agent.json should always exist (seeded on first load), but handle gracefully.
    const nextConfig: Record<string, unknown> = {}
    if (presetId) {
      nextConfig.providerPresetId = presetId
    }
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify(nextConfig, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }

  await saveLocalAssistantFiles(files)
}

/**
 * Local assistant config snapshot consumed by the Assistant config panel.
 * `agent` is the resolved registry entry (skills/tools/workspace state);
 * `skills` lists every skill visible to the assistant (shared + agent-local);
 * `providerPresets` lists saved presets for the provider dropdown.
 */
export interface LocalAssistantConfig {
  agent: AgentRegistryEntry | null
  skills: SkillRegistryEntry[]
  providerPresets: PlatformStudioProviderPresetOption[]
}

/**
 * Read the local assistant's full config for the Assistant config panel.
 * Resolves the agent registry entry via `buildAgentRegistry`, the skill list
 * via `buildSkillRegistry` (shared + agent-local, same scope as StudioView),
 * and the saved provider presets for the dropdown.
 */
export async function getLocalAssistantConfig(): Promise<LocalAssistantConfig> {
  const files = await loadLocalAssistantFiles()
  const agent = buildAgentRegistry(files).find((candidate) => candidate.id === LOCAL_ASSISTANT_AGENT_ID) ?? null
  const skills = buildSkillRegistry(files, {
    includeShared: true,
    includeLocal: true,
    agentId: LOCAL_ASSISTANT_AGENT_ID,
  })
  return {
    agent,
    skills,
    providerPresets: listBrowserAiProviderPresetOptions(),
  }
}

/**
 * Toggle a skill on the local assistant by rewriting
 * `.tsian/local/assistant/agent.json` via the Dexie meta store.
 * Mirrors the card-agent setter but simplified for the fixed single assistant.
 */
export async function updateLocalAssistantSkillEnabled(
  input: LocalAssistantSkillToggleInput,
): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const skill = buildSkillRegistry(files).find((candidate) => candidate.path === normalizeWorkspaceFilePath(input.skillPath))
  if (!skill) {
    throw new Error(`Skill "${input.skillPath}" 不存在。`)
  }
  // agent-local skills can only be toggled by their owning agent; the local
  // assistant owns the `.tsian/local/assistant/skills/` tree, so reject others.
  if (skill.scope === "agent-local" && skill.agentId !== LOCAL_ASSISTANT_AGENT_ID) {
    throw new Error("这个 Agent 不能启用其它 Agent 目录下的 Skill。")
  }
  const existingAgent = buildAgentRegistry(files).find((candidate) => candidate.id === LOCAL_ASSISTANT_AGENT_ID)
  let enabledSkills = removeSkillReferences(existingAgent?.enabledSkills ?? [], skill)
  let disabledSkills = removeSkillReferences(existingAgent?.disabledSkills ?? [], skill)
  if (input.enabled) {
    const nextAgent = existingAgent
      ? { ...existingAgent, enabledSkills, disabledSkills }
      : null
    if (!nextAgent || !isSkillEnabledForAgent(skill, nextAgent)) {
      enabledSkills = appendSkillReference(enabledSkills, skill)
    }
  } else {
    const nextAgent = existingAgent
      ? { ...existingAgent, enabledSkills, disabledSkills }
      : null
    if (!nextAgent || isSkillEnabledForAgent(skill, nextAgent)) {
      disabledSkills = appendSkillReference(disabledSkills, skill)
    }
  }
  const nextSkills = { enabled: enabledSkills, disabled: disabledSkills }
  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const existingSkills = isRecord(config.skills) ? config.skills : {}
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify({ ...config, skills: { ...existingSkills, ...nextSkills } }, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify({ skills: nextSkills }, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }
  await saveLocalAssistantFiles(files)
}

/**
 * Toggle a platform tool on the local assistant by rewriting
 * `.tsian/local/assistant/agent.json` via the Dexie meta store.
 */
export async function updateLocalAssistantPlatformToolEnabled(
  input: LocalAssistantPlatformToolToggleInput,
): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const existingAgent = buildAgentRegistry(files).find((candidate) => candidate.id === LOCAL_ASSISTANT_AGENT_ID)
  let enabled = removePlatformToolReference(existingAgent?.platformTools.enabled ?? [], input.tool)
  let disabled = removePlatformToolReference(existingAgent?.platformTools.disabled ?? [], input.tool)
  if (input.enabled) {
    const nextAgent = existingAgent
      ? { ...existingAgent, platformTools: { enabled, disabled } }
      : null
    if (!nextAgent || !isAgentPlatformToolEnabled(nextAgent, input.tool)) {
      enabled = appendPlatformToolReference(enabled, input.tool)
    }
  } else {
    const nextAgent = existingAgent
      ? { ...existingAgent, platformTools: { enabled, disabled } }
      : null
    if (!nextAgent || isAgentPlatformToolEnabled(nextAgent, input.tool)) {
      disabled = appendPlatformToolReference(disabled, input.tool)
    }
  }
  const nextTools = { enabled, disabled }
  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const existingTools = isRecord(config.platformTools) ? config.platformTools : {}
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify({ ...config, platformTools: { ...existingTools, ...nextTools } }, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify({ platformTools: nextTools }, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }
  await saveLocalAssistantFiles(files)
}

/**
 * Set the local assistant's workspace access level by rewriting
 * `.tsian/local/assistant/agent.json` via the Dexie meta store.
 * The level is clamped to 0-4 by `normalizeWorkspaceAccessLevel`.
 */
export async function updateLocalAssistantWorkspaceAccess(level: number): Promise<void> {
  const files = await loadLocalAssistantFiles()
  const configIndex = files.findIndex((file) => file.path === LOCAL_ASSISTANT_AGENT_CONFIG_PATH)
  const nextLevel = normalizeWorkspaceAccessLevel(level)
  if (configIndex >= 0) {
    const config = parseAgentConfigRecord(files[configIndex])
    const existingAccess = isRecord(config.workspaceAccess) ? config.workspaceAccess : {}
    files[configIndex] = {
      ...files[configIndex],
      content: JSON.stringify({ ...config, workspaceAccess: { ...existingAccess, level: nextLevel } }, null, 2) + "\n",
      updatedAt: Date.now(),
    }
  } else {
    files.push({
      path: LOCAL_ASSISTANT_AGENT_CONFIG_PATH,
      content: JSON.stringify({ workspaceAccess: { level: nextLevel } }, null, 2) + "\n",
      mediaType: "application/json",
      createdAt: 0,
      updatedAt: Date.now(),
    })
  }
  await saveLocalAssistantFiles(files)
}

/**
 * Resolve the local assistant agent's currently effective tool-call mode.
 * Mirrors the resolution used by the chat turn: the selected provider preset's
 * primary model `toolCallMode`, falling back to the platform-global active
 * provider, then to `"text"`. Used by AssistantView to surface the active mode.
 */
export async function getLocalAssistantToolCallMode(): Promise<BrowserAiToolCallMode> {
  const files = await loadLocalAssistantFiles()
  const presetMap = buildAgentProviderPresetMap(files)
  const resolved = resolveAgentModelConfig(LOCAL_ASSISTANT_AGENT_ID, presetMap)
  return resolved?.toolCallMode ?? getBrowserAiConfig()?.toolCallMode ?? "text"
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
  patchPlatformWorkspaceFile,
  deletePlatformWorkspacePath,
  movePlatformWorkspacePath,
  validatePlatformWorkspaceFile,
  type PlatformWorkspaceRootEntry,
} from "./workspace-ops"
export { getPlatformActiveGameCard, waitForPlatformHostReady }
