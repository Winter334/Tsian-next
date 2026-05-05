import type {
  ConversationMessageRecord,
  RuntimeSnapshotShell,
  RuntimeWriteArchiveInput,
  RuntimeWriteEventInput,
} from "@tsian/contracts"
import { parseNarrativeTimeMs } from "../narrative-time"
import { createArchiveId } from "./archives"
import { localDb, type LocalArchiveRecord, type LocalEventRecord } from "./db"

function createEventId(saveId: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${saveId}:event:${crypto.randomUUID()}`
  }

  return `${saveId}:event:${Date.now()}`
}

function allocateEventId(saveId: string, reservedIds: Set<string>): string {
  for (let index = 0; index < 64; index += 1) {
    const candidate = createEventId(saveId)
    if (!reservedIds.has(candidate)) {
      reservedIds.add(candidate)
      return candidate
    }
  }

  throw new Error("Failed to allocate event id.")
}

async function normalizeArchives(
  saveId: string,
  archives: RuntimeWriteArchiveInput[],
): Promise<LocalArchiveRecord[]> {
  const now = Date.now()
  const reservedIds = new Set<string>()

  return Promise.all(
    archives.map(async (archive, index) => {
      const {
        id,
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
      } = archive

      const nextId = typeof id === "string" && id.trim()
        ? id.trim()
        : await createArchiveId(type, reservedIds)

      reservedIds.add(nextId)

      return {
        id: nextId,
        saveId,
        type,
        name,
        aliases,
        background,
        situation,
        focus,
        linkedNames,
        linkedArchiveIds,
        presence,
        updatedAt: now + index,
        ...extraFields,
      }
    }),
  )
}

function normalizeEvents(
  saveId: string,
  events: RuntimeWriteEventInput[],
): LocalEventRecord[] {
  const now = Date.now()
  const reservedIds = new Set<string>()

  return events.map((event, index) => {
    const nextId =
      typeof event.id === "string" && event.id.trim()
        ? event.id.trim()
        : allocateEventId(saveId, reservedIds)

    reservedIds.add(nextId)

    const parsedTime = parseNarrativeTimeMs(event.time)
    return {
      id: nextId,
      saveId,
      time: event.time,
      status: event.status,
      entityTags: event.entityTags,
      entityArchiveIds: event.entityArchiveIds,
      content: event.content,
      updatedAt: parsedTime !== null ? parsedTime + index : now + index,
    }
  })
}

export async function replaceRuntimeForSave(
  saveId: string,
  input: {
    snapshot: RuntimeSnapshotShell
    history: ConversationMessageRecord[]
    events: RuntimeWriteEventInput[]
    archives: RuntimeWriteArchiveInput[]
  },
): Promise<{
  snapshot: RuntimeSnapshotShell
  history: ConversationMessageRecord[]
  events: LocalEventRecord[]
  archives: LocalArchiveRecord[]
}> {
  // 运行时正式写入口必须原子替换完整切片，避免前端自行串改多张表后状态失真。
  const nextEvents = normalizeEvents(saveId, input.events)
  const nextArchives = await normalizeArchives(saveId, input.archives)
  const now = Date.now()

  await localDb.transaction(
    "rw",
    localDb.tables,
    async () => {
      const save = await localDb.saves.get(saveId)
      if (!save) {
        throw new Error("Save not found.")
      }

      await localDb.saveSnapshots.put({
        saveId,
        snapshot: input.snapshot,
      })
      await localDb.saveHistory.put({
        saveId,
        messages: input.history,
      })

      const currentEvents = await localDb.events.where("saveId").equals(saveId).toArray()
      await Promise.all(currentEvents.map((item) => localDb.events.delete(item.id)))
      for (const event of nextEvents) {
        await localDb.events.put(event)
      }

      const currentArchives = await localDb.archives.where("saveId").equals(saveId).toArray()
      await Promise.all(currentArchives.map((item) => localDb.archives.delete(item.id)))
      for (const archive of nextArchives) {
        await localDb.archives.put(archive)
      }

      await localDb.saves.put({
        ...save,
        updatedAt: now,
      })
    },
  )

  return {
    snapshot: input.snapshot,
    history: input.history,
    events: nextEvents,
    archives: nextArchives,
  }
}
