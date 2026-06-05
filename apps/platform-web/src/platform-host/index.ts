import type {
  ApplyPatchOutput,
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  MaintenancePatchDocument,
  ModStaticContent,
  PlatformActionError,
  PlayFrontendBridge,
  RuntimeWriteArchiveInput,
  RuntimeWriteEventInput,
  RuntimeWriteRequest,
  RuntimeWriteResult,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
  WorkflowRunSource,
  WorkflowRunSourceKind,
  WorkflowTraceError,
  WorkflowDefinition,
  RetrievalDebugRecord,
} from "@tsian/contracts"
import {
  executeWorkflow,
  WorkflowAbortError,
  WorkflowNodeError,
} from "@tsian/workflow-engine"
import {
  defaultModId,
  getBuiltinMod,
  getDefaultBuiltinMod,
  listBuiltinMods,
} from "../../../../builtin/mods"
import { createDebugBridge, createPlayFrontendBridge } from "../bridge"
import { emitTurnDebugReady } from "../debug-events"
import { getBrowserRetrievalSettings } from "../config/ai"
import { getCurrentNarrativeTime } from "../narrative-time"
import {
  loadAirpMemoryProjectionForSave,
  replaceAirpMemoryForSave,
  createLocalSave,
  createCheckpointForSave,
  deleteLocalSave,
  getActiveSaveId,
  getHistoryForSave,
  getModIdForSave,
  getPlayerArchiveIdsForSave,
  getSnapshotForSave,
  getWorkflowPresetIdForSave,
  listArchivesForSave,
  listCheckpointsForSave,
  listEventsForSave,
  listLocalSaves,
  listLocalMemoryRecordsForSave,
  replaceRuntimeForSave,
  restoreCheckpointForSave,
  saveHistoryForSave,
  saveSnapshotForSave,
  setActiveSaveId,
  setPlayerArchiveIdsForSave,
  setWorkflowPresetIdForSave,
  syncAirpCompatibilityStateForSave,
  toArchiveRecord,
  toEventRecord,
} from "../storage"
import {
  getWorkflowPresetResource,
  listPromptPresetResources,
  listWorldBookResources,
  seedBuiltinResourceLibraryResources,
} from "../storage/resources"
import { LocalRuntimeEngine } from "../runtime-host"
import { getAiDebugRecords } from "../runtime-host/ai"
import { applyMaintenancePatch } from "../runtime-host/patch-applier"
import { defaultWorkflow } from "../workflow-host/default-workflow"
import { createWorkflowExecutionContext } from "../workflow-host"
import { createOutputsStore, currentTurnOutputsRef } from "../workflow-host/outputs-store"

export type PlatformWorkflowSourceKind = WorkflowRunSourceKind
export type PlatformWorkflowSource = WorkflowRunSource

async function resolveWorkflowForMod(modId: string): Promise<{
  def: WorkflowDefinition
  isModWorkflow: boolean
  source: PlatformWorkflowSource
}> {
  const mod = getBuiltinMod(modId)
  const workflowPresetId = mod?.manifest.workflowPresetId?.trim()

  if (workflowPresetId) {
    await seedBuiltinResourceLibraryResources()
    const resource = await getWorkflowPresetResource(workflowPresetId)
    if (!resource) {
      throw new Error(
        `mod "${modId}" references missing workflow preset "${workflowPresetId}"`,
      )
    }

    return {
      def: resource.workflow,
      isModWorkflow: true,
      source: {
        kind: "mod-preset",
        modId,
        workflowPresetId,
        workflowName: resource.name,
      },
    }
  }

  const modWorkflow = mod?.manifest.workflow
  if (modWorkflow) {
    return {
      def: modWorkflow,
      isModWorkflow: true,
      source: {
        kind: "legacy-mod-workflow",
        modId,
        workflowName: mod?.manifest.name,
      },
    }
  }

  return {
    def: defaultWorkflow,
    isModWorkflow: false,
    source: {
      kind: "platform-default",
      modId,
      workflowName: "平台默认工作流",
    },
  }
}

async function resolveWorkflowForSave(saveId: string): Promise<{
  def: WorkflowDefinition
  isModWorkflow: boolean
  source: PlatformWorkflowSource
}> {
  const modId = await getModIdForSave(saveId)
  const workflowPresetId = await getWorkflowPresetIdForSave(saveId)

  if (workflowPresetId) {
    await seedBuiltinResourceLibraryResources()
    const resource = await getWorkflowPresetResource(workflowPresetId)
    if (!resource) {
      throw new Error(
        `save "${saveId}" references missing workflow preset "${workflowPresetId}"`,
      )
    }

    return {
      def: resource.workflow,
      isModWorkflow: false,
      source: {
        kind: "save-override",
        saveId,
        modId,
        workflowPresetId,
        workflowName: resource.name,
      },
    }
  }

  return resolveWorkflowForMod(modId)
}

