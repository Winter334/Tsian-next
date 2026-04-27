import type { EventPatchItem, EventRecord } from "@tsian/contracts"
import { localDb, type LocalEventRecord } from "./db"

function createEventId(saveId: string): string {
  return `${saveId}:event:${Date.now()}`
}

export async function getActiveEventForSave(
  saveId: string,
): Promise<LocalEventRecord | null> {
  const rows = await localDb.events.where("saveId").equals(saveId).toArray()
  return rows.find((item) => item.status === "ongoing") ?? null
}

export async function applyEventPatchForSave(
  saveId: string,
  patch: EventPatchItem,
): Promise<void> {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const active = await getActiveEventForSave(saveId)
  const set = patch.set

  if (!set) {
    return
  }

  if (!active) {
    if (!set.status) {
      return
    }

    await localDb.events.put({
      id: createEventId(saveId),
      saveId,
      time: set.time ?? nowIso,
      status: set.status,
      entityTags: set.entityTags ?? [],
      content: set.content ?? "",
      updatedAt: now,
    })
    return
  }

  await localDb.events.put({
    ...active,
    time: set.time ?? active.time,
    status: set.status ?? active.status,
    entityTags: set.entityTags ?? active.entityTags,
    content: set.content ?? active.content,
    updatedAt: now,
  })
}

export async function listEventsForSave(saveId: string): Promise<LocalEventRecord[]> {
  const rows = await localDb.events.where("saveId").equals(saveId).toArray()
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function toEventRecord(input: LocalEventRecord): EventRecord {
  return {
    time: input.time,
    status: input.status,
    entityTags: input.entityTags,
    content: input.content,
  }
}

export async function deleteEventsForSave(saveId: string): Promise<void> {
  const rows = await localDb.events.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.events.delete(item.id)))
}
