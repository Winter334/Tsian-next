# State Management

The app uses Vue local state, Dexie persistence, and bridge/platform-host state. There is no Pinia, Vuex, or global store library.

## Vue State

- Use `ref`, `computed`, and `watch` for view state. `ResourceLibraryView.vue` is the reference for route-level state with active tab, selected resource, draft, save status, and fullscreen editor flags.
- Keep derived lists in `computed`. Examples: `resourceTabs`, `activeResources`, `promptPresetOptions`, and `worldBookOptions`.
- Use explicit status enums for async UI state. Example: `type SaveStatus = "saved" | "dirty" | "saving" | "error"`.
- Use immutable replacement for arrays when Vue Flow state needs reactivity. `useWorkflowEditor.ts` replaces `nodes.value` and `edges.value` instead of mutating nested arrays directly for most graph operations.

## Dexie State

- Table shapes live in `storage/db.ts` as `Local*Record` interfaces.
- Schema changes currently use a new database name, not migrations. `TsianLocalDb` uses a versioned `super("tsian-local-v*")`; this matches the project rule that prototype data may be cleared rather than migrated.
- Multi-table writes should use `localDb.transaction`. `createLocalSave` writes save, snapshot, history, initial events, and archives transactionally before creating the initial checkpoint.
- Save-level metadata belongs on `LocalSaveRecord`. Examples: `workflowPresetId` and `playerArchiveIds`.

## Scenario: Save-Scoped Workflow Memory Records

### 1. Scope / Trigger

- Trigger: workflow nodes can now query/write memory beyond the built-in event/archive store, so storage, checkpoint restore, workflow execution, editor schemas, and mod workflow validation share one contract.
- Goal: advanced users can replace or remove the default memory chain without hardcoded platform-host retrieval fallback.

### 2. Signatures

- DB table: `localDb.memoryRecords`.
- Record shape: `LocalMemoryRecord { id, saveId, namespace, collection, recordId, data, schemaVersion?, tags, updatedAt }`.
- Write API: `applyMemoryWriteOperationsForSave(saveId, operations, defaults?)`.
- Query API: `listMemoryRecords({ saveId, namespace?, collection?, query?, limit? })`.
- Workflow node types: `memory-query`, `memory-write`, `template-compose`,
  `record-filter`, `record-merge`, and `record-format`.

### 3. Contracts

- `memory-query` is collection-only. It reads one save-scoped generic memory collection and outputs `records` and `count`.
- The retired `memory-query { source: "event-archive" }` branch must not be exposed by the editor or executed as a hidden AIRP retrieval path. Old workflows that still set that source should fail loudly.
- The platform default AIRP workflow should use the mixed AIRP workflow preset shape: AIRP collection queries (`airp/events`, `airp/archives`, `airp/globals`) -> public record-processing nodes -> bounded `compute` for AIRP-specific extraction/ranking/relation/assembly -> chat/maintenance.
- `memory-write` consumes `MemoryWriteOperation[]` and outputs `upsertedIds`, `deletedIds`, and `clearedCollections`.
- `record-filter` consumes an array input and filters items by limited predicates over record meta, tags, or `data` paths; it outputs a filtered array and `count`.
- `record-merge` consumes configured array inputs, merges them in order, dedupes by a stable key path, and outputs a merged array and `count`.
- `record-format` consumes an array input and renders each item through an item template, outputting text and `count`.
- `MemoryWriteOperation.type` currently supports `upsert`, `patch`, `delete`, and `clear`; platform storage must recognize all operation types declared by contracts.
- `patch` is shallow over custom `memoryRecords`: it requires an existing record id, requires both existing `data` and patch `data` to be JSON objects, then merges top-level fields.
- `template-compose` renders `{{token}}` / `{{token.json}}` from workflow inputs and outputs either text or parsed JSON.
- Built-in AIRP `globals/currentTime` is a reserved record whose `data` shape is `{ key: "currentTime", value: "YYYY-MM-DD HH:mm" }`; default retrieval treats that record as the authoritative narrative time.
- `apply-patch` is a compatibility write node for `MaintenancePatchDocument`; compatibility workflows may declare it explicitly, and platform-host must not apply hidden host-managed patches outside the DAG.
- Because generic AIRP `memoryRecords` are the current authority, the
  `apply-patch` compatibility path must sync its legacy event/archive/global
  writes back through `replaceAirpMemoryForSave()` before any optional
  checkpoint.