export const runtimeEngine = new LocalRuntimeEngine()
const baseBridge = createPlayFrontendBridge(runtimeEngine)
const retrievalDebugBySave = new Map<string, RetrievalDebugRecord>()
let platformHostReady = false
let resolvePlatformHostReady: (() => void) | null = null
const platformHostReadyPromise = new Promise<void>((resolve) => {
  resolvePlatformHostReady = resolve
})

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

async function loadWorkflowResourceContext() {
  await seedBuiltinResourceLibraryResources()
  const [promptRows, worldBookRows] = await Promise.all([
    listPromptPresetResources(),
    listWorldBookResources(),
  ])

  return {
    presets: new Map(promptRows.map((row) => [row.id, row.preset ?? row.content])),
    worldBooks: Object.fromEntries(
      worldBookRows.map((row) => [row.id, row.worldBook ?? row.content]),
    ),
  }
}

// H12: per-turn AbortController 接入
// 每轮 sendMessage 入口新建一个 controller；新轮入口会先 abort 上一个（旧轮若还在跑则通知其停止）。
// 旧轮 abort 不阻塞新轮执行（abort 后立即继续）。
// 轮次正常结束后置 null，避免下一轮误认为存在待 abort 的旧轮。
let previousTurnController: AbortController | null = null

function getSnapshotMessages(snapshot: RuntimeSnapshotShell): Array<{
  role: string
  content: string
}> {
  return Array.isArray(snapshot.state.messages) ? snapshot.state.messages : []
}

function getSnapshotCurrentTime(snapshot: RuntimeSnapshotShell): string {
  if (typeof snapshot.state.currentTime === "string" && snapshot.state.currentTime.trim()) {
    return snapshot.state.currentTime.trim()
  }

  return getCurrentNarrativeTime()
}

function formatDefaultNarrativeTime(value: string): string {
  return value.trim() || "未设置"
}

function getNarrativeTimeText(value: unknown, currentTime: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  return formatDefaultNarrativeTime(currentTime)
}

function getSnapshotGlobals(snapshot: RuntimeSnapshotShell): RuntimeGlobalsMap {
  const raw = snapshot.state.globals
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {}
  }

  return raw
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

function toWorkflowTraceError(error: unknown): WorkflowTraceError {
  if (error instanceof WorkflowNodeError) {
    return {
      code: error.code,
      message: error.message,
    }
  }

  if (error instanceof WorkflowAbortError) {
    return {
      code: "WORKFLOW_ABORTED",
      message: error.message,
    }
  }

  if (error instanceof Error) {
    return {
      code: error.name || "Error",
      message: error.message,
    }
  }

  return {
    code: "UNKNOWN_ERROR",
    message: String(error),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item))
  }

  if (!isPlainObject(value)) {
    return false
  }

  return Object.values(value).every((item) => isJsonValue(item))
}

function normalizeStringList(value: unknown, trim = true): string[] | null {
  if (value === undefined) {
    return []
  }

  if (!Array.isArray(value)) {
    return null
  }

  if (value.some((item) => typeof item !== "string")) {
    return null
  }

  const items = value.flatMap((item) => {
    const next = trim ? item.trim() : item
    return next ? [next] : []
  })

  return [...new Set(items)]
}

function duplicateIds(items: Array<{ id?: string }>): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const item of items) {
    if (typeof item.id !== "string" || !item.id.trim()) {
      continue
    }

    const nextId = item.id.trim()
    if (seen.has(nextId)) {
      duplicates.add(nextId)
      continue
    }

    seen.add(nextId)
  }

  return [...duplicates]
}

function normalizeHistoryRecord(
  value: unknown,
): ConversationMessageRecord | null {
  if (!isPlainObject(value)) {
    return null
  }

  const role = typeof value.role === "string" ? value.role.trim() : ""
  if (!role) {
    return null
  }

  if (typeof value.content !== "string") {
    return null
  }

  return {
    role,
    content: value.content,
  }
}

function normalizeEventInput(
  value: unknown,
): RuntimeWriteEventInput | null {
  if (!isPlainObject(value)) {
    return null
  }

  const id =
    typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined
  const time = typeof value.time === "string" ? value.time.trim() : ""
  const status = value.status
  const entityTags = normalizeStringList(value.entityTags)
  const entityArchiveIds = normalizeStringList(value.entityArchiveIds)

  if (!time) {
    return null
  }

  if (status !== "ongoing" && status !== "done") {
    return null
  }

  if (entityTags === null || entityArchiveIds === null) {
    return null
  }

  if (value.content !== undefined && typeof value.content !== "string") {
    return null
  }

  return {
    id,
    time,
    status,
    entityTags,
    entityArchiveIds: entityArchiveIds.length > 0 ? entityArchiveIds : undefined,
    content: typeof value.content === "string" ? value.content : "",
  }
}

