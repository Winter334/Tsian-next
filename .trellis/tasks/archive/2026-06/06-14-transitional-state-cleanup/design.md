# Transitional State Cleanup Design

## Design Intent

This task is a clean break from the fixed-workflow state model.

The replacement is not `StateRecord` stored as files. The replacement is:

```text
State = Runtime Workspace files + local conventions + general workspace capabilities.
```

The platform should stop knowing universal `namespace`, `collection`, or `recordId` semantics. Those meanings belonged to the old workflow-era `state-query` / `state-write` design and should not shape the Agent framework.

## Cleanup Decision

Use hard cleanup:

- remove active `StateRecord` / `StateWriteOperation` / `StateWriteOutput` contracts;
- remove active Dexie `stateRecords` table usage;
- remove `state-records` bridge query;
- remove Agent Runtime `stateRecords` input and prompt sections;
- remove checkpoint `stateRecords` payload;
- remove UI/frontend state-record inspectors;
- update active docs/specs to point at workspace-native state.

Do not keep a hidden import/debug path for old records in this slice. Prototype local persistence can reset by using a new Dexie database name.

## New State Model

A file is state when a workspace convention says it is state.

Examples:

```text
world/characters/lin.json
world/places/harbor.json
world/relationships/main-cast.json
world/rules/combat.md
memory/facts.jsonl
memory/summaries/current.md
frontend/view-state.json
agents/memory/notes.md
state/data/custom.json
```

The platform does not need to know which of these is a character, relationship, frontend state, or memory fact. Agents and Skills learn that from:

- directory `README.md` files;
- `SKILL.md` instructions;
- schema files;
- `AGENT.md` `contextPaths`;
- ordinary workspace search/list/read.

This keeps Tsian gameplay-neutral and lets content packages replace conventions without platform migrations.

## Default Directory

Seed a default `state/` directory as a neutral convention area:

```text
state/
  README.md
  schemas/
    README.md
  data/
    README.md
```

`state/README.md` should say:

- use this directory for generic structured state only when no more specific domain directory exists;
- prefer `world/`, `memory/`, `frontend/`, Skill-owned, or Agent-owned paths when those are clearer;
- state files are ordinary workspace files;
- document file layouts near the files;
- retrieval/indexing belongs to the workspace/file-system layer, not a state-specific subsystem.

`state/data/` is intentionally generic. It must not encode `namespace/collection/id`.

`state/schemas/` is documentation and examples only. It does not create a platform schema registry.

## Replaceable Conventions

The default `state/` directory is replaceable by local convention.

Examples:

- A world package can declare `world/characters/*.json` and `world/relationships/*.json`.
- A frontend package can declare `frontend/view-state.json`.
- A memory Skill can declare `memory/facts.jsonl`.
- A rules Skill can declare `world/rules/*.md`.

Replacement does not require a platform registry in this slice. It is enough that the owning README, Skill, Agent, or content package documents the files and that Agents can discover/read/write them through normal workspace tools and allowed actions.

Future UI may add discovery affordances, but it should inspect workspace conventions rather than reviving a platform state database.

## Storage Design

Current storage includes:

```text
meta
saves
saveSnapshots
saveHistory
checkpoints
stateRecords
workspaceFiles
```

After cleanup, active storage should be:

```text
meta
saves
saveSnapshots
saveHistory
checkpoints
workspaceFiles
```

Because project specs say prototype schema changes use a new database name rather than migrations, implementation should rename the Dexie database, for example from `tsian-agent-runtime-v2` to `tsian-agent-runtime-v3`.

No migration/export of old records is required. Workspace-native state starts with new saves and versioned default workspace upgrade files.

## Checkpoint Design

Workspace files already carry new state, so checkpoint state is workspace state.

`LocalCheckpointRecord` should keep:

- snapshot;
- history;
- workspaceFiles.

It should drop:

- `stateRecords`.

`CheckpointSummary.stateRecordCount` should be replaced or removed. Preferred replacement: `workspaceFileCount`, because it describes the checkpoint payload without reviving a state-specific count.

Checkpoint restore should restore snapshot, history, and workspace files only.

## Runtime Prompt Direction

Current prompt composition includes broad "available state records" sections for master, narrative, and delegated Agents. Remove those sections.

Do not replace them with broad automatic injection of all `state/*`, `world/*`, `memory/*`, or `frontend/*` files. That would recreate the same coupling with a different backend.

