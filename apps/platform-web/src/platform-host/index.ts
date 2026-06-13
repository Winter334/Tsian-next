import type {
  AgentContextEntry,
  AgentRegistryEntry,
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  PlatformActionError,
  PlatformActionRequest,
  PlatformActionResult,
  PlayFrontendBridge,
  RuntimeSnapshotShell,
  SkillDetailEntry,
  SkillRegistryEntry,
  WorkspaceFile,
} from "@tsian/contracts"
import { runAgentRuntimeTurn } from "../agent-runtime"
import { assembleAgentContext } from "../agent-runtime/context"
import { buildAgentRegistry, buildSkillRegistry, loadSkillDetail } from "../agent-runtime/registry"
import type { RuntimeTraceEmitter } from "../agent-runtime/trace"
import {
  createRuntimeTraceCollector,
  errorToTraceData,
  formatRuntimeTracePath,
  serializeRuntimeTraceEvents,
} from "../agent-runtime/trace"
import { createDebugBridge, createPlayFrontendBridge } from "../bridge"
import { emitTurnDebugReady } from "../debug-events"
import { LocalRuntimeEngine } from "../runtime-host"
import { generateAssistantReply, getAiDebugRecords } from "../runtime-host/ai"
import { createBrowserSkillScriptRunner } from "./browser-skill-script-executor"
import {
  createEmptyRuntimeSnapshot,
  createLocalSave,
  createCheckpointForSave,
  deleteLocalSave,
  getActiveSaveId,
  getHistoryForSave,
  getSnapshotForSave,
  initializeWorkspaceForSave,
  listCheckpointsForSave,
  listLocalSaves,
  listLocalStateRecordsForSave,
  listStateRecordsForSave,
  listWorkspaceEntriesForSave,
  listWorkspaceFilesForSave,
  normalizeWorkspaceFilePath,
  readWorkspaceFileForSave,
  restoreCheckpointForSave,
  saveRuntimeForSave,
  searchWorkspaceFilesForSave,
  setActiveSaveId,
  writeWorkspaceFileForSave,
  deleteWorkspacePathForSave,
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
const AIRP_HISTORY_TURN_PATH_PREFIX = "history/turns/"

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

interface RawAirpHistoryWriteback {
  path: string
  previousFile: WorkspaceFile | null
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

function syncWorkspaceFileDelete(workspaceFiles: WorkspaceFile[], path: string): void {
  const existingIndex = workspaceFiles.findIndex((file) => file.path === path)
  if (existingIndex >= 0) {
    workspaceFiles.splice(existingIndex, 1)
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

async function writeRawAirpHistoryTurnFileForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
  input: {
    turn: number
    userInput: string
    assistantOutput: string
  },
): Promise<RawAirpHistoryWriteback> {
  const path = formatRawAirpHistoryTurnPath(input.turn)
  const previousFile = await readWorkspaceFileForSave(saveId, path)
  const file = await writeWorkspaceFileForSave(saveId, {
    path,
    content: serializeRawAirpHistoryTurnRecord(
      input.turn,
      new Date(),
      input.userInput,
      input.assistantOutput,
    ),
    mediaType: "application/json",
  })
  syncWorkspaceFileWrite(workspaceFiles, file)

  return { path, previousFile }
}

async function rollbackRawAirpHistoryWritebackForSave(
  saveId: string,
  workspaceFiles: WorkspaceFile[],
  writeback: RawAirpHistoryWriteback,
): Promise<void> {
  if (writeback.previousFile) {
    const file = await writeWorkspaceFileForSave(saveId, {
      path: writeback.previousFile.path,
      content: writeback.previousFile.content,
      mediaType: writeback.previousFile.mediaType,
    })
    syncWorkspaceFileWrite(workspaceFiles, file)
    return
  }

  await deleteWorkspacePathForSave(saveId, writeback.path)
  syncWorkspaceFileDelete(workspaceFiles, writeback.path)
}

async function activeSaveExists(saveId: string): Promise<boolean> {
  return (await listLocalSaves()).some((save) => save.id === saveId)
}

async function ensureActiveSave(): Promise<string> {
  const activeSaveId = await getActiveSaveId()
  if (activeSaveId && await activeSaveExists(activeSaveId)) {
    return activeSaveId
  }

  const created = await createLocalSave()
  await setActiveSaveId(created.id)
  runtimeEngine.loadSnapshot(await getSnapshotForSave(created.id))
  return created.id
}

async function restoreActiveSnapshotFromStorage(saveId: string): Promise<RuntimeSnapshotShell> {
  const snapshot = await getSnapshotForSave(saveId)
  runtimeEngine.loadSnapshot(snapshot)
  return snapshot
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

  if (request.action === "workspace-write") {
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
        item: await writeWorkspaceFileForSave(activeSaveId, {
          path: request.params?.path,
          content: request.params?.content,
          mediaType: request.params?.mediaType,
        }),
      }
    } catch (error) {
      return workspaceActionError(
        error,
        "WORKSPACE_WRITE_FAILED",
        "写入 workspace 文件失败。",
      )
    }
  }

  if (request.action === "workspace-delete") {
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
        item: await deleteWorkspacePathForSave(activeSaveId, request.params?.path),
      }
    } catch (error) {
      return workspaceActionError(
        error,
        "WORKSPACE_DELETE_FAILED",
        "删除 workspace 路径失败。",
      )
    }
  }

  return actionError(
    "UNSUPPORTED_PLATFORM_ACTION",
    `不支持的平台动作：${request.action}`,
    { action: request.action },
  )
}