function normalizeArchiveInput(
  value: unknown,
): RuntimeWriteArchiveInput | null {
  if (!isPlainObject(value)) {
    return null
  }

  const id =
    typeof value.id === "string" && value.id.trim() ? value.id.trim() : undefined
  const type = typeof value.type === "string" ? value.type.trim() : ""
  const name = typeof value.name === "string" ? value.name.trim() : ""
  const aliases = normalizeStringList(value.aliases)
  const linkedNames = normalizeStringList(value.linkedNames)
  const linkedArchiveIds = normalizeStringList(value.linkedArchiveIds)

  if (!type || !name || aliases === null || linkedNames === null || linkedArchiveIds === null) {
    return null
  }

  if (value.background !== undefined && typeof value.background !== "string") {
    return null
  }
  if (value.situation !== undefined && typeof value.situation !== "string") {
    return null
  }
  if (value.focus !== undefined && typeof value.focus !== "string") {
    return null
  }

  const presence =
    value.presence === "foreground" ||
    value.presence === "background" ||
    value.presence === "retired"
      ? value.presence
      : "foreground"

  const extraFields = Object.fromEntries(
    Object.entries(value).filter(([key]) => {
      return !new Set([
        "id",
        "type",
        "name",
        "aliases",
        "background",
        "situation",
        "focus",
        "linkedNames",
        "linkedArchiveIds",
        "presence",
      ]).has(key)
    }),
  )

  if (!Object.values(extraFields).every((item) => isJsonValue(item))) {
    return null
  }

  return {
    id,
    type,
    name,
    aliases,
    background: typeof value.background === "string" ? value.background : "",
    situation: typeof value.situation === "string" ? value.situation : "",
    focus: typeof value.focus === "string" ? value.focus : undefined,
    linkedNames,
    linkedArchiveIds: linkedArchiveIds.length > 0 ? linkedArchiveIds : undefined,
    presence,
    ...extraFields,
  }
}

