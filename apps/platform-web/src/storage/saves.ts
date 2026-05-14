import type { ModInitialSavePayload, RuntimeSnapshotShell } from "@tsian/contracts"
import {
  localDb,
  type LocalArchiveRecord,
  type LocalSaveHistoryRecord,
  type LocalSaveRecord,
  type LocalSaveSnapshotRecord,
} from "./db"
import {
  createArchiveId,
  deleteArchivesForSave,
  listArchivesForSave,
} from "./archives"
import { createCheckpointForSave, deleteCheckpointsForSave } from "./checkpoints"
import { deleteEventsForSave, listEventsForSave } from "./events"
import {
  createBuiltinModInitialSavePayload,
  defaultModId,
  getBuiltinMod,
  getDefaultBuiltinMod,
} from "../../../../builtin/mods"
import { parseNarrativeTimeMs } from "../narrative-time"

const ACTIVE_SAVE_KEY = "active-save-id"

interface InitialArchiveRecord {
  type: string
  name: string
  aliases: string[]
  background: string
  situation: string
  focus?: string
  linkedNames: string[]
  linkedArchiveIds?: string[]
  presence: LocalArchiveRecord["presence"]
  [key: string]: unknown
}

interface InitialSavePayload extends Omit<ModInitialSavePayload, "archives"> {
  history: Array<{ role: string; content: string }>
  archives: InitialArchiveRecord[]
}

function getMessagesFromSnapshot(
  snapshot: RuntimeSnapshotShell,
): Array<{ role: string; content: string }> {
  const rawMessages = snapshot.state.messages
  if (!Array.isArray(rawMessages)) {
    return []
  }

  return rawMessages.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as { role?: unknown }).role === "string" &&
      typeof (item as { content?: unknown }).content === "string"
    ) {
      return [
        {
          role: (item as { role: string }).role,
          content: (item as { content: string }).content,
        },
      ]
    }

    return []
  })
}

function createInitialSavePayload(now: number, modId = defaultModId): InitialSavePayload {
  const mod = getBuiltinMod(modId) ?? getDefaultBuiltinMod()
  const payload = createBuiltinModInitialSavePayload(now, modId)
  const archives = payload.archives as InitialArchiveRecord[]
  const snapshot: RuntimeSnapshotShell = {
    ...payload.snapshot,
    state: {
      ...payload.snapshot.state,
      globals: {
        ...mod.globalsDefaults,
        ...(payload.snapshot.state.globals ?? {}),
      },
    },
  }

  return {
    ...payload,
    archives,
    snapshot,
    history: getMessagesFromSnapshot(snapshot),
  }
}
function createSaveId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `save-${Date.now()}`
}

export async function listLocalSaves(): Promise<LocalSaveRecord[]> {
  return localDb.saves.orderBy("updatedAt").reverse().toArray()
}

export async function getActiveSaveId(): Promise<string | null> {
  const record = await localDb.meta.get(ACTIVE_SAVE_KEY)
  return record?.value ?? null
}

export async function getModIdForSave(saveId: string): Promise<string> {
  const save = await localDb.saves.get(saveId)
  return save?.modId ?? defaultModId
}

export async function setActiveSaveId(saveId: string | null): Promise<void> {
  if (!saveId) {
    await localDb.meta.delete(ACTIVE_SAVE_KEY)
    return
  }

  await localDb.meta.put({
    key: ACTIVE_SAVE_KEY,
    value: saveId,
  })
}

