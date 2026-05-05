import type { EventPatchItem, EventRecord } from "@tsian/contracts"
import { getCurrentNarrativeTime } from "../narrative-time"
import { localDb, type LocalEventRecord } from "./db"

function createEventId(saveId: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${saveId}:event:${crypto.randomUUID()}`
  }

  return `${saveId}:event:${Date.now()}`
}

export async function getActiveEventForSave(
  saveId: string,
): Promise<LocalEventRecord | null> {
  const rows = await listActiveEventsForSave(saveId)
  return rows[0] ?? null
}

export async function listActiveEventsForSave(
  saveId: string,
): Promise<LocalEventRecord[]> {
  const rows = await localDb.events.where("saveId").equals(saveId).toArray()
  return rows
    .filter((item) => item.status === "ongoing")
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function applyEventPatchForSave(
  saveId: string,
  patch: EventPatchItem,
): Promise<void> {
  const now = Date.now()
  const nowTime = getCurrentNarrativeTime()

  if (patch.create) {
    await localDb.events.put({
      id: createEventId(saveId),
      saveId,
      time: patch.create.time ?? nowTime,
      status: patch.create.status,
      entityTags: patch.create.entityTags ?? [],
      entityArchiveIds: patch.create.entityArchiveIds,
      content: patch.create.content ?? "",
      updatedAt: now,
    })
    return
  }

  if (!patch.set || !patch.target) {
    return
  }

  const current =
    patch.target === "active"
      ? await getActiveEventForSave(saveId)
      : await localDb.events.get(patch.target)

  if (!current || current.saveId !== saveId) {
    return
  }

  await localDb.events.put({
    ...current,
    time: patch.set.time ?? current.time,
    status: patch.set.status ?? current.status,
    entityTags: patch.set.entityTags ?? current.entityTags,
    entityArchiveIds: patch.set.entityArchiveIds ?? current.entityArchiveIds,
    content: patch.set.content ?? current.content,
    updatedAt: now,
  })
}

export async function listEventsForSave(saveId: string): Promise<LocalEventRecord[]> {
  const rows = await localDb.events.where("saveId").equals(saveId).toArray()
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function toEventRecord(input: LocalEventRecord): EventRecord {
  return {
    id: input.id,
    time: input.time,
    status: input.status,
    entityTags: input.entityTags,
    entityArchiveIds: input.entityArchiveIds,
    content: input.content,
  }
}

export async function deleteEventsForSave(saveId: string): Promise<void> {
  const rows = await localDb.events.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.events.delete(item.id)))
}