function validateRuntimeWriteRequest(
  params: Record<string, unknown> | undefined,
):
  | { ok: true; value: RuntimeWriteRequest }
  | { ok: false; error: PlatformActionError } {
  if (!isPlainObject(params)) {
    return actionError(
      "INVALID_RUNTIME_WRITE_PARAMS",
      "write-runtime 需要对象形式的 params。",
    )
  }

  const allowedKeys = new Set([
    "turn",
    "currentTime",
    "globals",
    "history",
    "events",
    "archives",
    "checkpointLabel",
  ])

  const unknownKeys = Object.keys(params).filter((key) => !allowedKeys.has(key))
  if (unknownKeys.length > 0) {
    return actionError(
      "UNSUPPORTED_RUNTIME_WRITE_FIELD",
      "write-runtime 包含未支持的字段。",
      { fields: unknownKeys.join(", ") },
    )
  }

  const next: RuntimeWriteRequest = {}

  if (params.turn !== undefined) {
    if (
      typeof params.turn !== "number" ||
      !Number.isInteger(params.turn) ||
      params.turn < 0
    ) {
      return actionError(
        "INVALID_RUNTIME_TURN",
        "turn 必须是大于等于 0 的整数。",
      )
    }
    next.turn = params.turn
  }

  if (params.currentTime !== undefined) {
    if (typeof params.currentTime !== "string" || !params.currentTime.trim()) {
      return actionError(
        "INVALID_RUNTIME_TIME",
        "currentTime 必须是非空字符串。",
      )
    }
    next.currentTime = params.currentTime.trim()
  }

  if (params.globals !== undefined) {
    if (!isPlainObject(params.globals) || !Object.values(params.globals).every(isJsonValue)) {
      return actionError(
        "INVALID_RUNTIME_GLOBALS",
        "globals 必须是 JSON 可序列化对象。",
      )
    }
    next.globals = params.globals as RuntimeGlobalsMap
  }

  if (params.checkpointLabel !== undefined) {
    if (
      typeof params.checkpointLabel !== "string" ||
      !params.checkpointLabel.trim()
    ) {
      return actionError(
        "INVALID_RUNTIME_CHECKPOINT_LABEL",
        "checkpointLabel 必须是非空字符串。",
      )
    }
    next.checkpointLabel = params.checkpointLabel.trim()
  }

  if (Object.keys(params).length === 0) {
    return actionError(
      "EMPTY_RUNTIME_WRITE_REQUEST",
      "write-runtime 至少要提供一个可写字段。",
    )
  }

  if (params.history !== undefined) {
    if (!Array.isArray(params.history)) {
      return actionError(
        "INVALID_RUNTIME_HISTORY",
        "history 必须是消息数组。",
      )
    }

    const history: ConversationMessageRecord[] = []
    for (const [index, item] of params.history.entries()) {
      const normalized = normalizeHistoryRecord(item)
      if (!normalized) {
        return actionError(
          "INVALID_RUNTIME_HISTORY_ITEM",
          "history 中存在非法消息项。",
          { index },
        )
      }
      history.push(normalized)
    }
    next.history = history
  }

  if (params.events !== undefined) {
    if (!Array.isArray(params.events)) {
      return actionError(
        "INVALID_RUNTIME_EVENTS",
        "events 必须是事件数组。",
      )
    }

    const events: RuntimeWriteEventInput[] = []
    for (const [index, item] of params.events.entries()) {
      const normalized = normalizeEventInput(item)
      if (!normalized) {
        return actionError(
          "INVALID_RUNTIME_EVENT_ITEM",
          "events 中存在非法事件项。",
          { index },
        )
      }
      events.push(normalized)
    }

    const duplicates = duplicateIds(events)
    if (duplicates.length > 0) {
      return actionError(
        "DUPLICATE_RUNTIME_EVENT_ID",
        "events 中存在重复 id。",
        { ids: duplicates.join(", ") },
      )
    }

    next.events = events
  }

  if (params.archives !== undefined) {
    if (!Array.isArray(params.archives)) {
      return actionError(
        "INVALID_RUNTIME_ARCHIVES",
        "archives 必须是档案数组。",
      )
    }

    const archives: RuntimeWriteArchiveInput[] = []
    for (const [index, item] of params.archives.entries()) {
      const normalized = normalizeArchiveInput(item)
      if (!normalized) {
        return actionError(
          "INVALID_RUNTIME_ARCHIVE_ITEM",
          "archives 中存在非法档案项。",
          { index },
        )
      }
      archives.push(normalized)
    }

    const duplicates = duplicateIds(archives)
    if (duplicates.length > 0) {
      return actionError(
        "DUPLICATE_RUNTIME_ARCHIVE_ID",
        "archives 中存在重复 id。",
        { ids: duplicates.join(", ") },
      )
    }

    next.archives = archives
  }

  if (
    next.turn === undefined &&
    next.currentTime === undefined &&
    next.globals === undefined &&
    next.history === undefined &&
    next.events === undefined &&
    next.archives === undefined
  ) {
    return actionError(
      "EMPTY_RUNTIME_WRITE_REQUEST",
      "write-runtime 至少要提供一个真正的运行时写字段。",
    )
  }

  return {
    ok: true,
    value: next,
  }
}

async function handleWriteRuntimeAction(
  activeSaveId: string,
  params: Record<string, unknown> | undefined,
) {
  const parsed = validateRuntimeWriteRequest(params)
  if (!parsed.ok) {
    return {
      ok: false as const,
      error: parsed.error,
    }
  }

  const currentSnapshot = await getSnapshotForSave(activeSaveId)
  const currentHistory = await getHistoryForSave(activeSaveId)
  const currentEvents: RuntimeWriteEventInput[] = (await listEventsForSave(activeSaveId)).map(
    (event) => ({
      ...toEventRecord(event),
      status: event.status === "done" ? "done" : "ongoing",
    }),
  )
  const currentArchives: RuntimeWriteArchiveInput[] = (await listArchivesForSave(activeSaveId)).map(
    (archive) => toArchiveRecord(archive) as RuntimeWriteArchiveInput,
  )
  const request = parsed.value

  // 写入口以“完整切片替换”为原则；未提供的分组直接沿用当前切片。
  const nextHistory = request.history ?? currentHistory
  const nextSnapshot: RuntimeSnapshotShell = {
    ...currentSnapshot,
    state: {
      ...currentSnapshot.state,
      turn: request.turn ?? currentSnapshot.state.turn,
      currentTime: request.currentTime ?? currentSnapshot.state.currentTime,
      globals: request.globals ?? getSnapshotGlobals(currentSnapshot),
      messages: nextHistory,
    },
  }

  try {
    const persisted = await replaceRuntimeForSave(activeSaveId, {
      snapshot: nextSnapshot,
      history: nextHistory,
      events: request.events ?? currentEvents,
      archives: request.archives ?? currentArchives,
    })

    await replaceAirpMemoryForSave(activeSaveId, {
      snapshot: persisted.snapshot,
      events: persisted.events,
      archives: persisted.archives.map(toArchiveRecord),
    })

    runtimeEngine.loadSnapshot(persisted.snapshot)
    retrievalDebugBySave.delete(activeSaveId)

    await createCheckpointForSave(activeSaveId, {
      snapshot: persisted.snapshot,
      history: persisted.history,
      events: persisted.events,
      archives: persisted.archives,
      memoryRecords: await listLocalMemoryRecordsForSave(activeSaveId),
      reason: "manual",
      label: request.checkpointLabel ?? "前端写入",
    })

    const result: RuntimeWriteResult = {
      snapshot: persisted.snapshot,
      historyCount: persisted.history.length,
      eventCount: persisted.events.length,
      archiveCount: persisted.archives.length,
    }

    return {
      ok: true as const,
      item: result,
    }
  } catch (error) {
    return actionError(
      "RUNTIME_WRITE_FAILED",
      error instanceof Error ? error.message : "运行时写入失败。",
    )
  }
}