export async function createLocalSave(
  name?: string,
  snapshot?: RuntimeSnapshotShell,
  modId = defaultModId,
): Promise<LocalSaveRecord> {
  const existing = await localDb.saves.count()
  const now = Date.now()
  const initial: InitialSavePayload = snapshot
    ? {
        snapshot,
        history: getMessagesFromSnapshot(snapshot),
        events: [],
        archives: [],
      }
    : createInitialSavePayload(now, modId)

  const save: LocalSaveRecord = {
    id: createSaveId(),
    name: name?.trim() || `Save ${existing + 1}`,
    modId,
    createdAt: now,
    updatedAt: now,
    playerArchiveIds: [],
  }

  const snapshotRecord: LocalSaveSnapshotRecord = {
    saveId: save.id,
    snapshot: initial.snapshot,
  }

  const historyRecord: LocalSaveHistoryRecord = {
    saveId: save.id,
    messages: initial.history,
  }

  await localDb.transaction(
    "rw",
    localDb.tables,
    async () => {
      await localDb.saves.put(save)
      await localDb.saveSnapshots.put(snapshotRecord)
      await localDb.saveHistory.put(historyRecord)

      for (const [index, event] of initial.events.entries()) {
        const parsedTime = parseNarrativeTimeMs(event.time)
        await localDb.events.put({
          id: `${save.id}:event:${now}:${index}`,
          saveId: save.id,
          ...event,
          updatedAt: parsedTime !== null ? parsedTime + index : now + index,
        })
      }

      const reservedArchiveIds = new Set<string>()
      for (const archive of initial.archives) {
        const nextArchive = archive as InitialArchiveRecord
        const {
          type,
          name,
          aliases,
          background,
          situation,
          focus,
          linkedNames,
          linkedArchiveIds,
          presence,
          ...extraFields
        } = nextArchive
        const localArchive: LocalArchiveRecord = {
          id: await createArchiveId(type, reservedArchiveIds),
          saveId: save.id,
          type,
          name,
          aliases,
          background,
          situation,
          focus,
          linkedNames,
          linkedArchiveIds,
          presence,
          updatedAt: now,
          ...extraFields,
        }
        await localDb.archives.put(localArchive)
      }
    },
  )

  await createCheckpointForSave(save.id, {
    snapshot: initial.snapshot,
    history: initial.history,
    events: await listEventsForSave(save.id),
    archives: await listArchivesForSave(save.id),
    reason: "initial",
    label: "初始状态",
  })

  return save
}

export async function getSnapshotForSave(
  saveId: string,
): Promise<RuntimeSnapshotShell> {
  const record = await localDb.saveSnapshots.get(saveId)
  return record?.snapshot ?? createInitialSavePayload(Date.now()).snapshot
}

export async function saveSnapshotForSave(
  saveId: string,
  snapshot: RuntimeSnapshotShell,
): Promise<void> {
  const now = Date.now()
  await localDb.transaction("rw", localDb.saves, localDb.saveSnapshots, async () => {
    await localDb.saveSnapshots.put({
      saveId,
      snapshot,
    })

    const save = await localDb.saves.get(saveId)
    if (save) {
      await localDb.saves.put({
        ...save,
        updatedAt: now,
      })
    }
  })
}

export async function deleteLocalSave(saveId: string): Promise<void> {
  await localDb.transaction(
    "rw",
    localDb.saves,
    localDb.saveSnapshots,
    localDb.saveHistory,
    async () => {
      await localDb.saves.delete(saveId)
      await localDb.saveSnapshots.delete(saveId)
      await localDb.saveHistory.delete(saveId)
    },
  )

  await deleteEventsForSave(saveId)
  await deleteArchivesForSave(saveId)
  await deleteCheckpointsForSave(saveId)
}

export async function getPlayerArchiveIdsForSave(saveId: string): Promise<string[]> {
  const record = await localDb.saves.get(saveId)
  return record?.playerArchiveIds ?? []
}

export async function setPlayerArchiveIdsForSave(
  saveId: string,
  playerArchiveIds: string[],
): Promise<void> {
  const save = await localDb.saves.get(saveId)
  if (!save) {
    return
  }
  await localDb.saves.put({
    ...save,
    playerArchiveIds,
    updatedAt: Date.now(),
  })
}

export async function getHistoryForSave(
  saveId: string,
): Promise<Array<{ role: string; content: string }>> {
  const record = await localDb.saveHistory.get(saveId)
  return record?.messages ?? []
}

export async function saveHistoryForSave(
  saveId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  await localDb.saveHistory.put({
    saveId,
    messages,
  })
}






