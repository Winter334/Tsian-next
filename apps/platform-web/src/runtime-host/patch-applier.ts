import type {
  ApplyPatchOutput,
  ArchivePatchItem,
  EventPatchItem,
  MaintenancePatchDocument,
} from "@tsian/contracts"
import {
  applyArchivePatchesForSave,
  applyEventPatchForSave,
  createCheckpointForSave,
  listArchivesForSave,
  listEventsForSave,
  listLocalStateRecordsForSave,
  replaceAirpMemoryForSave,
  toArchiveRecord,
  type LocalArchiveRecord,
} from "../storage"
import type { LocalRuntimeEngine } from "./engine"

/**
 * 维护 AI patch 应用器（design.md §12.1 / §13.1 / §13.3 / §13.9）。
 *
 * 应用顺序：currentTime → globals → archives → events
 * fail loud：任一子项失败立即 throw，不 catch、不回滚已 apply 的部分。
 * checkpoint：仅当 input.pushCheckpointReason 存在时创建（§13.9）。
 *
 * name → id 强引用解析（attachArchiveStrongRefs / attachEventStrongRefs）
 * 整体封装在 applier 内部，桥 API patch 路径共用同一份解析。
 */

export interface ApplyPatchInput {
  patch: MaintenancePatchDocument
  runtimeEngine: LocalRuntimeEngine
  saveId: string
  /** §13.9：传值时创建 checkpoint；undefined 则不创建。 */
  pushCheckpointReason?: "after-turn" | "manual"
  /** checkpoint label，未传时默认 `回合 ${turn}`。 */
  checkpointLabel?: string
}

export type { ApplyPatchOutput }

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

    const matches = visibleArchives.filter((archive) =>
      archiveNameKeys(archive).includes(normalized),
    )
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
    const setLinkedIds = resolveArchiveIdsByNames(
      stringArray(patch.set?.linkedNames),
      visibleArchives,
    )
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
    const createEntityIds = resolveArchiveIdsByNames(
      patch.create?.entityTags,
      visibleArchives,
    )
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

function getSnapshotMessages(snapshot: {
  state: { messages?: Array<{ role: string; content: string }> }
}): Array<{ role: string; content: string }> {
  return Array.isArray(snapshot.state.messages) ? snapshot.state.messages : []
}

function getSnapshotTurn(snapshot: { state: { turn?: unknown } }): number {
  return typeof snapshot.state.turn === "number" ? snapshot.state.turn : 0
}

export async function applyMaintenancePatch(
  input: ApplyPatchInput,
): Promise<ApplyPatchOutput> {
  const { patch, runtimeEngine, saveId, pushCheckpointReason, checkpointLabel } = input

  // ── 1. 计算变更标记 ──
  const currentTimeChanged =
    typeof patch.currentTime === "string" && patch.currentTime.trim() !== ""
  const globalsChanged = patch.globals?.set !== undefined

  // ── 2. apply currentTime + globals（runtime 状态切片） ──
  if (currentTimeChanged || globalsChanged) {
    runtimeEngine.applyRuntimeStatePatch({
      currentTime: patch.currentTime,
      globals: patch.globals?.set,
    })
  }

  // ── 3. 准备 archives 基线 visible（name → id 解析依据） ──
  const baselineArchives = (await listArchivesForSave(saveId)).map(toArchiveRecord)
  const visibleBefore = baselineArchives.map((item) => ({
    id: item.id,
    name: item.name,
    aliases: item.aliases,
  }))

  // ── 4. apply archives ──
  const archivePatches = attachArchiveStrongRefs(patch.archives ?? [], visibleBefore)
  const changedArchives = await applyArchivePatchesForSave(saveId, archivePatches)

  // ── 5. merge visible，供 events 强引用解析使用 ──
  const visibleAfter = mergeArchiveRefsById([
    ...visibleBefore,
    ...changedArchives.map(archiveRecordFromLocal),
  ])

  // ── 6. apply events ──
  const eventPatches = attachEventStrongRefs(patch.events ?? [], visibleAfter)
  for (const eventPatch of eventPatches) {
    await applyEventPatchForSave(saveId, eventPatch)
  }

  // ── 7. 同步 generic AIRP memory authority（bridge patch 是兼容写入口） ──
  const latestSnapshot = await runtimeEngine.getSnapshot()
  const latestEvents = await listEventsForSave(saveId)
  const latestArchives = await listArchivesForSave(saveId)
  await replaceAirpMemoryForSave(saveId, {
    snapshot: latestSnapshot,
    events: latestEvents,
    archives: latestArchives.map(toArchiveRecord),
  })

  // ── 8. 可选 checkpoint（§13.9） ──
  if (pushCheckpointReason) {
    const turn = getSnapshotTurn(latestSnapshot)
    await createCheckpointForSave(saveId, {
      snapshot: latestSnapshot,
      history: getSnapshotMessages(latestSnapshot),
      events: latestEvents,
      archives: latestArchives,
      stateRecords: await listLocalStateRecordsForSave(saveId),
      reason: pushCheckpointReason,
      label: checkpointLabel ?? `回合 ${turn}`,
    })
  }

  return {
    appliedArchives: changedArchives.map((item) => item.id),
    // §13.3 注释：appliedEventIds 暂时返回空数组（YAGNI）；
    // applyEventPatchForSave 当前不返回 id，暂未实现精确事件 id 捕获。
    // 如需精确返回，未来在 storage/events.ts 改 applyEventPatchForSave 签名。
    appliedEventIds: [],
    globalsChanged,
    currentTimeChanged,
  }
}