export const playFrontendBridge: PlayFrontendBridge = {
  runtime: {
    ...baseBridge.runtime,
    async markArchiveAsPlayer(archiveId: string) {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        throw new Error("No active save")
      }
      const current = await getPlayerArchiveIdsForSave(activeSaveId)
      const set = new Set(current)
      set.add(archiveId)
      await setPlayerArchiveIdsForSave(activeSaveId, Array.from(set))
      retrievalDebugBySave.delete(activeSaveId)
    },
    async unmarkArchiveAsPlayer(archiveId: string) {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) return
      const current = await getPlayerArchiveIdsForSave(activeSaveId)
      const next = current.filter((id) => id !== archiveId)
      await setPlayerArchiveIdsForSave(activeSaveId, next)
      retrievalDebugBySave.delete(activeSaveId)
    },
    async listPlayerArchiveIds() {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) return []
      return getPlayerArchiveIdsForSave(activeSaveId)
    },
    // I4: 桥 API 写运行时入口（4 个方法，HC-14 / §13.9）
    // patch 类写入走 applier；append 类直调 engine 同步方法后落库。
    async applyPatch(patch: MaintenancePatchDocument): Promise<ApplyPatchOutput> {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        throw new Error("[bridge.applyPatch] 当前没有激活存档")
      }
      const result = await applyMaintenancePatch({
        patch,
        runtimeEngine,
        saveId: activeSaveId,
        // §13.9：桥 API 路径不打 checkpoint
        pushCheckpointReason: undefined,
      })
      // 同步落盘 snapshot / history（applier 内部同步 generic AIRP memory）
      const snapshotAfter = await runtimeEngine.getSnapshot()
      await saveSnapshotForSave(activeSaveId, snapshotAfter)
      await saveHistoryForSave(activeSaveId, getSnapshotMessages(snapshotAfter))
      retrievalDebugBySave.delete(activeSaveId)
      return result
    },
    async updateGlobals(path: string, value: unknown): Promise<void> {
      const parts = path.split(".").filter((p) => p.length > 0)
      if (parts.length === 0) {
        throw new Error("[bridge.updateGlobals] path 不能为空")
      }
      // dot-path → 嵌套对象；中间层不存在自动建对象（D2=A），applier 层负责非对象冲突 fail loud
      const setValue: RuntimeGlobalsMap = {}
      let cursor: Record<string, unknown> = setValue
      for (let i = 0; i < parts.length - 1; i++) {
        const next: Record<string, unknown> = {}
        cursor[parts[i]] = next
        cursor = next
      }
      cursor[parts[parts.length - 1]] = value as never

      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        throw new Error("[bridge.updateGlobals] 当前没有激活存档")
      }
      await applyMaintenancePatch({
        patch: { globals: { set: setValue } } as MaintenancePatchDocument,
        runtimeEngine,
        saveId: activeSaveId,
        pushCheckpointReason: undefined,
      })
      const snapshotAfter = await runtimeEngine.getSnapshot()
      await saveSnapshotForSave(activeSaveId, snapshotAfter)
      retrievalDebugBySave.delete(activeSaveId)
    },
    async appendUserMessage(content: string): Promise<void> {
      // D3=B：append 例外，直调 engine 同步方法（不递增 turn）
      runtimeEngine.appendUserMessage(content)
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        throw new Error("[bridge.appendUserMessage] 当前没有激活存档")
      }
      const snapshotAfter = await runtimeEngine.getSnapshot()
      await saveSnapshotForSave(activeSaveId, snapshotAfter)
      await saveHistoryForSave(activeSaveId, getSnapshotMessages(snapshotAfter))
    },
    async appendAssistantMessage(content: string): Promise<void> {
      runtimeEngine.appendAssistantMessage(content)
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        throw new Error("[bridge.appendAssistantMessage] 当前没有激活存档")
      }
      const snapshotAfter = await runtimeEngine.getSnapshot()
      await saveSnapshotForSave(activeSaveId, snapshotAfter)
      await saveHistoryForSave(activeSaveId, getSnapshotMessages(snapshotAfter))
    },
  },
  platform: {
    async getPlatformContext() {
      const activeSaveId = await getActiveSaveId()
      return {
        version: "0.0.0",
        activeModId: activeSaveId ? await getModIdForSave(activeSaveId) : undefined,
      }
    },
    async runAction(request) {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        return actionError(
          "ACTIVE_SAVE_REQUIRED",
          "当前没有激活中的存档。",
        )
      }

      const saveExists = (await listLocalSaves()).some((save) => save.id === activeSaveId)
      if (!saveExists) {
        return actionError(
          "ACTIVE_SAVE_NOT_FOUND",
          "当前激活存档不存在。",
          { saveId: activeSaveId },
        )
      }

      if (request.action === "restore-checkpoint") {
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
        retrievalDebugBySave.delete(activeSaveId)
        return {
          ok: true,
          item: snapshot,
        }
      }

      if (request.action === "write-runtime") {
        return handleWriteRuntimeAction(
          activeSaveId,
          request.params,
        )
      }

      return actionError(
        "UNSUPPORTED_PLATFORM_ACTION",
        `不支持的平台动作：${request.action}`,
        { action: request.action },
      )
    },
  },
  query: {
    async query<T = unknown>(request: DeepQueryRequest) {
      if (request.resource === "history") {
        const activeSaveId = await getActiveSaveId()
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: (await getHistoryForSave(activeSaveId)) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "events") {
        const activeSaveId = await getActiveSaveId()
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: (await listEventsForSave(activeSaveId)).map(toEventRecord) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "checkpoints") {
        const activeSaveId = await getActiveSaveId()
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: (await listCheckpointsForSave(activeSaveId)) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "archives") {
        const activeSaveId = await getActiveSaveId()
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        return {
          items: (await listArchivesForSave(activeSaveId)).map(toArchiveRecord) as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "retrieval-debug") {
        const activeSaveId = await getActiveSaveId()
        if (!activeSaveId) {
          return { items: [] } as DeepQueryResult<T>
        }

        const debug = retrievalDebugBySave.get(activeSaveId)
        return {
          items: debug ? ([debug] as T[]) : [],
        } as DeepQueryResult<T>
      }

      if (request.resource === "mod-static") {
        const activeSaveId = await getActiveSaveId()
        const requestedModId =
          typeof request.params?.modId === "string" && request.params.modId.trim()
            ? request.params.modId.trim()
            : null
        const modId =
          requestedModId ??
          (activeSaveId ? await getModIdForSave(activeSaveId) : defaultModId)
        const mod = (getBuiltinMod(modId) ?? getDefaultBuiltinMod()) as ModStaticContent
        return {
          items: [mod] as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "builtin-mods") {
        return {
          items: listBuiltinMods() as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "ai-debug") {
        return {
          items: getAiDebugRecords() as T[],
        } as DeepQueryResult<T>
      }

      if (request.resource === "workflow-debug") {
        // 套娃 ref：外层 currentTurnOutputsRef.value 是内层 TurnOutputsRef | null
        // 内层 ref.value 才是 WorkflowOutputsSnapshot
        const innerRef = currentTurnOutputsRef.value
        return { data: innerRef ? innerRef.value : null } as unknown as DeepQueryResult<T>
      }

      return baseBridge.query.query(request)
    },
  },
  interaction: {
    async sendMessage(input) {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        // 无激活存档：走 base bridge（无工作流路径）
        await baseBridge.interaction.sendMessage(input)
        return {
          snapshot: await runtimeEngine.getSnapshot(),
        }
      }

      // === 1) 加载本轮上下文 ===
      const history = await getHistoryForSave(activeSaveId)
      const airpMemory = await loadAirpMemoryProjectionForSave(activeSaveId)
      const events = airpMemory.events
      const activeEvents = airpMemory.activeEvents
      const archives = airpMemory.archives
      const currentSnapshot = await runtimeEngine.getSnapshot()
      const currentTime = airpMemory.currentTime ?? getSnapshotCurrentTime(currentSnapshot)
      const nextTurn = currentSnapshot.state.turn + 1
      const narrativeTimeText = getNarrativeTimeText(input.narrativeTimeText, currentTime)
      const modId = await getModIdForSave(activeSaveId)
      const mod = getBuiltinMod(modId) ?? getDefaultBuiltinMod()
      const playerArchiveIds = await getPlayerArchiveIdsForSave(activeSaveId)

      // === 2) retrieval 下沉到 workflow 节点；新轮先清旧 debug，节点成功后回写 ===
      retrievalDebugBySave.delete(activeSaveId)

      // === 3) D4: 备份当前 snapshot 用于失败回滚 ===
      const snapshotBeforeBackup: RuntimeSnapshotShell = JSON.parse(
        JSON.stringify(currentSnapshot),
      )

      // === 4) turn++（design §13.6） ===
      runtimeEngine.loadSnapshot({
        ...currentSnapshot,
        state: {
          ...currentSnapshot.state,
          turn: nextTurn,
        },
      })
      const turnedSnapshot = await runtimeEngine.getSnapshot()

      // === 5) H12: per-turn AbortController 接入，旧轮 abort 在新轮入口触发 ===
      // 如果上一轮工作流还在运行（例如用户快速连发），先通知其终止，不等待收尾。
      if (previousTurnController) {
        previousTurnController.abort("new-turn-started")
      }
      const currentController = new AbortController()
      previousTurnController = currentController

      const { def, isModWorkflow, source } = await resolveWorkflowForSave(activeSaveId)

      // === 6) outputs store（套娃 ref；自动替换 currentTurnOutputsRef） ===
      const handle = createOutputsStore({
        runId: `${activeSaveId}:${turnedSnapshot.state.turn}:${Date.now()}`,
        saveId: activeSaveId,
        turn: turnedSnapshot.state.turn,
        isModWorkflow,
        source,
        nodes: def.nodes.map((node) => ({ id: node.id, type: node.type })),
      })

      // === 7) 推 user 消息（不递增 turn） ===
      runtimeEngine.appendUserMessage(input.content)

      // === 8) 组装 macros + workflow context ===
      const playerArchives = archives.filter((a) => playerArchiveIds.includes(a.id))

      const workflowResources = await loadWorkflowResourceContext()

      const wfContext = createWorkflowExecutionContext({
        runtimeEngine,
        saveId: activeSaveId,
        turn: turnedSnapshot.state.turn,
        presets: workflowResources.presets,
        worldBooks: workflowResources.worldBooks,
        history,
        userInput: input.content,
        events,
        activeEvents,
        archives,
        catalogEvents: mod.eventCatalog,
        currentTime,
        narrativeTimeText,
        globals: airpMemory.globals,
        playerArchiveIds,
        retrievalSettings: getBrowserRetrievalSettings(),
        recordRetrievalDebug: (debug) => {
          retrievalDebugBySave.set(activeSaveId, debug)
        },
        macros: {
          "user.input": input.content,
          "narrative.currentTime": currentTime,
          "narrative.formattedTime": narrativeTimeText,
          "globals.json": JSON.stringify(airpMemory.globals ?? {}),
          "events.active.json": JSON.stringify(activeEvents),
          "events.recent.json": JSON.stringify(events.slice(-20)),
          "archives.recent.json": JSON.stringify(archives.slice(0, 20)),
          "archives.player.json": JSON.stringify(playerArchives),
          "history.recent.json": JSON.stringify(history.slice(-10)),
        },
      })

      // === 9) 跑工作流（H12: per-turn AbortController 接入，旧轮 abort 在新轮入口触发） ===
      let workflowResult
      try {
        workflowResult = await executeWorkflow(def, wfContext, {
          outputsHooks: handle.writer,
          isModWorkflow,
          signal: currentController.signal,
        })
      } catch (err) {
        handle.finishRun(
          err instanceof WorkflowAbortError ? "aborted" : "failed",
          toWorkflowTraceError(err),
        )
        // D4: 失败回滚 engine 内存态 + 清 retrieval debug
        runtimeEngine.loadSnapshot(snapshotBeforeBackup)
        retrievalDebugBySave.delete(activeSaveId)
        if (previousTurnController === currentController) {
          previousTurnController = null
        }
        throw err
      }

      // === 10) D10: 从 result 节点的 reply 取正文 ===
      const replyText = workflowResult.results?.reply
      if (typeof replyText !== "string") {
        handle.finishRun("failed", {
          code: "INVALID_WORKFLOW_RESULT",
          message: `workflow did not produce result.reply as string (got ${typeof replyText})`,
        })
        runtimeEngine.loadSnapshot(snapshotBeforeBackup)
        retrievalDebugBySave.delete(activeSaveId)
        if (previousTurnController === currentController) {
          previousTurnController = null
        }
        throw new Error(
          `workflow did not produce result.reply as string (got ${typeof replyText})`,
        )
      }

      handle.finishRun("succeeded")

      // === 11) 推 assistant 消息 ===
      runtimeEngine.appendAssistantMessage(replyText)

      // === 12) generic AIRP memory 为权威；回合同步 legacy 兼容切片并创建 checkpoint ===
      const snapshotAfter = await runtimeEngine.getSnapshot()
      const persisted = await syncAirpCompatibilityStateForSave(
        activeSaveId,
        snapshotAfter,
      )
      runtimeEngine.loadSnapshot(persisted.snapshot)
      await createCheckpointForSave(activeSaveId, {
        snapshot: persisted.snapshot,
        history: persisted.history,
        events: persisted.events,
        archives: persisted.archives,
        memoryRecords: await listLocalMemoryRecordsForSave(activeSaveId),
        reason: "after-turn",
      })

      // H12: 本轮正常结束，释放 controller 引用（下轮入口不会误 abort 已完成的轮次）
      if (previousTurnController === currentController) {
        previousTurnController = null
      }

      // B3 / D5：本轮 patch 已应用 + assistant 落库；广播给 debug 桥订阅方
      emitTurnDebugReady(persisted.snapshot.state.turn)

      return { snapshot: persisted.snapshot }
    },
  },
  debug: createDebugBridge({
    latestRetrievalDebugProvider: async () => {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) return null
      return retrievalDebugBySave.get(activeSaveId) ?? null
    },
  }),
}