const AGENT_RUNTIME_PLATFORM_ACTIONS = new Set([
  "workspace-write",
  "workspace-delete",
])

async function runAgentRuntimePlatformAction(
  request: PlatformActionRequest,
): Promise<PlatformActionResult> {
  if (!AGENT_RUNTIME_PLATFORM_ACTIONS.has(request.action)) {
    return actionError(
      "AGENT_RUNTIME_PLATFORM_ACTION_UNSUPPORTED",
      `Agent Runtime 不允许调用平台动作：${request.action}`,
      { action: request.action },
    )
  }

  return executePlatformAction(request)
}

function syncWorkspaceFilesAfterPlatformAction(
  workspaceFiles: WorkspaceFile[],
  request: PlatformActionRequest,
  result: PlatformActionResult,
): void {
  if (!result.ok) {
    return
  }

  if (request.action === "workspace-write" && isWorkspaceFile(result.item)) {
    syncWorkspaceFileWrite(workspaceFiles, result.item)
    return
  }

  if (request.action === "workspace-delete" && isRecord(result.item)) {
    const deletedPaths = Array.isArray(result.item.deletedPaths)
      ? new Set(result.item.deletedPaths.filter((path): path is string => typeof path === "string"))
      : new Set<string>()
    if (deletedPaths.size === 0) {
      return
    }

    for (let index = workspaceFiles.length - 1; index >= 0; index -= 1) {
      const file = workspaceFiles[index]
      if (file && deletedPaths.has(file.path)) {
        workspaceFiles.splice(index, 1)
      }
    }
  }
}