- Custom memory records are save-scoped. They must be included in save deletion, initial checkpoint creation, checkpoint push, and checkpoint restore.
- Workflow side effects are not a full transaction across all nodes. A failed workflow run rolls back the in-memory runtime snapshot, while storage side effects follow the same fail-loud/checkpoint model as `apply-patch`.
- Default AIRP maintenance now writes generic `MemoryWriteOperation[]` through an explicit `memory-write` node; platform-host then syncs the resulting AIRP memory back into legacy compatibility slices before the authoritative after-turn checkpoint.
- `memory-write` and `apply-patch` nodes default to no node-local checkpoint;
  platform-host owns the normal after-turn checkpoint after compatibility sync.
  Use `pushCheckpointReason: "manual"` or `"after-turn"` only when an explicit
  mid-workflow checkpoint is intentional.
- Semantic AIRP retrieval remains a bounded internal stage in this slice. It should not force the first public generic node vocabulary, and no temporary visual stage-trace UI is required before the next workflow-publication phase.
- `compute` is a legitimate workflow primitive, including in official presets. Use it for special, AIRP-specific, experimental, or not-yet-generic logic; do not use it as a dumping ground for stable record filtering, merging, or formatting behavior that now has public nodes.
- When a compute node is explicitly configured with `recordRetrievalDebugOutputName`, the platform compute executor may record that output through the retrieval debug bridge. Ordinary compute nodes must not write retrieval debug implicitly.

### 4. Validation & Error Matrix

- Unknown node type -> `WorkflowValidationError`.
- `apply-patch` without a declared/bound patch input -> `APPLY_PATCH_INPUT_INCOMPLETE`.
- Mod workflow containing memory/template nodes -> allowed.
- `memory-write` with non-array operations -> executor error.
- `memory-write` upsert with non-JSON `data` -> executor/storage error.
- `memory-write` patch without `id` -> storage error.
- `memory-write` patch with non-object `data` -> storage error.
- `memory-write` patch against a missing record -> storage error.
- `memory-write` patch against existing non-object record data -> storage error.
- `memory-query` collection source without collection identity -> executor error.
- `memory-query` with any source other than `"collection"` -> executor error.

### 5. Good/Base/Bad Cases

- Good: default AIRP retrieval uses collection queries for `airp/events`, `airp/archives`, and `airp/globals`, public record nodes for common filtering/merging/formatting, bounded `compute` for AIRP-specific retrieval glue, feeds `retrieval.prompt` to chat, feeds `retrieval.directEntities` plus `archives.recent.json` to maintenance, and feeds `maintenance.operations` to an explicit `memory-write` node.
- Base: custom collection workflows use `memory-query { source: "collection", namespace, collection }` and `memory-write` with namespace/collection defaults for alternative memory structures.
- Base: custom collection workflows can combine `memory-query { source: "collection" }`, `record-filter`, `record-merge`, `record-format`, `template-compose`, and `compute` for non-AIRP memory structures such as keyword -> snippet/summary.
- Bad: reintroducing `ai-call.config.bypass.rawFromMacro = "__retrieval.raw"` hides retrieval outside the workflow and breaks replaceability.
- Bad: collapsing ordinary record filtering/merging/formatting back into a long `compute` script when the public record nodes can express the behavior.
- Bad: assuming a failed later workflow node automatically undoes earlier `memory-write` storage operations without restoring a checkpoint.

### 6. Tests Required