export async function initializePlatformHost(): Promise<void> {
  const saves = await listLocalSaves()
  const activeSaveId = await getActiveSaveId()

  if (activeSaveId) {
    const activeSave = saves.find((save) => save.id === activeSaveId)
    if (activeSave) {
      runtimeEngine.loadSnapshot(await getSnapshotForSave(activeSaveId))
      markPlatformHostReady()
      return
    }

    await setActiveSaveId(null)
  }

  if (saves.length > 0) {
    const next = saves[0]
    await setActiveSaveId(next.id)
    runtimeEngine.loadSnapshot(await getSnapshotForSave(next.id))
  }

  markPlatformHostReady()
}

export async function listPlatformSaves() {
  return listLocalSaves()
}

export async function createPlatformSave(input?: {
  name?: string
  modId?: string
}) {
  const created = await createLocalSave(
    input?.name,
    undefined,
    input?.modId ?? defaultModId,
  )
  await setActiveSaveId(created.id)
  runtimeEngine.loadSnapshot(await getSnapshotForSave(created.id))
  return created
}

export async function selectPlatformSave(saveId: string) {
  await setActiveSaveId(saveId)
  runtimeEngine.loadSnapshot(await getSnapshotForSave(saveId))
}

export async function getPlatformWorkflowSource(saveId?: string): Promise<PlatformWorkflowSource | null> {
  const targetSaveId = saveId ?? await getActiveSaveId()
  if (!targetSaveId) {
    return null
  }

  const { source } = await resolveWorkflowForSave(targetSaveId)
  return source
}

