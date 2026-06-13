import type {
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceSearchResult,
} from "@tsian/contracts"
import { localDb, type LocalWorkspaceFileRecord } from "./db"

export type CheckpointWorkspaceFile = Omit<LocalWorkspaceFileRecord, "id" | "saveId">

export interface WorkspaceListInput {
  path?: unknown
  includePlatformTraces?: boolean
}

export interface WorkspaceSearchInput {
  query?: string
  limit?: number
  includePlatformTraces?: boolean
}

export interface WorkspaceWriteInput {
  path?: unknown
  content?: unknown
  mediaType?: unknown
}

export class WorkspaceStorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "WorkspaceStorageError"
  }
}

const DEFAULT_SEARCH_LIMIT = 50
const MAX_SEARCH_LIMIT = 200
const PLATFORM_TRACE_PATH_PREFIX = ".tsian/traces/"

const DEFAULT_WORKSPACE_FILES: Array<{
  path: string
  content: string
  mediaType?: string
}> = [
  {
    path: "README.md",
    content: [
      "# Runtime Workspace",
      "",
      "This save-scoped workspace stores runtime data as virtual files.",
      "Agents, skills, world data, memory, frontend data, and platform metadata can all live here.",
      "",
      "Read directory README files before changing data conventions.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/README.md",
    content: [
      "# Agents",
      "",
      "Agent definitions live under `agents/<agent>/AGENT.md`.",
      "Agent-local skills can live under `agents/<agent>/skills/`.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/AGENT.md",
    content: [
      "---",
      "id: master",
      "title: Master Agent",
      "summary: Coordinates each AIRP turn, manages shared context, and delegates to specialist agents when useful.",
      "contacts:",
      "  - memory",
      "defaultSkills:",
      "contextPaths:",
      "  - README.md",
      "  - history/timeline.md",
      "  - world/README.md",
      "  - memory/summaries/current.md",
      "---",
      "",
      "# Master Agent",
      "",
      "You are the entry agent for an AIRP turn.",
      "Read the relevant workspace context, decide what needs to happen next, and contact specialist agents when their responsibilities match the current situation.",
      "Contact the memory agent when continuity, current-scene recall, durable facts, or summary maintenance could affect the turn.",
      "Use historyMode `recent` by default, and use `scene` only when the continuity question depends on more of the current scene.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/master/notes.md",
    content: "# Master Notes\n\n",
  },
  {
    path: "agents/master/session.jsonl",
    content: "",
    mediaType: "application/x-ndjson",
  },
  {
    path: "agents/narrative/AGENT.md",
    content: [
      "---",
      "id: narrative",
      "title: Narrative Agent",
      "summary: Turns plans, world facts, and character state into player-facing prose.",
      "contacts:",
      "  - master",
      "defaultSkills:",
      "contextPaths:",
      "  - history/timeline.md",
      "  - world/README.md",
      "  - world/canon.md",
      "  - memory/summaries/current.md",
      "---",
      "",
      "# Narrative Agent",
      "",
      "You write the player-facing narrative for a turn.",
      "Use established world facts and recent history, preserve continuity, and ask the master agent when the requested direction needs coordination.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/narrative/notes.md",
    content: "# Narrative Notes\n\n",
  },
  {
    path: "agents/narrative/session.jsonl",
    content: "",
    mediaType: "application/x-ndjson",
  },
  {
    path: "agents/memory/AGENT.md",
    content: [
      "---",
      "id: memory",
      "title: Memory Agent",
      "summary: Checks continuity, current-scene memory, and durable fact candidates for AIRP turns.",
      "contacts:",
      "defaultSkills:",
      "contextPaths:",
      "  - README.md",
      "  - history/timeline.md",
      "  - memory/README.md",
      "  - memory/summaries/current.md",
      "  - memory/summaries/long-term.md",
      "  - world/canon.md",
      "---",
      "",
      "# Memory Agent",
      "",
      "You support AIRP continuity and memory decisions for the calling agent.",
      "Check whether the current request conflicts with known timeline, summaries, canon, character facts, or recent scene details.",
      "Return concise findings, current-scene summary suggestions, long-term memory candidates, and any facts worth preserving.",
      "Do not claim that you wrote or updated memory files unless you explicitly used a loaded Skill action that performs that write.",
      "",
    ].join("\n"),
  },
  {
    path: "agents/memory/notes.md",
    content: "# Memory Notes\n\n",
  },
  {
    path: "agents/memory/session.jsonl",
    content: "",
    mediaType: "application/x-ndjson",
  },
  {
    path: "skills/README.md",
    content: [
      "# Shared Skills",
      "",
      "Shared skills live under `skills/<skill>/SKILL.md`.",
      "Only summaries and triggers should be indexed eagerly; details load on demand.",
      "",
    ].join("\n"),
  },
  {
    path: "history/README.md",
    content: [
      "# History",
      "",
      "Keep durable conversation records and timeline summaries here.",
      "Avoid storing every intermediate trace in this directory.",
      "",
    ].join("\n"),
  },
  {
    path: "history/timeline.md",
    content: "# Timeline\n\n",
  },
  {
    path: "world/README.md",
    content: [
      "# World",
      "",
      "Store world facts, rules, characters, places, relationships, and structured state here.",
      "Use local README or schema files to document conventions.",
      "",
    ].join("\n"),
  },
  {
    path: "world/canon.md",
    content: "# Canon\n\n",
  },
  {
    path: "memory/README.md",
    content: [
      "# Memory",
      "",
      "Store long-term summaries, durable facts, and retrieval-oriented notes here.",
      "",
    ].join("\n"),
  },
  {
    path: "memory/summaries/current.md",
    content: "# Current Summary\n\n",
  },
  {
    path: "memory/summaries/long-term.md",
    content: "# Long-Term Summary\n\n",
  },
  {
    path: "frontend/README.md",
    content: [
      "# Frontend Data",
      "",
      "Store data agreed between the runtime and active frontend package here.",
      "The platform does not interpret these fields.",
      "",
    ].join("\n"),
  },
  {
    path: "frontend/view-state.json",
    content: "{}\n",
    mediaType: "application/json",
  },
  {
    path: "archive/README.md",
    content: "# Archive\n\nRetired, compressed, or inactive workspace material can live here.\n",
  },
  {
    path: ".tsian/manifest.json",
    content: JSON.stringify({
      version: "0.0.0",
      workspaceVersion: 1,
    }, null, 2) + "\n",
    mediaType: "application/json",
  },
  {
    path: ".tsian/traces/README.md",
    content: "# Traces\n\nPlatform trace metadata can live here when exposed as workspace files.\n",
  },
  {
    path: ".tsian/checkpoints/README.md",
    content: "# Checkpoints\n\nPlatform checkpoint metadata can live here when exposed as workspace files.\n",
  },
  {
    path: ".tsian/indexes/README.md",
    content: "# Indexes\n\nGenerated or cached workspace indexes can live here.\n",
  },
  {
    path: ".tsian/cache/README.md",
    content: "# Cache\n\nTemporary platform cache data can live here.\n",
  },
]

function createTableId(saveId: string, path: string): string {
  return [
    saveId,
    "workspace",
    encodeURIComponent(path),
  ].join(":")
}

function normalizePathBase(value: unknown, options: {
  allowEmpty: boolean
  rejectTrailingSlash: boolean
}): string {
  if (typeof value !== "string") {
    throw new WorkspaceStorageError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path must be a string.",
    )
  }

  const hadTrailingSlash = /[\\/]$/.test(value.trim())
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "")

  if (!normalized) {
    if (options.allowEmpty) {
      return ""
    }
    throw new WorkspaceStorageError(
      "WORKSPACE_PATH_REQUIRED",
      "Workspace path is required.",
    )
  }

  if (options.rejectTrailingSlash && hadTrailingSlash) {
    throw new WorkspaceStorageError(
      "WORKSPACE_FILE_PATH_REQUIRED",
      "Workspace file path must not end with a slash.",
    )
  }

  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "." || segment === ".." || segment === "")) {
    throw new WorkspaceStorageError(
      "WORKSPACE_PATH_INVALID",
      "Workspace path must not contain empty, current, or parent directory segments.",
    )
  }

  return normalized
}

