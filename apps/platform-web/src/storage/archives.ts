import type {
  ArchiveBaseKind,
  ArchiveKind,
  ArchivePatchItem,
  ArchiveRecord,
  JsonValue,
} from "@tsian/contracts"
import { localDb, type LocalArchiveRecord } from "./db"

const ARCHIVE_ID_PREFIX: Record<ArchiveBaseKind, string> = {
  character: "C",
  location: "L",
  item: "I",
  organization: "O",
  other: "X",
}

const ARCHIVE_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const ARCHIVE_ID_RANDOM_LENGTH = 3
const ARCHIVE_ID_MAX_RETRY = 64

const RESERVED_ARCHIVE_KEYS = new Set(["id", "saveId", "updatedAt"])
const BASE_ARCHIVE_KEYS = new Set([
  "kind",
  "name",
  "aliases",
  "background",
  "situation",
  "focus",
  "linkedNames",
  "presence",
])

function createRandomTail(length: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const array = new Uint32Array(length)
    crypto.getRandomValues(array)

    return Array.from(array, (value) => {
      return ARCHIVE_ID_ALPHABET[value % ARCHIVE_ID_ALPHABET.length]
    }).join("")
  }

  return Array.from({ length }, () => {
    const index = Math.floor(Math.random() * ARCHIVE_ID_ALPHABET.length)
    return ARCHIVE_ID_ALPHABET[index]
  }).join("")
}

function isArchiveBaseKind(value: string): value is ArchiveBaseKind {
  return value in ARCHIVE_ID_PREFIX
}

function getArchiveBaseKind(kind: ArchiveKind | string): ArchiveBaseKind {
  const base = kind.split(":")[0]?.trim()
  if (base && isArchiveBaseKind(base)) {
    return base
  }

  return "other"
}

function isJsonValue(value: unknown): value is JsonValue {
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

  if (typeof value !== "object") {
    return false
  }

  return Object.values(value).every((item) => isJsonValue(item))
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value
    .flatMap((item) => {
      if (typeof item !== "string") {
        return []
      }

      const trimmed = item.trim()
      return trimmed ? [trimmed] : []
    })

  return [...new Set(items)]
}

function extractArchiveWriteFields(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}

  if (typeof raw.kind === "string" && raw.kind.trim()) {
    fields.kind = raw.kind.trim()
  }
  if (typeof raw.name === "string" && raw.name.trim()) {
    fields.name = raw.name.trim()
  }

  const aliases = normalizeStringArray(raw.aliases)
  if (aliases) {
    fields.aliases = aliases
  }

  if (typeof raw.background === "string") {
    fields.background = raw.background.trim()
  }
  if (typeof raw.situation === "string") {
    fields.situation = raw.situation.trim()
  }
  if (typeof raw.focus === "string") {
    fields.focus = raw.focus.trim()
  }

  const linkedNames = normalizeStringArray(raw.linkedNames)
  if (linkedNames) {
    fields.linkedNames = linkedNames
  }

  if (
    raw.presence === "foreground" ||
    raw.presence === "background" ||
    raw.presence === "retired"
  ) {
    fields.presence = raw.presence
  }

  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_ARCHIVE_KEYS.has(key) || BASE_ARCHIVE_KEYS.has(key)) {
      continue
    }

    if (isJsonValue(value)) {
      fields[key] = value
    }
  }

  return fields
}

async function archiveIdExists(id: string): Promise<boolean> {
  return (await localDb.archives.get(id)) !== undefined
}

export async function createArchiveId(
  kind: ArchiveKind | string,
  reservedIds: Set<string> = new Set(),
): Promise<string> {
  const prefix = ARCHIVE_ID_PREFIX[getArchiveBaseKind(kind)]

  for (let index = 0; index < ARCHIVE_ID_MAX_RETRY; index += 1) {
    const candidate = `${prefix}${createRandomTail(ARCHIVE_ID_RANDOM_LENGTH)}`
    if (reservedIds.has(candidate)) {
      continue
    }

    if (!(await archiveIdExists(candidate))) {
      reservedIds.add(candidate)
      return candidate
    }
  }

  throw new Error("Failed to allocate archive id.")
}

function findArchiveById(
  archives: LocalArchiveRecord[],
  id: string,
): LocalArchiveRecord | null {
  return archives.find((item) => item.id === id) ?? null
}

export async function listArchivesForSave(
  saveId: string,
): Promise<LocalArchiveRecord[]> {
  const rows = await localDb.archives.where("saveId").equals(saveId).toArray()
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function toArchiveRecord(input: LocalArchiveRecord): ArchiveRecord {
  const { saveId: _saveId, updatedAt: _updatedAt, ...rest } = input
  return rest as ArchiveRecord
}

export async function applyArchivePatchesForSave(
  saveId: string,
  patches: ArchivePatchItem[],
): Promise<void> {
  if (patches.length === 0) {
    return
  }

  const existing = await listArchivesForSave(saveId)
  const reservedIds = new Set(existing.map((item) => item.id))
  const now = Date.now()

  for (const patch of patches) {
    if (patch.target && patch.set && typeof patch.set === "object" && !Array.isArray(patch.set)) {
      const current = findArchiveById(existing, patch.target.trim())
      if (!current) {
        continue
      }

      const updated: LocalArchiveRecord = {
        ...current,
        ...extractArchiveWriteFields(patch.set as Record<string, unknown>),
        updatedAt: now,
      }
      const index = existing.findIndex((item) => item.id === current.id)
      if (index >= 0) {
        existing[index] = updated
      }
      await localDb.archives.put(updated)
      continue
    }

    if (!patch.create || typeof patch.create !== "object" || Array.isArray(patch.create)) {
      continue
    }

    const createFields = extractArchiveWriteFields(patch.create as Record<string, unknown>)
    if (typeof createFields.kind !== "string" || typeof createFields.name !== "string") {
      continue
    }

    const created: LocalArchiveRecord = {
      id: await createArchiveId(createFields.kind),
      saveId,
      kind: createFields.kind as ArchiveKind,
      name: createFields.name as string,
      aliases: Array.isArray(createFields.aliases) ? (createFields.aliases as string[]) : [],
      background:
        typeof createFields.background === "string" ? createFields.background : "",
      situation:
        typeof createFields.situation === "string" ? createFields.situation : "",
      focus: typeof createFields.focus === "string" ? createFields.focus : "",
      linkedNames: Array.isArray(createFields.linkedNames)
        ? (createFields.linkedNames as string[])
        : [],
      presence:
        createFields.presence === "foreground" ||
        createFields.presence === "background" ||
        createFields.presence === "retired"
          ? createFields.presence
          : "foreground",
      updatedAt: now,
      ...Object.fromEntries(
        Object.entries(createFields).filter(([key]) => !BASE_ARCHIVE_KEYS.has(key)),
      ),
    }
    existing.unshift(created)
    reservedIds.add(created.id)
    await localDb.archives.put(created)
  }
}

export async function deleteArchivesForSave(saveId: string): Promise<void> {
  const rows = await localDb.archives.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.archives.delete(item.id)))
}
