# State Management

The app uses Vue local state, Dexie persistence, and bridge/platform-host state. There is no Pinia, Vuex, or global store library.

## Vue State

- Use `ref`, `computed`, and `watch` for view state. `ResourceLibraryView.vue` is the reference for route-level state with active tab, selected resource, draft, save status, and fullscreen editor flags.
- Keep derived lists in `computed`. Examples: `resourceTabs`, `activeResources`, `promptPresetOptions`, and `worldBookOptions`.
- Use explicit status enums for async UI state. Example: `type SaveStatus = "saved" | "dirty" | "saving" | "error"`.
- Use immutable replacement for arrays when Vue Flow state needs reactivity. `useWorkflowEditor.ts` replaces `nodes.value` and `edges.value` instead of mutating nested arrays directly for most graph operations.

## Dexie State

- Table shapes live in `storage/db.ts` as `Local*Record` interfaces.
- Schema changes currently use a new database name, not migrations. `TsianLocalDb` uses `super("tsian-local-v8")`; this matches the project rule that prototype data may be cleared rather than migrated.
- Multi-table writes should use `localDb.transaction`. `createLocalSave` writes save, snapshot, history, initial events, and archives transactionally before creating the initial checkpoint.
- Save-level metadata belongs on `LocalSaveRecord`. Examples: `workflowPresetId` and `playerArchiveIds`.

## Runtime And Bridge State

- `LocalRuntimeEngine` owns the in-memory snapshot. It exposes `loadSnapshot`, append methods, and `applyRuntimeStatePatch`; it does not own persistence.
- `platform-host/index.ts` coordinates save loading, workflow execution, bridge extension, retrieval debug cache, and snapshot persistence.
- The base bridge in `bridge/play-frontend-bridge.ts` only delegates core engine methods and throws for platform-only write APIs. The platform host injects the full implementation.

## Workflow Output State

- Workflow execution state is exposed through `OutputsStoreWriter`, implemented in `workflow-host/outputs-store.ts`. Keep Vue reactivity out of `packages/workflow-engine`.
- The engine calls output hooks; hooks should update snapshots for UI/debug visibility but must not change scheduler correctness.

## Avoid

- Do not add compatibility migrations unless the user explicitly asks. For prototype local data, prefer clearing and reseeding.
- Do not store generated AI or workflow runtime state in component-only refs when it must survive navigation or bridge queries.
- Do not duplicate resource library state in multiple persistence modules; `storage/resources.ts` is the resource boundary.
