# Runtime Workspace Storage/API MVP Design

## Scope

This task adds the storage and bridge API foundation for a Runtime Workspace. It keeps the current Agent Runtime turn flow intact and does not make agents consume workspace files yet.

This MVP intentionally does not add a workspace viewer/editor UI. UI management is a follow-up slice after the storage and API contract are stable.

## Architecture

### Contracts

Add workspace-facing shared shapes to `packages/contracts/src/runtime.ts` because play frontends and platform-web both need to exchange workspace query/action payloads through the existing bridge:

- `WorkspaceEntryKind = "file" | "directory"`
- `WorkspaceEntry`
- `WorkspaceFile`
- `WorkspaceListResult`
- `WorkspaceSearchResult`

The generic `DeepQueryRequest` and `PlatformActionRequest` remain unchanged. Workspace operations are selected by resource/action strings and typed by consumers where useful.

### Local Persistence

Add a new Dexie table in `apps/platform-web/src/storage/db.ts`:

```ts
workspaceFiles: "&id, saveId, path, updatedAt"
```

Each row represents a file, not a directory:

- `id`: deterministic table key from `saveId + workspace path`.
- `saveId`: owning save.
- `path`: normalized root-relative path without leading slash.
- `content`: UTF-8 text content.
- `mediaType`: optional string, default inferred from extension or `text/plain`.
- `createdAt`: timestamp.
- `updatedAt`: timestamp.

Directories are virtual. Listing derives directory entries from file paths.

This keeps the MVP simple and close to the product direction: a virtual file system without implementing a full hierarchical database.

### Default Workspace

When creating a new save, insert default files if absent:

- `README.md`
- `agents/README.md`
- `skills/README.md`
- `history/README.md`
- `history/timeline.md`
- `world/README.md`
- `world/canon.md`
- `memory/README.md`
- `memory/summaries/current.md`
- `memory/summaries/long-term.md`
- `frontend/README.md`
- `frontend/view-state.json`
- `archive/README.md`
- `.tsian/manifest.json`
- `.tsian/traces/README.md`
- `.tsian/checkpoints/README.md`
- `.tsian/indexes/README.md`
- `.tsian/cache/README.md`

The default files should describe conventions only. They must not hardcode gameplay-specific event/archive/state semantics.

### Storage API

Create `apps/platform-web/src/storage/workspace.ts` with helpers:

- `initializeWorkspaceForSave(saveId)`
- `listWorkspaceEntriesForSave(saveId, input)`
- `readWorkspaceFileForSave(saveId, path)`
- `writeWorkspaceFileForSave(saveId, input)`
- `deleteWorkspacePathForSave(saveId, path)`
- `searchWorkspaceFilesForSave(saveId, input)`
- `listLocalWorkspaceFilesForSave(saveId)`
- `replaceWorkspaceFilesForSave(saveId, files)`
- `deleteWorkspaceForSave(saveId)`

Path normalization should:

- trim whitespace;
- convert backslashes to slashes;
- remove leading slashes;
- collapse repeated slashes;
- reject empty paths for file operations;
- reject `.` / `..` segments;
- reject paths ending in `/` for file read/write;
- allow dot-prefixed names such as `.tsian`.

### Bridge API

Extend `apps/platform-web/src/platform-host/index.ts`.

Queries:

- `workspace-list`
  - params: `{ path?: string }`
  - returns `WorkspaceEntry[]`.
- `workspace-read`
  - params: `{ path: string }`
  - returns `WorkspaceFile[]` with zero or one item.
- `workspace-search`
  - params: `{ query: string; limit?: number }`
  - returns `WorkspaceSearchResult[]`.

Actions:

- `workspace-write`
  - params: `{ path: string; content: string; mediaType?: string }`
  - returns the written `WorkspaceFile`.
- `workspace-delete`
  - params: `{ path: string }`
  - returns `{ deletedPaths: string[] }`.

This follows the current bridge style and avoids adding a new bridge namespace before the API has stabilized.

### Checkpoint Compatibility

Extend `LocalCheckpointRecord` to include workspace files. `createCheckpointForSave` stores all workspace files without `saveId`, and `restoreCheckpointForSave` replaces the active save workspace with checkpoint workspace files.

Because this project is still a prototype and current spec says prototype schema changes may use a new database name, the Dexie database name can bump from `tsian-agent-runtime-v1` to a new versioned name. This avoids brittle IndexedDB migrations while the storage shape is still moving.

### Existing State Compatibility

`stateRecords` remains unchanged. Runtime Workspace is introduced beside it. Later tasks can migrate stateRecords into workspace files or keep a compatibility adapter.

## Data Flow

New save:

```text
createLocalSave
  -> write save/snapshot/history rows
  -> initializeWorkspaceForSave
  -> create initial checkpoint including workspace files
```

Workspace write:

```text
frontend/platform caller
  -> platform.runAction("workspace-write")
  -> validate active save and params
  -> writeWorkspaceFileForSave
  -> return WorkspaceFile
```

Checkpoint restore:

```text
restore-checkpoint
  -> restore snapshot/history/stateRecords
  -> replace workspace files with checkpoint workspace files
  -> reload runtime snapshot
```

## Trade-Offs

- File rows plus virtual directories are easier to build and query than a full inode tree.
- Bridge resource/action strings are less elegant than a dedicated workspace namespace, but they fit the current bridge and keep the first slice small.
- Text-only files are enough for `AGENT.md`, `SKILL.md`, JSON, JSONL, Markdown, and schemas. Binary assets can be added later with blobs or external asset references.
- Bumping the local prototype DB name loses old local prototype sessions, but avoids hidden migration bugs while the product storage model is still under active design.
- Deferring UI makes the first slice less visible but keeps the implementation focused on durable storage and rollback behavior.

## Rollback

The change should be easy to revert because it is additive:

- Remove workspace contract types.
- Remove `storage/workspace.ts`.
- Remove the `workspaceFiles` table and checkpoint field.
- Remove bridge query/action cases.
