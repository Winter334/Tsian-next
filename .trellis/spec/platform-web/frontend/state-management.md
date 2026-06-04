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
- Record shape: `LocalMemoryRecord { id, saveId, namespace, collection, key?, data, createdAt, updatedAt }`.
- Write API: `applyMemoryWriteOperations(saveId, operations, defaults?)`.
- Query API: `listMemoryRecords({ saveId, namespace?, collection?, query?, limit? })`.
- Workflow node types: `memory-query`, `memory-write`, `template-compose`.

### 3. Contracts

- `memory-query` with `source: "event-archive"` calls runtime retrieval and outputs `prompt`, `directEntities`, `archives`, and `debug`.
- `memory-query` with `source: "collection"` reads `memoryRecords` and outputs `records` and `count`.
- `memory-write` consumes `MemoryWriteOperation[]` and outputs `upsertedIds`, `deletedIds`, and `clearedCollections`.
- `template-compose` renders `{{token}}` / `{{token.json}}` from workflow inputs and outputs either text or parsed JSON.
- `apply-patch` is a compatibility write node for `MaintenancePatchDocument`; mod/default workflows may declare it explicitly, and platform-host must not apply hidden host-managed patches outside the DAG.
- Custom memory records are save-scoped. They must be included in save deletion, initial checkpoint creation, checkpoint push, and checkpoint restore.
- Workflow side effects are not a full transaction across all nodes. A failed workflow run rolls back the in-memory runtime snapshot, while storage side effects follow the same fail-loud/checkpoint model as `apply-patch`.

### 4. Validation & Error Matrix

- Unknown node type -> `WorkflowValidationError`.
- `apply-patch` without a declared/bound patch input -> `APPLY_PATCH_INPUT_INCOMPLETE`.
- Mod workflow containing memory/template nodes -> allowed.
- `memory-write` with non-array operations -> executor error.
- `memory-write` upsert with non-JSON `data` -> executor/storage error.
- `memory-query` collection source without collection identity -> executor error.

### 5. Good/Base/Bad Cases

- Good: default event/archive chain uses `memory-query { source: "event-archive" }`, feeds `retrieval.prompt` to chat, feeds `retrieval.directEntities` plus `archives.recent.json` to maintenance, and feeds `maintenance.patch` to an explicit `apply-patch` compatibility node.
- Base: custom collection workflows use `memory-query { source: "collection" }` and `memory-write` with namespace/collection defaults for alternative memory structures.
- Bad: reintroducing `ai-call.config.bypass.rawFromMacro = "__retrieval.raw"` hides retrieval outside the workflow and breaks replaceability.
- Bad: assuming a failed later workflow node automatically undoes earlier `memory-write` storage operations without restoring a checkpoint.

### 6. Tests Required

- Contract/build checks: `npm run build:contracts`, `npm run build:web`.
- Workflow checks: `npm run build:workflow-engine`, `npm run test --workspace @tsian/workflow-engine`.
- Regression assertion: built-in grey-salt-town workflow retrieval is `memory-query`, contains no `bypass` / `__retrieval.raw`, contains an explicit `maintenance.patch -> applyPatch.patch` edge, and remains valid as a mod workflow.
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
  id: "retrieval",
  type: "memory-query",
  config: { source: "event-archive" },
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
