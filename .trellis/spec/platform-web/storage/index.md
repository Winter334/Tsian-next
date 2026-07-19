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

Built-in blank game cards seed the default Runtime Workspace template, including the default novel AIRP Agent roster (`storyteller`, `researcher`, `stage-manager`, `world-architect`, `director`), Agent-local Skills, framework knowledge docs, save runtime files, and `.tsian` platform metadata. The built-in blank card's configured player-turn entrypoint is `storyteller`. Refreshing a stale `source: "builtin"` game card is allowed, but save workspaces must use non-overwriting workspace-version upgrades.

No old local data migration is expected.

## .tsian/ Layout

`.tsian/` is platform-owned metadata, hidden from ordinary Agent/Skill/frontend workspace APIs (`isPlatformMetadataPath`). It splits by lifecycle into two layers:

- **`.tsian/save/`** = per-save files, **enter checkpoint snapshots, roll back on restore**. Currently holds `save/traces/turns/*.jsonl` (formal player-turn runtime trace; `formatRuntimeTracePath`). Assistant trace lives separately at `.tsian/local/assistant/traces/` (platform-level).
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
- **Checkpoint record layers**: metadata (`label`, `retention`, `source`, `tags`, `visible`, `metadata`, timestamps, compatibility `reason`) is distinct from the snapshot manifest. `updateCheckpointForSave` changes metadata only; it must not rebuild the manifest or change the restore target. `overwriteCheckpointForSave` preserves checkpoint id/identity and rebuilds the manifest from current save state.
- **Retention is the pruning contract**: `retention: "pinned"` survives ordinary automatic prune; `retention: "auto"` participates in the platform recent+sparse policy. The compatibility `reason?: string` field may remain on records/summaries for old UI/debug labels, but new behavior must not switch on closed reason values.
- **Default create semantics**: generic `createCheckpointForSave` / SDK `checkpoints.create()` create a new current-state checkpoint at the active/current turn. Explicit SDK/card calls default to `retention: "pinned"`; formal turn and maintenance checkpoints use `retention: "auto"`.
- **Restore = scheme R (prune-on-restore)**: restoring to turn N prunes turn files to 1..N **and deletes checkpoints with turn > N** (the abandoned future branch). Rationale: with turn files pruned, future checkpoints cannot be restored anyway (their turn files are gone), so they have no retention value; leaving them pollutes the list with ghosts and risks state/turn mismatch. Restore has a confirm dialog (play-frontend) to prevent accidental triggers. Restore, delete, overwrite, and prune paths must GC orphan checkpoint blobs by scanning remaining manifests before deleting unreferenced blobs.
- **Pruning + GC**: `pruneCheckpointsForSave` runs at the end of automatic checkpoint-producing flows. Keeps pinned checkpoints, recent automatic checkpoints, sparse automatic checkpoints, and the current turn; deletes other `auto` checkpoints. GC is a simple full-scan (collect referenced hashes from remaining manifests → delete orphan blobs by ownerSaveId) — no incremental refcount, because single-save blob count is tens-to-low-hundreds and pruning runs once per turn (dwarfed by the LLM call). M/K come from `getCheckpointPruneConfig()` seam (hardcoded 50/20 today; `platform-config` task will wire it to `.tsian/` config source).
- **Hash computation is async** (`crypto.subtle.digest`) and cannot run inside a Dexie transaction. Checkpoint build/overwrite = hash+write blobs (outside tx) → small tx to write the thin-manifest record. Restore = prefetch all blobs by manifest (outside tx) → small tx to overwrite workspace + prune turns + delete future checkpoints.

### invokeAgent checkpoint option

`invokeAgent` is a side-channel call (does not advance turn, does not write history). By default it commits only the side-channel transaction's explicit save-runtime changes and creates **no checkpoint**. New callers request checkpoint behavior through `InvokeAgentRequest.checkpoint`:

- Omitted / `false` → workspace commit only.
- `true` or `{ mode: "create" }` → create a post-commit checkpoint from the merged workspace snapshot. Defaults to `retention: "pinned"` unless provided.
- `{ mode: "overwrite", checkpointId }` → overwrite that checkpoint's manifest from the merged post-commit workspace, preserving checkpoint id.
- `{ mode: "current-turn-auto" }` → overwrite the current turn's canonical automatic checkpoint; if absent, create it. The resulting checkpoint has `retention: "auto"` and participates in prune.

**Legacy compatibility**: `commitMode: "workspace-with-checkpoint"` is deprecated and maps to `{ mode: "current-turn-auto" }` when no explicit `checkpoint` option is supplied. `checkpointReason` is compatibility data only; legacy callers may still pass `"post-turn-maintenance"`, but new behavior must not require reason enums.