function normalizeDirectoryPath(value: unknown): string {
  return normalizePathBase(value ?? "", {
    allowEmpty: true,
    rejectTrailingSlash: false,
  })
}

export function normalizeWorkspaceFilePath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: true,
  })
}

function normalizeWorkspaceTargetPath(value: unknown): string {
  return normalizePathBase(value, {
    allowEmpty: false,
    rejectTrailingSlash: false,
  })
}

function normalizeMediaType(value: unknown, path: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  if (path.endsWith(".md")) return "text/markdown"
  if (path.endsWith(".json")) return "application/json"
  if (path.endsWith(".jsonl")) return "application/x-ndjson"
  if (path.endsWith(".ts")) return "text/typescript"
  if (path.endsWith(".js")) return "text/javascript"
  return "text/plain"
}

function fileName(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

function isPlatformTracePath(path: string): boolean {
  return path === ".tsian/traces" || path.startsWith(PLATFORM_TRACE_PATH_PREFIX)
}

function filterPlatformTraceRecords(
  records: LocalWorkspaceFileRecord[],
  includePlatformTraces: boolean | undefined,
): LocalWorkspaceFileRecord[] {
  if (includePlatformTraces) {
    return records
  }

  return records.filter((record) => !isPlatformTracePath(record.path))
}

function toWorkspaceFile(record: LocalWorkspaceFileRecord): WorkspaceFile {
  return {
    path: record.path,
    content: record.content,
    mediaType: record.mediaType,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function toCheckpointWorkspaceFile(
  record: LocalWorkspaceFileRecord,
): CheckpointWorkspaceFile {
  const { id: _id, saveId: _saveId, ...file } = record
  return file
}

export function createLocalWorkspaceFileRecord(
  saveId: string,
  file: CheckpointWorkspaceFile,
): LocalWorkspaceFileRecord {
  const path = normalizeWorkspaceFilePath(file.path)
  return {
    id: createTableId(saveId, path),
    saveId,
    path,
    content: typeof file.content === "string" ? file.content : "",
    mediaType: normalizeMediaType(file.mediaType, path),
    createdAt: typeof file.createdAt === "number" ? file.createdAt : Date.now(),
    updatedAt: typeof file.updatedAt === "number" ? file.updatedAt : Date.now(),
  }
}

function normalizeLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SEARCH_LIMIT
  }
  return Math.min(Math.floor(value), MAX_SEARCH_LIMIT)
}

function createPreview(content: string, index: number): string {
  if (index < 0) {
    return ""
  }

  const start = Math.max(0, index - 48)
  const end = Math.min(content.length, index + 96)
  const prefix = start > 0 ? "..." : ""
  const suffix = end < content.length ? "..." : ""
  return `${prefix}${content.slice(start, end)}${suffix}`.replace(/\s+/g, " ").trim()
}

async function touchSave(saveId: string, updatedAt: number): Promise<void> {
  const save = await localDb.saves.get(saveId)
  if (!save) {
    return
  }
  await localDb.saves.put({
    ...save,
    updatedAt,
  })
}

export async function initializeWorkspaceForSave(saveId: string): Promise<void> {
  const existingCount = await localDb.workspaceFiles.where("saveId").equals(saveId).count()
  if (existingCount > 0) {
    return
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    for (const file of DEFAULT_WORKSPACE_FILES) {
      const path = normalizeWorkspaceFilePath(file.path)
      await localDb.workspaceFiles.put({
        id: createTableId(saveId, path),
        saveId,
        path,
        content: file.content,
        mediaType: normalizeMediaType(file.mediaType, path),
        createdAt: now,
        updatedAt: now,
      })
    }
  })
}

