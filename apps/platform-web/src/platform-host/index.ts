import type {
  ArchivePatchItem,
  ConversationMessageRecord,
  DeepQueryRequest,
  DeepQueryResult,
  EventPatchItem,
  ModStaticContent,
  PlatformActionError,
  PlayFrontendBridge,
  RuntimeWriteArchiveInput,
  RuntimeWriteEventInput,
  RuntimeWriteRequest,
  RuntimeWriteResult,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import {
  defaultModId,
  getBuiltinMod,
  getDefaultBuiltinMod,
  listBuiltinMods,
} from "../../../../builtin/mods"
import { createPlayFrontendBridge } from "../bridge"
import { getBrowserRetrievalSettings } from "../config/ai"
import { getCurrentNarrativeTime } from "../narrative-time"
import {
  applyEventPatchForSave,
  applyArchivePatchesForSave,
  createLocalSave,
  createCheckpointForSave,
  deleteLocalSave,
  getActiveEventForSave,
  getActiveSaveId,
  getHistoryForSave,
  getModIdForSave,
  getSnapshotForSave,
  listActiveEventsForSave,
  listArchivesForSave,
  listCheckpointsForSave,
  listEventsForSave,
  listLocalSaves,
  replaceRuntimeForSave,
  restoreCheckpointForSave,
  saveHistoryForSave,
  saveSnapshotForSave,
  setActiveSaveId,
  toArchiveRecord,
  toEventRecord,
  type LocalArchiveRecord,
} from "../storage"
import { LocalRuntimeEngine } from "../runtime-host"
import { getAiDebugRecords } from "../runtime-host/ai"
import { generateMaintenancePatch } from "../runtime-host/maintenance"
import {
  assembleRetrievalContext,
  type RetrievalDebugRecord,
} from "../runtime-host/retrieval"

export const runtimeEngine = new LocalRuntimeEngine()
const baseBridge = createPlayFrontendBridge(runtimeEngine)
const retrievalDebugBySave = new Map<string, RetrievalDebugRecord>()

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s"'“”‘’，。！？、：；（）()\[\]【】<>《》]/g, "")
}

function archiveNameKeys(archive: { name: string; aliases?: string[] }): string[] {
  return [archive.name, ...(archive.aliases ?? [])].map(normalizeName).filter(Boolean)
}

function resolveArchiveIdsByNames(
  names: string[] | undefined,
  visibleArchives: Array<{ id: string; name: string; aliases?: string[] }>,
): string[] | undefined {
  if (!names || names.length === 0) {
    return undefined
  }

  const resolvedIds: string[] = []
  for (const name of names) {
    const normalized = normalizeName(name)
    if (!normalized) {
      continue
    }

    const matches = visibleArchives.filter((archive) => archiveNameKeys(archive).includes(normalized))
    if (matches.length === 1 && !resolvedIds.includes(matches[0].id)) {
      resolvedIds.push(matches[0].id)
    }
  }

  return resolvedIds.length > 0 ? resolvedIds : undefined
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined
}

function attachArchiveStrongRefs(
  patches: ArchivePatchItem[],
  visibleArchives: Array<{ id: string; name: string; aliases?: string[] }>,
): ArchivePatchItem[] {
  return patches.map((patch) => {
    const setLinkedIds = resolveArchiveIdsByNames(stringArray(patch.set?.linkedNames), visibleArchives)
    const createLinkedIds = resolveArchiveIdsByNames(
      stringArray(patch.create?.linkedNames),
      visibleArchives,
    )
    return {
      ...patch,
      set: patch.set
        ? {
            ...patch.set,
            linkedArchiveIds: setLinkedIds ?? patch.set.linkedArchiveIds,
          }
        : patch.set,
      create: patch.create
        ? {
            ...patch.create,
            linkedArchiveIds: createLinkedIds ?? patch.create.linkedArchiveIds,
          }
        : patch.create,
    }
  })
}

function attachEventStrongRefs(
  patches: EventPatchItem[],
  visibleArchives: Array<{ id: string; name: string; aliases?: string[] }>,
): EventPatchItem[] {
  return patches.map((patch) => {
    const setEntityIds = resolveArchiveIdsByNames(patch.set?.entityTags, visibleArchives)
    const createEntityIds = resolveArchiveIdsByNames(patch.create?.entityTags, visibleArchives)
    return {
      ...patch,
      set: patch.set
        ? {
            ...patch.set,
            entityArchiveIds: setEntityIds ?? patch.set.entityArchiveIds,
          }
        : patch.set,
      create: patch.create
        ? {
            ...patch.create,
            entityArchiveIds: createEntityIds ?? patch.create.entityArchiveIds,
          }
        : patch.create,
    }
  })
}

function archiveRecordFromLocal(archive: LocalArchiveRecord) {
  return {
    id: archive.id,
    name: archive.name,
    aliases: archive.aliases,
  }
}