**Transactional requirement**: `commitWorkspaceChangesWithOptionalCheckpointForSave` merges explicit side-channel workspace changes into the current save workspace and writes/overwrites the checkpoint in one Dexie transaction. The snapshot manifest must be built from the merged post-change workspace, not the pre-commit workspace. If the workspace changes concurrently, retry; if retries fail, throw and do not emit `completed`.

**Current-turn auto canonicalization**: after a maintenance/current-turn-auto checkpoint is written, same-turn obsolete automatic checkpoints are deleted in the same transaction (protected frontend-debug baseline excluded). This makes restore for a turn land on the post-maintenance state, not a stale pre-maintenance checkpoint.

**Maintenance-side cleanup / derived state hooks**: if invokeAgent maintenance needs to auto-clean derived save-runtime files (e.g. stale `save/scenes/*.json`), stage those mutations into the same `RuntimeWorkspaceTransaction` **before** `finalWorkspaceChanges()` and before checkpoint commit. Do not delete committed workspace files after the checkpoint commit: post-commit deletes would not be in the checkpoint manifest, so restoring the checkpoint would resurrect stale files. Best-effort cleanup belongs in the host/runtime orchestration layer when it depends on AIRP semantics, but its mutations must still enter the maintenance transaction.

**`completed` event ordering**: `emitAgentInvocation({ type: "completed" })` fires **after** the commit function returns, so the frontend receives `completed` only when workspace + checkpoint are durable and restore-ready.

### Checkpoint API code-spec

#### 1. Scope / Trigger

- Trigger: changing checkpoint storage helpers, `platform.runAction` checkpoint actions, SDK `tsian.checkpoints`, checkpoint list queries, restore behavior, prune/GC, or `interaction.invokeAgent.checkpoint`.

#### 2. Signatures

- Contracts: `CheckpointSummary`, `ListCheckpointOptions`, `CreateCheckpointOptions`, `UpdateCheckpointOptions`, `OverwriteCheckpointOptions`, `InvokeAgentCheckpointOption`.
- SDK: `checkpoints.list(options?)`, `create(options?: string | CreateCheckpointOptions)`, `update(id, patch)`, `overwrite(id, options?)`, `delete(id)`, `restore(id)`.
- Platform actions: `create-checkpoint`, `update-checkpoint`, `overwrite-checkpoint`, `delete-checkpoint`, `restore-checkpoint`.
- Storage helpers: create/update/overwrite/delete/list/restore plus `commitWorkspaceChangesWithOptionalCheckpointForSave` for workspace+checkpoint atomic commits.

#### 3. Contracts

- `create` always creates a new checkpoint from current state; it must not hide opening-specific initial replacement.
- `update` changes metadata only and must not change `manifest`, `turn`, or restore target.
- `overwrite` preserves checkpoint id and `createdAt`, rebuilds `manifest` from current state, and may patch metadata/`updatedAt`.
- `delete` is explicit and destructive; it must protect active frontend-debug baseline checkpoints and GC blobs afterward.
- `list` hides `visible: false` by default; `includeHidden: true` is for platform/debug paths that must see protected hidden baselines.
- `reason` is compatibility metadata only; `retention` controls pruning and `source`/`tags`/`metadata` describe producers/business labels.

#### 4. Validation & Error Matrix

- No active save -> `ACTIVE_SAVE_REQUIRED`.
- Missing/blank checkpoint id -> `CHECKPOINT_ID_REQUIRED`.
- Unknown checkpoint id -> `CHECKPOINT_NOT_FOUND`.
- Delete/overwrite protected frontend-debug baseline -> `CHECKPOINT_PROTECTED`.
- `invokeAgent` explicit `checkpoint` combined with legacy `commitMode: "workspace-with-checkpoint"` -> fail loud.
- `invokeAgent.checkpoint.mode` not `create`/`overwrite`/`current-turn-auto` -> fail loud at bridge/host boundary.
- Workspace changes during workspace+checkpoint commit -> retry up to the helper limit, then throw retryable error.

#### 5. Good/Base/Bad Cases

- Good: opening completion lists hidden/visible checkpoints, finds the initial checkpoint, then calls `overwrite(initial.id, { label: "开局设定", retention: "pinned", source: "card", tags: ["opening-complete"] })`.
- Good: post-turn maintenance calls `invokeAgent(..., { checkpoint: { mode: "current-turn-auto" }, persist: true })`; restore to that turn sees post-maintenance save-runtime state and the checkpoint remains auto-prunable.
- Base: a user/card creates `checkpoints.create("决战前")`; it becomes a pinned current-state checkpoint.
- Bad: using `create` to create a turn-0 manual checkpoint and secretly delete `initial`.
- Bad: pruning by `reason === "after-turn"` or protecting by `reason === "manual"` instead of `retention`.

