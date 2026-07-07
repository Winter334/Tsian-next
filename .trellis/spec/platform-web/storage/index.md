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
- **Restore = scheme R (prune-on-restore)**: restoring to turn N prunes turn files to 1..N **and deletes checkpoints with turn > N** (the abandoned future branch). Rationale: with turn files pruned, future checkpoints cannot be restored anyway (their turn files are gone), so they have no retention value; leaving them pollutes the list with ghosts and risks state/turn mismatch. Restore has a confirm dialog (play-frontend) to prevent accidental triggers.
- **Pruning + GC**: `pruneCheckpointsForSave` runs at the end of every `commitSuccessfulRuntimeTurnForSave`. Keeps recent 50 + every 20 turns sparse + all initial/manual + current turn; deletes the rest. GC is a simple full-scan (collect referenced hashes from remaining manifests → delete orphan blobs by ownerSaveId) — no incremental refcount, because single-save blob count is tens-to-low-hundreds and pruning runs once per turn (dwarfed by the LLM call). M/K come from `getCheckpointPruneConfig()` seam (hardcoded 50/20 today; `platform-config` task will wire it to `.tsian/` config source).
- **Hash computation is async** (`crypto.subtle.digest`) and cannot run inside a Dexie transaction. Checkpoint build = hash+write blobs (outside tx) → small tx to write the thin-manifest record. Restore = prefetch all blobs by manifest (outside tx) → small tx to overwrite workspace + prune turns + delete future checkpoints.

### invokeAgent `workspace-with-checkpoint` commit mode

`invokeAgent` is a side-channel call (does not advance turn, does not write history). Its `commitMode` (`packages/contracts/src/runtime.ts:680`, `AgentInvocationCommitMode`) selects the workspace commit strategy:

- `"workspace"` (default) → `commitWorkspaceFilesForSave` (writes workspace files only, **no checkpoint**).
- `"workspace-with-checkpoint"` → `commitWorkspaceFilesWithCheckpointForSave` (writes workspace files **and creates a checkpoint** in one Dexie transaction).

**Checkpoint reason enum** (`storage/db.ts`, `LocalCheckpointRecord.reason`): `"initial" | "after-turn" | "manual" | "post-turn-maintenance"`. The contracts layer `InvokeAgentRequest.checkpointReason` is a free `string`; platform-host validates it and maps to the closed storage enum. MVP only accepts `"post-turn-maintenance"`; unknown values throw fail-loud.

**Replace-on-create semantics**: when `workspace-with-checkpoint` succeeds, the same Dexie transaction that writes the maintenance checkpoint **deletes same-turn `after-turn` checkpoints** (`turn === invokeMaxTurn && reason === "after-turn"`). The maintenance checkpoint becomes that turn's canonical checkpoint (post-maintenance state). This avoids restore confusion where a pre-maintenance `after-turn` would show "correct narrative, stale state". On failure, no checkpoint is created and the `after-turn` survives as the fallback.

**Turn attribution**: the checkpoint's `turn` = caller-supplied `invokeMaxTurn` (invokeAgent does not advance turn). Same turn as the `sendMessage` `after-turn` checkpoint, different `reason` and `createdAt`.

**Prune interaction**: `post-turn-maintenance` is not in the `initial`/`manual` auto-keep class. It survives via the "current turn" rule (`cp.turn === currentTurn`) and sparse-point rule. When the turn ages out, prune reclaims it normally — replace-on-create already guarantees no same-turn `after-turn` lingers, so no stale pre-maintenance point resurfaces.

**`completed` event ordering**: `emitAgentInvocation({ type: "completed" })` fires **after** the commit function returns, so the frontend receives `completed` only when workspace + checkpoint are durable and restore-ready.

**Validation matrix** (`platform-host/index.ts`):
- `commitMode === "workspace"` + `checkpointReason !== undefined` → throw (reason requires checkpoint mode).
- `commitMode === "workspace-with-checkpoint"` + `checkpointReason` provided + `!== "post-turn-maintenance"` → throw (MVP rejects unknown reasons).
- `commitMode === "workspace-with-checkpoint"` + `checkpointReason` omitted → defaults to `"post-turn-maintenance"`.

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

## Source References

- `apps/platform-web/src/storage/db.ts`
- `apps/platform-web/src/storage/checkpoints.ts`
- `apps/platform-web/src/storage/blobs.ts`
- `apps/platform-web/src/storage/saves.ts`
- `apps/platform-web/src/storage/workspace.ts`