export async function listLocalWorkspaceFilesForSave(
  saveId: string,
): Promise<LocalWorkspaceFileRecord[]> {
  const records = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  return records.sort((left, right) => left.path.localeCompare(right.path))
}

export async function listWorkspaceFilesForSave(
  saveId: string,
): Promise<WorkspaceFile[]> {
  return (await listLocalWorkspaceFilesForSave(saveId)).map(toWorkspaceFile)
}

export async function listCheckpointWorkspaceFilesForSave(
  saveId: string,
): Promise<CheckpointWorkspaceFile[]> {
  return (await listLocalWorkspaceFilesForSave(saveId)).map(toCheckpointWorkspaceFile)
}

export async function listWorkspaceEntriesForSave(
  saveId: string,
  input: WorkspaceListInput = {},
): Promise<WorkspaceEntry[]> {
  const directoryPath = normalizeDirectoryPath(input.path)
  const prefix = directoryPath ? `${directoryPath}/` : ""
  const records = filterPlatformTraceRecords(
    await listLocalWorkspaceFilesForSave(saveId),
    input.includePlatformTraces,
  )
  const files = new Map<string, WorkspaceEntry>()
  const directories = new Map<string, WorkspaceEntry & { children: Set<string> }>()

  for (const record of records) {
    if (directoryPath && !record.path.startsWith(prefix)) {
      continue
    }

    const remainder = directoryPath
      ? record.path.slice(prefix.length)
      : record.path
    if (!remainder) {
      continue
    }

    const slashIndex = remainder.indexOf("/")
    if (slashIndex === -1) {
      files.set(record.path, {
        path: record.path,
        name: fileName(record.path),
        kind: "file",
        mediaType: record.mediaType,
        size: record.content.length,
        updatedAt: record.updatedAt,
      })
      continue
    }

    const childName = remainder.slice(0, slashIndex)
    const childPath = prefix ? `${prefix}${childName}` : childName
    const nextSegment = remainder.slice(slashIndex + 1).split("/")[0]
    const existing = directories.get(childPath)
    if (existing) {
      existing.updatedAt = Math.max(existing.updatedAt ?? 0, record.updatedAt)
      if (nextSegment) existing.children.add(nextSegment)
      continue
    }

    const children = new Set<string>()
    if (nextSegment) children.add(nextSegment)
    directories.set(childPath, {
      path: childPath,
      name: childName,
      kind: "directory",
      updatedAt: record.updatedAt,
      childCount: 0,
      children,
    })
  }

  const directoryEntries = Array.from(directories.values()).map(
    ({ children, ...entry }) => ({
      ...entry,
      childCount: children.size,
    }),
  )

  return [
    ...directoryEntries.sort((left, right) => left.name.localeCompare(right.name)),
    ...Array.from(files.values()).sort((left, right) => left.name.localeCompare(right.name)),
  ]
}