#### 6. Tests Required

- Run `npm run build:contracts` for contract changes and `npm run build:web` for platform/SDK consumers.
- Verify create/list current-turn behavior, update metadata-only behavior, overwrite same-id new snapshot behavior, delete+restore errors, restore future-branch pruning, and protected frontend-debug baseline floor.
- Verify `invokeAgent` default creates no checkpoint, `checkpoint: true` creates one, `mode: "overwrite"` preserves id, and `mode: "current-turn-auto"` canonicalizes same-turn auto checkpoints.
- Search for stale reason-switches in checkpoint storage/UI: `reason === "after-turn"|"manual"|"initial"` should not drive pruning/protection.

#### 7. Wrong vs Correct

##### Wrong

```ts
if (checkpoint.reason === "manual") keepIds.add(checkpoint.id)
```

##### Correct

```ts
if (checkpointRetention(checkpoint) === "pinned") keepIds.add(checkpoint.id)
```

##### Wrong

```ts
await tsian.checkpoints.create("开局设定")
// Hidden side effect: deletes initial checkpoint.
```

##### Correct

```ts
const initial = (await tsian.checkpoints.list({ includeHidden: true }))
  .find((checkpoint) => checkpoint.tags?.includes("initial") || checkpoint.reason === "initial")
if (initial) {
  await tsian.checkpoints.overwrite(initial.id, {
    label: "开局设定",
    retention: "pinned",
    source: "card",
    tags: ["opening-complete"],
  })
}
```


## Quality

- Run `npm run build:web` for any storage change.
- If Dexie tables change, bump the DB name (rename-and-reset; no migration) and update `tsian-game-card-frontend-sw.js` which mirrors the name.
- Do not place IndexedDB schema fields outside `storage/db.ts`.
- Do not add migrations or compatibility layers for local IndexedDB without explicit approval.
- Do not create duplicate storage helpers for the same table.

## Scenario: Built-in roll_dice Tool Seed

### 1. Scope / Trigger

- Trigger: changing the default `tools/roll_dice/tool.json` or `tools/roll_dice/run.js` seed in `apps/platform-web/src/storage/workspace-templates.ts`.
- This is an AI-facing Tool contract: the JSON schema and descriptions are shown to LLMs as native function-calling surface.

### 2. Signatures

- Tool name: `roll_dice`.
- Required input: `sides: integer >= 2`.
- Optional input: `count?: integer >= 1`, `modifier?: number | string`, `dc?: number`, `advantage?: boolean`, `disadvantage?: boolean`, `reason?: string`, `opposed?: object`.
- `opposed` fields: `sides?: integer >= 2`, `count?: integer >= 1`, `modifier?: number | string`, `advantage?: boolean`, `disadvantage?: boolean`.
- `modifier` (both levels) accepts a number or a pure-numeric arithmetic expression string supporting `+ - * / ^` (power) and `sqrt()`. No variable names, entity paths, or function names other than `sqrt`. Evaluation failure → `ROLL_DICE_INVALID_ARGS`.

### 3. Contracts

- Without `opposed`, `dc` is allowed and output may include `dc` plus `success: boolean`.
- With `opposed`, `dc` is forbidden. Output includes `opposed`, `margin = total - opposed.total`, and `winner: "self" | "opposed" | "tie"`.
- `opposed.sides` and `opposed.count` default to the top-level `sides` / `count`; `opposed.modifier` defaults to `0`.
- `modifier` (both levels) may be a number or a pure-numeric arithmetic expression string. The Tool evaluates expressions via a restricted parser (whitelist regex → `^` to `**`, `sqrt` to `Math.sqrt` → `Function` constructor in strict mode). It does not accept `eval`, variable names, entity paths, or DSLs. Agent reads numeric values from context injection and assembles the expression (e.g. `"15-12"` for an attribute differential); the Tool does the arithmetic so the Agent doesn't have to.
- `count === 1` triggers critical success/failure: `kept[0] === 1` → `criticalFailure: true`; `kept[0] === sides` → `criticalSuccess: true`. These are returned as output fields and take priority over regular `success`/`winner`:
  - Single check (`dc`): `criticalSuccess` → `success = true` regardless of dc; `criticalFailure` → `success = false` regardless of dc.
  - Opposed: each side is checked independently. One side `criticalSuccess` and the other `criticalFailure` → the `criticalSuccess` side wins. Otherwise regular `margin`/`winner` logic applies.
  - `count > 1`: the two `critical*` fields are not emitted; no critical judgment is made.