function mergeArchiveRefsById(
  archives: Array<{ id: string; name: string; aliases?: string[] }>,
): Array<{ id: string; name: string; aliases?: string[] }> {
  const byId = new Map<string, { id: string; name: string; aliases?: string[] }>()
  for (const archive of archives) {
    byId.set(archive.id, archive)
  }
  return [...byId.values()]
}

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

    runtimeEngine.loadSnapshot(persisted.snapshot)
    retrievalDebugBySave.delete(activeSaveId)

    await createCheckpointForSave(activeSaveId, {
      snapshot: persisted.snapshot,
      history: persisted.history,
      events: persisted.events,
      archives: persisted.archives,
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

async function persistActiveSnapshot(input?: {
  maintenanceMessages?: Array<{ role: string; content: string }>
  maintenanceArchiveNames?: string[]
  narrativeTimeText?: string
}) {
  const activeSaveId = await getActiveSaveId()
  if (!activeSaveId) {
    return
  }

  const snapshot = await runtimeEngine.getSnapshot()
  const messages = getSnapshotMessages(snapshot)
  let latestSnapshot = snapshot

  try {
    const activeEvents = await listActiveEventsForSave(activeSaveId)
    const allArchives = (await listArchivesForSave(activeSaveId)).map(toArchiveRecord)
    const touchedArchiveNames = new Set(input?.maintenanceArchiveNames ?? [])
    const maintenanceArchives = allArchives
      .filter((item) => touchedArchiveNames.has(item.name))
      .map((item) => ({
        ...item,
        // 维护 AI 只看当前命中的实体本体信息，不看旧的关联实体列表。
        linkedNames: [],
      }))
    const patch = await generateMaintenancePatch({
      currentTime: getSnapshotCurrentTime(snapshot),
      narrativeTimeText: input?.narrativeTimeText,
      globals: getSnapshotGlobals(snapshot),
      messages: input?.maintenanceMessages ?? messages.slice(-2),
      activeEvents: activeEvents.map(toEventRecord),
      archives: maintenanceArchives,
    })

    runtimeEngine.applyRuntimeStatePatch({
      currentTime: patch.currentTime,
      globals: patch.globals?.set,
    })
    latestSnapshot = await runtimeEngine.getSnapshot()

    const visibleBeforeArchives = [...maintenanceArchives]
    const archivePatches = attachArchiveStrongRefs(patch.archives ?? [], visibleBeforeArchives)
    const changedArchives = await applyArchivePatchesForSave(activeSaveId, archivePatches)
    const visibleArchives = mergeArchiveRefsById([
      ...visibleBeforeArchives,
      ...changedArchives.map(archiveRecordFromLocal),
    ])
    const eventPatches = attachEventStrongRefs(patch.events ?? [], visibleArchives)
    for (const eventPatch of eventPatches) {
      await applyEventPatchForSave(activeSaveId, eventPatch)
    }
  } catch (error) {
    // 原型期至少要把维护失败暴露到控制台，避免静默吞掉问题。
    console.warn("Tsian maintenance failed.", error)
  }

  await saveSnapshotForSave(activeSaveId, latestSnapshot)
  await saveHistoryForSave(activeSaveId, getSnapshotMessages(latestSnapshot))
  await createCheckpointForSave(activeSaveId, {
    snapshot: latestSnapshot,
    history: getSnapshotMessages(latestSnapshot),
    events: await listEventsForSave(activeSaveId),
    archives: await listArchivesForSave(activeSaveId),
    reason: "after-turn",
    label: `回合 ${latestSnapshot.state.turn}`,
  })
}

export const playFrontendBridge: PlayFrontendBridge = {
  runtime: baseBridge.runtime,
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

      return baseBridge.query.query(request)
    },
  },
  interaction: {
    async sendMessage(input) {
      const activeSaveId = await getActiveSaveId()
      if (!activeSaveId) {
        await baseBridge.interaction.sendMessage(input)
        await persistActiveSnapshot()
        return {
          snapshot: await runtimeEngine.getSnapshot(),
        }
      }

      const history = await getHistoryForSave(activeSaveId)
      const events = await listEventsForSave(activeSaveId)
      const activeEvents = await listActiveEventsForSave(activeSaveId)
      const activeEvent = activeEvents[0] ?? null
      const archives = (await listArchivesForSave(activeSaveId)).map(toArchiveRecord)
      const currentSnapshot = await runtimeEngine.getSnapshot()
      const currentTime = getSnapshotCurrentTime(currentSnapshot)
      const narrativeTimeText = getNarrativeTimeText(input.narrativeTimeText, currentTime)
      const modId = await getModIdForSave(activeSaveId)
      const mod = getBuiltinMod(modId) ?? getDefaultBuiltinMod()
      const retrieval = await assembleRetrievalContext({
        messages: history,
        userInput: input.content,
        events,
        catalogEvents: mod.eventCatalog,
        activeEvent,
        activeEvents,
        archives,
        currentTime,
        narrativeTimeText,
        globals: getSnapshotGlobals(currentSnapshot),
        settings: getBrowserRetrievalSettings(),
      })

      retrievalDebugBySave.set(activeSaveId, retrieval.debug)

      const result = await runtimeEngine.sendMessageWithContext(input, {
        prompt: retrieval.prompt,
      })
      const snapshot = result.snapshot
      const snapshotMessages = getSnapshotMessages(snapshot)
      await persistActiveSnapshot({
        maintenanceMessages: snapshotMessages.slice(-2),
        maintenanceArchiveNames: retrieval.debug.directEntities,
        narrativeTimeText,
      })
      return {
        snapshot: await runtimeEngine.getSnapshot(),
      }
    },
  },
}

export async function initializePlatformHost(): Promise<void> {
  const saves = await listLocalSaves()
  const activeSaveId = await getActiveSaveId()

  if (activeSaveId) {
    const activeSave = saves.find((save) => save.id === activeSaveId)
    if (activeSave) {
      runtimeEngine.loadSnapshot(await getSnapshotForSave(activeSaveId))
      return
    }

    await setActiveSaveId(null)
  }

  if (saves.length > 0) {
    const next = saves[0]
    await setActiveSaveId(next.id)
    runtimeEngine.loadSnapshot(await getSnapshotForSave(next.id))
  }
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