export async function setPlatformSaveWorkflowPreset(
  workflowPresetId: string | null,
  saveId?: string,
) {
  const targetSaveId = saveId ?? await getActiveSaveId()
  if (!targetSaveId) {
    throw new Error("当前没有激活中的存档")
  }

  const nextWorkflowPresetId = workflowPresetId?.trim() || null
  if (nextWorkflowPresetId) {
    await seedBuiltinResourceLibraryResources()
    const resource = await getWorkflowPresetResource(nextWorkflowPresetId)
    if (!resource) {
      throw new Error(
        `save "${targetSaveId}" references missing workflow preset "${nextWorkflowPresetId}"`,
      )
    }
  }

  const updated = await setWorkflowPresetIdForSave(targetSaveId, nextWorkflowPresetId)
  if (!updated) {
    throw new Error(`save "${targetSaveId}" not found`)
  }

  retrievalDebugBySave.delete(targetSaveId)
  return updated
}

export async function deletePlatformSave(saveId: string) {
  const activeSaveId = await getActiveSaveId()
  await deleteLocalSave(saveId)
  retrievalDebugBySave.delete(saveId)

  const remaining = await listLocalSaves()

  if (remaining.length === 0) {
    if (activeSaveId === saveId) {
      await setActiveSaveId(null)
    }
    return
  }

  if (activeSaveId === saveId) {
    const next = remaining[0]
    await setActiveSaveId(next.id)
    runtimeEngine.loadSnapshot(await getSnapshotForSave(next.id))
  }
}

export async function getPlatformActiveSaveId() {
  return getActiveSaveId()
}
