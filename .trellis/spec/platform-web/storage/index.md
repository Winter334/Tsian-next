# platform-web Storage Specs

`apps/platform-web/src/storage/` owns Dexie schema and persistence helpers. Table interfaces and schema stay in `storage/db.ts`.

Use these specs when changing `apps/platform-web/src/storage/**` or any Dexie table/schema.

## Storage Layout

Dexie database name: `tsian-agent-runtime-v13`.

Tables:

- `meta`
- `gameCards`
- `gameCardContentFiles`
- `gameCardFrontendFiles`
- `saves`
- `checkpoints` — thin manifest (`path→hash` references into `blobs`); turn files excluded (archive-level shared, pruned to 1..N on restore).
- `workspaceFiles`
- `blobs` — content-addressed file content by SHA-256 hash + ownerSaveId; cross-checkpoint dedup of unchanged state files.
- `assistantAttachments`
- `skillConfigs`
- `embeddingIndex`

Built-in blank game cards seed the default Runtime Workspace template, including master/narrative/memory Agents, `studio-assistant`, official default Skills, framework knowledge docs, and `.tsian` platform metadata. Refreshing a stale `source: "builtin"` game card is allowed, but save workspaces must use non-overwriting workspace-version upgrades.

No old local data migration is expected.

## .tsian/ Layout

`.tsian/` is platform-owned metadata, hidden from ordinary Agent/Skill/frontend workspace APIs (`isPlatformMetadataPath`). It splits by lifecycle into two layers:

- **`.tsian/save/`** = per-save files, **enter checkpoint snapshots, roll back on restore**. Currently holds `save/traces/turns/*.jsonl` (master runtime trace; `formatRuntimeTracePath`). Assistant trace lives separately at `.tsian/local/assistant/traces/` (platform-level).
- **`.tsian/local/`** = platform-level local data, **excluded from checkpoint** (`isSaveRuntimePersistencePath` returns false for `.tsian/local/**`). Holds `.tsian/local/assistant/` (Dexie `meta` KV via `local-assistant-files.ts`). Future platform config (`.tsian/local/platform-config.json`) goes here — must not roll back with save.
- **`.tsian/manifest.json`** = per-save workspace manifest, enters checkpoint.

**Dexie-backed data is NOT in `.tsian/` files** — do not be misled by absent directories:
- Checkpoint metadata (id/turn/label/manifest) → `localDb.checkpoints` table (indexed by `saveId`).
- Embedding vector index → `localDb.embeddingIndex` table (indexed by `[scope+ownerId]` = `(save-runtime, saveId)`), high-frequency RAG query — file-ifying would wreck query performance.
- These stay in Dexie (structured, indexed, queried by saveId). The old `.tsian/checkpoints/`、`.tsian/indexes/`、`.tsian/cache/` placeholder READMEs were removed — they falsely implied data lived in files.

**Card deletion cascades**: `deleteLocalGameCard` first deletes all saves of that card (via `deleteLocalSave`, which cleans saves + workspaceFiles + checkpoints + blobs + embeddingIndex), then deletes the card + content/frontend files. No orphan data survives card deletion.

## Checkpoint Storage Model

Checkpoints store **thin manifests** (path→hash references into the `blobs` table), not full file content. This is the content-addressing layer that backs future cloud sync.

- **Append-only logs never enter checkpoint manifests** — turn files (`save/history/turns/turn-NNNNNN.json`) and runtime traces (`.tsian/save/traces/turns/turn-NNNNNN.jsonl`) are both append-only per-save logs: each turn appends one file, old files never change. Identified by `isAppendOnlyLogPath` (`history-turns.ts`). Restoring to turn N = prune the save's append-only logs to 1..N (`extractTurnFromLogPath`); logs 1..N already live in the save workspace (append-only), no copy from checkpoint needed. `isTurnFilePath` is a stricter subset (turn files only) used by the chunker for `semantic-type: "turn"` — traces are not turn semantic, so chunker must not use `isAppendOnlyLogPath`.
- **State files** (world/state/memory/agents/frontend, plus any `.tsian/` non-local non-log files) go through content addressing: SHA-256 hash → `blobs` table (deduped by `[hash+ownerSaveId]`) → manifest entry. Unchanged files across checkpoints share one blob row, zero duplicate copies.
- **Restore = scheme R (prune-on-restore)**: restoring to turn N prunes turn files to 1..N **and deletes checkpoints with turn > N** (the abandoned future branch). Rationale: with turn files pruned, future checkpoints cannot be restored anyway (their turn files are gone), so they have no retention value; leaving them pollutes the list with ghosts and risks state/turn mismatch. Restore has a confirm dialog (play-frontend) to prevent accidental triggers.
- **Pruning + GC**: `pruneCheckpointsForSave` runs at the end of every `commitSuccessfulRuntimeTurnForSave`. Keeps recent 50 + every 20 turns sparse + all initial/manual + current turn; deletes the rest. GC is a simple full-scan (collect referenced hashes from remaining manifests → delete orphan blobs by ownerSaveId) — no incremental refcount, because single-save blob count is tens-to-low-hundreds and pruning runs once per turn (dwarfed by the LLM call). M/K come from `getCheckpointPruneConfig()` seam (hardcoded 50/20 today; `platform-config` task will wire it to `.tsian/` config source).
- **Hash computation is async** (`crypto.subtle.digest`) and cannot run inside a Dexie transaction. Checkpoint build = hash+write blobs (outside tx) → small tx to write the thin-manifest record. Restore = prefetch all blobs by manifest (outside tx) → small tx to overwrite workspace + prune turns + delete future checkpoints.

## Quality

- Run `npm run build:web` for any storage change.
- If Dexie tables change, bump the DB name (rename-and-reset; no migration) and update `tsian-game-card-frontend-sw.js` which mirrors the name.
- Do not place IndexedDB schema fields outside `storage/db.ts`.
- Do not add migrations or compatibility layers for local IndexedDB without explicit approval.
- Do not create duplicate storage helpers for the same table.

## Source References

- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/checkpoints.ts`
- `apps/platform-web/src/storage/blobs.ts`
- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/storage/workspace.ts`