- A tie is a valid output. Do not add `tieBreak`, reroll, or forced-winner behavior at the Tool layer.

### 4. Validation & Error Matrix

- `dc` + `opposed` together -> `ROLL_DICE_INVALID_ARGS`, before random generation.
- Top-level `modifier` missing -> use `0`.
- Top-level or opposed `modifier` present but not a finite number and not a string -> `ROLL_DICE_INVALID_ARGS`, before random generation.
- `modifier` string that fails the whitelist regex, is empty, throws during evaluation, or yields a non-finite result -> `ROLL_DICE_INVALID_ARGS`, before random generation.
- Empty-string modifier -> `ROLL_DICE_INVALID_ARGS`; do not allow `Number("") === 0` to pass silently.
- Invalid `sides` / `count` -> fail loud through the dice helper / Tool argument validation.

### 5. Good/Base/Bad Cases

- Good: `roll_dice({ sides: 20, modifier: "15-12", opposed: { modifier: 1 }, reason: "追逐对抗" })` returns both sides, `margin`, and `winner`; the string modifier is evaluated as `3`.
- Good: `roll_dice({ sides: 20, modifier: "sqrt(4)", dc: 13 })` evaluates the modifier to `2` and keeps the single-check `success` path.
- Base: `roll_dice({ sides: 20, modifier: 1, dc: 13 })` keeps the single-check `success` path.
- Critical (count === 1): a roll whose `kept[0] === 20` on `sides: 20` returns `criticalSuccess: true`; with a `dc`, `success = true` regardless of `total`. A roll whose `kept[0] === 1` returns `criticalFailure: true`; `success = false` regardless of `total`.
- Bad: `roll_dice({ sides: 20, dc: 15, opposed: { "modifier": 2 } })` must fail instead of returning both success and winner.
- Bad: `roll_dice({ sides: 20, modifier: "attributes.体魄" })` must fail (`ROLL_DICE_INVALID_ARGS`) — entity paths and variable names are not in the whitelist.
- Bad: `roll_dice({ sides: 20, modifier: "1/0" })` must fail (`ROLL_DICE_INVALID_ARGS`) — non-finite result.

### 6. Tests Required

- Build/typecheck: run `npm run build:web` for `workspace-templates.ts` changes.
- Behavior check: verify single `dc` path, opposed defaulting, `winner` values (`self` / `opposed` / `tie`), `dc + opposed` pre-roll error, invalid modifier pre-roll error, `count === 1` critical success/failure priority over `success`/`winner`, and `count > 1` emitting no `critical*` fields.
- Expression check: string `modifier` is evaluated (`"15-12"` → `3`, `"sqrt(4)"` → `2`, `"1/0"` → error); whitelist rejects entity paths, variable names, and non-`sqrt` function names.
- AI-facing check: grep the changed Tool block for stale `tieBreak`, `reroll`, or mode-gating concepts.

### 7. Wrong vs Correct

#### Wrong

```json
{ "sides": 20, "dc": 15, "opposed": { "modifier": 2 } }
```

This asks the Tool to produce both a threshold success and an opposed winner.

```json
{ "sides": 20, "modifier": "attributes.体魄 - 12", "dc": 13 }
```

This asks the Tool to read an entity path; the whitelist rejects it with `ROLL_DICE_INVALID_ARGS`. Read the numeric value yourself and pass `"15-12"`.

#### Correct

```json
{ "sides": 20, "modifier": "15-12", "opposed": { "modifier": 2 }, "reason": "双方争夺主动权" }
```

This asks for one opposed fact. The string modifier is evaluated as `3`. If totals tie, the Tool returns `winner: "tie"` and the storyteller handles the narrative.

## Scenario: Sharded Novel Source Corpus

### 1. Scope / Trigger

- Trigger: changing novel source import, `save/source/manifest.json`, `save/source/chapters.index.json`, source-reading browser scripts, frontier source windows, or AI-facing docs that tell Agents how to read source text.
- This is a cross-layer storage contract: play frontend import writes it, runtime workspace scripts read it, Agents receive action outputs, and frontend preview/timeline UI consumes metadata.

### 2. Signatures

- Manifest path: `save/source/manifest.json`.
- Chapter index path: `save/source/chapters.index.json`.
- New shard root: `save/source/shards/`.
- New shard files: `save/source/shards/source-shard-0001.md`, `source-shard-0002.md`, ...
- New chapter refs: `source:chapter-0001`, `source:chapter-0002`, ...
- Legacy chapter path support: `save/source/chapters/chapter-0001.md` may still exist in old saves and is read through `chapter.path` only as a compatibility fallback.