Agent context should come from:

- files declared in `AGENT.md` `contextPaths`;
- Skill instructions and resources after `skill_load`;
- workspace search/list/read when needed;
- short default convention files such as root `README.md`, `world/README.md`, and `state/README.md`.

New default master `AGENT.md` should include `state/README.md` in `contextPaths` so the entry Agent knows the convention. It should not include bulk `state/data/*`.

## Bridge And UI Direction

Remove `state-records` as a bridge query resource.

DebugView and official default frontend should stop showing `stateRecords`. They can continue to show:

- history;
- checkpoints;
- runtime snapshot;
- AI debug.

Do not add the final workspace browser/editor UI here. That belongs to future UI work. This task only avoids presenting the legacy table as current state.

## Contract Direction

Remove active contract exports:

- `StateRecord`;
- `StateWriteOperationType`;
- `StateWriteOperation`;
- `StateWriteOutput`.

Remove or update direct consumers:

- `AgentRuntimeTurnInput.stateRecords`;
- bridge/frontend imports;
- storage helper imports;
- memory contract types that extend/import `StateWriteOperation`.

Do not add a replacement `WorkspaceStateRecord` contract. The replacement state surface is existing `WorkspaceFile`, `WorkspaceEntry`, `WorkspaceSearchResult`, and workspace query/action primitives.

`packages/contracts/src/memory.ts` should not be redesigned into a platform state schema in this task. Remove only the direct old state-write dependency needed for hard cleanup. A future memory-specific task can decide whether the draft memory schema still belongs.

## Workspace Default Upgrade

Update default workspace version after adding `state/` docs.

Recommended:

- `DEFAULT_WORKSPACE_VERSION = 3`;
- add `state/README.md`, `state/schemas/README.md`, and `state/data/README.md` to `DEFAULT_WORKSPACE_FILES`;
- include those three paths in `DEFAULT_WORKSPACE_UPGRADE_FILE_PATHS` so existing v2 workspaces receive missing official state docs without overwriting same-path user files;
- update root `README.md` for new saves to mention generic `state/`;
- add `state/README.md` to the default master Agent context paths for new saves.

Do not overwrite existing user-authored `AGENT.md` or root `README.md` during upgrade.

## File-System Capabilities

Allowed:

- ordinary `workspace_read`;
- ordinary `workspace_list`;
- ordinary `workspace_search`;
- staged `workspace-write` / `workspace-delete` through existing platform-controlled paths;
- Skill actions/scripts that read and write workspace files;
- future general workspace indexes/cache/vector retrieval.

Not allowed in this task:

- vector search specifically for state;
- state-specific semantic retrieval;
- platform-owned character/relationship/rules schemas;
- new state-specific runtime tools;
- broad automatic injection of all state files.

## Documentation Updates

Update active docs/specs so they describe current code after cleanup:

- `docs/active/airp-workflow-platform-direction.md`;
- `docs/active/agent-framework-runtime-workspace-direction.md`;
- `docs/active/current-state-handoff.md`;
- `apps/platform-web/CLAUDE.md`;
- `builtin/play-frontends/official-default/CLAUDE.md`;
- `packages/contracts/CLAUDE.md`;
- `.trellis/spec/platform-web/frontend/state-management.md`;
- `.trellis/spec/platform-web/frontend/type-safety.md`;
- `.trellis/spec/platform-web/frontend/component-guidelines.md`;
- `.trellis/spec/contracts/frontend/type-safety.md`;
- any other active spec found by `rg` that still presents `stateRecords` as active.

Archived task docs can keep historical mentions.

## Risks And Trade-Offs

- Local prototype saves reset when the Dexie name changes. This is acceptable for hard cleanup and avoids migration complexity around a model the project no longer wants.
- Removing the inspector tab reduces immediate visibility into legacy records, but future visibility should come from workspace browsing and convention-aware files.
- A generic `state/` directory is less prescriptive than a record table. That is intentional: concrete worlds, frontends, Agents, and Skills should own concrete shape.
- Removing old contract exports may reveal stale imports. That is useful because it prevents hidden compatibility paths from surviving by accident.

## Implementation Invariant

After implementation, active app code should answer "where is state?" with:

```text
In Runtime Workspace files, according to documented local conventions.
```

It should not answer:

```text
In the stateRecords table.
```
