# Transitional State Cleanup

## Goal

Hard-remove the old `stateRecords` model as an active platform/runtime abstraction, then make workspace-native state the project default model.

The new default model is:

```text
State = ordinary Runtime Workspace files + local README/schema/Skill/Agent conventions + general workspace capabilities.
```

This task must not preserve the old `namespace + collection + recordId` model under a new path. The default `state/` directory is only a neutral convention area for generic structured state when no better domain directory exists.

## Parent Direction

Parent task: `.trellis/tasks/06-13-runtime-foundation-completion`

Parent roadmap item: Transitional State Cleanup.

User decision: choose the harder cleanup path. Remove the transitional model first, then establish the new default state convention.

## User Value

- Future UI will not accidentally turn an MVP compatibility table into the long-term state authoring surface.
- Future Agents and Skills can own state shape through workspace files they document and maintain.
- The platform remains gameplay-neutral: it owns file APIs, checkpoint, trace, execution control, and lifecycle, not world/entity/memory/frontend schema semantics.
- Prototype-only IndexedDB state baggage is removed before concrete UI, Agent, and Skill design depends on it.

## Confirmed Facts

- `stateRecords` is a save-scoped Dexie table with logical keys `saveId + namespace + collection + recordId`.
- It came from the previous fixed workflow `state-query` / `state-write` line and survived the transition into Agent Runtime as generic compatibility storage.
- `packages/contracts/src/runtime.ts` still exports `StateRecord`, `StateWriteOperation`, and `StateWriteOutput`.
- `packages/contracts/src/memory.ts` still imports `StateWriteOperation` for old normalized write-operation types.
- `packages/contracts/src/debug.ts` exposes `CheckpointSummary.stateRecordCount`.
- `apps/platform-web/src/storage/state-records.ts` still provides list/delete/apply helpers, including `applyStateWriteOperationsForSave`.
- Current active code no longer appears to call `applyStateWriteOperationsForSave`; no active runtime/platform action writer for `stateRecords` was found.
- `apps/platform-web/src/platform-host/index.ts` still exposes `state-records` as a bridge query resource.
- `interaction.sendMessage` still reads current `stateRecords` and passes them into `runAgentRuntimeTurn`.
- Agent Runtime still formats `stateRecords` into master, narrative, and delegated prompts as compatibility context.
- Checkpoints still include `stateRecords` and restore them alongside snapshot, history, and workspace files.
- `DebugView` and `builtin/play-frontends/official-default` still display `stateRecords`.
- Runtime Workspace already owns the durable substrates that should replace platform state tables: raw AIRP history files, Agent session transcripts, memory maintenance targets, trace/diagnostics, Agent definitions, Skill definitions, and ordinary workspace data.
- Existing `world/README.md` already tells content authors to store world facts, rules, characters, places, relationships, and structured state in `world/`, which supports a file-convention state model.
- Existing workspace storage has versioned default file seeding/upgrades through `.tsian/manifest.json`.
- Project specs say prototype schema changes should use a new Dexie database name, not migrations.

## Requirements

- Remove `stateRecords` from active TypeScript contracts, storage helpers, platform-host query handling, Agent Runtime input, prompt assembly, checkpoint payloads, DebugView, official default frontend, active docs, and active Trellis specs.
- Reset prototype local persistence by moving to a new Dexie database name instead of writing a data migration for old `stateRecords`.
- Do not export, archive, or migrate old records into workspace files in this task. They are prototype legacy data.
- Do not create `state/records/<namespace>/<collection>/<id>.json` or any equivalent record-table layout.
- Seed a default `state/` workspace directory as a generic convention area:
  - `state/README.md`;
  - `state/schemas/README.md`;
  - `state/data/README.md`.
- Describe `state/` as optional and replaceable. More specific domain conventions should win:
  - `world/*` for world facts, rules, entities, relationships, and gameplay state;
  - `memory/*` for memory and retrieval-oriented projections;
  - `frontend/*` for frontend package state;
  - Skill-owned paths documented by `SKILL.md`;
  - Agent-owned paths declared through `AGENT.md` and notes.
- Keep capabilities ordinary and workspace-level:
  - read/list/search;
  - staged write/delete through existing platform-controlled action/SDK paths;
  - future general workspace indexes/cache/vector retrieval, if added later.
- Do not add state-specific vector retrieval, state-specific query DSL, platform state-write action, or platform-owned gameplay schema in this task.
- Update active direction docs/specs so future work treats workspace-native files as the state substrate.

## Default Workspace State Convention

New saves should include:

```text
state/
  README.md
  schemas/
    README.md
  data/
    README.md
```

The directory means:

- Use `state/` for generic structured state only when no more specific directory exists.
- Keep file layouts local and documented near the data.
- Put optional schemas or examples under `state/schemas/`.
- Put generic state data under `state/data/` only when a local convention needs it.
- Prefer domain directories such as `world/`, `memory/`, and `frontend/` when they are clearer.
- Indexes, caches, semantic retrieval, and embeddings are workspace/file-system capabilities, not state-specific platform code.

## Out Of Scope

- Designing final state authoring UI.
- Designing concrete world, character, relationship, memory, frontend, or rules schemas.
- Adding vector retrieval, embeddings, semantic search, or special state indexes.
- Adding a platform state-write tool/action.
- Preserving old local IndexedDB prototype saves.
- Reintroducing old workflow `state-query` / `state-write` surfaces.
- Changing `.tsian/*` platform metadata visibility rules.

## Acceptance Criteria

- [x] Active app/contracts code has no `StateRecord`, `StateWriteOperation`, `StateWriteOutput`, `stateRecords`, `state-records`, or `stateRecordCount` surface outside archived task docs or this task's historical discussion.
- [x] Agent Runtime no longer receives or injects legacy state records.
- [x] Checkpoints preserve snapshot, history, and workspace files without a separate legacy state-record payload.
- [x] DebugView and official default frontend no longer query or render `state-records`.
- [x] New saves seed `state/README.md`, `state/schemas/README.md`, and `state/data/README.md`.
- [x] Workspace manifest/default-file versioning adds missing default state docs to existing v2 workspaces without overwriting same-path user files.
- [x] Active direction docs/specs describe workspace-native state as the default model and do not present `stateRecords` as active runtime state.
- [x] Parent task records this cleanup child as the selected `stateRecords` resolution.
- [x] `python3 ./.trellis/scripts/task.py validate 06-14-transitional-state-cleanup` passes.
- [x] `git diff --check` passes.
- [x] `npm run build:contracts` passes.
- [x] `npm run build:web` passes.

## Resolved Questions

- Cleanup strictness: hard cleanup. Remove the old active model now rather than keeping a legacy query/debug/import path.
- Old local data: reset prototype persistence with a new database name; do not migrate old records.
- Replacement model: workspace-native files and conventions, with a neutral optional `state/` directory.
- Special capabilities: keep retrieval/index/cache/vector concerns in the general workspace layer, not in state-specific code.