### 3. Contracts

- New imports write a v2 sharded index. They must not write one file per chapter.
- `chapters.index.json` v2 shape:
  - `version: 2`.
  - `storage.kind: "sharded"`.
  - `storage.targetShardCharacters: number` (current default: about `1000000`).
  - `shards[]`: `{ id, path, startChapter, endChapter, characters }`.
  - `chapters[]`: `{ index, ref, title, characters, source }`.
  - `chapter.source`: `{ kind: "shard", shardId, path, start, end }`, where `start/end` are JavaScript string offsets inside the shard content.
- Legacy v1 shape remains readable in runtime source readers: `chapters[]` entries may contain `{ title, path, characters }`.
- `frontier.sourceWindow.chapters[]` stores compact source metadata:
  - New v2 writes use `{ index, title, ref }`.
  - Legacy entries with `{ index, title, path }` remain accepted.
- `frontier.extractedThrough` is a source reference string. New writes use `chapter.ref`; legacy saves may contain chapter file paths.
- AI-facing Skill/docs should not teach Agents to depend on shard paths or per-chapter file paths. Agents should use source-reading actions and chapter refs.

### 4. Validation & Error Matrix

- Missing `manifest.status === "ready"` -> source is not ready; opening/frontier readers fail loud.
- Missing or non-array `chapters.index.json.chapters` -> invalid chapter index.
- v2 chapter without `source.kind === "shard"`, `source.path`, numeric `start`, numeric `end` -> invalid chapter entry.
- v2 `source.end < source.start` -> invalid chapter offsets.
- Missing shard file when reading a v2 chapter -> source file missing, include shard path and chapter ref in details.
- Legacy chapter without `path` and no valid v2 `source` -> invalid chapter entry.
- `frontier.sourceWindow.chapters[*].ref` or legacy `path` not present in the loaded source index -> unknown source reference.
- `frontier.extractedThrough` not present in known refs/paths -> unknown source reference.

### 5. Good/Base/Bad Cases

- Good: a 5000-chapter import writes tens of `source-shard-*.md` files, one v2 index, and one ready manifest; preview and runtime actions read chapters by `ref` through the shared source reader.
- Good: `read_frontier_window` reads 15 adjacent v2 chapters and caches shard content within the script invocation, so adjacent chapters in one shard do not cause 15 workspace reads.
- Base: an old save with v1 `chapters[] = [{ title, path, characters }]` still works in formal-play runtime source readers.
- Bad: a new import writes `save/source/chapters/chapter-0001.md` for every chapter.
- Bad: an AI-facing Skill tells the model to read `sourceWindow.chapters[*].path` or hard-codes `save/source/chapters/` as the source layout.
- Bad: frontend preview reads shard-backed chapters by assuming `chapter.path`; v2 entries may not have `path`.

### 6. Tests Required

- Build/typecheck: run `npm run build --workspace play-frontend-dev` for play frontend source changes and `npm run build:web` for platform template/storage changes.
- Import behavior: generate or import a long synthetic novel; assert shard count is based on shard size, not chapter count, and `manifest.json` is written after shards/index.
- Frontend preview: verify v2 shard-backed preview and legacy v1 `chapter.path` preview fallback.
- Runtime actions: verify `inspect_source_opening`, `read_opening_slice`, and `read_frontier_window` return readable text for v2 and legacy v1 source indexes.
- Frontier state: verify `commit_runtime_and_frontier` / `commit_frontier_state` accept new `ref` metadata and reject unknown refs.
- AI-facing check: grep changed workspace templates/card docs for stale `sourceWindow.chapters[*].path`, `save/source/chapters/`, and instructions that expose shard internals to Agents.

### 7. Wrong vs Correct

#### Wrong

```ts
const file = await tsian.workspace.read(chapter.path)
```

This only works for legacy v1 indexes. New v2 chapters are shard-backed and may not have `path`.

```md
Read `save/source/chapters/` files from `sourceWindow.chapters[*].path`.
```

This teaches Agents a storage layout that no longer exists for new imports.

#### Correct

```ts
const text = await readSourceChapter(tsian, chapter)
```

The shared reader handles v2 shard slicing and legacy `chapter.path` fallback.

```md
Use the source-reading action/window metadata and cite chapter refs; source storage may be sharded.
```

This preserves the Agent-facing chapter concept without exposing storage internals.

## Source References

- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/checkpoints.ts`
- `apps/platform-web/src/storage/blobs.ts`
- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/storage/workspace.ts`
