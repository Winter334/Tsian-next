import type {
  DeepQueryRequest,
  DeepQueryResult,
  PlayFrontendBridge,
  RuntimeGlobalsMap,
  RuntimeSnapshotShell,
} from "@tsian/contracts"
import { createPlayFrontendBridge } from "../bridge"
import {
  applyEventPatchForSave,
  applyArchivePatchesForSave,
  createLocalSave,
  deleteLocalSave,
  getActiveEventForSave,
  getActiveSaveId,
  getHistoryForSave,
  getSnapshotForSave,
  listArchivesForSave,
  listEventsForSave,
  listLocalSaves,
  saveHistoryForSave,
  saveSnapshotForSave,
  setActiveSaveId,
  toArchiveRecord,
  toEventRecord,
} from "../storage"
import { LocalRuntimeEngine } from "../runtime-host"
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

  return new Date().toISOString()
}

function getSnapshotGlobals(snapshot: RuntimeSnapshotShell): RuntimeGlobalsMap {
  const raw = snapshot.state.globals
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {}
  }

  return raw
}

async function persistActiveSnapshot(input?: {
  maintenanceMessages?: Array<{ role: string; content: string }>
  maintenanceArchiveNames?: string[]
}) {
  const activeSaveId = await getActiveSaveId()
  if (!activeSaveId) {
    return
  }

  const snapshot = await runtimeEngine.getSnapshot()
  const messages = getSnapshotMessages(snapshot)
  let latestSnapshot = snapshot

  try {
    const activeEvent = await getActiveEventForSave(activeSaveId)
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
      globals: getSnapshotGlobals(snapshot),
      messages: input?.maintenanceMessages ?? messages.slice(-2),
      activeEvent: activeEvent ? toEventRecord(activeEvent) : null,
      archives: maintenanceArchives,
    })

    runtimeEngine.applyRuntimeStatePatch({
      currentTime: patch.currentTime,
      globals: patch.globals?.set,
    })
    latestSnapshot = await runtimeEngine.getSnapshot()

    const archiveNamePool = new Set(
      allArchives.map((item) => normalizeName(item.name)).filter(Boolean),
    )
    for (const archivePatch of patch.archives ?? []) {
      const createdName = archivePatch.create?.name
      const updatedName = archivePatch.set?.name
      if (typeof createdName === "string" && createdName.trim()) {
        archiveNamePool.add(normalizeName(createdName))
      }
      if (typeof updatedName === "string" && updatedName.trim()) {
        archiveNamePool.add(normalizeName(updatedName))
      }
    }

    const eventItem = patch.events?.[0]
    if (eventItem?.target === "active" && eventItem.set) {
      const safeEventItem = {
        ...eventItem,
        set: {
          ...eventItem.set,
          entityTags: (eventItem.set.entityTags ?? []).filter((tag: string) =>
            archiveNamePool.has(normalizeName(tag)),
          ),
        },
      }
      await applyEventPatchForSave(activeSaveId, safeEventItem)
    }

    await applyArchivePatchesForSave(activeSaveId, patch.archives ?? [])
  } catch (error) {
    // 原型期至少要把维护失败暴露到控制台，避免静默吞掉问题。
    console.warn("Tsian maintenance failed.", error)
  }

  await saveSnapshotForSave(activeSaveId, latestSnapshot)
  await saveHistoryForSave(activeSaveId, getSnapshotMessages(latestSnapshot))
}

export const playFrontendBridge: PlayFrontendBridge = {
  runtime: baseBridge.runtime,
  platform: baseBridge.platform,
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
      const activeEvent = await getActiveEventForSave(activeSaveId)
      const archives = (await listArchivesForSave(activeSaveId)).map(toArchiveRecord)
      const currentSnapshot = await runtimeEngine.getSnapshot()
      const retrieval = await assembleRetrievalContext({
        messages: history,
        userInput: input.content,
        events,
        activeEvent,
        archives,
        currentTime: getSnapshotCurrentTime(currentSnapshot),
        globals: getSnapshotGlobals(currentSnapshot),
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
      })
      return {
        snapshot: await runtimeEngine.getSnapshot(),
      }
    },
  },
}

export async function initializePlatformHost(): Promise<void> {
  const saves = await listLocalSaves()
  let activeSaveId = await getActiveSaveId()

  if (!activeSaveId || saves.length === 0) {
    const created = await createLocalSave()
    activeSaveId = created.id
    await setActiveSaveId(activeSaveId)
  }

  runtimeEngine.loadSnapshot(await getSnapshotForSave(activeSaveId))
}

export async function listPlatformSaves() {
  return listLocalSaves()
}

export async function createPlatformSave() {
  const created = await createLocalSave()
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
    const created = await createLocalSave()
    await setActiveSaveId(created.id)
    runtimeEngine.loadSnapshot(await getSnapshotForSave(created.id))
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