function emitWorkspaceMutationTrace(
  emitTrace: RuntimeTraceEmitter | undefined,
  request: PlatformActionRequest,
  result: PlatformActionResult,
): void {
  if (request.action !== "workspace-write" && request.action !== "workspace-delete") {
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

  if (request.action === "workspace-write" && isWorkspaceFile(result.item)) {
    emitTrace?.({
      type: "workspace_mutation",
      ok: true,
      data: {
        platformAction: request.action,
        mutation: "write",
        path: result.item.path,
        mediaType: result.item.mediaType,
        size: result.item.content.length,
        updatedAt: result.item.updatedAt,
      },
    })
    return
  }

  if (request.action === "workspace-delete" && isRecord(result.item)) {
    const deletedPaths = Array.isArray(result.item.deletedPaths)
      ? result.item.deletedPaths.filter((path): path is string => typeof path === "string")
      : []
    emitTrace?.({
      type: "workspace_mutation",
      ok: true,
      data: {
        platformAction: request.action,
        mutation: "delete",
        deletedPaths,
        deletedCount: deletedPaths.length,
      },
    })
  }
}

function createAgentRuntimePlatformActionRunner(
  workspaceFiles: WorkspaceFile[],
  emitTrace?: RuntimeTraceEmitter,
) {
  return async (request: PlatformActionRequest): Promise<PlatformActionResult> => {
    const result = await runAgentRuntimePlatformAction(request)
    syncWorkspaceFilesAfterPlatformAction(workspaceFiles, request, result)
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
  const file = await writeWorkspaceFileForSave(saveId, {
    path,
    content: serializeRuntimeTraceEvents(events),
    mediaType: "application/x-ndjson",
  })
  syncWorkspaceFileWrite(workspaceFiles, file)
}

export const playFrontendBridge: PlayFrontendBridge = {
  runtime: baseBridge.runtime,
  platform: {
    async getPlatformContext() {
      return {
        version: "0.0.0",
        activeFrontendId: "official-default",
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

      if (request.resource === "state-records") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const namespace =
          typeof request.params?.namespace === "string"
            ? request.params.namespace
            : undefined
        const collection =
          typeof request.params?.collection === "string"
            ? request.params.collection
            : undefined
        const query =
          typeof request.params?.query === "string"
            ? request.params.query
            : undefined
        const limit =
          typeof request.params?.limit === "number"
            ? request.params.limit
            : undefined

        return {
          items: (await listStateRecordsForSave(activeSaveId, {
            namespace,
            collection,
            query,
            limit,
          })) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "workspace-list") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        try {
          return {
            items: (await listWorkspaceEntriesForSave(activeSaveId, {
              path: request.params?.path,
              includePlatformTraces:
                typeof request.params?.includePlatformTraces === "boolean"
                  ? request.params.includePlatformTraces
                  : undefined,
            })) as T[],
          } as DeepQueryResult<T>
        } catch {
          return { items: [] } as DeepQueryResult<T>
        }
      }

      if (request.resource === "workspace-read") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        try {
          const file = await readWorkspaceFileForSave(activeSaveId, request.params?.path)
          return {
            items: (file ? [file] : []) as T[],
          } as DeepQueryResult<T>
        } catch {
          return { items: [] } as DeepQueryResult<T>
        }
      }

      if (request.resource === "workspace-search") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: (await searchWorkspaceFilesForSave(activeSaveId, {
            query:
              typeof request.params?.query === "string"
                ? request.params.query
                : undefined,
            limit:
              typeof request.params?.limit === "number"
                ? request.params.limit
                : undefined,
            includePlatformTraces:
              typeof request.params?.includePlatformTraces === "boolean"
                ? request.params.includePlatformTraces
                : undefined,
          })) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "agent-registry") {
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const files = await listWorkspaceFilesForSave(activeSaveId)
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

        const files = await listWorkspaceFilesForSave(activeSaveId)
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

        const files = await listWorkspaceFilesForSave(activeSaveId)
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
          const files = await listWorkspaceFilesForSave(activeSaveId)
          const detail = loadSkillDetail(files, path)
          return {
            items: (detail ? [detail] : []) as SkillDetailEntry[] as T[],
          } as DeepQueryResult<T>
        } catch {
          return { items: [] } as DeepQueryResult<T>
        }
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
      let workspaceFiles: WorkspaceFile[] | null = null
      let rawAirpHistoryWriteback: RawAirpHistoryWriteback | null = null

      if (previousTurnController) {
        previousTurnController.abort("new-turn-started")
      }
      const currentController = new AbortController()
      previousTurnController = currentController

      try {
        await initializeWorkspaceForSave(activeSaveId)
        workspaceFiles = await listWorkspaceFilesForSave(activeSaveId)
        const stateRecords = await listStateRecordsForSave(activeSaveId)
        const result = await runAgentRuntimeTurn(
          {
            userInput: content,
            recentHistory: historyBefore,
            snapshot: snapshotBefore,
            stateRecords,
            workspaceFiles,
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
              workspaceFiles,
              trace.emit,
            ),
            runBrowserScript: createBrowserSkillScriptRunner({
              saveId: activeSaveId,
              workspaceFiles,
              signal: currentController.signal,
              emitTrace: trace.emit,
            }),
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

        rawAirpHistoryWriteback = await writeRawAirpHistoryTurnFileForSave(
          activeSaveId,
          workspaceFiles,
          {
            turn: nextTurn,
            userInput: content,
            assistantOutput: result.replyText,
          },
        )

        trace.emit({
          type: "turn_completed",
          ok: true,
          data: {
            replyLength: result.replyText.length,
            historyCount: nextHistory.length,
          },
        })
        await writeRuntimeTraceFileForSave(
          activeSaveId,
          workspaceFiles,
          formatRuntimeTracePath(nextTurn),
          trace.events,
        )

        runtimeEngine.loadSnapshot(snapshotAfter)
        await saveRuntimeForSave(activeSaveId, snapshotAfter, nextHistory)

        await createCheckpointForSave(activeSaveId, {
          snapshot: snapshotAfter,
          history: nextHistory,
          stateRecords: await listLocalStateRecordsForSave(activeSaveId),
          reason: "after-turn",
        })

        emitTurnDebugReady(snapshotAfter.state.turn)
        return { snapshot: snapshotAfter }
      } catch (error) {
        runtimeEngine.loadSnapshot(snapshotBefore)
        if (workspaceFiles && rawAirpHistoryWriteback) {
          try {
            await rollbackRawAirpHistoryWritebackForSave(
              activeSaveId,
              workspaceFiles,
              rawAirpHistoryWriteback,
            )
          } catch {
            // Raw AIRP history rollback is best-effort; preserve the original turn error.
          }
        }
        trace.emit({
          type: "turn_failed",
          ok: false,
          data: errorToTraceData(error),
        })
        if (workspaceFiles) {
          try {
            await writeRuntimeTraceFileForSave(
              activeSaveId,
              workspaceFiles,
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
  const saves = await listLocalSaves()
  const activeSaveId = await getActiveSaveId()

  if (activeSaveId) {
    const activeSave = saves.find((save) => save.id === activeSaveId)
    if (activeSave) {
      await restoreActiveSnapshotFromStorage(activeSaveId)
      markPlatformHostReady()
      return
    }

    await setActiveSaveId(null)
  }

  if (saves.length > 0) {
    const next = saves[0]
    await setActiveSaveId(next.id)
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
  await restoreActiveSnapshotFromStorage(created.id)
  return created
}

export async function selectPlatformSave(saveId: string) {
  if (!await activeSaveExists(saveId)) {
    throw new Error(`会话 "${saveId}" 不存在。`)
  }

  await setActiveSaveId(saveId)
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
    await restoreActiveSnapshotFromStorage(next.id)
  }
}

export async function getPlatformActiveSaveId() {
  return getActiveSaveId()
}