export async function readWorkspaceFileForSave(
  saveId: string,
  pathInput: unknown,
): Promise<WorkspaceFile | null> {
  const path = normalizeWorkspaceFilePath(pathInput)
  const record = await localDb.workspaceFiles.get(createTableId(saveId, path))
  return record ? toWorkspaceFile(record) : null
}

export async function writeWorkspaceFileForSave(
  saveId: string,
  input: WorkspaceWriteInput,
): Promise<WorkspaceFile> {
  const path = normalizeWorkspaceFilePath(input.path)
  if (typeof input.content !== "string") {
    throw new WorkspaceStorageError(
      "WORKSPACE_CONTENT_REQUIRED",
      "Workspace file content must be a string.",
    )
  }

  const now = Date.now()
  const id = createTableId(saveId, path)
  let nextRecord: LocalWorkspaceFileRecord | null = null

  await localDb.transaction("rw", localDb.saves, localDb.workspaceFiles, async () => {
    const existing = await localDb.workspaceFiles.get(id)
    nextRecord = {
      id,
      saveId,
      path,
      content: input.content as string,
      mediaType: normalizeMediaType(input.mediaType, path),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    await localDb.workspaceFiles.put(nextRecord)
    await touchSave(saveId, now)
  })

  if (!nextRecord) {
    throw new WorkspaceStorageError(
      "WORKSPACE_WRITE_FAILED",
      "Workspace file write did not produce a record.",
    )
  }

  return toWorkspaceFile(nextRecord)
}

export async function deleteWorkspacePathForSave(
  saveId: string,
  pathInput: unknown,
): Promise<{ deletedPaths: string[] }> {
  const path = normalizeWorkspaceTargetPath(pathInput)
  const prefix = `${path}/`
  const rows = (await listLocalWorkspaceFilesForSave(saveId))
    .filter((record) => record.path === path || record.path.startsWith(prefix))

  if (rows.length === 0) {
    return { deletedPaths: [] }
  }

  const now = Date.now()
  await localDb.transaction("rw", localDb.saves, localDb.workspaceFiles, async () => {
    await Promise.all(rows.map((record) => localDb.workspaceFiles.delete(record.id)))
    await touchSave(saveId, now)
  })

  return {
    deletedPaths: rows.map((record) => record.path).sort(),
  }
}

export async function searchWorkspaceFilesForSave(
  saveId: string,
  input: WorkspaceSearchInput = {},
): Promise<WorkspaceSearchResult[]> {
  const query = typeof input.query === "string" ? input.query.trim().toLowerCase() : ""
  if (!query) {
    return []
  }

  const limit = normalizeLimit(input.limit)
  const records = filterPlatformTraceRecords(
    await listLocalWorkspaceFilesForSave(saveId),
    input.includePlatformTraces,
  )
  return records
    .flatMap((record): WorkspaceSearchResult[] => {
      const lowerPath = record.path.toLowerCase()
      const lowerContent = record.content.toLowerCase()
      const contentIndex = lowerContent.indexOf(query)
      const matchesPath = lowerPath.includes(query)
      if (!matchesPath && contentIndex < 0) {
        return []
      }

      return [{
        path: record.path,
        name: fileName(record.path),
        mediaType: record.mediaType,
        updatedAt: record.updatedAt,
        score: (matchesPath ? 2 : 0) + (contentIndex >= 0 ? 1 : 0),
        preview: contentIndex >= 0 ? createPreview(record.content, contentIndex) : record.path,
      }]
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      return right.updatedAt - left.updatedAt
    })
    .slice(0, limit)
}

export async function replaceWorkspaceFilesForSave(
  saveId: string,
  files: CheckpointWorkspaceFile[],
): Promise<void> {
  const deduped = new Map<string, LocalWorkspaceFileRecord>()
  for (const file of files) {
    const record = createLocalWorkspaceFileRecord(saveId, file)
    deduped.set(record.path, record)
  }

  const existing = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  await localDb.transaction("rw", localDb.workspaceFiles, async () => {
    await Promise.all(existing.map((record) => localDb.workspaceFiles.delete(record.id)))
    for (const record of deduped.values()) {
      await localDb.workspaceFiles.put(record)
    }
  })
}

export async function deleteWorkspaceForSave(saveId: string): Promise<void> {
  const rows = await localDb.workspaceFiles.where("saveId").equals(saveId).toArray()
  await Promise.all(rows.map((item) => localDb.workspaceFiles.delete(item.id)))
}