- Contract/build checks: `npm run build:contracts`, `npm run build:memory-core`, `npm run build:web`.
- Memory schema/validator checks: `npm run test --workspace @tsian/memory-core`.
- Workflow checks: `npm run build:workflow-engine`, `npm run test --workspace @tsian/workflow-engine`.
- Regression assertion: built-in grey-salt-town workflow uses the shared mixed AIRP workflow preset, contains AIRP collection query nodes and `record-filter` / `record-merge` / `record-format`, contains no `bypass` / `__retrieval.raw` / retired `event-archive` source, contains an explicit `maintenance.operations -> memoryWrite.operations` edge, and remains valid as a mod workflow.
- Static proof: built-in mods reference workflow presets through
  `workflowPresetId`; built-in workflow preset seeding must use explicit seed
  definitions, not deprecated `manifest.workflow`.
- Static proof: `applyMaintenancePatch()` calls `replaceAirpMemoryForSave()`
  before optional checkpoint creation so compatibility patch writes are not
  overwritten by the after-turn generic-to-legacy sync.
- Static proof: `memory-write` does not create a node-local checkpoint unless
  `pushCheckpointReason` is explicitly set to `"manual"` or `"after-turn"`.
- Static proof should keep `memory-query` collection-only across contracts, editor slots, inspector forms, and executor behavior.
- Static proof or tests for platform-internal AIRP retrieval refactors should verify that `assembleRetrievalContext()` still routes through named internal stages instead of collapsing AIRP-specific behavior into a single opaque block.
- Browser smoke: resource workflow preview and fullscreen editor show `memory-query`, and new memory/template nodes can be dragged onto the canvas and inspected.

### 7. Wrong vs Correct

#### Wrong

```ts
{
  id: "retrieval",
  type: "ai-call",
  config: { presetId: "builtin.retrieval", bypass: { rawFromMacro: "__retrieval.raw" } },
}
```

#### Correct

```ts
{
  id: "airpEvents",
  type: "memory-query",
  config: { source: "collection", namespace: "airp", collection: "events", query: "" },
}
{
  id: "ongoingEvents",
  type: "record-filter",
  config: {
    inputVarName: "records",
    predicates: [{ path: "data.status", op: "equals", value: "ongoing" }],
  },
}
{
  id: "retrieval",
  type: "compute",
  config: {
    script: "return { prompt: '...', directEntities: [], archives: [], debug: {} }",
    recordRetrievalDebugOutputName: "debug",
  },
}
```

> Warning: built-in resource seeds overwrite existing built-in records, but Vite dev hot reload may not reload modules under `builtin/`. After changing a built-in mod workflow, use a hard page reload before judging the resource preview.

## Runtime And Bridge State

- `LocalRuntimeEngine` owns the in-memory snapshot. It exposes `loadSnapshot`, append methods, and `applyRuntimeStatePatch`; it does not own persistence.
- `platform-host/index.ts` coordinates save loading, workflow execution, bridge extension, retrieval debug cache, and snapshot persistence.
- The base bridge in `bridge/play-frontend-bridge.ts` only delegates core engine methods and throws for platform-only write APIs. The platform host injects the full implementation.
- Route views that query active-save resources on mount must wait until platform-host initialization has completed after a hard refresh. Otherwise `history` / `events` / `archives` / `checkpoints` reads can race the active-save restore path and render empty debug data.

## Workflow Output State

- Workflow execution state is exposed through `OutputsStoreWriter`, implemented in `workflow-host/outputs-store.ts`. Keep Vue reactivity out of `packages/workflow-engine`.
- The engine calls output hooks; hooks should update snapshots for UI/debug visibility but must not change scheduler correctness.

## Avoid

- Do not add compatibility migrations unless the user explicitly asks. For prototype local data, prefer clearing and reseeding.
- Do not store generated AI or workflow runtime state in component-only refs when it must survive navigation or bridge queries.
- Do not duplicate resource library state in multiple persistence modules; `storage/resources.ts` is the resource boundary.
